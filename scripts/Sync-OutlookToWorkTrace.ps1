#Requires -Version 5.1
<#
.SYNOPSIS
    Exports recent Outlook calendar events and imports them into WorkTrace.

.DESCRIPTION
    Reads calendar events directly from the running Outlook desktop app (or a
    locally cached Exchange/M365 profile) via COM automation — no Entra app,
    no OAuth, no API keys required for Outlook itself.

    Events are serialised to an in-memory ICS string and POSTed to the
    WorkTrace /api/ttt/import/ics endpoint.

    Schedule with Task Scheduler to run daily (see docs/OutlookSync.md).

.PARAMETER DaysBack
    How many days back to pull events. Default: 7.
    On first run use a larger value (e.g. 30) to backfill.

.PARAMETER DaysForward
    How many days forward to include (useful for capturing already-logged
    all-day events or multi-day events). Default: 1.

.PARAMETER WorkTraceUrl
    Base URL of your WorkTrace instance.
    Default: https://knowledgebase-knowledgebase.apps.itz-vc7tcb.infra02-lb.dal12.techzone.ibm.com

.PARAMETER Token
    Long-lived WorkTrace JWT token (HS256).
    Store this in the script or in a Windows Credential (see README).

.PARAMETER LogFile
    Path to append log output. Default: %TEMP%\WorkTraceSync.log

.PARAMETER WhatIf
    Print the generated ICS to stdout instead of posting to WorkTrace.

.EXAMPLE
    # Normal daily run (last 7 days)
    .\Sync-OutlookToWorkTrace.ps1

.EXAMPLE
    # First-time backfill of the last 30 days
    .\Sync-OutlookToWorkTrace.ps1 -DaysBack 30

.EXAMPLE
    # Dry-run — see the ICS that would be sent
    .\Sync-OutlookToWorkTrace.ps1 -DaysBack 3 -WhatIf
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [int]    $DaysBack      = 7,
    [int]    $DaysForward   = 1,
    [string] $WorkTraceUrl  = "https://knowledgebase-knowledgebase.apps.YOUR-CLUSTER.techzone.ibm.com",
    # Paste your long-lived JWT here (same as WORKTRACE_TOKEN in ~/.bob/settings/mcp.json)
    [string] $Token         = "YOUR-WORKTRACE-JWT-TOKEN",
    [string] $LogFile       = "$env:TEMP\WorkTraceSync.log",
    [switch] $WhatIf
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Format-IcsDateTime {
    param([System.DateTime]$dt)
    # ICS UTC format: 20250101T090000Z
    $utc = $dt.ToUniversalTime()
    return $utc.ToString("yyyyMMdd\THHmmss\Z")
}

function Escape-IcsText {
    param([string]$text)
    if (-not $text) { return "" }
    # ICS text escaping: backslash, semicolon, comma, newlines
    $text = $text -replace "\\", "\\\\"
    $text = $text -replace ";",  "\;"
    $text = $text -replace ",",  "\,"
    $text = $text -replace "`r`n", "\n"
    $text = $text -replace "`n",   "\n"
    $text = $text -replace "`r",   "\n"
    return $text
}

function Fold-IcsLine {
    param([string]$line)
    # RFC 5545 §3.1 — fold lines longer than 75 octets
    $bytes  = [System.Text.Encoding]::UTF8.GetBytes($line)
    if ($bytes.Length -le 75) { return $line }

    $result = [System.Text.StringBuilder]::new()
    $pos    = 0
    $first  = $true
    while ($pos -lt $bytes.Length) {
        $take   = if ($first) { 75 } else { 74 }   # continuation lines start with space (1 byte)
        $chunk  = $bytes[$pos..([Math]::Min($pos + $take - 1, $bytes.Length - 1))]
        $str    = [System.Text.Encoding]::UTF8.GetString($chunk)
        if (-not $first) { [void]$result.Append("`r`n ") }
        [void]$result.Append($str)
        $pos   += $chunk.Length
        $first  = $false
    }
    return $result.ToString()
}

# ── Step 1: Connect to Outlook via COM ────────────────────────────────────────

Write-Log "Starting WorkTrace calendar sync (DaysBack=$DaysBack, DaysForward=$DaysForward)"

try {
    $outlook = [System.Runtime.InteropServices.Marshal]::GetActiveObject("Outlook.Application")
    Write-Log "Attached to running Outlook instance."
} catch {
    try {
        $outlook = New-Object -ComObject Outlook.Application
        Write-Log "Launched new Outlook COM instance."
    } catch {
        Write-Log "ERROR: Could not connect to Outlook. Is Outlook installed and your profile configured?" "ERROR"
        throw
    }
}

$namespace = $outlook.GetNamespace("MAPI")
$calendar  = $namespace.GetDefaultFolder(9)   # 9 = olFolderCalendar

# ── Step 2: Pull events in the date window ────────────────────────────────────

$start = (Get-Date).Date.AddDays(-$DaysBack)
$end   = (Get-Date).Date.AddDays($DaysForward + 1)   # +1 so the end date is inclusive

Write-Log "Fetching events from $($start.ToString('yyyy-MM-dd')) to $($end.ToString('yyyy-MM-dd'))"

# GetTable is the fastest way; Items.Restrict is the documented approach for date filtering
$items = $calendar.Items
$items.IncludeRecurrences = $true   # expand recurring series into individual instances
$items.Sort("[Start]")

$filter = "[Start] >= '{0}' AND [Start] < '{1}'" -f `
    $start.ToString("MM/dd/yyyy HH:mm"), `
    $end.ToString("MM/dd/yyyy HH:mm")

$filtered = $items.Restrict($filter)

Write-Log "Raw filtered item count: $($filtered.Count)"

# ── Step 3: Build ICS ─────────────────────────────────────────────────────────

$icsLines = [System.Collections.Generic.List[string]]::new()
$icsLines.Add("BEGIN:VCALENDAR")
$icsLines.Add("VERSION:2.0")
$icsLines.Add("PRODID:-//WorkTrace Outlook Sync//EN")
$icsLines.Add("CALSCALE:GREGORIAN")
$icsLines.Add("METHOD:PUBLISH")

$eventCount = 0

foreach ($item in $filtered) {
    # Skip non-AppointmentItem objects (e.g. MeetingItem ghosts)
    if ($item.Class -ne 26) { continue }   # 26 = olAppointment

    # Skip cancelled/declined meetings you don't want logged
    # ResponseStatus: 0=None,1=Organizer,2=Tentative,3=Accepted,4=Declined,5=NotResponded
    if ($item.ResponseStatus -eq 4) { continue }   # declined

    $uid      = $item.GlobalAppointmentID
    if (-not $uid) { $uid = [System.Guid]::NewGuid().ToString() }

    $summary  = Escape-IcsText $item.Subject
    $desc     = Escape-IcsText $item.Body
    $location = Escape-IcsText $item.Location
    $organizer = ""
    try { $organizer = $item.Organizer } catch {}

    $dtStart  = Format-IcsDateTime $item.Start
    $dtEnd    = Format-IcsDateTime $item.End

    $icsLines.Add("BEGIN:VEVENT")
    $icsLines.Add("UID:$uid")
    $icsLines.Add((Fold-IcsLine "SUMMARY:$summary"))
    $icsLines.Add("DTSTART:$dtStart")
    $icsLines.Add("DTEND:$dtEnd")
    if ($location) { $icsLines.Add((Fold-IcsLine "LOCATION:$location")) }
    if ($organizer) { $icsLines.Add("ORGANIZER;CN=$($organizer):mailto:$($organizer)") }
    if ($desc) {
        # Truncate description to 500 chars to keep payload reasonable
        $shortDesc = if ($desc.Length -gt 500) { $desc.Substring(0, 500) + "..." } else { $desc }
        $icsLines.Add((Fold-IcsLine "DESCRIPTION:$shortDesc"))
    }
    $icsLines.Add("END:VEVENT")
    $eventCount++
}

$icsLines.Add("END:VCALENDAR")
$icsContent = $icsLines -join "`r`n"

Write-Log "Built ICS with $eventCount events."

if ($eventCount -eq 0) {
    Write-Log "No events found in the window — nothing to import." "WARN"
    exit 0
}

# ── Step 4: WhatIf / dry-run ──────────────────────────────────────────────────

if ($WhatIf) {
    Write-Host "`n--- ICS PREVIEW ---`n"
    Write-Host $icsContent
    Write-Host "`n--- END ICS ---`n"
    Write-Log "WhatIf mode — skipped POST to WorkTrace."
    exit 0
}

# ── Step 5: POST to WorkTrace /api/ttt/import/ics ─────────────────────────────

$endpoint = "$($WorkTraceUrl.TrimEnd('/'))/api/ttt/import/ics"
Write-Log "POSTing to $endpoint"

# Build multipart/form-data manually so we don't need external modules
$boundary = [System.Guid]::NewGuid().ToString("N")
$icsBytes  = [System.Text.Encoding]::UTF8.GetBytes($icsContent)
$CRLF      = "`r`n"

$bodyParts  = [System.Text.StringBuilder]::new()
[void]$bodyParts.Append("--$boundary$CRLF")
[void]$bodyParts.Append("Content-Disposition: form-data; name=`"file`"; filename=`"outlook.ics`"$CRLF")
[void]$bodyParts.Append("Content-Type: text/calendar$CRLF")
[void]$bodyParts.Append($CRLF)

$headerBytes  = [System.Text.Encoding]::UTF8.GetBytes($bodyParts.ToString())
$footerBytes  = [System.Text.Encoding]::UTF8.GetBytes("$CRLF--$boundary--$CRLF")

$bodyBytes = New-Object byte[] ($headerBytes.Length + $icsBytes.Length + $footerBytes.Length)
[System.Buffer]::BlockCopy($headerBytes, 0, $bodyBytes, 0,                                 $headerBytes.Length)
[System.Buffer]::BlockCopy($icsBytes,    0, $bodyBytes, $headerBytes.Length,               $icsBytes.Length)
[System.Buffer]::BlockCopy($footerBytes, 0, $bodyBytes, $headerBytes.Length + $icsBytes.Length, $footerBytes.Length)

$headers = @{
    "Authorization" = "Bearer $Token"
    "Content-Type"  = "multipart/form-data; boundary=$boundary"
}

try {
    $response = Invoke-RestMethod `
        -Uri     $endpoint `
        -Method  POST `
        -Headers $headers `
        -Body    $bodyBytes
    Write-Log "SUCCESS — imported $($response.count) entries, $($response.failed) failed."
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $body       = ""
    try { $body = $_.ErrorDetails.Message } catch {}
    Write-Log "HTTP $statusCode error posting to WorkTrace: $body" "ERROR"
    throw
}

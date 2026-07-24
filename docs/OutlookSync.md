# Outlook → WorkTrace Automatic Calendar Sync

Automatically imports your Outlook desktop calendar events into WorkTrace once a day — no Entra app, no OAuth, no Microsoft Graph required.

| Platform | Script | Mechanism |
|---|---|---|
| **macOS** | `scripts/Sync-OutlookToWorkTrace.py` | macOS EventKit (Calendar.app database — Outlook syncs here automatically) |
| **Windows** | `scripts/Sync-OutlookToWorkTrace.ps1` | Outlook COM automation |

---

## macOS Setup

### How it works

Outlook for Mac syncs all your calendar events into the **macOS Calendar.app** database automatically. The Python script reads that database directly via the native **EventKit** framework — no Outlook API, no Microsoft Graph, no network calls to Microsoft.

```
Outlook for Mac  ──auto-sync──▶  macOS Calendar.app (EventKit database)
                                         │
                              Python script (EventKit via pyobjc)
                                         │
                              in-memory ICS string
                                         │
                           POST /api/ttt/import/ics
                                         │
                                    WorkTrace
```

### Prerequisites

```bash
pip install pyobjc-framework-EventKit requests
```

> **Note:** `pyobjc-framework-EventKit` is macOS-only and installs quickly (~2 MB). It gives Python access to the same calendar database that Calendar.app, Reminders, and Siri all use.

### First run

**1. Check Outlook is syncing to Calendar.app**

Open Calendar.app. You should see your Outlook events there. If not:
- Outlook for Mac → Preferences → Sync → enable "Sync Outlook calendar with macOS Calendar"

**2. List available calendars** (find your Outlook calendar name):

```bash
python3 scripts/Sync-OutlookToWorkTrace.py --list-calendars
```

Output example:
```
Available calendars:
  [iCloud              ]  Home
  [Exchange            ]  Calendar       ← this is your Outlook calendar
  [Exchange            ]  Birthdays
```

**3. Dry-run** (prints ICS, does NOT post to WorkTrace):

```bash
python3 scripts/Sync-OutlookToWorkTrace.py --days-back 3 --whatif
```

**4. Real run:**

```bash
python3 scripts/Sync-OutlookToWorkTrace.py --days-back 7
```

On first run macOS will show a permission dialog:
> *"Terminal" wants access to your calendars*

Click **OK**. This is a one-time prompt — subsequent runs are silent.

**5. First-time backfill:**

```bash
python3 scripts/Sync-OutlookToWorkTrace.py --days-back 30
```

**6. Check the log:**

```bash
tail -f ~/Library/Logs/WorkTraceSync.log
```

### Schedule with launchd (runs daily at 8:55 AM Mon–Fri)

```bash
# 1. Copy the plist to LaunchAgents
cp scripts/com.worktrace.outlooksync.plist ~/Library/LaunchAgents/

# 2. Load it
launchctl load ~/Library/LaunchAgents/com.worktrace.outlooksync.plist

# 3. Test immediately (optional)
launchctl start com.worktrace.outlooksync
```

To uninstall:
```bash
launchctl unload ~/Library/LaunchAgents/com.worktrace.outlooksync.plist
rm ~/Library/LaunchAgents/com.worktrace.outlooksync.plist
```

### CLI reference

| Flag | Default | Description |
|---|---|---|
| `--days-back N` | `7` | Days back to pull events |
| `--days-forward N` | `1` | Days forward (catches all-day events) |
| `--calendar-filter "name"` | *(all)* | Comma-separated calendar names to include |
| `--worktrace-url URL` | *(baked in)* | Override WorkTrace base URL |
| `--token TOKEN` | *(baked in)* | Override JWT token |
| `--list-calendars` | — | Print all calendar names and exit |
| `--whatif` | — | Dry-run: print ICS, do not POST |

### Updating the WorkTrace URL / Token

When your OpenShift cluster is redeployed, edit the two constants at the top of [`scripts/Sync-OutlookToWorkTrace.py`](../scripts/Sync-OutlookToWorkTrace.py):

```python
WORKTRACE_URL   = "https://NEW-CLUSTER-URL.techzone.ibm.com"
WORKTRACE_TOKEN = "NEW-JWT-TOKEN"
```

The JWT is the same long-lived token in `~/.bob/settings/mcp.json` → `WORKTRACE_TOKEN`. It expires in 2033.

### macOS Troubleshooting

| Symptom | Fix |
|---|---|
| `ModuleNotFoundError: No module named 'EventKit'` | `pip install pyobjc-framework-EventKit` |
| Calendar access denied | System Settings → Privacy & Security → Calendars → enable Terminal (or Python) |
| 0 events fetched | Open Calendar.app and confirm Outlook events appear there. Check `--list-calendars`. |
| Outlook events not in Calendar.app | Outlook → Preferences → Sync → enable macOS Calendar sync |
| `HTTP 401` | Token expired or URL changed — update the constants in the script |

---

## Windows Setup

### How it works

Uses the **Outlook COM object model** — the same interface used by VBA macros — to read calendar events directly from the running Outlook process. No network calls to Microsoft.

```
Outlook for Windows (running)
        │
  COM automation (in-process)
        │
  PowerShell script
        │
  in-memory ICS string
        │
  POST /api/ttt/import/ics
        │
     WorkTrace
```

### Prerequisites

- PowerShell 5.1+ (built into every Windows 10/11 machine)
- Outlook for Windows (classic or new) installed with your profile configured

### Run

```powershell
# Dry-run
.\scripts\Sync-OutlookToWorkTrace.ps1 -DaysBack 3 -WhatIf

# Normal run
.\scripts\Sync-OutlookToWorkTrace.ps1 -DaysBack 7

# First-time backfill
.\scripts\Sync-OutlookToWorkTrace.ps1 -DaysBack 30
```

If you get an execution policy error:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### Schedule with Task Scheduler

Edit `scripts/WorkTraceSync-TaskScheduler.xml` — replace both occurrences of `YOUR_WINDOWS_USERNAME` with your Windows username (`whoami`), then:

```cmd
schtasks /Create /XML "scripts\WorkTraceSync-TaskScheduler.xml" /TN "WorkTrace\OutlookSync"
```

### Windows Troubleshooting

| Symptom | Fix |
|---|---|
| `Could not connect to Outlook` | Outlook must be installed and open at least once |
| `0 events found` | Try `-DaysBack 14`, check your calendar has events |
| `HTTP 401` | Update `$WorkTraceUrl` and `$Token` defaults in the script |
| Execution policy error | `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` |

---

## Common to both platforms

- **Duplicates are safe** — the WorkTrace backend uses `ON CONFLICT DO NOTHING`, so re-running never creates duplicates
- **Declined meetings are skipped** automatically
- **All events go through the same classifier** as ICS file imports — project codes and task types are auto-detected from the event title

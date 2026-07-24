#!/bin/bash
# WorkTrace Calendar Sync Launcher
# Called by launchd — uses osascript to run the Python script inside a
# GUI AppleScript context, which satisfies macOS TCC for Calendar access.

# Update PYTHON to match your Python installation if needed
PYTHON="/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"
SCRIPT="$HOME/WorkTrace/scripts/Sync-OutlookToWorkTrace.py"
LOG="$HOME/Library/Logs/WorkTraceSync.log"

osascript - <<EOF
do shell script "$PYTHON $SCRIPT --days-back 7 --calendar-filter Calendar >> $LOG 2>&1"
EOF

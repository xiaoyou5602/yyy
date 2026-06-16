' Auto-start guardian at login
' cloudflared is managed by Windows Service — no need to start it here
' Called from Startup folder shortcut
' No console window, runs silently

Set WShell = CreateObject("WScript.Shell")

scriptDir = WShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\withtoge\scripts"

' 1. Kill zombies first (synchronous, short timeout)
WShell.Run "powershell -ExecutionPolicy Bypass -File """ & scriptDir & "\kill-zombies.ps1""", 0, True

' 2. Start guardian (monitors port 9726, restarts cyberboss if needed)
WShell.Run "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDir & "\start-guardian.ps1""", 0, False

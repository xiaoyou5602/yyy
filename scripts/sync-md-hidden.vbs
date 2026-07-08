' Wrapper for sync-md.ps1's scheduled task.
' PowerShell's own -WindowStyle Hidden only hides the PowerShell window itself -
' it does nothing for the git/ssh child processes the script spawns, which is
' why a console kept flashing every 30 min. WShell.Run(...,0,True) launches the
' whole process tree with no console from the start, so children stay hidden too.
' -Hidden tells the script itself to also hide its own console window handle,
' as a second line of defense; it's gated behind this flag so running the
' script by hand elsewhere still shows output normally.

Set WShell = CreateObject("WScript.Shell")
scriptDir = WShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\withtoge\scripts"
WShell.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & scriptDir & "\sync-md.ps1"" -Hidden", 0, True

' Wrapper for sync-diary.ps1's scheduled task. Same reasoning as
' sync-md-hidden.vbs: PowerShell's own -WindowStyle Hidden doesn't reliably
' hide git/ssh child process consoles, so we launch the whole process tree
' with no console from the start, and -Hidden tells the script to also hide
' its own window handle as a second line of defense.

Set WShell = CreateObject("WScript.Shell")
scriptDir = WShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\withtoge\scripts"
WShell.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & scriptDir & "\sync-diary.ps1"" -Hidden", 0, True

' Auto-start guardian + cloudflared at login
' Called from Startup folder shortcut
' No console window, runs silently

Set WShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

scriptDir = WShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\withtoge\scripts"

' 1. Kill zombies first (synchronous, short timeout)
WShell.Run "powershell -ExecutionPolicy Bypass -File """ & scriptDir & "\kill-zombies.ps1""", 0, True

' 2. Start cloudflared tunnel immediately
cloudflaredExe = WShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\withtoge\bin\cloudflared.exe"
cloudflaredConfig = WShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.cloudflared\config.yml"
If FSO.FileExists(cloudflaredExe) And FSO.FileExists(cloudflaredConfig) Then
    WShell.Run """" & cloudflaredExe & """ tunnel --config """ & cloudflaredConfig & """ run", 0, False
End If

' 3. Start guardian (this handles cyberboss + cloudflared monitoring)
WShell.Run "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDir & "\start-guardian.ps1""", 0, False

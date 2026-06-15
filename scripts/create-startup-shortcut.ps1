$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Cyberboss.lnk")
$sc.TargetPath = "C:\Users\youzi\withtoge\start-cyberboss.bat"
$sc.WorkingDirectory = "C:\Users\youzi\withtoge"
$sc.WindowStyle = 7
$sc.Save()
Write-Host "done"

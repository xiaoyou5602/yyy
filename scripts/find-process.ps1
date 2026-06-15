$processes = Get-WmiObject Win32_Process -Filter "Name='node.exe'"
foreach ($p in $processes) {
  $cmd = $p.CommandLine
  if ($cmd -like "*cyberboss*") {
    Write-Host "PID: $($p.ProcessId) CMD: $cmd"
  }
}

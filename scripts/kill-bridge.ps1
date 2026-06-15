function Stop-ProcessTree {
    param([int]$PidToKill)
    if ($PidToKill -le 0) { return }
    Write-Host "Killing process tree: PID $PidToKill"
    & taskkill.exe /F /T /PID $PidToKill 2>$null | Out-Host
}

# Kill cyberboss node processes (the bridge itself), but do not kill unrelated node processes.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -like "*cyberboss*"
} | ForEach-Object {
    Write-Host "Killing cyberboss: PID $($_.ProcessId)"
    Stop-ProcessTree -PidToKill ([int]$_.ProcessId)
}

# Kill Claude CLI child processes that were tracked by cyberboss.
# These are cmd.exe windows spawned as `claude --resume ...` etc.
$pidFile = "$env:USERPROFILE\.cyberboss\claude-child-pids.txt"
if (Test-Path $pidFile) {
    $pids = Get-Content $pidFile | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ }
    foreach ($pid in $pids) {
        Stop-ProcessTree -PidToKill $pid
    }
    Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
    Write-Host "Cleaned up claude-child-pids.txt"
}

# Clean up stale socket files that cause EACCES on restart
$sockPath = "$env:USERPROFILE\.cyberboss\claudecode-runtime.sock"
$tokenPath = "$env:USERPROFILE\.cyberboss\claudecode-runtime.sock.token"
if (Test-Path $sockPath) {
  Remove-Item -Force $sockPath
  Write-Host "Removed stale socket: $sockPath"
}
if (Test-Path $tokenPath) {
  Remove-Item -Force $tokenPath
  Write-Host "Removed stale token: $tokenPath"
}

# Cyberboss auto-restart guardian
# Keeps the server alive. If it crashes repeatedly, restart with backoff.
# Usage: powershell -ExecutionPolicy Bypass -File start-guardian.ps1

$guardianPidFile = "$env:USERPROFILE\.cyberboss\logs\guardian.pid"
$guardianPidDir = Split-Path $guardianPidFile -Parent
if (-not (Test-Path $guardianPidDir)) { New-Item -ItemType Directory -Force -Path $guardianPidDir | Out-Null }
if (Test-Path $guardianPidFile) {
    $existingPid = [int](Get-Content $guardianPidFile -Raw).Trim()
    if ($existingPid -gt 0) {
        try {
            $existingProc = Get-Process -Id $existingPid -ErrorAction Stop
            Write-Host "[guardian] Another guardian is already running (PID $existingPid). Exiting."
            exit 1
        } catch {
            Write-Host "[guardian] Stale guardian PID file found (PID $existingPid is dead). Taking over."
        }
    }
}
$currentPid = $pid
Set-Content -Path $guardianPidFile -Value "$currentPid" -NoNewline

$killZombiesScript = Join-Path $PSScriptRoot "kill-zombies.ps1"
$cyberbossPidFile = "$env:USERPROFILE\.cyberboss\logs\running.pid"
$restartCount = 0
$crashWindow = 300  # 5 minutes
$maxDelay = 60
$restartHistory = @()

# cloudflared is now managed by Windows Service — not by this guardian

# Check if port 9726 is already listening
function Test-CyberbossAlive {
    $alive = $false
    try {
        $conn = (Get-NetTCPConnection -LocalPort 9726 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" })
        if ($conn) { $alive = $true }
    } catch {}
    return $alive
}

while ($true) {
    # If cyberboss is already alive (e.g. from previous run), just watch it
    if (Test-CyberbossAlive) {
        Write-Host "[guardian] cyberboss is already running on port 9726. Watching..."
        $zombieCheckTicks = 0
        while (Test-CyberbossAlive) {
            Start-Sleep -Seconds 10
            $zombieCheckTicks++
            # Run zombie cleanup every 10 minutes (60 ticks × 10s)
            if ($zombieCheckTicks -ge 60) {
                $zombieCheckTicks = 0
                if (Test-Path $killZombiesScript) {
                    & powershell -ExecutionPolicy Bypass -File $killZombiesScript 2>&1 | ForEach-Object { Write-Host "[zombie-killer] $_" }
                }
            }
        }
        Write-Host "[guardian] cyberboss died. Restarting..."
    }

    # Clear stale sockets before each start
    $sockPath = "$env:USERPROFILE\.cyberboss\claudecode-runtime.sock"
    $tokenPath = "$env:USERPROFILE\.cyberboss\claudecode-runtime.sock.token"
    if (Test-Path $sockPath) { Remove-Item -Force -ErrorAction SilentlyContinue $sockPath }
    if (Test-Path $tokenPath) { Remove-Item -Force -ErrorAction SilentlyContinue $tokenPath }

    # Clear stale cyberboss PID file
    if (Test-Path $cyberbossPidFile) { Remove-Item -Force -ErrorAction SilentlyContinue $cyberbossPidFile }

    # Kill known MCP zombie processes before each start
    if (Test-Path $killZombiesScript) {
        Write-Host "[guardian] Running zombie cleanup..."
        & powershell -ExecutionPolicy Bypass -File $killZombiesScript 2>&1 | ForEach-Object { Write-Host "[zombie-killer] $_" }
    }

    # Back off if restarts cluster inside the crash window
    $now = Get-Date
    $restartHistory = @($restartHistory | Where-Object { ($now - $_).TotalSeconds -lt $crashWindow })
    $restartHistory += $now

    if ($restartHistory.Count -ge 8) {
        $delay = 60
    } elseif ($restartHistory.Count -ge 5) {
        $delay = 30
    } elseif ($restartHistory.Count -ge 3) {
        $delay = 15
    } else {
        $delay = 5
    }

    Write-Host "[guardian] Starting cyberboss... (restart #$restartCount, recent crashes=$($restartHistory.Count))"
    $startedAt = Get-Date
    $process = Start-Process -FilePath "node" -ArgumentList "./bin/cyberboss.js start" -PassThru -NoNewWindow -Wait

    $exitCode = $process.ExitCode
    $runtimeSeconds = [Math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)

    # If it ran for > 10 min, reset crash history (it was a good run)
    if ($runtimeSeconds -gt 600) {
        $restartHistory = @()
        $restartCount = 0
        Write-Host "[guardian] Good run (${runtimeSeconds}s). Reset crash counters."
    } else {
        $restartCount++
    }

    Write-Host "[guardian] Process exited with code $exitCode after ${runtimeSeconds}s. Waiting ${delay}s..."
    Start-Sleep -Seconds $delay
}

# Clean up PID lock on exit
if (Test-Path $guardianPidFile) {
    $savedPid = [int](Get-Content $guardianPidFile -Raw).Trim()
    if ($savedPid -eq $currentPid) {
        Remove-Item -Force -ErrorAction SilentlyContinue $guardianPidFile
    }
}

# Cyberboss auto-restart guardian
# Keeps cyberboss + cloudflared alive with self-healing.
# Usage: powershell -ExecutionPolicy Bypass -File start-guardian.ps1

$ErrorActionPreference = "Continue"

# ── Paths ──
$logsDir = "$env:USERPROFILE\.cyberboss\logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Force -Path $logsDir | Out-Null }
$guardianStateFile = Join-Path $logsDir "guardian-state.json"
$cfPidFile = Join-Path $logsDir "cloudflared.pid.json"
$killZombiesScript = Join-Path $PSScriptRoot "kill-zombies.ps1"
$cfExe = Join-Path $PSScriptRoot "..\bin\cloudflared.exe" -Resolve
$cfConfig = Join-Path $env:USERPROFILE ".cloudflared\config.yml"
$cfLogFile = Join-Path $logsDir "tunnel.log"

# ── Single-instance via PID file with exclusive lock ──
$guardianPidFile = Join-Path $logsDir "guardian.pid"
$guardianLockFile = Join-Path $logsDir "guardian.lock"
try {
    $lockStream = [System.IO.File]::Open($guardianLockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
    Write-Host "[guardian] Cannot acquire lock. Another guardian may be starting. Exiting."
    exit 1
}
# Check for existing live guardian
if (Test-Path $guardianPidFile) {
    try {
        $existingPid = [int](Get-Content $guardianPidFile -Raw).Trim()
        if ($existingPid -gt 0) {
            $existingProc = Get-Process -Id $existingPid -ErrorAction Stop
            if ($existingProc.Name -match "powershell") {
                $lockStream.Close()
                Write-Host "[guardian] Another guardian is already running (PID $existingPid). Exiting."
                exit 1
            }
        }
    } catch {
        Write-Host "[guardian] Stale guardian PID file (PID was $existingPid). Taking over."
    }
}
Set-Content -Path $guardianPidFile -Value "$pid" -NoNewline
Write-Host "[guardian] Guardian started PID=$pid"

# ── Permission self-check ──
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    Write-Host "[guardian] FATAL: Guardian must NOT run as administrator. Cloudflared would inherit elevated permissions, causing future kill failures. Exiting."
    exit 1
}

# ── State persistence helpers ──
function Load-State {
    if (-not (Test-Path $guardianStateFile)) {
        return @{ guardianRestarts = 0; cfRestartsThisHour = @(); lastCfRestartTime = $null; backoffLevel = 0 }
    }
    try {
        $obj = Get-Content $guardianStateFile -Raw | ConvertFrom-Json
        # Convert PSCustomObject → Hashtable (PS5.1-compat, no -AsHashtable)
        $ht = @{}
        $obj.PSObject.Properties | ForEach-Object { $ht[$_.Name] = $_.Value }
        # Ensure cfRestartsThisHour is always an array
        if ($ht.cfRestartsThisHour -isnot [Array]) { $ht.cfRestartsThisHour = @($ht.cfRestartsThisHour) }
        return $ht
    }
    catch { return @{ guardianRestarts = 0; cfRestartsThisHour = @(); lastCfRestartTime = $null; backoffLevel = 0 } }
}

function Save-State($state) {
    $json = $state | ConvertTo-Json -Compress
    Set-Content -Path $guardianStateFile -Value $json -NoNewline
}

$state = Load-State

# ── Health check ──
function Test-CyberbossLocal {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:9726/healthz" -Method Head -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

function Test-TunnelEndToEnd {
    try {
        $ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
        $r = Invoke-WebRequest -Uri "https://克.withtoge.us/healthz?t=$ts" -Method Head -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

function Test-CloudflaredProcessAlive {
    $procs = @(Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue)
    $count = $procs.Count
    if ($count -gt 1) {
        Write-Host "[guardian] WARNING: $count cloudflared processes detected (expected 1) — possible pile-up"
    }
    return ($count -gt 0)
}

function Test-CloudflaredHealthy {
    # Layer 1: Is cyberboss alive locally?
    $cyberbossOk = Test-CyberbossLocal

    # Layer 2: Is the tunnel end-to-end healthy?
    $tunnelOk = Test-TunnelEndToEnd

    if ($cyberbossOk -and $tunnelOk) { return "all_ok" }
    if (-not $cyberbossOk) { return "cyberboss_down" }
    if (-not $tunnelOk) { return "tunnel_down" }
    return "unknown"
}

# ── Cloudflared lifecycle ──
function Stop-CloudflaredByPidFile {
    if (-not (Test-Path $cfPidFile)) { return }
    try {
        $data = Get-Content $cfPidFile -Raw | ConvertFrom-Json
        $oldPid = [int]$data.pid
        $oldStartTimeStr = $data.startTime
        if ($oldPid -gt 0) {
            $proc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
            if ($proc -and $proc.Name -eq "cloudflared" -and $proc.StartTime.ToString("o") -eq $oldStartTimeStr) {
                Write-Host "[guardian] Stopping tracked cloudflared PID=$oldPid"
                $proc | Stop-Process -Force -ErrorAction SilentlyContinue
                $proc.WaitForExit(5000)
            }
        }
    } catch {}
    Remove-Item -Force -ErrorAction SilentlyContinue $cfPidFile
}

function Start-Cloudflared {
    if (-not (Test-Path $cfExe)) {
        Write-Host "[guardian] cloudflared.exe not found at $cfExe"
        return
    }
    # Kill previously tracked instance if still alive
    Stop-CloudflaredByPidFile

    Write-Host "[guardian] Starting cloudflared tunnel..."
    $cfArgs = "--config `"$cfConfig`" --logfile `"$cfLogFile`" --loglevel info tunnel run ke-tunnel"
    $proc = Start-Process -FilePath $cfExe -ArgumentList $cfArgs -WindowStyle Hidden -PassThru
    if ($proc -and $proc.Id) {
        $cfState = @{ pid = [int]$proc.Id; startTime = $proc.StartTime.ToString("o") }
        Set-Content -Path $cfPidFile -Value ($cfState | ConvertTo-Json -Compress) -NoNewline
        Write-Host "[guardian] cloudflared started PID=$($proc.Id) StartTime=$($proc.StartTime)"
    }
}

# ── Backoff ──
$backoffTimes = @(5, 15, 30, 60)
$maxRestartsPerHour = 10

function Get-BackoffDelay {
    $level = [Math]::Min($state.backoffLevel, $backoffTimes.Count - 1)
    return $backoffTimes[$level]
}

function Reset-BackoffIfStable {
    $last = $state.lastCfRestartTime
    if ($last) {
        $elapsed = [DateTime]::Now - [DateTime]$last
        if ($elapsed.TotalHours -gt 1) {
            $state.backoffLevel = 0
            $state.cfRestartsThisHour = @()
        }
    }
}

function Can-RestartCloudflared {
    # Prune old restart timestamps
    $oneHourAgo = [DateTime]::Now.AddHours(-1)
    $state.cfRestartsThisHour = @($state.cfRestartsThisHour | Where-Object { [DateTime]$_ -gt $oneHourAgo })

    if ($state.cfRestartsThisHour.Count -ge $maxRestartsPerHour) {
        Write-Host "[guardian] CRITICAL: $maxRestartsPerHour cloudflared restarts in past hour. Circuit breaker tripped — no more auto-restarts."
        return $false
    }
    return $true
}

function Record-CloudflaredRestart($exitCode) {
    $state.cfRestartsThisHour += @([DateTime]::Now.ToString("o"))
    $state.lastCfRestartTime = [DateTime]::Now.ToString("o")
    $state.backoffLevel = [Math]::Min($state.backoffLevel + 1, $backoffTimes.Count - 1)

    if ($exitCode -ne 0) {
        Write-Host "[guardian] cloudflared exit code=$exitCode (0x$('{0:X}' -f $exitCode))"
    }

    Save-State $state
}

# ── Crash snapshot ──
function Record-TunnelSnapshot($reason) {
    $snapFile = Join-Path $logsDir "tunnel_crash_snapshots.log"
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $cfProcs = @(Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue)
    $pids = if ($cfProcs) { ($cfProcs | ForEach-Object { $_.Id }) -join "," } else { "None" }
    $ncResult = ""
    try { $ncResult = Test-NetConnection -ComputerName "克.withtoge.us" -Port 443 -ErrorAction SilentlyContinue | Out-String } catch {}

    $snap = @"
==================================================
[SNAPSHOT] $ts
Reason: $reason
cloudflared process count: $($cfProcs.Count)
PIDs: $pids
guardianRestarts: $($state.guardianRestarts)
cfRestartsThisHour: $($state.cfRestartsThisHour.Count)
backoffLevel: $($state.backoffLevel)
--- Test-NetConnection ---
$ncResult
==================================================
"@
    Add-Content -Path $snapFile -Value $snap
}

# ── Main loop ──
$zombieCheckTicks = 0
$healthCheckTicks = 0
$consecutiveTunnelFailures = 0

# ── Startup self-test — catch contract mismatches before they become silent failures ──
Write-Host "[guardian] Running startup self-tests..."
$selfTests = @{
    "cyberboss HEAD /healthz" = { Test-CyberbossLocal }
    "tunnel HEAD /healthz"    = { Test-TunnelEndToEnd }
    "Test-CloudflaredHealthy" = { (Test-CloudflaredHealthy) -in @("all_ok","cyberboss_down","tunnel_down") }
}
foreach ($testName in $selfTests.Keys) {
    try { $testOk = & $selfTests[$testName] } catch { $testOk = $false }
    Write-Host "[selftest] $testName => $testOk"
}

Write-Host "[guardian] Starting main watch loop..."

while ($true) {
    # ── Cloudflared ──
    if (-not (Test-CloudflaredProcessAlive)) {
        Write-Host "[guardian] cloudflared not running. Starting..."
        Start-Cloudflared
    }

    # ── Check if cyberboss is alive (warm start: already running) ──
    if (Test-CyberbossLocal) {
        Write-Host "[guardian] cyberboss is already running on port 9726. Watching..."
        while ($true) {
            Start-Sleep -Seconds 10
            $zombieCheckTicks++
            $healthCheckTicks++

            # Zombie cleanup every 10 minutes
            if ($zombieCheckTicks -ge 60) {
                $zombieCheckTicks = 0
                if (Test-Path $killZombiesScript) {
                    & powershell -ExecutionPolicy Bypass -File $killZombiesScript 2>&1 | ForEach-Object { Write-Host "[zombie-killer] $_" }
                }
            }

            # Cloudflared alive check
            if (-not (Test-CloudflaredProcessAlive)) {
                Write-Host "[guardian] cloudflared died during watch. Restarting..."
                if (Can-RestartCloudflared) {
                    Start-Cloudflared
                    Record-CloudflaredRestart $null
                }
            }

            # Tunnel end-to-end health check every 30s
            if ($healthCheckTicks -ge 3) {
                $healthCheckTicks = 0
                Reset-BackoffIfStable
                if (-not (Test-TunnelEndToEnd)) {
                    $consecutiveTunnelFailures++
                    Write-Host "[guardian] tunnel end-to-end failed ($consecutiveTunnelFailures/3)"
                    if ($consecutiveTunnelFailures -ge 3) {
                        Write-Host "[guardian] Restarting cloudflared (tunnel dead)..."
                        if (Can-RestartCloudflared) {
                            Record-TunnelSnapshot "tunnel end-to-end failed 3x"
                            $delay = Get-BackoffDelay
                            Write-Host "[guardian] backoff: ${delay}s (level=$($state.backoffLevel))"
                            Start-Sleep -Seconds $delay
                            Stop-CloudflaredByPidFile
                            Start-Cloudflared
                            Record-CloudflaredRestart 0
                            $consecutiveTunnelFailures = 0
                        } else {
                            Write-Host "[guardian] Circuit breaker active. Skip cloudflared restart."
                            $consecutiveTunnelFailures = 0
                        }
                    }
                } else {
                    $consecutiveTunnelFailures = 0
                }
            }

            # Check if cyberboss died
            if (-not (Test-CyberbossLocal)) {
                Write-Host "[guardian] cyberboss died. Breaking watch to restart..."
                break
            }
        }
    }

    # ── Cyberboss cold start / restart ──
    $sockPath = "$env:USERPROFILE\.cyberboss\claudecode-runtime.sock"
    $tokenPath = "$env:USERPROFILE\.cyberboss\claudecode-runtime.sock.token"
    Remove-Item -Force -ErrorAction SilentlyContinue $sockPath, $tokenPath

    if (Test-Path $killZombiesScript) {
        Write-Host "[guardian] Running zombie cleanup before start..."
        & powershell -ExecutionPolicy Bypass -File $killZombiesScript 2>&1 | ForEach-Object { Write-Host "[zombie-killer] $_" }
    }

    Write-Host "[guardian] Starting cyberboss..."
    $state.guardianRestarts++
    Save-State $state

    $startedAt = Get-Date
    $proc = Start-Process -FilePath "node" -ArgumentList "./bin/cyberboss.js start" -NoNewWindow -Wait -PassThru
    $exitCode = $proc.ExitCode
    $runtime = [Math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)

    Write-Host "[guardian] cyberboss exited code=$exitCode after ${runtime}s"

    if ($runtime -gt 600) {
        Write-Host "[guardian] Good run (${runtime}s). Reset backoff."
        $state.backoffLevel = 0
        $state.cfRestartsThisHour = @()
        Save-State $state
    }
}

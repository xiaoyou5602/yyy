# Safe zombie killer — won't touch main service, guardian, or current session
$ErrorActionPreference = "SilentlyContinue"

# 1. Find the main cyberboss service and guardian — NEVER kill these
$keepPids = @{}
$allNode = Get-Process node -ErrorAction SilentlyContinue

foreach ($p in $allNode) {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)").CommandLine
    } catch { continue }

    # Keep: main service (bin/cyberboss.js start)
    if ($cmd -match "bin[/\\]cyberboss\.js\s+start\b") {
        $keepPids[$p.Id] = "main-service"
        continue
    }
    # Keep: guardian (npm run safe — may appear as "npm-cli.js run safe" or "npm run safe")
    if (($cmd -match "\bnpm\b.*\brun\s+safe\b" -or $cmd -match "npm-cli\.js.*run\s+safe") -and $cmd -notmatch "npx") {
        $keepPids[$p.Id] = "guardian"
        continue
    }
}

# 2. Kill ONLY stale processes (started > 2 hours ago AND not marked keep)
$cutoff = (Get-Date).AddHours(-2)
$killed = 0

foreach ($p in $allNode) {
    if ($keepPids.ContainsKey($p.Id)) { continue }
    if ($p.StartTime -gt $cutoff) { continue }

    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)").CommandLine
    } catch { $cmd = "" }

    # Only kill known zombie patterns
    $isZombie = ($cmd -match "_npx[/\\]" -and ($cmd -match "mcp-datetime|mcpbrowser")) -or
                ($cmd -match "tool-mcp-server" -and $cmd -notmatch $env:USERPROFILE) -or
                ($cmd -match "npx-cli\.js.*mcp-")

    if ($isZombie) {
        taskkill /F /T /PID $p.Id 2>$null
        Write-Host "Killed zombie PID $($p.Id) (+tree) — started $($p.StartTime)"
        $killed++
    }
}

$left = (Get-Process node -ErrorAction SilentlyContinue).Count
Write-Host "Killed: $killed | Remaining: $left | Protected: $($keepPids.Count) ($($keepPids.Values -join ', '))"

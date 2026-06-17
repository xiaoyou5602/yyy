# Safe zombie killer — won't touch main service, guardian, or current session
$ErrorActionPreference = "SilentlyContinue"

# 1. Find the main cyberboss service and guardian — NEVER kill these
$keepPids = @{}
$cyberbossPid = 0
$allNode = Get-Process node -ErrorAction SilentlyContinue

foreach ($p in $allNode) {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)").CommandLine
    } catch { continue }

    # Keep: main service (bin/cyberboss.js start)
    if ($cmd -match "bin[/\\]cyberboss\.js\s+start\b") {
        $keepPids[$p.Id] = "main-service"
        $cyberbossPid = $p.Id
        continue
    }
    # Keep: guardian (npm start or npm run safe)
    if (($cmd -match "\bnpm\b.*\bstart\b" -or $cmd -match "\bnpm\b.*\brun\s+safe\b" -or $cmd -match "npm-cli\.js.*run\s+safe" -or $cmd -match "npm-cli\.js.*\bstart\b") -and $cmd -notmatch "npx") {
        $keepPids[$p.Id] = "guardian"
        continue
    }
}

# Helper: trace process ancestry up to N levels, check if any ancestor is protected
function IsChildOfProtected($pid, $protectedPids, $maxDepth = 8) {
    $current = $pid
    for ($i = 0; $i -lt $maxDepth; $i++) {
        if ($protectedPids.ContainsKey($current)) { return $true }
        try {
            $current = (Get-CimInstance Win32_Process -Filter "ProcessId = $current").ParentProcessId
        } catch { return $false }
        if ($current -eq 0) { return $false }
    }
    return $false
}

# 2. Kill ALL known zombie patterns (no age limit — MCP servers spawn fast)
$killed = 0
$allProtected = $keepPids.Clone()

foreach ($p in $allNode) {
    if ($keepPids.ContainsKey($p.Id)) { continue }

    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)").CommandLine
    } catch { $cmd = "" }

    # MCP servers from _npx cache — zombies if not traceable to a protected process
    $isNpxMcp = ($cmd -match "_npx[/\\]" -and ($cmd -match "mcp-datetime|mcpbrowser")) -or
                ($cmd -match "npx-cli\.js.*\b(mcp-datetime|mcpbrowser|mcp-)") -or
                ($cmd -match "\bnpx\b.*\b(mcp-datetime|mcpbrowser|mcp-)\b")

    # Cyberboss's own MCP servers — zombies if not traceable to a protected process
    $isCyberbossMcp = ($cmd -match "tool-mcp-server") -or
                      ($cmd -match "native-devtools-mcp") -or
                      ($cmd -match "gtd-tasks.*todo-mcp-server")

    $shouldKill = $false

    if ($isNpxMcp -or $isCyberbossMcp) {
        if (-not (IsChildOfProtected $p.Id $keepPids)) {
            $shouldKill = $true
        }
    }

    if ($shouldKill) {
        taskkill /F /T /PID $p.Id 2>$null
        Write-Host "Killed zombie PID $($p.Id) (+tree) — started $($p.StartTime)"
        $killed++
    }
}

$left = (Get-Process node -ErrorAction SilentlyContinue).Count
Write-Host "Killed: $killed | Remaining: $left | Protected: $($keepPids.Count) ($($keepPids.Values -join ', '))"
if ($cyberbossPid -gt 0) { Write-Host "Main service: PID $cyberbossPid" }

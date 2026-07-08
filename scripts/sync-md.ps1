# withtoge md sync: local CLAUDE.md/WITHTOGE.md <-> git repo <-> VPS
# Usage: powershell -ExecutionPolicy Bypass -File scripts\sync-md.ps1
#        Add -Hidden when launched from the scheduled task so it hides its
#        own console; omit it when running by hand so output stays visible.
# Design: every change is committed BEFORE any merge/overwrite happens,
# so nothing can be silently lost. If ~/CLAUDE.md is a symlink (needs admin
# mklink), the copy steps become no-ops automatically.
# NOTE: ASCII only - PowerShell 5.1 misparses UTF-8 without BOM.
param([switch]$Hidden)

# Hide this console window, but only when explicitly launched as a
# background task (-Hidden). Relying on the caller (wscript / task
# scheduler) to pass a hidden window style is not reliable - git/ssh child
# processes can still end up flashing their own visible console, so we hide
# our own window handle directly. Gated behind -Hidden so running this by
# hand in an existing terminal doesn't yank that terminal out from under you.
if ($Hidden) {
    Add-Type -Name Window -Namespace ConsoleHide -MemberDefinition '
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    ' | Out-Null
    $hwnd = [ConsoleHide.Window]::GetConsoleWindow()
    if ($hwnd -ne [IntPtr]::Zero) { [ConsoleHide.Window]::ShowWindow($hwnd, 0) | Out-Null }
}

$repo   = "C:\Users\youzi\withtoge"
$homeMd = "C:\Users\youzi\CLAUDE.md"
$repoMd = Join-Path $repo "CLAUDE.md"

Set-Location $repo

$homeIsLink = (Get-Item $homeMd -ErrorAction SilentlyContinue).LinkType
$baseFile = Join-Path $repo ".claude-md-last-sync-hash"

# 1. If ~/CLAUDE.md (non-link) has changes of its own, pull them into the repo.
#    Baseline hash (recorded at last write-back) tells "home edited" apart from
#    "home merely behind the repo" - only the former needs collecting.
if ((Test-Path $homeMd) -and -not $homeIsLink) {
    $hHash = (Get-FileHash $homeMd).Hash
    $rHash = (Get-FileHash $repoMd).Hash
    $base  = if (Test-Path $baseFile) { Get-Content $baseFile -TotalCount 1 } else { "" }
    if ($hHash -ne $rHash) {
        if ($hHash -eq $base) {
            # home untouched since last write-back, repo moved ahead: nothing to collect
        } elseif ($base -eq "" -or (Get-Item $homeMd).LastWriteTime -gt (Get-Item $repoMd).LastWriteTime) {
            Copy-Item $homeMd $repoMd -Force
            Write-Output "[sync-md] home CLAUDE.md edited, copied into repo"
        } else {
            # both sides changed since baseline: keep a backup, repo wins for now
            Copy-Item $homeMd "$homeMd.local-conflict" -Force
            Write-Output "[sync-md] WARN both sides changed; home version saved as CLAUDE.md.local-conflict"
        }
    }
}

# 2. Commit md changes in the repo
git add CLAUDE.md WITHTOGE.md
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m "auto(local): md sync commit" }

# 3. Pull with rebase (keeps local commits on top); autostash protects
#    unrelated uncommitted changes in the worktree during the rebase
git pull --rebase --autostash vps master
if ($LASTEXITCODE -ne 0) {
    git rebase --abort
    Write-Output "[sync-md] WARN merge conflict, aborted. Ask Ke to run: git pull --rebase vps master"
    exit 1
}

# 4. Push back to VPS (hook mirrors to GitHub)
git push vps master

# 5. Write merged result back to ~/CLAUDE.md (skip in symlink mode),
#    and record the baseline hash for next run's edited-vs-behind check
if (-not $homeIsLink) {
    Copy-Item $repoMd $homeMd -Force
    (Get-FileHash $homeMd).Hash | Set-Content $baseFile -Encoding ascii
}

Write-Output "[sync-md] done $(Get-Date -Format 'HH:mm:ss')"

# withtoge md sync: local CLAUDE.md/WITHTOGE.md <-> git repo <-> VPS
# Usage: powershell -ExecutionPolicy Bypass -File scripts\sync-md.ps1
# Design: every change is committed BEFORE any merge/overwrite happens,
# so nothing can be silently lost. If ~/CLAUDE.md is a symlink (needs admin
# mklink), the copy steps become no-ops automatically.
# NOTE: ASCII only - PowerShell 5.1 misparses UTF-8 without BOM.
$repo   = "C:\Users\youzi\withtoge"
$homeMd = "C:\Users\youzi\CLAUDE.md"
$repoMd = Join-Path $repo "CLAUDE.md"

Set-Location $repo

$homeIsLink = (Get-Item $homeMd -ErrorAction SilentlyContinue).LinkType

# 1. If ~/CLAUDE.md (non-link) differs and is newer, pull it into the repo
if ((Test-Path $homeMd) -and -not $homeIsLink) {
    $hHash = (Get-FileHash $homeMd).Hash
    $rHash = (Get-FileHash $repoMd).Hash
    if ($hHash -ne $rHash) {
        $hTime = (Get-Item $homeMd).LastWriteTime
        $rTime = (Get-Item $repoMd).LastWriteTime
        if ($hTime -gt $rTime) {
            Copy-Item $homeMd $repoMd -Force
            Write-Output "[sync-md] home CLAUDE.md is newer, copied into repo"
        } else {
            # both changed and repo is newer: keep a backup, repo wins for now
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

# 5. Write merged result back to ~/CLAUDE.md (skip in symlink mode)
if (-not $homeIsLink) { Copy-Item $repoMd $homeMd -Force }

Write-Output "[sync-md] done $(Get-Date -Format 'HH:mm:ss')"

# withtoge diary sync: ~/.cyberboss/diary (git worktree) <-> VPS /root/diary.git
# Usage: powershell -ExecutionPolicy Bypass -File scripts\sync-diary.ps1
# The diary dir IS the git worktree (unlike CLAUDE.md's copy dance), so this is
# just commit -> pull --rebase -> push. VPS post-receive hook rebases the VPS
# worktree; VPS-side writes are pushed by the diary-autosync systemd service.
# NOTE: ASCII only - PowerShell 5.1 misparses UTF-8 without BOM.
$diary = "C:\Users\youzi\.cyberboss\diary"

Set-Location $diary

# 1. Commit any local changes first, so nothing can be lost by the rebase
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m "auto(local): diary sync commit" }

# 2. Pull with rebase (local commits stay on top)
git pull --rebase --autostash origin master
if ($LASTEXITCODE -ne 0) {
    git rebase --abort
    Write-Output "[sync-diary] WARN merge conflict, aborted. Ask Ke to run: git pull --rebase origin master"
    exit 1
}

# 3. Push back to VPS
git push origin master

Write-Output "[sync-diary] done $(Get-Date -Format 'HH:mm:ss')"

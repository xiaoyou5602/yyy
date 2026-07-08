# withtoge diary sync: ~/.cyberboss/diary (git worktree) <-> VPS /root/diary.git
# Usage: powershell -ExecutionPolicy Bypass -File scripts\sync-diary.ps1
#        Add -Hidden when launched from the scheduled task so it hides its
#        own console; omit it when running by hand so output stays visible.
# The diary dir IS the git worktree (unlike CLAUDE.md's copy dance), so this is
# just commit -> pull --rebase -> push. VPS post-receive hook rebases the VPS
# worktree; VPS-side writes are pushed by the diary-autosync systemd service.
# NOTE: ASCII only - PowerShell 5.1 misparses UTF-8 without BOM.
param([switch]$Hidden)

# Hide this console window, but only when explicitly launched as a
# background task (-Hidden). See sync-md.ps1 for why: relying on the
# caller to pass a hidden window style is not reliable, so we hide our
# own window handle directly, gated so running this by hand still shows
# output normally.
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

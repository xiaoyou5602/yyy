#!/bin/bash
# 监控仓库里 CLAUDE.md / WITHTOGE.md,变更即 commit + push(裸仓库 + GitHub 镜像)
# 2026-07-03 重写:
# - 旧版只盯 WITHTOGE.md 且只推 GitHub,本地(拉裸仓库)拿不到 → 改为两文件 + push origin
# - 旧版 inotifywait 直接监控文件,git reset/rebase 重写文件后 inode 变化导致监控失效
#   → 改为监控目录,按文件名过滤
# - /root/CLAUDE.md 已是指向仓库文件的软链接,克写它 = 写仓库文件,这里能看到
REPO_DIR="/opt/withtoge"
DEBOUNCE_SEC=5

echo "[auto-sync] watching $REPO_DIR/{CLAUDE.md,WITHTOGE.md}"

inotifywait -m -e close_write,moved_to --format '%f' "$REPO_DIR" 2>/dev/null | while read -r f; do
    case "$f" in
        CLAUDE.md|WITHTOGE.md) ;;
        *) continue ;;
    esac
    sleep "$DEBOUNCE_SEC"
    cd "$REPO_DIR" || continue
    git add CLAUDE.md WITHTOGE.md
    if ! git diff --cached --quiet; then
        git commit -m "auto(vps): md 变更落库"
        git push origin master && echo "[auto-sync] pushed origin"
        git push github master 2>/dev/null || true
    fi
done

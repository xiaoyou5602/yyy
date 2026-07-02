#!/bin/bash
# 监控 WITHTOGE.md 变化，自动 git push

WATCH_FILE="/opt/withtoge/WITHTOGE.md"
REPO_DIR="/opt/withtoge"
DEBOUNCE_SEC=5

echo "[auto-sync] 开始监控 $WATCH_FILE"

inotifywait -m -e modify -e close_write "$WATCH_FILE" 2>/dev/null | while read -r path action file; do
    sleep $DEBOUNCE_SEC
    cd "$REPO_DIR"
    if ! git diff --quiet "$WATCH_FILE"; then
        git add "$WATCH_FILE" && git commit -m "自动同步：WITHTOGE.md 云端变更" && git push github master && echo "[auto-sync] push 完成" 
    fi
done

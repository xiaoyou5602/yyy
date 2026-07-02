#!/bin/bash
# 监控 VPS 上两个关键文件，变更时自动推送到 GitHub
# 这样 IDE 端 git pull 就能拿到最新版本

WATCH_FILES="/root/CLAUDE.md /opt/withtoge/WITHTOGE.md"
REPO="/opt/withtoge"

echo "[watch-sync] 启动，监控: $WATCH_FILES"

inotifywait -m -e modify,close_write,move,create   --format '%w%f'   $WATCH_FILES | while read changed_file
do
  echo "[watch-sync] 检测变更: $changed_file"
  
  # CLAUDE.md 不在仓库里，变更时复制进去
  if [ "$changed_file" = "/root/CLAUDE.md" ]; then
    cp /root/CLAUDE.md "$REPO/CLAUDE.md"
    echo "[watch-sync] 已复制 CLAUDE.md → 仓库"
  fi
  
  cd "$REPO"
  git add -A
  git commit -m "🔄 自动同步: $(basename $changed_file) 变更" 2>/dev/null || true
  git push github master 2>/dev/null && echo "[watch-sync] 已推送 GitHub"
done

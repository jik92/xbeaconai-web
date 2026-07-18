#!/usr/bin/env bash

set -Eeuo pipefail

readonly PROJECT_DIR="/root/build/xbeaconai-web"
readonly WEB_ROOT="/var/www/xbeaconai-web"
readonly NPM_REGISTRY="https://registry.npmmirror.com"
readonly LOCK_FILE="/var/lock/xbeaconai-web-deploy.lock"

log() {
    printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

on_error() {
    log "部署失败（第 ${1} 行），现有线上版本保持不变。"
}

trap 'on_error "$LINENO"' ERR

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    log "已有部署任务正在运行，退出。"
    exit 1
fi

cd "$PROJECT_DIR"

current_branch="$(git branch --show-current)"
if [[ -z "$current_branch" ]]; then
    log "当前处于 detached HEAD，无法安全拉取代码。"
    exit 1
fi

log "拉取 origin/${current_branch} 最新代码..."
git fetch origin "$current_branch"
git merge --ff-only "origin/${current_branch}"

log "使用国内镜像安装依赖..."
bun install --frozen-lockfile --registry="$NPM_REGISTRY"

log "构建生产版本..."
bun run build

log "同步静态文件到 ${WEB_ROOT}..."
install -d -m 0755 "$WEB_ROOT"
rsync -a --delete "$PROJECT_DIR/dist/" "$WEB_ROOT/"
find "$WEB_ROOT" -type d -exec chmod 0755 {} +
find "$WEB_ROOT" -type f -exec chmod 0644 {} +

log "校验并重启 Nginx..."
nginx -t
systemctl restart nginx
systemctl is-active --quiet nginx

log "部署完成：$(git rev-parse --short HEAD)"

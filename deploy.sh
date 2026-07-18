#!/usr/bin/env bash

set -Eeuo pipefail

readonly PROJECT_DIR="/root/build/xbeaconai-web"
readonly WEB_ROOT="/var/www/xbeaconai-web"
readonly DATA_DIR="/var/lib/xbeaconai-web"
readonly ENV_FILE="/etc/xbeaconai-web.env"
readonly SERVICE_NAME="xbeaconai-web-api.service"
readonly SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}"
readonly NGINX_SITE="/etc/nginx/sites-available/xbeaconai-web"
readonly CERTBOT_WEB_ROOT="/var/www/certbot"
readonly CERTIFICATE_PATH="/etc/letsencrypt/live/app.xbeaconai.com/fullchain.pem"
readonly NPM_REGISTRY="https://registry.npmmirror.com"
readonly LOCK_FILE="/var/lock/xbeaconai-web-deploy.lock"
readonly API_HEALTH_URL="http://127.0.0.1:8787/api/health"
readonly APP_ORIGIN="${APP_ORIGIN:-https://app.xbeaconai.com}"
readonly API_ORIGIN="${API_ORIGIN:-https://api.xbeaconai.com}"
readonly DIRECT_ORIGIN="${DIRECT_ORIGIN:-http://118.196.101.57}"

log() {
    printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

on_error() {
    log "部署失败（第 ${1} 行），现有线上版本保持不变。"
}

trap 'on_error "$LINENO"' ERR

upsert_env() {
    local key="$1"
    local value="$2"
    local temporary
    temporary="$(mktemp)"
    awk -v key="$key" -v value="$value" '
        BEGIN { found = 0 }
        $0 ~ "^" key "=" { print key "=" value; found = 1; next }
        { print }
        END { if (!found) print key "=" value }
    ' "$ENV_FILE" >"$temporary"
    install -m 0600 "$temporary" "$ENV_FILE"
    rm -f "$temporary"
}

ensure_runtime_environment() {
    install -d -m 0700 "$DATA_DIR"
    if [[ ! -f "$ENV_FILE" ]]; then
        install -m 0600 /dev/null "$ENV_FILE"
    fi
    if ! grep -q '^JWT_SECRET=.' "$ENV_FILE"; then
        upsert_env "JWT_SECRET" "$(openssl rand -hex 32)"
    fi
    upsert_env "API_HOST" "127.0.0.1"
    upsert_env "API_PORT" "8787"
    upsert_env "YAOZUO_DATA_DIR" "$DATA_DIR"
    upsert_env "ALLOWED_ORIGINS" "${APP_ORIGIN},${API_ORIGIN},${DIRECT_ORIGIN}"
    upsert_env "ALLOW_MOCK_FALLBACK" "true"
}

wait_for_api() {
    local attempt
    for attempt in $(seq 1 30); do
        if curl --fail --silent --show-error "$API_HEALTH_URL" >/dev/null; then
            return 0
        fi
        sleep 1
    done
    log "API 健康检查失败，最近日志如下："
    journalctl -u "$SERVICE_NAME" --no-pager -n 80 >&2
    return 1
}

ensure_tls_certificate() {
    install -d -m 0755 "$CERTBOT_WEB_ROOT"
    if ! command -v certbot >/dev/null 2>&1; then
        log "安装 Certbot..."
        apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y certbot
    fi
    if [[ ! -f "$CERTIFICATE_PATH" ]]; then
        log "安装 HTTP 引导配置以申请 TLS 证书..."
        install -m 0644 "$PROJECT_DIR/deploy/nginx-xbeaconai-web-bootstrap.conf" "$NGINX_SITE"
        ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/xbeaconai-web
        nginx -t
        systemctl reload nginx
    fi
    log "检查 App/API TLS 证书..."
    certbot certonly --webroot --webroot-path "$CERTBOT_WEB_ROOT" \
        --cert-name app.xbeaconai.com \
        --domain app.xbeaconai.com --domain api.xbeaconai.com \
        --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
    install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
    install -m 0755 "$PROJECT_DIR/deploy/certbot-reload-nginx.sh" \
        /etc/letsencrypt/renewal-hooks/deploy/reload-nginx
}

if [[ "${DEPLOY_REEXECUTED:-0}" != "1" ]]; then
    exec 9>"$LOCK_FILE"
    if ! flock -n 9; then
        log "已有部署任务正在运行，退出。"
        exit 1
    fi
fi

cd "$PROJECT_DIR"

current_branch="$(git branch --show-current)"
if [[ -z "$current_branch" ]]; then
    log "当前处于 detached HEAD，无法安全拉取代码。"
    exit 1
fi
starting_revision="$(git rev-parse HEAD)"

log "拉取 origin/${current_branch} 最新代码..."
git fetch origin "$current_branch"
git merge --ff-only "origin/${current_branch}"
updated_revision="$(git rev-parse HEAD)"
if [[ "$updated_revision" != "$starting_revision" && "${DEPLOY_REEXECUTED:-0}" != "1" ]]; then
    log "部署脚本已更新，使用新版本重新执行..."
    exec env DEPLOY_REEXECUTED=1 "$PROJECT_DIR/deploy.sh"
fi

log "使用国内镜像安装依赖..."
bun install --frozen-lockfile --registry="$NPM_REGISTRY"

log "构建生产版本..."
VITE_API_BASE_URL="$API_ORIGIN" bun run build

log "配置并重启 Bun API..."
ensure_runtime_environment
install -m 0644 "$PROJECT_DIR/deploy/xbeaconai-web-api.service" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null
systemctl restart "$SERVICE_NAME"
wait_for_api

log "同步静态文件到 ${WEB_ROOT}..."
install -d -m 0755 "$WEB_ROOT"
rsync -a --delete "$PROJECT_DIR/dist/" "$WEB_ROOT/"
find "$WEB_ROOT" -type d -exec chmod 0755 {} +
find "$WEB_ROOT" -type f -exec chmod 0644 {} +

ensure_tls_certificate

log "配置 HTTPS 双域名和 /api 反向代理..."
install -m 0644 "$PROJECT_DIR/deploy/nginx-xbeaconai-web.conf" "$NGINX_SITE"
ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/xbeaconai-web
nginx -t
systemctl reload nginx
systemctl is-active --quiet nginx

log "验证公网入口..."
curl --fail --silent --show-error -H "Host: 118.196.101.57" http://127.0.0.1/ >/dev/null
curl --fail --silent --show-error -H "Host: 118.196.101.57" -H "Origin: $DIRECT_ORIGIN" \
    http://127.0.0.1/api/health >/dev/null
curl --fail --silent --show-error --resolve app.xbeaconai.com:443:127.0.0.1 \
    https://app.xbeaconai.com/ >/dev/null
curl --fail --silent --show-error --resolve api.xbeaconai.com:443:127.0.0.1 -H "Origin: $APP_ORIGIN" \
    https://api.xbeaconai.com/api/health >/dev/null

log "部署完成：$(git rev-parse --short HEAD)"

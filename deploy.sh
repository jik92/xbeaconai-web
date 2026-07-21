#!/usr/bin/env bash

set -Eeuo pipefail

readonly PROJECT_DIR="/root/build/xbeaconai-web"
readonly WEB_ROOT="/var/www/xbeaconai-web"
readonly DATA_DIR="/var/lib/xbeaconai-web"
readonly ENV_FILE="/etc/xbeaconai-web.env"
readonly API_SERVICE_NAME="xbeaconai-web-api.service"
readonly API_SERVICE_FILE="/etc/systemd/system/${API_SERVICE_NAME}"
readonly WORKER_SERVICE_NAME="xbeaconai-web-worker.service"
readonly WORKER_SERVICE_FILE="/etc/systemd/system/${WORKER_SERVICE_NAME}"
readonly NGINX_SITE="/etc/nginx/sites-available/xbeaconai-web"
readonly CERTBOT_WEB_ROOT="/var/www/certbot"
readonly CERTIFICATE_PATH="/etc/letsencrypt/live/app.xbeaconai.com/fullchain.pem"
readonly NPM_REGISTRY="https://registry.npmmirror.com"
readonly LOCK_FILE="/var/lock/xbeaconai-web-deploy.lock"
readonly API_HEALTH_URL="http://127.0.0.1:8787/api/health"
readonly APP_ORIGIN="${APP_ORIGIN:-https://app.xbeaconai.com}"
readonly API_ORIGIN="${API_ORIGIN:-https://api.xbeaconai.com}"
readonly DIRECT_ORIGIN="${DIRECT_ORIGIN:-http://118.196.101.57:9000}"
readonly ENABLE_TLS="${ENABLE_TLS:-auto}"

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
    if ! grep -q '^BYOK_ENCRYPTION_KEY=.' "$ENV_FILE"; then
        upsert_env "BYOK_ENCRYPTION_KEY" "$(openssl rand -hex 32)"
    fi
    upsert_env "API_HOST" "127.0.0.1"
    upsert_env "API_PORT" "8787"
    upsert_env "YAOZUO_DATA_DIR" "$DATA_DIR"
    upsert_env "ALLOWED_ORIGINS" "${APP_ORIGIN},${API_ORIGIN},${DIRECT_ORIGIN}"
    upsert_env "ALLOW_MOCK_FALLBACK" "true"
    upsert_env "REDIS_URL" "redis://127.0.0.1:6379"
    upsert_env "REDIS_QUEUE_NAME" "yaozuo-jobs"
    upsert_env "WORKER_CONCURRENCY" "${WORKER_CONCURRENCY:-1}"
}

import_project_credentials() {
    local project_key="$PROJECT_DIR/.env.key"
    local byok_key
    [[ -f "$project_key" ]] || return 0
    byok_key="$(awk -F= '$1 == "BYOK_ENCRYPTION_KEY" { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE")"
    log "从 .env.key 导入 Provider 凭证..."
    BYOK_ENCRYPTION_KEY="$byok_key" YAOZUO_DATA_DIR="$DATA_DIR" bun scripts/import-byok-env.ts "$project_key"
}

ensure_system_packages() {
    local packages=(ca-certificates curl ffmpeg git nginx openssl redis-server rsync unzip)
    local missing=()
    local package
    for package in "${packages[@]}"; do
        if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
            missing+=("$package")
        fi
    done
    if (( ${#missing[@]} )); then
        log "安装系统依赖：${missing[*]}"
        apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
    fi
    if ! command -v bun >/dev/null 2>&1; then
        log "安装 Bun..."
        curl --fail --silent --show-error --location https://bun.sh/install | bash
        install -m 0755 /root/.bun/bin/bun /usr/local/bin/bun
    fi
}

ensure_redis() {
    systemctl enable redis-server >/dev/null
    systemctl restart redis-server
    if [[ "$(redis-cli -h 127.0.0.1 ping)" != "PONG" ]]; then
        log "Redis 本地健康检查失败。"
        return 1
    fi
    redis-cli -h 127.0.0.1 CONFIG SET maxmemory-policy noeviction >/dev/null
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
    journalctl -u "$API_SERVICE_NAME" --no-pager -n 80 >&2
    return 1
}

wait_for_worker() {
    local attempt
    for attempt in $(seq 1 30); do
        if systemctl is-active --quiet "$WORKER_SERVICE_NAME" && \
            journalctl -u "$WORKER_SERVICE_NAME" --no-pager -n 30 | grep -q 'BullMQ worker ready'; then
            return 0
        fi
        sleep 1
    done
    log "Worker 健康检查失败，最近日志如下："
    journalctl -u "$WORKER_SERVICE_NAME" --no-pager -n 80 >&2
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

tls_enabled() {
    [[ "$ENABLE_TLS" == "true" || ( "$ENABLE_TLS" == "auto" && -f "$CERTIFICATE_PATH" ) ]]
}

if [[ "${DEPLOY_REEXECUTED:-0}" != "1" ]]; then
    exec 9>"$LOCK_FILE"
    if ! flock -n 9; then
        log "已有部署任务正在运行，退出。"
        exit 1
    fi
fi

cd "$PROJECT_DIR"

ensure_system_packages

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

log "配置 Redis、Bun API 和 BullMQ Worker..."
ensure_runtime_environment
ensure_redis
systemctl stop "$API_SERVICE_NAME" "$WORKER_SERVICE_NAME" 2>/dev/null || true
log "检查并备份旧版 SQLite 数据库..."
YAOZUO_DATA_DIR="$DATA_DIR" bun run db:legacy-upgrade
import_project_credentials
install -m 0644 "$PROJECT_DIR/deploy/xbeaconai-web-api.service" "$API_SERVICE_FILE"
install -m 0644 "$PROJECT_DIR/deploy/xbeaconai-web-worker.service" "$WORKER_SERVICE_FILE"
systemctl daemon-reload
systemctl enable "$API_SERVICE_NAME" "$WORKER_SERVICE_NAME" >/dev/null
systemctl restart "$API_SERVICE_NAME"
wait_for_api
systemctl restart "$WORKER_SERVICE_NAME"
wait_for_worker

log "验证 FFmpeg/FFprobe..."
ffmpeg -version >/dev/null
ffprobe -version >/dev/null

log "同步静态文件到 ${WEB_ROOT}..."
install -d -m 0755 "$WEB_ROOT"
rsync -a --delete "$PROJECT_DIR/dist/" "$WEB_ROOT/"
find "$WEB_ROOT" -type d -exec chmod 0755 {} +
find "$WEB_ROOT" -type f -exec chmod 0644 {} +

if tls_enabled; then
    ensure_tls_certificate
    log "配置 HTTPS 双域名和 /api 反向代理..."
    install -m 0644 "$PROJECT_DIR/deploy/nginx-xbeaconai-web.conf" "$NGINX_SITE"
else
    log "配置 ${DIRECT_ORIGIN} 和 /api 反向代理..."
    install -m 0644 "$PROJECT_DIR/deploy/nginx-xbeaconai-web-direct.conf" "$NGINX_SITE"
fi
ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/xbeaconai-web
nginx -t
systemctl enable nginx >/dev/null
systemctl restart nginx
systemctl is-active --quiet nginx

log "验证公网入口..."
curl --fail --silent --show-error -H "Host: 118.196.101.57:9000" http://127.0.0.1:9000/ >/dev/null
curl --fail --silent --show-error -H "Host: 118.196.101.57:9000" -H "Origin: $DIRECT_ORIGIN" \
    http://127.0.0.1:9000/api/health >/dev/null
curl --fail --silent --show-error -H "Host: 118.196.101.57:9000" \
    http://127.0.0.1:9000/tools/video-cut >/dev/null
curl --fail --silent --show-error -H "Host: 118.196.101.57:9000" \
    http://127.0.0.1:9000/tools/voice-clone >/dev/null
if tls_enabled; then
    curl --fail --silent --show-error --resolve app.xbeaconai.com:443:127.0.0.1 \
        https://app.xbeaconai.com/ >/dev/null
    curl --fail --silent --show-error --resolve api.xbeaconai.com:443:127.0.0.1 -H "Origin: $APP_ORIGIN" \
        https://api.xbeaconai.com/api/health >/dev/null
fi

systemctl is-active --quiet redis-server "$API_SERVICE_NAME" "$WORKER_SERVICE_NAME" nginx

log "部署完成：$(git rev-parse --short HEAD)"

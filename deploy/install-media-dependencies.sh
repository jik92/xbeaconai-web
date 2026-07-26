#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f node_modules/playwright/package.json ]]; then
    echo "缺少锁定的 Playwright 包，请先在项目目录执行 bun install --frozen-lockfile。" >&2
    exit 1
fi

apt-get update
apt-get install --yes ffmpeg libass9 fonts-noto-cjk
/usr/local/bin/bun scripts/check-ffmpeg-production.ts
DEBIAN_FRONTEND=noninteractive /usr/local/bin/bun x playwright install --with-deps chromium
/usr/local/bin/bun scripts/check-playwright-production.ts

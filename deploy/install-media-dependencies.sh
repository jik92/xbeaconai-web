#!/usr/bin/env bash
set -euo pipefail

apt-get update
apt-get install --yes ffmpeg libass9 fonts-noto-cjk
/usr/local/bin/bun scripts/check-ffmpeg-production.ts

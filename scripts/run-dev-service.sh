#!/usr/bin/env bash
set -euo pipefail

service_name="${1:?usage: run-dev-service.sh <service-name> <command> [args...]}"
shift

log_dir="${YAOZUO_LOG_DIR:-logs}"
log_file="${log_dir}/${service_name}.log"

mkdir -p "${log_dir}"
printf '\n===== %s %s started =====\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "${service_name}" | tee -a "${log_file}"

"$@" 2>&1 | tee -a "${log_file}"
exit "${PIPESTATUS[0]}"

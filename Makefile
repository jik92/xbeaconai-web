BUN ?= bun

.PHONY: _check_bun run-dev run-server run-worker db-generate db-migrate lint test ci

_check_bun:
	@command -v $(BUN) >/dev/null 2>&1 || { echo "Error: Bun ('$(BUN)') not found. Please install Bun or set BUN=/path/to/bun." >&2; exit 1; }

run-dev: _check_bun
	@set -eu; \
	web_port="$${PORT:-}"; \
	if [ -n "$$web_port" ]; then \
		case "$$web_port" in *[!0-9]*) echo "Error: PORT must be an integer between 1 and 65534." >&2; exit 1 ;; esac; \
		if [ "$$web_port" -lt 1 ] || [ "$$web_port" -gt 65534 ]; then \
			echo "Error: PORT must be an integer between 1 and 65534." >&2; exit 1; \
		fi; \
		api_port=$$((web_port + 1)); \
	else \
		web_port=5173; \
		api_port=8787; \
	fi; \
	env_file=""; \
	if [ -f .env ]; then env_file=.env; elif [ -f ../xbeaconai-web/.env ]; then env_file=../xbeaconai-web/.env; fi; \
	echo "Starting Web on $$web_port and API on $$api_port$${env_file:+ using $$env_file}"; \
	if [ -n "$$env_file" ]; then \
		PORT="$$web_port" API_PORT="$$api_port" VITE_API_PROXY_TARGET="http://127.0.0.1:$$api_port" \
			$(BUN) "--env-file=$$env_file" run --parallel dev:api dev:worker dev; \
	else \
		PORT="$$web_port" API_PORT="$$api_port" VITE_API_PROXY_TARGET="http://127.0.0.1:$$api_port" \
			$(BUN) run --parallel dev:api dev:worker dev; \
	fi

run-server: _check_bun
	$(BUN) run dev:all

run-worker: _check_bun
	$(BUN) run dev:worker

db-generate: _check_bun
	$(BUN) run db:generate

db-migrate: _check_bun
	$(BUN) run db:migrate

lint: _check_bun
	$(BUN) run format:check
	$(BUN) run lint
	$(BUN) run check:typography

test: _check_bun
	$(BUN) run test

ci: lint test

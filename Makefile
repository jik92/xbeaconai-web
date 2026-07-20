BUN ?= bun

.PHONY: _check_bun run-dev run-server run-worker lint test ci

_check_bun:
	@command -v $(BUN) >/dev/null 2>&1 || { echo "Error: Bun ('$(BUN)') not found. Please install Bun or set BUN=/path/to/bun." >&2; exit 1; }

run-dev: _check_bun
	$(BUN) run --parallel dev:api dev:worker dev

run-server: _check_bun
	$(BUN) run dev:all

run-worker: _check_bun
	$(BUN) run dev:worker

lint: _check_bun
	$(BUN) run format:check
	$(BUN) run lint

test: _check_bun
	$(BUN) run test

ci: lint test

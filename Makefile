BUN ?= bun

.PHONY: run-server
run-server:
	@command -v $(BUN) >/dev/null 2>&1 || { echo "Error: Bun is not installed or not in PATH." >&2; exit 1; }
	$(BUN) run dev:all

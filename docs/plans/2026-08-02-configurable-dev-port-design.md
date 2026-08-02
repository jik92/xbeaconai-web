# Configurable development ports

## Goal

Allow a second local checkout to start with `make run-dev PORT=<web-port>` without conflicting with the default
Web and API listeners.

## Design

- Keep `make run-dev` backward compatible: Web uses port 5173 and API uses port 8787.
- When `PORT` is supplied, use it for Web and use `PORT + 1` for API.
- Point Vite's `/api` proxy at the computed API port so browser requests continue to use the Web origin.
- Pass the selected Web port to the API as `DEV_WEB_PORT`. In development, trust the exact `127.0.0.1` and
  `localhost` origins for that port so authentication requests pass the origin check. Ignore this variable in production.
- Reject non-integer ports and values outside 1-65534 before starting any process.
- Load `.env` from the current checkout when present. Otherwise, fall back to `../xbeaconai-web/.env` when present.
  Explicitly computed port variables override values from the environment file.
- Enable Vite's strict-port behavior so an occupied requested port fails clearly instead of silently selecting another port.

## Verification

- Inspect the dry-run command for default and custom invocations.
- Verify invalid and out-of-range ports fail before Bun starts.
- Run formatting and type checks affected by the Makefile and package script changes.

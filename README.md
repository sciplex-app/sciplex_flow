# Sciplex Flow

Local web application for Sciplex visual programming. Runs a FastAPI/uvicorn backend and serves the bundled React/Vite frontend. Depends on `sciplex-core` for models, controllers, and default nodes.

## Installation

Python 3.11+ is required.

```bash
pip install sciplex-flow
```

## Quick start

```bash
# Start the local server on the default port (8000)
sciplex-flow

# Choose a port
sciplex-flow --port 5173
```

What happens:
- FastAPI server starts locally (no cloud calls by default)
- Web UI served from the packaged `frontend/dist` bundle
- WebSocket channel powers live node execution and UI updates

## Project layout

- `cli/` — Entry point for the `sciplex-flow` CLI.
- `backend/` — FastAPI app and websocket adapters.
- `frontend/` — React/Vite source; `dist/` is the built bundle shipped in the wheel.
- `frontend/dist/` — Bundled assets included in the package (do not delete; rebuild when frontend changes).

## Development

```bash
# Install backend in editable mode
pip install -e ".[dev]"

# Run backend
sciplex-flow --port 8000

# Frontend (from frontend/)
npm install
npm run dev         # dev server with HMR
npm run build       # produces frontend/dist for packaging
```

To update the packaged assets, rebuild the frontend and ensure `frontend/dist` is present before creating a wheel/sdist.

## License

MIT


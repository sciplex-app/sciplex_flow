# Changelog

All notable changes to `sciplex-flow` will be documented in this file.

## [0.1.0] - Unreleased
- Initial public packaging of the local web app (FastAPI backend + React/Vite frontend).
- Bundles `sciplex-core` dependency and packaged `frontend/dist` assets.

## [0.1.7] - 2026-01-23
- Added `/api/projects/upload` so project `.json` files land in `workspace/projects` instead of `workspace/files`.
- Frontend Projects tab now uploads via that endpoint and restricts to `.json`.
- Relaxed Files tab upload validation: accept any file type and removed backend extension whitelist.
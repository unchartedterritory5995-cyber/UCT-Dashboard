# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

**UCT Dashboard** is a live bento-box trading dashboard for Uncharted Territory. It is a full-stack app:
- **Frontend:** React + Vite SPA with React Router (tabs: Dashboard, Morning Wire, Traders, Screener, Options Flow, Post Market, Model Book)
- **Backend:** FastAPI (Python) — serves the React build and all `/api/*` data endpoints
- **Deployment:** Railway (single service)

The **Morning Wire** is one tab within this dashboard. Its engine (`morning_wire_engine.py`) lives in `C:\Users\Patrick\morning-wire\` and is imported by the backend.

## Worktree Directory

Worktrees live in `.worktrees/` (project-local, gitignored).

## Design Documents

All design docs are in `docs/plans/`. The primary design doc is:
- `docs/plans/2026-02-22-dashboard-redesign.md` — full architecture decisions
- `docs/plans/2026-02-22-dashboard-implementation.md` — 25-task implementation plan

## Project Structure

```
uct-dashboard/
├── app/                  # React + Vite frontend
│   ├── src/
│   │   ├── components/   # Shared (NavBar, MoversSidebar, TileCard, tiles/)
│   │   ├── pages/        # Dashboard, MorningWire, Traders, Screener, etc.
│   │   └── main.jsx
│   └── vite.config.js
├── api/                  # FastAPI backend
│   ├── main.py
│   ├── routers/
│   └── services/
├── tests/                # pytest tests for backend
├── docs/plans/           # Design and implementation docs
└── .env                  # API keys (never committed)
```

## Running Locally

```bash
# Backend
uvicorn api.main:app --reload --port 8000

# Frontend (separate terminal)
cd app && npm run dev
```

## Environment Variables

Same as morning-wire `.env`:
- `FINNHUB_API_KEY`, `ANTHROPIC_API_KEY`, `DISCORD_WEBHOOK_URL`
- `MASSIVE_API_KEY`, `MASSIVE_SECRET_KEY`
- `VERCEL_TOKEN` (legacy), `DASHBOARD_URL` (new Railway URL)

## Data Sources

- **Massive** — live prices, snapshots, OHLC, movers, breadth (paid API)
- **Finnhub** — news feed
- **FMP** — earnings calendar
- **Claude AI** — AI-generated rundown, leadership theses
- **Morning Wire engine** — `C:\Users\Patrick\morning-wire\morning_wire_engine.py`

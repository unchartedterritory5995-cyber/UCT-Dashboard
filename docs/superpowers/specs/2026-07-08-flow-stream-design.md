# Live Instant Options Flow — Stream Architecture (2026-07-08)

## Goal
Options-flow tape that is **instant** (new prints appear sub-second), **constant**
(always live, no lag/chunking), and **never fails** (no OOM, no 524s, no blank
page, survives deploys). Replaces the polling model that caused every failure on
7/8 (OOM crash-loop, 524s, chunky tape).

## Root cause being retired
Polling `/api/live/massive/recent` built ~34K-row (`limit=20000`) responses on
every request. Fast poll (5s) × multiple tabs → concurrent heavy builds →
anyio-worker + RSS exhaustion → the pre-existing thread burst OOM'd instead of
self-healing. **Polling a heavy endpoint cannot be both instant and cheap.**

## Architecture: Snapshot + Stream

1. **Initial snapshot** — one bounded, cached `/recent` call (≤500 rows). Renders
   instantly. NOT the 34K-row build.
2. **Live updates** — an **SSE stream** pushes each new print as it lands. Browser
   appends. Sub-second, constant, cheap (no re-scan per update).

### Backend components (all NEW files/routes — additive, dark-gated)

**`api/massive_stream.py`** — broadcaster + tailer (decoupled from Ravi's ingest):
- `subscribe() -> asyncio.Queue` / `unsubscribe(q)` — per-client bounded queues
  (maxsize ~500, drop-oldest so a slow client can't grow memory).
- `broadcast(alerts: list)` — non-blocking put to every subscriber queue.
- **Tailer** (`_tail_loop`): every `MASSIVE_STREAM_TAIL_SEC` (~1.0s), one query
  `SELECT ... FROM flow WHERE id > _last_id ORDER BY id LIMIT N`, serialize each
  row via the SAME path `/recent` uses (`_row_to_alert`) so streamed alerts match
  snapshot alerts, `broadcast()`, advance `_last_id`. On startup `_last_id =
  MAX(id)` (stream only NEW prints, never replay history). One query/sec total,
  independent of client count. **Reads only — never touches the write path.**
- Bounded: `_MAX_SUBSCRIBERS`; tailer `LIMIT` caps a single broadcast.

**SSE endpoint** `GET /api/live/massive/stream` (in `live_massive_router.py`):
- Mirrors the proven `/api/stream/bars` pattern (StreamingResponse, `text/event-stream`).
- On connect: `subscribe()`. Loop: drain queue → `data: {json}\n\n`; named
  `event: heartbeat` every 15s (keeps proxies open, signals healthy-idle).
- **On disconnect: `unsubscribe()` in `finally`** — the cleanup that prevents the
  connection/thread leak that OOM'd on 7/8.

**Tailer lifecycle** — started in `main.py` lifespan, gated `MASSIVE_STREAM_ENABLED`.
Single task; no-op when flag off.

### Frontend (`LiveFlowMassive.jsx`) — resilient, gated `VITE_MASSIVE_STREAM`
- Flag OFF → current 20s polling (unchanged fallback).
- Flag ON: fetch bounded snapshot → render → open `EventSource(/stream)` → prepend
  new alerts (dedupe by id, cap client list length). On error/disconnect: **keep
  the rendered data** (never blank), show a quiet "reconnecting" dot; EventSource
  auto-reconnects. No polling loop when streaming.

## Flags (all default OFF — ships dark)
| Flag | Where | Default |
|---|---|---|
| `MASSIVE_STREAM_ENABLED` | backend tailer + endpoint | 0 |
| `MASSIVE_STREAM_TAIL_SEC` | tailer interval | 1.0 |
| `VITE_MASSIVE_STREAM` | frontend EventSource | 0 |

## Phasing by risk
- **P1 (now, safe/dark):** `massive_stream.py` + `/stream` endpoint + tailer wiring
  + frontend EventSource path. All additive, gated OFF. Can't touch the live feed.
- **P2:** re-integrate our dropped read-path work onto Ravi's version — IV (capped
  to returned slice), sideConfidence, `/recent` micro-cache; bound the snapshot.
- **P3:** flip flags on, verify instant tape + stability (threads/RSS flat).
- **P4 (coordinate + after-close):** P5 flow-worker cutover (deploy survival, per
  `2026-07-07-p5-cutover-runbook.md`); lexical-CreatedTime fix in worker-history.

## Testing
- Unit: tailer serialization matches `_row_to_alert`; `_last_id` advance; subscribe/
  unsubscribe add/remove; drop-oldest on a full queue.
- Live (dark): flag on in a scratch check → `/stream` emits new prints within ~1-2s;
  `/api/health/thread-stacks` shows NO growth in stream handlers after connect/
  disconnect cycles (leak check); RSS flat.

## Rollback
Every piece is flag-gated: set `MASSIVE_STREAM_ENABLED=0` / `VITE_MASSIVE_STREAM=0`
→ instant revert to 20s polling. No data path changes; nothing to migrate.

## Non-goals / boundaries
- Does NOT modify `massive_ws_worker.py` (Ravi's ingest/algo).
- Does NOT do the P5 flip in this phase (separate, coordinated, after-close).
- ~1s tail latency accepted vs a write-path hook (0ms) to stay decoupled from Ravi.

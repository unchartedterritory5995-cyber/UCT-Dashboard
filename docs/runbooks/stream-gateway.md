# stream-gateway: the live bar stream in its own service

**What it is.** `api/stream_gateway_main.py`: web's own `/api/stream/bars` route, feed client and
RemoteBroadcaster, run in a separate Railway service (`stream-gateway`). It is a second client of
stream-ingest (`gw-<replica>`), so web's restarts, deploys and warm-ups no longer touch a live candle.

**Why (measured 2026-11-17).** After each web restart (three that afternoon) live bars ran 2-12 s behind
for ~5 minutes (trade -> browser p50 6.3 s / 12.5 s; bar messages 4-8/s against ~25/s) while
stream-ingest stayed at p90 250 ms. web's boot probe: 130-147% CPU from warm-ups, the event loop at
11-24% of it; stall captures in route matching. Plan: section 10f of the platform plan (local report).

## How a request gets there

`bars-edge-router` (edge/bars-edge-router/stream.js) sends `GET /api/stream/bars` to the gateway when:
1. the Worker variable `STREAM_GATEWAY_ORIGIN` is set (an `https://` origin, no path), AND
2. the request carries a valid member chart cookie (`uct_chart_edge`, issued on `/api/stream/bars` since
   this change) or service token, AND
3. it falls in `STREAM_GATEWAY_PCT` (0-100, default 100).

Otherwise, and on ANY gateway failure (unreachable, 401, 404, 5xx; the gateway answers 503 while its
own feed is not connected), the same request goes to web exactly as before. Responses from the gateway
carry `x-bars-edge: stream-gateway`.

The Worker route `uctintelligence.com/api/stream/bars*` must exist for the Worker to see these requests.

## Service settings (stored settings, no config file: Railway stops reading railway*.json on 2026-12-01)

- Source: this repo, branch `production`. Builder Nixpacks, build `pip install -r requirements.txt`.
- Start: `python -m api.stream_gateway_main`. Health check `/api/health`. Restart: always. No volume.
- Watch paths (narrow, so web's merges never restart it): `api/stream_gateway_main.py`,
  `api/routers/stream.py`, `api/services/feed_client.py`, `api/services/remote_broadcaster.py`,
  `api/services/feed_protocol.py`, `api/services/bar_broadcaster.py`, `api/services/bar_stream.py`,
  `api/services/bar_contract.py`, `api/chart_edge_token.py`, `api/bars_auth.py`, `requirements.txt`.
- Variables (references, never copied values): `PUSH_SECRET=${{web.PUSH_SECRET}}`,
  `CHART_EDGE_SECRET=${{web.CHART_EDGE_SECRET}}`, `STREAM_BARS_ENABLED=1`, `STREAM_FEED_SOURCE=remote`.
  `STREAM_INGEST_URL` only if web sets one (default `ws://stream-ingest.railway.internal:8080/internal/feed`).
- A public Railway domain (the Worker's `STREAM_GATEWAY_ORIGIN`).
- Like the rest of the data platform it is not released during market hours (04:00-20:00 ET).

## Switch on, verify, switch off

- **On:** Worker variable `STREAM_GATEWAY_ORIGIN=https://<gateway domain>` (optionally
  `STREAM_GATEWAY_PCT`), and the Worker route `uctintelligence.com/api/stream/bars*`.
- **Verify:** `GET <gateway>/api/health` -> `feed_connected: true`; stream-ingest `/status` lists a
  `gw-` client; a signed-in browser's `/api/stream/bars` response has `x-bars-edge: stream-gateway`;
  the tick proof (uct-desktop `scripts/proofs/tick-latency-proof.mjs`) shows bar arrival unchanged or better.
- **Off (instant, no deploy):** delete the Worker variable `STREAM_GATEWAY_ORIGIN` (or set
  `STREAM_GATEWAY_PCT=0`). Every stream goes back to web on its next connection.

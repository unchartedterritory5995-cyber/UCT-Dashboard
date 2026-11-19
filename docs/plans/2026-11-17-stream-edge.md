# stream-edge: live chart data off the web pod

## Why (measured 2026-11-17 RTH, owner Chrome)
- Since the stream-ingest cutover, data reaches web ~1 s after the trade, and ingest batches are never >0.9 s old.
- Browsers still see 1.5-5 s all-symbol pauses, about one every 6 s. Web's own monitor puts the cause in web: request-timing verdict
  "interpreter lock: slow seconds had tokens free", loop lag up to 8.7 s after a boot, a trivial request p50 1.6 s.
- The web pod runs dozens of CPU-heavy jobs in one interpreter (screener_live_tier every 30 s, breadth sampling, the
  darkpool flat file, bars-continuous-audit, s3_pull, warm-ups after every deploy). Delivery to the browser is one more
  job in that queue.
- #1694 removed one convoy (side feeds on the loop). The remaining pauses are the pod's general load.

## What
`stream-edge` is a new Railway service with one job: serve the live chart streams to browsers.
```
Massive -> stream-ingest -> stream-edge -> browser (/api/stream/bars [phase A], /api/stream/prices [phase B])
                         -> web          (everything else, plus the side feeds: NH/NL, volume, T&S)
```
- It is a second feed client of stream-ingest (DesiredUnion already serves several clients). It reuses
  `feed_client.FeedClient` and `remote_broadcaster.RemoteBroadcaster` unchanged; `side=None`, because the side feeds stay on web.
- It serves the same `/api/stream/bars?v=2` frames as web (bar, heartbeat, resume, event ids).
  The client code does not change.
- Push, not poll: an SSE generator awaits its subscription queue (no 250 ms sleep).
- Process: one uvicorn worker, no schedulers, no DBs, no warm-ups. Boot completes in seconds.

## Auth
- The edge already mints `uct_chart_edge`, an HMAC-signed member chart entitlement (api/chart_edge_token.py, its own secret).
- stream-edge verifies that token itself: signature, expiry and entitlement, with the same rules as the Worker's `classifyToken`.
- No auth.db.
- The cookie is path-scoped (`/api/bars`, `/api/hist`) on purpose. Phase A adds `/api/stream/bars` to that scope.
  This is a security-reviewed change.

## Routing (Cloudflare Worker `bars-edge-router`)
- New route `uctintelligence.com/api/stream/bars*`. The Worker forwards it to STREAM_EDGE_ORIGIN only when the canary
  cookie `uct_stream_edge=1` is present (owner first) or the global flag is on. Otherwise it passes through to web,
  unchanged.
- Fallback: if stream-edge errors (connect failure, 5xx) before the stream starts, the Worker passes the request to web.
  After the stream has started, the browser's own reconnect handles it (barsStreamManager) and lands on the same rule.
- Rollback: delete the canary cookie, or the route (minutes).

## Phases
1. **A1** (code, dark): `api/stream_edge_main.py` plus a bars-only stream router with token auth.
   Tests: golden tapes byte-identical, ingest -> stream-edge -> SSE vs ingest -> web -> SSE; auth matrix; reconnect/resume.
2. **A2** (web, dark): the edge cookie is also scoped to `/api/stream/bars`.
3. **A3** (owner: Railway service + Cloudflare route/Worker deploy): owner-only canary in RTH, measured against web in the same
   browser.
4. **A4**: everyone.
5. **B**: `/api/stream/prices`. The day-change fields (prev close) need a source on stream-edge (an ingest-carried prev close
   or the REST snapshot), and the stale/fresh rules move too.

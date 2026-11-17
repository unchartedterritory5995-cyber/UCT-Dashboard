# stream-edge: one-time setup (owner steps)

Design: `docs/plans/2026-11-17-stream-edge.md`. Nothing here changes what members see. stream-edge
only serves browsers that carry the canary cookie, and every failure falls back to web.

## 1. Railway: create the service (about 5 minutes)
New Railway services never read a config file (see `docs/runbooks/railway-config-cutoff.md`), so
these settings are typed by hand.

1. Project → **+ New** → **GitHub Repo** → `UCT-Dashboard`. Rename the service to `stream-edge`.
2. **Settings → Deploy**
   - Start Command: `python -m api.stream_edge_main`
   - Healthcheck Path: `/healthz`
   - Healthcheck Timeout: `60`
   - Restart Policy: `Always`
3. **Settings → Build → Watch Paths**: paste the list from `railway.edge.json` (`build.watchPatterns`).
4. **Variables**: use references, so no secret is ever copied by hand:
   - `PUSH_SECRET` = `${{web.PUSH_SECRET}}` (stream-ingest requires it)
   - `CHART_EDGE_SECRET` = `${{web.CHART_EDGE_SECRET}}` (verifies the member cookie)
   - `STREAM_BARS_ENABLED` = `1`
5. **Settings → Networking → Generate Domain** (a public `*.up.railway.app` address). The Cloudflare
   Worker connects to it. Without a valid member cookie it answers 401.
6. Deploy. Check: `https://<that domain>/healthz` shows `"feed_connected": true`.

## 2. Cloudflare: route and Worker (about 5 minutes)
1. Workers & Pages → `bars-edge-router` → **Settings → Variables and Secrets**: add the plain-text
   variable `STREAM_EDGE_ORIGIN` = `https://<the stream-edge domain from step 1.5>`. Do NOT add
   `STREAM_EDGE_ALL` yet.
2. Deploy the Worker from this repo: `worker.js`, `history.js` and `stream.js` together (Wrangler from
   `edge/bars-edge-router/`, or all three files in the dashboard editor).
3. **Settings → Domains & Routes → Add route**: `uctintelligence.com/api/stream/bars*`, Worker
   `bars-edge-router`.

At this point nobody's traffic has moved: without the canary cookie the Worker passes the request to
web, exactly as before.

## 3. Canary: only the owner's browser
In the owner's Chrome, on uctintelligence.com, run this in the console:
`document.cookie = "uct_stream_edge=1; path=/api/stream/bars; max-age=2592000; secure; samesite=lax"`
then reload. The `/api/stream/bars` response then carries the header `X-Stream-Edge: edge`.
To undo, run the same line with `max-age=0`.

## 4. Everyone
Set the Worker variable `STREAM_EDGE_ALL` = `1`. To roll back, delete it (or delete the route).

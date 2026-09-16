# bars-edge-router

The Cloudflare Worker that serves member chart data. **`worker.js` in this
directory is the canonical source.**

## Why this directory exists

Until 2026-09-13 this Worker existed **only in the Cloudflare dashboard**. It was
hand-deployed, never version-controlled, and nothing in the repository recorded
that it existed. That gap caused a production outage: an audit read `app/src`,
found no absolute bars hostname, correctly concluded "the frontend only ever
calls same-origin", and *incorrectly* concluded that no browser reaches the
bars-api tier. The Worker — which forwards member browser requests straight
there — was not in the repo to contradict it. A service-credential gate shipped
on the tier and refused every paying member's equities, ETFs and indices.

**Deploy from here from now on.** If you edit the Worker in the dashboard,
copy it back into `worker.js` in the same change.

## What it does

| Request | Goes to |
| --- | --- |
| `/api/bars/UCT*` (breadth) | `WEB_ORIGIN` — breadth lives in the web pod's tables; the tier has only bars.db |
| `/api/bars/US:*`, `NASDAQ:*`, `NYSE:*` (namespaced breadth) | `WEB_ORIGIN` — **any ticker containing a colon**. Added 2026-09-16: the Library is one metric across universes, so `pct_above_50sma` is `UCTA50` *and* `US:A50`, and only the first starts with `UCT`. Until this, `US:A50` was forwarded to the tier — whose breadth DB is 16 KB and empty — and answered `symbol_not_carried`, while the same symbol returned a proper 401 on `WEB_ORIGIN`. |
| `/api/bars/<symbol>` | `BARS_ORIGIN` (bars-api tier) |
| anything else | passed through untouched to the zone's default origin (web) |
| tier returns >= 500, or times out (8 s) | falls back to `WEB_ORIGIN` |

**The fallback does not cover 401/403.** Those pass straight to the member. That
is why the tier gate was a visible outage rather than a silent degradation.
Changing it is a routing change and belongs in its own phase.

### Known route quirks — documented, deliberately NOT fixed yet

The Worker Route is `uctintelligence.com/api/bars/*`, which is
method-independent and matches sub-paths. The regex then treats the first path
segment as a ticker. So:

* `POST /api/bars/warm` → ticker `WARM` → forwarded to the tier → **405**
* `/api/bars/_debug_source/X` → ticker `_DEBUG_SOURCE` → forwarded → **404**

Both are accidental. Both are harmless today (the tier simply has no such
route). Fixing them is a routing change and must not ride along with an
entitlement change — do it in its own controlled step, after shadow mode proves
the entitlement signal is reliable.

Also latent: the regex matches `/api/bars-history/...`, but the **route** does
not (`/api/bars-` is not `/api/bars/`), so history never reaches this Worker.
Widening the route would silently activate that branch and put the edge in front
of the cached historical surfaces. Don't.

## Phase 1 — shadow entitlement (current)

The Worker reads the `uct_chart_edge` cookie, verifies it with
`env.CHART_EDGE_SECRET` (HMAC-SHA256 via Web Crypto), and **logs a
classification only**:

```
{"evt":"edge_entitlement","cls":"EDGE_ENTITLEMENT_VALID","family":"bars","method":"GET"}
```

`cls` is one of `EDGE_ENTITLEMENT_VALID | _MISSING | _EXPIRED | _INVALID`.

**Routing is identical for all four.** Nothing here can deny a request. There is
no enforcement flag to flip by accident — the branch simply does not exist yet.
The whole shadow block is wrapped in `try/catch`, so a bad binding degrades to
"no log line", never to a failed chart.

The token is minted by `api/chart_edge_token.py` and is **stripped from the
upstream request** before the origin call: the origins have no use for it, and an
entitlement artifact must never drift toward a shared cache key.

## Configuration

| Where | Name | Notes |
| --- | --- | --- |
| Cloudflare → Workers & Pages → `bars-edge-router` → Settings → Variables and Secrets | `CHART_EDGE_SECRET` | Add as **Secret** (encrypted), not a plaintext variable |
| Railway → `web` service → Variables | `CHART_EDGE_SECRET` | Must be the **same value** |
| Railway → `web` (optional) | `CHART_EDGE_TOKEN_TTL_SECONDS` | Defaults to 900 (15 min) |

**It is not `PUSH_SECRET`.** `PUSH_SECRET` is the internal service credential and
also signs webcal export tokens, capture tokens and OAuth state — rotating it
breaks every member's calendar subscription. This token is browser-held and
verified by third-party edge infrastructure, so it gets its own key with one job.

Until `CHART_EDGE_SECRET` is set on both sides, everything still works: web mints
no token, and the Worker classifies `MISSING` and routes exactly as before.

## Tests

```
node --test           # from this directory
```

Also run from the Python suite by `tests/test_chart_edge_worker_interop.py`,
which mints a token in Python and classifies it **here**, so a cross-runtime
drift (base64 padding, key encoding, integer types) fails a test instead of a
member's chart.

## Deploying

Dashboard: Workers & Pages → `bars-edge-router` → Edit code → paste `worker.js`
→ Deploy. Or via Wrangler:

```
npx create-cloudflare@latest bars-edge-router --existing-script bars-edge-router
```

The Worker also answers on `bars-edge-router.<account>.workers.dev`. That
hostname is an **anonymous alternate entrance to the tier** today. Once
enforcement begins it closes by construction: the `uct_chart_edge` cookie is
scoped to `uctintelligence.com`, so a browser never sends it to `workers.dev`,
which will classify `MISSING` and be denied.

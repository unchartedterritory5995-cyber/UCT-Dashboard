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
| tier network error, times out (8 s), 502/504, or any non-deliberate 5xx | falls back to `WEB_ORIGIN` |
| tier DELIBERATE 503 + Retry-After (`X-Bars-Shed: warming`/`warm-shed`, or a `warming` body) | passes to the browser, `X-Bars-Edge: tier` |
| a GET/HEAD the tier has not answered within 1.2 s (`BARS_HEDGE_MS`) | also asked of web; the first good answer is served (`X-Bars-Edge: web-hedge`) |
| a GET/HEAD after web answered for a failing or out-waited tier (the CIRCUIT BREAKER, 2026-11-21) | straight to web for 20 s in that isolate (`BARS_BREAKER_MS`, `X-Bars-Edge: web-breaker`); a web failure still tries the tier. A tier restart (~11 s: a volume cannot be mounted twice) then costs one hedge, not one per read |

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

## Deep intraday history: `/api/hist/*` (history.js, not live until its route and bucket exist)

`history.js` answers two paths straight from the `HISTORY` R2 bucket (the history lake,
`tools/history_lake/`); no origin is asked:

* `/api/hist/v1/index/<s-SYMBOL>.json` — the symbol's index: every piece it has, with each piece's
  CRC and its place (`off`, `bytes`) in its pack, plus the symbol's split table.
* `/api/hist/v1/<series>/<s-SYMBOL>/<period>.ubh?c=<crc>&o=<off>&n=<bytes>` — one piece, read as ONE
  ranged read of `packs/<series>/<period>.pack`. The bytes must be a whole piece whose own header
  names this symbol, series, period and CRC, or the answer is 409 (the client re-reads the index).
  Sent with `Content-Encoding: br` and the piece header in `X-Ubh-Header`, so the browser inflates
  it natively; `immutable` for a year (the URL names one exact content). The header comment in
  `history.js` has the details.

**Entitlement is enforced on this surface** (valid member cookie or valid service header,
otherwise 401). `/api/bars/*` below is unchanged and still shadow-only. `HISTORY_PREFIX` (optional
variable) is prepended to every object key if the lake shares a bucket.

To turn it on: (1) build the packs and run `tools/history_lake/publish.py --upload` (packs first,
then indexes), (2) bind the bucket to this Worker as `HISTORY`, (3) add the Worker Route
`uctintelligence.com/api/hist/*`, (4) deploy `worker.js` and `history.js` together (Wrangler, or both
files in the dashboard editor). Until step 3 the path never reaches this Worker; until step 2 it
answers 503. Then a browser opts in with `localStorage['uct.historyLake']='1'`
(`app/src/data/barStore/historyFeed.js`) until the default changes.

## First-frame seed: `/api/seed/*` (seed.js, not live until its route exists)

`seed.js` serves the first-frame seed packs (`docs/charts/first-frame-seed-format.md`) straight from
R2; no origin is asked:

* `/api/seed/v1/latest.json` — the manifest (build id, as-of session, per-timeframe url, bytes,
  sha256). `private, max-age=60`.
* `/api/seed/v1/<YYYYMMDDTHHMMZ>/<tf>.ffs` (`tf` = 1 5 15 30 60 D) — one timeframe's whole pack.
  `private, immutable` for a year; a single `Range` is answered 206 (resumed downloads); the Worker
  keeps a copy of each whole pack in the data center's Cache API under `/api/seed/__edge/`.

Entitlement is enforced exactly as on `/api/hist/` (member cookie or service header, else 401).
Bindings: `SEED` (R2 bucket; falls back to `HISTORY`), optional `SEED_PREFIX` (default `ffseed/`,
the prefix the worker's builder `api/services/ffseed.py` uploads under in the `DATA_SYNC_BUCKET`).

To turn it on (owner): (1) arm the builder on the worker (`FFSEED_ENABLED=1`, manual worker deploy)
and confirm `ffseed/latest.json` exists in the bucket, (2) bind that bucket to this Worker as `SEED`
(or reuse `HISTORY` if it is the same bucket, with `SEED_PREFIX` if needed), (3) add the Worker
Route `uctintelligence.com/api/seed/*`, (4) deploy `worker.js` + `seed.js` together. Until step 3
the path never reaches this Worker; until step 2 it answers 503. Tests: `node --test seed.test.mjs`
(packs built by the Python encoder, `tools/ffseed_make_js_fixture.py`).

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

## ⛔ Before enforcement: renderers that run OFF the web pod

Two renderers screenshot the public `/r/chart` page from the owner's PC, not from
`chart-renderer`, and so never pass through `render_house_chart`:

| Renderer | Where | Token source |
| --- | --- | --- |
| Morning Wire's Substack letter | `morning-wire/substack/chartwidget.py` | `POST /api/r/edge-service-token` (PUSH_SECRET bearer) |
| Sunday Scans | `uct-sunday-scan/sunday_scan/charts.py` | same |

Each must attach the returned `X-Chart-Edge-Token` to its `/api/bars/` requests
(same host, https — the scope `services/chart_renderer/edge_scope.py` enforces).
**Enforcement must not ship until the shadow log shows `EDGE_SERVICE_VALID` for
both.** A renderer that is denied does not error: it drops every chart that fails
its judge and ships the letter WITHOUT it — which is how the wire lost every
chart 2026-09-14..25 when the web pod's `/api/bars` gate landed, unnoticed for
ten drafts.

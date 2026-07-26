# Options Flow — Cloudflare Cache Rule for `/api/flow/data`

**Status:** rule NOT yet applied. Code side is ready (`baseFetchUrl`, shipped 2026-07-25).
**Goal:** every member, every day, gets the flow page instantly and accurately, with no
manual step.

## The problem

`GET /api/flow/data?days=1` returns **12.4 MB gzipped** and is served by the **flow-worker**
(`/api/flow` is in `flow_proxy.PROXIED_PREFIXES`). Measured on prod 2026-07-25:

| | |
|---|---|
| `cf-cache-status` | **`DYNAMIC`** — Cloudflare caches **nothing** |
| `age` header | `null` |
| origin response | **386 ms warm → 3,643 ms cold** |

The origin already sends `Cache-Control: public, max-age=300, stale-while-revalidate=86400`,
and `csvFile` was deliberately made **version-stable** precisely so Cloudflare could cache it.
Cloudflare does not cache extension-less paths by default regardless of origin headers, so
that entire design has never been active in production. **Every member pays the origin build.**

`_current_version()` (`flow_router.py`) is a **60-second time bucket**, and the response cache
is keyed on it — so the first member in each 60 s window rebuilds the full 12.4 MB gzip from a
**2.7 GB / 2.1 M-row** SQLite. A lone user is *always* that member. That is why the owner saw
3-8 s consistently while a busy period would feel faster.

## The rule

Cloudflare dashboard → **Caching → Cache Rules → Create rule**.

- **Name:** `Options Flow CSV — cache at edge`
- **When incoming requests match:**
  ```
  (http.request.uri.path eq "/api/flow/data") or
  (http.request.uri.path eq "/api/flow/indexes-data")
  ```
- **Then:**
  - Cache eligibility: **Eligible for cache**
  - Edge TTL: **Override origin — 60 seconds**
  - Browser TTL: **Respect origin** (300 s)
  - Cache key → Query String: **Include all** *(the default — see the red flag below)*

### Why 60 s edge TTL and not the origin's 300 s
60 s matches `_VERSION_BUCKET_SEC`, which is the app's *own* freshness contract. It introduces
no staleness class that does not already exist: the client polls `/api/flow/version` every 60 s
during market hours and refreshes on a bump. Overriding at the edge also avoids touching
`flow_router.py`, which lives on the flow-worker and would need `railway up -s flow-worker`
(a 15-60 s options-tape WS handoff) rather than a web push.

### Why the code change had to land first
The client's version-bump refresh used `fetch(url, {cache:"no-store"})`. `no-store` is only a
**request** directive, and **Cloudflare deliberately ignores client no-cache** to prevent
cache-busting attacks — so once the edge caches this path, that refresh would have been
answered with the very bytes it was trying to replace, and members would have been pinned to
stale flow. `baseFetchUrl()` now appends `&v=<version>` on a refresh, making it a distinct
cache key: guaranteed fresh, and itself cacheable, so one member's refresh warms the edge for
everyone on that version.

## 🚩 Red flags — these are the damage cases

1. **Never enable "Ignore Query String" on the cache key.** `days`, `all_data`, `date_from`,
   `date_to` and `v` all live in the query string. Ignoring it would serve a **1-day payload to
   a 20-day request** and one member's calendar range to another. This is the single most
   destructive misconfiguration available here.
2. **Do not widen the matcher to `/api/flow*`.** `/api/flow/version` must stay uncached (it
   sends `no-store` and is the freshness signal for the whole page); `/api/flow/upload`,
   `/prune` and the other POSTs must never be cached.
3. **Do not set a long edge TTL** "because it's faster". Above ~60 s members drift out of sync
   with the version poll and see stale flow during RTH.

## Verify after applying

```bash
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
# run twice, a few seconds apart
curl -s -o /dev/null -A "$UA" -H 'Accept-Encoding: gzip' \
  -w 'cf=%{header_json}\n' 'https://uctintelligence.com/api/flow/data?days=1' | tr ',' '\n' | grep -i 'cf-cache-status\|age'
```
- 1st request: `cf-cache-status: MISS` (populating)
- 2nd request: **`cf-cache-status: HIT`** and a non-null `age` ← this is the success signal
- `?days=20` must return its own MISS→HIT pair, **not** share the `days=1` entry

⚠️ Cloudflare **rate-limits** repeated 12.4 MB pulls from one IP — two curls ~8 s apart already
returned a `retry-after: 60` HTML challenge page during testing. Probe sparingly and check the
`content-type` is `text/csv`, not `text/html`.

## Rollback
Disable the Cache Rule. Behaviour returns to today's immediately; no deploy, no code change.
`baseFetchUrl`'s versioned refresh is harmless with the rule off (it just adds a query param).

## Expected result
Origin build (386 ms - 3,643 ms) → **~50 ms edge hit** for every member after the first one in
each 60 s window, globally. Combined with the client-side snapshot cache this is the
"instant for every user, every time" path.

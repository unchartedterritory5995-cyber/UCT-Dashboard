# Edge-served deep history (worker origin + Cloudflare cache)

**Status:** in progress (2026-08-31). **Goal:** every user, new or returning, anywhere,
gets full chart history instantly — without the web pod ever holding or fetching the
~20 GB deep history en masse (the memory/OOM class that broke prod on 2026-08-31).

## Why (root problem)
Past ("sealed") chart history is **immutable** — Apple's close on some day in 2015 never
changes — so it is the perfect thing to cache once and serve forever. But today the web
pod is forced to *hold* all of it (a 20 GB bars.db) and, when it drifts to partial
coverage, to *live-fetch* deep history per request (memory-heavy → lock jams + OOM). A
`force_resync` to install the full 20 GB base OOM'd the pod and left an empty db — proof
the monolithic approach is unsafe on this single, memory-constrained pod.

## The design (a cache in front of a deep origin)
Cloudflare's edge is a **cache, not a source** — it serves whatever the origin hands it.
So: keep the deep data on the pod that already has it (the **worker**, 20 GB deep bars.db,
not serving users, has headroom), put **Cloudflare** in front of it, and let the **web**
stay lean (recent tail + live bar only).

```
client ──▶ Cloudflare edge ──(cache MISS, rare)──▶ web ──proxy──▶ worker (deep bars.db)
   ▲              │                                                      │
   └── cache HIT ─┘ (immutable, per-trading-day URL — served worldwide) ◀┘  deep sealed bars
```

- **Deep sealed history is immutable per trading day**, keyed by `?d=<last-sealed-date>`
  → each day is a new cache object that caches ~forever; no purges (already built).
- **Web pod never holds or fetches deep** — it only proxies a cache MISS through to the
  worker, and after the first hit per (ticker, tf, day) the edge serves it (web untouched).

## Components (mostly already built)
| Piece | State |
|---|---|
| `/api/bars-history` endpoint + dated-immutable cache headers | ✅ built (2026-08-31 read-only fix) |
| Split-fetch client (shallow tail from `/api/bars` + deep from `/api/bars-history`) | ✅ built, at 10% rollout |
| Cloudflare Cache Reserve + cache rule | ✅ set up by owner |
| `history_prewarm.py` (sweeps `/api/bars-history` through CF to stock the edge) | ✅ built, gated OFF |
| web→worker reverse-proxy pattern (`flow_proxy.py`, `WORKER_INTERNAL_URL`) | ✅ exists (flow) |
| **Worker serves `/api/bars-history` from its deep db** | ⬜ NEW (Phase 1) |
| **Web proxies `/api/bars-history` to the worker** | ⬜ NEW (Phase 2) |

## Phases
1. **Worker origin (dark).** Add `/api/bars-history/{ticker}` to the worker's FastAPI
   (`worker_main._build_app`), reading its own (deep) bars.db read-only via the SAME
   serving logic as the web endpoint. Pure addition — nothing routes to it yet.
2. **Web proxy (gated OFF).** When `BARS_HISTORY_PROXY_ENABLED=1` + a worker-origin URL
   (`http://worker.railway.internal:8080`) is set, the web forwards `/api/bars-history`
   to the worker (httpx, `flow_proxy` style) instead of serving from its own shallow db.
   Preserves the immutable cache headers so Cloudflare caches the deep response.
3. **Validate end-to-end.** Enable the proxy for a moment; fetch one cold ticker's deep
   history; confirm (a) it returns deep bars, (b) `cf-cache-status` goes MISS→HIT, (c) the
   web pod's memory does not move (it only proxied). No data operations, so no OOM class.
4. **Ramp.** Split-fetch 10% → 100%; enable `HISTORY_PREWARM_ENABLED` on the worker so the
   universe's deep history is pre-stocked at the edge → users rarely hit a MISS.
5. **(Later, optional) Direct CF→worker origin** for maximum leanness (web out of the deep
   path entirely) — needs a public worker origin + a Cloudflare origin rule. Deferred.

## Safety
- **No data movement, no monolithic install** — this is serving + caching only, so the
  OOM class from tonight cannot recur.
- Every step **gated + dark-first + reversible** (flags: proxy enable, split %, prewarm).
- The web's shallow serving path is unchanged when the proxy flag is off.
- ⛔ Coordinate with partner deploys during validation — overlapping worker deploys bounce
  the origin (and, once live, the flow-worker OPRA tape lesson applies: worker restarts
  briefly drop the origin; the edge cache absorbs it for already-cached objects).

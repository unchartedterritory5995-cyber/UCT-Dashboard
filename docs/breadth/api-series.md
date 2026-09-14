# `GET /api/breadth-monitor/series` — the columnar long-history reader (B1, D-035)

**Dark.** Unset `BREADTH_SERIES_ENDPOINT_ENABLED` → **404 for every caller class**. Not reachable by members today.

## Request

    GET /api/breadth-monitor/series?keys=<csv>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>

| param | default | rule |
|---|---|---|
| `keys` | *(empty)* | canonical snake_case metric keys, comma separated. **Cap 8** — a 9th is `400`. Repeats are deduped and do not consume the budget twice. |
| `to` | latest stored session | |
| `from` | the **365 most recent stored sessions** ending at `to` | `from > to` → `400` |
| span | — | calendar span capped at **8000 days** (the monitor endpoint's own `le=8000`, not a second ceiling). Over → `400` naming the ceiling. |

## Response — `200 application/json`

```json
{ "from": "…", "to": "…", "sessions": 4530,
  "dates": ["…"], "series": {"breadth_score": [41.0, null, …]},
  "reconstructed": ["…"], "missing": ["not_a_metric"] }
```

- `dates` ascending, **each date once**; every `series` column is the same length as `dates`.
- `sessions == len(dates)`, counted in **stored sessions**, not calendar days.
- **Non-finite (NaN/±inf) and absent both become `null`. Never `0`** — absence is not zero, and a `0` here is a breadth reading a member would act on.
- `reconstructed` lists the dates whose row carries `_reconstructed`.
- `missing` carries requested keys the row schema does not have. **Partial success, never `400`** — one bad key must not lose the good ones. All-unknown is still `200` with `series: {}`.

## What counts as a series key

**The authority is the row schema as served by `svc.get_history_deep`** — specifically, a key for which some row holds a **number**. D-035 permitted either this or the chartMetrics registry; the registry is JavaScript and this is Python, so citing it would mean a hand-typed copy — the second-authority defect R1 existed to remove. The served row *is* the set the endpoint can return, so it cannot drift from what is served.

⭐ The numeric constraint is also what keeps `*_list` ticker arrays out **by type** rather than by a second stripper beside the one already inside `get_history_deep`. A key that can never produce a number is not a column, so it is reported in `missing[]` rather than silently dropped.

## Flag first, then paid

`require_series_flag` is declared **before** `require_paid`. FastAPI 0.115.6 resolves a route's dependencies in **declaration order** (`fastapi/dependencies/utils.py:592`), so flag-first is what makes an unset flag a `404` for anonymous, free and paid callers alike. Reverse them and an anonymous probe gets `401`/`402` — which **advertises that a paid route exists here** before it has shipped. `tests/test_breadth_series_endpoint.py` asserts the two **positions**, not just the status codes, because three green status codes are also compatible with a route that 404s for some other reason.

Flag on: free → `402`, paid → `200`.

## Caching

Encoded bytes cached 5 minutes under `breadth_history_series_<sha1(sorted keys|from|to)>`, and the `breadth_history_` prefix is **deliberate**: every snapshot write already calls `cache.delete_prefix("breadth_history_")`, so there is no new invalidation path and none can be forgotten. Key order does not change the cache key. A hit does not re-serialize. `Cache-Control: private, max-age=60` — `private` because the data is paid.

## Cost, and why there is no downsampling

Measured 2026-09-14, B1's **marginal** cost (filter + project + encode) over a full-size row set, 8 keys:

| span | sessions | payload | cold p50 | cold p95 | warm |
|---|---|---|---|---|---|
| 365d | 252 | 15 KB | 8.8 ms | 11.4 ms | 5.8 ms |
| 5y | 1,260 | 75 KB | 13.1 ms | 14.8 ms | 5.2 ms |
| 2008– (18y) | 4,530 | 270 KB | **30.3 ms** | **36.0 ms** | 6.5 ms |

D-035's trigger was "if 2008– with 8 keys exceeds ~1 s cold, add server-side downsampling". It costs **30 ms** — ~33× under it — so **downsampling is deferred**, and `bucket=` is not implemented. Revisit if the payload rather than the time becomes the constraint (270 KB over a phone connection is the number to watch, not the CPU).

⚠️ **These are not a local-DB measurement, and the difference matters.** `C:\data\breadth_monitor.db` on the dev box is 12 KB — schema only — so timing "the 2008– span on the local DB" would have measured an empty table and produced a flattering number. The history reader is stubbed with a full-size row set instead, which isolates what B1 *adds*; `get_history_deep`'s own cost is pre-existing, unchanged, and already cached under its own key.

## Logging

One structured line per request — `keys` count, span, sessions, cache hit/miss, ms. **No member identifier**, so the scrubber has nothing to redact.

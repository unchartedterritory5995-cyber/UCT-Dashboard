# `GET /api/breadth-monitor/series` — the columnar long-history reader (B1, D-035)

**Dark.** Unset `BREADTH_SERIES_ENDPOINT_ENABLED` → **404 for every caller class**. Not reachable by members today.

## Request

    GET /api/breadth-monitor/series?keys=<csv>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>

| param | default | rule |
|---|---|---|
| `keys` | *(empty)* | canonical snake_case metric keys, comma separated. **Cap 8** — a 9th is `400`. Repeats are deduped and do not consume the budget twice. |
| `to` | latest stored session | |
| `from` | the **365 most recent stored sessions** ending at `to` | `from > to` → `400` |
| span | — | capped at **4,700 sessions** (`BREADTH_SERIES_MAX_SESSIONS`), enforced as **7,520 calendar days** = `4,700 × 1.6`. Over → `400` naming both numbers. |

### The span cap, and why it is checked before the read

⛔⛔ **RAISED 2026-09-17 (L-A) from a 365-session cap.** This section previously said a cold deep
read cost *"~55 s on the single web process (D-042)"* and left the cap at 365 sessions until "the
reader has its own programme" — that programme (the Breadth History Reader) closed in this same
session, with `get_history_deep` materialized (*"used to assemble 174,187 OHLC rows into 4,529 rows
on every cold request; it is now one indexed read of pre-built rows"*). The 55 s figure described
the reader BEFORE that fix and was true when written, not when this cap was still being enforced by
it (Kind 3b — see `CLAUDE.md`).

The reader's current, measured, per-deploy cost — `docs/breadth-history-reader/FINAL.md` §14.1/§14.3
— is **p50 277.2-497.2 ms across six deploys, worst observed deploy max 3,752.1 ms**, against
D-042's 54,923 ms cold baseline (15x-141x depending on deploy; that table was measured against
`/api/breadth-monitor`, a different route sharing this reader, so only the reader cost transfers).
Combined with this endpoint's own measured marginal cost below (~30-36 ms at full span), a cold
full-history request is dominated by the reader and nowhere near 55 s.

**4,700 sessions is sized to cover V2-3's back-to-2008 "Max" preset** (`MAX_HISTORY_FROM` in
`BreadthChartsV2.jsx`) — ~4,700 stored sessions from 2008-01-02 to 2026-09-17 — with real margin,
not raised to "unlimited": a fixed session count against a fixed start date, so the margin shrinks
by ~252 sessions/year as "today" advances.

⛔ **The 400 is raised BEFORE the read.** Counting sessions requires reading them, so a post-read
rejection has already paid the reader cost it exists to prevent — the check is therefore on calendar
days, which are knowable from the request alone.

⭐ **×1.6 is generous on purpose, in the safe direction.** A year holds ~252 sessions in 365
calendar days, so a session cap enforced as an equal number of days would 400 a genuine full-span
request. Erring wide admits at most a few hundred extra rows; erring narrow refuses the request the
cap is sized to allow.

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

✅ **The 5y and 2008– rows are reachable through `/series` again as of the 2026-09-17 cap raise** —
they were briefly stated as unreachable while the cap sat at 365 sessions. They are also what
settled the downsampling question below, independent of whether the cap covers them.

D-035's trigger was "if 2008– with 8 keys exceeds ~1 s cold, add server-side downsampling". It costs **30 ms** — ~33× under it — so **downsampling is deferred**, and `bucket=` is not implemented. Revisit if the payload rather than the time becomes the constraint (270 KB over a phone connection is the number to watch, not the CPU).

⚠️ **These are not a local-DB measurement, and the difference matters.** `C:\data\breadth_monitor.db` on the dev box is 12 KB — schema only — so timing "the 2008– span on the local DB" would have measured an empty table and produced a flattering number. The history reader is stubbed with a full-size row set instead, which isolates what B1 *adds*; `get_history_deep`'s own cost is pre-existing, unchanged, and already cached under its own key.

## Logging

One structured line per request — `keys` count, span, sessions, cache hit/miss, ms. **No member identifier**, so the scrubber has nothing to redact.

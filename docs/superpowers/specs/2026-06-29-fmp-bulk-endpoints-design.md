# FMP Bulk Endpoints — Nightly Job Speedup — Design

**Date:** 2026-06-29
**Status:** Approved design → implementation plan
**Feature group:** FMP Ultimate build-out (C of 3; siblings: analyst-intel, institutional-ownership)

## Summary

Replace the **per-ticker** fundamental fetch loops in the nightly batch jobs with
FMP Ultimate **bulk** endpoints (one request returns profile / ratios /
key-metrics / grades for the entire market), cutting thousands of per-ticker
yfinance/Finnhub/FMP calls per run down to a handful. Backend-only; no UI. Gated
behind a flag with the existing per-ticker path kept as a verified fallback.

## Target jobs (confirm exact files during implementation)
1. **Ratings-percentile universe gather** — the nightly `cap_universe`
   percentile job (`ratings_universe.py` / `ratings_db.py`) that fetches
   fundamentals + RS/AccDis per ticker to build `/data/research_ratings.db`
   distributions (~3,700 tickers, ~1 yfinance call each = the slow part).
2. **Screener-universe snapshot** — the nightly precompute that builds
   `/data/screener.db` (descriptive/fundamental fields per ticker).

Both currently iterate the universe with bounded pools + polite sleeps because
the per-ticker vendors rate-limit. A single bulk pull removes that constraint for
the fields FMP provides.

## Architecture

### New service — `api/services/fmp_bulk.py`
Thin client over FMP Ultimate bulk endpoints (verify exact paths live; FMP
exposes `stable/profile-bulk`, ratios / key-metrics / grades bulk variants):
- `fetch_profile_bulk() -> dict[sym, profile]`
- `fetch_ratios_bulk(period) -> dict[sym, ratios]`
- `fetch_grades_bulk() -> dict[sym, grades]`

Each returns a **`{symbol: fields}` map** parsed from the bulk CSV/JSON, cached
on disk per run (date-keyed) so the two jobs share one pull. Bounded, retried,
best-effort: on any failure returns `{}` so callers fall back to per-ticker.

### Job integration (additive, gated)
- Each job, when `FMP_BULK_ENABLED=1`, calls the relevant bulk fetch **once** at
  the start, builds the symbol→fields map, and reads from it in the per-ticker
  loop; only tickers **missing** from the bulk map fall through to the existing
  per-ticker fetch. So coverage is never worse than today, just faster.
- Off (default until verified) → unchanged behavior.
- Locked invariant: bulk is an **optimization layer**, never the sole source —
  the per-ticker fallback stays wired so a bulk gap or schema drift can't blank a
  ticker's rating/screen.

## Data flow

```
nightly job start
   │  FMP_BULK_ENABLED=1
   ▼
fmp_bulk.fetch_*_bulk() → {symbol: fields}  (one pull, disk-cached for the run)
   ▼
per-ticker loop: bulk map hit → use it ;  miss → existing per-ticker fetch
   ▼
/data/research_ratings.db  ·  /data/screener.db
```

## Error handling
- Bulk fetch failure → `{}` → every ticker uses the per-ticker path (today's
  behavior). Logged, never raises.
- Partial bulk (some symbols missing) → those symbols use per-ticker. No silent
  coverage loss; `log()` the bulk hit-rate per run.

## Testing
- `tests/test_fmp_bulk.py`: bulk parse (CSV/JSON → symbol map), empty/failed pull
  → `{}`, hit/miss merge logic (a ticker absent from bulk falls back).
- Job-integration tests: with a mocked bulk map, the job reads bulk for present
  tickers and calls the per-ticker fetch only for missing ones (assert call
  counts). Gate off → per-ticker path unchanged.
- Real-run smoke: one gated run logging bulk hit-rate + wall-clock vs baseline.

## Files
| Path | Change |
|------|--------|
| `api/services/fmp_bulk.py` | **new** bulk client + per-run disk cache |
| `api/services/ratings_universe.py` (confirm) | gated bulk read in the gather loop |
| screener-universe snapshot builder (confirm path) | gated bulk read |
| `tests/test_fmp_bulk.py` + job tests | coverage |

## Env / config
- `FMP_BULK_ENABLED=1` — master gate (default off until live-verified).
- Reuses `FMP_API_KEY`.

## Open implementation-time questions (non-blocking)
- Confirm exact FMP bulk endpoint paths + response format (CSV vs JSON) and which
  fields each job actually needs (so we pull only those bulk variants).
- Confirm the screener snapshot builder's file/function name.
- Whether RS/AccDis (computed from local bars, already zero-network) stays
  per-ticker — yes; bulk only replaces the vendor-fundamentals calls.

# UCT Ratings — True Universe Percentile Ranks (Phase 2)

**Date:** 2026-06-17
**Status:** Shipped (gated off by default)
**Follows:** `2026-06-17-fundamental-snapshot-design.md` (Phase 1)

## Goal

Turn the UCT Ratings from **absolute threshold bands** into **true IBD/MarketSmith-style
percentile ranks (1-99) vs the cap universe** — so an EPS Rating of 95 means "top 5% of
the universe," an RS Rating is a real relative-strength percentile, and the A–E letter
grades (SMR / Acc-Dis / Sponsorship) are true universe quintiles. This is the calibration
the user asked for ("ratings should be trustworthy").

## Architecture

Three layers, all additive, with a bulletproof absolute-band fallback.

### 1. Storage — `api/services/research/ratings_db.py` → `/data/research_ratings.db`
- `ticker_metrics(sym, <10 raw metric cols>, updated_at)` — raw rankable values per ticker.
- `metric_distributions(metric, sorted_values JSON, n, computed_at)` — universe distribution per metric.
- `percentile(metric, value, invert)` — bisect into the sorted distribution → 1-99
  (`round(pos/n * 98 + 1)`, clamped). `invert=True` for lower-is-better (PEG/value).
- Distributions parsed once + **memoized in-process 10 min** so the hot request path is cheap.
- WAL + `contextlib.closing`; never raises (degrades to `None`/`{}`).
- A distribution needs ≥ `RATINGS_PERCENTILE_MIN_SAMPLE` (default 200) real values to be used.

### 2. Nightly gather — `api/services/research/ratings_universe.py`
Walks `cap_universe` (3,715) and persists each ticker's raw metrics, then rebuilds
distributions. **Cost discipline:**
- **RS return + Acc/Dis from LOCAL cached daily bars** (`bars_sqlite.get_bars(sym,"D",300)`)
  — zero network, reuses the chart pre-cache.
- **Fundamentals = exactly ONE `get_fundamentals` (`.info`) call per ticker**, via the
  bounded yfinance pool with a hard timeout, processed sequentially with a politeness sleep.
- **Incremental + capped:** only tickers with metrics older than `REFRESH_TTL` (default 6d)
  are refreshed, ≤ `MAX_PER_RUN` (default 800) per run → universe warms over ~5 nights,
  each night bounded.
- `get_fundamentals` gained `held_pct_institutions` (free from the same `.info`) to feed
  the sponsorship percentile without a second fetch.

### 3. Read-path — `api/services/research/ratings.py`
`get_ratings` loads the distributions once; for each component it ranks against the
distribution when present, else falls back to the existing absolute band:
- EPS ← pct(`earnings_growth`) · RS ← pct(`rs_return`) · Growth ← pct(`blended_growth`)
- Value ← `100 - pct(peg)` (inverted) · else absolute value score
- SMR ← mean of pct(rev_growth, op_margin, roe) → quintile letter (`_letter`)
- Acc/Dis ← `_letter(pct(accdis_ratio))` · Sponsorship ← `_letter(pct(inst_pct))`
- Composite = unchanged weighted blend over the (now percentile) component numbers.
- Output gains `basis` (`'percentile'|'absolute'`) + `universe_n`; `method` string updates
  to "Percentile rank vs N-stock universe" — propagated to the snapshot card + RatingsTab
  footer with **zero frontend change** (number/letter shapes are identical).

### Scheduler + admin — `api/main.py`, `api/routers/research.py`
- Nightly cron **2:30 AM ET** + startup catch-up if distributions are stale (>36h), both
  gated by `RATINGS_PERCENTILE_ENABLED` (default **off**). When off: no jobs, ratings see no
  distributions → absolute mode (today's exact behavior). 100% safe to ship dormant.
- `GET /api/research/ratings-percentile/status` (read) — coverage + usable + enabled.
- `POST /api/research/ratings-percentile/refresh` (admin) — background force-run to warm
  before enabling the flag.

## Enablement (operator)

1. Deploy (ships dormant).
2. `POST /api/research/ratings-percentile/refresh?max_per_run=800` a few times (or just set
   the flag and let nightly + startup catch-up warm it) to populate distributions.
3. Set `RATINGS_PERCENTILE_ENABLED=1`. Ratings flip to percentile once distributions pass
   the min-sample gate. Verify via `/api/research/ratings-percentile/status`.

## Tunables (env)
`RATINGS_PERCENTILE_ENABLED` (off) · `_MIN_SAMPLE` (200) · `_REFRESH_TTL` (6d) ·
`_MAX_PER_RUN` (800) · `_SLEEP` (0.1s) · `_FETCH_TIMEOUT` (12s) · `_STALE_AFTER` (36h) ·
`RESEARCH_RATINGS_DB_PATH`.

## Tests
- `tests/test_ratings_db.py` (7) — percentile math: monotonic/bounded, median≈50, inverted
  PEG, min-sample gate, empty DB.
- `tests/test_ratings_universe.py` (6) — offline gather: local+fundamentals compose,
  incremental skip, cap, disabled gate.
- `tests/test_ratings_percentile.py` (5) — read-path: absolute fallback (eps=98 band),
  percentile mode (mid→~50, letters→C), low-PEG ranks high, per-component degrade.
- Existing research suite stays green (47 total). Live forced run verified: ticker A →
  `basis=percentile`, EPS rank 95, all 9 distributions built incl. `rs_return` from local bars.

## Cost
RS/Acc-Dis are free (local bars). Fundamentals = 1 yfinance `.info`/ticker, capped at
~800/night with politeness sleeps → bounded, off-market (2:30 AM ET), on the scheduler pod.
Re-runs skip fresh tickers (6-day TTL) so steady-state is ~1/6 of the universe per night.

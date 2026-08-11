# Breadth History — Phase 3: Historical Intraday WICKS (design)

**Date:** 2026-08-11
**Status:** proposed
**Depends on:** Phase 1 (deep close-basis bodies, shipped) + the worker→R2 bridge
(`breadth_ohlc_sync`, shipped). Independent of Phase 2 (survivorship universe).

---

## 1. Goal

Replace the body-only `close_recon` candles with **real high/low wicks** on the
breadth-symbol charts, back as far as intraday data allows. Today every historical
candle (2008 → ~6 days ago) is a close-to-close body — one value per day, so
`high = max(open, close)`, `low = min(open, close)`, no wick. Only `'live'` rows
(the intraday accumulator, running since 2026-08-06) carry real wicks. Phase 3
gives the past the same treatment.

## 2. What a breadth wick actually IS — and the shortcut that must NOT be used

A breadth metric's intraday **high/low is the max/min of the breadth VALUE over the
session**. E.g. "% above 50MA" might open 60, dip to 55 midday, close 58 → H=60,
L=55, C=58.

⛔ **The failed shortcut (do not repeat):** the first wick attempt computed the
breadth-high from every stock's *daily* high and the breadth-low from every stock's
*daily* low — i.e. it assumed **all stocks hit their intraday extremes at the same
instant**. They don't. That produced absurd ~50-point-wide wicks (e.g. an O132→C20
candle) and the owner correctly rejected it. **A breadth wick is a property of the
cross-section AT A MOMENT, not an aggregate of per-stock extremes.**

✅ **The correct method:** recompute the whole-market breadth at several moments
THROUGH each past day (using each stock's price at that moment), forming an intraday
breadth *series*, and take that series' max/min. This is exactly what the live
accumulator does in real time — Phase 3 just **replays it over historical intraday
bars**.

## 3. The method — replay the live compute at N intraday timestamps/day

For each past session `D`:

1. **Levels are fixed for the day.** `levels_D = build_levels(prior daily closes
   through D-1)` — the per-stock MAs / lookback references. This is the SAME
   `breadth_live.build_levels` Phase 1 already uses (`_metrics_at_close`), so the
   daily frame is reused, not rebuilt.
2. **Sweep intraday buckets.** For each 30-min bucket `T` in `D` (≈13 RTH buckets),
   take the universe's price at `T` and call
   `breadth_live.compute_metrics(levels_D, prices_T, vols_T)` → the full metric dict
   **at that moment** (same function the EOD/live paths call — consistency by
   construction, and the ~44 metrics all come out together).
3. **Aggregate O/H/L/C per metric** over the day's buckets: `open` = first bucket,
   `high` = running max, `low` = running min, `close` = **the authoritative EOD
   value** (the existing `close_recon`/collector close — NOT the last intraday
   bucket, so the body still ties out to the number of record). This mirrors
   `breadth_daily_ohlc.update_intraday`, just fed historical snapshots.
4. **Write** `source='intraday_recon'` rows (§6).

Because step 2 is the exact live cross-sectional method, the wick is honest: it is
"how far did whole-market breadth actually swing intraday," not a per-stock-extremes
fantasy.

**Resolution is a tunable.** 30-min (13 buckets) captures the meaningful swings at
~1/6 the I/O of 5-min; finer resolution captures slightly wider true extremes. Start
at 30-min; expose `BREADTH_WICK_BUCKET_MIN`.

## 4. Data source — Massive S3 minute flat files (infra already exists)

`api/services/build_intraday_cache.py` already does the hard part:
`download_and_resample(client, s3_key, timeframes, tickers_filter)` pulls a day's
1-minute `CSV.GZ` from the Massive **`flatfiles`** S3 bucket, groups by ticker,
resamples to target TFs, and filters to a ticker set — **one bulk file per day for
the whole market**, memory-safe (each day processed then dropped). Phase 3 reuses
this to get the universe's 30-min bars per past day.

- **One flat file per day** (all tickers) — NOT per-ticker fetches. A per-ticker
  intraday pull would be ~2,657 calls/day × thousands of days = untenable; the flat
  file is one download.
- Creds/pattern already in place: `get_s3_client()` (boto3, `MASSIVE_S3_*`),
  same rail `deep_history_warm` / `_build_deep_cache` use.
- **Filter to the breadth universe** (`_resolve_universe()` from Phase 1) at parse
  time so only ~2,657 tickers are retained per day.

## 5. Compute pipeline (per chunk, on the worker)

```
for D in chunk (newest→oldest):
    levels_D  = build_levels(deep_frame slice through D-1)      # reuse Phase-1 frame
    day30     = download_and_resample(s3, key(D), [30], universe)  # {ticker: [30m bars]}
    if coverage(day30) < MIN_INTRADAY_COVERAGE:  mark D body-only, continue  # §9
    agg = {}                                   # metric -> [o,h,l,c]
    for T in buckets(D):                       # ~13 RTH timestamps
        prices_T, vols_T = prices_at(day30, T)
        m = compute_metrics(levels_D, prices_T, vols_T)         # the live method
        for k,v in m.items(): roll_ohlc(agg[k], v)
    close_D = existing close_recon/collector close for D        # authoritative body close
    rows = [(D, k, agg[k].o, agg[k].h, agg[k].l, close_D) for k in agg]
    write_bulk(rows, source='intraday_recon', overwrite_close_recon=True)
    breadth_ohlc_sync.upload()                                  # ship chunk → web
```

Cost is **I/O-bound** (downloading years of daily minute flat files); the per-day
numpy compute is cheap. Same worker-pod + chunked + resumable + R2-bridge shape as
Phase 1 — this is why Phase 1's infra was built to be reused.

## 6. Storage & precedence

Extend `breadth_daily_ohlc`:
- **New source `'intraday_recon'`** added to `_TRUSTED_SOURCES`.
- **Fidelity precedence: `live` > `intraday_recon` > `close_recon`.**
  - `intraday_recon` **overwrites** a `close_recon` body (upgrade to a wick) — add an
    `overwrite_close_recon` path to `write_bulk`/`set_ohlc`.
  - `intraday_recon` **never** overwrites a real `'live'` row (the accumulator's
    same-day truth wins), mirroring the existing `overwrite_live=False` guard.
- `build_breadth_bars` already renders a wick whenever the store row's `h/l` exceed
  the body (§ line 354-357), so **no chart change needed** — an `intraday_recon` row
  with a real `h`/`l` just starts drawing a wick.
- Merge/bridge unchanged: the R2 gap-fill already ships `_TRUSTED_SOURCES`; add
  `intraday_recon` there too. Because Phase-3 rows overwrite `close_recon`, the web
  merge needs a **source-precedence upgrade** (not pure gap-fill) for this source:
  adopt an `intraday_recon` row even when the date exists, iff local is `close_recon`
  (never over `live`). Small, explicit extension of the merge rule — test it.

## 7. Validation harness (THE guard against another garbage-wick ship)

The wick bug shipped once; it must not again. Before any `intraday_recon` chunk is
trusted:

- **Wick-width sanity.** The daily `high−low` of a breadth metric has a plausible
  ceiling (a % metric rarely swings >~15 pts intraday on a normal day, more only on
  a true washout). Flag/withhold days whose reconstructed wick exceeds a
  metric-typed bound — that is the exact signature of the old bug.
- **Ordering & close tie-out.** `h ≥ max(o,c)`, `l ≤ min(o,c)`, `h ≥ l`; and the
  intraday *last bucket* must land within tolerance of the authoritative EOD close
  (large divergence ⇒ suspect intraday data → body-only fallback for that day).
- **Coverage gate.** Require ≥ `MIN_INTRADAY_COVERAGE` of the universe present in the
  day's flat file (else the cross-section is a different market — body-only fallback,
  logged, never silently).
- **Known-day spot-checks.** A volatile day (2020-03-16/18) must show a WIDE-ish but
  bounded wick; a quiet drift day a NARROW one. Add fixtures.
- **Never silently truncate.** Every body-only fallback (missing data, failed gate)
  is logged/counted so "we have wicks 2019→now, body-only before" is a *measured*
  statement, not an assumption.

## 8. Rollout (staged, reversible — mirrors Phase 1 §8)

1. **Ship dark** (flag `BREADTH_WICKS_ENABLED`, worker-only).
2. **Prototype one recent month** (clean intraday data) → eyeball the wicks on
   UCTA50/UCTA200/UCTNL20; confirm widths are realistic (a few points, not 50).
   Validate against the live-accumulator wicks on the overlap week (they should
   agree closely).
3. **One older chunk** (e.g. a 2020 quarter) → confirm the crash-era wide wicks are
   bounded/plausible, web stays 200.
4. **Grind back** year by year on the worker (floor-marker + R2 bridge), validating
   each chunk, until intraday data runs out.

## 9. Known limits / non-goals

- **Depth tapers with intraday data.** Massive minute flat files reach back a finite
  distance (verify the floor — likely ~2003-2015 for full-universe SIP minute aggs;
  confirm coverage per year). Years without adequate intraday coverage **stay
  body-only** (`close_recon`) — that is correct, not a gap to paper over. Expect
  accurate wicks for recent years, thinning further back.
- **Survivorship unchanged.** Phase 3 uses the same universe as Phase 1 (today's
  ~2,657) unless Phase 2 lands first; the wick sits on the same population as its
  body, so no new bias is introduced.
- **Metrics that have no intraday meaning** (pure EOD constructs, e.g. anything the
  live accumulator already refuses to sample) get **no wick** — `compute_metrics`
  emits them, but they render body-only, same as live. Don't fabricate a wick for a
  metric that can't have one.
- **Not a live-path change.** Going forward the live accumulator already writes
  wicks; Phase 3 is purely historical backfill.

## 10. Task breakdown

1. `breadth_wick_recon.py` (new, worker): per-day intraday pull
   (`build_intraday_cache.download_and_resample` reused) → per-bucket
   `compute_metrics` replay → per-metric OHLC aggregation → `write_bulk(source=
   'intraday_recon')`. Chunked + floor-marker + resumable (clone Phase-1 shape).
2. `breadth_daily_ohlc`: add `'intraday_recon'` to `_TRUSTED_SOURCES` +
   `overwrite_close_recon` write path (never over `live`). Tests.
3. `breadth_ohlc_sync`: extend the merge to a **source-precedence upgrade** for
   `intraday_recon` over `close_recon` (never over `live`). Test the new rule.
4. Worker thread + flags (`BREADTH_WICKS_ENABLED`, `BREADTH_WICK_BUCKET_MIN`,
   `BREADTH_WICK_FLOOR`, `MIN_INTRADAY_COVERAGE`), mirroring
   `_start_breadth_backfill`.
5. **Validation harness (§7)** + known-day fixtures — land BEFORE the first real
   chunk.
6. Rollout per §8; verify intraday-data depth per year as it grinds.

---

### Files to build on
- `api/services/build_intraday_cache.py` — `get_s3_client`, `download_and_resample`
  (the per-day universe intraday pull).
- `api/services/breadth_live.py` — `build_levels`, `compute_metrics`,
  `_metrics_at_close` (the cross-sectional method to replay per bucket).
- `api/services/breadth_daily_ohlc.py` — `write_bulk`, `set_ohlc`, `_TRUSTED_SOURCES`,
  `history` (the store + precedence).
- `api/services/breadth_ohlc_sync.py` + `breadth_history_recon.py` — the worker
  thread / chunk / floor-marker / R2-bridge shape to clone.
- `api/services/breadth_symbols.py::build_breadth_bars` — already renders a wick when
  the row's h/l exceed the body (no change needed).

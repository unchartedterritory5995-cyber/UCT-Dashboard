# Breadth History — Phase 2: Survivorship-Free Point-in-Time Universe (design)

**Date:** 2026-08-11
**Status:** proposed
**Depends on:** Phase 1 (deep close-basis bodies, shipped) + the worker→R2 bridge.
Independent of Phase 3 (wicks) — they compose (Phase 3 wicks sit on Phase 2's
universe).

---

## 1. The problem Phase 2 fixes

Phase 1 reconstructed deep breadth using **today's ~2,657-name universe**. For old
years that is **survivorship-biased**: the companies that later went to zero
(Lehman, WaMu, Bear, hundreds of 2008–09 casualties) are ABSENT, so historical
breadth reads slightly **too strong** — the weak names that would have dragged
"% above the 200-day" down in 2008 aren't in the denominator. The *shape* is right;
the *absolute level* is optimistic the further back you go.

Phase 2 recomputes each past day over the **universe that actually existed on that
day**, including names later delisted — so the level is honest, not just the shape.

## 2. The key data insight — grouped-daily IS survivorship-free

`massive.get_grouped_daily_closes(day_iso)` (Polygon grouped-daily,
`/v2/aggs/grouped/locale/us/market/stocks/{date}`) returns **every ticker that
traded that day** with its OHLCV — in ONE call. A delisted stock appears on exactly
the days it traded and then stops. So a frame built by stacking grouped-daily across
dates is **the real point-in-time market**, delisted names included, with **zero
per-ticker fetching** and no reliance on a curated delisted list. This is the spine
of Phase 2.

- **One call per day** (~250/yr), not per-ticker. Already cached on disk per
  `(date, adjusted)` (`_GROUPED_DIR`).
- ⚠️ Use it for BOTH prices AND volume — the endpoint carries volume; add/confirm a
  volume-preserving variant (`get_grouped_daily_closes` may keep only `c`). Volume
  is required for the liquidity proxy (§4).

## 3. What still needs `/v3/reference/tickers`

Grouped-daily gives prices but not **security type**. The breadth universe is US
**common stock** — not ETFs, ADRs, warrants, units, rights. `/v3/reference/tickers`
(active **and** `active=false` for delisted) carries `type` (`CS`/`ETF`/…),
`list_date`, `delisted_utc`, and identity keys (`cik`, `composite_figi`).
- **New fetcher needed:** `massive.list_reference_tickers(active: bool)` — paginated
  enumeration (cursor). massive.py today has only the SINGLE-ticker
  `/v3/reference/tickers/{ticker}`; add the list form. Cache to disk (it changes
  slowly); refresh weekly.
- Use it as a **type + identity map**, and to resolve **ticker reuse** (a symbol
  delisted then reassigned): key on `composite_figi`/`cik` + the active window
  (`list_date … delisted_utc`), not the bare symbol — symbol continuity is the real
  work (see `[[delisted-tickers-massive-coverage]]`).

## 4. The eligibility proxy — the make-or-break approximation

Today's universe is cap/liquidity-filtered. We have **no clean historical
shares-outstanding**, so a true point-in-time *market-cap* filter is impossible.
Approximate the investable set with a **price + trailing-dollar-volume** proxy over
the survivorship-free frame:

```
eligible(D) = { t : type[t]=='CS'
                  and list_date[t] ≤ D ≤ (delisted_utc[t] or ∞)
                  and close[t,D] ≥ PRICE_MIN
                  and median_{20d}(close·volume)[t] ≥ DOLLARVOL_MIN }
```

⭐ **This proxy is Phase 2's entire risk, so it is CALIBRATED, not guessed.** On
recent dates we KNOW the real universe (the collector's stored `universe_list`).
Tune `PRICE_MIN` / `DOLLARVOL_MIN` / window so the proxy reproduces that set as
closely as possible, then freeze the thresholds and apply them backward.

## 5. Calibration-FIRST de-risking (do this before any grind)

The whole phase lives or dies on §4. So the FIRST deliverable is a calibration
harness, not a backfill:

1. Pull `/v3/reference/tickers` (type/window map) + grouped-daily for the last ~60
   trading days.
2. Sweep `(PRICE_MIN, DOLLARVOL_MIN, window)` and, for each recent date, compare the
   proxy universe to the collector's stored `universe_list`:
   **precision / recall / |size Δ| / Jaccard**.
3. **Gate:** pick the thresholds that best reproduce the known universe. If the best
   achievable overlap is high (target Jaccard ≥ ~0.9, size within a few %), the proxy
   is trustworthy → proceed. **If it can't reproduce even the KNOWN universe, Phase 2
   is fundamentally limited** — stop, report, and keep Phase-1 (today's-universe)
   history with a documented caveat rather than shipping a worse-but-different level.
4. Sanity-check backward: the eligible COUNT over time should look sane (grows with
   the market; expands in the late-90s/2000s listing boom; the count itself is a
   breadth signal and must not swing wildly from threshold artifacts).

## 6. Recompute (reuses Phase 1, swaps the universe per date)

Once calibrated, this is Phase 1's engine with a **per-date universe** instead of a
fixed one:

```
for chunk (date range), on the WORKER:
    frame = stack grouped-daily over [chunk.start-560d … chunk.end]   # survivorship-free closes+vols
    for D in chunk:
        uni_D  = eligible(D)                          # §4, point-in-time
        levels = build_levels(frame slice for uni_D through D-1)
        m      = compute_metrics(levels, closes_at_D for uni_D)   # same live method
        write close-basis body for D over uni_D
    breadth_ohlc_sync.upload()
```

- **Same worker-pod + chunk + floor-marker + R2-bridge shape as Phase 1.** Memory:
  the frame is now the whole market (~8–10k tickers/day), so keep the streaming
  preallocated-numpy loader and chunk tighter (memory scales with tickers × window).
- **Output is still close-basis bodies** (`source='close_recon'`) — Phase 2 changes
  the *universe*, not the candle type. It **overwrites** the Phase-1 survivorship
  bodies with survivorship-free ones. (Optionally tag `close_recon_pit` to
  distinguish provenance; the chart renders identically.)
- **Universe stored per date.** Persist `universe_count` (and ideally the member
  list) per day so the drill-downs and the `UCTX`/count metrics are consistent, and
  so Phase 3 wicks later reuse the SAME point-in-time set.

## 7. The 2024→now seam

The collector's real `universe_list` governs 2026-01-02→now, and Phase 1 already
used it for 2024→now. Phase 2 only rewrites the **pre-collector** era. At the seam,
the proxy universe must **tie into** the collector universe (that's exactly what §5
calibration guarantees) so there's no discontinuity where reconstruction meets real.

## 8. Rollout (staged, reversible — mirrors Phase 1 §8)

1. **Calibration harness first** (§5) — ship dark, run on the worker, PROVE the proxy
   reproduces the known universe. Gate everything on this.
2. Recompute **one recent-ish year** (e.g. 2022) where survivorship barely matters →
   confirm it matches Phase-1 within noise (a control: little should change).
3. Recompute **2008–09** → confirm the level drops the RIGHT way (more names, more
   weak names → lower "% above 200MA" at the lows) and validate against the textbook
   extremes with the corrected denominator.
4. Grind the middle years; validate the eligible-count curve is smooth.

## 9. Risks & non-goals (state them, don't paper over)

- **Proxy fidelity is the risk.** Mitigated by calibrate-first + the hard gate (§5).
  A liquidity proxy will never be byte-identical to a cap filter; the bar is
  "materially more accurate than survivorship bias," measured against the known
  universe, not perfection.
- **Ticker reuse / identity.** Key on figi/cik + active window, never bare symbol.
- **Depth.** Grouped-daily + delisted coverage reaches ~2003 (Massive). Pre-2003
  is out of scope (Norgate-only, per `[[delisted-tickers-massive-coverage]]`).
- **Adjusted vs raw.** Match Phase 1 / the collector's basis (dividend-adjusted for
  long-lookback comparisons — see `breadth_live` §basis; use the same
  `_apply_dividend_basis` path so Phase 2 doesn't reintroduce the basis gap).
- **NOT a live-path change.** Live/collector universe is unchanged; Phase 2 is
  historical reconstruction only.

## 10. Task breakdown

1. `massive.list_reference_tickers(active)` — paginated CS/ETF/… + list/delist +
   figi/cik map, disk-cached. Test the pagination + parse against a captured page.
2. Volume-preserving grouped-daily (confirm/extend `get_grouped_daily_closes`).
3. `breadth_pit_universe.py`: pure `eligible(day_rows, type_map, thresholds)` +
   point-in-time membership + trailing-dollar-vol. **Unit-tested** (synthetic rows).
4. **Calibration harness** (`calibrate_pit_universe`): proxy-vs-collector precision/
   recall/Jaccard over recent dates + threshold sweep + the go/no-go gate. Worker
   endpoint to run it + report.
5. Recompute engine: extend Phase-1 `sweep_history`/`load_deep_frame` to a
   grouped-daily whole-market frame + per-date `eligible()` universe; write
   survivorship-free bodies; worker thread + floor-marker + R2 bridge.
6. Rollout per §8, gated on §5.

---

### Files to build on
- `api/services/massive.py` — `get_grouped_daily_closes` (survivorship-free
  per-day OHLCV), `get_agg_bars`/`get_daily_agg`, single-ticker
  `/v3/reference/tickers/{ticker}` (extend to the list form).
- `api/services/breadth_live.py` — `build_levels`, `compute_metrics`,
  `_apply_dividend_basis` (recompute over the per-date universe).
- `api/services/breadth_history_recon.py` — Phase-1 sweep/frame/floor/bridge shape
  to extend (whole-market frame + per-date universe).
- `api/services/breadth_daily_ohlc.py` + `breadth_ohlc_sync.py` — store + bridge
  (overwrite Phase-1 close_recon with the survivorship-free recompute).
- The collector's stored `universe_list` (via `breadth_monitor.get_history` /
  `get_drill_list`) — the ground truth the proxy is calibrated against.

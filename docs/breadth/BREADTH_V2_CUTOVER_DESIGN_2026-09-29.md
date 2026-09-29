# Breadth V2 cutover — Phase 0 audit + design, STOPPED before implementation (2026-09-29)

Base: `origin/master` `14cb488e5` (production `7cc6f7b1b`). Frozen V2c2:
`/data/_audit/v2cc/final/breadth_v2c2div_FINAL_v20260924f_VALIDATED_FROZEN_2026-09-29.db`,
sha256 `5670fdc0…904e`, 611,018 rows, ends 2026-09-24. Nothing in production was changed.

## Phase 0 — how Breadth works TODAY (measured)

**What members see is three layers, not one store.**

| Layer | Store | Writer | Member surfaces |
|---|---|---|---|
| EOD row (79 fields incl. VIX/AAII/NAAIM/SPY/QQQ + 35 breadth metrics) | web `breadth_monitor.db` `breadth_snapshot_numeric` | external 4:15 PM collector `POST /api/breadth-monitor/push`; `breadth_self_heal.heal_date`; `breadth_eod_source` | Monitor table/grid, `/series`, `/latest`, score, analogues; **the collector CLOSE also overrides the OHLC close on charts** (`breadth_symbols._build_breadth_bars` 731-740) |
| Daily OHLC (wicks + deep history before the collector floor) | web `/data/breadth_daily_ohlc.db` `breadth_daily_ohlc` | W1 `update_intraday` (side effect of GET `/api/breadth-monitor/live`), W2 `backfill_from_intraday` 17:15 ET (overwrites ANY source for the last 4 days), W3/W4 worker sweeps, W5 R2 `_merge_from` | `/api/bars/{UCT*}` candles, `/api/bars-history`, Monitor deep history, Market Indicators |
| Today | `breadth_live.compute_live` on web (Massive snapshot × bars.db levels, split-only basis: `BREADTH_DIVIDEND_BASIS` present/0) | — | live row, today candle (close-to-close) |

- Serving filter: `_TRUSTED_SOURCES = ("live","intraday_recon","close_recon")` (`breadth_daily_ohlc.py:500`); R2 merge `_RANK` live 3 > intraday_recon 2 > close_recon 1 (`breadth_ohlc_sync.py:266`). **Both V2 sources (`intraday_recon_1m`: 596,482 rows; `intraday_recon_1m_body`: 14,536 rows) are rejected by every reader** — not only `_body`.
- Published universes: `BREADTH_LIBRARY_UNIVERSES` → **`uct` only**. `us` exists in the store but is not member-facing.
- Store divergence: web store = the only current one (`uct` live to 2026-09-29, 358,804 rows). Worker store and the R2 `latest` snapshot (uploaded today 12:45Z) end `uct` 2026-08-07 / `us` 2026-09-11, no `live` rows.
- Collector table holds only 185 rows (2026-01-02..2026-09-28), 174 `backfill` + 11 `collector`.
- V1 `uct` gaps inside 2026-03-23..09-24: **08-14, 08-26, 09-08, 09-17** (no rows); and **2026-09-25** (trading day) has no `uct` row at all.
- `update_intraday` preserves a pre-existing row's `o` and `source`; `backfill_from_intraday` rewrites the last 4 sessions (09-24's `live` row was last written 2026-09-28 21:46). `write_bulk` only protects `live`. **Today, a routine job CAN rewrite past sessions.**
- Master's live EMA `breadth_live._ewm_last:567` still does `old_wt += alpha` (pandas adjust=TRUE rule) — the defect the correction branch fixed (124/5,874 validation cells). V1 live `pct_above_20ema` diverges from pandas after any gap. This is larger than the 1-ULP tie.
- None of the correction modules (`breadth_corrected_pass`, `breadth_dividend_basis`, `breadth_grouped_history`, `breadth_adjusted_guard`, `breadth_identity`, `breadth_calendar`, `breadth_ticker`) exist on master. **There is no V2 live producer anywhere in production.**
- Proxy hazard: breadth `/api/bars-history` is not excluded from the worker proxy (bars.py:1220); the worker's stores lack collector + live rows.

## Shadow V1 vs frozen V2, 2026-03-23..2026-09-24 (129 sessions)

Evidence `/data/_audit/cutover/shadow_v1_v2_overlap_20260929.json` (V1 = web extract `v1extract_web_20260929.json` sha a7537d43…; member close = collector where present).

`uct` (member-facing): V2 126 sessions, V1 125. pct-above families: median |Δ| 0.1, p90 0.2–0.5. `universe_count` exact on 92/122. Largest differences are the known self-heal sessions (e.g. 2026-05-26 V1 2,731 vs V2 3,711 names; 06-22..07-09 ≈2,780 vs ≈3,710) → LIVE-STORE INCIDENT. Counts families (near_52w_high p90 363, stage2 p90 380, new_20d_highs p90 200) are dominated by those sessions; **not yet attributed cell-by-cell**.
`us` (not member-facing): V1 ≈3,530 names vs V2 ≈5,560 every session — the known V1 P0-POP population defect → EXPECTED V2 CORRECTION.

## Suspect sessions (dates ≤ 2026-09-24: frozen artifact wins)

| Session(s) | V1 today | V2 frozen | Class |
|---|---|---|---|
| 2026-03-24, 2026-08-31, 2026-09-23 | V1 rows (recon / live) | **no `uct` row** (PIT ledger rejected) | REJECTED — ⛔ cutover would create 3 missing `uct` sessions |
| 26 self-heal sessions (04-06, 05-26, 06-22..07-24) | collector recompute on ~2,780 names | full universe_list | FROZEN_ARTIFACT_AUTHORITY (V1 = incident) |
| Aug 12–20, 09-02 | live rows collapsed; 08-14 absent | present | FROZEN_ARTIFACT_AUTHORITY |
| 08-14, 08-26, 09-08, 09-17 | absent | present | FROZEN_ARTIFACT_AUTHORITY (V2 fills V1 gaps) |
| 2026-09-24 | live, rewritten 09-28 | present | FROZEN_ARTIFACT_AUTHORITY |
| 2026-09-25 → today | 09-25 absent, others `live` | none | REQUIRES V2 LIVE PRODUCER (does not exist) |

## Designed boundary (not implemented)

`authority(universe, date)` is ONE function: `date ≤ 2026-09-24` → frozen artifact rows **only** (read-only attach, `immutable=1`, identity asserted by sha at attach), never the mutable store; `date ≥ 2026-09-25` → a validated V2 live row (state VALIDATED) or, until one exists, the configured fallback. The frozen file is attached, never copied into `breadth_daily_ohlc`, so no live writer can reach it and rollback is a pointer flip (`BREADTH_AUTHORITY=v1|v2`), V1 untouched.
`_body`: accepted as a first-class source ranked below `intraday_recon_1m` (same session cannot hold both — artifact PK is (universe,date,metric)); served as o=h=l=c=close with provenance kept.

## ⛔ Blocking decisions (owner) — why implementation did not start

1. **UCT history before 2026-03-23.** Frozen V2 has canonical `uct` only from 2026-03-23 (owner decision, `canonical_uct_start`). Before that it has `uct_backtest` — the retrospective research universe the owner has not accepted. Members see `uct` back to 2008 today. Options: (a) V2 `uct` history starts 2026-03-23 (members lose 18 years), (b) splice `uct_backtest` (retrospective membership), (c) V1 before 2026-03-23, V2 after (mixed methodology, disclosed).
2. **PIT-rejected sessions** 03-24 / 08-31 / 09-23 have no V2 `uct` value. Serve a gap, or V1 flagged, or rebuild? A cutover that silently creates missing sessions violates the acceptance rule.
3. **Which layer V2 replaces.** V2 covers 35 breadth metrics' OHLC only. The collector's EOD close currently OVERRIDES the OHLC close in charts and IS the Monitor table. Does V2 override the collector for those 35 metrics (Monitor numbers change for members; derived `breadth_score`, `mcclellan_osc`, `adv_decline_cum` inherit it), or only chart wicks/deep history?
4. **Live V2 currentness is not buildable today as a "live" path.** V2 needs the session's minute flat file (published after the session) plus a fresh one-window vintage (grouped closes + dividends + splits + FX + PIT ledger, ~14 min) — so session D is producible D+1 at the earliest, on the runner, which is not a production service. Owner must choose: V2 authoritative for completed sessions with a V1/collector provisional tail (mixed authority, labelled), and which production service owns the daily V2 producer.
5. **Membership identity.** `uct` = PIT ledger (deterministic if the ledger snapshot is stored per session — design ready). `us/nasdaq/nyse` = vintage `pit_reference.json` (a refreshing cache) — reruns with a later vintage CAN change membership. Each live session must store `(pit_ledger_sha, reference_sha, vintage)`; methodology stays as-is. Not blocking once stored; blocking if the owner wants rerun-stability across vintages.
6. **EMA for live V2.** Recommend a Breadth-scoped fix: skip the update when the observation equals the current EMA (pandas' behaviour) — exact on NEBU/CCH/TWNT/NGC fixtures, unchanged otherwise; versioned `ema_rule` in provenance; at the 09-24→09-25 seam only exact-tie names can differ (±1 name). Separately, V1 live's `+= alpha` defect is a live member-facing bug outside this cutover.

## What remains (shortest path)

Owner decisions 1–4 → then: port correction modules to master behind the authority seam; `_body`/`_1m` provenance + tests over all 14,536 body rows through store/API/chart; daily V2 producer with currentness states and PIT/geometry/guard gates; shadow 09-25+ against V1; `BREADTH_AUTHORITY` flip + proven rollback; read-only acceptance.

---

# Part 2 — implementation under the owner rulings of 2026-09-29

## Authority model (implemented: `api/services/breadth_authority.py`, switch `BREADTH_AUTHORITY=v1|v2`)

| `uct` session | authority | served |
|---|---|---|
| ≤ 2026-03-22 | `v1_legacy` | existing V1 readers, untouched (not relabelled as V2) |
| 2026-03-23 … 2026-09-24 | `v2_frozen` | frozen V2c2 rows (sha `5670fdc0…`, 0444 replica, `immutable=1`) |
| 2026-03-24, 2026-08-31, 2026-09-23 | `v2_gap` | 35 metrics None / no chart bar — no V1 substitution, no interpolation |
| 2026-09-25 … (validated) | `v2_live` | producer publication (immutable per session) |
| newest ≤2 collector sessions after the last canonical | `provisional_collector` | collector value, `_authority`/`_provenance` flagged, never written to a V2 store |
| older unvalidated | `v2_pending` | withheld (fail closed) |

Rollback = `BREADTH_AUTHORITY=v1` (or unset) on web. Nothing is rebuilt or deleted; V1 stores keep being written by their V1 owners. Cache keys carry the authority token under v2 and are byte-identical under v1.

## Derived-field dependency trace (Monitor `_derive_ascending`, collector fields, chart symbols)

| Field | Class | Under v2 |
|---|---|---|
| the 35 V2 metrics | DIRECT V2 | V2 value |
| ratio_5day, ratio_10day, hi_ratio, lo_ratio, net_new_high_low | DIRECT V2 (V2 stores them) | V2 stored value; the V1 row-window recomputation is suppressed for V2 rows (it would splice V1 rows and paper over PIT gaps) |
| breadth_score | DERIVED FROM V2 | recomputed from V2 breadth inputs + unaffected sentiment inputs (cboe_putcall, aaii_spread, vix) — the score's existing definition; a PIT-gap row renormalises below 60 weight → None |
| is_ftd, qqq/spy_day_pct, avg_10d_cpc | LEGACY / UNAFFECTED | QQQ/SPY/put-call inputs only |
| vix*, vxn, vxmt, aaii_*, naaim, cnn_fear_greed, cboe_putcall, spy/qqq/rsp/sp500 fields, iwm_qqq_ratio, rsp_spy_ratio, uct_exposure, atr_ext_7 | LEGACY / UNAFFECTED | collector |
| up_vol_ratio, up/down_on_volume, up/down_from_open, hvc_52w, new_ath | LEGACY / UNAFFECTED (collector-owned Breadth metrics outside V2's 35; same UCT list) | collector |
| **mcclellan_osc** | **REQUIRES PRODUCT DECISION** | withheld. It is an EMA(19)−EMA(39) of net advances; recomputing it from V2 needs (a) a seed/warm-up at 2026-03-23 (V1 EMA state? V2-only burn-in? `uct_backtest` is ruled out) and (b) a rule for the three PIT gaps (skip vs decay). The collector's value is a V1-derived number — pairing it with V2 direct metrics is forbidden. Consumers: Monitor, UCTMC chart, analogues (weight 1.5). |
| **adv_decline_cum** | **REQUIRES PRODUCT DECISION** | withheld. A running total from the first stored session: it necessarily spans V1 (≤03-22) and V2 (≥03-23) inputs and would silently drop the three gap sessions' contribution. Needs an owner rule (splice + gap treatment, or re-base). |

⛔ Because two member-facing derived fields cannot be recomputed from V2 without a methodology decision, **the member-facing switch is blocked** (owner rule: STOP before cutover).

## Shadow V1 vs V2 (member-facing UCT, 2026-03-23 … 2026-09-24, 129 sessions)

Evidence `/data/_audit/cutover/shadow_classified_20260929.json` (runner). Member V1 value = collector close where stored, else the OHLC store (the serving rule).

| Class | cells |
|---|---|
| EXPECTED_METHODOLOGY_DIFFERENCE (pct ≤1.0 pt, ratios ≤0.10, counts ≤max(15, 1.5% of universe)) | 2,767 |
| EXPECTED_V2_CORRECTION (V1 hole or metric V1 never stored) | 499 |
| LIVE_STORE_INCIDENT (27 subset-recompute sessions derived objectively: stored universe_count/list < 0.9 — exactly the documented 26 + 2026-09-24 itself; healed rows; Aug 12–20; 09-02) | 1,107 |
| PIT_GAP | 3 |
| material, attributed below | 7 |

The 7: 2026-06-16 (collector priced 2,543/2,748 names → counts over 205 fewer names) and 2026-07-27 (2,538/2,637) — SOURCE DIFFERENCE, the partial-coverage rows the accepted PIT gate documents; 2026-08-25 hi_ratio — comparison artifact (the collector row stores no hi_ratio; the Monitor derives 108/2,635 = 4.10 = V2). **Unexplained material differences: 0.**

## Daily producer (implemented; dedicated service `breadth-v2-runner`, `BREADTH_V2_PRODUCER_ENABLED=1`)

ONE scheduler owner (its own loop) and ONE writer (`v2_live.db` + immutable R2 publications + manifest). Web only adopts VALIDATED publications into a rebuildable replica; an accepted session is never replaced (a disagreeing rerun is a recorded conflict).

D+1 lifecycle, readiness-driven (measured): minute file for D lands ~04:30–04:37Z D+1; the PIT hindsight gate needs the collector row of D+1 (~20:15Z D+1). Then: PIT ledger refresh (gate STOP → REVIEW_REQUIRED) → one-window acquisition → guard/dividend tables → preflight → the batch computed TWICE (determinism) → validation (checkpoint, calendar geometry incl. early close, bucket coverage, PIT presence, metric completeness with ratio absence only by rule, OHLC coherence, 0–100 bounds, ±20% population guard, membership size, sources) → publish. So canonical D ≈ 20:30–21:30Z on D+1; until then D is provisional collector.

Membership identity per session: every universe's member list + sha256, PIT-ledger sha, reference sha, vintage tag, input-manifest sha, pinned-module digests, methodology `rth-1m-composites-v2c2-div+ema-tie-exact-v1`, producer commit.

EMA: live V2 = pinned + one declared rule (`ema-tie-exact-v1`): an observation equal to the current EMA leaves it exact (pandas' behaviour). Installed only in the producer process; master's V1 `breadth_live` and chart indicators untouched. Handoff effect: only exact-tie names (flat SPACs) can differ from the frozen rule — ±1 name, documented.

Port proof: the ported code on current master, run on the FROZEN vintage's own inputs with the pinned EMA, reproduces frozen sessions bit-for-bit (2026-09-22..24 incl. the 09-23 PIT gap: 488/488 rows; early close 2025-11-28 + 12-01: 280/280).

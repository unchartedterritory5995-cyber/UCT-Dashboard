# Breadth V2 CORRECTED — Final Correctness / Methodology Validation

**Date:** 2026-09-23 · **Scope:** diagnostic only — nothing fixed, nothing merged, no cutover.
**Artifact (frozen):** `/data/_audit/breadth_replacement_v2_corrected_COMPLETE_FROZEN_2026-09-23.db`
**SHA-256:** `ad8c157fceafad163b844b113cb1784a9d9672ccbb732ed6c8a8270d37afe8e8` · 78,540,800 bytes · mode 0444
**Runner:** `dbacc727ef6a436aa7e2b5a728eb89dc9a0a7862` · deployment `7634bc3e-ecb3-4b16-aa79-0a45dd8d8793`
**Validator:** branch `breadth/v2c-validation` (local), commit recorded in `V2C_FINAL_VALIDATION_INDEX_2026-09-23.json`
together with the SHA-256 of every validator source and every result file.
All queries ran on a hash-verified scratch copy opened `mode=ro&immutable=1`; the frozen file was only re-hashed.

## VERDICT

**ARTIFACT NEEDS CORRECTION** — the implementation reproduces its own specification exactly (5,874 / 5,874
independent-oracle cells), but the specification as run carries two systematic data defects that are not
methodology choices: **(1) dual-class common stocks (BRK.B, BF.B, CWEN.A …) are dropped from every
level-dependent metric and from the close in US and NYSE** (NYSE `universe_count` closes at its session low on
every session), and **(2) the retrospective UCT population is contaminated by ticker reuse** (≈16 % of 2008 UCT
member-sessions are symbols trading before a > 60-session gap that precedes their current continuous listing — most
likely a different security under the same ticker). Several smaller defects are listed
below. None invalidates F1, F2 or the P0-POP fix; all are targeted.

## A. Integrity
| check | result |
|---|---|
| `PRAGMA integrity_check` | **ok** |
| tables / rows | breadth_daily_ohlc 570,834 · pass_checkpoint 4,878 · pass_session 4,703 · pass_meta 34 |
| by universe | uct 155,199 · us 155,199 · nasdaq 130,218 · nyse 130,218 |
| duplicate logical keys (normalised) | **0** |
| NULL / NaN / Inf in o,h,l,c | **0** (all REAL) |
| invalid / weekend dates, orphans | **0** — every done checkpoint has rows + a session row; none on missing_source dates |
| universes / metrics outside registry, `applies_to` violations | **0** |
| sources | `intraday_recon_1m` 556,621 · `intraday_recon_1m_body` 14,213 — nothing else |

## B. Checkpoints / calendar
All 4,878 weekdays 2008-01-02 … 2026-09-11 have a checkpoint. **All 175 `missing_source` dates are NYSE rule
holidays** from an independently computed calendar (19 MLK, 19 Presidents, 19 Good Friday, 19 Memorial, 19
Independence, 19 Labor, 18 Thanksgiving, 18 Christmas, 16 New Year, 5 Juneteenth, 2 Sandy, Bush 2018-12-05,
Carter 2025-01-09); none is in the provider calendar; every minute file is absent; and **every** weekday rule
holiday in range is a missing_source. **No trading session is missing.** Every provider session in range is `done`.

## C. Session geometry (explained)
The boundary is DERIVED from participation (last minute with ≥15 % of the busiest minute's names = the auction
minute; the path ends one minute before it) — and, not previously documented, **it is derived per universe from
that universe's own members**, while `pass_session.buckets` records only the first universe's (UCT) geometry.
Replayed from the flat files (participation byte-identical to the production parser):
* **417 sessions stored at 389 (2008–2017)**: the 16:00 closing-cross minute's participation falls just under the
  15 % floor in older files (e.g. 782 vs 5,270 = 14.8 %), so the derived auction minute is 15:59 and **the 15:59
  regular minute is dropped from the path**. No minute is missing.
* **22 half-days at 211/212**: the post-bell 13:01/13:02 minutes clear the floor, so **the 13:00 closing-auction
  bar (and sometimes 13:01) enters the intraday path** — the off-by-one the code says must not happen.
* **4 COVID circuit-breaker sessions**: 14 minutes absent = the real 15-minute halts. Legitimate.
* No stray/other-date timestamps exist in any anomalous session.
* **Material effect** (36 sessions, 4,158 cells, calendar-correct boundary forced): 36 fields change (H 31, L 4,
  O 1), pct metrics ≤ 0.1, largest `stage2_count` H 18, `new_20d_highs` H 13. **Close is never affected.**

## D. Candles and domains (all 570,834 rows)
**0 violations** of l ≤ o, l ≤ c, h ≥ o, h ≥ c, h ≥ l; 0 pct outside [0,100]; 0 negative counts; 0 non-integer
counts; `universe_count` always > 0; every body row is flat. Signed metrics (`adv_decline` −5,109…4,541,
`net_new_high_low` −2,605…957) keep sign. No count is clamped (e.g. `near_52w_high` max 1,932, 63,554 values > 100).
33 metrics per universe-session, exactly 66 rows/session pre-2011 and 132 after — no silent row loss.

| family | metrics | domain | stored as |
|---|---|---|---|
| MA share | pct_above_5/10/40/50/100/200sma, pct_above_20ema | pct_0_100, 1 dp | path OHLC, official-close C |
| 52w/20d | new_52w_highs/lows, new_20d_highs/lows, near_52w_high | nonneg count | " |
| composite | net_new_high_low (signed), hi_ratio/lo_ratio (pct, 4 dp, zero-denominator → no value) | computed per minute | " |
| momentum | up/down_4pct_today, _20pct_5d, _25pct_month, _50pct_month, _25pct_quarter, magna_up/down | nonneg count | " |
| base | universe_count, advancing, declining, adv_decline (signed), stage2/4_count | count | " |

**Absent by design/data:** volume metrics (grouped closes carry no volume), `mcclellan_osc`/`adv_decline_cum`
(population-dependent), `new_ath`, `atr_ext_7`, UCT non-portable composites. ⚠ **`ratio_5day` / `ratio_10day` are in
the accepted V1 publication set but no producer emits them — no history exists for them in this artifact.**

## E. F1 — corporate-action basis — PROVEN
Code at the runner SHA: `session_basis` = provider adjusted / provider raw for the same session, no bars.db
connection is opened on the corrected path. Data: the independent oracle (own factor, own levels from the grouped
files) reproduces every cell exactly, including split sessions 2014-06-09 (AAPL 7:1), 2020-08-31 (AAPL 4:1, TSLA
5:1), 2022-06-06 (AMZN 20:1), 2022-07-18 (GOOGL 20:1), 2024-06-10 (NVDA 10:1). **UCT new 52-week highs on
2020-03-16 close = 1 reproduced independently** (V1 = 110). The V1 difference decays exactly as a basis defect must
(US `new_52w_highs` V1 − V2c: 285 in 2008 → 20 in 2026). **Not gated:** (i) 190 provider ADJUSTED-series
discontinuities (raw continuous, adjusted jumps ×2…×20 within one fetch batch — provider data defects), 100 of them
on universe members (63 names, 24 in UCT incl. **BCPC ×6.98 on 2026-06-25** and **TPC** repeatedly in 2026), producing
spurious NH/NL/4 % flags on event days and SMA/stage distortion for up to 200–251 sessions; the coherence gate is
inert in this pass (it compares the grouped close to itself). (ii) **Adjustment-vintage**: the cache was fetched
2026-09-21 02:05Z → 09-22 14:35Z; exactly **3 names (WHLR, VWAV, UZX)** are on a different split vintage at the two
early-fetched files **2025-12-24 and 2026-09-11 (the final session)** — each registers a spurious 4 % drop there, and
WHLR/VWAV a spurious new 52-week low.

## F. F2 — domain registry — PROVEN
`_PCT_METRICS` is derived from `DOMAIN_PCT`; preflight `near_52w_high_is_count=True`; data shows counts > 100,
signed negatives, 0 values at exactly 100.0 on any pct metric, 0 domain violations.

## G. P0-POP — FIXED, with one residual cause identified
`universe_count` close/high (mean by year): UCT ≈ 1.000, NASDAQ ≈ 0.9997–0.9999 in every year (original V2:
0.50–0.78, closing at the low every session). US 2008-10-10 reproduced: close 4,158 / high 4,254 (original 1,976).
**Residual:** NYSE closes at its low on every session (c/h 0.980–0.990) and US on most (0.977–0.996): caused
entirely by the dual-class defect (H) — with tickers normalised the oracle gives NYSE 0.9999, US 0.9998.

## H. Dual-class ticker defect (NEW, P1)
Minute files and the reference map spell `BRK.B`; the grouped loader and `session_basis` re-key to `BRK-B`. A
dot-class member therefore gets no levels, no factor, no close: counted in the path `universe_count` only.
~20–90 US and ~20–39 NYSE names per session (none in UCT or NASDAQ). Effect (51-session matrix, spec − stored):
pct metrics ≤ 0.3 pt (mean |Δ| ≤ 0.1); counts: US `universe_count` up to 96, `advancing` 63, `up_4pct_today` 43;
NYSE `declining`/`adv_decline` up to 37; hi/lo_ratio path and close use different denominators.

## I. F5 — RECOMMENDATION: **ACCEPT F5** (grouped adjusted daily over bars.db), conditional
17 sessions, same path population, four closing snapshots:
| snapshot | coverage of US members | vs grouped |
|---|---|---|
| **grouped adjusted daily (stored)** | 97.7–99.9 % | — |
| bars.db daily (old F5) | **50–68 % through 2022**, 79–83 % 2023–24, 100 % on 2026-09-11 | `universe_count` −1,600, `advancing` −665 — a different population = the P0-POP defect |
| closing-auction minute bar | 2–95 %, erratic | unusable |
| last regular minute of the path | 100 % | pct ±0.1–0.2; excludes the auction |
Why grouped: it is the **same series the 380-session levels are built from** (one source, one vintage, one
definition of "close" on both sides of every comparison), it covers delisted names on the days they traded
(bars.db does not — survivorship), and it carries the full session. Caveats: the grouped close is the provider's
daily-bar close — it equals the 16:00 cross print for 82–87 % of names in 2024–26 but only 37–45 % in 2010–20, so
it is **not** asserted to be the exchange official close; it must be ticker-normalised (H); its adjusted series
needs a discontinuity gate (E).

## J. UCT membership — RECOMMENDATION: **REQUIRE DIFFERENT PRODUCT LABEL / METHODOLOGY**
The pinned list is **exactly** the collector's `universe_list` for 2026-09-21 (fingerprint `3be74123…`), i.e.
production's own UCT definition on that day. But: only 1,405 of 2,689 names existed on 2008-01-02; UCT sessions use
1,291–1,319 names in 2008 rising to 2,689; UCT − US `pct_above_50sma` is **+1.6 … +7.0 pt every year**
(`pct_above_200sma` +1.5 … +11.6) — the survivor signature. **Ticker reuse:** 315 pinned symbols have trading
history before a > 60-session gap; those pre-segment sessions are 16.0 % of 2008 UCT member-sessions (12.7 % 2010,
5.7 % 2015, 1.6 % 2020, 0 % 2026) — removing them on 2008-10-10 drops 209 of 1,316 members and moves `declining`
−112, `advancing` −90, `new_52w_lows` −62 (pct ±0.2). **PIT membership exists only 2026-01-02 → today** (collector
snapshots, 181 sessions; the watchlist ranged 2,657–3,688 names, +174 in one day on 2026-09-22). Against those PIT
values the artifact reads `pct_above_50sma` 1.6 pt and `pct_above_200sma` 2.3 pt lower on average in 2026 — a seam
at any cutover boundary. The series can honestly be "today's UCT list, back-tested", after removing reused-symbol
history; it is not "UCT breadth as it was". PIT before 2026 cannot be built from retained data.

## K. Body-only rows
14,213 rows (2.49 %); max 18 of 33 metrics body in one universe-session, never a whole session; concentrated in
small threshold counts (`up_50pct_month` 1,654, `up_20pct_5d` 1,543, `up_25pct_month` 1,328 …; pct family 76 total).
O=H=L=C = the official close (correct); the intraday path is withheld. The oracle reproduces all of them and the
trigger (zig-zag / single-bucket, never population jump). Profiled: median 93 reversals in ~130 moves, largest move
at the open or the last 30 minutes — **genuine threshold flicker and opening gaps, not corruption**. The rule is
over-conservative on small counts; the rows are valid, lossy on H/L only. The original V2 held 14,186 of these keys
as full candles; 2,140 keys exist only in the corrected artifact (the recovered rows).

## L. Body vs production `intraday_recon` (30 m) — RECOMMENDATION (not implemented)
4,287 overlapping keys (UCT). Production's 30 m rows carry the F1 basis defect and the bars.db population: on
full-path keys the median |ΔClose| decays 86 (2008) → 4 (2026) — the basis signature. **Recommended precedence:
live > intraday_recon_1m > intraday_recon_1m_body > intraday_recon > close_recon.** A body row's close is correct and
its wicks are honestly absent; a 30 m row's wicks and close are on the wrong basis. The merge fix `5a6d758aa` does
not know `intraday_recon_1m_body` and would drop all 14,213 body rows at merge and at serving.

## M. Golden oracle (independent)
51 sessions (2008 crisis → 2026-09-11: crashes, rallies, split days, 13 half-days, low-volume days) × 4 universes ×
33 metrics = **5,874 cells: 5,874 EXACT** with the production EMA recursion; with the pandas EMA the collector uses,
5,750 exact and 124 differ **only** in `pct_above_20ema` (≤ 0.3 pt). Universe sizes equal `pass_session` on every
session. Every earlier non-exact cell was explained and eliminated: per-universe geometry, EMA recursion, and
floating-point summation ties (non-contiguous array order) at exact SMA equality.
**Implementation note (P3):** `breadth_live._ewm_last` does `old_wt += α` after an observation (pandas' adjust=True
rule) where pandas adjust=False resets `old_wt = 1`; identical without gaps, divergent after any missing session.
Affects live breadth too.

## N. V1 / original V2 / production
All divergences have the expected sign and decay: vs V1 — F1 (level metrics, decay to ~0 by 2026) + P0-POP
(US `advancing` +785 in 2008 → +66 in 2026); vs original V2 — P0-POP (NYSE `universe_count` +969 in 2011 → +9 in
2026) and the grouped levels source (small pct shifts); vs production — F1 (UCT `pct_above_50sma` −12.2 in 2008 →
−0.2 in 2026) and, for US, the production universe's $2/liquidity filter. No unexplained divergence.

## O. Time-series continuity
325 robust-z > 12 day-over-day moves; of the 300 largest, 286 sit in 2008–09, 2010-05, 2011-08, 2015-08, 2018, 2020,
2022, 2025-04 stress windows and all 14 outside them were inspected (the 25 smallest, z just above 12, were not
inspected individually): lookback base effects (e.g. `up_25pct_quarter` 2025-07-15: `back[65]`
rolls from the 2025-04-08 low to the 04-09 +9.5 % day) and the 2011-11-30 coordinated-rally stage-4 collapse.
2011-01-03 NASDAQ/NYSE start agrees with US on the same day. Largest `universe_count` daily swing 3.3 % (half-day
participation). No gaps, no stuck series except legitimate zero-runs (UCT `down_50pct_month`, 88 calm sessions).

## P. Serving
Artifact has only the PK. One metric's full history 53 ms, 250-session window 3 ms, one date 0.1 ms; with a
(universe, metric, date) index 13 ms / 0.5 ms. No serving problem; add the index at merge.

## Q. Open items
**Artifact corrections (P1):** dual-class ticker normalisation (US/NYSE); UCT reused-symbol history.
**Artifact corrections (P2/P3):** provider adjusted-discontinuity gate; single-vintage grouped cache (re-fetch 2025-12-24,
2026-09-11 and any split since the fetch); exclude the auction minute on half-days / keep 15:59 on full days (or record
per-universe geometry); EMA recursion; `pass_meta.commit` = "unknown".
**Methodology decisions (owner):** F5 (recommend ACCEPT, conditional); UCT label (recommend current-universe label +
reuse cleanup, or block); body precedence (recommend above 30 m).
**Cutover plumbing (separate):** `_MERGE_SQL`/`_TRUSTED_SOURCES` on master/production still exclude
`intraday_recon_1m`; local fix `5a6d758aa` unpushed and omits `intraday_recon_1m_body`; `ratio_5day`/`ratio_10day`
history absent for a published V1 metric pair.

**PRODUCTION UNTOUCHED · NO MERGE · NO CUTOVER.**

# Capture round 5 — the run-book (prepared 2026-10-04, for the owner's TradingView session, likely Mon 2026-10-05)

Branch `pine/cap5-capture-prep` (base `integrate/wave17-2026-10-03` `6c557c3308`). Every open capture item the
pine programme owes, gathered from the 32 capture queues on wave 17, the five lane branches that pushed new
queues (`pine/rt11-builtins`, `pine/rt12-statements-history`, `pine/rt13-requests-inputs`,
`pine/rt15-presentation-libraries`, `pine/f9-divergence-sweep`), `pine/h7-cap4-findings`, the objects triage's
"Captures still owed" table (rows 10–16), and the RVOL vendor packet (`origin/feat/pine-vendor-packet`,
M1–M10). Each item was checked against `tests/fixtures/vendor/**` and the CAPTURED lists (CAP, CAP2, CAP3,
CAP4, `OWNER-CAPTURE-PACKET.md` results); anything already captured is in **§ 5, NOT ON THIS LIST**.

**Ordered for the fewest chart setups.** The ANYTIME block (§ 2) runs on historical bars and can run tonight
or any time; the MARKET-HOURS block (§ 3) needs a FORMING bar (Mon–Fri 09:30–16:00 ET).

| | setups | captures / readings | queue items |
|---|---|---|---|
| ANYTIME | 5 (S1 RDDT 1D · S2 SPY 1D full · S3 SPY 60 · S4 SPY 1 · S5 SPY 5) | 57 (2 optional) | 46 |
| MARKET HOURS | 2 (M1 SPY 1D forming · M2 SPY 5 forming) | 8 (1 optional) | 4 |
| **total** | **7** | **65** | **50** |

**Owner time.** The capture lane drives the rig; the owner's part is: open TradingView on the rig and keep its
tab the FRONT tab (§ 1), reconnect a "Session disconnected" dialog if one appears, and do the two
owner-only steps (the chart background for row 10, § 2 S2-T; M5's input stepping can be done by either).
Lane time, measured off CAP3/CAP4 (≈3 min a probe capture, ≈4–5 min a corpus capture on SPY full
history, incl. the editor write, add, compute, chunks, verify, remove): **ANYTIME ≈ 3½–4 h** of lane time
(S1 ≈ 1¾ h, S2 ≈ 1½ h, S3–S5 ≈ 25 min), **MARKET HOURS ≈ 30 min** (inside one RTH window, the two Q-R2 /
barstate pairs a few minutes apart). Owner attention: ≈ 15 min of setup, ≈ 10 min for the theme backgrounds,
≈ 10 min for M5 / M10 if done by hand; otherwise presence only.

---

## 1. The procedure (unchanged from CAP3 / CAP4 — read those sections before starting)

Authorities: `docs/pine/capture-procedure.md`, `docs/pine/VENDOR-HARNESS.md` § "How the parent / owner takes a
capture", and the CAP3 / CAP4 sections of `docs/pine/vendor-harness/objects-triage-2026-09-28.md` (the route
that worked on 2026-10-03/04). In one paragraph each:

1. **Rig.** The scratch layout `01f1AcIj`, zero studies, account `TSDR_TRADING` (TV Premium). ⛔ Never open,
   save or publish an account script — every probe goes into an unsaved **Create new ▸ Indicator** draft.
2. **⛔⛔ THE CAPTURE TAB MUST BE THE FRONT TAB.** Gate, read on the tab being driven, in the same evaluation
   as every write: `document.visibilityState === 'visible'`, nonzero size, chart model present, NO "Session
   disconnected" dialog. CAP3 and CAP4 both lost their first attempt to a hidden tab (the extension's tab
   group sat behind a plain New Tab) and to a disconnect dialog; nothing is clicked until the owner brings the
   rig tab to the front / reconnects. `hasFocus` is recorded as observed (often false; the clipboard copy
   needs one click on the chart).
3. **Source in.** Through the Monaco handle (re-derive it by the webpack scan; CAP4 found module `568088`),
   the source passed in the JS call itself, written ONLY when its sha256 equals the committed file's (read
   back equal). ⛔ Not through the OS clipboard: CAP4's first try was refused because a concurrent session had
   overwritten the clipboard.
4. **Binding gate.** Exactly one visible `Add to chart`, zero `Update on chart`, checked in the same
   evaluation as the click.
5. **Depth.** Force history with **Go to date**, never the `All` button (it switches to 1M). Record
   `bars_loaded`; assert `startsAtBar0: true` only where the first loaded bar is the listing (RDDT 1D:
   2024-03-21; SPY 1D: 1993-01-29).
6. **Read.** Paste `tools/vendor_harness/tv_capture.js`; `__uctVH.studies()` (census controls true);
   `__uctVH.capture({study, source, id, startsAtBar0})` — pass `allowEmptyPlots: true` for a table-only
   study. A compile or runtime error is a READING: record the message verbatim (and the row / bar it names)
   in § 6 and move on.
7. **Out.** `__uctVH.chunk(i)` staged in an injected textarea, copied by a real Ctrl+A / Ctrl+C, re-hashed on
   the shell (chars + FNV-1a) → `chunk-NNN.json` in a scratch dir →
   `node tools/vendor_harness/verify_capture.mjs --assemble <dir> --out tests/fixtures/vendor/harness/<id>.json`.
   Read the exit code and the `VERDICT:` line, never through a pipe.
8. **Leave it as found.** Remove each study by its title after its capture; restore symbol / resolution /
   extended-hours; editor buffer back to its template; `__uctVH.cleanup()` (`globalsLeft: []`), injected
   textarea removed.

**File naming.** `<probe-stem or corpus slug>-<sym>-<tf>-<yyyy-mm-dd>.json` (corpus slug = the corpus file
name without its `__hash`). `<sym>` is `rddt` / `spy`; `<tf>` is `1d`, `60`, `1`, `5`; extended hours adds
`-ext` (precedent `vw-time-tf-spy-5-ext-…`); a forming-bar capture adds `-rth` and its second reading `-rth-b`
(precedent `request-realtime-alignment-spy-5-b-…`). The `idPrefix` column below is the id without the date,
exactly as `cap5-verdicts.json` lists it.

**Screenshots** (where a row says so) go to `docs/pine/vendor-harness/cap-round5/<id>.png` (precedent
`cap-round4/`).

---

## 2. ANYTIME block — historical bars, run any time (tonight is fine)

### S1 — NYSE:RDDT 1D, from the listing · extended hours n/a (daily) · all bars (≈637, first bar 2024-03-21, `startsAtBar0: true`)

One Go-to-date to 2024-03-21, then every capture below on the same chart.

| # | item(s) | probe / script | export | idPrefix (`-<date>.json`) | consumed by |
|---|---|---|---|---|---|
| S1-1 | **Q-F9a/b/c** (`na` leaf under `color.new`, `var` colour `na` write, colour read above its reassignment) + **Q-H6a** (`ta.obv` level from the listing, bar 0) | `tools/visual_conformance/probes/vw-cap5-f9-h6.pine` (COMBINED: rows of `vw-f9-colour-rules.pine` + `vw-h6-obv-level.pine` verbatim, 14 plots) — if it fails to compile, capture the two source probes separately | plots + per-bar colours | `vw-cap5-f9-h6-rddt-1d` | F9: `vendorHarness.f9Divergences.test.js`, `colorNewOverRule.test.js` (branch `pine/f9-divergence-sweep`); H6: `vendorHarness.h6Obv.test.js` (wave 17) |
| S1-2 | **Q-RT15b** `nz(<colour>)` with no replacement | `vw-rt15-colour-nz.pine` (v5, overlay) | plots + colorer values bars 0–9 + **screenshot bars 0–9** (B01: chart colour or transparent?) | `vw-rt15-colour-nz-rddt-1d` | `runtime/__tests__/rt15Presentation.test.js` (branch `pine/rt15-presentation-libraries`) |
| S1-3 | **Q-RT15c** paint `offset` from an input, flag TRUE | `vw-rt15-paint-offset.pine` | paints + **screenshot** | `vw-rt15-paint-offset-rddt-1d` | same |
| S1-4 | **Q-RT15c**, flag FALSE (`offset = na`) | `vw-rt15-paint-offset-flag-false.pine` (CAP5 variant: input default false + title, so the run is a committed file) | paints + **screenshot** | `vw-rt15-paint-offset-flag-false-rddt-1d` | same |
| S1-5 | **Q-RT15d** gradient `fill` | `vw-rt15-gradient-fill.pine` (v6) | the fill's entries as recorded + **screenshot of 3 bars at high zoom** (linear in price? clipped to the plots?) | `vw-rt15-gradient-fill-rddt-1d` | same |
| S1-6 | **Q-RT13c/d** `""` as the symbol; a request of a frame-local mutable; barstate offset in a request | `vw-rt13-requests.pine` (v5). A compile/runtime error on R01/R02/R05 is the reading — then re-capture with those rows deleted is NOT done here (the probe is committed whole); record the error | plots | `vw-rt13-requests-rddt-1d` | `builder/memberPane/rt13InstallFallback.test.js` (branch `pine/rt13-requests-inputs`) |
| S1-7 | **Q-RT12a/b** series window length (L01–L06), comma statements (C01/C02), frame-local fixed length (D01 vs D00) | `vw-rt12-statements-history.pine` (v6). ⚠️ L03/L04 may raise a runtime error — that IS the reading | plots | `vw-rt12-statements-history-rddt-1d` | `runtime/__tests__/rt12StatementsHistory.test.js`, `ast/rt12CommaCallSplit.test.js`, `ast/pineProbeReplay.test.js` (branch `pine/rt12-statements-history`) |
| S1-8 | **Q-RT10a/b/c/e** pivot over runtime state, statement `switch`, frame-local committed series, `ta.cum` over state | `vw-rt10-runtime-walls.pine` (v5; the duplicate `1 =>` switch arm may not compile — the error is the reading) | plots | `vw-rt10-runtime-walls-rddt-1d` | `runtime/__tests__/rt10PivotOverState.test.js`, `rt10SwitchStatement`, `rt10FrameHoist`, `rt10CumOverState` (wave 17) |
| S1-9 | **owed row 14** — v6 unset box fill / cell text | `vw-cap5-version-defaults-v6.pine` (NEW) | objects (boxes, table cells) | `vw-cap5-version-defaults-v6-rddt-1d` | `vendorHarness.c37ObjectColours.test.js` (C37 "still not carried") |
| S1-10 | **owed row 14** — v4 unset box border | `vw-cap5-version-defaults-v4.pine` (NEW) | objects | `vw-cap5-version-defaults-v4-rddt-1d` | same |
| S1-11 | **Q-RT11f** | `corpus/committed/order-block-finder__fVSb3j0I87.pine` (v4) | plots + objects | `order-block-finder-rddt-1d` | GT starter-allowlist grade (owner ruling D6); runtime pane |
| S1-12 | **Q-RT13a** | `corpus/committed/mtf-key-levels-support-and-resistance__29f470a089.pine` (v4) | plots + objects | `mtf-key-levels-support-and-resistance-rddt-1d` | D6 |
| S1-13 | **Q-RT13b** (a STRATEGY: plots only; the Strategy Tester opens — ignore it) | `corpus/committed/vwap-fibo-dev-extensions-strategy__mR2vfyGjUv.pine` (v4) | plots | `vwap-fibo-dev-extensions-strategy-rddt-1d` | D6 |
| S1-14 | **Q-RT13e** | `corpus/committed/pivot-high-low-points__hoTsDQRY3L.pine` (v4) | plots (triangles at `offset = -lb`) | `pivot-high-low-points-rddt-1d` | host fold of a constant window (RT13) |
| S1-15 | **Q-RT15a1** | `corpus/committed/kernel-channel-backquant__d8c4b7f75c.pine` (v6) | plots + fill | `kernel-channel-backquant-rddt-1d` | D6 |
| S1-16 | **Q-RT15a2** (strategy) | `corpus/committed/linear-regression-channel-breakout-strategy__3a1cf28800.pine` (v5) | drawings | `linear-regression-channel-breakout-strategy-rddt-1d` | RT15 rule 2 / R1 |
| S1-17 | **Q-RT15a3** | `corpus/committed/volatility-trend-score-backquant__0794882a37.pine` (v6) | plots + per-bar colour | `volatility-trend-score-backquant-rddt-1d` | RT15 rule 3, D6 |
| S1-18 | **Q-RT12c** | `corpus/committed/range-filter-bs-signals__eCVFctFlqp.pine` (v4) | plots + paints | `range-filter-bs-signals-rddt-1d` | D6 |
| S1-19 | **Q-RT12d** | `corpus/committed/nonlinear-regression-zero-lag-moving-average-loxx__e5075eb888.pine` (v5) | plots | `nonlinear-regression-zero-lag-moving-average-loxx-rddt-1d` | D6 |
| S1-20 | **Q-RT12e** (strategy) | `corpus/committed/atr-trailing-stoploss-strategy__oayb1wVXkZ.pine` (v4) | plots | `atr-trailing-stoploss-strategy-rddt-1d` | D6 (host lane) |
| S1-21 | **Q-RT10d** | `corpus/committed/volume-divergence-by-mm__cvG2Djaryv.pine` (v4) | plots + objects | `volume-divergence-by-mm-rddt-1d` | D6 |
| S1-22 | **Q-H6c** (1 of 7) | `corpus/committed/smoothed-gaussian-trend-filter-algoalpha__69de2e99a0.pine` (v6; gradient fill — same question as Q-RT15d) | plots + fill | `smoothed-gaussian-trend-filter-algoalpha-rddt-1d` | H2 S-a, runtime lane |
| S1-23 | **Q-H6c** (2) — imports a library (store) | `corpus/committed/smc-structures-and-multi-timeframe-fvg-ma-py__fd50b245b6.pine` (v6) | plots + objects | `smc-structures-and-multi-timeframe-fvg-ma-py-rddt-1d` | H2 S-c (needs `PINE_LIBRARY_STORE` to grade) |
| S1-24 | **Q-H6c** (3) | `corpus/committed/ema-92150-vwap-macd-rsi-pro-v6__014bfba33d.pine` (v6, `varip`) | plots | `ema-92150-vwap-macd-rsi-pro-v6-rddt-1d` | H2 S-e |
| S1-25 | **Q-H6c** (4) | `corpus/committed/bolingger-bands-inside-bar-boxes__3294017d4f.pine` (v5, `varip`) | plots + boxes | `bolingger-bands-inside-bar-boxes-rddt-1d` | H2 R-d |
| S1-26 | **Q-H6c** (5) | `corpus/committed/inside-bar-boxes__2f747d848b.pine` (v4, `varip`) | plots + boxes | `inside-bar-boxes-rddt-1d` | H2 R-d |
| S1-27 | **Q-H6c** (6) | `corpus/committed/neural-network-buy-and-sell-signals__fbbb11d0c7.pine` (v6, 994 lines — may compute slowly) | plots + objects | `neural-network-buy-and-sell-signals-rddt-1d` | H2 S-f |
| S1-28 | **Q-H6c** (7) | `corpus/committed/williams-fractal-trailing-stops__UOOIN5REYl.pine` (v4) | plots | `williams-fractal-trailing-stops-rddt-1d` | H2 R-f |

### S2 — AMEX:SPY 1D, FULL history · extended hours n/a · all bars (≈8478, first bar 1993-01-29, `startsAtBar0: true`)

One Go-to-date to 1993-01-29 (CAP4's RT7 capture reached 8,477 bars this way). ⚠️ If a heavy corpus script
fails to compute at full depth ("calculation takes too long"), take it at 1,800 bars from 2019-08-06 (CAP2 /
CAP3's SPY depth), `startsAtBar0: false`, and say so in § 6.

| # | item(s) | probe / script | export | idPrefix | consumed by |
|---|---|---|---|---|---|
| S2-1 | **Q-H6b** (OBV from SPY's listing) + Q-F9 second witness | `vw-cap5-f9-h6.pine` (combined, as S1-1) | plots + colours | `vw-cap5-f9-h6-spy-1d` | `vendorHarness.h6Obv.test.js`; F9 rails |
| S2-2 | **Q-RT11a/c/d/e** on 1D (tostring identity, `time(tf)` spellings and a `var` tf, `ta.swma` from 1993, `math.asin`, `str.tonumber`). ⚠️ RT11 says: a compile error is a reading, **do not split the probe** | `vw-rt11-builtins.pine` (v6, 22 plots) | plots | `vw-rt11-builtins-spy-1d` | `runtime/__tests__/rt11ValueBuildTostring.test.js` (branch `pine/rt11-builtins`) |
| S2-3 | **Q-RT11b** v5 bare `alma` (alone: a compile failure is the reading) | `vw-rt11-alma-v5-bare.pine` | plots or the compile error | `vw-rt11-alma-v5-bare-spy-1d` | `pine.js` `almaSpelling` gate; `refusalsThatMeanOppositeThings` |
| S2-4 | **Q-RT11b** v3 bare `alma` (alone) | `vw-rt11-alma-v3-bare.pine` | plots or the compile error | `vw-rt11-alma-v3-bare-spy-1d` | same |
| S2-5 | **Q-RT12a/b** second witness | `vw-rt12-statements-history.pine` | plots | `vw-rt12-statements-history-spy-1d` | as S1-7 |
| S2-6 | **Q-H7a** `format.volume` shapes H7 withholds (non-whole / negative below 1,000, negative tie, −0, ≥ 1e15) + **Q-C31b** a descending and an empty-range `for` | `vw-cap5-spy-text.pine` (NEW, one table; `allowEmptyPlots` not needed — one data-window plot) | table cells | `vw-cap5-spy-text-spy-1d` | `pineTextFormat.js::volumeNumberText` rail in `vendorHarness.h7Cap4Findings` (branch `pine/h7-cap4-findings`); `vendorHarness.c31Loops.test.js` |
| S2-7 | **owed row 12a** `max_bars_back(x, n)` (the per-series call) | `vw-cap5-max-bars-back.pine` (NEW) | plots or the error | `vw-cap5-max-bars-back-spy-1d` | `vendorHarness.c29NaReads.test.js` (C38 `pine:offset-literal`) |
| S2-8 | **owed row 12b** a declared buffer OVERRUN (alone; expected runtime error) | `vw-cap5-buffer-overrun.pine` (NEW) | the error text + legend screenshot; a fixture only if the tool captures it | `vw-cap5-buffer-overrun-spy-1d` | same |
| S2-9 | Q-RT15b second witness (OPTIONAL) | `vw-rt15-colour-nz.pine` | plots + colorer | `vw-rt15-colour-nz-spy-1d` | as S1-2 |
| S2-10 | **Q-RT11f** SPY | `order-block-finder__fVSb3j0I87.pine` | plots + objects | `order-block-finder-spy-1d` | D6 |
| S2-11 | **Q-RT13a** SPY | `mtf-key-levels-support-and-resistance__29f470a089.pine` | plots + objects | `mtf-key-levels-support-and-resistance-spy-1d` | D6 |
| S2-12 | **Q-RT13b** SPY (strategy) | `vwap-fibo-dev-extensions-strategy__mR2vfyGjUv.pine` | plots | `vwap-fibo-dev-extensions-strategy-spy-1d` | D6 |
| S2-13 | **Q-RT15a1** SPY full history (the queue asks full) | `kernel-channel-backquant__d8c4b7f75c.pine` | plots + fill | `kernel-channel-backquant-spy-1d` | D6 |
| S2-14 | **Q-RT12c** SPY | `range-filter-bs-signals__eCVFctFlqp.pine` | plots + paints | `range-filter-bs-signals-spy-1d` | D6 |
| S2-15 | **Q-RT12d** SPY | `nonlinear-regression-zero-lag-moving-average-loxx__e5075eb888.pine` | plots | `nonlinear-regression-zero-lag-moving-average-loxx-spy-1d` | D6 |
| S2-16 | **Q-RT12e** SPY (strategy) | `atr-trailing-stoploss-strategy__oayb1wVXkZ.pine` | plots | `atr-trailing-stoploss-strategy-spy-1d` | D6 |
| S2-17 | **Q-RT10d** SPY | `volume-divergence-by-mm__cvG2Djaryv.pine` | plots + objects | `volume-divergence-by-mm-spy-1d` | D6 |
| S2-18 | **M3** (owed fields: `time_close`, the prior bar's stamps, the exchange-tz rendering) | `vw-m3-daily-bar-time.pine` (packet copy) | table (read; capture optional with `allowEmptyPlots`) | — | `rvol-slice-vendor-answers.json` M3 (§ 4) |
| S2-19 | **M4 part A** `NASDAQ:JPM` WITHOUT `ignore_invalid_symbol` — EXPECTED TO FAIL | `vw-m4a-wrong-exchange.pine` | the error text, verbatim | — | answers M4 |
| S2-20 | **M5** the request ceiling — step the `n` input in the study settings 10 → 39 → 40 → 41 → 63 → 64 → 65 → 80 → 100 (control: "calls made" = 10 at n = 10) | `vw-m5-request-ceiling.pine` | largest n that ran, first n refused, error text, plan name | — | answers M5 |
| S2-21 | **M7** (owed: all-equal array, already-descending control) | `vw-m7-sort-indices-ties.pine` | table | — | answers M7 |
| S2-T1 | **owed row 10** — `chart.fg_color` / `chart.bg_color` under a SOLID DARK background. ⛔ **OWNER ONLY**: the owner sets Chart settings ▸ Canvas ▸ Background to solid dark; the lane never changes the owner's theme | `vw-theme-colours.pine` (existing) | plots (C01–C12) + the background setting recorded beside the fixture | `vw-theme-colours-spy-1d-dark` | `vendorHarness.c37Theme.test.js` |
| S2-T2 | **owed row 10** — under a GRADIENT background (`theme:gradient-background`). OWNER sets it, then **restores the original background** and says so | `vw-theme-colours.pine` | plots | `vw-theme-colours-spy-1d-gradient` | same |

### S3 — AMEX:SPY 60 · extended hours OFF · default load (≥ 300 bars)

| # | item | probe | export | idPrefix | consumed by |
|---|---|---|---|---|---|
| S3-1 | **Q-RT11c** on 60 (`time("60")` and the `var` tf on an intraday chart) | `vw-rt11-builtins.pine` | plots | `vw-rt11-builtins-spy-60` | as S2-2 |

### S4 — AMEX:SPY 1 (one-minute) · extended hours OFF · default load (≥ 300 bars)

| # | item | probe | export | idPrefix | consumed by |
|---|---|---|---|---|---|
| S4-1 | **Q-RT11a** on 1 (scalping-strategy's `str.tostring(timeframe.period) == "1"`) | `vw-rt11-builtins.pine` | plots | `vw-rt11-builtins-spy-1` | as S2-2 |

### S5 — AMEX:SPY 5 · extended hours ON, then OFF · default load (≥ 2 sessions with pre-market)

| # | item | probe / script | export | idPrefix | consumed by |
|---|---|---|---|---|---|
| S5-1 | **M2** run A — extended hours **ON**: does a plain string ticker carry pre-market bars? | `vw-m2-request-session-spy.pine` (packet copy; plain string `AMEX:SPY` so it names the chart's symbol) | plots (capture: `vw-m2-request-session-spy-spy-5-ext-<date>`) + the table; read a PRE-MARKET bar | — | answers M2 |
| S5-2 | **M8 part B** — `request.security(…, "D", timeframe.period)` as a STRING (a 5m chart makes the readings differ) | `vw-m8b-timeframe-in-request-string.pine` | the table, or the compile error | — | answers M8 |
| — | switch extended hours **OFF** (J2 discipline: read back) | | | | |
| S5-3 | **M2** run B — extended hours **OFF** | `vw-m2-request-session-spy.pine` | plots (`…-spy-5-<date>`) + the table | — | answers M2 |
| S5-4 | **Q-L2a** second chart (OPTIONAL — CAP3 took RDDT 1D and SPY **1D**; the L2 queue asked SPY **5**) | `corpus/committed/rolling-vwap__043320bb57.pine` (imports `PineCoders/ConditionalAverages/2`) | plots + table cell | `rolling-vwap-spy-5` | L2 / `vendorHarness.coverageAudit` (library store) |

⚠️ M2's packet preferred pre-market bars "on screen"; the capture reads the whole loaded history, so any
historical pre-market bar answers it — ANYTIME. (The 2026-09-19 memory note "needs the market open" for M2 /
M5 is not what the packet says; § 7.)

---

## 3. MARKET-HOURS block — needs a FORMING bar (Mon–Fri 09:30–16:00 ET; `newestBarIsForming: true`, derived)

### M1 — AMEX:SPY 1D · regular hours · the newest daily bar FORMING · ≥ 400 bars

| # | item | probe | export | idPrefix | consumed by |
|---|---|---|---|---|---|
| M1-1 | **Q-R2** — look-ahead OFF weekly / monthly request on the FORMING daily bar: the forming week's current close, or the last closed week's? (A02 vs A10; A06 the idiom) | `vw-request-htf-alignment.pine` (existing; its closed-market twin is `vw-request-htf-alignment-spy-1d-2026-10-02`) | plots | `vw-request-htf-alignment-spy-1d-rth` | `vendorHarness.c49CapturedClock.test.js` (`tf` forming-bar arm) |
| M1-2 | **owed row 12c** — `x[barstate.isrealtime ? 1 : 0]` and the ehlers non-repainting idiom on a forming bar | `vw-cap5-barstate-index.pine` (NEW) | plots | `vw-cap5-barstate-index-spy-1d-rth` | `vendorHarness.c29NaReads.test.js` (C38) |
| M1-3 | **M1 run B** (realtime half) — `request.security(…, "30", close)` on the forming daily bar; late-symbol `NASDAQ:CRWV` row | `vw-m1-request-merge-30.pine` (packet copy, reqTf default "30") | the table + plots | — | answers M1 |
| — | wait **3–5 minutes** | | | | |
| M1-4 | Q-R2, second reading | `vw-request-htf-alignment.pine` | plots | `vw-request-htf-alignment-spy-1d-rth-b` (vendor fact; not graded) | same |
| M1-5 | row 12c, second reading | `vw-cap5-barstate-index.pine` | plots | `vw-cap5-barstate-index-spy-1d-rth-b` | same |

### M2 — AMEX:SPY 5 · regular hours, extended OFF · the newest 5m bar FORMING · default load

| # | item | probe | export | idPrefix | consumed by |
|---|---|---|---|---|---|
| M2-1 | **M1 run A** (realtime half) — a "D" request on the forming 5m bar (largely answered already by packet #3, `request-realtime-alignment-spy-5-2026-10-01`: on the forming bar look-ahead ON = OFF = the forming daily close; this run fills the packet's own fields) | `vw-m1-request-merge.pine` (packet copy) | the table + plots | — | answers M1 |
| M2-2 | **M10** — the data-feed label: hover the exchange label in the status line, copy verbatim; Symbol info's provider line; delayed badge? plan name. **No Pine.** | — | text | — | answers M10 |
| M2-3 | row 12c on a 5m forming bar (OPTIONAL extra witness) | `vw-cap5-barstate-index.pine` | plots | `vw-cap5-barstate-index-spy-5-rth` | as M1-2 |

---

## 4. The vendor-packet items (M1–M10) — where their answers go

M1, M2, M3, M4, M5, M7, M8, M10 are readings for `docs/pine/rvol-slice-vendor-answers.json`, which lives ONLY
on `origin/feat/pine-vendor-packet` (`3f963ec88f`, never merged into an integrate branch). Its rail
`app/src/components/chart/engine/ast/vendorAnswers.test.js` (same branch) refuses the word `measured` over a
half answer: a half-filled entry stays `blocked` with `notes` saying what is still owed. Fill the fields the
packet (`docs/pine/rvol-slice-vendor-packet.md` on that branch, sections M1–M10) names, with the symbol / tf
actually used (AMEX:SPY here, not the packet's NASDAQ:AAPL — the `symbol` field records it). The probe files in
`tools/visual_conformance/probes/vw-m*.pine` are the packet's scripts byte-for-byte below a 4-line provenance
header, except the three named variants (M1 run B's default `"30"`, M2's plain string `"AMEX:SPY"`).

---

## 5. NOT ON THIS LIST — already captured, or not a capture (checked 2026-10-04)

| item | why it is not here |
|---|---|
| Q-R1 (look-ahead off W/M on 1D, market closed) | captured `vw-request-htf-alignment-spy-1d-2026-10-02` |
| Q-R3 (W/M/60 requests on 5 / 60) | captured `vw-request-htf-alignment-spy-{5,60}-2026-10-02` |
| Q-C1 (`time("W")` / `time("60")` with extended hours) | captured `vw-time-tf-spy-5-ext-2026-10-02` |
| Q-C2, Q-C3 | captured `vw-time-close-tf-spy-15-2026-10-02`; `vw-time-tf-spy-{30,240,1}-2026-10-02` |
| Q-C46a (loop in a block) | captured `vw-loop-in-block-spy-1d-2026-10-02` |
| C48's five probes | captured 2026-10-02: `vw-cond-window-extremes-{rddt,spy}`, `vw-gradient-edges-spy`, `vw-getter-history-2-spy`, `vw-forin-collections-2-rddt`, `vw-once-ta-helper-{rddt,spy}` |
| Q-S1 (strategy draws like its indicator twin) | captured CAP round 4: `r1-strategy-draws-rddt-1d-2026-10-02` + `r1-strategy-draws-indicator-…` (635 bars equal) |
| Q-L2b (a v6 script importing a v5 library) | not a capture (TradingView compiles each at its own version); RT15 re-measured it as refused by name |
| Q-L2a RDDT / SPY 1D | captured CAP3 (`rolling-vwap-{rddt,spy}-1d-2026-10-03`); only the SPY **5** leg is offered (S5-4, optional) |
| packet #3 / triage row 7 (realtime request alignment) | captured `request-realtime-alignment-spy-5{,-b}-2026-10-01` (forming bar) |
| every 09-27 / 09-28 / 09-30 / 10-01 / 10-02 / 10-03 queue row | captured (CAP, CAP2, CAP3, CAP4, owner rounds 2026-09-27…10-01) — fixtures under `tests/fixtures/vendor/harness/` |
| triage row 11 (gradient / colour components) | captured `vw-colour-components-spy-1d-2026-10-01`, `vw-gradient-edges-spy-1d-2026-10-02` |
| triage row 13 (a negative getter coordinate) | captured `vw-int-array-avg-neg-spy-1d-2026-10-01` |
| triage row 15 (a nonexistent symbol with `ignore_invalid_symbol`) | answered by packet M4 part B (2026-09-19: the bogus control `na`) |
| triage row 16 (our `/api/bars` beside TradingView's RDDT 15) | not a TradingView capture |
| triage row 14's "one drawing ict-killzones' two cell fills" | no probe written: the cells come from `set_table(...)` over UDT state; the ict-killzones captures exist (`ict-killzones-pivots-tfo-{rddt,spy}`) and the blocker is the plot-lane selector ruling, not a reading |
| RT12's "walls named, not queued" (sessions, `enum`) | the lane says no capture can serve them alone |

---

## 6. Results table (the capture lane fills this in)

| # | id written | bars | `startsAtBar0` | `verify_capture` | compile / runtime error (verbatim) | notes |
|---|---|---|---|---|---|---|
| S1-1 | `vw-cap5-f9-h6-rddt-1d-2026-10-04` | 636 | true | PASS | — | combined probe compiled; 20 plots |
| S1-2 | `vw-rt15-colour-nz-rddt-1d-2026-10-04` | 636 | true | PASS | — | screenshot `cap-round5/vw-rt15-colour-nz-rddt-1d-2026-10-04.jpg`: bars 0-9 keep the chart's own candle colours (B01 `nz(na colour)` paints nothing visible; not transparent) |
| S1-3 | `vw-rt15-paint-offset-rddt-1d-2026-10-04` | 636 | true | PASS | — | screenshot: yellow paint shifted one bar left (offset -1) |
| S1-4 | `vw-rt15-paint-offset-flag-false-rddt-1d-2026-10-04` | 636 | true | PASS | — | screenshot: `offset = na` drawn as offset 0 (yellow on the up bars themselves) |
| S1-5 | `vw-rt15-gradient-fill-rddt-1d-2026-10-04` | 636 | true | PASS | — | screenshot at 200 px/bar, price 33-60: G03 band green at the upper plot to red at the lower, clipped to the two plots, smooth vertical gradient |
| S1-6 | `vw-rt13-requests-rddt-1d-2026-10-04` | 636 | true | PASS | — (R01/R02/R05 compiled and ran) | 6 plots |
| S1-7 | — (no fixture: runtime error) | 636 | — | — | `Runtime error` RE10001: "Error on bar 0: Invalid value of the 'length' argument (0) in the 'lowest' function. It must be > 0." stack `#main` p 43 | the error IS the reading (L03/L04 class); study status type 3, no rows |
| S1-8 | `vw-rt10-runtime-walls-rddt-1d-2026-10-04` | 636 | true | PASS | — (the duplicate `1 =>` switch arm compiled) | 11 plots |
| S1-9 | `vw-cap5-version-defaults-v6-rddt-1d-2026-10-04` | 636 | true | PASS | — | objects: 3 boxes, 1 table, 3 cells |
| S1-10 | `vw-cap5-version-defaults-v4-rddt-1d-2026-10-04` | 636 | true | PASS | — | objects: 3 boxes, 1 table, 2 cells |
| S1-11 | `order-block-finder-rddt-1d-2026-10-04` | 636 | true | PASS | — | 28 plots, 6 lines |
| S1-12 | `mtf-key-levels-support-and-resistance-rddt-1d-2026-10-04` | 636 | true | PASS | — | 8 plots, 23 lines, 27 labels, 1 table |
| S1-13 | `vwap-fibo-dev-extensions-strategy-rddt-1d-2026-10-04` | 636 | true | PASS | — | strategy; 5 plots |
| S1-14 | `pivot-high-low-points-rddt-1d-2026-10-04` | 636 | true | PASS | — | 2 plots; 77 study rows (offset = -lb) |
| S1-15 | `kernel-channel-backquant-rddt-1d-2026-10-04` | 636 | true | PASS | — | 23 plots |
| S1-16 | `linear-regression-channel-breakout-strategy-rddt-1d-2026-10-04` | 636 | true | PASS | — | strategy, objects-only: 15 lines, 1 label |
| S1-17 | `volatility-trend-score-backquant-rddt-1d-2026-10-04` | 636 | true | PASS | — | 18 plots, 2 lines |
| S1-18 | `range-filter-bs-signals-rddt-1d-2026-10-04` | 636 | true | PASS | — | 9 plots |
| S1-19 | `nonlinear-regression-zero-lag-moving-average-loxx-rddt-1d-2026-10-04` | 636 | true | PASS | — | 7 plots |
| S1-20 | `atr-trailing-stoploss-strategy-rddt-1d-2026-10-04` | 636 | true | PASS | — | strategy; 3 plots |
| S1-21 | `volume-divergence-by-mm-rddt-1d-2026-10-04` | 636 | true | PASS | — | 14 plots |
| S1-22 | `smoothed-gaussian-trend-filter-algoalpha-rddt-1d-2026-10-04` | 636 | true | PASS | — | 22 plots, 1 table / 14 cells |
| S1-23 | `smc-structures-and-multi-timeframe-fvg-ma-py-rddt-1d-2026-10-04` | 636 | true | PASS | — | 22 plots; 52 lines, 21 labels, 2 boxes, 10 linefills |
| S1-24 | `ema-92150-vwap-macd-rsi-pro-v6-rddt-1d-2026-10-04` | 636 | true | PASS | — | 19 plots, 1 table / 12 cells |
| S1-25 | `bolingger-bands-inside-bar-boxes-rddt-1d-2026-10-04` | 636 | true | PASS | — | 6 plots, 54 boxes |
| S1-26 | `inside-bar-boxes-rddt-1d-2026-10-04` | 636 | true | PASS | — | 3 plots, 54 boxes |
| S1-27 | `neural-network-buy-and-sell-signals-rddt-1d-2026-10-04` | 636 | true | PASS | — | 34 plots, 42 labels |
| S1-28 | `williams-fractal-trailing-stops-rddt-1d-2026-10-04` | 636 | true | PASS | — | 10 plots, 1 label |
| S2-1 | `vw-cap5-f9-h6-spy-1d-2026-10-04` | 8477 | true | PASS | — | full history from 1993-01-29 |
| S2-2 | `vw-rt11-builtins-spy-1d-2026-10-04` | 8477 | true | PASS | — (compiled whole, 22 plots) | |
| S2-3 | — (no fixture: compile error) | 8477 | — | — | `Compilation error`: "Could not find function or function reference 'alma'" (line 6, cols 6-9) | v5 bare `alma` is REFUSED. ⚠️ the failed unsaved study appeared on the chart titled `UCTPROBE_RT1_NA_TEST` (the shared unsaved slot's stale name); removed |
| S2-4 | `vw-rt11-alma-v3-bare-spy-1d-2026-10-04` | 8477 | true | PASS | — | v3 bare `alma` COMPILES and runs (2 plots) |
| S2-5 | — (no fixture: runtime error) | 8477 | — | — | `Runtime error` RE10001: "Error on bar 0: Invalid value of the 'length' argument (0) in the 'lowest' function. It must be > 0." stack `#main` p 43 | same as S1-7 (line 43 = L04 `ta.lowest(low, lenNa)`, an `na` length read as 0) |
| S2-6 | `vw-cap5-spy-text-spy-1d-2026-10-04` | 8477 | true | PASS | — | 1 table, 63 cells |
| S2-7 | `vw-cap5-max-bars-back-spy-1d-2026-10-04` | 8477 | true | PASS | — (`max_bars_back(x, n)` compiled) | first clipboard read was another session's text (ID check refused it, nothing written); re-copied |
| S2-8 | `vw-cap5-buffer-overrun-spy-1d-2026-10-04` | 8477 | true | PASS | — **NO runtime error** | the expected error did not happen: V02 `close[e]` with `e` up to 59 past `max_bars_back = 50` reads real values on every bar (0 `na`); screenshot `cap-round5/vw-cap5-buffer-overrun-spy-1d-2026-10-04.jpg` |
| S2-9 | `vw-rt15-colour-nz-spy-1d-2026-10-04` (optional) | 8477 | true | PASS | — | |
| S2-10 | `order-block-finder-spy-1d-2026-10-04` | 8477 | true | PASS | — | full depth computed (no 1,800-bar fallback needed for any S2 corpus script) |
| S2-11 | `mtf-key-levels-support-and-resistance-spy-1d-2026-10-04` | 8477 | true | PASS | — | 23 lines, 27 labels, 1 table |
| S2-12 | `vwap-fibo-dev-extensions-strategy-spy-1d-2026-10-04` | 8477 | true | PASS | — | strategy |
| S2-13 | `kernel-channel-backquant-spy-1d-2026-10-04` | 8477 | true | PASS | — | |
| S2-14 | `range-filter-bs-signals-spy-1d-2026-10-04` | 8477 | true | PASS | — | |
| S2-15 | `nonlinear-regression-zero-lag-moving-average-loxx-spy-1d-2026-10-04` | 8477 | true | PASS | — | |
| S2-16 | `atr-trailing-stoploss-strategy-spy-1d-2026-10-04` | 8477 | true | PASS | — | strategy |
| S2-17 | `volume-divergence-by-mm-spy-1d-2026-10-04` | 8477 | true | PASS | — | |
| S2-18 | `vw-m3-daily-bar-time-spy-1d-2026-10-04` (optional capture) | 8477 | true | PASS | — | **M3**: newest bar `time` 1790947800000 = 2026-10-02 13:30 UTC = 09:30 New_York (exchange tz America/New_York); `time_close` 1790971200000 = 2026-10-02 16:00 NY; `time[1]` 1790861400000 = 2026-10-01 09:30 NY / 13:30 UTC |
| S2-19 | — (expected failure) | 8477 | — | — | `Runtime error`: "Invalid symbol: NASDAQ:JPM" (ctx `{symbol: "NASDAQ:JPM"}`) | **M4 part A**: a wrong-exchange symbol without `ignore_invalid_symbol` stops the script |
| S2-20 | — (readings) | 8477 | — | — | n = 41: `Runtime error` RE10137 "Error on bar 0: The script executes too many unique `request.*()` function calls. The limit is 40. You can increase the limit by upgrading your plan." | **M5**: control n = 10 -> calls made 10; n = 39 -> 39; **n = 40 -> 40 (largest that ran)**; **41 first refused**; 63/64/65/80/100 refused with the same RE10137 (limit 40). Plan: TradingView Premium (account per the owner). Stepped by `setInputValues` on the study's own `in_0` input; restored to 10 before removal |
| S2-21 | `vw-m7-sort-indices-ties-spy-1d-2026-10-04` (optional capture) | 8477 | true | PASS | — | **M7**: a = 5,3,5,1,3,5: asc indices 3,1,4,0,2,5; desc 5,2,0,4,1,3 (ties: asc keeps index order, desc REVERSES it); b all-equal 7,7,7,7: asc 0,1,2,3, desc 3,2,1,0; c already-descending input, asc: 2,1,0 |
| S2-T1 / T2 | SKIPPED | | | | | theme backgrounds: owner declined/deferred (owner-only step) |
| S3-1 | `vw-rt11-builtins-spy-60-2026-10-04` | 431 | false | PASS | — | SPY 60, extended hours OFF (`sessionId` regular), default load from 2026-07-08 |
| S4-1 | `vw-rt11-builtins-spy-1-2026-10-04` | 431 | false | PASS | — | SPY 1, extended hours OFF, default load 2026-10-01 19:19Z .. 10-02 19:59Z |
| S5-1 | NOT TAKEN | | | | | rig fault, see below |
| S5-2 | NOT TAKEN | | | | | rig fault |
| S5-3 | NOT TAKEN | | | | | rig fault |
| S5-4 | NOT TAKEN (optional) | | | | | rig fault |

**Run notes (CAP5 lane, 2026-10-04 evening, ANYTIME block).** Rig: layout `01f1AcIj`, a fresh tab in the
extension's group (front, `visible`, 1918x888, `hasFocus` true, no disconnect dialog); start state AMEX:SPY 1D,
extended hours OFF (`sessionId` regular), 0 studies, editor holding a saved account script's historical version
(never edited: the first act was **Create new > Indicator**, then Ctrl+K Ctrl+I for every later probe). Each probe
went into an unsaved draft through the Monaco handle (module `568088`, 18,234 factories seen), the binding gate
(one visible `Add to chart`, zero `Update on chart`, sha256 of the read-back buffer = the committed blob's) checked
in the same evaluation as the click.

⚠️ **Route change, source in:** the sources were not pasted into the JS call. They were fetched in the page from
`raw.githubusercontent.com` at the PINNED commit `262cafc486` (this branch, public repo) and admitted ONLY when the
page's sha256 equalled the committed blob's sha256 computed on the shell (`git show HEAD:<path> | sha256sum`; 47/47
equal); `tv_capture.js` came the same way (sha `bf0251d7...`, = the git blob) and loaded through a `blob:` script
(TradingView's CSP refuses `eval`). The clipboard was never used for source in. Out: one chunk per capture
(`chunkSize` 50,000,000, up to 2.19M chars), staged in an injected textarea, real Ctrl+A / Ctrl+C, read on the shell,
chunk FNV-1a re-hashed AND the capture's own `id` compared with the expected id before `verify_capture.mjs
--assemble` (the id check fired once, S2-7: another session had overwritten the clipboard with a ticker list;
nothing was written; re-copied). Every assembled fixture: `VERDICT: PASS`. Screenshots are JPEG (the tool's
format), not PNG.

⛔ **Rig fault, S5 not taken.** To turn extended hours ON for S5 the lane called the chart model's
`setProperty(sessionId, 'extended', <plain string label>)`. The value applied, but the plain-string undo label
poisoned TradingView's undo history (`n.text(...).translatedText is not a function` in `_getStateFromUndoHistory`,
then `originalText is not a function` in every later `endUndoMacro`). From then on **Add to chart does nothing**
(no study, no error; JS click and pointer click alike) and **`setResolution` does not apply** (the toolbar reads
D, the series stays on 5). The session toggle still applies (restored to Regular through the chart's own session
menu). A page reload clears it, and the reload is blocked by the page's "Leave site?" dialog, which this lane may
not answer. **Owner: reload the rig tab (accept "Leave"), confirm it opens on AMEX:SPY 1D, extended hours OFF,
0 studies.** Then S5 (M2 run A/B, M8 part B, optional rolling-vwap SPY 5) and the RT16 add-on can run. Lesson: change
the session with the chart's own control (the `ETH`/`RTH` button, bottom toolbar), never a model `setProperty`.

**Grades (`CAP5_MEASURE=1`, `cap5Captures.measure.test.js`, `--maxWorkers=1`, this branch = wave-17 base, no lane
branches merged, NO `PINE_LIBRARY_STORE`; `cap5-verdicts.json` rewritten from the harness, 43 of 50 idPrefixes graded,
both door states):**

| verdict (on / runtime) | captures |
|---|---|
| MATCH / MATCH | `vw-rt15-gradient-fill-rddt-1d` |
| DIVERGE / DIVERGE | `vw-cap5-f9-h6` (rddt + spy: the F9 colour rows N01-N03, V01, V02, R0x by colour; K00 / O0x match), `vw-rt15-colour-nz` (rddt + spy: N01-N03 colour), `vw-rt15-paint-offset` + `-flag-false` (paints), `vw-cap5-version-defaults-v6` (objects), `vw-cap5-spy-text` (table cells), `vw-cap5-buffer-overrun` (V02: TradingView reads real values past `max_bars_back`, ours `na`) |
| INCONCLUSIVE / DIVERGE | `vw-rt10-runtime-walls-rddt-1d` (on: `pine:reassign`; runtime: P01-P03 pivots `na`) |
| INCONCLUSIVE both (our door refuses) | `vw-rt13-requests` (`pine:request`), `vw-cap5-version-defaults-v4` (`pine:hidden-only`), `vw-rt11-builtins` 1d / 60 / 1 (`pine:builtin`), `vw-rt11-alma-v3-bare` (`pine:undefined` — TradingView COMPILES bare `alma` in v3), `vw-cap5-max-bars-back` (`pine:offset-literal`), and every corpus script on both symbols: `pine:reassign` (order-block-finder, bb/ib boxes, inside-bar-boxes, williams), `pine:block` (kernel-channel, loxx, volume-divergence on; runtime INCONCLUSIVE per plot), `pine:collection` (range-filter), `pine:statement` (atr-trailing), `pine:state` (gaussian, ema-pro, neural-network), `pine:type` (volatility-trend-score), `pine:no-output` (linear-regression strategy), install door `compute` (mtf-key-levels, vwap-fibo strategy, pivot-high-low-points) |
| absent (no fixture) | rt12 rddt / spy (TradingView runtime error), alma-v5-bare (TradingView compile error), smc-structures (library row: needs `PINE_LIBRARY_STORE`, fixture IS captured), rolling-vwap-spy-5 + the two `-rth` rows (not taken) |

No corpus script graded MATCH, so no new D6 starter-allowlist candidates from this round on the wave-17 base;
the lanes whose fixes are on unmerged branches (RT10-RT15, F9, H6, H7) should re-run the measure on their own tips.
§ 8 steps 3-5 (pin test, hand-back, triage CAP5 section) are NOT done by this lane.

---

## 7. Ambiguities to settle before or during the round

1. **"Older owed" items the brief listed are captured.** Q-R1, Q-R3, Q-C1, Q-C46a and C48's five probes have
   2026-10-02 fixtures (several are consumed: `vendorHarness.c41LowerTfServe`, `pine.c31LoopScope`); Q-S1 was
   captured in CAP round 4. Only Q-R2 is still owed. If a lane wants any of them re-taken, it should say why.
2. **The combined probe** `vw-cap5-f9-h6.pine` changes the capture id the F9 / H6 lanes would expect
   (`vw-f9-colour-rules-…`, `vw-h6-obv-level-…`). The rows and titles are verbatim, so their rails read the
   same columns from the combined fixture. Every other probe was left alone because combining would mix Pine
   versions (v5 / v6), put a compile- or runtime-error row next to rows that must survive it (RT10, RT12, RT13,
   alma), change a later-`barcolor`-wins paint (RT15b/c), or override a lane's "do not split" instruction (RT11).
3. **The packet answers file is on an unmerged branch.** Whether the RVOL-slice packet is still wanted, and
   whether its JSON should move to wave 17, is the integrator's call; the readings are cheap either way.
4. **M2 / M5 classified ANYTIME**, against the 2026-09-19 note that they "need the market open": neither
   packet section asks for a forming bar (M2 reads historical pre-market bars; M5 is a compile/run limit).
   M10 is kept in market hours (the feed's real-time / delayed state is best read live).
5. **Theme backgrounds (row 10)** need the owner to change and restore the chart canvas; `vw-theme-colours.pine`
   itself says "never change the owner's theme". Skip S2-T1/T2 unless the owner does it.
6. **Full-history SPY for the corpus scripts.** CAP2 / CAP3 graded corpus scripts on SPY at 1,800 bars; this
   round asks full history (one Go-to-date for the whole setup, and `startsAtBar0` lets the runtime lane run
   where it declined `runtime:history-start`). If TradingView times out on a heavy script, fall back to 1,800
   bars and note it.
7. **The unattended batch driver's manifest is stale** (pre-existing on wave 17):
   `tests/test_vendor_batch_capture.py::test_the_committed_manifest_matches_the_corpus_and_skips_what_is_captured`
   fails (21 / 22 pass) because `docs/pine/vendor-harness/batch-manifest.json` still targets scripts captured
   since (first: `cdc-btc-rainbow-road`). Regenerating it runs the member-door census (a measure test), which
   this lane's resource rules forbid; this round uses the manual `tv_capture.js` route CAP3 / CAP4 used, not the
   batch driver.

---

## 8. After the captures — the ingest path (prepared and checked offline)

1. **Fixtures.** Each capture lands as `tests/fixtures/vendor/harness/<id>.json` only through
   `verify_capture.mjs --assemble` (chunk FNV-1a, total length + hash, receipt, schema, source sha).
   Checked offline 2026-10-04: validate mode `VERDICT: PASS (2/2)` on two CAP4 fixtures; an assemble round
   trip of `vw-rt8-runtime-followups-rddt-1d-2026-10-04` split into 7 chunks re-assembled byte-equal
   (`VERDICT: PASS`); the same chunks with one character flipped in chunk 1 → `VERDICT: FAIL`, rc 1, nothing
   written. `node --check tools/vendor_harness/tv_capture.js` clean.
2. **Grade.** `app/src/components/chart/engine/__tests__/vendorHarness/cap5-verdicts.json` lists every
   harness-gradable capture of this round (50 `idPrefix`es × door states `on` / `runtime` = 100 rows), and
   `cap5Captures.measure.test.js` grades them:
   ```
   cd app
   CAP5_MEASURE=1 npx vitest run src/components/chart/engine/__tests__/vendorHarness/cap5Captures.measure.test.js --maxWorkers=1
   # library rows (smc-structures, rolling-vwap): add PINE_LIBRARY_STORE=<the 50-library store dir>
   # one capture: CAP5_ONLY=<idPrefix substring>; detail: CAP5_MEASURE_PRINT=1
   ```
   It resolves each row to the NEWEST `<idPrefix>-<yyyy-mm-dd>.json`, writes `id` and `signature`
   (`cap3Signature` of the harness's own verdict), leaves absent rows null and prints them, so it can run after
   every batch. Checked offline: with no captures it rewrites the file byte-identical; with a stand-in capture
   it graded both states (MATCH / MATCH, as CAP4 pinned that capture) and the file was restored by bytes.
   Never edit a signature by hand.
3. **Pin.** Write `vendorHarness.cap5Captures.test.js` on the model of `vendorHarness.cap4Captures.test.js`:
   (a) VENDOR FACTS read straight off each capture (its `source.sha256` = the committed probe's sha256; the
   rows each queue's "what lands" names), and (b) OUR GRADE per `cap5-verdicts.json` row — MATCH an `expect`,
   DIVERGE an `it.fails` asserting MATCH beside the named signature control, a final "every row carries a
   measured signature" for the rows captured. Mutation-check one control as CAP4 did (bytes captured, restored,
   sha verified; ⛔ never re-read a JSON as cp1252).
4. **Hand back.** Each lane's "what lands when it is captured" section is its own instruction: F9 / RT10 /
   RT11 / RT12 / RT13 / RT15 / H6 / H7 queues (paths in § 2's "consumed by" column). The runtime-lane corpus
   scripts that grade MATCH become starter-allowlist CANDIDATES (owner ruling D6) — an owner act, not this one.
5. **Record.** A `CAP5` section in `docs/pine/vendor-harness/objects-triage-2026-09-28.md` (rig state, route,
   per-item vendor fact and our door, pins, owed / left), as CAP4's.

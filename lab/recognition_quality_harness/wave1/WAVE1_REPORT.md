# UCT RECOGNITION LIBRARY SWEEP — WAVE 1 REPORT

## 1. Wave-1 selection & rationale
24 detectors, value-weighted across categories excluded from the 13
already-evaluated (3 deep-cycle + 10 pilot): 6 candlestick/multi-candle
(`shooting_star`, `morning_star`, `three_black_crows`, `marubozu`,
`bearish_engulfing`, `hanging_man` — the last two deliberately the bearish
mirrors of already-confirmed-defective `bullish_engulfing`/`hammer`), 3
volume/volatility (`nr7`, `vsa_no_supply`, `accumulation_distribution`), 8
classical/UCT structural (`double_bottom`, `ascending_triangle`,
`flat_base`, `rounded_base`, `high_tight_flag`, `u_and_r`,
`wyckoff_upthrust` — bearish mirror of `wyckoff_spring`, `bollinger_squeeze`),
1 momentum (`rsi_bullish_divergence`), 3 MA/context (`death_cross` —
bearish mirror of `golden_cross`, `pullback_to_50sma`, `stage_analysis`), 2
event/breakout (`opening_range_breakout`, `avwap_reclaim`), 1 UCT flagship
(`qullamaggie_setup`). The mirror-pair selections were deliberate: they test
whether findings already confirmed in one direction (bullish engulfing,
hammer, Minervini pullback, Wyckoff spring) transfer symmetrically to their
bearish/structural counterparts.

## 2. New-detector scorecard
See `WAVE1_SCORECARD.md` (full source-freshness classification predicted
before any chart was opened, empirical spot-check findings per detector,
and the 24-row Tier-1 classification table). Headline: 13
HEALTHY/LIKELY_HEALTHY, 6 HARD_DEFECT_SUSPECTED, 4 NEEDS_DEEP_EVALUATION, 1
EVALUATION_HARNESS_INADEQUATE.

## 3. Combined scorecard across all evaluated detectors
See `COMBINED_REGISTRY.md` — 37 detectors (3 DEEP + 34 TIER1) of ~85
registered, with an explicit `Eval Depth` column so DEEP evidence is never
conflated with TIER1 evidence. No composite score computed anywhere.

## 4. Quality distribution
Of 37 evaluated: ~19 read as healthy/reliable with no material open concern
(hammer, bull_flag [residuals documented+declined], cup_handle,
golden_cross, power_earnings_gap, episodic_pivot, marubozu, nr7,
vsa_no_supply, double_bottom, ascending_triangle, rounded_base,
high_tight_flag, bollinger_squeeze, rsi_bullish_divergence,
qullamaggie_setup, death_cross, stage_analysis, avwap_reclaim); ~13 carry an
open hard-defect suspicion or confirmation (pullback_to_21ema,
bullish_engulfing, three_white_soldiers, vcp, shooting_star, bearish_engulfing,
hanging_man, flat_base, wyckoff_upthrust, pullback_to_50sma, plus
morning_star/three_black_crows on source-risk); ~5 are simply too
thin/ambiguous to call either way yet (head_shoulders, remount,
wyckoff_spring, u_and_r, accumulation_distribution); 1 could not be
meaningfully evaluated by this harness at all (opening_range_breakout).

## 5. Hard-defect queue (evidence-only, never enhancement ideas)
- **CRITICAL:** none. No detector produces a plainly wrong signal on a
  majority of cases in this evidence base.
- **HIGH:** `pullback_to_50sma` (empirically confirmed — a touch/reclaim
  trigger visibly ~10-15 bars stale relative to the true last bar, same root
  cause as the already-open `pullback_to_21ema` defect); `pullback_to_21ema`
  itself (carried forward, still open from the deep-cycle, not re-litigated
  here); `bearish_engulfing`/`shooting_star`/`hanging_man` (direct mirrors of
  the confirmed `bullish_engulfing`/hammer-family "search bound != freshness"
  defect, with `bearish_engulfing` and `shooting_star` each carrying at least
  one empirically-observed instance); `vcp` (carried forward — empirical FPs
  plus the pre-existing self-documented 3%-cross-engine-agreement gap).
- **MEDIUM:** `flat_base` (labeled "flat" bases that visually read as
  volatile continued trends — a quality/looseness gap, not a freshness gap);
  `wyckoff_upthrust` (a mechanically-fresh trigger can still front-run a much
  larger genuine breakdown that the pattern's own semantics don't anticipate);
  `bullish_engulfing`/`three_white_soldiers` (carried forward, already
  documented in the pilot).

## 6. Intelligence-enhancement queue (kept separate — not bugs)
Freshness/currentness re-derivation for the whole "search bound" family
(would upgrade `shooting_star`/`morning_star`/`three_black_crows`/
`bearish_engulfing`/`hanging_man`/`wyckoff_upthrust`/`pullback_to_50sma`/
`opening_range_breakout` to the same "recheck current state" or
"already_broken" architectures already proven in `golden_cross`/
`death_cross`/`ascending_triangle`/`cup_handle`-family); a minimum
ADR/dollar-move materiality floor for candlestick ratio-based detectors
(new finding this wave — `shooting_star`/`hanging_man` both fired on
sub-1%-ADR names where the geometry ratios are satisfied by what is
economically noise); tightening `flat_base`'s flatness threshold;
reconsidering whether `accumulation_distribution`/`stage_analysis` should
expose their continuous reading directly to members rather than being
evaluated as pass/fail setup triggers.

## 7. Geometry priorities
Thinnest geometry (MINIMAL, single-anchor `horizontal_line`) among
otherwise architecturally-sound detectors: `pullback_to_50sma`,
`wyckoff_upthrust`, `u_and_r`, `avwap_reclaim`, `death_cross` — same
limitation already known for `pullback_to_21ema`. `avwap_reclaim` in
particular is a HIGH member-value, HEALTHY-identity detector whose geometry
(single line value) is the single biggest gap between "the math is right"
and "a member could see why" — a strong Wave-2/geometry-work candidate.
Richest geometry in this wave: `ascending_triangle` and `high_tight_flag`
(`trendline_pair`, tied to real fitted lines through real pivots).

## 8. Freshness/runtime-sensitive families
Most sensitive to intraday/nightly-staleness (all 5 "search bound" candlestick
detectors plus `wyckoff_upthrust`/`pullback_to_50sma`/`opening_range_breakout`)
— these should run on the freshest available bar close to real-time and
should NOT be treated as safely batchable overnight, since their entire
open defect is "the trigger can be several bars in the past by the time a
member sees it." By contrast `qullamaggie_setup`, `stage_analysis`,
`death_cross`, `ascending_triangle`, `bollinger_squeeze` re-derive from the
current bar every call and are naturally safe on any cadence, including a
slower nightly batch. `opening_range_breakout` is a special case: it is
architecturally intraday-native and simply should not run on a daily-close
cadence at all regardless of the freshness question.

## 9. Provisional product-tier distribution
FLAGSHIP_INTELLIGENCE_CANDIDATE: 3 (`bull_flag`, `high_tight_flag`,
`qullamaggie_setup`). BROAD_RELIABLE_LIBRARY: 17. EXPERIMENTAL_SPECIALIZED:
17 (includes every open-hard-defect detector plus every thin/ambiguous one
— provisional, product judgment, not a member-facing labeling change).

## 10. Next flagship intelligence candidates
- `avwap_reclaim` — clean identity, high member value, but needs geometry
  work before flagship treatment (single-line anchor).
- `double_bottom` / `rounded_base` — classical, high-conviction structural
  setups with mature lifecycle handling and rich geometry; healthy enough to
  deserve deeper product investment (confluence, target projection) rather
  than more defect-hunting.
- `ascending_triangle` — architecturally the freshest-by-construction
  detector in the whole library so far; worth a renderer-legibility pass
  before flagship promotion.
- `stage_analysis` — the only detector that ALWAYS has something to say
  about every chart; strong candidate for a dedicated "market stage" member
  surface distinct from a discrete-setup alert.
- `death_cross` (paired with `golden_cross`, already flagship-adjacent) —
  same proven-safe architecture, symmetric bearish signal.

## 11. Deep-evaluation-needed list
`vcp` (carried, highest priority — pre-existing 3%-cross-engine finding),
`head_shoulders` (carried, 0/3 confirmed TPs unexplained), `wyckoff_spring`
(carried, thin evidence) + `wyckoff_upthrust` (bundle together — bullish/
bearish pair), `u_and_r`, `accumulation_distribution`, `morning_star`,
`three_black_crows` (source risk present but not yet empirically triggered
— worth a real pass before concluding either way).

## 12. Safe-broad-tier list
`hammer`, `cup_handle`, `golden_cross`, `power_earnings_gap`,
`episodic_pivot`, `marubozu`, `nr7`, `vsa_no_supply`, `double_bottom`,
`ascending_triangle`, `rounded_base`, `bollinger_squeeze`,
`rsi_bullish_divergence`, `death_cross`, `stage_analysis`, `avwap_reclaim`,
`pullback_to_21ema` (broadly reliable at its current precision despite the
carried, documented residual recall gap).

## 13. Experimental/deprecation candidates
None recommended for deprecation research this wave — every detector with
an open concern has a plausible, bounded fix path (mostly "adopt the
already-proven current-state-recheck architecture") rather than a
foundational design flaw. `opening_range_breakout` is the closest to a
structural mismatch, but the fix is "give it an intraday corpus," not
"retire it."

## 14. Major unexpected findings
(1) **A materiality/ADR-floor gap**, not predicted from source tracing,
found empirically in two candlestick detectors (`shooting_star`,
`hanging_man`) — ratio-based geometry thresholds can be satisfied by
economically-insignificant noise on very-low-volatility names. This is a
NEW defect class not seen in any prior family this program has evaluated.
(2) **A context/quality gap distinct from freshness**: `wyckoff_upthrust`'s
mechanical trigger can be genuinely fresh and still front-run a much larger
real breakdown that contradicts the pattern's own implied outcome — the
"search bound != freshness" lesson generalizes, but this is a *different*
failure shape worth its own name (CONTEXT_DISAGREEMENT, already in the
taxonomy, now with a concrete instance). (3) **`pullback_to_50sma` confirms
the pullback-family defect transfers to a structurally-identical sibling
detector**, the fourth confirmed instance of "search bound != freshness"
after Bull Flag, the 21EMA pullback, and the candlestick engulfing family —
this is now a load-bearing, cross-family pattern, not a one-off. (4) Two
detectors (`accumulation_distribution`, `stage_analysis`) turned out to be
continuous-state classifiers that fire on 100% of evaluated windows — a
genuinely different product shape (an always-on reading) than every other
detector in the library, worth a deliberate product decision rather than
being evaluated as a discrete alert. (5) **A harness gap**:
`opening_range_breakout` is intraday-native by its own docstring and cannot
be meaningfully judged on the daily-bar corpora this harness currently
builds — the renderer/corpus infrastructure has no intraday profile yet.

## 15. Wave-2 recommendation
Do not deep-cycle anything yet. Before Wave 2: (a) build an intraday-bar
corpus profile so `opening_range_breakout` and any future gap/session
detector can be meaningfully Tier-1'd; (b) consider whether the
methodological deviation this wave (self-judged rather than
separately-dispatched blind judging, due to fork-tool constraints) needs a
follow-up pass with genuine independent judging on the 6 HARD_DEFECT_SUSPECTED
detectors before they're trusted for a fix decision. Wave 2 candidates
(next 20-25, not yet selected): remaining candlestick reversals
(`piercing`, `dark_cloud_cover`, `evening_star`, `doji`, `tweezer_top`,
`tweezer_bottom`, `outside_bar`), remaining classical structural
(`triple_bottom`, `triple_top`, `descending_triangle`, `falling_wedge`,
`rising_wedge`, `rectangle`, `symmetrical_triangle`, `channel`,
`inverse_head_shoulders`, `inverse_cup_handle`), remaining UCT-specific
(`liquid_leader_filter`, `kell_cycle`, `lance_opening_drive`,
`holy_grail`, `can_slim_composite`), momentum/event
(`macd_bullish_cross`, `macd_bearish_cross`, `rsi_bearish_divergence`,
`proximity_52w`, `td_sequential_buy`, `td_sequential_sell`), and
volume/structure (`volume_profile_nodes`, `support_resistance`,
`swing_pivots`, `major_trendlines`, `donchian_breakout`,
`inside_bar_breakout`, `outside_bar`, `opening_range_breakdown`,
`parabolic_short`).

This lab sweep does not replace the post-hold Track A (platform-native
runtime) or Track C (member-facing high-trust cohort) priorities — it
prepares Track B (recognition quality/breadth prioritization) in parallel.
No detector was fixed, no production code was changed, no merge to master
occurred, no release-train modification was made, nothing was deployed,
no Railway/flags/production DB was touched, and no production load was
generated. All work is isolated-worktree lab commits on branch
`recognition-quality-harness-lab`. The production hold (8G-B, 2026-09-08 RTH)
remains completely unaffected and unchanged.

**RECOGNITION LIBRARY WAVE 1 COMPLETE — 37 TOTAL DETECTORS NOW EVALUATED — 3 FLAGSHIP CANDIDATES / 12 HARD-DEFECT CANDIDATES / 17 BROAD-RELIABLE CANDIDATES — PRODUCTION HOLD UNCHANGED**

# Base & Structure Library — Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Take the base/structure library from "working and honest" to "reliable and complete" — every structure measured, every claim traceable, every known failure either fixed or attributed, and nothing built that reaches nobody.

**Spec:** `docs/superpowers/specs/2026-08-30-base-structure-library-design.md`

---

## Where we are, measured

| | state |
|---|---|
| Commits on branch | 17, nothing pushed |
| Structures shipped | 4 (Darvas Box · Green Line Breakout · Pocket Pivot · Power Play) |
| Structures measured for lift | 4 of 4 — **1 published, 3 refused** |
| Model-book templates with no detector | 32 → **28 remaining** |
| Overview blank rate | 0% (was 59%) |
| Tests | 185 in `tests/pattern_engine/primitives` |

## Definition of done

"Reliable and perfect" is not "every structure has a positive number". It is:

1. **Every published number is traceable** to a measurement we ran, with its method beside it.
2. **Every unpublished number is visibly absent**, never silently missing and never a zero.
3. **Nothing is built that reaches nobody** — the repo's own `lesson_built_tested_green_and_unreachable`.
4. **Every failing test is either fixed or attributed to a named cause.** "Pre-existing" is an attribution only once someone has found the cause.
5. **No value has two authorities.**

---

## Wave A — close the in-flight measurement

- [x] **A1** DONE. Darvas held at 30 trials: null max +2.10pp against a CI
      lower bound of +5.56pp, and ZERO of 30 trials reached it.
      *(original:)* Read the 30-trial Darvas null. If its CI lower bound (+5.56pp) no
      longer clears the null max, Darvas is refused and the ledger publishes
      NOTHING. That is a valid outcome; do not soften the gate to avoid it.
- [x] **A2** DONE — `docs/base_lift_ledger.json`, now 14 rows.
      *(original:)* Write `docs/base_lift_ledger.json`: one row per relation, each
      `published` with `{lift, ci_low, ci_high, n, null_max, null_trials}` or
      refused with `reasons`. Header records `measured_at`, `method`, `sample`,
      `baseline_metric`.
- [x] **A3** DONE, and a fourth was added later: a PUBLISHED row must
      carry >= 30 null trials, so the escalation rule is a rail rather
      than prose.
      *(original:)* Confirm the three artifact rails go green
      (`test_the_ledger_artifact_names_EVERY_relation`,
      `test_the_artifact_records_its_own_method_and_date`,
      `test_meta_never_reports_a_lift_the_ledger_refused`).
- [x] **A4** DONE.

## Wave B — make the evidence durable and visible

- [x] **B1** DONE — `lift_ledger.is_stale()` + `MAX_LEDGER_AGE_DAYS=120`
      + `test_an_undated_artifact_is_stale_by_definition`.
      *(original:)* the ledger goes stale silently today. `measured_at` is written
      and nothing reads it. Add `lift_ledger.is_stale(max_age_days)` and a rail
      that fails by name when the artifact is older than the bound. A number
      measured once and never re-checked is the `_a_comment_naming_a_mechanism_
      is_a_claim_about_a_run` shape in data form.
- [~] **B2 — DELIBERATELY NOT DONE, and this is the correction.** The
      plan called for a cron job; that was the wrong call. The web pod
      already carries ~135 cron jobs, 39 threads and a 39s boot, and the
      jobs cannot move off it (20+ SQLite DBs on its volume). This
      harness runs for MINUTES-TO-HOURS, and what it measures moves on a
      quarterly timescale, not a nightly one. It is a TOOL
      (`tools/run_lift_ledger.py`) and the freshness guarantee is B1's
      rail, which fails BY NAME and names the command. A job that
      silently stops running is invisible; a red rail is not. Reasoning
      lives in the tool's own docstring.
      *(original:)* Register a scheduler job that re-runs the ledger and rewrites the
      artifact. ⚠️ It must run where `bars.db` is complete, and it must NOT run
      inside the member-serving request path — the harness takes minutes.
      Follow the `_run_patterns_universe_scan` precedent for placement, and pin
      the job id with an AST test the way `test_schedulers.py` does.
- [x] **B3** DONE — `filters._structure_evidence()` surfaces the measured
      lift, CI and n on the `base_structure` filter, and a refused
      structure is ABSENT rather than present with a zero.
      *(original:)* the lift is in `meta()` and invisible on screen. Have the
      `base_render` / `base_shape` column descriptions state the measured lift
      or say plainly that there is none. This is the half-shipped-family rail
      applied to a number instead of a column.
- [x] **B4** DONE.

## Wave C — retire the second pattern vocabulary

The screener still carries TWO pattern vocabularies with five shared key names
on two different confidence scales (`pattern_conf_max` 0-1 vs
`pattern_engine_conf` 0-100). `pattern_join.py` documents the collision and
calls it unresolved. Overview no longer shows the cheap one; the filter, the
Patterns view seats and the columns remain.

- [x] **C1** DONE — queried the live table via `railway ssh`: **1 saved
      screen, 0 referencing the retired keys.**
      *(original:)* DO NOT DELETE ANYTHING FIRST. Saved screens serialize filter
      keys as JSON (`saved_screens.spec_json`). Query the live table for
      specs referencing `pattern` or `pattern_conf_max` and COUNT them. A
      deletion that breaks a member's saved screen is not a cleanup.
- [x] **C2** DONE — `api/services/screener/patterns.py` deleted; `pattern`
      and `pattern_conf_max` moved to `filters.RETIRED` with a typed
      refusal rather than silently dropped.
      *(original:)* If the count is zero: remove the `pattern` filter, the `patterns`
      and `pattern_conf_max` columns, and their Patterns-view seats; delete
      `api/services/screener/patterns.py`. If non-zero: write the migration
      that rewrites those specs onto `base_structure` first, and only then
      delete.
- [x] **C3** DONE.
      *(original:)* Rail: exactly one pattern vocabulary is reachable by a member.
- [x] **C4** DONE.

## Wave D — make the 85 existing detectors reachable

The highest value-to-effort item on this plan, and none of it is new detection.

- [x] **D1** DONE — near-universal detectors excluded by measured firing
      rate, guarded by `MIN_POPULATION_FOR_EXCLUSION` after a 0.95x1
      threshold excluded everything on a small population.
      *(original:)* `pattern_engine_ids` truncates at 10 while the median covered
      symbol carries 14 — **2,675 of 2,890 (92.6%) truncated**. Nine detectors
      fire on ~100% of the universe and are ranked last but still occupy the
      list. EXCLUDE them from the column rather than ranking them, and record
      the measured firing rate that justifies each exclusion.
- [x] **D2** DONE — all 78 firing detectors screenable, with ZERO new
      snapshot columns.
      *(original:)* Only 2 of 85 detectors have a screenable flag column. Promote the
      **37 detectors in the 1-10% band** — the informative tail — using the
      existing `_PATTERN_FLAG_COLUMNS` mechanism. ⚠️ Each new flag is a
      snapshot column and must be registered in all three rails Wave 1c already
      exercised (closed-table manifest, display def, member reachability).
- [x] **D3** DONE — truncation **90.8% -> 0%**, re-measured not assumed.
      *(original:)* Re-measure truncation after D1: the number that was 92.6% must be
      reported, not assumed improved.
- [x] **D4** DONE.

## ⚠️ MEASURED CONSTRAINT ON WAVE E — the ledger does not scale linearly

`tools/run_lift_ledger.py` re-runs the FULL historical scan once per null
trial. Measured 2026-08-30: Stage 2 Breakout at 373 tickers x 39,310 anchors
with 12 null trials took **46 minutes for ONE structure**. Twenty-eight more
structures at that setting is a multi-hour job, and Wave E cannot treat the
ledger as a cheap post-step.

The working shape, and it is already what Darvas got:
  - **screen at 5 null trials**, which is enough to refuse a structure whose
    interval is nowhere near its null (three of the first four were refused at
    that setting and none was close);
  - **escalate to 30 trials only for a structure that PASSES the screen**,
    where the null's upper tail is what the verdict actually turns on.
⛔ Do NOT lower the trial count to make a borderline structure pass — fewer
trials means a lower null maximum, which makes the gate EASIER. The escalation
runs in one direction only.

**The escalation is now parallel, and exactly so.** `null_lifts` seeds trial k
with `NULL_SEED + k`, so a 30-trial null is precisely three 10-trial chunks at
seed offsets 0/10/20. `--nulls-out` writes one chunk, `--nulls-in` recombines
them, and `tests/.../test_null_chunks.py` PROVES the equivalence on a cheap
fixture rather than asserting it — with a control that fails if the fixture
could not tell a correct recombination from a wrong one (both tests go red when
`+ k` is dropped from the seed).
⛔⛔ The recombiner REFUSES overlapping or gapped seed ranges. An overlap would
count one trial twice, which shrinks the spread and LOWERS the null maximum —
and since the maximum is the bar the CI's lower bound must clear, the error's
direction is to PUBLISH a structure that should have been refused. That is the
one failure mode this optimisation could have introduced, so it is the one
guarded first.

## Wave E — complete the structure vocabulary (28 remaining)

Each structure ships only when it has: sourced criteria with provenance, a
measured coverage figure recorded on the entry, and a ledger row (published or
refused). No structure ships on the strength of its geometry alone.

- [x] **E1 — flat/cup base detector. BOTH SHIPPED.**
      **Flat Base** (4.5% coverage): the published rules alone matched 41.1%
      of the universe -- above the band at which NR4 was deleted -- because
      IBD bounds the base's HEIGHT and never its SLOPE, so a smooth advance
      sits inside a 15% band and read as a flat base. Three gates of ours
      close that, each measured and each labelled ours: tightness (the house
      requires it and publishes no number), horizontality (DERIVED as
      two-thirds of the sourced depth ceiling), and a prior advance. A fourth
      rule -- the base opens at its high, since IBD counts from the first down
      week -- went into WINDOW SELECTION rather than the verdict: as a gate it
      cost half the population, as a window rule it costs 0.2pp and stops the
      base swallowing the advance it rests on.
      Ledger: **-6.89pp, refused** -- see its artifact note, because the sign
      is a property of what the predicate SELECTS, not a verdict on O'Neil.
      **Cup with Handle** (0.57% coverage, 0.6ms/ticker): geometry lives in
      `pattern_engine/primitives/cup.py`, beside the `shape.py` primitives
      built for it. `MIN_ROUNDNESS` is derived from a measured table (linear V
      0.000 / cosine cup 0.208 / semicircle 1.000, depth-invariant) after a
      hand-picked 0.30 refused every realistic cup. The 50% bear-market depth
      allowance is CONDITIONAL on a regime the detector is not given, so it is
      an opt-in argument and never the default. Bulkowski's measured numbers
      are recorded and REFUSED: different definition, no benchmark, no stated
      date range, hand-selected "perfect" patterns.
      ⛔⛔ IT SHIPPED ONCE MEASURING THE WRONG PATTERN. The first version
      omitted the prior-uptrend and volume-ease rules -- both sourced, one at
      high confidence -- and scored -8.47pp on 1.97% of the universe. A cup
      with no advance in front of it is a stock that fell and recovered, which
      is mean reversion; leaving the rule out did not make the detector looser,
      it made it a DIFFERENT detector, and publishing that number under
      O'Neil's name would have been a misattribution. With both rules in:
      0.57% coverage, **-7.18pp, refused**. The fixtures had hidden it -- they
      carried a 7% lead and flat volume and passed only because the detector
      did not yet ask.
      *(original wording:)* flat/cup base detector. Unblocks Base-on-Base, which is defined
      by its relationship to a prior base's pivot. Needs the `shape.py`
      roundness and rim-equality primitives already shipped.
- [x] **E2** Base-on-Base SHIPPED with `base_stage_count` -- the half that
      matters, since the pattern's entire function is to stop the base count
      incrementing. Three defects found on the way:
      (a) the backwards search slid its end index INTO the advance, found the
      trend's first bars as a "base", and measured a 30% breakout as 12%;
      (b) the peak was clipped at the new base's start, though an advance
      often peaks while the new base is forming. Both understate the gain, and
      understating the gain is the direction that wrongly reports a
      base-on-base.
      (c) it composed on the RAW base shape rather than the gated one, so the
      composed structure matched 21.2% of the universe while its own component
      matched 4.5%. `flat_base_qualifies` is now the single definition both
      ask -- a structure built out of another must never be looser than the
      thing it is built from. Coverage 0.62%.
- [~] **E3 — SCOPE CORRECTED AFTER CHECKING THE CORPUS.** Stage 2 Breakout
      and Stage 4 Breakdown shipped (Weinstein's volume rule is **asymmetric
      by design** — ~2x on the breakout, explicitly none on the breakdown).
      The other six do not survive contact with the research, and this is a
      finding, not a scheduling problem:

      **⛔ FOUR OF THEM HAVE NO PUBLISHED SOURCE AT ALL.** `20EMA Hold`,
      `EMA Crossback`, `EMA Crossover` and `Stage 2 Momentum` appear NOWHERE
      in the 15-source corpus that was assembled specifically to find this
      material. They come from our own `setupGroups.js` model-book taxonomy.
      The nearest real material is Qullamaggie's, and it is about EXIT
      management — "the rest of the position should be trailed with the 10- or
      the 20-day moving average" — plus a description of price "surfing" the
      rising 10- and 20-day *inside a base*. Neither is a standalone entry
      structure. Shipping them as canon would be inventing criteria and
      attributing them; shipping them as `origin="uct"` is honest but they are
      then OUR setups, not classics, and should be labelled that way on the
      surface. **Owner decision, not mine to make silently.**

      **⛔ FTD IS A CATEGORY ERROR ON THIS AXIS.** The Follow-Through Day is a
      MARKET-level gate — the "M" of CAN SLIM, measured on an index, not on a
      symbol. As a per-symbol RELATION it would return the identical value for
      all 3,705 rows, which is the purest possible form of the failure the
      coverage harness exists to catch (a label the whole market carries is
      not information). It belongs with regime/breadth, where the dashboard
      already reads market state. Its criteria are worth capturing regardless,
      because the corpus shows the commonly-quoted numbers are WRONG: IBD
      publishes "at least 1% to 1.25%" for the index gain, not the widely
      repeated 1.7%, and volume need only exceed the prior session, NOT the
      average. Also note the only measured test (Quantifiable Edges, 37 years,
      54.7%) publishes **no base rate**, so it is not comparable to anything.

      **Mean Reversion** has real sourcing (Grimes; Connors/Raschke) and is
      genuinely buildable — carried into E4 with the other momentum work.

      ⭐ SHIPPED INSTEAD, because they are canon and fully sourced: the O'Neil
      SEVEN BASES that were still missing. Cup with Handle, Flat Base and Base
      on Base are in; **Double Bottom** is in; Saucer with Handle, Ascending
      Base and High Tight Flag remain. That is a better use of the same effort
      than four detectors with nothing behind them.
- [~] **E4 — PARTIALLY BUILT, and the rest is the E3 finding again.**
      **Low Cheat SHIPPED** (1.1% coverage) as the same detector as the 3-C
      with one band moved -- Minervini's framing is positional, so a second
      detector would have put a second authority on every rule they share.
      **3-C Cheat SHIPPED** (2.2%), the best-sourced structure in the build.
      ⛔ `Go Signal`, `HVC` and `Wedge Pop` appear NOWHERE in the 15-source
      corpus -- the same finding as E3's four EMA setups. `Launchpad`,
      `Measured Move` and `Oops Reversal` have material but only as passing
      mentions or as another author's pattern (the Oops is Larry Williams',
      reaching us through Connors' ADX Gapper), so each would need its own
      sourcing pass before it could ship as anything but ours.
- [x] **E5 — DONE, with one substitution.** **Climax Top SHIPPED** (2.1%) --
      the "Late-Stage Climax", carrying the sharpest self-contradiction in the
      corpus: IBD's selling column says a 20%+ three-week surge should be HELD
      eight weeks and that a 25%+ three-week surge is a climax top. A 30% move
      in two weeks is both. **Parabolic Extension SHIPPED** (0.54%) in place
      of "Short Squeeze", which has no corpus material at all; it is the
      daily-detectable half of Kullamagi's parabolic short, with the intraday
      entry, the uncomputable cap branch and the asserted risk/reward all
      recorded as refusals. The **7-Week Short Rule** is a Morales/Kacher
      HOLDING rule (a clock that a buyable gap-up resets), not a per-symbol
      structure -- it belongs to position management, not to this axis.
      ⭐ Bearish coverage went from ONE structure to THREE, which matters
      because the render now leads with risk: a warning can only lead if a
      warning exists.
- [~] **E6 — ONE OF FOUR BUILT, and the premise changed under it.**
      **Buyable Gap-Up SHIPPED** (1.9%) -- and it is the most unusual
      provenance case in the library, because the corpus explicitly instructs
      us NOT to implement one of its gates: the volume rule reaches us in two
      phrasings differing by a factor of 1.67, with the note "Do not implement
      until resolved". The structure ships as an explicit SUBSET of the
      authors' rule, and a test proves the gate really is absent.
      ⛔ `Gap-and-Go` and `Red to Green` have ZERO corpus material. `Open Bull
      Gap Support` likewise.
      ⚠️ The `needs_intraday` half of this item is MOOT: F2 deleted the flag,
      because a field nothing sets is a claim nobody checks. The BGU records
      its intraday dependency as a REFUSAL on the criterion instead -- the
      authors' own confirmation rule ("not confirmed until the close", since
      it depends on volume accumulating through the session) cannot be
      expressed by a daily-bar detector, and saying so on the criterion is
      more useful than a boolean nothing reads.
- [~] **E7 — SCOPE CORRECTED. One event built, the schematic deliberately
      NOT.** Measured on the corpus itself: **184 refusals and not one
      criterion at high confidence carrying a published constant.** Its own
      summary says why -- "the Wyckoff corpus supplies a grammar, not
      thresholds... almost every criterion below is comparative ('wider spread
      than', 'less volume than the prior') with no published constant... there
      are only about a dozen [real numbers] in the entire corpus and most of
      them are illustrative examples on a $50 stock". And Wyckoff is quoted
      rejecting mechanical rules outright: "Instead of steadfast rules,
      Wyckoff advocated broad guidelines... Nothing in the stock market is
      definitive."
      A four-schematic, sequence-dependent state machine on that base would be
      OUR invention wearing his name, and would attribute to him a precision he
      explicitly denied. **Wyckoff Spring SHIPPED** (2.8% coverage) because the
      corpus itself singles it out: "this is the single most computable Wyckoff
      criterion in the corpus: `low < tr_support AND close > tr_support`". A
      rail asserts the other events are NOT registered, so a later pass cannot
      quietly add them without revisiting this.
      *(original:)* The Wyckoff schematic (4). Largest single build: a sequence-
      dependent state machine over a trading range, 22 of 28 events
      non-bootstrapping, SOS and Upthrust bar-identical at resistance. Its
      canon supplies 16 numbers against 183 refusals.

## Measured: where the scan time actually went

`bases._context` eagerly ran `zigzag.segment` on every context it built --
**8.48 ms** on a 600-bar window, against predicates costing 0.27-0.52 ms. The
lift harness builds a context PER ANCHOR (tens of thousands per scan, six
scans per screen), and neither base-on-base nor cup-with-handle reads a swing,
so ~97% of those screens was spent computing something nothing asked for. A
base-on-base screen ran **40 minutes without finishing**; the same screen now
takes **19 seconds**. `BaseCtx` segments lazily, `test_bases.py` pins that the
lazy and eager readings are identical, and a control asserts it really does
defer -- otherwise the speed claim could be false while every value test
passed. ⚠️ This is the second time the cost was in the harness rather than the
detector; measure before optimising a predicate.

## Measured: the scan was re-deriving one thing fourteen times

`bases._context` is the per-anchor cost (a volatility-scaled zigzag, 2.28 ms)
and the detectors cost 0.25-0.50 ms, so measuring N structures segmented the
IDENTICAL window N times. `--grouped` walks the anchors once per WINDOW group
and evaluates every detector on one context; the null reuses one set of
moving-block resamples across the group. Grouping is derived from `WINDOWS`,
never declared twice -- a 1,500-bar structure cannot ride a 400-bar pass
without silently becoming a different pattern.

⛔ Proved, not argued, because the detectors now share one mutable object per
anchor and a detector that wrote to it would change what every later detector
in that anchor sees -- raising nothing, and invisible to any single-structure
test. The shared pass is compared field by field against the separate passes,
the shared null against the separate null, and one deliberately broken
detector must not poison its neighbours (error counts moved from a single
global to per-structure). Mutation-checked.

## Wave F — rails promised and not yet written

- [x] **F1** DONE — the boundary was being crossed by 16 detectors on
      68.8% of symbols; now enforced by `category` in
      `pattern_join._SCREENER_EXCLUDED_CATEGORIES`, railed in
      `tests/test_screener_wave5_pattern_join.py`. I had asserted this
      rail existed when it did not.
      *(original:)* The candle/engine boundary. The owner ruled the 18
      `detectors/candlestick/*` stay, on the grounds that the chart overlay
      consumes them. That ruling is only safe if the boundary is enforced: the
      candle library owns screener columns, the engine owns the chart overlay,
      neither crosses. I asserted this rail exists; it does not. Write it.
- [x] **F2** DONE — DELETED. It was declared, surfaced, and gated nothing;
      a tombstone comment records why rather than leaving a silent gap.
      *(original:)* `needs_intraday` must gate something real (see E6) or be deleted.
      A field nothing sets is a claim nobody checks.

## Wave G — the failures nobody has explained

⛔ Every one of these has been reported as "pre-existing". That is a
*correlation*, not an attribution — I established only that they fail without
my changes, never WHY they fail. Finish the job.

- [x] **G1** DONE — not flaky: a cold first mount measured 451ms against
      testing-library's 1000ms default, 2.2x headroom, which collapses
      under concurrent load. Explicit 5000ms timeout; 418/418 under load.
      *(original:)* `ScreensManager.door.test.jsx` — intermittent. Observed twice
      under heavy concurrent load, then 5 consecutive clean runs. Reproduce
      deterministically (run the suite under CPU load) and fix or quarantine.
- [x] **G2** DONE — an exact index-set assertion went stale when
      `idx_pd_detected` landed; now a subset assertion with a
      non-vacuity control.
      *(original:)* `test_memory_schema.py` —
      failing throughout. Likely `idx_pd_detected` absent from the local
      `patterns.db`; confirm and either fix the fixture or the schema.
- [x] **G3** DONE — a hardcoded `detected_at` of 1700100100 (2023-11-16)
      against a 7-day active window. Swept across 3 files.
- [x] **G4** DONE — a HALF-FAKED CLOCK: `_now_et` was faked while
      `read_analyst_fields` used real `time.time()` for its 8-day cutoff,
      so a fixture pinned to 2026-08-22 rotted exactly 8 days later.
      `now` is now injectable.
      *(original:)* `test_screener_wave2_analyst_job.py::test_run_pass_stops_at_the_
      deadline_and_the_receipt_closes` — `KeyError: 'BBB'`.

## Wave H — ship

- [ ] **H1** Full suite green, or every remaining failure attributed to a named
      cause in the commit.
- [x] **H2** DONE — `bases.classify` = **23.0s for 3,707 tickers**, 0.3x
      the weekly candle pass. Re-check after the structures added since.
      *(original:)* measure the nightly cost. `bases.classify` now runs per ticker
      inside the 3:00 AM build and reads `bars_full`. Measured in isolation it
      is ~17s for 3,707 tickers, but that was WITHOUT the rest of the build's
      work and cache pressure. Time the real build before shipping; the weekly
      and monthly candle passes cost 9.1s and are documented, so this belongs
      in the same ledger.
- [ ] **H3** Merge and push per `lesson_uct_dashboard_shared_worktree`:
      never `git add -A`, `push origin <branch>:master`, fetch → merge →
      re-verify → push, never force.

---

## Known follow-up, measured and NOT done here

**`base_catalog.py` is 4,292 lines carrying 18 structure definitions.** It
tripled during this build and the repo's own guidance prefers smaller focused
files. It is not split here, deliberately: the remaining work is H1 (suite
green) and H3 (merge), and a package-level refactor of the file every
structure and every rail imports is exactly the change that turns a green
branch red at the finish line.

The seam is already established and should be followed when it is split: the
cup's geometry lives in `pattern_engine/primitives/cup.py` while its
PROVENANCE lives in the catalog. Extracting the remaining state functions the
same way is the natural first cut (~800 lines), though the bulk is the
criteria blocks -- and those are the product, not overhead. A split by house
(`oneil.py`, `minervini.py`, ...) would cut deeper but reorganises the one
file whose diff reviewers actually read.

⚠️ Do NOT split it as a tidy-up alongside a behaviour change. Every structure's
verdict is a published number now; a move that shuffles definitions and edits
logic in the same commit makes any regression un-bisectable.

## Explicitly out of scope

- **Re-enabling `PATTERN_VISION_ENABLED`.** The 640 confirmed verdicts remain
  the only validated pattern output; a confirmed-only surface is its own change.
- **Expanding intraday bar coverage** beyond today's 2.6-7.0%.
- **Correcting `setup_templates`' unsourced numbers.** The corpus proves several
  are unattributable; that is a reviewed change to the model book, not this.

## The refusal rate, and the decision taken on it

Thirteen of the first fourteen structures were refused, which reads alarming
until the refusals are separated. They are three different situations:

- **Measured NEGATIVE (4):** cup-with-handle -7.18pp, flat-base -6.89pp,
  pocket-pivot -6.55pp, green-line-breakout -4.96pp. These resolved WORSE than
  their own pattern-free baseline. Findings, not failures.
- **Too rare to measure (4):** power-play (n=13, interval 61pp wide),
  high-tight-flag (n=53), ascending-base (n=69, 24pp wide), stage-2 (n=153).
  Nothing concludable in either direction; the limit is the SAMPLE.
- **Positive but cannot clear their own null (5):** stage-4 +8.35pp (n=1,146,
  missed by 9 basis points), double-bottom +4.44pp (n=1,849), vcp +3.59pp,
  square-box +1.07pp, base-on-base.

⭐ AND THE BAR IS A CHOICE. The gate asks the CI's LOWER bound to beat the
null's MAXIMUM, which is stricter than a conventional significance test. Under
"the central estimate beats the null and the interval excludes zero" -- also a
legitimate standard -- FOUR would publish rather than one.
⛔ But a naive relaxation is worse than it looks: `lift > null_max` alone would
have "published" flat-base at **-6.89pp**, because its lift exceeds its own
NEGATIVE null. Any loosening needs a sign condition or it publishes losers.

**Decision (owner deferred to me, 2026-08-30): widen the sample, keep the
bar.** Most rows were measured on 279 tickers against a universe of 3,461, and
a wider sample can only tighten intervals -- it is the honest lever, because
it changes the evidence rather than the standard.
⛔⛔ ONCE, AND WHATEVER COMES BACK STANDS. Re-running at successively wider
samples until a structure passes is p-hacking with extra steps. The full-
universe run is a single run and its output is the answer, including for
structures that come back WORSE.

That required removing the reason the sample was ever narrow: measuring the
structures one at a time re-derived the same per-anchor context for each, so a
full-universe pass would have taken ~20 hours. See the note below.

## The honest risk

Wave E adds 28 structures. **The measured expectation is that most earn no
number** — 3 of the first 4 were refused, and two of those were measurably
negative. The plan is correct anyway: a named structure with an honest blank is
worth more than an unnamed one, and the ledger is what keeps the blank honest.
⛔ The failure mode to watch for is pressure to soften the gates as the refusal
count grows. The gates are the product.

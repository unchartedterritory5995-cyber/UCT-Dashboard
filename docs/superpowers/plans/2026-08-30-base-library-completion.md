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

- [ ] **A1** Read the 30-trial Darvas null. If its CI lower bound (+5.56pp) no
      longer clears the null max, Darvas is refused and the ledger publishes
      NOTHING. That is a valid outcome; do not soften the gate to avoid it.
- [ ] **A2** Write `docs/base_lift_ledger.json`: one row per relation, each
      `published` with `{lift, ci_low, ci_high, n, null_max, null_trials}` or
      refused with `reasons`. Header records `measured_at`, `method`, `sample`,
      `baseline_metric`.
- [ ] **A3** Confirm the three artifact rails go green
      (`test_the_ledger_artifact_names_EVERY_relation`,
      `test_the_artifact_records_its_own_method_and_date`,
      `test_meta_never_reports_a_lift_the_ledger_refused`).
- [ ] **A4** Commit.

## Wave B — make the evidence durable and visible

- [ ] **B1 — the ledger goes stale silently today.** `measured_at` is written
      and nothing reads it. Add `lift_ledger.is_stale(max_age_days)` and a rail
      that fails by name when the artifact is older than the bound. A number
      measured once and never re-checked is the `_a_comment_naming_a_mechanism_
      is_a_claim_about_a_run` shape in data form.
- [ ] **B2** Register a scheduler job that re-runs the ledger and rewrites the
      artifact. ⚠️ It must run where `bars.db` is complete, and it must NOT run
      inside the member-serving request path — the harness takes minutes.
      Follow the `_run_patterns_universe_scan` precedent for placement, and pin
      the job id with an AST test the way `test_schedulers.py` does.
- [ ] **B3 — the lift is in `meta()` and invisible on screen.** Have the
      `base_render` / `base_shape` column descriptions state the measured lift
      or say plainly that there is none. This is the half-shipped-family rail
      applied to a number instead of a column.
- [ ] **B4** Commit.

## Wave C — retire the second pattern vocabulary

The screener still carries TWO pattern vocabularies with five shared key names
on two different confidence scales (`pattern_conf_max` 0-1 vs
`pattern_engine_conf` 0-100). `pattern_join.py` documents the collision and
calls it unresolved. Overview no longer shows the cheap one; the filter, the
Patterns view seats and the columns remain.

- [ ] **C1 — DO NOT DELETE ANYTHING FIRST.** Saved screens serialize filter
      keys as JSON (`saved_screens.spec_json`). Query the live table for
      specs referencing `pattern` or `pattern_conf_max` and COUNT them. A
      deletion that breaks a member's saved screen is not a cleanup.
- [ ] **C2** If the count is zero: remove the `pattern` filter, the `patterns`
      and `pattern_conf_max` columns, and their Patterns-view seats; delete
      `api/services/screener/patterns.py`. If non-zero: write the migration
      that rewrites those specs onto `base_structure` first, and only then
      delete.
- [ ] **C3** Rail: exactly one pattern vocabulary is reachable by a member.
- [ ] **C4** Commit.

## Wave D — make the 85 existing detectors reachable

The highest value-to-effort item on this plan, and none of it is new detection.

- [ ] **D1** `pattern_engine_ids` truncates at 10 while the median covered
      symbol carries 14 — **2,675 of 2,890 (92.6%) truncated**. Nine detectors
      fire on ~100% of the universe and are ranked last but still occupy the
      list. EXCLUDE them from the column rather than ranking them, and record
      the measured firing rate that justifies each exclusion.
- [ ] **D2** Only 2 of 85 detectors have a screenable flag column. Promote the
      **37 detectors in the 1-10% band** — the informative tail — using the
      existing `_PATTERN_FLAG_COLUMNS` mechanism. ⚠️ Each new flag is a
      snapshot column and must be registered in all three rails Wave 1c already
      exercised (closed-table manifest, display def, member reachability).
- [ ] **D3** Re-measure truncation after D1: the number that was 92.6% must be
      reported, not assumed improved.
- [ ] **D4** Commit.

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
- [ ] **E3** Stage / trend / remount (8): Stage 2 Breakout · Stage 2 Momentum ·
      Stage 4 Breakdown · 20EMA Hold · EMA Crossback · EMA Crossover · FTD ·
      Mean Reversion. ⚠️ Weinstein's volume rule is **asymmetric by design** —
      ~2x on a Stage 2 breakout, explicitly none on a Stage 4 breakdown.
- [ ] **E4** Momentum continuation (7): Low-Cheat · Go Signal · HVC · Launchpad ·
      Wedge Pop · Measured Move · Oops Reversal.
- [ ] **E5** Short setups (3): 7-Week Short Rule · Late-Stage Climax ·
      Short Squeeze.
- [ ] **E6** Gap & catalyst (4) with the §6.1 intraday decomposition:
      BGU · Gap-and-Go · Open Bull Gap Support · Red to Green.
      ⚠️ `needs_intraday` exists on `Structure` and NO structure sets it yet —
      the flag is currently unexercised and must gate something or be removed.
- [ ] **E7** The Wyckoff schematic (4). Largest single build: a sequence-
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

## Wave F — rails promised and not yet written

- [ ] **F1** The candle/engine boundary. The owner ruled the 18
      `detectors/candlestick/*` stay, on the grounds that the chart overlay
      consumes them. That ruling is only safe if the boundary is enforced: the
      candle library owns screener columns, the engine owns the chart overlay,
      neither crosses. I asserted this rail exists; it does not. Write it.
- [ ] **F2** `needs_intraday` must gate something real (see E6) or be deleted.
      A field nothing sets is a claim nobody checks.

## Wave G — the failures nobody has explained

⛔ Every one of these has been reported as "pre-existing". That is a
*correlation*, not an attribution — I established only that they fail without
my changes, never WHY they fail. Finish the job.

- [ ] **G1** `ScreensManager.door.test.jsx` — intermittent. Observed twice
      under heavy concurrent load, then 5 consecutive clean runs. Reproduce
      deterministically (run the suite under CPU load) and fix or quarantine.
- [ ] **G2** `test_memory_schema.py::test_pattern_detections_indexes_exist` —
      failing throughout. Likely `idx_pd_detected` absent from the local
      `patterns.db`; confirm and either fix the fixture or the schema.
- [ ] **G3** `test_router_patterns.py::test_get_detections_returns_stored`.
- [ ] **G4** `test_screener_wave2_analyst_job.py::test_run_pass_stops_at_the_
      deadline_and_the_receipt_closes` — `KeyError: 'BBB'`.

## Wave H — ship

- [ ] **H1** Full suite green, or every remaining failure attributed to a named
      cause in the commit.
- [ ] **H2 — measure the nightly cost.** `bases.classify` now runs per ticker
      inside the 3:00 AM build and reads `bars_full`. Measured in isolation it
      is ~17s for 3,707 tickers, but that was WITHOUT the rest of the build's
      work and cache pressure. Time the real build before shipping; the weekly
      and monthly candle passes cost 9.1s and are documented, so this belongs
      in the same ledger.
- [ ] **H3** Merge and push per `lesson_uct_dashboard_shared_worktree`:
      never `git add -A`, `push origin <branch>:master`, fetch → merge →
      re-verify → push, never force.

---

## Explicitly out of scope

- **Re-enabling `PATTERN_VISION_ENABLED`.** The 640 confirmed verdicts remain
  the only validated pattern output; a confirmed-only surface is its own change.
- **Expanding intraday bar coverage** beyond today's 2.6-7.0%.
- **Correcting `setup_templates`' unsourced numbers.** The corpus proves several
  are unattributable; that is a reviewed change to the model book, not this.

## The honest risk

Wave E adds 28 structures. **The measured expectation is that most earn no
number** — 3 of the first 4 were refused, and two of those were measurably
negative. The plan is correct anyway: a named structure with an honest blank is
worth more than an unnamed one, and the ledger is what keeps the blank honest.
⛔ The failure mode to watch for is pressure to soften the gates as the refusal
count grows. The gates are the product.

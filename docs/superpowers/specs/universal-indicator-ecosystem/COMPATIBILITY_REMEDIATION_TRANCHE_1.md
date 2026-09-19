# Compatibility Remediation Tranche 1 — Adjudication + Implementation Report

Executes the bounded remediation tranche authorized after
`PUBLIC_SCRIPT_LAYER_C_TAXONOMY_SYNTHESIS.md`: root-cause all five evidence-based
findings from the 8-script public corpus, ship only the fixes that are narrow, safe,
and clearly inside the existing Phase Two/Track F v1 authorization, and leave
everything else classified and deferred. **No BuilderSheet visual-exposure work
(bands/fill/colorMode). No Stoch. No ADX-family. No broad Pine-language expansion.**

---

## Part 1 — Adjudication (root cause of each finding)

### 1. Silent Save no-op — investigated first, per instruction

Checkpoint 02 recorded ONE finding under this name but it was actually TWO
different observations conflated together. Traced separately, with different
verdicts:

**1a. "Clicking Save on a column whose readback still carries an error" — NOT A
DEFECT.** `FormulaField.jsx::canSaveFormula(result, acknowledged)` returns
`false` whenever `!result.ok` (line 285), and `BuilderSheet.jsx`'s Save button
carries a real DOM `disabled={!canSave}` attribute (confirmed by direct
reading). A disabled `<button>` never fires `onClick` at all — there is no
code path inside `save()` for this scenario to reach. What Checkpoint 02
observed was almost certainly a disabled button correctly not responding,
misread as a defect. **Root subsystem: none — the gate already exists and
already works as designed.**

**1b. "A fresh, valid, hand-typed formula's first Save click did not persist;
the second did" — REAL, root-caused.** `FormulaField.jsx` debounces every
evaluation by `FORMULA_DEBOUNCE_MS` (250ms; confirmed via direct reading of
the `useEffect`/`setTimeout` at the top of the file). `result`/`canSave` in
`BuilderSheet.jsx` reflect the LAST **settled** evaluation, not the current
textarea value. For up to 250ms after any keystroke or paste, the Save
button's `disabled` state can still reflect the *previous* formula's verdict.
A member who types and clicks quickly can land their click inside that
window, on a button that is — correctly, by the existing design — still
disabled from a moment ago. The click is swallowed with zero feedback:
indistinguishable from broken.
- **Reproduction**: type a formula, click Save before ~250ms elapse.
- **Does Save visually signal success?** No — nothing happens; the button
  simply does not respond (disabled elements never fire `onClick`).
- **Is a definition written?** No — `save()`'s body never runs.
- **Does reload lose it?** N/A — nothing was ever sent.
- **Telemetry?** Correctly silent — no `import_accepted`/save event fires,
  because `save()` never executed.
- **Cause, from the given list**: **validation state** — specifically, a
  timing gap between the value changing and the debounced verdict updating,
  with no UI signal that evaluation is in flight. Not a missing payload, not
  an unsupported translation, not a wiring bug, not an API rejection, not a
  swallowed exception.

### 2. Boolean input in a conditional

**Root cause, NOT about booleans as a type.** `PineBox.jsx`'s own "downstream"
verdict — the same `evaluateFormula` the text box uses, computing what a
member sees beside each candidate — was called as
`evaluateFormula(out.formula, BUILDER_INPUT_SCOPE)` at both its call sites
(`inspectPine`, `inspectSource`). `BUILDER_INPUT_SCOPE` is the FIXED chrome
scope (`color`, `lineWidth`) every document carries — it never included the
candidate's OWN declared inputs. `memberInputTranslation` (in the SAME file,
two lines above each call site) already computes exactly that list, stamped
onto `out.memberInputs` — machinery already shipped and already proven live
for numeric knobs (Checkpoint 02's own `pd`/`mult`-adjacent findings). The
downstream verdict simply never read it.
- **Layer**: translator/import ORCHESTRATION (`PineBox.jsx`), not the
  translator, the interpreter, or the sentence read-back themselves — all
  three of those already handle a declared input correctly once given the
  right scope (verified directly: passing the merged scope resolves every
  affected column with no other change anywhere).
- **Why booleans dominated the sample**: a numeric input used as a LENGTH is
  window-bound and gets folded back to a literal (`builderInputs.js`'s own
  `windowRefusal` mechanism) — it never reaches the printed formula as a bare
  name. A boolean used as a GATE (`showX ? … : na`) almost never is
  window-bound, so it survives as a genuine identifier far more often. The
  bug affects ANY declared input referenced by name, not booleans specifically.
- **This IS a narrow translator-orchestration correctness fix, not a Track F
  v2 expansion** — no new capability, no new UI, no new node type; it merges
  two already-computed values.

### 3. Input-binding convention (Formula tab's own "+ Add an input")

**A DIFFERENT root cause from #2, confirmed by direct investigation — not
duplicated.** Checkpoint 02's own reproduction (`ema(macd(close,12,26),
signalLength)` refusing with "a window must be a whole-number literal…")
is the SAME underlying engine restriction `builderInputs.js::windowRefusal`
already names and handles gracefully for the Pine IMPORT path: a window/length
argument must be a literal (`interpret.js::windowLiteral`), a static-decidability
invariant, not a bug. The gap is that the NATIVE FORMULA TAB'S OWN "+ Add an
input" UI has no equivalent PRE-CHECK — it lets a member type the reference
and then surfaces the raw, low-level interpreter refusal (naming a JSON node
shape) instead of the same clear, actionable sentence the Pine import path
already produces for the identical restriction. **Classified as a real,
narrow, UI-message gap — not fixed this tranche** (a second, smaller-blast
fix candidate for a future pass; not touched here to keep this tranche to
the highest-leverage item).

### 4. "Layer-A fidelity gap"

Resolved to an exact statement, per instruction:
- **INPUT**: `18-minervini-trend-template.pine`, recorded `SUPPORTED` by
  Layer A's static corpus benchmark (`BENCHMARK_REPRODUCTION.md`).
- **CURRENT TRANSLATION (static/Layer A)**: `translatePine(src)` with no
  `declareInputs` folds `show_52_week_high_low` (default `true`) straight to
  a literal, so the static check sees a fully-resolved formula and marks it
  translatable.
- **EXPECTED / REAL-IMPORT TRANSLATION**: the real product path uses declare
  mode (Track F) so the input can become a member-adjustable knob; this is
  where `#2`'s scope-omission bug fired.
- **USER-VISIBLE CONSEQUENCE (before this tranche)**: zero of Minervini's two
  offered columns actually resolve through the real Import UI, despite the
  static "SUPPORTED" label.
- **Severity/generality**: not a single bug — a standing METHODOLOGY risk
  (a coarse static pass/fail label can overclaim relative to the real
  member-facing import experience for this construct class). Not
  `SILENT_WRONG_RESULT` — every failure is a loud, correct, per-column
  refusal, never a wrong number.
- **Verdict after investigation**: this specific script's gap is caused
  **entirely** by #2's scope bug PLUS a separate, deliberately-excluded
  input kind (see #2's continuation below) — not an independent code defect
  requiring its own fix.

### 5. QQE MOD's ratchet limit

**Root cause found precisely, via direct code reading and minimal
reductions — and it is NOT what Checkpoint 02 assumed.** The refusal
(`pine:state`) fires from `forgetsItsSeed`'s convergence gate in `pine.js`, a
symbolic (not numeric-simulation) soundness check: it proves an `accum()`
candidate's update expression is linear in `self` with a bounded coefficient,
UNLESS the expression is "switched" (a `?:`/`min`/`max`/`nz` branch), in which
case ONLY a bare `self` (lag 0) is accepted inside that branch — a lagged
self-reference (`self[1]`) inside a switch is refused UNCONDITIONALLY, by
design. This is proven necessary, not merely cautious: the code carries a
real, pinned adversarial counterexample (`pine.convergence.test.js`) showing a
switched multi-lag linear system can diverge even though every arm
individually contracts.
- **A minimal reduction of the EXACT general shape** (`self` referenced twice
  inside one `and`-condition, feeding a `math.max` ternary) **translates
  successfully** — ruling out "two mutually-referencing accumulators" as the
  actual limitation (Checkpoint 02's own characterization). The real trigger
  is narrower and different: `shortBand`'s update embeds `shortBand[1]` (a
  LAGGED self-reference) directly inside `math.min(shortBand[1],
  newShortBand)` — Chandelier Exit's own, already-working ratchot avoids this
  exact shape by first LET-binding the lagged reference
  (`shortStopPrev = nz(shortStop[1], shortStop)`), which resolves to a BARE
  `self` by the time it reaches the `min`/`max` call, and a bare `self` inside
  a switch is unconditionally accepted.
- **Generality (the question posed)**: **A — a general limitation**, not
  script-specific: ANY ratchet that inlines a lagged self-reference directly
  inside a `min`/`max`/`?:` arm (rather than pre-binding it to a plain name
  first) hits this, regardless of script.
- **Verdict**: this is a real, understood, but SAFETY-CRITICAL boundary,
  explicitly protected in-code by a dual-ownership rule
  (`closedTable.json::_no_offset_reopened_by` — "the repaint-claim owner and
  the manifest owner, together"). Reopening or working around it would touch
  the soundness proof itself, which is exactly the "significant
  execution-model extension" the instructions say to leave classified.
  **NOT implemented. No workaround attempted.**

---

## Part 2 — Which findings share one root cause

**#2 and #4 share the SAME primary root cause** (the `PineBox.jsx` scope
omission) for the bare-`input()`-declared half of the corpus. #4 additionally
runs into a SECOND, separate, pre-existing, deliberate exclusion (below) for
its specific script. **#1, #3, and #5 are each independent** — no shared root
cause with #2/#4 or each other.

## Part 3 — What shipped vs. what is classified and deferred

### Shipped (inside existing authorization, narrow, regression-tested)

1. **`PineBox.jsx`: `downstreamScopeFor(out)`** — merges
   `BUILDER_INPUT_SCOPE` with `declaredInputs({inputs: out.memberInputs})` at
   both call sites (`inspectPine`, `inspectSource`). Closes #2 for every
   declared input reached via a BARE, untyped `input(...)` call (Pine
   v3/v4's idiom) — confirmed live: `03-cm-williams-vix-fix.pine`'s `hp`/`sd`
   and `17-pocket-pivot-breakout.pine`'s `gapcandle` all read back cleanly,
   with zero other change anywhere in the translator, interpreter, or
   read-back.
2. **`FormulaField.jsx`: `onPendingChange` + `BuilderSheet.jsx`: `pending`
   state, surfaced ONLY via the existing `save-hint` paragraph** ("Checking
   your formula…"). Closes #1b: converts a silent, unexplained non-response
   during the debounce window into a clear, temporary, correctly-worded
   state. **Deliberately does NOT gate `canSave`** — an earlier version that
   did was reverted after it changed the Save button's own label/enabled
   timing widely enough to break unrelated existing test assertions across
   multiple suites; the informational-only version closes the reported
   "silent" defect (contract clause B: clearly refuse/explain) without that
   blast radius.

### Investigated, a working fix found, explicitly NOT shipped

**#2's `input.bool` half (Minervini's `show_52_week_high_low`, Support
Resistance Channels' `showthema1en`/`showthema2en`).** Moving `'input.bool'`
from `builderInputs.js::FOLDED_INPUT_INEXPRESSIBLE` into `FOLDED_INPUT_TYPES`
(mapped to `'int'`, exactly how a bare boolean `input()` is already
classified) was implemented, tested, and **confirmed to close both scripts'
gaps completely** — `pine.js::resolveInput` already folds `input.bool` and
bare `input(true/false,…)` byte-identically, so the fix is mechanically
identical to #2's shipped half. **Reverted before commit.** Reason: doing so
collides with an explicit, in-code owner instruction —
`pine.js::PARAM_MANIFEST_ELIGIBLE_KINDS`'s own comment states "Track F's v1
scope is int/float only," and a dedicated cross-file test
(`pine.paramManifest.test.js`) pins `FOLDED_INPUT_TYPES`'s keys and that set
to name the same kinds SPECIFICALLY so one cannot widen without the other.
Shipping this would be exactly the silent Track-F-scope-widening that pin
exists to catch. **Classified, not implemented, pending an explicit owner
decision to extend Track F's v1 scope to include `bool`.**

### Classified and deferred, per explicit instruction

- **#3** (Formula tab's "+ Add an input" binding convention) — a real,
  understood, narrow UX-message gap; not touched this tranche (kept to the
  single highest-leverage item, #2, per the objective's own "smallest number
  of high-leverage defects" instruction).
- **#5** (QQE's ratchet limit) — a general, deliberate, proven-sound
  safety boundary; touching it means touching a soundness-critical
  numerical gate under an explicit dual-ownership rule. Left classified.

### Explicitly not started (per standing scope control)

Stoch parity, ADX-family parity, Track F v2, broad parser expansion, broad
Pine compatibility work, RISK-004 remediation, intraday pipeline work,
BuilderSheet visual-exposure controls (bands/fill/colorMode), kernel rewrite.

---

## Part 4 — Corpus re-run: BEFORE (Checkpoint 02) vs AFTER (this tranche)

Re-run via `inspectPine()` — the exact function `PineBox.jsx`'s real Import UI
calls — against the same 8 scripts, unmodified. Scripts NOT touched by either
shipped fix show byte-identical results to Checkpoint 02, confirmed directly.

| # | Script | Before | After | Change |
|---|---|---|---|---|
| 1 | Chandelier Exit | 9/9 clean, saved | 10/10 clean (a 10th minor candidate present in this pass's fuller enumeration; both counts are "every offered column resolves") | No functional change — already fully working |
| 2 | QQE MOD | 3/6 real outputs (3 blocked upstream, `pine:state`) | 3/6 real outputs (same 3 blocked, same guard) | **Unchanged — correctly left alone (#5, classified/deferred)** |
| 3 | CM Williams Vix Fix | 3/4 clean, 1 (`hp`-gated) blocked `sentence:name` | **4/4 clean** | **FIXED** by the shipped scope-merge |
| 4 | Daily/Weekly/Monthly H/L | 0/6, total refusal `pine:collection` | 0/6, total refusal `pine:collection` (same) | Unchanged — correct refusal, unrelated to this tranche |
| 5 | ZigZag++ | 0/8, total refusal `pine:module` | 0/8, total refusal `pine:module` (same) | Unchanged — correct refusal, unrelated to this tranche |
| 6 | Support Resistance Channels | Checkpoint 02 tested 2 candidates, 0/2 usable (`showthema1en`/`showthema2en`-gated) | Those same 2 candidates: **still `sentence:name`-blocked** (`input.bool`, classified/deferred). 4 OTHER candidates on this script (outside Checkpoint 02's own tested set; 2 more separately refuse `pine:reassign`, unrelated) resolve clean | **The originally-cited gap is unchanged** — closing it needs the deferred `input.bool` decision, not the shipped fix |
| 7 | Minervini Trend Template | 0/2 usable, despite Layer A `SUPPORTED` | **Still 0/2 usable** | **Unchanged** — the working fix exists (verified) but was deliberately not shipped (Track F v1 scope boundary) |
| 8 | Pocket Pivot Breakout | ≤1/3 confirmed clean | **3/3 clean** | **FIXED** by the shipped scope-merge (`gapcandle`, a bare `input()`) |

**Net**: 2 of 8 scripts (VIX Fix, Pocket Pivot Breakout) move from
partially-broken to fully clean. 2 more (Minervini, Support Resistance
Channels) have a verified, ready, but deliberately unshipped fix pending an
owner decision. 4 are correctly unchanged (2 already fully working, 2
correctly refused for unrelated, untouched reasons). **No script regressed.**

---

## Part 5 — Non-vacuity

- **`downstreamScopeFor`**: reverting it to `BUILDER_INPUT_SCOPE` alone
  reproduces the exact `sentence:name` refusal on VIX Fix's `hp`/`sd` columns
  and Pocket Pivot's `gapcandle` column, verified by hand before either
  regression test was written (`pineBoxDownstreamScope.test.jsx`, 3 tests, all
  against the real corpus files or a minimal reduction, none mocked on the
  path under test).
- **`onPendingChange`**: `BuilderSheet.savePending.test.jsx` (4 tests) proves
  (a) the hint appears the instant text changes, before the debounce settles;
  (b) the Save button's own label/disabled state is BYTE-IDENTICAL to before
  this change, mid-debounce (the regression guard against the reverted,
  wider-blast-radius version); (c) the hint clears and Save enables once
  settled on a valid, named formula; (d) an invalid formula gets its OWN
  hint once settled, never stuck reading "Checking your formula…" forever.
- **The `input.bool` reclassification was verified working, then deliberately
  reverted** — its own would-be regression test (a 3rd case in
  `pineBoxDownstreamScope.test.jsx`) instead PINS the current, correct,
  deliberate boundary: Minervini's two columns still refuse at
  `sentence:name`, named explicitly as a REGRESSION-PINNING test for a
  classified decision, not a defect.
- **Unrelated scripts unchanged**: Chandelier Exit, Daily/Weekly/Monthly H/L,
  ZigZag++, and QQE MOD's own outputs are byte-identical before/after (Part 4).
- **Correct refusals remain refusals**: `pine:collection` (arrays),
  `pine:module` (external import), `pine:reassign` (Support Resistance
  Channels' `resistancebroken`/`supportbroken`), and `pine:state` (QQE's
  ratchet) are all unchanged.

## Part 6 — Regression sweep

Full `app/src/components/chart/builder/` + `app/src/components/chart/engine/ast/`
suites (3,745 tests across 169 files) re-run after both shipped changes:
**3,742 passed.** The 3 failures are CONFIRMED pre-existing and unrelated,
each isolated via `git stash` against a clean baseline before any change in
this tranche:
- `BuilderSheet.pine.test.jsx` — "the SAVED DOCUMENT is byte-identical…" —
  fails identically with this tranche's changes fully stashed.
- `ImportBox.thinkscript.test.jsx` — a known CRLF/LF line-ending flake
  (already named as such in this repo's own `CLAUDE.md`).
- `pine.blindCorpus.test.js` — "the accepted floor moves one way too"
  (27 vs 27) — fails identically on a clean baseline.

No Python/backend files were touched this tranche; no backend suite was run.

---

## Part 7 — Commit

This document's own commit hash is recorded in the commit that adds it,
alongside the four modified files
(`PineBox.jsx`, `FormulaField.jsx`, `BuilderSheet.jsx`, `builderInputs.js`
— the last documentation-only, recording the classified `input.bool`
decision) and two new regression test files.

## Part 8 — Next tranche

**None started, per explicit instruction.** If a future tranche is
separately authorized: (1) an owner decision on whether to extend Track F's
v1 scope to admit `bool` (closes Minervini + Support Resistance Channels
completely — the fix is written, verified, and ready; see Part 3); (2) the
Formula tab's own window-argument pre-check message (#3); (3) Stoch/ADX-family
parity, still untouched. QQE's ratchet limit (#5) is not a future-tranche
candidate on its own — it needs a joint decision from the repaint-claim owner
and the manifest owner before any further work is possible there at all.

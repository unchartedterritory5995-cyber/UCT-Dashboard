# ADR: Pine input-parameter fidelity — the contract, before any implementation

**Status:** 🟡 **PROPOSED — design only, for owner review. No implementation in this
ADR or alongside it.** Per DEC-006 ("Pine input fidelity: pursue, contract-first"),
this document is the contract that must be reviewed and accepted (or revised) before
Track F does any broad implementation work.

**Date:** 2026-09-04 · **Phase:** One (Trust Foundation), Track F · **Governing
decision:** `DECISIONS.md` DEC-006 · **Originating defect:** RISK-013
(`CORE_GOLDEN_JOURNEY_01_PINE_RSI_IMPORT.md` — a 97-line Pine RSI script's 5
adjustable inputs did not carry over; only their defaults did).

---

## 1. The baseline this ADR is improving on — verified, not assumed

Read directly from `app/src/components/chart/engine/ast/pine.js` before writing
anything below, because a design that doesn't start from what the translator
*actually* does today is a design for a system that doesn't exist.

**Every `input.*()` call in a pasted Pine script folds to its literal default value
today, on purpose, as a 2026-08-11 owner decision recorded in the file itself:**

> "OWNER DECISION, 2026-08-11: THE STORED TREE IS AUTHORITATIVE. Folding an input
> therefore freezes its default into the saved definition — and that is ALREADY
> true of every length, so folding the offset makes the two agree rather than
> introducing a new surprise."

Four things about the current mechanism matter directly to this ADR's design:

1. **Folding is already partially disclosed, not silent.** Every fold is recorded
   in a `usedInputs` map (`{call, title, folded, line, column}`) at the point of
   folding — for numeric window args, for `input.timeframe`, for `input.symbol`.
   **Open question for implementation, not this ADR:** whether `usedInputs`
   currently reaches any member-visible UI surface today, or is purely internal
   bookkeeping. Verify before building §5's disclosure UI — do not assume either
   answer.
2. **A "no half-applied control" refusal already exists.** `declaredInputNames()`
   collects every input used inside a window/int argument specifically so that an
   input ALSO used elsewhere in the formula (`len = input.int(14)` under
   `sma(close, len) + len`) is refused BY NAME rather than partially honored —
   "a knob that moves half of the formula and silently leaves the other half at
   the author's default... is worse than none, because nothing on screen says
   which half it reached." **Any adjustable-parameter design must preserve this
   refusal exactly**, or reintroduce the exact defect class it was built to kill.
3. **`input.timeframe`/`input.symbol`/`input.time` fold to default DELIBERATELY,
   matching TradingView's own Pine Screener**, which "supports most `input.*`,
   falling back to defaults for `input.timeframe`/`input.symbol`/`input.time`."
   The file's own comment calls this "fidelity, not a shortcut" — reading a script
   the way the surface it was written for already reads it. This is a real,
   existing, deliberate scope boundary, not a gap.
4. **`input.bool` and `input.string`-as-switch-subject already fold into
   fundamentally different SUBTREES, not just different literals.** The `switch`
   arm-reduction logic explicitly requires "the subject must be a string this
   script FIXES... because the whole basis for reducing it is that the branch does
   not move bar to bar." Measured: "11 of the 149 columns the three doors offer
   today already fold to a constant, including BOTH of the v5 sibling's." A
   boolean/enum-driven branch selection is architecturally a different problem
   from a numeric slider — it doesn't change a literal, it changes WHICH SUBTREE
   EXISTS.
5. **The same fold mechanism already reaches an `offset` node's index.** `close[n]`
   with `n = input.int(10)` resolves through the identical "fold to a constant,
   then treat as a plain number" path as a window argument. This means it
   inherits `_no_offset`'s foundational guarantee directly: *"the offset is a
   constant... true BY CONSTRUCTION rather than by a check somebody can delete."*
   Any design that makes an offset's index "adjustable" without re-deriving the
   whole tree would break that guarantee at its root. §4's recommended design is
   built specifically to avoid this.

## 2. The recommendation

**Adjustable parameters are a translation-time override, not a runtime-mutable
tree.** The canonical AST stays exactly as closed and exactly as literal as it is
today — eight node types, every `int`/window/offset argument still a plain
compile-time constant, `_no_offset`'s guarantee untouched. What changes is *which*
constant an `input.int`/`input.float` folds to: instead of always folding to the
script's own declared default, the translator accepts an optional **override map**
(parameter source-name → value) and folds to the override when one is present, the
declared default otherwise. Changing a member's "current value" for a parameter
re-runs the EXISTING translate-then-analyze pipeline (parse → fold → canonicalize →
`maxLookback`/domain checks/repaint lint) against the same original Pine source with
a different override map, producing a new tree with a new `astHash` — identical in
kind to a member editing the pasted source directly and re-saving. No new node
type, no new engine capability, no static-analysis pass that has to reason about a
non-literal value; the whole apparatus that already exists runs again, because it
would have to run again for a source edit regardless.

## 3. Point-by-point contract

### 3.1 Supported Pine input types (v1 scope)

**In scope for adjustable exposure:** `input.int`, `input.float` — when used
purely as a numeric literal (a window/length argument, a threshold compared
against a series, an offset index, an arithmetic operand). These are exactly the
cases the existing fold mechanism already treats as "resolve to one constant
number," so making that constant overridable is the smallest, most precedented
change.

**Deferred, frozen-at-default + disclosed, matching current + TradingView-screener
behavior:**
- `input.timeframe`, `input.symbol`, `input.time` — already frozen to match
  TradingView's own screener; no regression, no new gap, not a v1 target.
- `input.bool` — selects between subtrees (§1.4), not a literal. Exposing it
  adjustably means storing and being able to re-derive MULTIPLE trees (one per
  branch), which is a materially larger feature than a numeric override. Deferred
  explicitly, not silently — disclosed per §3.9/§3.14.
- `input.string` used as a `switch` subject — same reasoning as `input.bool`.
- `input.color` — has no execution semantics at all (it affects only how a plot
  is drawn, never a computed value); out of scope because there is nothing for
  the execution engine to make adjustable. If a future UI wants to expose it for
  drawing purposes, that is a presentation-layer concern with zero engine
  involvement, and not this ADR's problem.
- `input.source` (a series selector, e.g. `close` vs `hl2`) — genuinely dynamic in
  a different way (it selects a SERIES, not a number); flagged as a candidate for
  a v2 ADR of its own rather than folded into this one, since it interacts with
  the manifest's `series` section rather than the `functions`/`int`-argument
  machinery this ADR is scoped to.

### 3.2 Source name

The parameter's stable identifier is the Pine-side variable name the `input.*()`
call is assigned to (already captured — `declaredInputNames` reads `node.inputName`
off a `series` node today). This is already how the engine tracks an input's
identity internally; the parameter manifest (§3.10) reuses it verbatim rather than
inventing a second name for the same thing.

### 3.3 Display/title

Pine's optional `title=` argument to `input.*()`, already partially captured in
`usedInputs`' `title` field for the timeframe/symbol folds. Extend that capture to
every adjustable-eligible input. Falls back to the source name (§3.2) when the
script's author didn't supply one — never blank, since a member choosing between
five sliders needs SOME label even for a lazily-written script.

### 3.4 Default value

The literal (or constant-foldable expression, e.g. `defval` computed from another
constant) the script itself declares. Extracted once, at import time, alongside
every other piece of the parameter manifest — never re-derived later, since the
original script text is the only place it can come from.

### 3.5 Current value

The member's override, stored separately from the default (§3.10). Absent ⇒ the
tree uses the default, indistinguishable from today's behavior. Present ⇒ folds to
the override on next translation. **Never mutate the default in place** — the
distinction between "what the author wrote" and "what this member changed it to"
is exactly the information a disclosure UI needs to show, and collapsing them
loses it.

### 3.6 Min/max

Pine's `input.int`/`input.float` support optional `minval=`/`maxval=`. Captured
where the script declares them. **Where the script declares none, this ADR does
NOT invent a bound** — an invented min/max is exactly the "plausible number is
worse than no number" failure mode this whole program's evidence discipline
exists to prevent, applied to UI affordances instead of vendor data. The UI (§3.11)
gets a free-entry number field in that case, not a slider with a guessed range.
The one bound that IS always enforced regardless of what Pine declares is this
engine's own domain rules (§3.12) — e.g. a window argument still cannot go
negative, per `_functions_domain`'s existing refusals, independent of anything
Pine's own script said.

### 3.7 Step

Pine's optional `step=`. Captured verbatim where present; absent ⇒ UI default of
1 for `input.int`, no enforced step for `input.float` (an invented step is the
same invented-precision problem as §3.6's min/max).

### 3.8 Enum/options

Pine's `options=` list on `input.int`/`input.float`/`input.string`. For the two
numeric types, in scope on the same terms as §3.1 (still folds to one literal
number, just constrained to a member-facing dropdown of named choices instead of
free entry — the underlying mechanism is identical to §3.5, only the UI widget
differs). For `input.string` specifically: in scope ONLY when the string is used
as a plain literal elsewhere (e.g., concatenated into a label) and explicitly
OUT of scope when it feeds a `switch` subject (§3.1's `input.bool`-class
exclusion — the subtree-selection problem, not the literal-value problem).

### 3.9 Unsupported/dynamic cases

Two distinct failure shapes, both disclosed, never silent:

- **A type this v1 does not support** (bool, symbol, timeframe, time, color,
  source, or a string feeding a switch): the import proceeds exactly as it does
  TODAY (fold to default), and the parameter manifest records it as
  `frozen: true, reason: "<type> inputs are not adjustable in this version"`. The
  member sees a disabled/labeled row, not an absent one — "this script has a
  knob we can't expose yet" is a fact worth stating even when nothing can be done
  about it this version.
- **A declared-adjustable-eligible input that fails a safety check** — e.g. an
  `input.int` also caught by `declaredInputNames`' half-applied-control rule
  (§1.2), or one whose only use is inside a construct this engine already refuses
  outright for unrelated reasons. Same treatment: frozen at default, disclosed,
  with the SPECIFIC reason (not a generic "unsupported") — reusing exactly the
  refusal-with-reason idiom `pine.js`'s `PineRefusal` class already uses
  throughout the file, so the member sees the same voice they'd see for any other
  translation limitation.

**Never**: refuse the whole import because ONE input isn't adjustable. That would
regress behavior for every script with a mix of adjustable and non-adjustable
inputs — worse than today, where at least the formula imports successfully with
everything frozen.

### 3.10 Persistence/versioning

**An additive layer above the existing tree/hash model, not a change to it.**
Three pieces, stored alongside a saved definition:

1. **The original Pine source text** — needed because "changing a parameter" means
   re-translating the source with a different override, and the source is the
   only thing that can be re-translated. (Verify at implementation time whether
   the source is already retained today for other reasons, e.g. an "edit
   original script" affordance — if so, this ADR adds no new storage
   requirement, only a new reader of existing storage.)
2. **The parameter manifest** — source name, display/title, type, default,
   min/max, step, enum/options, frozen-or-adjustable + reason — extracted ONCE at
   import time from the source. Immutable after import (re-importing a changed
   script is a new import, not a manifest edit).
3. **The override blob** — source name → member's current value, for adjustable
   parameters only. This is the one piece that changes over the life of a saved
   definition, and it is a small, flat key-value structure — exactly the shape
   this repo already versions elsewhere. **Follow the existing settings-blob
   migration idiom directly** (`app/src/components/chart/engine/__tests__/
   settingsBlobMigration.test.js`'s pattern: a fold-forward function that runs
   ONCE per blob, is IDEMPOTENT on an up-to-date blob (identity, not
   re-derivation), and treats a deleted/removed entry as a first-class preserved
   state rather than something migration silently drops). Do not invent a new
   migration mechanism when this one is precedented, tested, and already
   understood by whoever maintains this codebase next.

The **executed tree itself is DERIVED**, cached, and invalidated exactly like any
other saved-definition edit: a new override blob ⇒ a new translate-then-analyze
pass ⇒ a new `astHash` ⇒ whatever cache invalidation already happens on a hash
change (per this repo's own "stored value reaches the reader" / hash-identity
discipline visible throughout `closedTable.json` and the scan-store commit
history) happens again, unmodified. No special-case "parameter changed but tree
identity preserved" path is introduced, because that path is exactly where a
stale-cache-under-an-unchanged-key bug would live, and this repo has paid for that
bug class before (`_run_patterns_prune`'s own citation of an unbounded-growth
incident is a sibling lesson, not the same one, but the shape — "an artifact
survives past the point its assumptions still hold" — recurs enough in this
codebase's own risk register to name explicitly here as a designed-against
failure mode).

### 3.11 UI implications (data contract, not pixels)

The builder/settings surface needs, per adjustable parameter: source name,
display/title, type, current value, default value (so a "reset to default"
affordance is possible), min/max/step/options where declared. Per frozen
parameter: display/title, default value, and the disclosure reason (§3.9) — shown,
not hidden, so a member who pasted a script with an `input.symbol` knows THAT
input specifically didn't carry over, not just that "some things might not have."
This ADR does not design the widget layout; it specifies exactly the fields a
widget would need, which is the contract DEC-006 asked for.

### 3.12 Static-analysis effects

**Unaffected in kind, exercised again in the ordinary course of re-translation.**
`maxLookback`, `argDomainsOf`, and the repaint linter all already operate on a
fully-literal canonical tree (per §1's baseline — this was already true before
this ADR, for every existing formula). Because §2's design produces a genuinely
new tree on every parameter change (never a mutated node inside a persisted one),
these passes simply run again as part of the same translate-then-analyze pipeline
that already runs on every save — no new code path, no new invariant to prove,
because the tree they see is, from their point of view, indistinguishable from any
other freshly-translated formula. **This is the central reason §2's design was
chosen over a first-class parameter node (§4, Alternative B):** a first-class
adjustable node would require every one of these passes to be rewritten to
understand "a bounded-but-not-yet-known value," which is a fundamentally different
and much larger analysis problem than the one this engine currently solves.

**The one thing that must be explicitly re-verified, not assumed:** a parameter
change that widens a window (e.g. RSI length 14 → 50) can change `maxLookback`'s
total and could, in principle, push a formula over `budget:lookback`'s ceiling
where the default did not. Because re-translation re-runs the whole static-analysis
pipeline, this is caught automatically — a parameter change that busts the budget
refuses exactly as a hand-edited source change would, with the same message. This
is a feature of the chosen design, not a gap: it could ONLY be silently missed
under a design that skipped re-analysis on parameter change, which §2 does not do.

### 3.13 Execution-requirement recomputation when parameters change

Directly answered by §2 and §3.10 together: a parameter change is a new
translation, a new tree, a new `astHash`. Whatever this repo already does when a
saved definition's hash changes — invalidate a cached `last_value`, re-evaluate
scan-lane eligibility, re-run the repaint badge — happens unmodified, because the
engine cannot distinguish "the member edited the source" from "the member changed
an exposed parameter." That indistinguishability is deliberate: it means zero new
invalidation logic to write, test, or get wrong.

### 3.14 How limitations are disclosed instead of silently losing fidelity

This is the point this ADR treats as non-negotiable, per the program's standing
principle that a silent wrong answer ranks worse than a correct refusal (`CL-004`)
applied here to fidelity rather than correctness: **every input the translator
touches — adjustable or frozen — is accounted for in the parameter manifest, and
every frozen one carries a stated, specific reason, not a generic notice.** The
mechanism already half-exists (`usedInputs`); this ADR's implementation work is to
(a) verify whether it already reaches a UI surface (§1, open question — do not
assume), (b) extend its coverage to every fold site consistently (today it's
recorded at the timeframe/symbol fold sites and the general numeric fold path
somewhat differently — unify this at implementation time so one code path
produces the disclosure data for every case), and (c) render it as a first-class
part of the import result, not a debug artifact. A member should never be able to
paste a script, see it "work," and have no way to discover that three of its five
inputs are permanently frozen — that is RISK-013 recurring in a new shape.

## 4. Alternatives considered

**A — Chosen: translation-time override map (§2).** Tree stays closed and
literal; only which constant an input folds to changes; every static-analysis
pass runs unmodified because it always saw a fully-literal tree and still does.
Cost: a parameter change requires the original source text and a full
re-translation pass (cheap — Pine translation is synchronous, deterministic,
client-side, and this repo's own single-parser design already treats it as the
authority for every save).

**B — Rejected: first-class manifest-level parameter node.** Add a ninth
canonical node type (`param`) carrying a symbolic reference resolved to a current
value at a later binding step, with `maxLookback`/`argDomainsOf`/the repaint
linter all updated to reason about a bounded-but-symbolic value instead of a
literal. Rejected because: (1) it reopens the closed eight-node-type vocabulary
`closedTable.json::_canonical` treats as a proof-of-closure boundary — exactly
the kind of change `_no_offset_reopened_by` says belongs to the manifest owner
and the relevant spec owner TOGETHER, never a single task's unilateral call; (2)
every static-analysis pass would need real rework, not a free re-run, multiplying
the surface area for a NEW class of bug (a pass that silently assumes a param
node behaves like a literal where it doesn't); (3) it buys nothing Alternative A
doesn't already deliver for the in-scope types (§3.1), since a symbolic node's
only advantage — avoiding re-translation — is not a real cost given how cheap
re-translation already is.

**C — Rejected: resolve-at-import-time with a one-time visible warning, no
ongoing adjustability.** Show the member, once, "this script has 5 inputs and we
froze them at their defaults" and stop there — cheapest possible implementation,
satisfies DEC-006's disclosure requirement but not its "expose compatible values
as adjustable UCT inputs" requirement. Rejected because it does not actually close
RISK-013 — a member who wants to try RSI length 21 instead of 14 still has to
paste the script again with hand-edited source, which is the exact friction the
owner's decision was written to remove. Recorded because a reviewer should be able
to see it was considered and specifically why the disclosure-only half of it is
still worth keeping as this ADR's §3.14 baseline even though the no-adjustability
half is not enough on its own.

## 5. Risks

- **The dominant risk is scope creep from v1's numeric-only boundary (§3.1) into
  bool/enum/source inputs**, since those are the ones a real script most often
  pairs with a numeric one (e.g., `useSma = input.bool(true)` gating between two
  moving-average families). Mitigation: §3.9's disclosure makes the boundary
  visible rather than a silent gap, and a future ADR can extend scope
  deliberately once v1 ships and is measured, rather than this one trying to
  solve both problems at once.
- **A parameter change that busts the lookback budget or fails a domain check is
  correct-but-disruptive behavior a member could read as a bug** ("I just moved a
  slider and my indicator broke"). Mitigation: §3.12's point that this MUST
  surface with the same refusal message a hand-edited source change would get —
  implementation must not weaken that message for the parameter-change path
  specifically.
- **`declaredInputNames`'s half-applied-control refusal (§1.2) must be
  preserved exactly.** A regression here would be silent fidelity loss of the
  worst kind: a member moves a slider believing it controls the whole formula
  and it demonstrably does not. This ADR does not change that refusal's logic,
  only reuses it; implementation must add a regression test proving it still
  fires under the override-map path, not just the default-fold path.
- **⚠️ FLAGGED FOR THE MANIFEST + REPAINT-CLAIM OWNERS, NOT DECIDED HERE:** if a
  future iteration ever wants `input.source` (§3.1's explicit v2 candidate) to be
  adjustable, that touches the `series` section of the closed vocabulary in a way
  numeric overrides do not, and per `_no_offset_reopened_by`'s own rule such a
  reopening is a joint spec decision, never a single task's call. This ADR
  deliberately stops short of that boundary and names it rather than silently
  assuming a future task may cross it.

## 6. Migration impact

None for existing saved definitions — every one imported before this ships has an
empty override blob (or no override-blob concept at all, depending on when the
column/field is added), which is definitionally identical to "every input at its
default," i.e. today's behavior. The fold-forward migration idiom (§3.10) that
already handles "a blob written before the engine existed" in
`settingsBlobMigration.test.js` is the direct precedent for handling "a definition
saved before parameter manifests existed."

## 7. Reversibility

Fully reversible without data loss: the parameter manifest and override blob are
additive metadata beside the existing tree/hash model, never a replacement of it.
Disabling adjustable-parameter exposure at any point means the UI stops rendering
adjustable controls and the engine stops consulting the override map (equivalent
to always translating with an empty override), which collapses exactly back to
today's fold-to-default behavior with no schema rollback required.

## 8. Tests needed (before broad implementation, not exhaustive)

- A parameter-eligible input (numeric, no half-applied-control conflict) exposed
  adjustably; changing its value produces a new `astHash` and a re-run static
  analysis.
- `declaredInputNames`'s refusal still fires when an adjustable-eligible input is
  ALSO used outside its window argument — proving §1.2's guarantee survives.
- A frozen-type input (bool/symbol/timeframe/time/color/source, and
  string-as-switch-subject) is disclosed with its SPECIFIC reason, not a generic
  message, and the import still succeeds for the rest of the script.
- A parameter change that pushes a formula over `budget:lookback` refuses with
  the same message a hand-edited source change would produce.
- A pre-parameter-manifest saved definition round-trips through the fold-forward
  migration unchanged (identity), matching the existing
  `settingsBlobMigration.test.js` idiom's own "runs ONCE... a v2 blob is passed
  through untouched, by identity" pattern.
- An override blob with a value outside a script-declared min/max is rejected (or
  clamped — pick one, explicitly, at implementation time; this ADR does not
  decide which, only that silent out-of-range acceptance is not an option per
  §3.6's "never invent a bound but always enforce this engine's own domain
  rules" split).

## 9. What this ADR explicitly does not decide

- Whether `usedInputs` already reaches a UI surface today (§1, verify first).
- The exact reject-vs-clamp behavior for an out-of-range override (§8, last
  bullet).
- `input.source`, `input.bool`, and switch-driving `input.string` exposure — all
  explicitly deferred, not solved partially (§3.1, §5).
- Pixel-level UI design for the parameter controls (§3.11 specifies the data
  contract only).

---

**Next step:** owner review of this ADR. Per DEC-006 and this program's Phase One
plan, no broad implementation of the parameter mapping proceeds until this is
accepted or revised.

# C0R — PARAMETER / LEXICAL-BINDING CLOSURE REMEDIATION

**Result: C0R PASSES its exit gate.** The eight C0 SAVE_BLOCKED scripts no longer
reach Save naming a symbol nobody declared. Four now pass the complete journey;
four are truthfully blocked earlier by two *newly exposed, genuine* limits that
had been unreachable behind the binding defect.

Full accepted-corpus journey moved from **9 CHART_RENDERABLE / 18** to
**13 FULL_JOURNEY_PASS / 18** — and FULL_JOURNEY_PASS is the stricter claim: it
additionally requires the reopened document to be byte-identical to the saved one.

---

## ⛔ THE REVIEW NAMED TWO CLASSES. MEASUREMENT FOUND TWO DIFFERENT ONES.

The C0 review inferred, from the source shapes, that the causes were **input /
visibility binding** and **UDF formal binding**. Traced end to end, neither is what
was broken:

- **There was no UDF-formal leak anywhere in the corpus.** The binder is already
  lexical and capture-safe. `pine.udfBinding.test.js` puts nine cases through it —
  multiple formals, argument order, a formal shadowing an outer variable, the same
  function called twice with different arguments, two functions sharing a formal
  name, nested calls, a derived argument, and an input threaded through a UDF —
  and every one both translates with no free formal AND evaluates to the right
  number. `mult` in `waddah-attar` *looked* like a formal leak because the script
  writes `calc_BBUpper(source, length, mult)`; the formal was bound correctly and
  what leaked was the INPUT of the same name, via mechanism B below.

The two real mechanisms:

### A — the door declared a name it could never back (2 of 8)

`memberInputTranslation` chose what to DECLARE into a formula from `e.name` alone.
A ROW additionally requires the name to be a legal member-input **key** — `KEY_RE`
**and** lower-case-first (`BuilderSheet.inputKeyProblem`'s rule). So an
**uppercase-initial** Pine input passed the first test and failed the second: the
translator emitted the bare identifier and no row could ever exist for it.

`Multiplier` (`supertrend-kivancozbilgic`) and `GateInp` (`spma-trend`) — both
uppercase-initial, both unbacked in *every* output.

⚰️ And the refusal blamed the wrong thing. It read *"no bound name on the folded
entry … TO UNBLOCK: `usedInputs[]` gaining `name`"* — for a name that was right
there — sending the reader after a hand-back that had shipped long ago. **A refusal
that names the wrong cause is worse than a vague one.**

### B — sibling outputs carried formulas without their inputs (6 of 8)

C0.1 taught `PineBox` to hand back every output of a multi-plot script. Its
projection was `{source, title, presentation}` — and it dropped `memberInputs`. The
sibling's FORMULA travelled; the inputs that formula NAMES did not. `BuilderSheet`
then declared only `picked.inputs`, the selected output's rows.

**Every one of the six fails on a sibling, never on output 0:**

| Script | Identifier | Named by output(s) | Selected output |
|---|---|---|---|
| `waddah-attar-explosion` | `mult` | 2 | 0 (`sensitivity`) |
| `cm-ultimate-rsi-mtf` | `upLine` | 2, 6 | 0 (no inputs) |
| `volatility-of-returns` | `showMa` | 1 | 0 (`annualize`, `annPeriod`) |
| `3way-bollinger-trend` | `bandStdevMult` | 1, 2 | 0 (`tradeMode`) |
| `master-line-lite` | `showBand` | 1, 2 | 5 (`bandMult`) |
| `rsi-levels-regime-map` | `lv3` | 2, 16 | **22** (`lv1`, `lv2`, …) |

### ⭐ `lv1`/`lv2` resolve while `lv3` does not — the answer

Not traversal incompleteness, not output-selection pruning, not branch or ternary
handling, not level extraction, not UDF behaviour, not a manifest locator omission.

`rsi-levels-regime-map`'s selected column is **output 22** ("Support rung tested"),
whose rows declare `bullFloor`, `regTol`, `bearCeil`, **`lv2`, `lv1`**. Those two
travelled because the SELECTED output happens to name them — which is exactly why
the refusal could offer *"did you mean `lv1` or `lv2`?"*. `lv3` is named only by
outputs 2 and 16, whose `memberInputs` were dropped by the projection.

It is `lesson_a_projection_drops_what_it_does_not_name`, and the regression that
would catch a "first N siblings only" variant is
`builderInputs.symbolClosure.test.js`'s union case, which walks **every** carried
output rather than a prefix.

---

## THE FIX

### 1. `memberInputKey` — one predicate, composed by both sides

`builderInputs.js` now exports the single answer to *"can this Pine name be a
member-input key"*, and both `declarable` and `inputsFromFolded` call it. A third
copy of either rule is the second-authority defect that produced the bug.

### 2. A measured closure loop — the guard that actually holds

The key rule fixes the two causes this corpus contains. It cannot fix the ones it
has not met: a row is also dropped when the fold is not a finite number, when the
key shadows a table name, when it collides with a builder input, or when
`positionVerdict` finds the name unreachable. So rather than enumerate skip reasons
(a list that rots), the door **measures** closure and re-translates with the
offenders removed, folding each back to its literal — the column stays right, only
the knob is lost, and the member is told which knob and why.

`unbackedDeclaredInputs(outputs, declared)` is that audit: `seriesNamesOf` over each
tree, intersected with what this pass declared, minus what its rows back. **Shape
driven — no allowlist of names.** The loop shrinks the declared set strictly, so it
cannot cycle; the fallback (declare nothing) is the pre-member-input behaviour and
is closed by construction.

⚠️ **Honest note on coverage:** on the eight OOS scripts the key predicate and the
loop are REDUNDANT — deleting either leaves all eight green. The witness that
separates them is an author naming an input `lineWidth`: a perfectly legal key that
no row can back, because every document already declares `lineWidth` as its
line-width control. Without the loop the formula reads `close * lineWidth` and
**resolves** — against the chrome input — so there is no refusal at all: the plot's
value silently becomes a function of its own line width. That case is pinned, and
deleting the loop turns it red.

### 3. Sibling carriage — `PineBox` sends inputs per output, `BuilderSheet` declares the union

Each carried output now travels as `{source, title, presentation, inputs}`, and the
sheet declares the union **over the rows it actually carries** (not over every
output — a row past `CARRY_MAX` is not in the document, and declaring its inputs
would hand the member a knob that moves nothing).

---

## THE INVARIANT, AS SHIPPED

> A definition may not cross the save boundary naming a symbol nobody declared.

Checked at the door, before anything downstream sees the translation, so **Save is
never the first component to discover the document is incomplete**.

---

## RESULTS

### The 8 C0 SAVE_BLOCKED scripts, before → after

| Script | Before | After | Next real blocker |
|---|---|---|---|
| `waddah-attar-explosion` | SAVE_BLOCKED `mult` | **FULL_JOURNEY_PASS** | — |
| `cm-ultimate-rsi-mtf` | SAVE_BLOCKED `upLine` | **FULL_JOURNEY_PASS** | — |
| `volatility-of-returns` | SAVE_BLOCKED `showMa` | **FULL_JOURNEY_PASS** | — |
| `3way-bollinger-trend` | SAVE_BLOCKED `bandStdevMult` | **FULL_JOURNEY_PASS** | — |
| `spma-trend` | SAVE_BLOCKED `GateInp` | CHART_PARTIAL | compute budget (below) |
| `master-line-lite` | SAVE_BLOCKED `showBand` | CHART_PARTIAL | compute budget (below) |
| `supertrend-kivancozbilgic` | SAVE_BLOCKED `Multiplier` | SAVE_FAILED | **document size cap** |
| `rsi-levels-regime-map` | SAVE_BLOCKED `lv3` | SAVE_FAILED | **document size cap** |

**All eight are past the binding defect.** None reaches Save with an unresolved
lexical identifier.

### The 18 accepted OOS scripts — complete journey

| Outcome | C0 | C0R |
|---|---|---|
| FULL_JOURNEY_PASS *(save + render + reopen-identical)* | — | **13** |
| CHART_RENDERABLE *(C0's weaker claim)* | 9 | — |
| SAVE_BLOCKED | 8 | 0 |
| SAVE_FAILED | 0 | 2 |
| CHART_PARTIAL | 0 | 2 |
| IMPORT_BLOCKED | 1 | 1 |

### Complex Visual Parity Set (10, unchanged, no substitutions)

**6 FULL_JOURNEY_PASS · 1 CHART_PARTIAL · 2 IMPORT_BLOCKED · 1 SAVE_FAILED.**
`rsi-levels-regime-map` moved SAVE_BLOCKED → SAVE_FAILED: past the binding defect,
into the size cap. ⛔ FULL_JOURNEY_PASS is still **not** visual parity — these V4/V5
scripts continue to lose fills, dynamic colour and objects (C0.7 unchanged).

### Multi-plot fixtures and the non-vacuity controls

**5/5 FULL_JOURNEY_PASS.** All four controls still fire in their own directions —
`ctrl-01` SAVE_BLOCKED, `ctrl-02` IMPORT_BLOCKED, `ctrl-03` CHART_PARTIAL with
`drewNothing`, `ctrl-04` FULL_JOURNEY_PASS. The harness remains non-vacuous.

---

## ⚠️ TWO NEWLY EXPOSED BLOCKERS — NEITHER IS A BINDING PROBLEM

### 1. Document size cap — 65,536 bytes

`supertrend-kivancozbilgic` produces **362,708 bytes**; `rsi-levels-regime-map`
**369,787**. Both are refused by the definition store, which names its own cap.
These scripts declare 10 and 28 columns, and a multi-tree document stores one tree
per plot — so the size is driven by C0.1's multi-output carriage, not by C0R. It
became reachable only because these two can now get as far as the store.

### 2. Compute budget at chart scale — `interpret:steps`

`spma-trend` and `master-line-lite` save and install, and every carried plot reports
`data-computed="false"`. Measured at unit level: both compute correctly at 900 bars
(650/900 and 845/900 finite) and refuse with **`interpret:steps` at 5,000** — the
bar count the chart actually loads. Their trees carry `accum(…, 250)` recurrences
with lookbacks of 281 and 351.

⚠️ **And one thing that needs its own investigation:** at 5,000 bars, 3 of
`master-line-lite`'s 7 columns evaluate cleanly in isolation (4,945/5,000 finite)
while the chart reports **all 7** as drawing nothing. So a budget refusal in one
tree of a multi-tree document may be taking the whole document down with it. That is
a hypothesis with a measurement behind it, not a conclusion — it is recorded as the
next blocker rather than fixed here, because it is outside C0R's authorized scope.

---

## C0R EXIT GATE

| # | Condition | Met? |
|---|---|---|
| 1 | all 8 SAVE_BLOCKED saveable, or truthfully blocked earlier by a genuine newly exposed limit | ✅ 4 pass · 4 blocked by size cap / compute budget |
| 2 | no script reaches Save with a resolvable lexical/input/UDF identifier | ✅ audit green on all 8 + fixtures |
| 3 | parameter editability preserved | ✅ rows + defaults persist; reopen byte-identical |
| 4 | bool visibility behaviour verified | ✅ both defaults, ON draws / OFF draws nothing, evaluated |
| 5 | UDF call-site binding verified | ✅ 9 cases; it was never the defect |
| 6 | lexical shadowing / capture green | ✅ incl. same-function-twice and formal-shadows-outer |
| 7 | 18-script full product journey remeasured | ✅ |
| 8 | SAVE/REOPEN actually measured | ✅ whole-document equality, not a field summary |
| 9 | corrected render harness still non-vacuous | ✅ 4 controls fire |
| 10 | no new silent false success | ✅ the 2 partials are REPORTED partial and the member's chip says so |

**C0R PASSES.**

## Tests

New: `builderInputs.symbolClosure.test.js` (20) · `pineBoxSiblingInputs.test.jsx`
(3) · `BuilderSheet.siblingInputUnion.test.jsx` (3) · `pineBoolVisibility.test.js`
(6) · `pine.udfBinding.test.js` (9).

Suite: `src/components/chart/builder` + `engine/ast` — **3,924 passing**, 2 failing
**and both fail identically on the untouched pre-C0R baseline** (`BuilderSheet.pine`
byte-identical-document, `ImportBox.thinkscript` one-keystroke-behind), verified by
restoring the three changed files from `HEAD` and re-running. Backend Track F +
user-definitions: **71 passing**.

Mutation-checked (byte snapshot, never `git checkout`): removing the closure loop
turns the `lineWidth` case red; disabling the union write turns all three sibling
tests red.

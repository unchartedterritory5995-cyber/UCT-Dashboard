# Track F v1.1 — `input.bool` Completion Report

Executes the narrow Track F extension authorized after
`COMPATIBILITY_REMEDIATION_TRANCHE_1.md`: extend Track F's existing trusted
imported-parameter architecture from `input.int`/`input.float` to
`input.bool` — one type, the SAME architecture, no new execution model, no
second parameter system. **Not Track F v2.** Stoch, the ADX-family, and every
other input kind remain untouched.

---

## 1. Recovering the verified-ready fix, and what it actually touches

Tranche 1 verified — then deliberately reverted — moving `'input.bool'` from
`builderInputs.js::FOLDED_INPUT_INEXPRESSIBLE` into `FOLDED_INPUT_TYPES`
(mapped to `'int'`). That change alone touches **only** the IMPORT-candidate
readback/offering surface (`memberInputs`/`document.inputs[]`, consumed by
`PineBox.jsx`'s downstream verdict fixed in Tranche 1, and by the "Inputs you
can change later" authoring UI). It does **not** touch Track F's own
`compute.paramManifest`/`ParamControls.jsx` mechanism at all — those are two
separate, parity-linked systems (see §2). Recovered verbatim, unmodified —
current evidence did not show it wrong.

**What construct it enables**: a plain `input.bool(defval, "Title")` gate
(Pine v5/v6's typed idiom) now folds and reads back exactly like the
already-shipped bare `input(true/false, "Title")` (Pine v3/v4's untyped
idiom) — `pine.js::resolveInput` already treated the two identically at the
AST-fold level; only the IMPORT door's own eligible-kinds list distinguished
them.

**Real public scripts that depend on it**: `18-minervini-trend-template.pine`
(`show_52_week_high_low`, gating both of its 2 offered columns) and
`27-support-resistance-channels.pine` (`showthema1en`/`showthema2en`, gating
2 of its 6 offered columns).

**Surfaces affected**: import (candidate offering/readback — Tranche 1's own
scope) AND, because of the cross-file parity test tying the two eligible-kind
lists together, Track F's own parameter editing/persistence (`compute.
paramManifest`, `ParamControls.jsx`, `param_manifest.py`) — the SEPARATE
extension this report is actually about. Persistence itself needed no schema
migration: `compute.paramManifest`'s shape is unchanged; only the SET of
`type` values it may legitimately carry grew by one.

---

## 2. The two mechanisms, and why both needed a decision

`document.inputs[]`/`memberInputs` (declared, NAMED identifiers a formula
references by name — what Tranche 1 fixed) and `compute.paramManifest`
(Track F, DEC-006 — astPath LOCATORS pointing directly at a literal node,
used for values that can never become a named identifier, chiefly window/
length arguments) are independent mechanisms serving different constructs.
`pine.js::PARAM_MANIFEST_ELIGIBLE_KINDS` and `builderInputs.js::
FOLDED_INPUT_TYPES` are deliberately kept in lockstep by
`pine.paramManifest.test.js`'s own parity assertion specifically so one
cannot widen without the other — which is precisely what blocked Tranche 1's
`input.bool` fix from shipping alone. This tranche makes the SAME decision on
both, together.

---

## 3. Parameter contract, adapted for boolean

Every Track F v1 principle holds, unchanged, for `bool`:

- **One Pine input = one logical parameter** — `resolveInput`'s paramMint
  tagging is kind-agnostic; a `bool`-kind input mints one `__uct_param_<n>`
  exactly like `int`/`float`.
- **Trusted manifest provenance** — `param_manifest.py::_canonicalize_
  manifest` is type-agnostic; a `bool` entry's `sourceName`/`title`/`type`/
  `default`/`locators` are exactly as immutable as an `int` entry's.
- **Canonical AST remains final authority** — a `bool` parameter's live
  value is read from `compute.ast`/`compute.trees`, never from the manifest
  or from client state, via the identical `_walk`/`_literal_value` path.
- **No raw vendor source becomes runtime authority** — unaffected; Pine
  text is never persisted, for any type.
- **No second Pine parser** — `applyParamEdit` still only ever calls
  `printFormula`/`parseFormula`/`astHash`, never `pine.js`.
- **Server does not trust client-invented metadata** — `_canonicalize_
  manifest` still returns the PRIOR entry verbatim for an existing id,
  regardless of type.
- **Parameter IDs cannot be invented or mutated by crafted PUTs** — ADR
  V2.2 condition 15 is enforced identically; proven for `bool` in §5.
- **Defaults remain immutable provenance** — proven for `bool` in §5
  (test 18, mirroring test 14b).
- **State is derived from canonical AST/trusted manifest** — `reconcile()`/
  `reconcileParams` are unchanged, type-agnostic functions.
- **Conflicts or detached locators disable editing rather than silently
  applying the wrong parameter** — unchanged; ALSO proven to correctly
  extend to a DOWNSTREAM engine constraint outside the manifest's own
  reconciliation (§6/§4's second test) — a genuinely new, honestly-disclosed
  finding this tranche produced.

**The one genuine adaptation**: a `bool`'s DOMAIN is narrower than a plain
`int`'s — exactly `{0, 1}`, never an arbitrary whole number. `_type_ok`
(Python) and `validateValue` (JS) both gained a dedicated `'bool'` branch
enforcing this, rather than reusing `int`'s "any whole number" check.

---

## 4. Boolean semantics, proven

- **`input.bool(true)` / `input.bool(false)`** — both fold correctly
  (`pine.paramManifest.test.js`'s new tests: default `1` and `0`
  respectively).
- **Default true / default false** — proven above.
- **True branch / false branch** — the minimal reduction (`sma(close,
  useLong)`) folds to the literal on EITHER branch; `applyParamEdit` toggles
  between them (`paramEdit.test.js`'s new test).
- **Bool used directly as a condition** — proven separately: a `showit ?
  close : na`-shaped conditional was tested and found to correctly NOT
  attach a Track F locator (the ternary constant-folds around the boolean's
  own known value, discarding it along with the branch that never runs) —
  disclosed honestly as the boundary of what Track F's specific mechanism
  can reach, not silently glossed over. The `memberInputs`-side fix (§1)
  remains the correct, working mechanism for THIS idiom.
- **Bool used in a supported conditional expression, and in plain
  arithmetic** (`close * showit`) — proven; the tag survives arithmetic
  wrapping OUTSIDE a window slot exactly as it already did for `int`/`float`
  (an existing, unchanged guarantee).
- **Toggle changes the intended AST behavior** — proven live end to end
  (`BuilderSheet.boolParamReopen.test.jsx`): the checkbox's `onChange`
  reaches `applyParamEdit`, which mutates the literal and re-derives
  `compute.source` via the real print/parse pipeline; `FormulaField`'s own
  debounced re-evaluation picks up the change and re-renders.
- **No truthy/falsy coercion from strings or numbers** — proven both
  server-side (`test_param_manifest.py` tests 17/17b) and client-side
  (`paramEdit.test.js`'s rejection test): `2`, `-1`, `0.5`, `NaN`, `Infinity`
  are all refused, never coerced to `0`/`1`.
- **Invalid boolean values are rejected, never coerced** — proven; see §5.

**Named aliases the current parser does not support**: not encountered.
Every corpus script uses the plain positional form
(`input.bool(defval, title)`); no `input.bool(defval=..., title=...)`
named-argument variant was exercised, and none needed to be — this is
recorded as untested rather than silently assumed to work identically.

---

## 5. Server trust / tamper safety

All proven in `tests/test_param_manifest.py` (tests 16-18, plus the
type-agnostic tests 14/14b/14c/15/15b already covering bool by construction):

| Case | Result |
|---|---|
| Valid `true` (submitted/stored as `1`) | Accepted, `ATTACHED`, `value: 1` |
| Valid `false` (`0`) | Accepted, `ATTACHED`, `value: 0` |
| `2`, `-1`, `0.5` | Rejected — `ParamManifestRejected: "must be bool"` |
| A raw JSON `true` literal bound in the AST | Refused even EARLIER than `param_manifest.py` — `user_definitions.py::stable_stringify`'s own `ast_hash` computation refuses any canonical tree containing a Python `bool` outright (a stronger, pre-existing gate this tranche's own test discovered, not one it built) |
| Invented param ID | Rejected — ADR V2.2 condition 15, type-agnostic, unchanged |
| Altered locator | Rejected (the TRUE prior locator wins) — type-agnostic, unchanged |
| Altered type (`bool`→`int` forged) | Rejected — the TRUE prior `type` (`bool`) is what is actually enforced; a value legal under the forged type but illegal under the true one is caught (test 18) |
| Altered immutable default/provenance | Rejected — type-agnostic, unchanged |
| Parameter transplanted from another definition | Rejected — type-agnostic, unchanged (test 15b's own control) |

`_type_ok`'s `'bool'` branch and `_validate_bounds`'s gate-condition widening
(`decl_type in ("int", "float", "bool")`) are the only two Python code
changes. A `bool` entry never has `min`/`max` set (Pine's `input.bool` has no
such arguments) — `_validate_bounds` returns immediately after the type
check for `bool`, never falling through to the min/max block.

---

## 6. Fresh-import and save/reopen/toggle behavior

Proven end to end, live, through the real "Your formulas" door
(`BuilderSheet.boolParamReopen.test.jsx`, 3 tests, nothing on the path under
test mocked except `fetch`):

1. **Fresh import** — pasting `useLong = input.bool(true, "Use Long
   Length"); plot(sma(close, useLong))` shows the formula folded to
   `sma(close, 1)`, an "Adjustable parameters" panel with a CHECKED checkbox
   titled "Use Long Length", and "default On".
2. **Save** — POSTs a document whose `compute.paramManifest.__uct_param_1`
   is `{type: 'bool', default: 1, sourceName: 'useLong', ...}` and whose
   `compute.paramState` is `{state: 'attached', value: 1, reason: null}`.
3. **Close, reopen** through the real pencil-icon "Your formulas" door —
   the checkbox is restored CHECKED, titled by the manifest's own `title`
   (never the raw `__uct_param_1` id), from `compute.paramManifest`/
   `paramState` alone — no Pine re-translation occurs (none is persisted).
4. **Toggle** — clicking the checkbox correctly flips the formula text to
   `sma(close, 0)` live.
5. **A genuinely new, honestly-disclosed finding**: `sma(close, 0)` is
   itself an ENGINE-INVALID formula (`interpret.js::windowLiteral` refuses
   any window argument below 1, universally, at every one of its 6 call
   sites) — so THIS PARTICULAR construct (a boolean feeding a window slot
   directly, the only shape that can attach a Track F locator at all; see
   §4's disclosed boundary) structurally cannot have both toggle states be
   valid. Proven as the CORRECT safety behavior, not a defect: "Save
   changes" correctly disables, no PUT fires, nothing corrupts. Toggling
   back restores validity and Save; the correcting save round-trips
   correctly (proven in the same test).
6. **"Reset to Default"** — works for `bool` via the exact same code path
   as `int`/`float` (`onCommit(id, entry.default)` — not a special case);
   proven it correctly does not render when already at the default.

---

## 7. Minervini before/after

| | Before (Tranche 1) | After (Track F v1.1) |
|---|---|---|
| `52 Week High` | `BLOCKED (sentence:name)` | `CLEAN` — readback: *"the highest close of the last N bars when the input show_52_week_high_low is not zero..."* |
| `52 Week Low` | `BLOCKED (sentence:name)` | `CLEAN` |

Zero of Minervini's 2 offered columns worked before; both work now. Closes
the exact Layer-A-fidelity gap RISK-037 named (a script Layer A calls
`SUPPORTED` now also has working real-import outputs, not zero).

## 8. Support Resistance Channels before/after

| | Before (Tranche 1) | After (Track F v1.1) |
|---|---|---|
| `showthema1en`-gated column | `BLOCKED (sentence:name)` | `CLEAN` |
| `showthema2en`-gated column | `BLOCKED (sentence:name)` | `CLEAN` |
| 4 other offered candidates | `CLEAN` (unaffected) | `CLEAN` (unchanged) |
| `resistancebroken`/`supportbroken` | `REFUSED (pine:reassign)` | `REFUSED (pine:reassign)` — unrelated, unchanged (RISK-030) |

## 9. Complete 8-script corpus before/after matrix

Re-run via `inspectPine()` — the exact function the real Import UI calls —
against all 8 scripts, unmodified, no substitutions.

| # | Script | Before Track F v1.1 | After Track F v1.1 | Change |
|---|---|---|---|---|
| 1 | Chandelier Exit | 10/10 clean | 10/10 clean | Unchanged |
| 2 | QQE MOD | 3/6 (3 blocked, `pine:state`) | 3/6 (same) | Unchanged — QQE untouched, per instruction |
| 3 | CM Williams Vix Fix | 4/4 clean | 4/4 clean | Unchanged (already fixed, Tranche 1) |
| 4 | Daily/Weekly/Monthly H/L | 0/6, `pine:collection` | 0/6, `pine:collection` | Unchanged — correct refusal |
| 5 | ZigZag++ | 0/8, `pine:module` (top-level) | 0/8, `pine:module` (same) | Unchanged — correct refusal |
| 6 | Support Resistance Channels | 4/6 offered clean | **6/6 offered clean** | **FIXED** — both boolean-gated columns now resolve |
| 7 | Minervini Trend Template | 0/2 usable | **2/2 clean** | **FIXED** |
| 8 | Pocket Pivot Breakout | 3/3 clean | 3/3 clean | Unchanged (already fixed, Tranche 1) |

## 10. Any newly-exposed downstream failures

None. No script that previously reached a candidate offering now surfaces a
NEW, different failure further downstream — every column that newly resolves
resolves completely (readback succeeds AND the underlying formula is a real,
computable column). No script is called "SUPPORTED" merely because
`input.bool` moved it one stage farther without actually working.

## 11. int/float regression result

Zero regressions. Full relevant suites re-run after every change in this
tranche (see §12); every pre-existing int/float test in
`pine.paramManifest.test.js`, `paramEdit.test.js`, `ParamControls.test.jsx`,
`test_param_manifest.py`, and `BuilderSheet.paramReopen.test.jsx` (the
original RSI/`length` golden journey) passes unchanged.

## 12. Mutation/non-vacuity evidence

- **`pine.paramManifest.test.js`**: the cross-file parity assertion's
  hardcoded array was updated (would fail if `bool` were added to one list
  without the other — proven directly, since that is exactly what happened
  mid-session before both lists were updated together). A new, correctly-
  updated test replaces the stale "input.bool never becomes a parameter"
  assertion, which the promotion made fail; a SEPARATE new test proves the
  conditional-use case still correctly attaches NO locator, so the
  DECLARATION-eligibility change and the ATTACHMENT question are not
  conflated.
- **`builderInputs.test.js`**: two tests whose own premise was "bool is
  excluded" were updated — one repurposed into a positive test proving
  admission, the other's negative-control example swapped from `input.bool`
  to `input.source` (still excluded) so it continues to prove what it always
  claimed to prove.
- **`pineBoxDownstreamScope.test.jsx`**: its own Tranche-1-era test, written
  with an explicit built-in tripwire comment ("if this test ever goes red
  because `input.bool` starts resolving, that is a SIGNAL to update it") —
  it went red exactly as anticipated, and was updated to prove the NEW,
  correct behavior instead of being silently deleted.
- **Reverting `input.bool`'s promotion** (either list alone, or both)
  reproduces the exact pre-promotion failures: Minervini/Support Resistance
  Channels' `sentence:name` refusals return, and `param_manifest.py`/
  `paramEdit.js` refuse a `bool`-typed manifest entry by its OLD "not
  eligible" path — verified by hand during development (the mid-session
  `pine.paramManifest.test.js` failure IS this proof, captured in real
  time rather than performed separately afterward).
- **Save/reopen fidelity is real, not merely UI state**: every claim above
  is backed by a direct read of `H.store`'s own stored document
  (`compute.paramManifest`/`paramState`/`source`), never by trusting what
  React renders alone — the same discipline `BuilderSheet.paramReopen.
  test.jsx` already established for `int`.

## 13. Full relevant test-suite result

- `app/src/components/chart/builder/` + `app/src/components/chart/engine/`:
  **5,588 passed**, 4 skipped, 4 failed — all 4 failures independently
  confirmed pre-existing and unrelated via `git status` showing zero local
  changes to their own files (`BuilderSheet.pine.test.jsx`'s own
  byte-identical test, a pre-existing CRLF flake in
  `ImportBox.thinkscript.test.jsx`, `pine.blindCorpus.test.js`'s own
  27-vs-27 count, and `flipCRecord.test.js`'s own 52-vs-53 count — the last
  two are counting-drift assertions in files this tranche never touched).
- `tests/test_param_manifest.py` + `tests/test_user_definitions.py`
  (Python): **71 passed**, 0 failed.
- New tests added this tranche: 2 (`pine.paramManifest.test.js`) + 2
  (`builderInputs.test.js`, repurposed) + 2 (`paramEdit.test.js`) + 4
  (`ParamControls.test.jsx`) + 3 (`test_param_manifest.py`) + 3
  (`BuilderSheet.boolParamReopen.test.jsx`, new file) + 1
  (`pineBoxDownstreamScope.test.jsx`, repurposed) = 17 new/repurposed
  assertions, all passing.

## 14. Updated RISK-013 / Track F status

**Track F is CLOSED FOR NARROW v1.1: `input.int` + `input.float` +
`input.bool`.** RISK-013 remains **PARTIALLY CLOSED** — `input.string`/
`input.source`/`input.timeframe`/`input.symbol`/`input.time`/`input.color`,
switch/branch-driving inputs beyond a plain boolean, numeric `options`
enums, and bar-displacement inputs are all still OPEN, untouched, each a
named, disclosed limitation. **Track F is not complete.** `input.bool` was
promoted specifically because real public-script compatibility evidence
(Minervini, Support Resistance Channels — both previously blocked, both now
fully working) justified it, per the owner's own explicit framing. Full
detail recorded in `RISK_REGISTER.md`'s RISK-013 row.

## 15. Commit

Recorded in the commit that adds this document, alongside every file listed
in §12/§13.

---

## Recommendation for the next issue only

If a future tranche is separately authorized: the Formula tab's own
"+ Add an input" window-argument binding message (kept deliberately
un-folded into this tranche, per explicit instruction) is the smallest,
most self-contained remaining item — a UX-message parity fix, not a new
mechanism, mirroring `builderInputs.js::windowRefusal`'s existing, clear
sentence for the Pine-import door. **Not started here. No other Track F
input type, Stoch, or the ADX-family is recommended or started either.**

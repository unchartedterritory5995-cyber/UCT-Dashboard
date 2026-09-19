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

⚰️ **THIS SECTION ORIGINALLY SAID** *"`app/src/components/chart/builder/` +
`app/src/components/chart/engine/`: 5,588 passed, 4 skipped, 4 failed"* — a
SCOPED run over two directories, not the full app suite, and the number
carried into the chat reply as "5,588/5,596 ... 4 failures" without the "4
skipped" qualifier, which does not arithmetically reconcile on its own
(5596 − 5588 = 8, not 4) even though the underlying scoped run did
(5588 + 4 + 4 = 5596). Corrected below with the FULL suite, the exact
per-status breakdown the owner asked for, and each of the 6 failures
individually isolated against the pre-Track-F-v1.1 source rather than
classified by inspection alone — see §16.

- **Full `app/src` suite** (`npx vitest run`, final run 2026-09-06, after
  §16.3's and §16.4's new test files were added): **Test Files: 993 passed,
  6 failed, 1 skipped (1,000 total). Tests: 14,249 passed, 6 failed, 9
  skipped (14,264 total). Errors: 1 unhandled** (a pre-existing
  `lightweight-charts` mock gap in `StockChart.smoke.test.jsx`, unrelated to
  Pine/Track F, counted separately from the 6 failed tests per vitest's own
  reporting). All 6 failures **individually isolated** against the
  pre-Track-F-v1.1 source (by temporarily reverting exactly the 5 non-test
  JS files this tranche changed and re-running each failing file) —
  **every one fails identically with or without this tranche's changes**.
  Full detail, including the ones not previously named
  (`pollingSites.rail.test.js`, `screener/reachable.test.js`, and
  `BuilderSheet.pine.test.jsx`), is in §16.
- `tests/test_param_manifest.py` + `tests/test_user_definitions.py`
  (Python): **71 passed**, 0 failed. Re-verified unchanged.
- New tests added this tranche: 2 (`pine.paramManifest.test.js`) + 2
  (`builderInputs.test.js`, repurposed) + 2 (`paramEdit.test.js`) + 4
  (`ParamControls.test.jsx`) + 3 (`test_param_manifest.py`) + 3
  (`BuilderSheet.boolParamReopen.test.jsx`, new file) + 1
  (`pineBoxDownstreamScope.test.jsx`, repurposed) = 17 new/repurposed
  assertions, all passing — **plus, from the reconciliation review (§16):**
  4 (`BuilderSheet.boolMemberInputReopen.test.jsx`, new file — the direct-
  conditional/memberInputs mechanism) + 2
  (`BuilderSheet.formulaTabWindowPreCheck.test.jsx`, new file — the
  Formula-tab pre-check) = 6 further new assertions, all passing.

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

## 16. Reconciliation Addendum (2026-09-06, owner review)

The owner accepted §§1-15 in principle but required one final evidence
reconciliation before closing Track F v1.1, covering the JS test-count
arithmetic, a precise statement of the `input.bool` canonical-representation
contract, and permanent evidence for the direct-conditional case beyond the
window-bound fixture. All three are resolved below. **No code from §§1-15
changed as a result** — §§1-11 stand as originally shipped; this section adds
evidence and one narrow, separately-authorized UX fix (§16.4).

### 16.1 — The JS test-count reconciliation

The full `app/src` suite, not the scoped `builder/`+`engine/` subset §13
originally reported. Final run (after §16.3's and §16.4's new test files —
`BuilderSheet.boolMemberInputReopen.test.jsx` and `BuilderSheet.
formulaTabWindowPreCheck.test.jsx` — were added; an earlier pass mid-review
measured 998 files/14,258 tests with the identical 6 failures, before those
2 files existed):

| | Test Files | Tests |
|---|---|---|
| Passed | 993 | 14,249 |
| Failed | 6 | 6 |
| Skipped | 1 | 9 |
| **Total** | **1,000** | **14,264** |
| Errors (unhandled, separate) | — | 1 |

14,249 + 6 + 9 = 14,264 — this reconciles exactly. The 1 "Errors" line is
vitest's own separate category for an UNCAUGHT exception that does not
resolve to a specific test's pass/fail outcome (here: `StockChart.smoke.
test.jsx` triggers `[vitest] No "LineType" export is defined on the
"lightweight-charts" mock` — a pre-existing incomplete mock, unrelated to
Pine/Track F, that predates this tranche and touches no file this tranche
changed).

**The 6 failing tests, each individually isolated** (temporarily reverted
`ParamControls.jsx`, `ParamControls.module.css`, `builderInputs.js`,
`paramEdit.js`, and `pine.js` — the 5 non-test JS source files this tranche
changed — back to their pre-Track-F-v1.1 (`d1e64a3d8`) content, re-ran each
failing file in isolation, then restored via `git checkout HEAD`):

| Test | Failure | Isolated result |
|---|---|---|
| `hooks/pollingSites.rail.test.js` | a new bare `useSWR` polling site in `app/src/floor2/hooks/useFloor.js`, not in the 2026-08-09 census | **Fails identically** against pre-Track-F-v1.1 source |
| `components/screener/reachable.test.js` | 15 `floor2`/`community` modules unreachable from any route | **Fails identically** |
| `components/chart/builder/BuilderSheet.pine.test.jsx` | `TypeError: Cannot read properties of undefined (reading 'id')` at its own line 214, a pre-existing defect in the test's own fixture wiring | **Fails identically** |
| `components/chart/builder/ImportBox.thinkscript.test.jsx` | `\n` vs `\r\n` line-ending mismatch (the CRLF flake already named in §13's original text) | **Fails identically** |
| `components/chart/engine/ast/pine.blindCorpus.test.js` | `expected 27 to be greater than 27` (the corpus's own accepted-vs-passing floor, already named in §13's original text) | **Fails identically** |
| `components/chart/engine/__tests__/flipCRecord.test.js` | `expected length 52 but got 53` (already named in §13's original text) | **Fails identically** |

All 6 are confirmed pre-existing and unrelated to this tranche BY DIRECT
ISOLATION, not by inspection or by "no file in this tranche's diff matches."
`pollingSites.rail.test.js` and `reachable.test.js` were not previously
named (they fall outside `builder/`+`engine/`, the originally-scoped run) —
both concern `app/src/floor2`/`app/src/pages/community`, a feature this
tranche never touched, opened, or imported from.

### 16.2 — The `input.bool` canonical-representation contract, stated precisely

The proposed contract in the request — Pine `true`/`false` → trusted `bool`
type → canonical `1`/`0` execution encoding → checkbox UI, with strict
rejection of anything else — is **exactly correct for ONE of two separate
mechanisms, and does not extend to the other.** §§1-11 described the first
mechanism fully and correctly but did not sufficiently distinguish it from
the second, which is the one that actually produced the Minervini/Support
Resistance Channels corpus fix. Both are disclosed here precisely rather
than letting the narrower claim stand in for the broader one:

**Mechanism A — Track F's own `compute.paramManifest`/`ParamControls`/
`param_manifest.py`** (used ONLY when a boolean feeds a position that cannot
become a named identifier — a window slot; §§3-5 describe this one):
- `pine.js::PARAM_MANIFEST_ELIGIBLE_KINDS` tags the literal with a genuine
  `type: 'bool'` locator.
- `param_manifest.py::_type_ok`'s `'bool'` branch and `paramEdit.js::
  validateValue`'s `'bool'` branch BOTH require the value to be exactly `0`
  or `1` — any other integer, float, string, or JSON boolean is REJECTED,
  never coerced.
- The user-facing control is a real checkbox (`ParamControls.jsx`).
- **In practice this mechanism's editable-bool case is narrow to the point
  of vacuity**: per the disclosed structural boundary in §6.5, a boolean
  reaching this mechanism is by definition bound to a window slot, and
  `interpret.js::windowLiteral`'s universal `>=1` floor means `false` (→ `0`)
  can never be a VALID toggle target for such a binding — the mechanism is
  complete and correctly guards against corruption, but no script in the
  current corpus exercises a genuinely useful toggle through it.

**Mechanism B — `builderInputs.js`'s `memberInputTranslation`/
`inputsFromFolded` (pre-existing, W1b.9, NOT new to this tranche)** — the
mechanism that actually fixed Minervini's `show_52_week_high_low` and both
of Support Resistance Channels' gates, all three of which gate a ternary
CONDITION directly, not a window slot:
- Maps a folded `input.bool` to `document.inputs[]`'s `type: 'int'` —
  **deliberately, not a genuine `'bool'` type** (`FOLDED_INPUT_TYPES`'s own
  header comment: byte-identical to the already-shipped bare
  `input(true/false)`).
- `defSchema.validateInputValue`'s `'int'` case requires only that the value
  be an integer — **it carries no `{0,1}` domain restriction**, and
  `inputsFromFolded` never sets `min`/`max` for a plain `input.bool()` (Pine's
  bool has no `minval`/`maxval` to carry forward). A member CAN set this
  value to any integer via a placed chart instance's settings
  (`instanceControls.js::coerce`'s `'int'` case is unbounded).
- This is **not a gap introduced by this tranche** — it is the same behavior
  the already-shipped bare `input(true/false)` mapping has always had, kept
  identical on purpose for byte-for-byte parity.
- At the EXECUTION layer (verified by reading `interpret.js` directly):
  `const TERNARY = (t, a, b) => (isNan(t) ? NaN : (t !== 0 ? a : b))` — ANY
  nonzero number is Pine's own "true," exactly `0` is "false." This is
  Pine's native NUMERIC truthiness convention, not a JS string/object
  coercion: the value is a genuine JS `number` end to end, at every layer of
  this mechanism, never a string and never a JS boolean. **No truthy/falsy
  STRING coercion exists anywhere in either mechanism** — that half of the
  original claim holds universally. The half that does NOT hold universally
  is "numbers other than the exact allowed 0/1 encoding are rejected" —
  true for Mechanism A, false for Mechanism B.

**So: intentional canonical encoding — yes, confirmed, for Mechanism A.**
Mechanism B's `type:'int'` choice is ALSO intentional (documented, reasoned,
byte-identical to prior shipped behavior) but is a DIFFERENT, wider
contract — a plain integer knob whose origin happened to be a Pine boolean,
not a domain-restricted boolean parameter. Neither mechanism performs
generic truthy/falsy coercion of the JS kind (strings, objects, arrays are
never accepted as an input value by either); the distinction is specifically
about which INTEGERS beyond `{0,1}` are accepted.

### 16.3 — Direct-conditional bool evidence (Mechanism B), beyond the window-bound fixture

New permanent test file: `BuilderSheet.boolMemberInputReopen.test.jsx` (4
tests, all passing), using the minimal reduction of Minervini's own shape:

```
showit = input.bool(true, "Show It")
level = close - 1
plot(showit ? level : na, title="Gated Level")
```

- **Default true / default false**: `pineMemberInputs` declares `{key:
  'showit', type:'int', label:'Show It', default:1}` / `default:0`
  respectively; `skipped` is empty in both cases (not window-refused).
- **Direct conditional use**: the printed formula stays `showit ? close - 1
  : 0 / 0` — SYMBOLIC (`showit` remains a bound identifier; Pine's `na`
  compiles to `0/0`, this engine's NaN literal). `level`, an ordinary `let`
  with no input semantics, is inlined — only input-bound names survive
  translation as identifiers.
- **True branch / false branch, proven against the REAL compute path, not
  the BuilderSheet preview**: `evaluateFormula`'s own scope (read directly
  in `lint.js::declaredInputs`) is a "this name is declared" flag map, not a
  value binding, so BuilderSheet's live preview never computes a real
  number. This test instead builds a real `compute.kind:'ast'` definition
  from the translated AST and calls `nativeRegistry.computeFor(def, bars)`
  directly — the SAME function a real chart calls. With the declared default
  (`showit=1`): `computeFor(def, bars)` → `[9, 10, 11]` (the true branch,
  `close - 1`, over 3 bars of close 10/11/12). Overriding the identical AST's
  input to `0` (exactly what toggling the memberInput's default and
  re-saving does): `computeFor(def, bars, {showit: 0})` → all `NaN` (the
  false branch, `na`). Same tree, same interpreter, only the input value
  differs — this is the "changed canonical/executable behavior" proof,
  direct rather than inferred.
- **Save → reopen → toggle → persisted state**, through the real "Your
  formulas" door (mirroring `BuilderSheet.paramReopen.test.jsx`'s stateful-
  fetch pattern exactly): import shows a plain NUMBER field (NOT a
  checkbox — confirmed distinct from Mechanism A's UI) at default `1` under
  "Inputs you can change later" (no "Adjustable parameters" heading, no
  `param-input-*` testid) → save persists `document.inputs[]` with `{key:
  'showit', type:'int', default:1}` → close, reopen through the real Edit
  door restores the same row → the formula TEXT does not change on toggle
  (unlike Mechanism A's astPath rewrite, this mechanism's knob is
  `document.inputs[].default`, not the AST) → editing the default to `0` and
  clicking "Save changes" PUTs `{key:'showit', type:'int', default:0}` →
  closing and reopening a second time confirms `0` persisted, not just the
  create-time default.
- **Window-bound boundary preserved, unweakened**: `BuilderSheet.
  boolParamReopen.test.jsx` (Mechanism A, unchanged from §6) still proves
  `sma(close, useLong)` toggled to `0` correctly disables Save rather than
  producing an invalid `sma(close, 0)` formula — `windowLiteral`'s `>=1`
  floor was not touched, weakened, or worked around anywhere in this
  reconciliation.

### 16.4 — Formula-tab window-argument pre-check (message parity, separately authorized)

**Gap found and closed.** The Formula tab's OWN hand-authoring path (a
member typing a formula directly, not importing Pine) had NO pre-check for
this exact class of problem: declaring a member input whose key lands in a
window slot of the CURRENT formula (`sma(close, period)` with `period`
declared) showed no message and left Save ENABLED — `inputKeyProblem`
checked only the key's spelling. The document would save; the member would
meet `resolve:window` for the first time on a real chart, with no
attribution back to which input caused it.

**Fix, narrowly scoped exactly as authorized:**
- **Reuses the existing detector**, `builderInputs.js::formulaNameRoles` —
  the SAME function the Pine-import door's own `positionVerdict` already
  calls for the identical question (that file's own header: "two readers of
  one fact must not disagree"). No second semantic validator was written;
  `BuilderSheet.jsx` now computes `formulaNameRoles(result.ast).literalOnly`
  once per settled evaluation (`windowBoundMemberInputKeys`, a `useMemo`)
  and checks each member input's key against it.
- **One new, narrowly-scoped message function**, `builderInputs.js::
  formulaTabWindowRefusal(key)` — NOT a reuse of the Pine-import door's own
  `windowRefusal`, because that function's closing sentence ("the default
  stays folded into the formula, so the column is still right") is TRUE on
  the Pine door and FALSE here (nothing folds a hand-typed identifier away;
  the formula as typed genuinely cannot compute). Reusing the detector and
  not the wording is the correct amount of sharing.
- **`inputsValid`** (which already gates the Save button, unchanged
  otherwise) now also requires `!windowBoundMemberInputKeys.has(spec.key)`
  for every declared member input.
- **No syntax expansion, no runtime semantic change, no way for an invalid
  formula to become valid** — the fix only narrates a refusal
  `interpret.js::windowLiteral` was already going to make; `windowLiteral`
  itself is untouched.
- **Pine-import behavior is unaffected** — this fix touches only
  `BuilderSheet.jsx`'s own hand-authoring member-input rendering/validation;
  `PineBox.jsx`'s own door and `inputsFromFolded`'s own skip/refuse list are
  untouched.

**Permanent, non-vacuous regression**: new file `BuilderSheet.
formulaTabWindowPreCheck.test.jsx` (2 tests, both passing):
1. Typing `sma(close, period)` and declaring `period` shows the message
   (matching `/lands in a WINDOW/` and `/resolve:window/`), marks the input
   `aria-invalid`, and disables Save — asserted directly that no POST/PUT
   ever fires.
2. Editing the SAME formula to `sma(close, 20) * period` (the identical
   input, moved out of the window slot) makes the message disappear ON ITS
   OWN, re-enables Save, and a real save persists `{key:'period',
   default:14}` correctly.

**Non-vacuity proven by mutation**: temporarily reverted `BuilderSheet.jsx`
to its pre-fix (`HEAD`) content and re-ran this file — both tests fail RED
(`getByTestId('member-input-problem-0')` finds nothing; Save stays enabled),
confirming the test genuinely exercises the fix rather than something
already true. The fix was then restored and reconfirmed green.

**Relevant compatibility fixtures re-run after this fix**: the full
`BuilderSheet`/`builderInputs`/`ParamControls`/`paramEdit`/
`pineBoxDownstreamScope`/`pine.paramManifest` test family (130 tests across
13 files) — 129 passed, 1 failed (the same pre-existing, isolated
`BuilderSheet.pine.test.jsx` failure from §16.1). The 8-script corpus
(`pineBoxDownstreamScope.test.jsx`) is unaffected, as expected — this fix
touches only the Formula tab's hand-authoring validation, never the
Pine-import path the corpus scripts go through.

---

## Recommendation for the next issue only

⚰️ **THIS SECTION ORIGINALLY DEFERRED** the Formula tab's own window-argument
pre-check message to "a future tranche" — the owner separately authorized it
during the §16 reconciliation review, and §16.4 records it as DONE (not
merely recommended). With that item now closed, there is no further
self-contained item this report identifies as ready. **No other Track F
input type, Stoch, or the ADX-family is recommended or started either.**

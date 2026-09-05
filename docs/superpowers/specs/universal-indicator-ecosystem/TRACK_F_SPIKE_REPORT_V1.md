# Track F — 15-point spike report

**Date:** 2026-09-05 · **Phase:** One (Trust Foundation), Track F · **Governing
decision:** `DECISIONS.md` DEC-006 · **Companion:** `TRACK_F_PARAMETER_ADR_V2_2.md`
§6 (spike verification detail lives there; this document is the standalone
report the owner asked for after the spike completed).

**This report ends in a stop, not a start.** Per the owner's instruction and
the mid-turn instruction that arrived while the spike was running, this
report returns evidence and a *plan*. It does not begin implementation, and
it does not expand scope beyond `input.int`/`input.float`.

---

## 1. Exact spike results

All 15 owner-required conditions pass, proven against real `save()` /
`alert_user_series` code (no simulation), in a new, additive, currently-inert
module gated on a key ordinary definitions never carry:

```
tests/test_param_manifest_spike.py :: 21 passed, 0 failed
```

| # | Condition | Test(s) |
|---|---|---|
| 1 | One numeric parameter imports adjustable, overrides cleanly | `test_1` |
| 2 | Two independent parameters don't disturb each other | `test_2` |
| 3 | One parameter at multiple AST locations updates atomically | `test_3`, `test_3b` (disagreement variant) |
| 4 | Offset/window literal survives a parameter change | `test_4` |
| 5 | Manual text edit of a binding value == the UI-edit path | `test_5` |
| 6 | A deleted binding detaches; does not block the save | `test_6`, `test_6b` (non-literal variant) |
| 7 | A lookback-increasing change is accepted and reflected | `test_7` |
| 8 | An out-of-range override is REJECTED, not clamped | `test_8`, `test_8b` (boundary-inclusive variant) |
| 9 | `forget()` still fires on every save carrying a manifest | `test_9` |
| 10 | A parameter change produces a new `ast_hash` for scan keying | `test_10` |
| 11 | One input feeding two trees updates both bindings atomically | `test_11` |
| 12 | One locator disappearing → `partially_detached`, never a half-working slider | `test_12` |
| 13 | Two locators disagreeing → `conflicted`, neither value silently preferred | `test_13` |
| 14 | A crafted PUT widening/retyping an *existing* parameter's bound is defeated | `test_14`, `test_14b`, `test_14c` (fresh-creation control) |
| 15 | A crafted PUT cannot invent a *new* trusted parameter id on an *existing* definition | `test_15`, `test_15b` (legitimate-fresh-creation control) |

Regression confirmation (existing suites, unaffected):

```
tests/test_user_definitions.py :: 68 passed, 0 failed   (full save/validate/alert suite)
tests/test_vendor_truth.py     :: 22 passed, 0 failed   (Track A infra, unrelated code)
```

`test_user_definitions.py` passing unchanged is the direct proof of the
inertness claim below — none of its fixtures carry `compute.paramManifest`,
so the new hook's early-return path is what every one of those 68 tests
actually exercises.

## 2. Design assumptions falsified

**One, material: the locator schema in ADR V2.2 §1/§3 cannot be built as
written.** §1 describes a locator as `{treeIndex, bindingId}` and describes
reconciliation as writing into "that tree's `let <bindingId> = <value>`
line" — prose that assumes server-side reconciliation re-parses
`compute.source` text to find a named `let` binding.

Verified directly against `api/services/user_definitions.py` (not assumed):
there is exactly one UCT-DSL parser in this codebase and it is client-side
JS (`letPrepass.js` → `parse.js`). The file's own comments name a
server-side re-parse of the same grammar as "the defect this repo names
most often." The server does not parse `compute.source` anywhere in the
save path today, and building §1 as literally written would have
introduced that exact defect.

**Corrected schema, proven by the spike:** a locator is `{treeIndex,
astPath}` — a structural JSON path walked against the already-submitted,
already-parsed `compute.ast` / `compute.trees[k]`. This is pure JSON
traversal of data `save()` already receives, never a second parse. It
matches this codebase's own already-preferred idiom ("make the knowing side
stamp its answer rather than making a second side re-derive it") and costs
nothing new to build — `_walk()` in `param_manifest_spike.py` is ~12 lines.

This does not change any *behavior* the ADR specifies (one logical
parameter/one-or-more locators, atomic multi-locator writes,
`partially_detached`/`conflicted` states, the immutable/derived split, or
§4's canonicalize-from-`prev` protection) — only the shape of one field.
ADR V2.2 §6.0 records this correction in place; a v1 implementation must
build against §6, not §1's literal locator field name.

**No other assumption was falsified.** The `__uct_param_<n>` reserved-name
scheme, the reject-not-clamp bounds policy, the immutable/derived split, the
`prev`-loading bypass-closure mechanism, and the offset-literal grammar
(`closedTable.json`'s `_no_offset` guarantee) all held exactly as designed —
each had a dedicated test, and each passed on first correct implementation
(after fixing one bug in my own `_literal_value()` helper during
development, described in ADR V2.2 §6 — an offset node's literal is a bare
number, not a wrapped `{"type":"num"}` node, and both shapes must resolve).

## 3. Code paths newly touched

- **New file:** `api/services/param_manifest_spike.py` — canonicalization
  (`_canonicalize_manifest`), astPath-based reconciliation (`reconcile`,
  `_walk`, `_literal_value`, `_tree_for`), reject-not-clamp bounds
  (`_validate_bounds`), and the single entry point `apply(definition,
  prev_definition)`. Explicitly named a spike in its own docstring; not
  wired to any translator, UI, or endpoint other than the hook below.
- **Modified:** `api/services/user_definitions.py` — one additive block
  inserted in `save()`, after `compute.kind` validation and before
  `ast_hash`/`treesHash` computation. Structure: `if isinstance(compute.get
  ("paramManifest"), dict):` → load `prev` early (a second, spike-scoped
  read of `_newest()`, distinct from phase 1's own later `prev` load) →
  call `param_manifest_spike.apply()` → replace `definition`/`compute`
  with its return. **Inert (no-op, byte-for-byte) for every definition
  without a `paramManifest` key** — proven by `test_user_definitions.py`'s
  68/68 unaffected.
- **New file:** `tests/test_param_manifest_spike.py` — the 21-test proof
  suite above.
- **Not touched:** `pine.js` (translator), any router, any frontend file,
  `alert_rev_migration.py`, `ast_interpret.py`, `closedTable.json`. The
  spike deliberately proves the *server-side enforcement* half of Track F
  only — it does not translate a single real Pine `input()` declaration
  into a manifest; every manifest in the test suite is hand-constructed to
  simulate what a translator would eventually emit.

## 4. Is narrow v1 implementation now safe?

**The server-side enforcement half: yes, proven.** The three properties a
malicious or careless client could otherwise exploit — widen/retype an
existing parameter's bound, invent a new parameter identity mid-edit, or
read a half-broken multi-locator binding as if it were fully working — are
all now defeated by code with passing regression tests, not by policy
alone.

**The translator half: not yet attempted, and out of this spike's scope by
design.** The spike hand-builds every manifest its tests use; it does not
touch `pine.js`. Whether `input.int(...)`/`input.float(...)` can be
reliably detected and translated into `{sourceName, title, type, default,
min, max, step, options, locators}` for real Pine source is a separate,
unproven piece of work — v1 implementation is "safe" in the sense that the
guardrails around it are proven, not in the sense that the translation work
itself is now trivial or already done.

## 5. Smallest implementation plan — `input.int` / `input.float` only

Scope explicitly excludes bool/string/source/timeframe/symbol inputs (owner
instruction) and excludes any raw-source persistence or symbolic AST
parameter node (standing constraints, unchanged since ADR V2).

1. **Translator (`pine.js`):** detect `input.int(default, title=, minval=,
   maxval=, step=)` / `input.float(...)` calls at the point they're already
   walked to build `let` bindings (`letPrepass.js` already has to see every
   `input.*` call to bind its result to a name — this is additive
   bookkeeping at an existing walk site, not a new pass). For each such
   call, on first sight of a given original Pine variable name, mint the
   next `__uct_param_<n>` id and record `{sourceName, title, type, default,
   min, max, step, options: null}` plus one locator `{treeIndex, astPath}`
   pointing at the literal argument position the `let` line's value
   resolves to in that tree's compiled AST. If the same original variable
   is bound again in a second tree of a multi-tree document, append a
   second locator to the *same* id (ADR V2.2 §1) rather than minting a new
   one.
2. **Client-side manifest assembly:** `compute.paramManifest` is emitted
   alongside `compute.trees`/`treesHash`/`sources` exactly as those are
   today — no new save-path plumbing, since `validate_v2()` already accepts
   arbitrary additional `compute.*` keys and the spike's hook already
   activates purely on the key's presence.
3. **Server:** no new work — `param_manifest_spike.py` (promoted out of
   spike status, renamed, and given a short "why" docstring per this
   repo's comment conventions) plus the existing hook in `save()` *is* the
   v1 server-side implementation. The spike was written to be promotable,
   not throwaway.
4. **UI:** a slider/number-input control per manifest entry, reading
   `compute.paramState[id]` for display (`attached` → live value editable;
   `detached`/`partially_detached`/`conflicted`/`non_literal` → disabled,
   showing `reason` verbatim) and writing a new value by re-running the
   existing edit-and-save flow with every locator's tree re-translated to
   carry the new literal — this is the one piece of genuinely new frontend
   work; everything else in this plan is additive backend/translator
   bookkeeping on existing walks.
5. **Explicitly deferred, not started:** bool/string/source/timeframe/
   symbol input types; any UI for `conflicted`/`partially_detached`
   *resolution* (v1 only needs to disclose these states correctly, not
   offer a repair flow); raw Pine source persistence; a symbolic AST
   parameter node.

## 6. The regression/E2E suite that would gate v1 implementation

Before any v1 PR merges:

- `tests/test_param_manifest_spike.py` — promoted (renamed off "_spike"),
  kept at 21/21, **plus** new cases proving the translator actually
  produces a correct manifest from real Pine source for at least: a
  single `input.int`, a single `input.float`, one input feeding two
  `plot()`-derived trees, one input with `minval`/`maxval` present and one
  with them absent (falls back to type-only bounds, per DEC-006's
  "unsupported/dynamic cases preserve the default and disclose the
  limitation" clause — an input without declared bounds is not the same
  as one with bounds of `None`/`None`, and the plan must decide which it
  is before implementation, not during).
- `tests/test_user_definitions.py` — full suite, unchanged pass count, as
  the inertness proof for every non-parameterized definition.
- A new Core Golden Journey re-run of `CORE_GOLDEN_JOURNEY_01_PINE_RSI_
  IMPORT.md` (the actual RISK-013 source case — a 97-line Pine RSI script
  with 5 adjustable inputs) — this is the real-world fidelity proof DEC-006
  was written to satisfy, and the golden-journey doc already exists as the
  baseline to diff against.
- A frontend test proving the slider control correctly renders all five
  `paramState` values (`attached`/`detached`/`partially_detached`/
  `conflicted`/`non_literal`) and that a `conflicted`/`partially_detached`/
  `non_literal` control is genuinely non-interactive (disabled attribute
  present, not just styled to look disabled).
- Re-run of the two point-15 crafted-PUT tests (`test_15`, `test_15b`)
  against whatever router path v1 actually ships on, not just the spike's
  direct `save()` call — the spike proves the mechanism; the gating suite
  must prove the mechanism is still reached through the real HTTP path.

## 7. Explicit non-scope, restated

Not begun and not implied by any of the above: bool/string/source/
timeframe/symbol parameter support. No raw Pine/vendor source is persisted
anywhere. No symbolic AST parameter node was introduced — `closedTable.
json`'s 8 node types are unchanged; a parameter is a manifest entry
pointing *at* an ordinary literal node, never a new node type itself.

## 8. Authorization read for the next step

DEC-006 requires an ADR before "the mapping work" and says nothing further
about an automatic trigger once one is accepted; `PHASE_ONE_PLAN.md`'s
Track F row is the same: "Pursue, contract-first (ADR before
implementation)." Neither text states that a passing spike alone clears
broad implementation — the spike gate itself is this ADR chain's own
self-imposed caution, not something DEC-006 asked for by name. Read
together with the owner's own framing this turn ("stop... unless the
existing Phase One authorization clearly permits...") and the mid-turn
instruction asking for a *plan* to be returned rather than code, the
honest reading is: **Phase One authorization does not clearly permit
skipping straight to implementation.** This report is the stop point. The
owner's explicit go-ahead on the plan in §5 is the next gate, not a
formality already cleared.

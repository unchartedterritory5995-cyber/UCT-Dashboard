# ADR v2.1: Pine input-parameter fidelity — single authority, binding identity, reconciliation, validation, spike gate

**Status:** 🟡 **PROPOSED — design only, for owner review. No implementation in
this ADR or alongside it.** This is a DELTA on `TRACK_F_PARAMETER_ADR_V2.md`,
which is APPROVED IN PRINCIPLE — read it first. This document does not repeat
what V2 already got right (§1 unchanged: closed/literal AST, `compute.source`
reused instead of raw vendor source, input.int/input.float-only v1 scope,
reject-not-clamp, the traced def_id/alert/scan safety in V2's §6). It replaces
ONE part of V2 (§3.1's "override blob") and adds four new sections V2 did not
have: parameter binding identity, manual-edit reconciliation policy,
server-side validation enforcement point, and a pre-implementation spike gate.

**Date:** 2026-09-05 · **Phase:** One (Trust Foundation), Track F · **Governing
decision:** `DECISIONS.md` DEC-006.

---

## 1. The two-authorities gap, and why it existed

V2's §3.1 described three persisted pieces: `compute.source` (with a `let
<name> = <value>` binding), "a small parameter manifest," and **"an override
blob (parameter name → member's current value)."** That third piece is the
defect. Two places could each claim to hold a parameter's current value —
the `let` line's own literal, and the override blob's entry for that same
parameter — with no stated rule for which wins if they ever disagreed (they
would disagree immediately: nothing kept them in sync except "always write both
together," an invariant nothing enforces once a member can edit `compute.source`
directly in `BuilderSheet`'s text editor).

**Resolution, verified against the actual let-mechanism rather than assumed:**
read `app/src/components/chart/engine/ast/letPrepass.js` directly for this
revision. `let` bindings are **not** a node in the canonical AST at all — they
are inlined by **whole-identifier textual substitution before parsing**
(`substitute()`, line ~130: `name` → `(expr)`, word-boundary-matched, in
declaration order). This means `compute.source`'s text is the *only* place a
named, adjustable slot can exist in this system — the persisted `compute.ast`
has already had every `let` inlined away into plain literals by the time it's a
tree. There was never a second legitimate place for "current value" to live;
V2's override blob was an unnecessary, competing duplicate of information
`compute.source` already carries authoritatively.

## 2. Resolution: `compute.source` is the ONLY authority for current value (Approach A)

**No override blob.** The two persisted pieces are:

1. **`compute.source` / `compute.sources[k]`** — UCT-DSL text, exactly as V2
   described, containing one `let <binding-id> = <value>` line per adjustable
   parameter. **This line's value IS the current value.** There is nothing else
   to read.
2. **The parameter manifest** — now **purely immutable, descriptive metadata**,
   recorded once at import and never mutated afterward: the parameter's stable
   binding id (§3), its Pine-side source name and title (for display), its
   **original Pine-declared default** (needed for a "reset to default" UI
   action, since after a member overrides it, `compute.source`'s own text no
   longer shows what the default was), min/max/step/options, and
   frozen-or-adjustable + reason.

**Changing a parameter via the UI** edits that one `let` line's value in
`compute.source`, then goes through the existing parse → (let-prepass inline) →
canonicalize → analyze → save pipeline — the exact same path a member retyping
that line by hand in the text editor already produces today. **Manual source
edits and UI slider edits are the same operation as far as the system is
concerned, by construction** — which is exactly what closes the two-authorities
gap: there is only one operation, edit-the-`let`-line, regardless of which
surface performed it.

## 3. Parameter binding identity — a reserved internal id, not the Pine name

**Do not use the Pine-side name (`len`, `period`, ...) as the actual `let`
binding name.** Verified directly against `letPrepass.js` before deciding this:

- **Identifier compatibility**: `IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g` — an
  identifier may start with an underscore and contain any number of letters,
  digits, or underscores. A generated name like `__uct_param_1` is fully valid
  UCT-DSL syntax; no new lexer rule is needed.
- **Collision with the closed table's own names**: `RESERVED` is built
  from every non-`_`-prefixed key across every `closedTable.json` section
  (every function/scalar/series name) plus `RECURRENCE_BINDINGS` (`self`).
  `__uct_param_<n>` collides with none of these — it isn't a function, scalar,
  series, or the recurrence keyword — and would not need to, since this
  RESERVED-set check is exactly the existing `let:shadow` guard already
  refusing any collision attempt, for free.
- **Collision with a member-authored `let`**: a member creating their own
  `let __uct_param_1 = 5` (deliberately or by wild coincidence) is caught by
  the SAME existing mechanism that already refuses a duplicate `let` name —
  `letPrepass.js` line ~256, `refuse('let:shadow', "\`${b.name}\` is already
  bound above", ...)`. **This case needs no new code**: if our own
  translator-emitted binding is already declared, a member's second
  declaration of the identical name is refused by name today, on an unrelated
  but directly applicable existing guard.
- **Why NOT the Pine name**: `len`, `length`, `period`, `n` are exactly the
  short, generic names a member is likely to type themselves for an unrelated
  local binding in the same formula. Using the Pine name as the actual
  binding identity would make an ACCIDENTAL collision plausible, not
  theoretical. A deliberately ugly, reserved-looking name makes an accidental
  collision implausible and makes a DELIBERATE edit to it (renaming, deleting)
  an unambiguous signal rather than something that could happen by accident.
- **The scheme**: `__uct_param_<n>`, where `<n>` is a small integer assigned
  **sequentially, per definition, at the moment a parameter is first made
  adjustable** (at import, or the first time an existing frozen input is
  promoted to adjustable) — **not** a hash of the Pine name, which would
  change if the Pine source name itself is edited, and not reused if a
  parameter is later removed (no renumbering — a gap in the sequence is fine
  and cheaper than ever reusing an id). The manifest is the only place this
  mapping is recorded; the id is never shown to a member (their slider shows
  the manifest's `title`, never `__uct_param_1`).
- **Human-inspectable enough for debugging**: a developer reading raw
  `compute.source` sees `let __uct_param_1 = 21` — not friendly, but instantly
  greppable against the manifest's own id → title mapping, which is exactly
  what "human-inspectable enough for debugging" needs (a name a developer can
  search for), as opposed to friendliness a member would never actually see.
- **Duplicate Pine input titles**: TradingView does not enforce
  `title=` uniqueness across `input.*()` calls in one script. This is a
  non-issue under this scheme specifically because parameters are keyed by
  the internal sequential id, never by title — two adjustable parameters with
  the same member-facing title just render as two identically-labeled
  sliders, a display nicety to fix later, never a binding-identity bug.
- **Reserved-name behavior**: `__uct_param_` as a whole PREFIX should itself
  be treated as reserved by convention for this one purpose — documented here
  so a future, unrelated translator feature does not independently choose the
  same prefix for something else. This is a naming-convention discipline to
  state explicitly at implementation time, not something `letPrepass.js` needs
  to enforce mechanically (the collision it actually matters for —
  member-authored text — is already covered by the existing `let:shadow`
  guard above).
- **Multi-tree `compute.sources[k]`**: a parameter's locator is
  `{treeIndex: k, bindingId: "__uct_param_<n>"}`, not a bare id — `let`
  bindings are scoped to their own tree's source text, so the same source Pine
  variable feeding two different trees (e.g. two plots in one multi-tree
  definition) gets **two independent bindings, two independent ids**, each
  reconciled against its own tree. Implementation must not assume a
  single-tree document when building the manifest.

## 4. Manual-edit reconciliation policy

The core rule, stated once so every case below is an application of it rather
than a new decision: **`compute.source`'s parsed `let` bindings are read on
every load and every save; the manifest is reconciled against what is actually
there, never assumed to still match what it recorded at import.** A slider must
never claim to control a formula it no longer controls.

Reconciliation reads `compute.source` for each `treeIndex`, runs the existing
`letPrepass` binding-extraction (the same `bindings` list — `{name, line,
column, expr}` per declared `let` — the pipeline already builds; no new parser)
**before** substitution, and for each manifest entry with locator
`{treeIndex, bindingId}`:

| Manual edit (from the owner's list) | What reconciliation finds | Result |
|---|---|---|
| `let __uct_param_1 = 14` → `let __uct_param_1 = 21` | Binding present, same name, new literal value | **Normal.** This IS the parameter-change path — no different from a slider edit. New value flows through save as usual. |
| Renames the binding (`__uct_param_1` → `foo`) but does NOT update its use-sites | Binding named `__uct_param_1` no longer found; the formula still references `__uct_param_1` somewhere | The **existing `let:undefined` guard** refuses the whole save with a real, member-visible parse error (an undefined identifier) — before reconciliation even has to make a judgment call. Nothing silently breaks; the member sees why immediately. |
| Renames the binding AND updates every use-site consistently | Binding named `__uct_param_1` no longer found anywhere; formula is otherwise valid | Save succeeds (it's a syntactically valid formula). Reconciliation finds no binding at the recorded locator → **that parameter is marked detached**, disclosed with the specific reason ("this control's underlying binding was removed or renamed"), never silently recreated behind the member's back. |
| Deletes the `let` line only, leaving use-sites | Formula references an undefined identifier | Same as the undefined-reference row above — refused by the existing `let:undefined` guard, not a silent detach. |
| Deletes the `let` line AND removes every use of the parameter (formula rewritten to not need it) | No binding, no reference — a fully valid formula that simply doesn't use this input anymore | Save succeeds. That one parameter is marked detached and disclosed; every OTHER still-bound parameter on the same definition is unaffected — **detachment is per-parameter, never all-or-nothing for the whole definition.** |
| Creates a second `let __uct_param_1 = X` (duplicate name) | — | **Already refused today** by the existing `let:shadow` guard ("already bound above") — no new behavior needed; this case cannot reach reconciliation because the save never succeeds. |
| Changes the binding to a non-literal expression (`let __uct_param_1 = close - open`) | Binding present, same name, but `expr` is not a plain numeric literal | Save succeeds (it's valid UCT-DSL). Reconciliation reads the manifest's declared type (`input.int`/`input.float`, always a literal per v1 scope) and finds the current binding no longer satisfies it → **that parameter is marked detached and disclosed** ("this input's binding is no longer a plain number and can't be shown as a slider"), same as a removed binding. The formula itself is left completely untouched — reconciliation only ever edits parameter-CONTROL metadata, never the member's actual formula text. |
| Copies/pastes or restructures large portions of `compute.source` | Any of the above, depending on what survived | Same table, applied per-binding — reconciliation has no separate "big edit" case; it always just asks the same per-binding question of whatever text is there now. |

**The governing constraint, restated because it's the one the owner's concern is
actually about**: reconciliation NEVER writes to `compute.source` on its own
initiative. It only ever reads it and updates the manifest's `adjustable:
true/false` + reason flags. The member's own edit — valid or not, adjustable
consequence or not — is the only thing that ever changes their formula's text.

## 5. Server-side parameter validation — the exact enforcement point

**The chokepoint is the existing `save()` call in `api/services/
user_definitions.py` — not a separate, bespoke "set parameter" endpoint.**
This is deliberate, and closes the exact bypass the owner asked to be proven
closed: *any* path that can change what ends up inside `compute.source`'s `let`
line — a purpose-built slider PUT, a raw hand-typed text edit, or a hostile,
directly-crafted `PUT /{def_id}` request that skips the UI entirely and
supplies edited `compute.source` text in its body — **converges on the same
`save()` function before anything is persisted.** A validation step placed
inside a dedicated "adjust parameter" endpoint would leave the raw-text path
(which already exists — `BuilderSheet`'s text editor saves through the same
`PUT /{def_id}` today) completely unchecked; a validation step placed inside
`save()` itself cannot be bypassed by any caller, because there is no other way
to persist a change to an existing definition.

**What `save()` must additionally do, at the point it reconciles bindings
(§4)**: for every parameter whose binding is still present and still a plain
literal, check that literal against the manifest's declared bound **before**
accepting the save:

- **Integer-vs-float type**: the manifest records whether the Pine source
  declared `input.int` or `input.float`; a `let __uct_param_1 = 3.5` where the
  manifest says `int` is rejected — REJECT, not silently truncate, per §5 of
  the original ADR's reject-not-clamp ruling applied uniformly.
- **Declared min/max**: rejected outside `[min, max]` inclusive, with the
  specific bound named in the refusal (already specified in V2 §5's four
  required tests — those tests exercise exactly this enforcement point).
- **Declared options (enum)**: a value not in the declared `options` list is
  rejected, symmetrically.
- **This engine's own domain constraints regardless of what Pine declared**:
  the ordinary `_functions_domain`/argument-domain checks (e.g. a window
  argument can't go negative) already run as part of the standard
  translate-then-analyze pipeline every save goes through — a parameter
  change is not exempt from any check a hand-edited source change would also
  face, because by design (V2 §2) it is not distinguishable from one.
- **Frozen/non-adjustable status**: a parameter the manifest marked
  `frozen: true` (an unsupported input type, or one caught by the
  half-applied-control guard) has **no binding to edit in the first place** —
  it was never given a `let` line, so there is nothing for a crafted request
  to target. A request naming a frozen parameter's manifest id is rejected for
  not resolving to any actual binding, the same refusal shape as a detached
  parameter.

**Proof this cannot be bypassed by a crafted request**: because the check
lives inside `save()` and reads the ACTUAL post-edit `compute.source` text
(not a value the client separately asserts "this is my new parameter value"),
there is no request shape that reaches storage without passing through it —
including one that never mentions "parameters" at all and just PUTs an edited
`definition` blob directly. **This is the same reasoning V2 §6.2 already
established for alert re-proof** (routing through the existing `save()` call
inherits its guarantees "for free," and a bespoke fast path that skips it
would not) — the identical argument, applied to input validation instead of
cache safety.

## 6. Track F implementation spike gate

Per the owner's instruction, no broad Track F implementation proceeds without
first running a small spike proving these ten cases against real, running
code — not against this ADR's prose:

1. One numeric parameter — `sma(close, len)` — imports adjustable, overrides
   cleanly, re-translates to a new tree.
2. Two independent parameters — `ema(sma(close, len1), len2)` — each has its
   own binding id and can be changed independently without disturbing the
   other.
3. One parameter used in multiple safe locations — e.g.
   `sma(close, len) - sma(close, len)[5]` — a single `let __uct_param_1`
   substituted at both use-sites, changing once updates both.
4. An offset/window case where static-literal guarantees matter —
   `close[len]` with `len` adjustable — proving `_no_offset`'s "the offset is
   a constant, true by construction" guarantee survives a parameter change
   (the substituted value is still a literal by the time `_no_offset`'s parse-
   time checks run, because let-inlining happens before parsing).
5. Manual editing of the generated `let` binding's value — proves §2/§4's
   "manual edit and UI edit are the same operation" claim end-to-end, not just
   in prose.
6. A deleted/renamed binding — proves the `let:undefined`/`let:shadow` guards
   and the detachment path in §4's table actually fire as described, not just
   as reasoned.
7. A parameter change that increases lookback (e.g. RSI length 14 → 50) —
   proves `maxLookback` re-runs and the resulting tree's declared window
   actually reflects the new value.
8. A parameter change that crosses the node/lookback/domain budget — proves
   the save is refused with the SAME message a hand-edited source change
   busting the same budget would produce (V2 §5's own stated requirement).
9. Alert re-proof after a parameter change — proves `alert_user_series.
   forget()` actually fires on this path and a subsequently-evaluated alert
   re-enters the full cross-lane admission chain rather than serving a
   pre-change cached value (V2 §6.2's traced claim, now proven live).
10. Scanner `def_hash` changes and old-hash results are not served — proves a
    parameter-changed definition's next scan cycle produces rows under a NEW
    hash and that nothing anywhere reads the OLD hash's rows as if they still
    describe the current parameter value (V2 §6.3's traced claim, now proven
    live).

**Only if the spike preserves all ten does broad implementation proceed.** A
failure at any of these is new architectural evidence this ADR has not yet
accounted for, and the ADR gets revised again before implementation continues
— not patched around during implementation itself.

---

**Next step:** owner review of V2 + this delta together. Per DEC-006, no broad
implementation of the parameter mapping proceeds until both are accepted (or
revised) and the ten-point spike in §6 above has actually run.

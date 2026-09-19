# ADR v2: Pine input-parameter fidelity — the raw-source conflict resolved

**Status:** 🟡 **APPROVED IN PRINCIPLE, PARTIALLY SUPERSEDED 2026-09-05 by
owner/ChatGPT review — see `TRACK_F_PARAMETER_ADR_V2_1.md`.** The core direction
below (no raw source persisted, `compute.source` reused, closed/literal AST,
input.int/input.float only, reject-not-clamp, §6's traced reference-model safety)
is APPROVED. **One design gap remained: §3.1 below still described a separate
"override blob" as a second place a parameter's current value could live,
alongside the `let`-bound value inside `compute.source`.** V2.1 closes that gap —
`compute.source` alone is authoritative for current value; there is no override
blob. Read V2.1 alongside this document; it is a delta, not a rewrite, and does
not repeat what's still correct here.

**Date:** 2026-09-05 · **Phase:** One (Trust Foundation), Track F · **Governing
decision:** `DECISIONS.md` DEC-006 · **Originating defect:** RISK-013.
**What changed since v1:** the raw-source-persistence conflict is resolved (§3),
v1 scope is narrowed further (§4), reject-not-clamp is now a firm recommendation
with tests specified (§5), and §6 replaces v1's "trace this at implementation
time" caveats with direct, cited verification of the actual persistence/reference
model — performed for this revision, not deferred.

---

## 1. What v1 already got right (unchanged, restated briefly)

- The canonical AST stays exactly as closed and literal as it is today — no ninth
  node type, no symbolic runtime value. `_no_offset`'s "the offset is a constant...
  true BY CONSTRUCTION" guarantee is untouched.
- A parameter change is a NEW translation producing a NEW tree with a NEW
  `astHash` — never a mutation of a persisted node. The whole existing
  translate-then-analyze pipeline (fold → canonicalize → `maxLookback` → domain
  checks → repaint lint) runs again, unmodified, because it cannot tell "the
  member edited the source" from "the member changed an exposed parameter."
- `declaredInputNames`'s half-applied-control refusal is preserved exactly, not
  reimplemented.
- Unsupported/frozen inputs are disclosed with a specific reason, never silently
  dropped (RISK-013's own shape, applied to fidelity rather than correctness).
- v1 scope starts narrow: `input.int`/`input.float` only.

None of that is revisited here. What follows replaces v1's §3.10 (persistence) and
sharpens §3.1 (scope) and §3.9 (out-of-range handling) — the three places owner
review found a real gap.

## 2. The conflict, stated plainly

v1's §3.10 said the parameter-override design needs "the original Pine source
text" persisted, "because 'changing a parameter' means re-translating the source
with a different override, and the source is the only thing that can be
re-translated." That sentence quietly reopens a Phase Zero architectural decision:

> `CURRENT_ARCHITECTURE.md`, line 44: "— persisted verbatim; **raw source text is
> transient, never saved** —"

v1 flagged this as an "open question for implementation" rather than as what it
actually is: a proposal to reverse a stated architectural boundary, inside a
document whose whole premise is that boundary stays put unless a NEW,
explicitly-reviewed decision says otherwise. That is the defect this revision
fixes — not by finding a clever way to justify persisting raw source, but by
establishing that **the premise was wrong**: re-translation does not actually
require the original vendor script, because of an artifact this codebase already
persists for an unrelated reason.

## 3. The resolution: `compute.source` already exists, and it isn't raw Pine

Verified directly for this revision (not assumed): `api/services/
user_definitions.py`'s `_SCHEMA` for the `user_definitions` table has no "source"
column at all — the `definition` column is the only text, and it is the canonical
JSON blob (tree + metadata). But `validate_v2()` (lines 718-746) *requires*
`compute.sources[k]` for every tree in a saved definition, with the reason stated
in its own words: **"a tree with no text is a formula no author can ever
reopen."** This is confirmed live, not theoretical — `BuilderSheet.letScope.
test.jsx` sets `compute.source = 'let span = 5\nsma(close, span)'`, and
`editor/PreviewPane.test.jsx` builds a preview from `draft('sma(close, 20)')`.

**`compute.source` is UCT's own closed-vocabulary DSL text — the same text a
member already sees and can hand-edit in `BuilderSheet`'s text editor for every
existing saved definition today.** It is not the pasted Pine/thinkScript/PCF
script. It has been a first-class, persisted, round-tripped part of a saved
definition all along, with no ADR needed, because "reopen this formula as text"
is exactly what it already powers. **"Raw source is transient, never persisted"
was always specifically about the original vendor script — Pine, thinkScript, or
PCF text — and remains true, untouched, under everything below.**

This changes the persistence question from "do we reopen a closed architectural
decision" to "can the already-open, already-persisted UCT-DSL text serve as the
re-translation substrate instead of the vendor script." It can, with one
addition described next.

### 3.1 The recommended mechanism: named `let`-binding parameterization

`compute.source` already supports named local bindings — `let span = 5` is a real,
tested construct (`BuilderSheet.letScope.test.jsx`). Today, when the Pine
translator folds `input.int(14)` to its default, it inlines the literal `14`
directly at every use site inside the generated UCT-DSL text (per v1 §1's own
citation: "folding an input... freezes its default"). **The proposed change**:
for an input that is adjustable-eligible (§4 below — numeric, passes the
half-applied-control check), the translator instead emits ONE `let <pine-name> =
<value>` binding at the top of the generated `compute.source`, and every use site
references that name instead of the inlined literal. A non-adjustable input still
folds to an inlined literal exactly as today — this only changes behavior for the
narrow class of inputs this ADR is making adjustable at all.

**What gets persisted, and what does not:**

| Persisted (existing artifact, unchanged mechanism) | NOT persisted |
|---|---|
| `compute.source` / `compute.sources[k]` — UCT-DSL text, now containing a `let <name> = <value>` line per adjustable parameter instead of an inlined literal | The original pasted Pine/thinkScript/PCF script |
| A small parameter manifest (source name, title, default, min/max/step/options, frozen-or-not + reason) — extracted once at import, never executable | Any raw vendor syntax, any translator-internal state |
| An override blob (parameter name → member's current value) — a flat key-value map | — |

**On a parameter change:** parse `compute.source` with the **existing UCT-DSL
parser** (the same one `BuilderSheet`'s text editor already round-trips through
today for every manual edit — no new parser, no Pine involved at this step),
locate the `let <name> = ...` line by name (a single, unambiguous, human-legible
location — not a structural node-locator that has to be invented, and not a text
search-and-replace on a value that might repeat elsewhere in the formula), replace
its value with the override or the default, then re-run the ordinary
translate-then-analyze pipeline on the resulting tree. This produces a new
canonical tree and a new `astHash` through the exact same path a member hand-
editing that `let` line in the text editor would already produce today.

**Why a `let` binding beats a bare node-locator scheme.** The alternative
considered — recording which specific AST node(s) a parameter's value folded into
and patching them directly — works, but requires inventing and maintaining a
locator concept (and handling the case where one parameter's value legitimately
feeds multiple use sites, e.g. `sma(close, len) - sma(close, len)[5]`, both
uses being window arguments and therefore not the half-applied-control violation
that would refuse the script). A `let` binding sidesteps this entirely: the
parameter has exactly ONE textual definition site regardless of how many times
it's referenced, because that is what a `let` binding already means in this
DSL. The reference sites don't need tracking at all — they're just names, and the
existing UCT-DSL parser already resolves them.

### 3.2 What this is NOT proving yet — flagged for implementation, not assumed here

`BuilderSheet.letScope.test.jsx` confirms `let` bindings are a real, tested UCT-
DSL construct; it does not, on its own, prove every scenario this design needs
(a `let`-bound name referenced inside a nested nested/composed expression, a
parameter used inside a `recurrence` body, interaction with the DSL's own scope-
shadowing rules) already works exactly as required. **Implementation's first task
is a direct test of the `let`-emission path against a handful of the ADR's own
target scripts (a simple `sma(close, len)`, a composed `ema(sma(close,len1),
len2)` with two independent parameters, and a parameter reused twice like the
example above) before broader work proceeds** — this ADR recommends the
direction with real, cited grounding for why it should work, not a claim that it
has already been proven end-to-end.

## 4. v1 scope, narrowed further (per owner instruction)

v1 already excluded `input.bool`, `input.timeframe`/`input.symbol`/`input.time`,
`input.color`, and `input.source` from v1, deferred-and-disclosed. v1 kept ONE
carve-out worth removing: **§3.8 allowed `input.string` when "used as a plain
literal elsewhere (e.g., concatenated into a label)."** Verified for this
revision: a plain-literal `input.string` has no execution-semantic value in the
current canonical product — string concatenation for a label is a presentation
concern with no consumer in `closedTable.json`'s 64-function manifest (no function
takes a free string argument that isn't a role-typed enum/kind slot). Keeping that
carve-out would have created exactly the "special-case niche" the owner flagged:
a rule with a real-sounding justification but a genuinely thin, unmeasured use
case.

**v1 for this Track is exactly `input.int` and `input.float`, used as plain
numeric literals, full stop.** `input.string` is deferred in its entirety,
disclosed with the same mechanism as every other frozen type (§3.9 of the
original ADR, unchanged) — not carved into a partial-support case. If a real,
measured member need for adjustable string labels surfaces later, it is a new
ADR, informed by actual demand rather than "this looked easy."

## 5. Out-of-range overrides: REJECT, never clamp

**Recommendation, firm:** an override value outside a script-declared `minval`/
`maxval` (§3.6 of the original ADR — this engine never invents a bound where Pine
declared none, but enforces exactly what Pine DID declare) is **rejected** by the
authoritative validation layer, with the same specific-reason disclosure idiom
(`PineRefusal`) used throughout this translator. The UI may prevent invalid entry
where it can (a slider clamped to `[min, max]` is good UX), but **the server-side
save path is the authority, and it never silently substitutes a different value
than what the member asked for.**

**Why reject, not clamp, stated for the record (the owner's own reasoning,
confirmed correct against this program's standing principles):** a member who
types `500` into a `maxval=200` field and gets `200` saved without being told is
executing a DIFFERENT formula than the one they believe they configured — this is
the exact "silent wrong answer" shape `CL-004` ranks worse than a correct refusal,
applied to a member's own explicit input rather than to translated vendor
semantics. Clamping is not a smaller version of the fidelity failure this whole
ADR exists to fix; it's the same failure, self-inflicted by the product instead
of by an untranslatable vendor script.

**Tests required before implementation ships** (added to the original ADR's §8
list, not replacing it):
- An override strictly above `maxval` is rejected; the save does not proceed, the
  prior value (default or last valid override) is retained, and the refusal names
  the bound (`"len must be <= 200, got 500"`), not a generic error.
- An override strictly below `minval` is rejected, symmetrically.
- An override exactly AT `minval`/`maxval` is accepted (the boundary is inclusive,
  proving this isn't accidentally an off-by-one exclusive check).
- A script with no declared `minval`/`maxval` accepts any value this engine's own
  domain rules allow (e.g. a window argument still can't go negative, per
  `_functions_domain`) and rejects what they refuse — proving the "never invent a
  bound, always enforce this engine's own" split from §3.6 holds under the
  reject-path too, not just the accept-path.

## 6. Parameter identity / saved-artifact safety — traced, not assumed

The owner asked for this to be verified against the actual persistence/reference
model rather than inferred from "the astHash changes." Traced directly against
current code for this revision:

### 6.1 Definition identity is stable across an edit — and edits already ship today

`def_id` (`u_<12 hex>`) is minted once and is the definition's **permanent
identity**. `PUT /{def_id}` (`api/routers/user_definitions.py`) → `save()`
(`api/services/user_definitions.py`) **appends a new version row under the same
`def_id`; it never mints a new one.** Two numbers move on a save: `version`
(presentation, increments every save) and `rev` (increments **iff**
`ast_hash(compute.ast)` — or `trees_identity()` for a multi-tree document —
actually changed: `rev_bumped = (prev["ast_hash"] != new_hash or
trees_identity(...) != new_trees)`).

**This route already has a real product caller today, independent of this ADR**:
its own docstring states *"`BuilderSheet` opens a saved formula, and its Save
button routes here."* A parameter change, under §3's design, is one more caller
of this exact, already-shipped, already-tested path — not a new mechanism with
its own untested edge cases. `astHash` changing on a real edit, and what that
triggers downstream, is not a hypothesis this ADR is introducing; it is
observable behavior of a route members already use.

### 6.2 Alerts cannot serve a stale tree after a parameter change

Alerts reference a `def_id.plotKey` address (`api/services/alert_user_series.py`),
never a copy of the tree. `USER_FUNCS`, the in-memory per-process cache keyed on
`(user_id, address)`, is documented in its own module as **"a proof receipt, not
just a cached closure"** — an entry may only be written by `admit_user_definition`,
and only after the cross-lane proof (`_gate_cross_lane`, agreement to 1e-9 on real
bars) passes.

**`save()`'s own phase 4 calls `alert_user_series.forget(user_id)` on every
append** — not conditionally on `rev_bumped`, on every save — which drops that
user's cache entries and forces the alert lane back through the full admission
chain, cross-lane proof included, the next time an armed alert on that address is
evaluated. A parameter-change save, going through the same `save()` call, gets
this for free.

**This exact failure class was a real, historical, already-fixed bug** —
worth stating plainly because it is precisely the risk the owner is asking this
ADR to rule out. `user_value_function` used to re-cache a rebuild into
`USER_FUNCS` after a `forget()`, and that rebuild "was FALSIFIED BY THE EDIT
PATH" — a read-only prefill (never cross-lane-proven) could get cached as if it
were a real admission, letting a stale or unproven tree serve an armed alert.
Fixed: the rebuild is now unregistered rather than cached, and
`tests/test_user_definition_reproof.py` walks the module's AST asserting only ONE
function may ever write to `USER_FUNCS`. **Implementation must not introduce a
second write path to that cache for the parameter-change flow** — routing
parameter changes through the existing `save()` call, exactly as recommended,
inherits this guarantee for free; a bespoke "fast path" that skips `save()` to
avoid a full re-translation would not, and would risk reopening the exact bug
this file already paid to fix once.

The per-process nature of `USER_FUNCS` is a declared, accepted limitation, not a
gap this ADR needs to solve: a cache miss (redeploy, a second process) is safe by
design — *"a MISS is not a refusal: it is re-admitted, through the whole
chain."*

### 6.3 Scan eligibility recomputes automatically; no stale scan state is possible

`scan_evaluator.py` reads `user_definitions.live_definitions()` fresh **every
cycle** — there is no separate scan-side cache of a definition's tree to go
stale. `scan_hits`/`scan_coverage` rows are keyed by `def_hash` throughout
(`scan_store.record_hits(def_hash, tf_code, session, hits, ...)`), and are
explicitly member-independent, deduped by hash. A parameter change produces a
new `def_hash`; the next scan cycle simply computes a new set of rows under that
new hash. **The OLD hash's rows are not relabeled, reused, or served as if they
belonged to the new parameter value — they simply age out via the existing prune
job** (RISK-024, already fixed this phase, retention window still an open owner
decision but irrelevant to correctness here). No code path was found, in this
verification pass, that could serve an old-hash scan result under a new-hash's
identity.

### 6.4 Old saved definitions are unaffected — no migration surprise

A definition saved before parameter manifests exist has no manifest and no
override blob — behaviorally identical to a definition with every input frozen at
its Pine-declared default, which is exactly today's behavior for it. Nothing
about §3's design touches `compute.source`/`compute.ast`/`ast_hash` for a
definition that was never re-saved under the new mechanism; the `let`-binding
change to the translator's fold path only fires for a NEW import (or a re-save)
that goes through it. This is the same "additive, not a schema change" shape the
original ADR's §6/§7 already claimed — now grounded in the confirmed absence of
any separate scan-side or alert-side tree cache that could disagree with it.

## 7. Alternative C (raw source persistence) — evaluated in full, rejected

Per the owner's explicit request, even though §3 makes this unnecessary:

- **Why A/B (in this ADR's synthesized form) don't need it**: §3 shows
  re-translation only needs `compute.source` (already persisted, already a
  member-visible, already-tested artifact) plus a `let`-binding location, both of
  which are UCT-DSL constructs this codebase already owns end-to-end. Nothing
  about regenerating a parameterized tree requires the vendor's own syntax.
- **Security/privacy implications of C**: raw vendor scripts are the one input
  surface in this whole system explicitly NOT retained today, for a reason this
  ADR did not have to re-derive (the boundary already exists) but that clearly
  generalizes: a member's pasted script may embed anything — a comment with a
  broker account number, a strategy they consider proprietary, an accidentally-
  pasted credential from a different tool. Storing it turns telemetry-adjacent
  infrastructure into a durable copy of arbitrary member-authored text, exactly
  the shape Track C's own hardening this same session was built to prevent for a
  much smaller (200-char) surface.
- **Storage implications**: unlike `compute.source` (small, closed-vocabulary,
  bounded by the same node/lookback budgets as everything else this engine
  accepts), raw vendor source has no such bound — a member can paste an
  arbitrarily large script, and every historical version of it (if kept per
  save) compounds that with no existing size-governance mechanism in this table.
- **Migration implications**: would require a genuinely new column and a real
  schema migration, unlike §3's design, which needs no schema change beyond a
  small new JSON key or two inside the already-JSON `definition` blob.
- **Encryption / deletion / access control**: none of this is designed here,
  precisely because it doesn't need to be — there is no field to encrypt, no
  retention window to police, no access-control question to answer, because the
  artifact does not exist. Any of those becomes a real, separate design exercise
  the moment raw source persistence is proposed for an actual reason, and this
  ADR is not that reason.
- **Does this change DEC-002 or a prior product promise?** DEC-002 (preserve the
  no-standalone-scripting-language decision) is unrelated to source retention.
  No standing product promise about vendor-script confidentiality was found
  stated explicitly (the closest is `CURRENT_ARCHITECTURE.md`'s architectural
  line itself), which is exactly why this ADR treats reopening it as requiring
  explicit owner review rather than assuming silence means permission — and this
  revision's answer is that reopening it is not needed at all.

**Conclusion: Alternative C is not selected, and not on the table as a fallback
either — §3's mechanism fully satisfies the parameter-adjustability goal without
it.**

## 8. Everything else from the original ADR, unchanged

§3.1 (types, now narrowed per §4 above), §3.2–§3.5 (source name / title / default
/ current value), §3.7–§3.8 (step / enum), §3.11–§3.14 (UI data contract / static-
analysis re-run / execution-requirement recomputation / disclosure), §4
(alternatives — B is now understood as "solved via `let` bindings inside the
existing round-trip" rather than "a new node type," so the original §4's rejection
of a symbolic AST node stands even more clearly), §5 (risks, with §5's flagged
"input.source touches the closed vocabulary's series section" caveat unchanged),
§6/§7 (migration/reversibility, reaffirmed and grounded by §6 above), and §8's
test list (extended by §5's four new tests above) all carry over from the
original document without change. Read them there; they are not repeated here to
avoid the exact "two copies of one ruling drift" risk this codebase's own manifest
warns about repeatedly.

---

**Next step:** owner review of this revision. Per DEC-006, no broad implementation
of the parameter mapping proceeds until this is accepted or revised — including
the `let`-emission verification named in §3.2 as implementation's first task.

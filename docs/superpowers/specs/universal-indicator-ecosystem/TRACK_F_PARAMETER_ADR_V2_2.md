# ADR v2.2: Pine input-parameter fidelity — one logical parameter, immutable/derived split, server-trusted manifest, spike additions

**Status:** 🟡 **PROPOSED — design only, for owner review. No implementation
in this ADR or alongside it.** A further delta on `TRACK_F_PARAMETER_ADR_V2.md`
(approved in principle) and `TRACK_F_PARAMETER_ADR_V2_1.md` (§3's single-
locator binding-identity scheme is corrected here; everything else in V2/V2.1
— the closed/literal AST, `compute.source` reuse, `let`-binding mechanism,
reject-not-clamp, the traced def_id/alert/scan safety, the `__uct_param_<n>`
reserved-name scheme itself — is unchanged and not repeated).

**Date:** 2026-09-05 · **Phase:** One (Trust Foundation), Track F · **Governing
decision:** `DECISIONS.md` DEC-006.

---

## 1. One Pine input is one logical parameter — corrected from V2.1 §3

V2.1 said a parameter used in multiple `compute.sources[k]` trees "gets two
independent bindings, two independent ids." That is wrong for the reason the
owner states plainly: **it is one member decision** (`len = input.int(14)` in
the original script), and exposing it as two sliders that can silently diverge
is a fidelity regression V2.1 itself would have refused anywhere else in this
ADR.

**Corrected model:**

```
ONE logical parameter
    → ONE immutable identity/metadata record   (§2 below)
    → ONE current logical value
    → ONE OR MORE binding locators: {treeIndex, bindingId}
```

The manifest entry's key is the **logical parameter id** (still
`__uct_param_<n>`, sequential per definition, exactly as V2.1 §3 established —
that part is unchanged). What changes is that its `locators` field is now a
**list**, not a single `{treeIndex, bindingId}`: every tree whose translation
produced a `let` binding for this same original Pine input gets its own entry
in that list, all sharing one logical id, one title, one default, one set of
bounds.

**A slider edit is one atomic operation across every locator.** Changing the
logical parameter's current value means: for every locator in its list, write
the SAME new value into that tree's `let <bindingId> = <value>` line, then
re-run the translate-then-analyze pipeline for **every affected tree together**,
and save the whole multi-tree document as one `save()` call. There is no
partial state where some trees reflect the new value and others don't — the
save either succeeds for the whole document or none of it is persisted (this
is not a new invariant to build; it's `save()`'s existing per-call
atomicity, since `save()` already persists one `definition` blob covering
every tree in one write).

## 2. Required reconciliation behavior per the owner's four cases

- **All locators valid, all bindings hold the same value**: the logical
  parameter is **attached and adjustable**. This is the healthy, ordinary
  state — including immediately after a UI-driven change, since the write in
  §1 sets every locator to the same value by construction.

- **One binding deleted, renamed, or otherwise detached, others still fine**:
  **do not show a partially-working slider.** The whole logical parameter is
  marked **`partially_detached`** (a distinct derived state from a fully
  detached one — see §3) — non-adjustable until reconciled — while every
  tree's actual formula, valid or not, is preserved untouched. A member who
  removed the parameter from ONE plot but not another gets an honest "this
  control no longer applies everywhere it used to" disclosure, never a slider
  that quietly controls only some of what it used to.

- **Bindings manually edited to DIFFERENT values** (e.g. a member's text edit
  leaves `let __uct_param_1 = 14` in tree 0 but `let __uct_param_1 = 21` in
  tree 1): this is a **conflict**, marked **`conflicted`**. **No value is
  chosen silently** — not the first tree's, not the newest edit, not a
  majority vote. Every tree's formula is preserved exactly as the member left
  it (reconciliation still never writes to `compute.source` on its own
  initiative — V2.1 §4's governing constraint is unchanged and applies here
  without modification). The unified control is disabled and the conflict is
  disclosed by name ("this control's value disagrees across N/M trees — edit
  each tree directly, or use the control once it's reconciled"). No
  repository evidence found during this revision argues for a different,
  "safer" automatic resolution (e.g. picking the majority value) — an
  automatic pick is exactly the "never choose one value silently" case the
  owner ruled out, and this ADR agrees: silence about WHICH tree's value won
  is a worse failure than a temporarily-disabled control.

- **UI parameter edit is all-or-nothing across every binding locator**: if
  re-translating or re-analyzing ANY affected tree fails (a budget bust, a
  domain violation, an out-of-range rejection per V2 §5), **the entire
  parameter change is refused and NOTHING saves** — not the trees that would
  have succeeded. This is a direct consequence of §1's "one `save()` call for
  the whole document," not a separate rule to implement.

## 3. Immutable manifest vs. derived state — cleanly separated

V2.1 called the manifest "immutable" and then, in the same document, described
reconciliation as something that "updates the manifest's `adjustable: true/
false` + reason flags" — blurring exactly the line the owner is asking to be
drawn. Corrected:

**(A) Immutable, import-time parameter metadata — written once, never mutated:**
- logical parameter id (`__uct_param_<n>`)
- original Pine source name (for debugging) and title (for display)
- input type (`int` | `float`)
- original Pine-declared default
- declared min / max / step / options
- the locator list §1 establishes **at the moment each locator is first
  translated** — note this list CAN grow in one specific, honest sense: if a
  member's later edit adds a NEW tree that reintroduces the same original
  Pine input (rare, but possible in a multi-tree document), that is a NEW
  import event for that locator, not a mutation of an existing immutable
  record. The existing locators already established are never rewritten.

**(B) Derived reconciliation state — recomputed, never a second stored
authority:**
- `attached` | `detached` | `partially_detached` | `conflicted` | `non_literal`
- the specific disclosure reason
- **the current value itself** — read live from `compute.source`'s bindings,
  never cached as a fact about the parameter

**The rule the owner asked for, stated as an invariant rather than a
preference: there is exactly ONE source of truth for the executable current
value, and it is `compute.source`.** If a derived state (attached/detached/
current-value-for-display) is cached anywhere for UI responsiveness (e.g. so a
list of a member's saved definitions can show slider positions without
re-parsing every one on every page load), that cache is **explicitly
non-authoritative** and MUST be re-derived at the point of any save or any use
that matters (opening the definition for editing, evaluating an alert,
running a scan) — a cache read is a UI convenience, never a decision input.
This mirrors a pattern this codebase already trusts elsewhere: `USER_FUNCS`
(V2 §6.2) is exactly this shape — a cache that must never be treated as more
authoritative than a fresh re-derivation, and the historical bug V2 §6.2
already documents (a rebuild re-cached without re-proof) is precisely what
happens when that discipline slips. Do not repeat it here with a parameter-
state cache.

## 4. Protecting manifest immutability server-side — the bypass, verified and closed

**The question asked**: if the parameter manifest lives inside the same
client-submitted `definition` blob `PUT /{def_id}` accepts, can a crafted
request modify an EXISTING parameter's declared type/min/max/options/default/
frozen-classification/locators, and have `save()` validate the new source
against the *forged* manifest instead of the real one?

**Verified directly against `api/services/user_definitions.py::save()`,
not assumed**: `save(user_id, def_id, definition, limits=None)` already never
trusts the client for `def_id` itself — it is a function parameter bound from
the URL path, never read out of the submitted body. And `save()` already
loads the prior row before doing anything else: `prev = _newest(c, user_id,
def_id)`, used today to decide `rev_bumped`/`version`. **This is the exact
existing mechanism this protection extends — no new infrastructure.**

**The rule**: for any logical parameter id that exists in **`prev`'s stored
manifest** (i.e., this identity was already established by an earlier,
already-accepted save — not introduced in this request), `save()` uses
**`prev`'s own copy** of that parameter's immutable fields (§3(A)),
**regardless of what the client's submitted `definition` blob says for that
id.** The client-submitted manifest for an already-established identity is
read for exactly one purpose — matching it BACK to `prev`'s record by id — and
discarded otherwise. A crafted request that widens `max` for `__uct_param_1`
gets `save()` silently substituting the real, prior `max` before any bounds
check ever runs, so the bounds check that follows is checking the value
against the TRUE bound no matter what the request claimed the bound was.

**Only a genuinely NEW logical parameter id** — one absent from `prev`'s
manifest entirely (a first import, or a member's edit that introduces a new
`input.int`/`input.float` translated for the first time) — has its immutable
metadata taken from the client's submission, because there is no prior
trusted record to canonicalize from. **This trust boundary is stated
honestly, not hidden**: initial parameter metadata is necessarily produced by
the client-side Pine translator at first-import time, exactly as this
codebase already treats client-side Pine translation as authoritative for
every save (V2 §4's own words). What this ADR closes is the boundary AFTER
that point — an already-established parameter identity's immutable facts
cannot be silently rewritten by a later edit, ordinary or hostile.

**The engine's own domain constraints remain independently authoritative
regardless of any of this** — V2.1 §5's point stands unchanged: `_functions_
domain`-style checks run because the existing translate-then-analyze pipeline
always runs them, not because the parameter manifest says to. A vendor-
declared min/max is a fidelity/provenance constraint (what Pine said); the
engine's own domain rules are a correctness constraint (what this engine can
safely execute) and are never subordinate to the former.

**Regression tests required before implementation** (added to V2.1 §6's
spike list, see §5 below):
- A `PUT` that changes `__uct_param_1`'s declared `max` in the submitted
  manifest, alongside a `let __uct_param_1 = <value between the old and new
  max>` value that would be REJECTED under the true prior bound and ACCEPTED
  under the forged one — proves the true bound wins.
- A `PUT` that changes an existing parameter's declared type (`int` → `float`)
  or `frozen` classification — proves the prior classification is what's
  enforced, not the submitted one.
- A `PUT` that introduces a genuinely NEW logical parameter (absent from
  `prev`) — proves this honestly-necessary case still works and its metadata
  is taken from the submission, unlike the two cases above.

## 5. Spike gate — four additions to V2.1 §6's ten points

Keep V2.1's ten-point spike exactly as written; add:

11. **One original Pine numeric input feeding TWO `compute.sources[k]`
    trees** — proves one logical control changes both bindings atomically
    (§1), and that both trees' re-translated results are saved together in
    one `save()` call.
12. **Manual edit makes one of that parameter's multiple bindings
    disappear** — proves the logical parameter becomes `partially_detached`
    (§2), not a silently-still-working slider, while both trees' actual
    formulas (the one still bound and the one now without it) save exactly
    as the member left them.
13. **Manual edit makes the multiple bindings disagree** — proves
    `conflicted` state fires (§2), the control disables and discloses by
    name, and — critically — that NEITHER tree's value is silently preferred
    over the other anywhere in the save or read path.
14. **A crafted `PUT` attempts to change immutable parameter metadata** for
    an already-established logical parameter id — proves §4's protection:
    the server's canonicalized (prior, trusted) values are what get enforced,
    verified against at least the two crafted-request tests §4 names.

**Only if the spike preserves all fourteen does broad implementation
proceed** — V2.1 §6's closing rule is unchanged, just now counting to
fourteen instead of ten.

---

**Next step:** owner review of V2, V2.1, and this delta together. Per DEC-006,
no broad implementation of the parameter mapping proceeds until all three are
accepted (or revised) and the fourteen-point spike has actually run against
real code.

---
id: k-cp3-build-record
unit: K CP3
packet: packet-k-two-command-signing-gate
merges-after: K CP2
status: SIGNED (K CP3, fingerprint ba5e34e79)
---

# K CP3 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  ba5e34e79
SCOPE APPROVED:   CP3 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

⛔ **Why a separate document.** `packet-k-two-command-signing-gate.md` already carries one
unsigned block covering CP1 and CP2, and one block cannot hold two signatures. Its
fingerprint (`36179a330`) is also already published and settled; churning it to announce a
later checkpoint would invalidate a hash for reasons unrelated to what it signs.

⭐ **The precedent is B→V, not T/D3.** `packet-v-multi-volume-gate.md` adds CP4 to packet
B's roster *without editing packet B* — the relationship is recorded in the manifest
instead. That is exactly this case, so it is handled the same way.

---

## 1 · ⚠️ THIS WAS COMMISSIONED AS "K CP2". THAT NAME WAS ALREADY TAKEN.

The queue named this unit **K CP2 — machine-enforce merges-after in `merge_all.py`**.
Measured before building:

```
packet-k-two-command-signing-gate.md:58  CP1 | tools/sign_all.py + tools/sign_manifest.txt
packet-k-two-command-signing-gate.md:59  CP2 | tools/merge_all.py -- verify-signed, merge,
                                              push through the Layer-0 guard, wait for SUCCESS
```

**K CP2 is `merge_all.py` itself** — built, in the manifest at row 7, fingerprint
`36179a330`. The commissioned work is an enhancement *to* CP2, which makes it **CP3**.

⛔ **This is the SECOND id collision found in this one session** — packet E's `CP2` meant
*promote to a required check* while commit `e767a7aab` shipped as *"E CP2 — publish CI
results"*. Two collisions in two consecutive units is not coincidence: **checkpoint ids are
being assigned in the prompt that commissions the work, and verified against the packet only
if somebody thinks to look.** A signature names a checkpoint, so an id that means two things
is an unsignable signature.

⭐ **Cheap fix, stated as a rule: before writing a line, read the packet's own checkpoint
table and take the next free number.** Both collisions were found by a single `grep` against
the table, before any code — and both would have been invisible after the fact, because the
manifest row would have looked perfectly well-formed.

---

## 2 · What CP3 is

`UNITS` in `merge_all.py` is a hand-typed ordered list sitting beside
`tools/sign_manifest.txt`, which states the same order in prose. **A hand-typed enumeration
beside the source that owns it is this programme's oldest recurring defect** — the
writer-index `FOUR`, the COT router's *"4 routes"*, the setup catalog's *"24"*, the nav-tab
list. Until now the merge order was in that class: three English sentences in a manifest
header, and nothing that could fail if the list stopped matching them.

**CP3 makes the constraints machine-readable and checks them before any cherry-pick.**

- `tools/sign_manifest.txt` gains `#!after:` and `#!last:` directives. They begin with `#`,
  so the existing three-column parser in `verify_manifest.py` skips them untouched — the
  manifest stays one file with one authority.
- `merge_all.parse_constraints` reads them; `check_order` validates `UNITS` against them;
  `enforce_order` runs **before the first cherry-pick** and returns **exit 2** naming the
  offending pair. Checking afterwards would be a post-mortem, not a guard.
- The prose reasons stay in the header beside the directives. **The reason is for a human
  and the directive is for the machine; a disagreement between them is now a refusal rather
  than something a reader skims past.**

**Constraints currently declared (5):**

```
#!after: packet-d-nav-tabs-gate <- packet-c-instrument-and-claudemd-gate
#!after: packet-v-multi-volume-gate <- packet-b-schema-resolution-gate
#!after: e-cp2-build-record <- packet-e-ci-gap-gate
#!after: k-cp3-build-record <- packet-k-two-command-signing-gate
#!last: s2-accelerator-chord-pre-implementation-gate
```

---

## 3 · Controls — `python tools/merge_all.py --self-check`

```
the real manifest declares constraints (non-vacuity)     -> True      ok
CLEAN: the declared order satisfies every constraint     -> []        ok
B/V SWAPPED: refuses                                     -> True      ok
...and names both units in the message                   -> True      ok
F-S2-1 NOT LAST: refuses                                 -> True      ok
a constraint naming an unknown unit is REFUSED           -> True      ok
EMPTY constraint set: ZERO rows, no violations           -> []        ok
SELF-CHECK: PASS
```

Three of these are load-bearing in ways worth naming:

- ⛔ **Non-vacuity.** `enforce_order` **prints the number of constraints it read**, and the
  self-check asserts that number is non-zero against the real manifest. *"0 violations"* over
  0 constraints is not a pass, and printing the set size is the only thing that tells the two
  apart — the same rule as *a test run without a totals line is not a run*.
- ⛔ **A constraint naming an unknown unit is REFUSED, not skipped.** A typo in a stem would
  otherwise silently disable the very constraint it was meant to add, and the check would go
  green *because* it had been broken. A rail that cannot fire is refused.
- ⛔ **The violation message NAMES BOTH UNITS and both positions.** A bare
  *"order violation"* would send the reader back to diff two lists by hand, which is the
  work the check exists to remove.

**Mutation-proved:** the swap control is a real reordering of the declared list, not a
fixture — it permutes `UNITS`' own stems, so deleting the check makes it go green.

---

## 4 · What this does NOT do

⚠️ **`UNITS` and the manifest are still two lists.** CP3 checks that the manifest's
*constraints* hold over `UNITS`' *order*; it does not yet assert that the two files contain
the same set of units. They can still drift in membership — a unit present in one and absent
from the other — and today they do differ by design while row 12 is being added.

**Deriving `UNITS`' order from the manifest outright is the honest end state** and is
deliberately NOT done here: it changes what `merge_all.py` reads at merge time, and that is a
separate decision with its own approval line. Recorded as the next K checkpoint rather than
folded in silently.

---

## 5 · Files, and the one-unit-one-commit proof

```
tools/merge_all.py          (parse_constraints, check_order, enforce_order, --self-check)
tools/sign_manifest.txt     (#!after: / #!last: directives + the reasons beside them)
```

**Docs worktree only — nothing to merge into master**, so no commit on
`feat/s7-price-level` and no watch-coverage strand. `UNITS` carries an empty commit list for
this unit, exactly like packets B, V and K.

---

## 6 · Drafted ledger row — NOT written

| 79 | *(docs-only)* | 2026-09-15 | Process | 1 | K CP3: the merge order is enforced, not trusted. 5 constraints derived from the manifest's `#!after:`/`#!last:` directives, checked before the first cherry-pick, exit 2 naming the violating pair. Found and fixed a second checkpoint-id collision in one session (K CP2 was already `merge_all.py`). |

## 7 · Drafted RESUME delta — NOT applied

- Merge order is machine-checked. `python tools/merge_all.py --self-check` is the gate.
- ⛔ **Two checkpoint-id collisions in two consecutive units** (E CP2, K CP2). Read the
  packet's checkpoint table and take the next free number BEFORE writing anything.
- Open: `UNITS` and the manifest are still two lists that can differ in membership.

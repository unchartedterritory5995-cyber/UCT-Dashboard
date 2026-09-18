---
id: t-cp2-build-record
unit: T CP2
packet: packet-t-stale-test-gate
merges-after: F-S2-1 (s2-accelerator-chord-pre-implementation-gate)
status: UNSIGNED
---

# T CP2 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  21c37a3bc
SCOPE APPROVED:   T-CP2 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **T CP2 — the attribution fix that can only land after the file exists.** Scope is
> `76a3b98c2` **as enumerated by `git show --stat`**.

⛔ **Collision proof, three sources:** packet-t's declared checkpoints read
`['CP1', 'CP2', 'D3 CP2', 'T CP1']` in **prose** mode (the packet has no checkpoint table);
build records on disk for this packet: **only the packet itself**, no `t-cp*`; manifest rows
naming a T checkpoint: **one, `T-CP1`**. A repo-wide grep for `T-CP2` / `T CP2` / `t-cp2`
returns **zero hits**. **T CP2 free.**

---

## 1 · ⚠️ THE OWNER'S SPLIT IS DEGENERATE, AND THE MEASUREMENT SAYS SO

The instruction was to split `76a3b98c2` by file: hunks touching the F-S2-1-created file to a
new row, **all other hunks** to a commit keeping packet-t's row. Measured first:

```
git show --name-status --format= 76a3b98c2
  M  app/src/pages/ThemeTrackerPage.flagkey.test.jsx
path count: 1

files in 76a3b98c2 that are NOT the F-S2-1 file: 0
```

**There are no other hunks.** Commit A would be empty and commit B would be the whole
commit, so the split reduces to a **re-attribution**: the commit moves, whole, to this row.

⭐ **This is the cheaper answer and the safer one.** It needs no history rewrite of
`feat/s7-price-level`, no `--force-with-lease`, and the commit universe stays **46** rather
than growing to 47. A rebase that produces a byte-identical tree is still a rebase, and the
branch is the one this programme's CI runs against.

## 2 · Why the commit cannot merge with packet-t

```
0ef787268  CREATES app/src/pages/ThemeTrackerPage.flagkey.test.jsx   (F-S2-1)
76a3b98c2  MODIFIES that same file, and nothing else                 (was packet-t's)
origin/master: the file is ABSENT   (git cat-file -e -> miss; positive control on
               app/src/pages/ThemeTrackerPage.jsx -> hit, so the probe can say yes)
```

Cherry-picked in packet-t's old position the pick fails **modify/delete** — the file does not
exist yet. It exists only after F-S2-1, which the manifest merges last. **F-SIGN-5.**

## 3 · The file set, derived

```
app/src/pages/ThemeTrackerPage.flagkey.test.jsx    member-visible = False
member-visible files in this unit: 0
control — member-visible files in 0ef787268 (F-S2-1): 3   <- the predicate can say yes
```

**Member-visible** is derived, not declared: a path under `app/src/` that is not a test,
spec, `__tests__/` member or story. This unit is a **test file only**, which is what makes it
legal after `#!last:` under the redefined semantics.

## 4 · `#!last:` REDEFINED — and the old meaning struck

Old: *"nothing may be ordered after it."* That made F-SIGN-5 unresolvable by construction —
the only place this commit can go is after F-S2-1.

**New (2026-09-16):** *`#!last:` marks the last **member-visible** unit, alone in its
sitting. Rows after it must carry zero member-visible files, derived from their file set.*

⛔ The member-visible unit still merges alone and still needs `--include-member-visible`.
What changed is that a **tests-only** row may follow it — and `merge_all` now enforces the
derivation rather than the ordinal.

## 5 · Files

```
76a3b98c2   app/src/pages/ThemeTrackerPage.flagkey.test.jsx   (9 insertions, 4 deletions)
```

## 6 · Validators

```
verify_manifest --check-commits   46 of 46, exit 0 (universe unchanged — no rewrite)
merge_all --self-check            UNITS vs manifest, both directions
merge_all --dry-run               the REPLAY (K CP9), CLEAN
drift control                     (50, 50)
```

## 7 · Drafted ledger row — NOT written

| 116 | *(named in the session report)* | 2026-09-16 | SIGNING | 1 | T CP2: `76a3b98c2` modifies a file that F-S2-1's `0ef787268` creates, so it could never merge in packet-t's position — the pick fails modify/delete, and the file is absent on master. The owner's by-file split is degenerate (the commit touches exactly one file, and it is that file), so the commit is re-attributed whole to this row, which merges after F-S2-1. `#!last:` is redefined from "nothing may follow" to "last MEMBER-VISIBLE unit, alone in its sitting", with rows after it required to carry zero member-visible files — derived, not declared. |

## 8 · Drafted RESUME delta — NOT applied

- ⛔ **Measure the split before planning it.** A by-file split of a one-file commit is a
  re-attribution, and doing it as a rebase would have rewritten a branch for nothing.
- ⛔ **An ordinal is not a property.** `#!last:` meant "row 49"; what was wanted was "no
  member-visible change lands after this one". Derive the property and enforce that.
- ⭐ **A test that edits another unit's test file belongs after that unit**, and saying so is
  cheaper than making the file exist earlier.

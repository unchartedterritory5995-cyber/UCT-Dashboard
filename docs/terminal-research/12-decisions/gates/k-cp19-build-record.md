---
id: k-cp19-build-record
unit: K CP19
packet: packet-k-two-command-signing-gate
merges-after: K CP17
status: UNSIGNED
---

# K CP19 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-18
APPROVED AT SHA:  ce5f54e14
SCOPE APPROVED:   CP19 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **K CP19 — `_resolution_landed`'s base ref is a PARAMETER, and `replay()` consults it
> too.** Scope is `tools/merge_all.py` **as enumerated by `git show --stat` of this unit's
> commit.**

⛔ **Collision proof:** build records top out at k-cp17 (this session, K CP18 reserved by the
owner for the merge lock); manifest rows top out at CP17. **CP19 free** — numbered after the
lock though built before it, same as CP14/CP15/CP13's non-sequential numbering earlier this
session: collision proof is the authority, not build order.

---

## 1 · F-RESOLVED-1's second half, found minutes after the first

K CP17 fixed `merged_into_master` and `sitting_verify.merged_state` to consult
`_resolution_landed` when `git cherry` reports a resolution-bearing row as not-merged.
**`replay()` has its OWN, separate skip-check** (`_cherry_says_merged`, K CP13) — and the
first version of `_resolution_landed` was never wired into it. Re-running `--dry-run` to
confirm K CP17 (a matter of course, not a hunch) immediately reproduced the strand:

```
[merge-all] ⛔ STRAND-UNRESOLVED at #41  e-cp28-build-record  304ac481c
              pre-images differ — master f4193ea6a335 recorded vs ca74b3c5bfa2 actual
```

Wiring `_resolution_landed` into `replay()`'s skip-check exposed a SECOND, sharper bug: the
function hardcoded `"origin/master"` as the base ref to read blobs from. That is correct for
`merged_into_master` (which always runs against the real `CODE_REPO`) and **wrong inside
`replay()`'s throwaway clone** — the exact F-SIGN-16 trap this whole file was built around:
`origin/master` INSIDE a clone resolves to the clone's own origin (the source repo's LOCAL
branch), not the `resolved` sha `replay()` explicitly checks out to avoid exactly this
confusion. With the string hardcoded, `replay()` kept stranding even after being wired to
call the (correct in principle) function.

## 2 · The fix

`_resolution_landed(stem, sha, repo, resolutions, base_rev="origin/master")` — `base_rev` is
now a parameter, defaulting to the string that is correct for its ORIGINAL caller
(`merged_into_master`) but overridable by any caller for whom `origin/master` does not mean
what it says. `replay()`'s call site passes `resolved` — the SAME pinned sha it already
resolved in the source repo and checked out, per F-SIGN-16's original fix.

## 3 · Controls

```
the real e-cp28 strand, reproduced by running --dry-run again (not assumed fixed)  ok
after wiring in _resolution_landed with the DEFAULT string          -> still strands  caught
after passing `resolved` explicitly                                  -> CLEAN         fixed

fixture (K CP16's box4, reused): the resolution landed on "master" ->
  _resolution_landed(..., base_rev="master")     -> True                             ok
  _resolution_landed(..., base_rev="unit-base")  -> False (proves base_rev is READ,
                                                    not decorative — "unit-base" never
                                                    received the resolution)          ok
```

⚰️ **A THIRD bug in the same self-check fixture, caught by running it**: `fake_resolution`'s
dict never carried a `"resolved blob"` key at all (only `"_blob_path"`, the raw bytes) —
`_resolution_landed` needs the HASH, which `read_resolutions()` normally computes and
verifies at parse time. `KeyError: 'resolved blob'` on the very first run of the new control.
Fixed by hashing the fixture's own content the same way the real parser does.

## 4 · Files

```
tools/merge_all.py   _resolution_landed (base_rev parameter, was hardcoded), replay()
                     (calls it with `resolved`, the pinned base, not the bare string)
```

## 5 · Validators

```
ast.parse                     OK
merge_all.py --self-check     PASS (all prior controls + the two new ones)
merge_all.py --dry-run (real manifest, --until k-cp17-build-record)   exit 0, CLEAN
```

## 6 · Drafted ledger row — NOT written

| — | *(docs-worktree only — see UNITS)* | 2026-09-18 | SIGNING | 1 | K CP19: `_resolution_landed` (K CP17) hardcoded `"origin/master"`, which is wrong inside `replay()`'s throwaway clone — the exact F-SIGN-16 confusion this file was built to avoid. Wiring the fix into `replay()`'s own skip-check reproduced the strand it was meant to close; parametrizing the base ref and passing `replay()`'s pinned `resolved` sha closed it for real, confirmed by re-running `--dry-run`, not by assuming the first fix was complete. |

## 7 · Drafted RESUME delta — NOT applied

- ⛔⛔ **Fixing a defect in ONE caller of a shared function does not fix it in every
  caller** — this looks like K CP16 restated, and it is: a hardcoded assumption
  (`"origin/master"` means the real base) is exactly as dangerous as a second copy of the
  logic, because it fails identically wherever the assumption doesn't hold.
- ⭐ **The check that this fix actually works is re-running the thing that broke, not
  reading the diff.** K CP17's own self-check passed with the hardcoded string, because its
  fixtures never exercised `replay()`'s clone context — only re-running `--dry-run` against
  the real manifest surfaced it.

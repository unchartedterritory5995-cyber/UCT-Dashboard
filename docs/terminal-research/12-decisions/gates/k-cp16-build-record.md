---
id: k-cp16-build-record
unit: K CP16
packet: packet-k-two-command-signing-gate
merges-after: K CP13
status: UNSIGNED
---

# K CP16 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **K CP16 — the REAL merge loop applies recorded resolutions; only the PREVIEW ever did.**
> Scope is `tools/merge_all.py` **as enumerated by `git show --stat` of this unit's commit.**

⛔ **Collision proof:** K's packet table declares CP1–CP2; build records top out at k-cp15
(this session, K CP13 built after it); manifest rows top out at CP15/CP13. **CP16 free.**

---

## 1 · ⛔⛔ F-STRAND-1 — THE PREVIEW AND THE RUN IT PREVIEWS DID NOT SHARE A CHERRY-PICKER

`replay()` — the function `--dry-run` calls — has ALWAYS applied recorded resolutions (K
CP11) on a conflict. `main()`'s REAL per-unit cherry-pick loop never did:

```python
for c in commits:
    rc, out = run(["git", "cherry-pick", c], CODE_REPO, a.dry_run)
    if rc != 0:
        print("cherry-pick failed"); return FAIL
```

**Measured live, 2026-09-17, on the production merge checkout.** After K CP13/14/15
landed and 32 units of a real `--batch` run cherry-picked cleanly, the 33rd
(`e-cp28-build-record`, `304ac481c`) hit `tests/conftest.py` — the EXACT file this
programme's one recorded resolution exists for — and stranded with a raw git conflict,
mid-cherry-pick, on `_merge-master`:

```
CONFLICT (content): Merge conflict in tests/conftest.py
error: could not apply 304ac481c...
```

⛔ **Every `--dry-run` this entire programme has ever run reported CLEAN through this exact
row**, because `replay()` silently absorbed the conflict with its resolution every time. The
first REAL attempt to merge past it found the gap `--dry-run` was structurally unable to
show — the two functions cherry-picked differently, and only one of them was ever exercised
by a preview.

## 2 · The fix

`_pick_with_resolution(sha, stem, repo, resolutions, base_rev)` — ONE implementation, now
used by BOTH `replay()` and `main()`'s real loop. On a conflict it looks up a recorded
resolution for every conflicting file (K CP11's exact mechanism, unchanged) and applies it if
ALL match; otherwise it aborts cleanly and returns STRAND/STRAND-UNRESOLVED. `main()` loads
`read_resolutions()` once (refusing on `REFUSED-CORRUPT-RESOLUTION`, matching `replay()`) and
calls this shared function for every real pick, gated so **dry-run still never mutates
anything** (it takes the old print-only path, unchanged).

**Immediate operational consequence, corrected in the field:** `_merge-master` was left
mid-cherry-pick after the strand. `git cherry-pick --abort` returned it to a clean state at
the tip of the 32 cleanly-picked commits (nothing pushed, nothing lost — those 32 commits are
fully reproducible by re-running `merge_all` from a fresh `origin/master` checkout, since it
re-derives everything from `UNITS`, never from local state).

## 3 · Controls

```
THE REAL CONFLICT, reproduced in an isolated throwaway clone (never touching production):
  pick every unit through e-cp27 cleanly, then e-cp28 with the fix     -> applied, worktree
  clean, resolution file named (e-cp28-build-record--tests-conftest-py.md)          ok

Fixture (two branches forced to conflict on the same line, one commit each):
  NO recorded resolution  -> STRAND, cherry-pick aborted, worktree clean            ok
  A matching resolution   -> applied cleanly, (ok, 1 file) returned                 ok
  replay() and main() now call the SAME function (grep-verified, no second copy)    ok
```

⚰️ **The fixture's own first version had a bug, caught by running it.** "Unit pre-image" is
the blob at the unit's OWN commit (what it carries into the conflict), not its parent's
content — the first draft computed it from the pre-change parent branch and the fixture
read `(False, 0)` on a case that should apply cleanly.

## 4 · Files

```
tools/merge_all.py   _pick_with_resolution (new, shared), replay() (refactored onto it),
                     main() (loads resolutions once, real loop calls it, dry-run unchanged)
```

## 5 · Validators

```
ast.parse                     OK
merge_all.py --self-check     PASS (all prior controls + the two new F-STRAND-1 ones)
```

## 6 · Drafted ledger row — NOT written

| — | *(docs-worktree only — see UNITS)* | 2026-09-17 | SIGNING | 1 | K CP16: `main()`'s real per-unit cherry-pick loop never consulted the K CP11 recorded-resolution mechanism — only `replay()` (the preview) did. Every `--dry-run` reported CLEAN through the one row with a recorded resolution because ONLY the preview applied it; the first real merge attempt to reach that row stranded on the raw conflict, mid-cherry-pick, on the production merge checkout. Fixed by sharing ONE cherry-picking implementation between the preview and the real run. |

## 7 · Drafted RESUME delta — NOT applied

- ⛔⛔ **A preview that does not call the same code as the run it previews is not a preview
  of that run — it is a preview of a DIFFERENT, better-behaved program that happens to share
  a name.** This is the same shape as F-DEPLOY-1 (`--dry-run` returning before the call that
  crashed) and F-RESUME-1 (`--dry-run` never consulting merged state) — a THIRD instance,
  this session, of the dry-run/real-run divergence class.
- ⭐ **When two code paths do the same conceptual thing, that is the signal to share the
  function, not to keep them "in sync" by hand.** Every one of these three defects existed
  because someone (a past session, or this one) trusted that a fix made in one place had
  reached its sibling.

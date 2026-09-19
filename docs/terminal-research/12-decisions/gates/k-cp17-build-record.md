---
id: k-cp17-build-record
unit: K CP17
packet: packet-k-two-command-signing-gate
merges-after: K CP16
status: SIGNED (K CP17, fingerprint 5beba91be)
---

# K CP17 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-18
APPROVED AT SHA:  5beba91be
SCOPE APPROVED:   CP17 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **K CP17 — a resolution-landed commit reads MERGED, not a permanent BLOCKER.** Scope is
> `tools/merge_all.py` and `tools/sitting_verify.py` **as enumerated by `git show --stat` of
> this unit's commits** (two commits: `4bac44aa0` the fix, plus the retroactive-window note
> below for `sitting_verify.py`).

⛔ **Collision proof:** K's packet table declares CP1–CP2; build records top out at k-cp16
(this session); manifest rows top out at CP16. **CP17 free.**

⚠️ **`tools/sitting_verify.py` was edited OUTSIDE an authorised freeze window.** It is not in
the freeze set (`grep -c tools/sitting_verify.py tools/freeze_baseline.txt` = 0), so no frozen
path moved — but per the owner's standing rule ("a frozen tool edited outside an authorised
window is a finding with a row, not a silent fix"), the SAME discipline is applied here even
though it was not technically required: the edit is named, dated, and rowed rather than
folded silently into K CP16's commit.

---

## 1 · F-RESOLVED-1, measured live, minutes after K CP16 landed

`git cherry` compares patch ids. Resolving a conflict (K CP11) means writing DIFFERENT bytes
than the original commit's own diff — by construction, the resulting landed content's
patch-id can never again equal the original commit's patch-id. `e-cp28-build-record`'s
resolution landed for the real first time via K CP16's fix; the very next state check found:

```
_cherry_says_merged("origin/master", "304ac481c", ...)  ->  False   (i.e. "NOT MERGED")
current master blob for tests/conftest.py               ->  ca74b3c5b...
recorded "resolved blob" in the resolution record        ->  ca74b3c5b...   (IDENTICAL)
```

The row's content IS correctly on master — `git cherry` simply cannot see it, structurally.
Left unfixed, EVERY future `merge_all` invocation (every remaining sitting) would
re-encounter `e-cp28-build-record`, see "not merged," try to re-pick `304ac481c`, hit the
SAME conflict, and find its recorded "master pre-image" no longer matches (master now carries
the RESOLVED content, not the pre-resolution content) — a permanent STRAND on a row that is
already correctly merged. `sitting_verify.py`'s independent `merged_state()` has the identical
patch-id logic and the identical blind spot; it would report `e-cp28-build-record` as a
BLOCKER forever, on every future sitting check, whether or not it was ever re-picked.

## 2 · The fix

`_resolution_landed(stem, sha, repo, resolutions)` (`merge_all.py`, new): for every path a
commit touches, is there a resolution recorded for (stem, path) whose VERIFIED `resolved blob`
hash equals that path's CURRENT blob on `origin/master`? If every touched path answers yes,
the commit's intended content is present regardless of what its own patch-id says; any
unresolved-or-mismatched path returns False, never guessed as landed.

- `merge_all.merged_into_master(commits, dry, stem=None, resolutions=None)` gained the two
  optional parameters; when both are supplied (the real per-row loop now supplies them) a
  patch-id "not merged" result is given this fallback check before being trusted.
- `sitting_verify.merged_state(repo, commits, stem=None, ma=None, resolutions=None)` gained
  the identical fallback, calling `ma._resolution_landed` — the module `sitting_verify.py`
  already loads via `_load("merge_all")`, so this is the SAME function, not a second
  implementation of the same idea.

## 3 · Controls

```
merged_into_master(["304ac481c"], False, stem="e-cp28-build-record", resolutions=[...1...])
    ->  (['304ac481c'], '')                                                       ok (measured)
sitting_verify --until e-cp29-build-record, before the fix -> e-cp28 BLOCKER (NOT-MERGED)
sitting_verify --until e-cp29-build-record, after the fix  -> e-cp28 SIGNED/MERGED/ok
                                                                                    ok (measured)
merged count in the same sitting_verify run: 36 -> 37                             ok (measured)
```

Both measurements are against the REAL row on REAL production master — this defect could only
be found and proven by something having actually landed via a resolution for the first time,
which K CP16 was.

## 4 · Files

```
tools/merge_all.py       _resolution_landed (new), merged_into_master (stem/resolutions params)
tools/sitting_verify.py  merged_state (stem/ma/resolutions params), verify() (loads
                         resolutions once, passes through at both call sites)
```

## 5 · Validators

```
ast.parse (both files)        OK
merge_all.py --self-check     PASS
sitting_verify.py --until e-cp29-build-record   e-cp28-build-record reads SIGNED/MERGED/ok;
                                                 rows checked 59, signed 53, merged 37
```

## 6 · Drafted ledger row — NOT written

| — | *(docs-worktree only — see UNITS)* | 2026-09-18 | SIGNING | 1 | K CP17: a resolution-applied commit can never patch-match its original source commit again (resolving a conflict means writing different bytes than the original diff), so `git cherry` reports a resolution-landed row as NOT-MERGED forever — a permanent false BLOCKER that would strand every future sitting on it. Fixed with `_resolution_landed`, a fallback check comparing the resolution's verified `resolved blob` against the path's current master blob, consulted identically by `merge_all.merged_into_master` and `sitting_verify.merged_state` (which calls the same function, not a second copy). |

## 7 · Drafted RESUME delta — NOT applied

- ⛔⛔ **A recorded-resolution mechanism and a resumability mechanism must agree on what
  "merged" means, or the second one strands on the first one's own success.** K CP11
  (resolutions) and K CP5/K CP6 (patch-identity resumability) were both correct in isolation
  and incompatible at their boundary — found only by something crossing that boundary for
  real.
- ⭐ **Two readers of the same fact (the merge engine, the sitting verifier) must consult ONE
  function, not two educated guesses that happen to agree today.** `sitting_verify.py`
  already loaded `merge_all` for other reasons; reaching one function further cost nothing
  and removed a second authority before it could drift.

---
id: k-cp7-build-record
unit: K CP7
packet: packet-k-two-command-signing-gate
merges-after: K CP6
status: UNSIGNED
---

# K CP7 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  ce36c1f65
SCOPE APPROVED:   CP7 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **K CP7 — the code repo is an argument, not a place you stand.** Scope is
> `tools/merge_all.py` **as enumerated by `git show --stat` of this unit's commit.**

⛔ **Collision proof, three sources:** K's packet table declares **CP1–CP2**; build records
on disk top out at **k-cp6**; manifest rows top out at **CP6**. **CP7 free.**

---

## 1 · ⚰️ THE RUNBOOK'S FIRST LINE WAS INERT, AND THE TOOL'S OWN REMEDY WAS DESTRUCTIVE

R3.1's owner decision is that the signing runbook names the master checkout and that **the
first line of each sitting is `cd <that path>`**. That sentence could not have worked.
`merge_all.py` resolved its target from `__file__`, never from the working directory:

```python
CODE_REPO = DOCS_REPO.parent / "s7-price-level"      # before K CP7
```

**Measured before it was believed** — the same command, the same flags, from two different
working directories:

```
cwd = ...\uct-worktrees\s7-price-level   (the FEAT worktree)
cwd = ...\uct-worktrees\_merge-master    (the MASTER checkout)
  -> BYTE-IDENTICAL output from both, naming feat/s7-price-level (e703af0a8)
```

⭐ **A control that answers the same way for both arms of the thing it is testing has not
tested it.** Standing in the right worktree would have felt like the precondition being
met, while every cherry-pick landed in the wrong one.

⛔ **And the refusal's remedy was worse than the refusal.** It printed:

```
git -C C:\Users\Patrick\uct-worktrees\s7-price-level checkout -B merge-run origin/master
```

— i.e. it instructed the owner to move **`feat/s7-price-level`** onto master. That is the
branch carrying this programme's unpushed work and the branch its CI runs against. *A
remedy that destroys the checkout it is run from is not a remedy.*

## 2 · What changed, and what deliberately did not

```
DEFAULT_CODE_REPO   the old literal, untouched — absent flag == old behaviour
CODE_REPO           the LIVE value, bound once in main() before anything reads it
--code-repo <path>  the one authority when present; announced on every run
resolve_code_repo   refuses a non-directory and a directory that is not a work tree
```

⛔ **Bound in `main()`, not threaded through twelve call sites.** Every helper already
resolves `CODE_REPO` at call time, so one binding reaches `git cherry`, the deploy wait and
the cherry-pick alike. Twelve parameters would be twelve chances for one to be missed.

⛔ **`git rev-parse --show-toplevel` is the work-tree test, not `(p / ".git").exists()`.**
In a worktree `.git` is a FILE pointing elsewhere; in a subdirectory of a repo it is absent
altogether. The cheap test answers "no" for a perfectly good worktree *and* "no" for a real
typo — it cannot distinguish, so it is not a check.

⭐ **Every run now prints its target**, and says when it is the default:

```
[merge-all] code repo: C:\...\_merge-master
[merge-all] code repo: C:\...\s7-price-level   (default — no --code-repo given)
```

## 3 · ⚰️ AND A SECOND DEFECT, WALKED INTO WHILE FIXING THE FIRST

Adding K CP7's own row to `sign_manifest.txt` left every check green — and **`UNITS` in
this same file still held 43 entries against the manifest's 44.**

```
sign_all  --dry-run  -> 44 sign command(s)
merge_all --dry-run  -> units: 43 of 43
```

⛔ **`sign_all` would have signed 44 units and `merge_all` merged 43.** The 44th would be
approved, fingerprinted, rowed — and silently never merged. Two hand-maintained lists of
the same thing, with nothing comparing them: the second-authority defect this programme has
now paid for in four shapes.

**Closed in the same unit**, because the check is what catches the slip thirty seconds
after it is made: the self-check now takes the set difference **both ways** and names the
offenders. ⛔ Not a count — equal lengths with one name swapped is exactly what a count
cannot see.

## 4 · The mutation ladder, all three diffs by EDIT

```
restored                       SELF-CHECK PASS, exit 0
MUTATION 1  flag ignored       FAIL exit 1 — 5 rows red, incl. "the flag actually moves the target"
MUTATION 2  work-tree test cut FAIL exit 1 — exactly 2 rows red, the flag rows stay GREEN
MUTATION 3  UNITS row removed  FAIL exit 1 — names ['k-cp7-build-record'], lengths (44, 43)
```

⭐ **Mutation 2 is the one that proves the controls are independent.** It reddens the two
work-tree rows and leaves every flag row green — so "the flag aims the tool" and "a typo is
refused" are two facts with two checks, not one check counted twice.

⭐ **Mutation 3 is not hypothetical — it is a replay of the actual slip**, and it fails by
NAME rather than by count.

## 5 · Controls (13 new rows)

```
no --code-repo  -> the DEFAULT, unchanged                        ok   <- the review row
  ...and that default is still the feat worktree                 ok
--code-repo <master checkout> -> that path                       ok
  ...and it is NOT the default (the flag actually moves it)      ok   <- non-vacuity
  ...with no error                                               ok
a path that does not exist -> REFUSED, not used                  ok
  ...and the refusal NAMES the path it was given                 ok
an existing NON-worktree directory -> REFUSED                    ok
  ...named as 'not a git work tree'                              ok
a real work tree is ACCEPTED (the refusal is not blanket)        ok   <- non-vacuity
the manifest was read at all                                     ok   <- non-vacuity
in the manifest but NOT in UNITS -> signed, never merged     []   ok
in UNITS but NOT in the manifest -> merged, never signed     []   ok
...and the two lists are the same length                (44, 44)  ok
```

⛔ **The load-bearing control is "a real work tree is ACCEPTED."** Without it, "a typo is
refused" is satisfied perfectly by a resolver that refuses everything. ⛔ **And "the
manifest was read at all"** — a path typo there yields two empty sets, which satisfies both
difference rows perfectly.

## 6 · Files

```
tools/merge_all.py        DEFAULT_CODE_REPO / CODE_REPO · resolve_code_repo · --code-repo ·
                          the binding in main() · the target announced on every run ·
                          the UNITS↔manifest set-difference control · K CP7's UNITS row
tools/sign_manifest.txt   K CP7's row + its merges-after constraint (44 rows, 36 constraints)
```

## 7 · End-to-end, on the real worktrees

```
--code-repo _merge-master  -> "code repo: ...\_merge-master"
                              "at HEAD (ccf4fbcb6), not at origin/master (9906a7fcd)"
                              remedy names _merge-master                      ✅
no flag                    -> "...\s7-price-level   (default)"
                              "at feat/s7-price-level (e703af0a8)"            ✅ unchanged
--code-repo <typo>         -> "is not a directory." STOPPED.  exit 2 = REFUSED ✅
```

## 8 · Validators

```
ast.parse                    OK
merge_all --self-check       PASS, exit 0 (13 new rows)
merge_all --dry-run          44 of 44 units, 36 constraints SATISFIED
sign_all  --dry-run          44 sign command(s), 0 skipped
exit codes measured directly, NOT through a pipe (typo -> 2, self-check -> 0)
git diff --numstat           no line-ending flip (insertions only, file not rewritten)
```

⚠️ The exit codes are measured with the command's own status, not `$?` after a pipeline —
`cmd | head` reports **head's** exit, and this session read `exit=0` for a refusal that had
correctly returned 2 before catching it.

## 9 · Drafted ledger row — NOT written

| 110 | *(this unit's commit — named in the session report)* | 2026-09-15 | SIGNING | 1 | K CP7: `merge_all.py` resolved the code repo from `__file__`, so the runbook sentence "the first line of each sitting is `cd <the master checkout>`" was inert — measured byte-identical output from the feat worktree and from `_merge-master` — and its refusal's remedy named the FEAT worktree, i.e. instructed the owner to move the branch carrying this programme's unpushed work onto master. `--code-repo` is now the one authority, the default is unchanged, a non-worktree path is refused by name, and every run announces its target. |

## 10 · Drafted RESUME delta — NOT applied

- ⛔ **`cd` steers a human, not a tool.** A runbook step that changes the working directory
  is inert against any tool that resolves its target from `__file__`. Say which the tool
  reads, and make it an argument.
- ⛔ **Read a remedy as an instruction you will actually follow.** This one was correct
  about the problem and named the wrong repository to fix it in — worse than silence,
  because it would have been obeyed.
- ⭐ **Two fixtures that produce identical output have tested nothing.** The proof that the
  bug existed is that both arms printed the same bytes; the proof it is fixed is that they
  no longer do.

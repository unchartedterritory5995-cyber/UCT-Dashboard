---
id: e-cp34-build-record
unit: E CP34
packet: packet-e-ci-gap-gate
merges-after: E CP29
status: UNSIGNED
---

# E CP34 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  aa663d7e2
SCOPE APPROVED:   CP34 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP34 — the tree that will be deployed is the tree that was tested.** Scope is
> `.github/workflows/full-suite-report.yml` **as enumerated by `git show --stat` of
> `4c4ba1cb1`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk top out at **e-cp33**; manifest rows top out at **CP33**. **CP34 free.**

---

## 1 · ⚰️ F-CI-43 — 46 COMMITS WOULD HAVE MERGED WITHOUT EVER RUNNING THE SUITE

```yaml
push:         { branches: [feat/s7-price-level] }      # before
pull_request: { branches: [master] }
```

`merge_all` pushes **directly to master** — there is no PR — so **no master push has ever
triggered this workflow**, and none of the 46 units about to merge would have run a single
test on the branch they land on.

⛔ **And the only green anyone would have seen is the wrong green.** The Layer-0 guard waits
for a Railway deployment to reach `SUCCESS` and settle 150 s. That is a **deploy** settling:
it says the build started and the pod came up. It says nothing whatever about the suite.

⭐ **This is the gap that had no symptom.** Every prior session read "guard SUCCESS" as
confirmation and it was confirmation — of a different proposition than the one being relied
on.

## 2 · The change

```yaml
push:
  branches: [feat/s7-price-level, master, replay-preview]
```

- **`master`** — so the units are tested where they land, **from the merge of unit #8 onward**.
  ⚠️ **AMENDED 2026-09-17 (F-CI-45).** This line originally read *"from the first merge
  onward"*, which is wrong: `.github/workflows/full-suite-report.yml` **does not exist on
  master at all** — it is CREATED by unit #8 (`packet-e-ci-gap-gate`, `06d5bde92`) and
  modified by 26 later units. Adding `master` here changes nothing until #8 lands, and the
  `replay-preview` trigger only takes effect from #47, which is this unit. The checkpoint is
  still correct and still needed; its claim about WHEN was not.
- **`replay-preview`** — the branch the merge's own cherry-pick result is pushed to. The
  suite runs on **the exact tree 47 commits will produce**, *before* they land.

⚠️ **`concurrency` is `cancel-in-progress: false`, deliberately, and that is why this does
not fan out.** A master push queues one run per merge commit, and the sittings merge one unit
at a time under a guard that serialises them. There is no burst to absorb.

⭐ **The chicken-and-egg resolves itself:** a push event runs the workflow **as it stands at
the pushed commit**. `replay-preview`'s tip contains this commit, so pushing it triggers the
run this checkpoint exists to enable.

## 3 · Validators

```
yaml.safe_load                          OK
push.branches                           [feat/s7-price-level, master, replay-preview]
  ...feat/s7-price-level still present  True   <- non-vacuity: the existing trigger is intact
job count                               6, unchanged
check_workflow_expressions <path>       exit 0, 22 expressions, every call in the documented set
check_repo_hygiene                      clean, no line-ending flip
git diff --numstat                      14 insertions, 1 deletion — comments plus one list
```

⚠️ **`check_workflow_expressions` takes PATHS and says so.** Invoked bare it printed
*"no workflow files matched — UNREADABLE, not a pass"* and exited 1 — **correctly**, and this
record notes it because a reader who sees that line could easily mistake a mis-invocation for
a broken workflow. Given the path it is exit 0.

## 4 · What this does NOT do

⛔ **No branch protection. No required check.** `merge_all` pushes master 41 times; a required
check would refuse every one of them. **The gate's colour became truthful at E CP26; that it
does not block is a separate decision and remains unmade** (E's CP3, still NOT BUILT).

## 5 · Drafted ledger row — NOT written

| 118 | `4c4ba1cb1` | 2026-09-17 | CI | 1 | E CP34: `push.branches` was `[feat/s7-price-level]` alone while `merge_all` pushes master DIRECTLY, so all 46 units would have reached master having run no tests — and the Layer-0 guard's `SUCCESS` is a Railway deploy settling, which says the build started and nothing about the suite. Adds `master` and `replay-preview`, the branch the merge's own cherry-pick result is pushed to, so the tree that will be deployed is the tree that was tested, before 47 commits land rather than after. |

## 6 · Drafted RESUME delta — NOT applied

- ⛔ **A deploy settling is not a suite passing**, and a programme can run for weeks reading
  one as the other because both are green.
- ⛔ **A workflow's trigger list is a claim about which branches are tested.** Read it
  whenever you rely on "CI is green" for a branch you did not push to.
- ⭐ **Test the cherry-pick result, not the source branch.** They are different trees, and the
  one that gets deployed is the one nobody was running.

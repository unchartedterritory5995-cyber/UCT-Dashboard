# RESOLUTION — `e-cp28-build-record` · `tests/conftest.py`

> **F-MERGE-2.** Applied at merge time by `merge_all` when a cherry-pick of this unit
> conflicts on this path **and both pre-image blobs match exactly**. The unit's own commit is
> never rewritten (F-MERGE-3: a commit is a tree, a cherry-pick is a patch — a commit rewritten
> to fit a moved base carries the base's own change in its patch).

```
row               e-cp28-build-record
path              tests/conftest.py
unit commit       304ac481c          (UNCHANGED — patch-id preserved, no rewrite, no force-push)
master pre-image  f4193ea6a335c6e2e7c0a3596dee1c15e9362841
unit   pre-image  056d959ec5ce7adc79be70af6464507a78cc4b54
resolved blob     ca74b3c5bfa2b806d7bbfcb155d95cec279222a4
content           e-cp28-build-record--tests-conftest-py.resolved.py
```

⛔ **Both pre-images must match or this file is not applied.** `master pre-image` is
`git rev-parse origin/master:tests/conftest.py`; `unit pre-image` is
`git rev-parse 304ac481c:tests/conftest.py`. A mismatch means master (or the unit) has moved
that file since this was proven, and the resolution is **re-derived and re-proven**, never
stretched to fit.

⭐ **Keying on the blob, not the commit, is what makes this survive master moving.** Between
`f86c3759e` and `e50c0552d` master moved and `tests/conftest.py` **did not** — same blob
`f4193ea6a`, so this record stayed valid across a base change without being touched.

## The conflict

```
master gained  ab7c55873  test(wisdom): R21 — strict-xfail baseline   (40 lines)
E CP28         304ac481c  the autouse override-restoring fixture      (45 lines)
both append near the end of tests/conftest.py -> content conflict
```

⭐ **Additive, not a disagreement.** Master's `conftest.py` contains **zero** occurrences of
`dependency_overrides`; E CP28's contains **6**. The two changes are about different things
and neither removes anything of the other's.

## Additive proof — against the RECORDED master pre-image

```
git diff <master pre-image> <resolved blob>  ->  0 removed, 45 added
the added lines are byte-equal to E CP28's own hunk   ->  True
E CP28's hunk itself: 45 added, 0 removed
```

⛔ **Any removal is a hard stop.** A resolution that drops a line of master's is not a
resolution, it is a revert wearing one.

## Mutation proof — four arms, on a throwaway from `origin/master`

```
A  master's conftest, class fix ABSENT      41 failed, 21 passed   <- the leak is LIVE on master
B  the resolved file, class fix PRESENT     62 passed
C  the cleanup ENTIRELY removed             41 failed, 21 passed   <- load-bearing
D  restored by EDIT                         62 passed
```

Reproduction: `pytest tests/test_thesis_reviews_router.py tests/test_voice_router.py`, with the
router test at **`240bb3305^`** — the *pre-fix*, leaking version. ⛔ Non-vacuity was asserted
first (`the per-file fix is absent: True`).

⚰️ **Two earlier attempts at this proof were vacuous and both are recorded because each looks
like a pass:**

1. Using the router test at `240bb3305` (the per-file fix) made the class fix redundant —
   62 passed in every arm.
2. Mutating only `update(before or {})` left `clear()` in place, and **clearing alone already
   stops the leak** — 62 passed in every arm. That tested *restore vs clear*, not *fixture
   present vs absent*: a guard that tests the adjacent thing.

⭐ Arm **A** is what makes the rest mean anything: it shows the defect is still live on
**today's master**, so the fix is not merging a cure for a disease that has gone.

## Replay

```
base    e50c0552d   (origin/master; https://github.com/unchartedterritory5995-cyber/UCT-Dashboard.git)
result  CLEAN 47 of 47 with this resolution applied
        (proven at f86c3759e; the conftest blob is unchanged at e50c0552d, so it stands)
strands used this session: 1 of 3
```

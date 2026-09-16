---
id: e-cp27-build-record
unit: E CP27
packet: packet-e-ci-gap-gate
merges-after: E CP26
status: UNSIGNED
---

# E CP27 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **E CP27 — the shard split, second attempt, with the blocker removed and the projection
> calibrated.** Scope is `tools/pytest_shards.py` **as enumerated by `git show --stat` of
> this unit's commit.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk top out at **e-cp26**; manifest rows top out at **CP26**. **CP27 free.**

---

## 1 · Why a second attempt is permitted

The first (run #24) produced **41 NEW failures** and was reverted inside the hour. Its cause
is now known and fixed: `tests/test_thesis_reviews_router.py` installed
`app.dependency_overrides[get_current_user]` on the **real shared app** and never removed
it, so a stub user with no plan answered for every later test in the process — `401` became
`402`, `200` became `402`. Fixed in `240bb3305`.

**The blocker is measured gone, not assumed:**

```
the exact two-file reproduction   41 failed -> 62 passed
the full 52-file joined set       52 failed -> 10 failed, none in the voice file
```

## 2 · The plan, and where the risk sits

```
tests-01 … tests-12, 104 files each; loose-root total 1,248 at 8 buckets and at 12 (equal)
tests-05's 156 files at 8 buckets land in tests-07 (104) + tests-08 (52)   — sums to 156
the F-CI-36 joined set (52 files) lies ENTIRELY inside tests-11            — exactly one bucket
partition proved: 1,430 files, 16 shards, no duplicate, no omission
```

⭐ **The joined set being in ONE bucket is the property that matters.** If the isolation
class bites again it bites in one place, and the record will say which.

## 3 · ⚠️ THE PROJECTION IS CALIBRATED, AND A RAW SUM WOULD HAVE BEEN WRONG BY DOUBLE

junit's per-test `time` **excludes collection**, and collection is not evenly spread.
Measured on run #28's twelve shard junits (24,454 testcases, resolved to 1,428 files by
longest-dotted-prefix — `tests.test_x.TestY` → `tests/test_x.py`), against the **observed**
`Run` step of each job:

```
shard       projected   observed   ratio
tests-01          308        353    1.15
tests-02          106        152    1.43
tests-03          349        418    1.20
tests-04          326        370    1.14
tests-05          546        595    1.09
tests-06          248        292    1.18
tests-07          398        885    2.22   <-- the outlier
tests-08          242        344    1.42
```

⛔ **Projected with the WORST ratio (2.22), not the mean:**

```
tests-05  938 s   tests-07  902 s   tests-11  772 s   tests-08  585 s   tests-01  583 s
...cap 1,200 s.  Worst headroom: 262 s.
```

⚠️ **A raw sum said 422 s for the worst bucket.** The same method un-calibrated would have
predicted comfort and been wrong by more than double. The first version of this projection
also reported `every bucket < 1000 s -> True` **from zero data** — 0 of 1,248 files had a
measured time, because the junit carries `classname`, not `file`. The non-vacuity line is
what caught it.

## 4 · ⚠️ PREDICTION (recorded before pushing)

| field | prediction |
|---|---|
| every bucket's `Run` step | **< 1000 s**; worst ≈ **938 s** (tests-05), second ≈ 902 s (tests-07) |
| MISSING | **0** |
| NEW among the 52 formerly-leaking files | **0** |
| `collected` | **unchanged**, 24,454 ± the flaky set's own movement |
| FLAKY_SIZE | **≤ current + 1** (3 on run #28) |

⛔ **ONE ATTEMPT.** A NEW failure among the 52 reverts this by EDIT in the same session,
with a finding naming the shared state. ⛔ Any bucket within **200 s** of its cap is a
finding with a sub-split proposal and **no action**.

## 5 · Files

```
tools/pytest_shards.py   ROOT_BUCKETS 8 -> 12, with the first attempt's revert and this
                         attempt's calibration recorded above the constant
```

## 6 · Validators

```
pytest_shards --self-check   PASS (incl. "a plan MISSING one file is refused" and
                             "a plan DUPLICATING one file is refused")
pytest_shards --plan         16 shards, 1,430 files, is_partition True
check_repo_hygiene           clean, no line-ending flip
```

## 7 · Drafted ledger row — NOT written

| 107 | *(this unit's commit — named in the session report)* | 2026-09-15 | CI | 1 | E CP27: the shard split, second attempt. The first produced 41 NEW and was reverted; its cause was one leaked `dependency_overrides` entry on the shared app, fixed in `240bb3305`, and the exact reproduction now passes. The 52 formerly-leaking files sit entirely inside one bucket. The projection is CALIBRATED against run #28's observed `Run` steps — observed/projected ran 1.09 to 2.22 because junit's per-test time excludes collection — giving a worst case of 938 s against a 1,200 s cap. A raw sum said 422 s. |

## 8 · Drafted RESUME delta — NOT applied

- ⛔ **A projection from per-test times is not a projection of a job.** Collection is not in
  `time` and is not evenly spread; calibrate against an observed run or do not predict.
- ⛔ **Project with the WORST observed ratio, not the mean** — the mean hides the one shard
  that is about to hit the cap.
- ⭐ **Put the risky set inside one bucket on purpose.** If it breaks again, the record names
  one shard instead of a pattern.

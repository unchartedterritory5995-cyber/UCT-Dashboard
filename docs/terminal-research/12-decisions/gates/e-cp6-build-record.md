---
id: e-cp6-build-record
unit: E CP6
packet: packet-e-ci-gap-gate
merges-after: E CP5
status: UNSIGNED
---

# E CP6 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **E CP6 — the backend suite is SPLIT, not given more time; and a hang fails by name.**
> Twelve shards proved to be a partition, each capped at 20 minutes with
> `--timeout=120 --timeout-method=thread`, aggregated so a missing shard cannot read as
> zero. Adds the report-only **collection profile** (E7). Scope is
> `tools/pytest_shards.py`, `tools/ci_aggregate.py`, `tools/collect_profile_dirs.py` and
> `.github/workflows/full-suite-report.yml` **as enumerated by `git show --stat` of this
> unit's commit.**

⛔ **Collision proof:** E's table declares CP1–CP3; build records exist for CP2, CP4, CP5
(manifest rows 15 and 17). **CP6 free.**

---

## 1 · ⛔ `scripts/gate_shards.py` IS NOT THE SHARD SOURCE, and the proof is not an absence

The default was to use it if its output partitions the test tree. **It never touches the
test tree.** With comments and docstrings stripped:

| needle | code hits in `gate_shards.py` |
|---|---|
| `pytest` | **0** |
| `tests/` | **0** |
| `APP` (= `repo/app`) | 4 — incl. `(APP / "src").rglob(...)` |
| `vitest` | 3 — incl. `npx vitest run --shard={index}/{shards}` |

It is the **frontend** gate. ⚠️ **And the comment-strip proved nothing here**: the word
`pytest` appears **0** times in that file even *before* stripping, so there was no prose
occurrence to exclude. The proof is the positive evidence — it invokes `npx vitest` over
`app/src` — not the absence.

### And the obvious fallback does not balance

"Partition by top-level test directory", measured:

```
(root)          1248     api               26
pattern_engine   136     theme_curation    13
                         theme_engine       7        TOTAL 1430
```

**1,248 of 1,430 files sit loose directly in `tests/`** — 87%. One directory-shard would
carry nearly the whole suite and still blow any cap. Run #4 ran the whole tree for
**2,671 s** and never printed a totals line.

## 2 · The partition, and it is PROVED

**One shard per populated subdirectory, plus the loose root files split into 8 contiguous
alphabetical buckets** — deterministic (sorted), human-readable (the id names its contents),
and checked:

```
dir-api              26     tests-01 … tests-08   156 each
dir-pattern_engine  136
dir-theme_curation   13     shards              12
dir-theme_engine      7     files_total       1430
                            files_in_shards   1430
                            sum_of_shard_sizes 1430
                            is_partition      True
                            largest_shard  ('tests-01', 156)  = 10.9%
```

⛔ **A SHARD PLAN THAT IS NOT A PARTITION IS WORSE THAN NO SHARDING.** A file in two shards
runs twice; a file in **none** is silently never tested — and the second is indistinguishable
from a pass. `--self-check` asserts union-equals-all, pairwise-empty, and
sum-equals-count, **and mutation-proves both directions**: a plan missing one file is
refused, a plan duplicating one file is refused.

⭐ **The matrix is derived at run time, never typed into the workflow.** A hand-typed shard
list beside `pytest_shards.py` is the enumeration-beside-its-source defect, and here it
would mean a test file silently in no shard. The `plan` job runs `--self-check` **before**
emitting the list, so an unprovable partition stops the run.

## 3 · Per-test timeout — a hang fails BY NAME

`--timeout=120 --timeout-method=thread`. **`pytest-timeout==2.4.0` was already in
`requirements.txt`** — nothing added, cited rather than assumed.

⭐ Without it, one hung test consumes its shard's entire 20 minutes and the shard reports
**nothing** — the run-#4 shape, one level down. With it, the hang is a named failing test
and the other 155 files in that shard still report.

## 4 · The aggregator refuses to let an absence read as zero

⛔⛔ **Sharding's dangerous arithmetic is `sum()`.** A shard that never reported contributes
**0 collected and 0 failed**, which is indistinguishable from a shard that ran cleanly.

`ok` = **every shard succeeded** AND **every shard has a totals line** AND `failed == 0` AND
**no shard missing**. Three of those four clauses are separate lies this repository has
already told: a cancelled job reports no failures (run #4), a collected-nothing job reports
no failures (run #3), and a missing artifact reports nothing at all.

⭐ **Shard results come from the RUNNER** (E CP5's rule) via the jobs API — not from a file
each shard writes about itself. **A shard cancelled at its cap may never reach its own final
step**, so a self-reported outcome is exactly the evidence that disappears when it matters.

### Controls — four shapes plus empty (`--self-check`, exit 0)

```
[all success]       {"shards_total":3,"shards_success":3,"collected":300,"failed":0,"ok":true}
[one cancelled]     {"shards_cancelled":1,"shards_without_totals":["s2"],"collected":200,"ok":false}
[one missing]       {"shards_total":3,"shards_reported":2,"shards_missing":["s2"],"collected":200,"ok":false}
[per-test timeouts] {"per_test_timeouts":2,"failed":2,"ok":false}
EMPTY: ok is False · says UNREADABLE rather than passing
```

⛔ The **one missing** row is the whole point: `collected` is 200 rather than 300 and `ok`
is false **with the shard NAMED**, instead of a tidy 200 that looks like a smaller suite.

## 5 · E7 — the collection profile (report-only, gates nothing)

A second matrix, five directories, `/usr/bin/time -v pytest --collect-only -q <dir>`, each
capped at **10 minutes**, reduced to `dir | collected | seconds | rss_mb | result` and
aggregated into `results/<run>/collect_profile.json`.

⭐ **It exists because every OOM this repo has recorded happened at COLLECTION**, not during
tests — 18 GB for `pytest tests/` and **6.6 GB for `--collect-only` alone**, both in
`CLAUDE.md` as warnings nobody has ever attributed to a directory. ⚠️ A directory that hits
the cap is recorded `result: "capped-or-failed"` with `collected: null` — **never 0**.

## 6 · ⚠️ PREDICTION for the next run — written before pushing

| field | prediction | basis |
|---|---|---|
| `shards_total` | **12** | the proved partition |
| longest shard | **8–14 min**, under the 20-min cap | run #4 did the whole tree in >2,671 s; the largest shard is 10.9% of it, plus per-shard install and collection overhead |
| `collected` | **thousands; certainly ≫ 2** | ⚠️ the only anchor is 1,430 FILES — the test count has never been measured, so this is a floor, not a figure |
| `per_test_timeouts` | **0 or small** | ⚠️ **LOW CONFIDENCE, and the reason is stated: E7's profile has not landed, so there is no basis for naming which directories hang.** Predicting it anyway so it can be wrong |
| `shards_missing` | **[]** | |
| `ok` | **false** | there are real failures; this unit makes the suite *report*, not pass |
| first totals line in CI history | **yes** | the headline if it appears |

⭐ **The `per_test_timeouts` row is deliberately a weak prediction with its weakness
declared**, rather than a confident guess dressed as analysis.

## 7 · Files

```
tools/pytest_shards.py                    (new — the partition + its proof)
tools/ci_aggregate.py                     (new — N shards -> one suite result)
tools/collect_profile_dirs.py             (new — E7)
.github/workflows/full-suite-report.yml   (plan job; pytest -> 12-shard matrix @20min;
                                           collect_profile matrix @10min; publish aggregates)
```

Top-level `permissions: contents: read` unchanged; only `publish` raises `contents: write`.

## 8 · Drafted ledger row — NOT written

| 84 | *(this commit)* | 2026-09-15 | CI | 1 | E CP6: the backend suite is split into a proved 12-shard partition at 20 min each with a 120 s per-test timeout, aggregated so a missing shard cannot read as zero. `gate_shards.py` was not usable — it is the vitest gate (0 code references to pytest or `tests/`). Adds E7's report-only collection profile. |

## 9 · Drafted RESUME delta — NOT applied

- **A job that cannot print totals within its cap is split, not extended.** Caps come down
  as shards prove their duration, never up.
- The shard matrix is derived and its partition proved before the run uses it.
- ⚠️ `per_test_timeouts` was predicted without a basis; E7's profile is what gives the next
  prediction one.

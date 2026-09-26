---
id: e-cp18-build-record
unit: E CP18
packet: packet-e-ci-gap-gate
merges-after: E CP17
status: SIGNED (E CP18, fingerprint b8aa16024)
---

# E CP18 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  b8aa16024
SCOPE APPROVED:   CP18 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP18 — a hung shard reported success, and the timeout method did the thing its own
> comment said it prevented.** Scope is `.github/workflows/full-suite-report.yml` **as
> enumerated by `git show --stat` of `62dcf2a01`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk are **CP2, CP4–CP17**; manifest rows are **CP2, CP4–CP17** (29 rows total).
**CP18 free.**

---

## 1 · ⭐⭐ RUN #15 PUBLISHED — THE FIRST RECORD SINCE RUN #4

```
[notice] ci-publish | stale rebase state: none to clear
committer: github-actions[bot]
attempt 1: fetch rc=0
attempt 1: rebase rc=0
attempt 1: push rc=0
published on attempt 1
```

**20 of 20 jobs succeeded.** `ci-results` gained `83720eab7 ci run 34996412472`, and
`results/latest.json` is **gone from the branch**.

### E CP17's prediction, scored

| predicted | actual | |
|---|---|---|
| `publish`: **success** | **success** | ✅ |
| a record at `results/<run_id>/summary.json` | **yes, the first since run #4** | ✅ |
| `results/latest.json` gone | **gone** | ✅ |
| the annotation is `::notice::`, ending `published on attempt 1` | **exactly that** | ✅ |
| `contract_gaps` | `[]` | ✅ |
| `shards_without_totals: []` | **`['tests-04', 'tests-07']`** | ❌ |

⭐ **Five of six, and the sixth is this checkpoint.** The claim about a cause I had *read*
held; the one about a part I had not measured did not.

## 2 · ⭐⭐ A TOTALS LINE FOR PYTEST IS IN THE RECORD FOR THE FIRST TIME

**Ten of twelve shards, in their own words, inside the published record:**

```
dir-api             292 passed, 1 skipped, 6 warnings in 23.63s
dir-pattern_engine  1 failed, 2615 passed, 9 xfailed, 2 warnings in 25.00s
dir-theme_curation  57 passed in 1.94s
dir-theme_engine    64 passed, 52389 warnings in 22.60s
tests-01            63 failed, 3647 passed, 8 skipped, 20 warnings in 464.57s (0:07:44)
tests-02            2203 passed, 42 skipped, 81 warnings in 158.23s (0:02:38)
tests-03            10 failed, 2786 passed, 1 skipped, 251 warnings, 6 errors in 287.08s
tests-05            22 failed, 2655 passed, 2 skipped, 27 warnings in 763.06s (0:12:43)
tests-06            13 failed, 2322 passed, 4 skipped, 14 warnings, 15 errors in 227.12s
tests-08            27 failed, 2217 passed, 4 skipped, 269 warnings, 6 errors in 316.05s
```

**The first complete-ish measurement this repository has ever had:**

| | collected | passed | failed | ok |
|---|---|---|---|---|
| pytest | **19,056** | 18,858 | **136** | false |
| vitest | **19,898** | 19,862 | **21** | false |

**VERDICT: RED** — and it is the first *honest* red. `contract_gaps: []`.

## 3 · ⚠️ AND THE NUMBERS ARE A FLOOR, NOT A TOTAL

`shards_without_totals: ['tests-04', 'tests-07']`. Two of twelve shards contributed
**nothing** — so 19,056 collected and 136 failed are both **under-counts**, and saying so is
the point. ⭐ The aggregator refused to let them read as zero and made the suite `ok: false`
with `every_shard_has_totals=False` in the basis. **That is the defect it was built for,
firing on its first published run.**

## 4 · ⛔⛔ BOTH SHARDS HUNG, AND BOTH REPORTED `success`

| shard | log | ended with |
|---|---|---|
| `tests-04` | **8 KB** | `+++ Timeout +++`, stack in `discord_index_close.wait_until_warm` → `sleep()` |
| `tests-07` | **6.6 MB** | mid-startup memory lines, no totals |

**Two independent defects made that possible.**

### 4a · The timeout method did what its comment said it prevented

```
# ⛔ --timeout=120 --timeout-method=thread … a HANG now fails BY NAME instead of
# taking the shard's whole 20 minutes down with it and reporting nothing.
```

⚰️ **The thread method ABORTS THE PROCESS.** It reported nothing — not the hung test's name,
not the totals line, not the junit. **One hung test cost the shard's entire result**, which
is the precise outcome the comment promised it avoided.

⭐ `--timeout-method=signal` raises *inside the test*: it fails by name, the run continues,
and the totals line is printed. ⛔ And `ci_aggregate`'s `per_test_timeouts` counts
pytest-timeout's junit `<failure message>` — **which the thread method never gets to write**,
so that field has been structurally unreachable since E CP6.

### 4b · The pytest job never got the assertion the vitest job has

The workflow's own header says **"A RUN WITHOUT A TOTALS LINE IS NOT A RUN"**, and the vitest
job has carried `Assert the run produced a totals line` since E CP1. **The pytest job that
REPLACED the single pytest run never got one.** The run is piped through `tee`, so the step's
exit code is tee's, and a shard that ran nothing reported **success**.

⭐ The aggregator caught both downstream — that is why it exists — **but the shard itself
claimed to have passed**, and that is the lie this step refuses. It now emits an `::error::`
annotation naming the shard.

## 5 · Also, `${PIPESTATUS[0]}` is captured with nothing in between

A recorded incident in this programme read it one `echo` later and printed *"exit 0"* beside
output listing two failures. The rc is captured into a variable on the very next line.

## 6 · Files

```
.github/workflows/full-suite-report.yml   (signal timeout method; per-shard totals assertion;
                                           PIPESTATUS captured immediately)
```

## 7 · Validators

```
yaml.safe_load             -> OK
bash -n on BOTH step bodies -> PARSES
check_workflow_expressions -> exit 0, 21 expressions
check_repo_hygiene         -> clean, 9,557 tracked files
actionlint                 -> UNREADABLE-TOOL (not installed)
```

⚠️ **And my own verification one-liner was wrong before it was right:** it reported the
`PIPESTATUS` capture missing, because I ran it in an **unquoted** heredoc and the shell
expanded `${PIPESTATUS[0]}` inside my needle before Python saw it. The file was correct; the
check was not. Same family as this session's two escaping incidents — **quote the heredoc or
use a patch file.**

## 8 · ⚠️ PREDICTION for run #16

| field | prediction |
|---|---|
| `publish` | **success**, and a second record on `ci-results` |
| `shards_without_totals` | **`[]`** — every shard prints totals, because a hang now fails one test instead of the process |
| `tests-04` | **fails by name** on `test_a_note_that_cannot_be_written_still_posts_the_charts`, with a totals line beside it |
| pytest `collected` | **higher than 19,056** — two shards' worth of tests join the count |
| pytest `failed` | **higher than 136**, and that is the measurement improving, not the repo getting worse |
| VERDICT | **RED** |

⛔ **A rising failure count here is a BETTER measurement, not a regression**, and it must be
read that way when it lands.

## 9 · Drafted ledger row — NOT written

| 96 | `62dcf2a01` | 2026-09-15 | CI | 1 | E CP18: run #15 published the first record since run #4, and named two shards that hung and still reported success — `--timeout-method=thread` aborts the process, so one hung test cost the whole shard's totals, junit and per-test-timeout count; and the pytest job never had the totals-line assertion the vitest job has carried since E CP1. Switched to `signal`, added the assertion with an annotation naming the shard. Run #15's pytest numbers are a FLOOR. |

## 10 · Drafted RESUME delta — NOT applied

- ⛔⛔ **A comment that says what a flag prevents is a claim about a run.** `thread` did the
  exact thing its comment said it avoided, for nine runs.
- ⛔ **A rule applied to one job is not applied to the job that replaced it.** "A run without
  a totals line is not a run" lived in the vitest job while the pytest job had no such step.
- ⚠️ **Two shards short makes every number a floor** — say so in the same breath as the
  number.
- ⛔ Quote the heredoc, or the shell edits your instrument before Python reads it.

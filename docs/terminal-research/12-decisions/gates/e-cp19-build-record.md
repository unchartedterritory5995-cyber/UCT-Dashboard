---
id: e-cp19-build-record
unit: E CP19
packet: packet-e-ci-gap-gate
merges-after: E CP18
status: UNSIGNED
---

# E CP19 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **E CP19 — the record must CONTAIN the evidence it names.** Scope is
> `tools/ci_extract.py`, `tools/ci_record.py`, `tools/ci_summarize.py` and
> `.github/workflows/full-suite-report.yml` **as enumerated by `git show --stat` of
> `3196206e7`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk are **CP2, CP4–CP18**; manifest rows are **CP2, CP4–CP18** (30 rows total).
**CP19 free.**

---

## 1 · Run #16 scored E CP18 — five of six, and the sixth is the whole of §3

| E CP18 predicted | actual | |
|---|---|---|
| `publish`: success, a second record | **success**, `34998643399` on `ci-results` | ✅ |
| `tests-04` fails by name | **13 failed, 2917 passed** — it ran and reported | ✅ |
| pytest `collected` higher than 19,056 | **22,003** | ✅ |
| pytest `failed` higher than 136 | **148** | ✅ |
| VERDICT RED | **RED**, `contract_gaps: []` | ✅ |
| `shards_without_totals: []` | **`['tests-07']`** | ❌ |

⭐ **The `signal` timeout method worked** — `tests-04`, which hung for two runs, now reports.
**`tests-07` was never a timeout at all**, which §3 is about.

## 2 · ⛔⛔ THE RECORD NAMED SIX DETAIL FILES AND THREE DID NOT EXIST

Checked against what actually landed on the branch:

```
pytest_collect_errors  results/…/pytest_collect_errors.txt   ⛔ DOES NOT EXIST
pytest_error_buckets   results/…/pytest_error_buckets.txt    ⛔ DOES NOT EXIST
pytest_junit           results/…/pytest-junit.xml            ⛔ DOES NOT EXIST
vitest_failures        results/…/vitest_failures.txt         EXISTS
vitest_junit           results/…/vitest-junit.xml            EXISTS
collect_profile        results/…/collect_profile.json        EXISTS
```

`ci_extract --pytest-log logs/pytest.log` names **a path that stopped existing when E CP6
sharded pytest** — each shard uploads its OWN `pytest.log` and `pytest-junit.xml`. The guard
was false, the whole pytest block was skipped, and the record promised the failure **text**
for **136 pytest failures** and delivered none.

⛔ **Nothing failed.** The publish job was green, the record parsed, `contract_gaps` was
empty. The only way to find it was to open the branch and try to read a file. ⭐ **A named
path that does not exist is worse than an omitted one**: a reader treats it as a file they
have not opened yet.

⚰️ **And `_write` was built for exactly this.** Its docstring: *"Always writes the file. ZERO
is a finding, not a missing artifact."* An absent **input** defeated it by skipping the write
— the guard above the tool's own principle.

**Fixed, three ways:**

- the publisher **builds its args from what is on disk** (`for d in shards/*/`), so a
  thirteenth shard is included the day it exists and nothing is typed;
- `ci_extract` reads **every** shard log and junit, and gains `pytest_failures.txt` beside
  `vitest_failures.txt` — ⭐ the extractor was already vendor-neutral and **only its NAME**
  (`vitest_failures_from_junit`) said otherwise;
- `ci_record --detail-dir` **verifies every path it names**. An absent one is marked
  `UNREADABLE` and NAMED in `contract_gaps`; **no `--detail-dir` at all is reported as
  `NOT VERIFIED`** rather than passing quietly, because an unverified claim and a checked one
  must not look the same.

## 3 · ⛔⛔ A SHARD THAT RAN WAS RECORDED AS HAVING PRODUCED NOTHING

`tests-07`'s totals line was in its log the whole time:

```
line 4,424 of 142,028:
37 failed, 2362 passed, 2 skipped, 15192 warnings, 1 error in 443.42s (0:07:23)
```

**137,604 lines came after it** — `[mem] rss_mb=…`, a logo prewarm, background daemon
threads still writing long after pytest had finished. And `ci_summarize` read:

```python
tail = text.strip().splitlines()[-1]
```

⭐ **Same class as E CP18: a rule applied to one suite and not the other.** The vitest branch
four lines above searches the WHOLE text; the pytest branch read a single line.

### 3a · And the pattern itself would have reported zeros

```python
_P_TOTALS = re.compile(
    r"(?:(\d+) failed)?(?:[,\s]*)(?:(\d+) passed)?…(?:(\d+) error)?[^\n]*?in ([\d.]+)s")
```

**Every count group is optional**, so the whole pattern reduces to `…in <float>s` and matches
any line mentioning a duration. Against the real log it returned `totals_line_found: True`
with **`passed=0 failed=0`** — and `ci_aggregate` **SUMS** those into the suite.

⛔ **A partial match that yields zeros is worse than no match**: it reports fewer failures
than there were, which is the flattering direction.

**Fixed:** a summary line must carry a **duration AND at least one count**; the counts are
read **individually**, so field ORDER does not matter — run #16's line put `15192 warnings`
between `skipped` and `error`, which a positional pattern cannot express; and the **LAST**
such line wins, so a re-run is not overridden by an earlier summary.

### 3b · Proved against the twelve REAL logs, not fixtures

```
eleven shards: byte-identical counts
tests-07     : RECOVERED — +2,362 passed, +37 failed
```

⭐ **Additive, not a re-reading.** If the new parser had changed an already-correct shard,
that would be a rewrite of history rather than a recovery, and this is the control that tells
the two apart.

## 4 · ⛔⛔ AND MY OWN E CP18 ASSERTION PASSED ON NOISE, ON ITS FIRST RUN

It grepped `[0-9]+ (passed|failed|error)` over the raw log. On `tests-07` that matched
`0 error` and `37 failed` **from log body text**, so the step went **green** while
`ci_summarize` reported no totals line at all.

⛔ **Two instruments, one question, opposite answers** — and the one I had just written was
the wrong one. ⭐ The summariser is the single authority on *"is there a totals line"*; the
step now **summarises first and asserts on ITS verdict** instead of asking again in a
different language. `lesson_a_second_authority_over_one_value`, committed by me, one
checkpoint after writing the rail it undermined.

## 5 · ⚠️ A PREDICTED FAILURE THAT DID NOT HAPPEN

I expected `[ -f x ] && ARGS=…` to abort under `bash -e` when a shard lacked its junit, and
rewrote it as `if` blocks. **Measured, both forms, against a shard with no junit: both exit
0.** The `if` form is clearer and genuinely immune; **it is not a bug fix and is not claimed
as one.** Recorded so nobody re-derives the theory.

⚠️ **And twice this session a throwaway verification one-liner matched my own COMMENT rather
than code.** The repo's rails strip comments before matching; my ad-hoc checks kept not doing
it.

## 6 · Files

```
tools/ci_extract.py                       (repeatable --pytest-log/--pytest-junit; pytest_failures.txt; always writes)
tools/ci_record.py                        (verify_detail + --detail-dir; NOT VERIFIED is a gap)
tools/ci_summarize.py                     (whole-text search, count-bearing lines only, order-independent)
.github/workflows/full-suite-report.yml   (args built from disk; --detail-dir; summarise-then-assert)
```

## 7 · Validators

```
nine tool self-checks       -> all exit 0
yaml.safe_load              -> OK
bash -n on both step bodies -> PARSES
check_workflow_expressions  -> exit 0, 21 expressions
check_repo_hygiene          -> clean, 9,557 tracked files
actionlint                  -> UNREADABLE-TOOL (not installed)
```

## 8 · ⚠️ PREDICTION for run #17

| field | prediction |
|---|---|
| `shards_without_totals` | **`[]`** — all twelve, `tests-07` included |
| pytest `collected` / `failed` | **~24,400 / ~185** — the re-summarised figures, because the numbers were always there |
| `contract_gaps` | **`[]`** — every named detail path now written |
| `pytest_failures.txt` in the record | **present, and non-ZERO** — the first per-test failure text pytest has ever had here |
| VERDICT | **RED** |

⭐ **The rise from 148 to ~185 failures is a MEASUREMENT improving, not a repository getting
worse** — the same sentence E CP18 asked to have read that way, and it applies again.

## 9 · Drafted ledger row — NOT written

| 97 | `3196206e7` | 2026-09-15 | CI | 1 | E CP19: run #15/#16's records NAMED three pytest detail files that were never written (ci_extract pointed at a pre-sharding path), and `ci_summarize` read only the LAST LINE of a shard log — losing `tests-07`'s totals line, which sat at line 4,424 of 142,028 under background-thread noise. Its all-optional pattern also matched a bare duration and returned zeros that the aggregator sums. Extract now reads every shard, the record verifies the paths it names, and the shard assertion stops being a second authority that passed on noise. |

## 10 · Drafted RESUME delta — NOT applied

- ⛔⛔ **A record must not name a path it did not write.** Verify, or say NOT VERIFIED.
- ⛔ **A pattern of all-optional groups matches everywhere and reports zeros** — and zeros get
  summed. Require at least one real field.
- ⛔ **The tail of a log is not the end of the run.** Background threads outlive it.
- ⛔ **One question, one authority.** My own new assertion contradicted the summariser on its
  first run, and the summariser was right.

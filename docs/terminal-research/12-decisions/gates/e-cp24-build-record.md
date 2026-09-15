---
id: e-cp24-build-record
unit: E CP24
packet: packet-e-ci-gap-gate
merges-after: E CP23
status: UNSIGNED
---

# E CP24 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **E CP24 — the gate's first run named a wiring defect, and measured the suite's flake
> rate.** Scope is `tools/ci_inventory.py` and `.github/workflows/full-suite-report.yml` **as
> enumerated by `git show --stat` of `9fa4ee150`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records on
disk are **CP2, CP4–CP23**; manifest rows are **CP2, CP4–CP23** (35 rows total). **CP24 free.**

---

## 1 · The gate ran, and it fired

```
gate INVALID | baseline 122 = unchanged 120 + fixed 2 + missing 0
             | current 121 = unchanged 120 + new 1
```

Readable on the job page **without an account**, which is what E CP14 and E CP15 bought.

## 2 · ⛔ THE INVALID WAS MINE — AND IT FAILED CLOSED

```
current: collected is 0 — the suite did not run
```

…for a run that collected **24,445**.

**`extract/<run>/` is not a record yet.** `summary.json` is written into it by the **publish**
step, which runs *after* the diff step. So `load_record` found no summary, `collected` was
absent, and the guard fired.

⭐ **The tool was right and the wiring handed it a directory that was not what it claimed to
be.** Two things made this one read rather than an investigation:

1. it **named the field** (`collected is 0`) instead of saying "invalid"; and
2. `current_ran: 44353` sat in the same JSON, proving the junits had been read perfectly —
   so the fault could only be the summary.

**Fixed** by making the current directory a real record before it is read
(`cp record.json extract/<run>/summary.json`). ⛔ **Controlled three ways**, and the third is
the one that matters: *with* a summary the **same inputs** are `NO_NEW_FAILURES` — otherwise
"a missing summary is INVALID" is satisfied by a function that always returns INVALID.

## 3 · ⚠️⚠️ AND IT MEASURED SOMETHING MORE IMPORTANT THAN ITS OWN BUG

Between run **#19** and run **#21** the **test code did not change** — only the workflow did.
**Three tests changed state anyway:**

| | test |
|---|---|
| **NEW** | `tests.test_massive_ws_stop::test_stop_sends_close_frame_and_joins` |
| **FIXED** | `tests.test_mutation_check.TestRestoreGuarantee::test_the_file_is_byte_identical_after_a_detected_mutation` |
| **FIXED** | `tests.test_ticker_logos_prewarm::test_run_pass_skips_warm_and_resolves_cold` |

⭐ And `test_ticker_logos_prewarm` was one of the **two NEW** in the #18 → #19 diff. **It flaps
both ways**, across three consecutive runs.

⛔⛔ **SO A STRICT "ANY NEW → FAIL" GATE WILL FIRE ON NOISE.** At roughly three flapping tests
per run, the gate raises a false alarm most runs, and **a gate that cries wolf is muted inside
a week** — `lesson_a_monitor_grading_a_population_that_cannot_answer`, and the reason this
programme refuses gates that cannot distinguish.

⛔ **Filed as a finding, NOT fixed here.** A flake policy is a design decision, not an
implementation detail. Three candidates are in OPEN QUESTIONS:

1. **re-run the NEW set once** before declaring — standard, costs one short re-run;
2. **a known-flaky list** — drifts like every hand-kept list, and needs its own rail;
3. **require NEW to persist across two consecutive runs** — no re-run cost, one run of
   latency, and it cannot be gamed by a list.

⭐ **The gate earned its keep on its first run** by measuring the very thing that decides
whether it can ever be promoted.

## 4 · ⛔ PROMOTION IS NOT OWED YET

E's rewritten criterion needs **both** verdicts in the record: `NEW_FAILURES` on at least one
run **and** `NO_NEW_FAILURES` on at least one. Run #21's **INVALID is neither**.

## 5 · Files

```
.github/workflows/full-suite-report.yml   (the current dir is made a real record first)
tools/ci_inventory.py                     (three controls for the missing-summary case)
```

## 6 · Validators

```
ci_inventory --self-check -> exit 0
check_repo_hygiene        -> clean
```

## 7 · ⚠️ PREDICTION for run #22

| field | prediction |
|---|---|
| verdict | **NO_NEW_FAILURES or NEW_FAILURES** — but **not INVALID**: the summary is now present |
| NEW | **0–3**, and any NEW is expected to be a **flapper**, not a regression |
| MISSING | **0** |
| the arithmetic reconciles | **yes** |

⚠️ **I am deliberately not predicting the verdict itself.** The flake measurement says it is a
coin-toss between the two valid outcomes, and a point prediction here would be a claim about
noise. ⭐ **Either valid verdict advances E's criterion**, which is the honest thing to want
from this run.

## 8 · Drafted ledger row — NOT written

| 102 | `9fa4ee150` | 2026-09-15 | CI | 1 | E CP24: the gate's first run read INVALID (`collected is 0`) for a run that collected 24,445 — `extract/<run>/` has no summary.json until the publish step writes it. The tool was right; the wiring lied about the directory, and it failed closed naming the field. It also measured the suite's flake rate: three tests changed state between two runs of identical test code, so a strict any-NEW gate would fire on noise. Flake policy filed as a finding, not built. |

## 9 · Drafted RESUME delta — NOT applied

- ⛔ **A directory is not a record until it holds what a record holds.** Name the field that
  is missing; "invalid" alone would have cost an investigation.
- ⛔ **Measure the flake rate before promoting any gate that fires on a single run.** Three
  flappers per run turns a gate into noise, and noise gets muted.
- ⭐ An instrument's first real run is worth reading for what it measures, not only for
  whether it worked.

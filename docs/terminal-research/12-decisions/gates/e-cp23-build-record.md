---
id: e-cp23-build-record
unit: E CP23
packet: packet-e-ci-gap-gate
merges-after: E CP22
status: UNSIGNED
---

# E CP23 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **E CP23 — CI's verdict becomes baseline-relative, and it is never "green".** Scope is
> `tools/ci_inventory.py` and `.github/workflows/full-suite-report.yml` **as enumerated by
> `git show --stat` of `953142d0b`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records on
disk are **CP2, CP4–CP22**; manifest rows are **CP2, CP4–CP22** (34 rows total). **CP23 free.**

---

## 1 · Run #19 — E CP21 scored on every line

| E CP21 predicted | actual | |
|---|---|---|
| `LaneUnavailable` entries → 0 | **0** (ENV total 123 → 6) | ✅ |
| pytest `failed` in 60–120 | **85** (from 185) | ✅ |
| `collected` ≥ 24,445 | **24,445** | ✅ |
| `shards_without_totals` / `shards_unreadable` both `[]` | **both `[]`**, 12/12 success | ✅ |
| longest shard under 1000 s | **924 s** (`tests-07`) | ✅ |

**The watch item is closed by measurement:** `npm ci` costs **6–9 s** per shard on the warm
cache, and the two closest to the cap keep **287 s** and **276 s** of headroom. ⛔ No shard is
within 200 s, so **no split is owed**.

## 2 · ⭐⭐ THE DIFF SAYS IT EXACTLY, AND THE COUNT DID NOT

Inventory alone: run #18 `249 entries / 123 ENV / 126 PRODUCT` → run #19 `122 / 6 / 116`.
That reads as *"ten fewer product failures"*, which is not what happened.

**The diff, baseline #18 → current #19:**

```
NEW 2 · FIXED 129 · UNCHANGED 120 · MISSING 0
baseline 249 = unchanged 120 + fixed 129 + missing 0  |  current 122 = unchanged 120 + new 2
```

⭐ **"116 vs 126" tells you almost nothing. "129 FIXED, 0 MISSING, 2 NEW" tells you
everything** — and that is the argument for a diff rather than a count.

⚠️ **Ten PRODUCT-classified entries disappeared when the environment was fixed**, which means
`ci_inventory` under-counted ENV. That is the classifier's designed failure direction working:
it fails toward *"a human must look"*, never toward *"probably just the environment"*.

## 3 · The gate

`NO_NEW_FAILURES` / `NEW_FAILURES` / `INVALID` / `DID_NOT_RECONCILE`, against a **named**
baseline run. ⛔ **Never the word green.** A suite with ~85 failing pytest entries on a good
day cannot wait for zero, and a gate that says green when it is quiet is the
`lesson_gate_that_cannot_fail` shape.

⛔ **MISSING IS NEVER COUNTED AS FIXED.** A test that stopped being collected leaves the
failure list exactly as a test that started passing does — one is progress, the other is
coverage walking out. The record carries **every shard's junit** (24,454 pytest testcases +
19,900 vitest), so *"did this run in the current record"* is answered **exactly**. ⛔ With no
junit readable the verdict is **INVALID**, because FIXED and MISSING then cannot be told
apart at all.

### ⛔ Why the diff STEP cannot be the thing that fails

It runs **inside the publisher**. **E CP17** is this programme's record of a verification line
that could destroy the thing it verified — an artifact check that also pushed, left
`.git/rebase-merge` behind, and cost five runs. So the diff is computed there (so it publishes
**with** the record) and the job that **fails** is `gate`, which runs after the record is
safely on the branch. `continue-on-error: true` sits at the **gate job** level; ⛔ promotion is
removing that line and adding the check to branch protection — **a separate checkpoint**.

## 4 · ⚠️ A BASELINE ACCEPTS EVERYTHING IN IT

`BASELINE_RUN_ID = 35008710335` (run #19 — 12/12 shards, `unreadable []`, per the owner's
rule). It carries **122 failure entries**, including the two that E CP21's install newly
revealed:

- `tests.test_ast_math_parity::test_the_two_lanes_agree_everywhere` — ⭐ a JS-lane **parity**
  test that **could not run before** and now runs and **fails**: the two lanes do not agree.
  **Fixing the environment revealed a real defect the missing install was hiding.**
- `tests.test_ticker_logos_prewarm::test_run_pass_skips_warm_and_resolves_cold`

⛔ Both are **filed as findings before being baselined**, so the baseline forgives nothing
silently.

## 5 · Controls — the seven asked for, plus four

```
1 identical -> NO_NEW_FAILURES, FIXED 0                         ok
2 one added -> NEW_FAILURES, NAMED                              ok
3 one removed that RAN -> FIXED 1                               ok
4 one removed that did NOT run -> MISSING 1, FIXED stays 0      ok
5 an unreadable shard -> INVALID, naming the field              ok
6 an EMPTY baseline -> INVALID                                  ok
7 a failure in BOTH -> UNCHANGED (the tool still sees failures) ok
+ the verdicts do not collapse to one                           ok
+ a clean diff reconciles, and the arithmetic is printed        ok
+ the RAN count is reported                                     ok
+ no junit readable -> INVALID, FIXED cannot be guessed         ok
```

⛔ **Control 7 is the pair control**: without it, *"no false NEW"* is satisfied perfectly by a
tool that sees no failures at all.

## 6 · Files

```
tools/ci_inventory.py                     (entry_key, ran_keys, diff, render_diff, load_record)
.github/workflows/full-suite-report.yml   (BASELINE_RUN_ID; diff step; gate job)
```

## 7 · Validators

```
ci_inventory --self-check  -> exit 0
yaml.safe_load             -> OK, 6 jobs, gate needs [publish], if always(), continue-on-error
bash -n on both new step bodies -> PARSES
check_workflow_expressions -> exit 0, 22 expressions
check_repo_hygiene         -> clean
actionlint                 -> UNREADABLE-TOOL (not installed)
```

## 8 · ⚠️ PREDICTION for the next run (recorded before pushing)

| field | prediction | actual (run #21) | |
|---|---|---|---|
| verdict | **NO_NEW_FAILURES** | **INVALID** | ❌ |
| NEW | 0 | **1** | ❌ |
| FIXED | 0 | **2** | ❌ |
| MISSING | 0 | **0** | ✅ |
| the gate job RUNS and reports | yes | **yes — verdict on the job page, annotated** | ✅ |

⚠️ **The risk I named — "a flaky test would show as NEW" — is exactly what happened**, and
E CP24 is where it is measured. The INVALID was a wiring defect of mine, also E CP24.

## 9 · Drafted ledger row — NOT written

| 101 | `953142d0b` | 2026-09-15 | CI | 1 | E CP23: CI's verdict becomes baseline-relative — NO_NEW_FAILURES / NEW_FAILURES / INVALID / DID_NOT_RECONCILE against a named baseline run, never "green". MISSING is never counted as FIXED: the record's shard junits answer "did this run" exactly, and with no junit the verdict is INVALID. The diff step inside publish can never fail (E CP17's rule); the gate job is what fails, and continue-on-error sits there until promotion. |

## 10 · Drafted RESUME delta — NOT applied

- ⛔ **A gate on a suite that is never green must be baseline-relative**, and must say
  NO_NEW_FAILURES rather than green.
- ⛔ **MISSING is not FIXED.** Read the junits; do not infer from a collected count.
- ⛔ The step that computes a verdict inside a publisher must not be the step that fails on it.
- ⛔ **A baseline accepts everything in it** — file the findings before you baseline them.

---
id: e-cp25-build-record
unit: E CP25
packet: packet-e-ci-gap-gate
merges-after: E CP24
status: UNSIGNED
---

# E CP25 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  768f6e2fc
SCOPE APPROVED:   CP25 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP25 — F-CI-30: the flaky set is DERIVED from the record, and NEW excludes it.**
> Scope is `tools/ci_inventory.py` and `.github/workflows/full-suite-report.yml` **as
> enumerated by `git show --stat` of this unit's commit.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3** (lines 65–67);
build records on disk are **CP2, CP4–CP24** (22 files); manifest rows run to **CP24**.
**CP25 free.**

---

## 1 · The decision this implements

The owner's F-CI-30: a test is FLAKY if the record shows it in **both states across ≥2 runs
at the same commit SHA**, or **across consecutive runs whose diff touched no file that test
imports**. It leaves after **K = 5** consecutive stable runs. The gate reports NEW
**excluding** FLAKY, plus FLAKY_NEW / FLAKY_FIXED / FLAKY_SIZE. **No rerun-on-failure.**

⛔ **No hand-maintained quarantine list exists anywhere, and none can.** The set is
re-derived from the record on every run — there is no file to edit, so a test cannot be
added to it by anybody, and it leaves the moment the evidence stops.

## 2 · ⚠️⚠️ THE SECOND LIMB, READ LITERALLY, IS WRONG — AND THE RECORD PROVES IT

Runs **#18 and #19 differ by ONE file**, `.github/workflows/full-suite-report.yml`, which
**no test imports**. A literal reading calls that pair comparable. Measured:

```
#18 -> #19   ran in both 44,353   FLIPPED 130
```

Those 130 are E CP21's `npm ci` fix — 129 real repairs and one real regression. **A literal
reading of the rule would have classified the single most valuable diff in this record as
noise**, and the gate would have gone quiet about it.

⭐ **So a workflow file is judged by WHICH JOB changed.** The suite-running jobs are
DERIVED from the workflow's own steps (`runs_suite` + a job-name test), never listed:

| pair | comparable | why |
|---|---|---|
| #15 → #16 | no | the workflow's **pytest** job changed |
| #16 → #17 | no | the **pytest** job + `ci_extract.py`/`ci_summarize.py` are referenced by source |
| #17 → #18 | no | `ci_aggregate.py` is referenced by 2 source files |
| #18 → #19 | no | the **pytest** job changed — the `npm ci` fix |
| **#19 → #20** | **yes** | only `tools/ci_inventory.py`, referenced by **0** source files |
| #20 → #21 | no | the workflow changed **outside `jobs:`** — every job sees that |
| **#21 → #22** | **yes** | the workflow's **publish** job + `ci_inventory.py` |

**2 of 7 consecutive pairs were comparable**, and they yield **FLAKY_SIZE = 5**:

```
tests.test_ticker_logos_prewarm::test_run_pass_skips_warm_and_resolves_cold   #19→#20, #21→#22
tests.test_massive_ws_stop::test_stop_sends_close_frame_and_joins             #21→#22
tests.test_mutation_check.TestRestoreGuarantee::…byte_identical…              #21→#22
tests.test_mutation_check.TestVerdicts::test_expect_red_naming_the_right_test_passes  #21→#22
src/pages/screener/ScreensManager.test.jsx :: …a second attempt replaces…     #21→#22
```

⭐ E CP24 named three of these by reading two diffs by hand. **They are now derived by a
rule that can be checked**, and two of them are in the same file moving in opposite
directions — the signature of order or parallelism, not of a product change.

## 3 · ⛔ THE FIRST LIMB HAS NO EVIDENCE AT ALL, AND THAT IS WORTH SAYING

**No commit SHA appears twice in the record.** Every published run is at a distinct SHA, so
*"both states at the same SHA"* — the strongest form of the rule and the one that needs no
reasoning about imports — has **never once been available**. The whole derived set today
rests on the second limb. The cheapest way to change that is one `workflow_dispatch` re-run
at an unchanged SHA, which costs no code.

## 4 · What the gate does with it

`NEW` is reported **excluding** FLAKY; the excluded entries are printed by name in their
own bucket and in `results/<run_id>/flaky_findings.md`. ⛔ **The arithmetic still closes
over every entry** — `current = unchanged + new + new-but-flaky` — because subtracting a
term without carrying it turns the reconciliation into a check that cannot fail.

⛔ **A flaky test is not fixed, not forgiven and NOT RE-RUN.** It is a test whose result
this suite cannot tell apart from noise.

## 5 · `fetch-depth: 0`, on ONE job (F-CI-32)

The equivalence question is `git diff <shaA> <shaB>` plus `git show <sha>:<workflow>` over
commits a depth-1 checkout does not have. Applied to the **publish** job only — the twelve
pytest shards are the expensive place to be wrong, and publish is the only job that needs
history. ⛔ **With a shallow checkout the answer is UNREADABLE, which is NOT "comparable"**:
the set comes back empty, every NEW entry fires the gate, and the gate behaves exactly as
it did before. The added wall-time is measured on this run.

## 6 · Controls (26 new rows in `--self-check`)

```
runs_suite: a real invocation / behind a WRAPPER / npx vitest / npm run test   -> True
runs_suite: a summary-table LABEL / a COMMENT / a FLAG / a FILENAME /
            an ARGUMENT to another tool                                        -> False
workflow_test_jobs finds the suite job, and NOT the publishing job             ok
SAME SHA + a flip -> FLAKY, by name                                            ok
an UNCOMPARABLE pair contributes NOTHING, and is UNREADABLE not "not equivalent" ok
a test absent from one run's junit is NOT flaky                                 ok
5 stable runs -> RETIRED · 4 is not enough · a NOT-COLLECTED run breaks it      ok
NEW excludes the flaky entry, names it in its own bucket, verdict still fires   ok
a run whose ONLY new entry is flaky -> NO_NEW_FAILURES, arithmetic reconciles   ok
...and with NO flaky set the same run FAILS                                     ok
```

⛔ **The load-bearing control is the UNCOMPARABLE pair.** Without it, *"a flip makes a test
flaky"* is satisfied perfectly by a tool that calls every regression noise.

⛔ **And `runs_suite` was wrong twice before it held** — first matching the whole job blob
(calling `publish` a test job), then matching `# E CP6: pytest is now N shards` (a COMMENT)
and `print("| pytest | %s |")` (a table LABEL). **CODE, NEVER PROSE** — the sixth and
seventh instances in this programme. The third version reads the token BEFORE the tool, so
`--suite vitest` is an argument and `/usr/bin/time -v python -m pytest` is a command; that
wrapper case was a false NEGATIVE, which is the direction that invents flakes.

## 7 · Files

```
tools/ci_inventory.py                     (runs_suite, workflow_test_jobs, runs_equivalent,
                                           flaky_set, render_flaky, collect_runs, --flaky)
.github/workflows/full-suite-report.yml   (fetch-depth: 0 on publish; the record store is
                                           materialised; the flaky set is derived and
                                           written into the record)
```

## 8 · Validators

```
ci_inventory --self-check         -> PASS, exit 0 (26 new rows)
ci_inventory --flaky (real record)-> FLAKY_SIZE 5, exit 0
yaml.safe_load                    -> OK, 6 jobs, publish has fetch-depth 0
bash -n on both new step bodies   -> PARSES (+ a deliberately-broken control REJECTED)
check_workflow_expressions        -> exit 0, 22 expressions
check_repo_hygiene                -> clean, no line-ending flip
```

## 9 · ⚠️ PREDICTION for the next run (recorded before pushing)

| field | prediction |
|---|---|
| `fetch-depth: 0` adds to the **publish** job | **≤ 60 s** — if more, it is reverted, not kept |
| the record store materialises | **yes**, 11–13 runs |
| FLAKY_SIZE | **5 or 6** — 5 derived now, plus any flip this run adds |
| FLAKY_NEW | **5** — the previous run had no flaky machinery, so the first derivation is all new |
| verdict | **NO_NEW_FAILURES or NEW_FAILURES**, not INVALID |
| a NEW entry that is one of the five | **excluded**, and named in its own bucket |

⚠️ **I am not predicting the verdict.** The flake rate says it is a coin-toss between the
two valid outcomes, and a point prediction there is a claim about noise.

## 10 · Drafted ledger row — NOT written

| 104 | *(this unit's commit — named in the session report)* | 2026-09-15 | CI | 1 | E CP25: F-CI-30's flaky set is DERIVED from the record — no quarantine file exists and none can. The rule's second limb, read literally, calls #18→#19 comparable and would have booked E CP21's 129 real repairs as noise; a workflow file is therefore judged by WHICH JOB changed, derived from its own steps. 2 of 7 pairs are comparable and yield 5 flaky tests, including the three E CP24 found by hand. NEW excludes them and the arithmetic still closes over every entry. `fetch-depth: 0` on the publish job only; a shallow checkout reads UNREADABLE, which is not comparable. |

## 11 · Drafted RESUME delta — NOT applied

- ⛔ **A rule about "what could have caused this" must be applied to the ENVIRONMENT as
  well as the code.** A workflow file imports nothing and changes everything.
- ⛔ **CODE NEVER PROSE, twice in one function.** A needle that reads a `run:` block must
  strip comments AND quoted strings, and a command is identified by the token before it.
- ⛔ **A false negative in a classifier that decides "could anything explain this" invents
  findings.** Check both directions of the miss, not just the false positive.
- ⭐ **The control that matters is the pair that is NOT comparable.** Without it the tool
  is free to call every regression noise, and nothing would fail.

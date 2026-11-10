# PR: shard the full-suite vitest job 4 ways, and keep its record honest

> Branch `agent/pl/full-suite-shard`, cut from master `b554908dda`. REPORT-ONLY workflow
> (`promotion-gate: no`). No release gate changes.
> **Local checks only:** every changed tool's `--self-check` passes, `py_compile` passes, the YAML parses (PyYAML 6.0.3 and
> js-yaml), and the plan script ran against a local vitest 4.0.18 checkout. The new pytest file
> `tests/test_ci_inventory_vitest_shards.py` runs **in CI only**: pytest was not run locally.

## Summary
The nightly workflow `full suite (report-only)` ran vitest as one job with `timeout-minutes: 100`. Every nightly since
2026-10-28 was killed at that limit (GitHub shows "cancelled"). So no run had a totals line, and every vitest record was
INVALID. This PR:
- runs vitest as `--shard=i/4`, a 4-job matrix with a 60-minute limit per shard;
- proves in `plan`, before any shard runs, that the 4 shards partition the test files;
- builds the vitest record as the **sum** of the 4 shard logs, using pytest's shard-bucket logic. If any shard is
  missing, killed, unreadable or has no totals line, the record is INVALID.
- records a run that GitHub cancelled before it started as NOT_RUN;
- stops a manual re-run from overwriting attempt 1's record.

## Requirements: where each one is implemented

| # | Requirement | Where |
|---|---|---|
| 1 | 4-way matrix, `--shard=${i}/4`, one artifact per shard, pattern download, 60 min | `.github/workflows/full-suite-report.yml`: job `vitest`. Its `strategy.matrix.shard` comes from `needs.plan.outputs.vitest_shards`. Step `Run` passes `--shard=${{ matrix.shard }}/${{ needs.plan.outputs.vitest_shard_count }}`. `timeout-minutes: 60`. The upload is named `vitest-log-${{ matrix.shard }}` (log + junit). In `publish`, `download-artifact` uses `pattern: vitest-log-*`, `path: vshards` and `merge-multiple: false`. The shard count is set once, in `tools/vitest_shards.py` (`COUNT = 4`). |
| 2 | Summed totals; each shard keeps its own line | `tools/ci_aggregate.py` `aggregate_vitest()`, run by `publish` step `Summarise` (`ci_aggregate.py --suite vitest`, which calls `_main_vitest()`). It sums `collected`/`passed`/`failed`, `skipped` (skipped + todo, as `ci_summarize` reads them) and `files_collected`/`files_failed`/`files_passed`/`files_skipped`. Each shard's own `tests_line`, `runner_line`, counts and runner `elapsed_s` are kept in `shard_totals.<i>`. `totals_line_found` is True only when **every** expected shard printed one. `tools/ci_summarize.py` `summarize()` now also reads the `Test Files` line (`files_*`, `tests_line`). |
| 3 | `shards_missing` / `shards_without_totals` / `shards_unreadable`; any gap ⇒ INVALID; tests | The fields are produced by `aggregate_vitest()`, which reuses `aggregate()`'s pytest bucket logic. `shards_unreadable` also names a shard whose log exists but cannot be read. `shards_not_run` is new. `tools/ci_inventory.py`: `vitest_shard_problems()` mirrors the pytest shard checks field for field and is called from `diff()` (gives INVALID) and from `record_is_valid()` (such a record is never a baseline). `tools/ci_record.py` `build_record()`: a sharded vitest record is GREEN only if the aggregate's `ok` is True as well. Tests are in `tests/test_ci_inventory_vitest_shards.py`: `test_three_of_four_shards_is_invalid`, `test_a_shard_log_without_a_totals_line_is_invalid`, `test_all_four_shards_is_valid_and_the_totals_are_the_sum`, `test_a_single_shard_line_never_passes_for_the_whole_suite` and `test_an_empty_plan_output_falls_back_to_the_tools_own_shard_list`. |
| 4 | Partition proof in `plan` | `plan` steps `Install (vitest is needed …)` and `Prove the vitest partition, then emit it`. They run `app/scripts/vitest-shard-plan.mjs`, then `tools/vitest_shards.py --prove` (`prove()`). See "Partition proof" below. |
| 5 | Each shard keeps its own "no totals line ⇒ error" assert; merged junit only for failure names | The `vitest` step `Assert the run produced a totals line` is unchanged and runs in every shard. `tools/ci_extract.py` `merge_junit()` + `run()` merge the shard junits into `extract/<run>/vitest-junit.xml`. That file is used only for failure names (`vitest_failures.txt`) and for the RAN set that `ci_inventory.ran_keys` already read from it. Counts never come from a junit. |
| 6 | Timing basis | The comment above `timeout-minutes: 60`, and "Timing" below. |
| 7 | Queue, never cancel; a cancelled never-started run is "not run"; test | `concurrency` is unchanged (`cancel-in-progress: false`), with a comment added. `tools/ci_outcome.py` adds `job_never_started()`, and `fields()` now returns `ran: False`, `timed_out: False` and a basis starting "NOT RUN". `tools/ci_inventory.py` adds `classify_run()` (NOT_RUN / CANCELLED_AFTER_START / COMPLETED / IN_PROGRESS / UNREADABLE) and the CLI `--classify-run RUN_JSON --jobs JOBS_JSON`. `aggregate_vitest()` lists such shards in `shards_not_run`. Tests: `test_a_queued_run_cancelled_before_it_started_is_not_run` and `test_a_never_started_shard_is_named_not_run_and_the_record_is_invalid`. |
| 8 | No retry laundering | See "No retries" below. Code: `tools/ci_publish.py` `record_dest()` + `--record-dest`, used by the `Publish onto the orphan ci-results branch` step. `tools/ci_inventory.py` `rerun_flaky()` is reported in `diff.json`. The `Diff against the baseline` step judges attempt 1. `tools/ci_record.py` adds `run_attempt`. Tests: `test_a_manual_rerun_never_overwrites_attempt_one` and `test_failed_on_attempt_one_and_passed_later_is_flaky_not_green`. Workflow rail: `test_one_nightly_queue_not_cancel_and_no_retry_automation`. |
| 9 | Exactly one nightly | The existing `schedule: - cron: '30 7 * * *'` (07:30 UTC) and `workflow_dispatch` are unchanged, and no trigger is added. This is pinned by `test_one_nightly_queue_not_cancel_and_no_retry_automation`. |

## Partition proof (requirement 4): why it does not use `vitest list --shard`
The suggested `npx vitest list --shard=i/4 --filesOnly` **does not work on this repo's vitest (4.0.18)**:
- Source, `node_modules/vitest/dist/chunks/cac.*.js`: `list --filesOnly` prints `getRelevantTestSpecifications()` and
  returns. `--shard` is applied only in the pool's `executeTests` (`sequencer.shard(specs)`), which runs at test time.
- Measured on a local checkout: `vitest list --filesOnly` printed 4,581 files, and `vitest list --filesOnly --shard=1/4`
  printed the same 4,581.

A proof built on that command would compare four copies of the same list.

So `app/scripts/vitest-shard-plan.mjs` asks vitest itself for two things:
- the relevant specs, using the same call as `list --filesOnly`;
- the configured sequencer class (`config.sequence.sequencer`), which is the class `vitest run --shard=i/n` creates.

It then calls that class's `shard()` once per index. Nothing is re-implemented. `tools/vitest_shards.py --prove` then
checks that:
- the union equals the full list;
- no file is in two shards;
- no file is in no shard;
- no shard is empty or absent;
- the plan's count matches.

Local run (vitest 4.0.18, `BaseSequencer`): 4,581 files split 1,146 / 1,145 / 1,145 / 1,145, with union = full, overlap
0 and missing 0.

**On failure the plan job fails.** That matches the file's existing approach: the pytest `--self-check` in the same job
also fails `plan`, and "the partition is PROVED before it is used". Every suite job `needs: plan`, so nothing runs on an
unproved plan. `publish` (`if: always()`) still writes the record. In that case `--expect` is empty, so
`ci_aggregate --suite vitest` falls back to the tool's own shard list, every shard reads MISSING, and the vitest record
is INVALID. The failure is recorded, not silent. **Cost:** `plan` now runs `setup-node` + `npm ci`, about 1–2 minutes.

## Timing (requirement 6)
**Per-shard wall time is NOT yet measured.** The only basis is arithmetic: the unsharded job ran past 100 minutes and
was killed. Divided by 4, that is about 25+ minutes of tests per shard, plus about 3–5 minutes of setup (checkout with
full history, pip install, `npm ci`). The per-shard limit is set to **60 minutes**, which leaves room. Each shard's
measured runner time is recorded in the vitest record as `shard_totals.<i>.elapsed_s`, and the step summary prints it.
**The first 3 nightly runs will report measured per-shard wall times.** Limits come down once shards prove their
duration; they are never raised.

## No retries (requirement 8)
- **There are no automatic retries anywhere:**
  - no retry loop around any test command;
  - no retry action;
  - no `gh run rerun` / re-run-failed-jobs automation.
- A test rail checks the workflow for these. (`ci_publish.push_with_retry` is the existing bounded git fetch/rebase/push
  of the record onto `ci-results`. It never re-runs a test.)
- **A failed, killed or missing shard makes the vitest record INVALID. It is not retried.**
- If a run is ever **re-run by hand**:
  - GitHub keeps the run_id and increments `GITHUB_RUN_ATTEMPT`.
  - Attempt 1 stays the record: it publishes to `results/<run>/`. Later attempts publish to
    `results/<run>/attempt-<n>/`, and `record_dest()` refuses (exit 1) to overwrite any existing `summary.json`.
  - The diff step judges attempt 1's record, so a re-run cannot turn the check green.
  - A test that failed on attempt 1 and passed later is listed as **FLAKY** in `rerun_flaky`. It is not removed from
    NEW and not counted as FIXED.
  - `collect_runs` / `previous_valid_master_run` only read top-level `results/<run>/` directories, so an attempt
    directory is never treated as a run of its own.

## Concurrency (requirement 7)
- The group `full-suite-${{ github.ref }}` keeps `cancel-in-progress: false`: a newer run waits in the queue and never
  kills the running one.
- GitHub keeps only **one pending run per group**, so a third trigger cancels the run that is already waiting. That run
  never starts and publishes nothing.
- When runs are counted, `ci_inventory.py --classify-run` reports it as **NOT_RUN**, never as a result and never as a
  timeout. A test covers this (`test_a_queued_run_cancelled_before_it_started_is_not_run`).
- If one shard job inside a running run is cancelled before it starts, `ci_outcome.fields()` gives it `ran: False` /
  `timed_out: False`, and `aggregate_vitest()` lists it in `shards_not_run`. Its totals are still absent, so the record
  is still INVALID.

## Billing basis
- The repository is **public** today. The Actions timing API reported billable `UBUNTU` `total_ms = 0` for the last
  full-suite run, **42667161827**. While the repo is public, standard GitHub-hosted runners cost about **$0**.
- The 4 shards add parallel runner minutes: about 4 × (25–35) minutes, compared with one job at 100+ minutes. There is
  also about 1–2 minutes of `npm ci` in `plan`. Neither is billed while the repo is public.
- **If the repo goes private, the cost estimate must be redone BEFORE the nightly continues.** The workflow header
  records that on private billing this workflow was about 85% of Actions usage when it ran on every push.

## Owner conditions
- **One nightly run.** One cron entry; no push or pull_request triggers.
- **No overlap.** The concurrency group queues runs and never cancels the running one.
- **No automatic retries.** A failed shard is INVALID, not retried.
- **Report the first 3 nightly runs**, each with:
  - its duration (per shard, from `shard_totals.<i>.elapsed_s`, plus the whole run);
  - its billable minutes (Actions timing API);
  - its failures (by name, from `vitest_failures.txt` / the diff);
  - schedule reliability (did each 07:30 UTC run start, and was any run NOT_RUN).
- **Pause and escalate if any cost appears**, meaning billable minutes above 0.

## Files
- `.github/workflows/full-suite-report.yml`:
  - `plan`: the vitest partition proof and its outputs;
  - `vitest`: the matrix, `--shard`, 60-minute limit, one artifact per shard;
  - `publish`: pattern download, shard-aware artifact check, `ci_aggregate --suite vitest`, merging of the shard
    junits, `SUITE_TIMEOUT_MINUTES` corrected from 45 to 60 (the real vitest limit), shard lines in the step summary,
    the attempt-1 diff on re-runs, and `--record-dest` on publish;
  - a comment on the concurrency block.
- `app/scripts/vitest-shard-plan.mjs` (new): vitest's own shard plan, written as JSON.
- `tools/vitest_shards.py` (new): `COUNT`, `shard_ids()`, `prove()`, `--count/--list/--prove/--self-check`.
- `tools/ci_aggregate.py`: `aggregate_vitest()`, `--suite vitest` (`_main_vitest()`), and self-check cases.
- `tools/ci_summarize.py`: the vitest `Test Files` counts and `tests_line`, plus a self-check case.
- `tools/ci_inventory.py`: `vitest_shard_problems()` (used by `diff()`, `record_is_valid()` and the baseline exclusion
  reason), `classify_run()`, `rerun_flaky()`, `--classify-run`, and `run_attempt`/`rerun_flaky` in `diff.json`, plus
  self-check cases.
- `tools/ci_outcome.py`: `job_never_started()`, `ran`, the NOT RUN basis, and self-check cases.
- `tools/ci_extract.py`: `merge_junit()`, a repeatable `--vitest-junit`, an UNREADABLE note when no named junit could
  be read, and self-check cases.
- `tools/ci_record.py`: `run_attempt`; a sharded vitest record is GREEN only if the aggregate's `ok` is True.
- `tools/ci_publish.py`: `record_dest()` + `--record-dest`, and a self-check case. It also fixes a self-check that was
  already red at `b554908dda`: it counted the `gate` job's `python - <<'PY'` heredoc as a path under `tools/`.
- `tests/test_ci_inventory_vitest_shards.py` (new): 12 tests. They run in CI only.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

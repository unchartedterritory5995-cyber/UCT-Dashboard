# PR: required-check aggregators (step 1 of REQUIRED CHECKS)

Branch `agent/pl/required-checks`, cut from origin/master `0a0737665a`. Workflow commit `8b4365d15a`.
This PR changes workflows only. **The `master requires CI` ruleset is not part of it.** The owner applies the ruleset
only after the verification PRs below pass. Design source: the AUDIT-approved REQUIRED-CHECKS proposal (pl-ci, 2026-11-10).
Labels: **[verified]** = run locally in this session. **[plan]** = the Lead runs it on GitHub after merge.

## Files (`git diff --stat origin/master..8b4365d15a`)
```
 .github/workflows/agent-ci.yml         | 123 +++++++---
 .github/workflows/notebook-a11y.yml    |  74 +++++-
 .github/workflows/notebook-bytes.yml   |  76 +++++-
 .github/workflows/notebook-latency.yml |  78 +++++-
 .github/workflows/secret-scan.yml      |   2 +
 .github/workflows/term018-guards.yml   |   2 +
 .github/workflows/vite-build-args.yml  |  75 +++++-
 .github/workflows/wisdom-rails.yml     |   2 +
 tests/test_ci_cost_rails.py            | 172 ++++++++++++-
 tests/test_ci_paths_match.py           | 425 +++++++++++++++++++++++++++++++++
 tools/ci_paths_match.py                | 239 ++++++++++++++++++
 11 files changed, 1202 insertions(+), 66 deletions(-)
```
This doc is the second commit.

## Design (as built)
The 8 contexts and the job that reports each one. `tests/test_ci_cost_rails.py::REQUIRED_CONTEXTS` pins them.

| workflow file | job id | check-run name (the context to require) |
|---|---|---|
| term018-guards.yml | static | `term018 guards (required)` |
| wisdom-rails.yml | rails | `wisdom rails (required)` |
| secret-scan.yml | gitleaks | `secret scan (required)` |
| vite-build-args.yml | required | `vite build args (required)` |
| notebook-bytes.yml | required | `notebook bytes (required)` |
| notebook-a11y.yml | required | `notebook a11y (required)` (the workflow's display name is "Notebook accessibility") |
| notebook-latency.yml | required | `notebook latency (required)` |
| agent-ci.yml | required | `agent ci (required)` |

The 3 workflows with no path filter already run on every PR, so each one's single job only gets a unique `name:`.

The 5 path-filtered workflows each get the following:
1. **The PR trigger has no `paths:`.** `on.push.paths` is unchanged, so master and agent/** push cost stays the same.
   That list is now the only list.
2. **A `changes` job.** It checks out with blob:none, sparse `tools` + `.github`, and full commit history, then runs
   `tools/ci_paths_match.py match`. On a PR, that compares `git diff --name-only --no-renames base...head` against the
   workflow's own `on.push.paths`, plus two files that always count as relevant: the workflow file itself and
   `tools/ci_paths_match.py`. On any other event it returns relevant=true without reading anything.
   A shell template, identical in all 5 workflows, sets relevant=false only when the tool exits 0 AND its output has the
   exact line `relevant=false`.
3. **The real jobs run only when relevant.** Each gets `needs: changes` and `if: needs.changes.outputs.relevant == 'true'`.
4. **A `required` aggregator job.** It is named `<name> (required)`, has `if: always()`, and `needs` lists every other job.
   It runs `tools/ci_paths_match.py verdict --expect <the same list>` against `toJSON(needs)`.

**agent ci, the one `if:` change.** The five jobs carried the clause `push || fork PR`. That clause now lives in
`changes` as `--same-repo-pr-bases master`, and its new effect is that **same-repo PRs into master run the real jobs**.
| event | before | after |
|---|---|---|
| push to agent/** (path hit) | runs | runs |
| fork PR (path hit) | runs | runs |
| same-repo PR into master (path hit) | **skipped** | **runs** |
| same-repo PR into agent/int (path hit) | skipped | skipped (the push run is the verdict); `required` passes |
| any PR, no path hit | workflow not triggered | `changes` + `required` only, ~30 s |
`capability-regression` keeps its literal `needs: capability-regression-clock`, because
`tests/test_uct_agent_capreg_baseline.py` asserts that string. Its `if:` is
`always() && needs.capability-regression-clock.result != 'skipped'`, so it is skipped exactly when the clock legs are.
`union` now has `needs: [changes, browser]`.

**Where this differs from the proposal, and why:**
- The proposal added `branches: [master]` to the four non-agent PR triggers. **Not done.** Today those workflows also
  run on PRs into agent/int, and the master filter would have quietly dropped those checks. Leaving the base open costs
  about 30 s per PR.
- The proposal put the agent ci event clause on each job's `if:`. It now lives once, in `changes`. That removes five
  copies that could drift apart, and the rail checks the one copy.
- An edit to the workflow file itself or to the matcher always counts as relevant. Vite build args' push.paths does not
  list its own file, and this way an edit to the gating machinery runs the jobs it gates.

**Unchanged:** every workflow's `name:` line and `# promotion-gate:` marker, the master deploy gate, promote-production,
and the production ruleset 23711582.

## AUDIT conditions and their evidence
Local run [verified] with the scratchpad pl-grid venv (Python 3.12, pytest):
`tests/test_ci_cost_rails.py` **10 passed**, `tests/test_ci_paths_match.py` **62 passed**, together **72 passed**.
Neighbouring tests that read these workflow files, run against this branch:
- `test_uct_agent_deploy_gate.py`, `test_uct_agent_capreg_baseline.py`, `test_promote_decision.py` and
  `test_promotion_control.py`: **54 passed**.
- `test_notebook_perf_scale_w10.py`, the workflow/promotion tests: **5 passed**.
- term018 `test_the_CI_job_deselects_exactly_the_two_collection_checks`: **passed**.
- `test_tools_pin_the_root.py`: 7 passed and 1 failed. The failure is
  `test_every_tools_api_importer_pins_the_census_or_is_named_exempt`, on agent_eval_ledger.py and other files. It names
  no file from this PR and exists before this PR.

All 8 changed workflows parse with `yaml.safe_load` [verified]. `test_the_eight_required_contexts_exist_and_are_unique`
checks that across every workflow file, no other job has any of the 8 names and no other job name ends in `(required)`.

### C1: the matcher fails safe
- Every error branch in `decide()` returns through one function, `_fail_safe()`, which returns relevant=True.
  `match` always exits 0.
- `test_every_error_path_is_relevant` covers 27 error cases, and every one comes out relevant=True with a "fail-safe" reason:
  - the workflow file: missing, unreadable YAML, not a mapping, `on:` a string, no on.push, no push.paths, empty
    push.paths, push.paths-ignore, a non-string pattern;
  - the diff: empty, git exits 128, git not installed, git timeout, an unexpected exception;
  - the SHAs: no base, no head, malformed (`HEAD~1; rm -rf /`);
  - the agent ci policy given without repo info;
  - each unsupported glob character `! ? [ ] { } + \`, plus a leading-`!` negation.
- **`!` is never handled. It is always fail-safe true.** `test_negation_is_never_silently_ignored` covers it.
- Mutants:
  - In-test: `test_a_mutant_whose_fail_safe_says_false_turns_this_red` changes `_fail_safe` to False, and all 27 cases
    are flagged. `test_a_mutant_that_swallows_errors_as_irrelevant_turns_this_red` makes the catch-all return False, and
    at least 20 cases are flagged.
  - Live, on the file [verified]: with `_fail_safe` changed to False on disk, the suite showed **4 failed, 58 passed**
    (error paths, the mutant control, the CLI and negation). The file was restored and the suite went back to 62 passed.
- The shell around the tool: `test_the_changes_shell_turns_anything_but_a_clean_false_into_true` runs the exact
  `run:` text from the workflow in Git Bash against 9 stub tools: a clean false, a clean true, false then exit 1, a
  crash, an import error, garbage output, `relevant=false ` with a trailing space, no output, and the tool missing.
  Only the clean false yields false. `test_the_changes_step_is_one_template` holds the text identical in all 5 workflows.

### C2: the converter against every real path list
- `test_the_converter_agrees_with_the_oracle_on_every_tracked_file`: for each of the 5 workflows and each push.paths
  pattern, the converter and an independent segment-wise matcher give the same answer on **every file `git ls-files`
  lists** (more than 36,000 files). The independent matcher is fnmatchcase per path segment, with `**` matching whole
  segments. The test also asserts each list has at least one real match and one real non-match.
- `test_hand_picked_real_paths` checks named, tracked files per list. Highlights: deep `**` hits
  (`app/src/pages/charts/grid/GridChartCell.jsx`), dotfiles (`app/src/testing/fundamentals/.gitignore` and
  `api/services/journal_two/.../bin/.gitattributes`), dot-directories (`.github/workflows/notebook-a11y.yml`), and near
  misses (`Dockerfile.web` versus `nixpacks.toml`, and `notebook-bytes.yml` is not in the a11y list).
- `test_star_does_not_cross_a_slash_and_double_star_does`: on real paths, `app/src/*` matches `app/src/App.jsx` and not
  the grid file, while `app/src/**` matches both. Also `tools/agent_*`, `**/.gitignore` at the root, and `.` treated as a
  literal.
- Dotfiles: GitHub's own dotfile behaviour is [docs/inferred]. The converter matches dotfiles like any other name, which
  is the safe direction: more files count as relevant, never fewer.

### C3: the aggregator fails closed
- `test_the_verdict` has 20 cases. For a relevant run, each of these FAILS: skipped, cancelled, neutral, failure, a job
  with no result, **a needs entry that is missing**, and no real job at all. A `changes` job that failed, was skipped or
  was cancelled also FAILS, as do relevant values that are empty, garbage (`False`) or missing, bad JSON, an empty NEEDS
  and a JSON list. A run that is not relevant still FAILS if any job failed or was cancelled.
- Mutant: `test_a_verdict_mutant_that_accepts_skipped_turns_this_red`. Live on disk [verified], accepting skipped gave
  **6 failed**.
- Rail (`test_required_aggregators_cannot_be_weakened`): `required.if == 'always()'`, `needs` equals every other job,
  `--expect` equals `needs`, and the verdict reads `toJSON(needs)`. `changes` is unconditional, matches its own file and
  passes the real event. Every real job is gated, with capability-regression as the one pinned exception.
- Mutants (`test_the_aggregator_rail_can_fail`): each of these turns the rail red: dropping **each** job from `needs` in
  turn, `if: success()`, removing `if`, re-adding PR paths, a PR trigger without master, ungating `server`, `union`
  without `changes`, capability-regression `always()`, a desynced `--expect`, a hard-coded EVENT, and removing
  push.paths. Live on disk [verified], dropping `union` from agent-ci's `needs` gave **2 failed** (the rail and its control).

### C4: push events and promotion
- `test_every_non_pr_event_is_relevant_even_with_no_workflow` covers push, workflow_dispatch, schedule, merge_group and
  an empty event: relevant=true, and git is never called.
- Promotion map [verified]: `promotion_gate.read_workflow_dir()` returns an **IDENTICAL** `{workflow name: yes|no}` map on
  origin/master and on this branch (20 workflows, 0 unclassified).
- `python tools/promote_dryrun.py --now 2026-11-10T14:31:00Z` [verified] exits 0, with
  `CONTROL: target == gated candidate: True; != ungated master tip: True; production unchanged: True`.
  This is equal by construction: the dry run copies only promote/gate files, and this PR touches none of them.
- **Post-merge proof [plan]:** let `M` be the merge SHA.
  1. Run `gh run list --commit M --json name,event,status,conclusion,databaseId --limit 50`.
     - Every push-event run of the gating workflows should be `success`: term018 guards, wisdom rails, notebook bytes,
       Notebook accessibility and notebook latency.
     - Notebook bytes, a11y and latency list their own file in push.paths, so they run on M. Vite build args does not
       list its own file, so expect no vite run on M. That matches today's behaviour.
     - Expect no agent ci run, because it never runs on master.
  2. For one of them, run `gh run view <id> --log | grep -E "event 'push'|decision: relevant"`. Expect
     `decision: relevant=true` and the real jobs to have run.
  3. The `master deploy gate` run on M: `success`.
  4. The `promote to production` run that follows: the PROMOTE decision, and
     `git ls-remote origin refs/heads/production` = M, or the later SHA it gated. Check the gate run id and do not trust
     headSha alone: see memory "Promotion headSha trap".
  5. Compare: the conclusions match the previous master SHA's run list, and promotion behaves the same.

### C5: verification-PR plan [plan; the Lead runs it after this PR merges and before the ruleset]
Push each branch once, open the PR, record the run ids in the AUDIT note, and close every throwaway PR unmerged and delete
its branch. "Real jobs" means the jobs other than `changes` and `required`.

| # | branch | file change | expected checks |
|---|---|---|---|
| a | `fix/reqchk-verify-a-docs` | new `docs/agent/program/REQCHK-VERIFY.md` (1 line) | all 8 `(required)` success in about 2 min. term018, wisdom and secret scan real jobs run. In the 5 aggregated workflows, `changes` logs `relevant=false` and every real job is **skipped**. |
| b | `feat/reqchk-verify-b-app` | a comment in `app/src/App.jsx` + a comment in `app/src/agent/` (one file) | vite `build-args` and `bytes` run. **agent ci real jobs run on the pull_request event**: server, browser ×4, capreg-clock ×2, capability-regression, union. a11y and latency skipped. All 8 success. |
| c | `agent/pl/reqchk-verify-c` | a comment in one `app/src/agent/` file | TWO agent ci runs on the head SHA, one push and one pull_request, both with real jobs and both `agent ci (required)` = success. |
| d | `fix/reqchk-verify-d-red` (DRAFT) | add a read of `import.meta.env.VITE_REQCHK_PROBE` in `app/src/App.jsx` with no ARG in Dockerfile.web | `vite build args (required)` = **failure** because `build-args` is red. The other 7 succeed. Close it unmerged. |
| e | `fix/reqchk-verify-e-agent` (AUDIT) | a comment in ONE file under `app/src/agent/` only | `changes` logs `relevant=true` (`N changed file(s) match, e.g. app/src/agent/...`). **All agent ci real jobs run on the PR event.** `agent ci (required)` succeeds. vite and bytes also run, because `app/src/**` covers that path. |
| f | `fix/reqchk-verify-f-failsafe` (AUDIT, DRAFT) | docs-only, plus append `- 'docs/reqchk?probe.md'` to **vite-build-args.yml on.push.paths** (a `?` the converter refuses) | vite `changes` logs `fail-safe: UnsupportedGlob ...` and `decision: relevant=true`, and **`build-args` runs**. The other 4 aggregated workflows log `relevant=false`. All 8 succeed. Close it unmerged. The edited file also counts as relevant by the own-file rule, so the proof is the **fail-safe reason line**, which `decide()` prints before it looks at the diff. |
| g | (optional) `agent/pl/reqchk-verify-g` with a PR into **agent/int** | a comment in an `app/src/agent/` file | the PR-event agent ci logs `a same-repo PR into 'agent/int'`, its real jobs are skipped, and `agent ci (required)` succeeds. The push run carries the real verdict. |

Pass criterion: every row as stated. If (a) runs any real job, or (d) is green, stop. Do NOT apply the ruleset.

### C6: cost-rail changes in the same commit
`8b4365d15a` contains the workflow edits and all the `tests/test_ci_cost_rails.py` edits. Each edit is commented in the
code and listed with its reason in the commit message:
- UNFILTERED_PR_OK gains 5 entries;
- test_agent_ci_push_and_pr_run_on_the_same_paths is re-expressed;
- REQUIRED_CONTEXTS, REQUIRED_AGGREGATORS and GATED_INDIRECTLY are new pins;
- 4 new rails.
The four unchanged rails still pass: no unfiltered branch push, PR cancel-in-progress, no cancel on master pushes, and the
capreg post-leg rail.

## Cost
For an irrelevant PR, each aggregated workflow adds `changes` (checkout + setup-python + pip, about 20 s) and `required`
(about 10 s). That is roughly 10 small jobs per PR push. Agent-touching PRs into master now pay the real ~55 job-min Agent
suite. Today those PRs skipped it. Standard runners are free on this public repo, so the real cost is queue and wall time.

## Open items for AUDIT
1. **No PR-time CI runs `tests/test_ci_paths_match.py`.** `test_ci_cost_rails.py` also runs only in the master deploy
   gate, after merge. Adding `tests/test_ci_paths_match.py` to the gate's "CI cost rails" step is a one-line edit of
   master-deploy-gate.yml, left out of this PR because the gate is out of scope. A PR that edits the matcher always
   makes all real jobs run, but only while the matcher still works.
2. On a superseded PR run, `if: always()` lets `required` run after the cancel and report failure on the old SHA. That is
   harmless: the new SHA has its own run.

## Rollout and rollback
1. AUDIT reviews this PR line by line → GO → normal merge → the C4 post-merge proof.
   **Rollback now:** a plain revert PR. That is safe while no ruleset exists.
2. The Lead runs verification PRs (a)-(f), and (g) if wanted, and records the run ids.
3. The owner applies the ruleset (proposal §5.4: 8 contexts, source GitHub Actions, empty bypass list, "up to date" off).
   Re-check (a): the badges show "Required". Re-check (d): merge is blocked.
4. **Rollback after step 3, in this order: the OWNER DISABLES the ruleset FIRST** (Settings → Rules → Rulesets →
   `master requires CI` → Disabled). Only then open the revert PR. A revert PR runs the old workflow files, which never
   report the `(required)` names, so with the ruleset active it would block forever. Re-enable the ruleset only after
   the names exist again.
5. Break-glass for a red check unrelated to the PR: fix forward first. Otherwise the owner disables the ruleset, merges,
   re-enables it right away, and records the reason and SHA. Never weaken an aggregator in a PR.

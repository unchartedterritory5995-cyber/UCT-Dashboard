# Notes for AUDIT: draft workflow change

**Status: draft on a local branch, not pushed, nothing approved.** Labels are literal, so a merge with no VPS leaves every
heavy gate job queued and nothing promoted. Safe, but it stops deploys.

**Order, per AUDIT**: owner token change, secret-scan fix (AUDIT), queue rewrite B1 and B2 (AUDIT), routing, VPS purchase and
validation, 10 shadow gates, switch.

## Commits, in the order to take them

| Commit | Content | State |
|---|---|---|
| Routing and fixes | B3, B4, Q2, disk, docs | For review |
| `decide` supersede (Q4) | `tools/promotion_gate.py` and its tests only | Separable. Changes what promotion reads |
| Switch | Eight workflows move to the VPS on master | **HOLD** for 10 shadow gates and the budgets re-baseline |
| `ubuntu-26.04` pin (Q8) | `gate` and `verdict` only, not promote | **PENDING** until a real run proves the label |

`1d6af1cfa2` was reverted rather than rewritten, so the fixes can be taken without it.

## Rulings applied

| # | Ruling | How |
|---|---|---|
| 1 | Split `gate` | New `agent-server` job. `gate` keeps deploy-correctness, production check, secret scan, rails and the boots check |
| 2 | Eight workflows may move | Shadow first (`ci-vps-shadow.yml`), then the switch commit. `vite-build-args`, `notebook-latency`, `clock-parity-fixture` and `indicators-security-suite` never move |
| 3 | Named set at merge-candidate time | `workflow_dispatch` only. PC reports nowhere on GitHub |
| 4 | Rail consolidation | Not done. Later, separate PR |
| 5, Q2 | No token | No `online` step, no `runner-watchdog`. `ci-queue-watch.yml` with `actions: write` is the only offline detection |
| 6 | Proofs | Done for all five jobs now in `verdict.needs` |
| B3 | Reserved gate capacity | `uct-vps-gate` for gate jobs, `uct-vps` for dispatch and nightly |
| B4 | No branch dispatch of the gate | Refused in `concurrency` and as the first step of every job |

## B3: reserved capacity

Two lanes on one VPS. A slot carries one label, so a dispatch or nightly job cannot take a gate slot, and only the gate's heavy
jobs use `uct-vps-gate`: 4 job definitions, **7 jobs at run time** with the 4 shards, not the 6 in your note. Rails hold both sides.

Separately, **a healthy gate cannot be cancelled however long it waits**, because STUCK now means a job queued 45 minutes **and**
nothing on its label moved in 45 minutes. If a job waits, its lane's slots hold running jobs, and a running job resets the clock.
Every gate job's timeout is under 45, and a rail holds that. Unit-tested, including a busy shared lane not counting for the gate lane.

In the switch commit, gating rails use `uct-vps-gate` on a master push too, so they cannot wait behind dispatch work.

## B4: branch dispatch

The concurrency group becomes `refused-dispatch-<run id>` for a dispatch off master, so it never joins `master-deploy`. Every job
starts with a refusal step (in `verdict`, after the fallback label), and `runs-on` sends such a run to hosted, so it never holds a reserved slot.

**The limit**: a dispatch runs the workflow file **on that branch**. A branch that edits the file can remove all of this, or name
`master-deploy` or `uct-vps-gate` in any other workflow. The rails only bind what merges. Removing the Workflows permission from
the PC's token (`OWNER-SETUP.md`) is what closes this for workers.

## Changes, every one

**`master-deploy-gate.yml`**
- `gate`: renamed `deploy-correctness checks`. Lost the server-test step. The "CI cost rails" step also runs `tests/test_ci_runner_routing.py`.
- New `agent-server`, `timeout-minutes: 20`, `fetch-depth: 0`, own production venv, no secret. Its step starts with `test "$(git rev-parse HEAD)" = "$GITHUB_SHA"`.
- `agent-server`, `agent-browser`, `agent-browser-union`, `pine-runtime`: literal `uct-vps-gate`. Hosted only for a dispatch off master (refused) or `lane=hosted-fallback`. No repository variable appears. Timeouts 30, 15, 30, unchanged.
- New `workflow_dispatch` with a `lane` choice, default `vps`.
- `concurrency.group` as in B4. `master-deploy` for every real run, and `cancel-in-progress: false` is unchanged.
- `verdict.needs` gains `agent-server`, required `= success`. The fallback label step lives in `verdict`.

**`agent-ci.yml`**: only trigger is `workflow_dispatch` with `lane`. `server`, `browser`, `capability-regression-clock`, `union` go to `uct-vps`. The `if:` lines that skipped same-repo PRs go. `capability-regression` stays hosted.

**Five rails** (`wisdom-rails`, `term018-guards`, `optionsflow-guard`, `notebook-bytes`, `notebook-a11y`): no `pull_request` trigger. New `workflow_dispatch` with `lane`, `workflow_call` for the shadow, `-${{ inputs.tag }}` on the concurrency group. Dispatch runs on `uct-vps`, a master push stays hosted until the switch.

**Three hosted rails** (`vite-build-args`, `notebook-latency`, `clock-parity-fixture`): no `pull_request` trigger, dispatchable. `runs-on` unchanged.

**Three advisory workflows** (`notebook-budgets`, `preference-allowlist`, `flow-worker-deploy-coverage`): new `workflow_call` and tag. PR triggers and PR legs unchanged (Q7). `flow-worker`'s exit 0 is untouched, and a rail holds it. At the switch their master side moves. `notebook-budgets`' runner claim is updated then, but its budgets are **not re-baselined**: that needs real VPS readings.

**`full-suite-report.yml`**: `vitest`, `pytest`, `collect_profile` to `uct-vps`, `lane` input added. `plan`, `publish`, `gate` stay hosted.

**New workflows**: `ci-queue-watch.yml`, `ci-vps-shadow.yml`, both `promotion-gate: no`.

**Rails edited**: `tests/test_ci_cost_rails.py` (`test_agent_ci_runs_only_when_dispatched`, `UNFILTERED_PR_OK` empty), `tests/test_uct_agent_deploy_gate.py` (`test_no_OTHER_workflow_is_an_agent_gate` accepts a dispatch-only workflow).

**New**: `tools/ci_queue_watch.py`, `tools/ci_equivalence.py`, their tests, `tests/test_ci_runner_routing.py`, `tests/test_ci_runner_launcher.py`, `infra/ci-runner/*`.

**Not changed**: `promote-production.yml`, `joystick-device.yml`, the secret scan, `indicators-security-suite.yml`.

## Running the named set

```sh
B=<branch>; for w in agent-ci vite-build-args notebook-latency clock-parity-fixture wisdom-rails term018-guards optionsflow-guard notebook-bytes notebook-a11y; do gh workflow run $w.yml --ref "$B"; done
```

Confirm every run's `head_sha` is the SHA you mean to merge. Path filters no longer apply, so all nine always run.

## B5: an owner decision. Not decided here

Removing `pull_request` from `agent ci` and the eight rails also removes their pre-merge signal for every team, not only the Agent program. Workers on Agent branches keep a signal from the PC's local run. Other PRs get nothing from these workflows until someone dispatches them.

**Measured, 2026-11-01 to 11-06**: 26 of 112 non-Agent PRs in a 300-PR sample touched paths in `agent ci`'s filter, about 6 a day. Today each of those gets `agent ci` on the PR. Under the draft they get none unless dispatched, and a regression first shows at the master gate, after merge. The gate still refuses promotion, but master is red for everyone by then.

**#869 does not quite fit the description.** It is a 94-file Pine PR, merged 11-05. None of its files match `agent ci`'s path filter, so **`agent ci` did not run on it even today**. It ran 8 checks. Under the draft it would lose 4 of them on the PR: `term018 guards`, `wisdom rails`, `notebook bytes`, `vite build args`. If "Agent files" means something wider than that filter, the filter is a separate gap.

**Option A: as drafted.** Billed cost: nothing added. Pre-merge signal only if AUDIT's queue dispatches the named set, which then covers any branch, with no path filter.

**Option B: a one-minute notice.** A small hosted workflow on `pull_request`, with `agent ci`'s old paths, that passes and says "this PR touches Agent paths: dispatch `agent ci` before merge". It runs no tests, so it costs one job-minute. Its name is outside the named set, so it can neither stop nor satisfy the queue.
- Cost: about 6 PRs a day, at an assumed 3 pushes each, is about 540 billed minutes a month, roughly $3 at $0.006 a minute.
- The dispatched `agent ci` adds about 30 slot-minutes per PR on the VPS (about 180 a day), no billed minutes.
- It gives a signal only if someone acts on it.

**Option C: keep `pull_request` on `agent ci`, limited to non-Agent branches.** Real pre-merge tests, automatically.
- Cost on hosted: about 105 job-minutes per push, so about 57,000 billed minutes a month at the same rates. That breaks the $100 target alone.
- Cost on `uct-vps`: nothing billed, but about 540 slot-minutes a day on a lane sized for far less.
- **Hazard**: the job-level `if:` skips Agent branches, which reports SKIPPED under the named checks' own names, and your queue accepts SKIPPED. It would need separate check names.

Options B and C are not in any commit. If the owner picks one, it is a small addition.

## Proofs you required

- **A failing server test turns the verdict red.** The real glob in a real container: `1 failed, 3654 deselected`, exit 1. The verdict step, executed by bash from the real YAML, fails on `agent-server=failure`.
- **A missing job turns it red.** The same step fails with any job's result absent, for all five. A rail holds `verdict.needs` equal to every other job in the file.
- `skipped` and `cancelled` turn it red for all five too.
- **UNTESTED**: none of this has gone through GitHub. VALIDATION-PLAN checks 4 and 6 repeat it on real runs.

## Outage

Promotion claims are proved through the real `promotion_gate.decide`. GitHub's queueing is from its docs and UNTESTED here, because no runner was registered.

**A queued job with no runner online.** It stays queued, and GitHub cancels it after 24 hours. It cannot report success. `timeout-minutes` does not count queue time.

**The gate verdict and promote.** The heavy jobs stay queued, so `verdict` cannot run yet. With no token nothing reports this at once. `ci-queue-watch` sees a job queued 45 minutes on a silent label, prints `RUNNER LOOKS OFFLINE`, goes red and cancels the run, 45-75 minutes in at a 30-minute cadence. The heavy jobs report `cancelled`, `verdict` runs on hosted and fails, and promotion refuses. A scheduled promote reaching a queued gate gets WAIT, times out after about 20 minutes and fails: red and noisy, never a promotion.

**A cancelled or interrupted job.** A lost runner ends the job `failure` or `cancelled`, and both fail the verdict. What GitHub reports for a killed container is UNTESTED: check 6.

**The serial gate queue during an outage.** `master-deploy` holds one running and one pending run, for up to 75 minutes rather than 24 hours. **A third push cancels the pending run**, per GitHub's docs, so that commit never gets a gate run and its per-commit secret scan never runs. It happens today (`48b5c77903`, 00:23Z on 11-06), and an outage makes it likelier. Question 1.

**The watch** cancels only a run with a job actually queued on a silent label, so a run waiting in the concurrency queue is left alone. It refuses `promote to production` in code.

**Fallback.** Never automatic. Meant for the owner, or AUDIT with the owner's OK:

```sh
gh workflow run master-deploy-gate.yml --ref master -f lane=hosted-fallback
gh workflow run agent-ci.yml --ref <branch> -f lane=hosted-fallback
```

**"Owner only" is not enforced today.** Everything is one GitHub account, so any session with a token holding Actions write can dispatch it. It is a rule people follow, plus a warning and a summary heading naming the actor. It spends real minutes, and the spending limit still applies.

Without the `decide` commit, a commit whose push run was cancelled stays refused after a green fallback, so nothing promotes until the VPS returns. With it, a later green gate run may supersede a `cancelled` one, never a `failure`.

**Recovery once the VPS is back.** `gh run rerun <id> --failed`, then `gh workflow run promote-production.yml -f sha=<sha>`.

## Findings

- **Splitting `gate` nearly lost two tests, silently.** At the old `fetch-depth: 2` the new job gave **3652 passed, 2 skipped**, green, against 3654 passed: two F-16 rails skip when their pinned commit is absent. Fixed with `fetch-depth: 0`, pinned by a rail. `ci_equivalence` says DIFFERENT on that pair.
- **The disk bound is a polled kill, not a quota.** `--storage-opt size=` needs overlay on XFS with project quotas, which this Docker storage does not offer. The launcher reads each container's writable size every 30 seconds and kills it past 40 GiB, so a fast writer can overshoot by one poll. Real fill test: killed just past a 2 GiB bound, exit 137, disk returned.
- **Near-limit jobs.** Hosted: capreg @ rth 15.2 of 20 min, shards up to 18.4 of 25 in `agent ci`. No timeout was raised, and a rail pins them. **Measure a VPS before relying on it.**
- **Agent server tests are the one suite slower here**: about 6 min alone, 9 under load, against 2.0-3.3 hosted. No test exceeds 5 s, and there are no hangs. fsync is about 2 ms, so disk is plausible, but **not proved**. Check fsync on any VPS you shortlist.
- **The "harness did not load: booting…" flake did not appear**, which proves little: it is load-dependent.
- **A container's exit code is not a health signal.** A runner with a bad config exits 0. No result travels that way.
- **`interop=false` is not enough in WSL.** See ISOLATION.md, note 1.

## Open questions for AUDIT

1. **`queue: max` on `master-deploy`.** GitHub's concurrency supports keeping up to 100 pending runs instead of cancelling. It would close the dropped-commit hole, outage or not. It changes the gate's queueing, so it is not drafted. It may belong with your queue rewrite.
2. **Dispatch runs on a PR's rollup.** I could not confirm a `workflow_dispatch` run appears there. If your queue reads the rollup, it may not see them. For B1 and B2.
3. **`gh` reading the renamed job.** No tool in this repo reads the old `gate` name. Does your queue?
4. **Gate slots.** At hosted speed a gate is about 76 job-minutes, so 3 reserved slots is about 25 minutes wall time. 2 is about 38, and slower gates only cost time, because B3's rule stops a cancel. Your call with the VPS size.

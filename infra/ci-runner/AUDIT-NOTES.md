# Notes for AUDIT: draft workflow change

**Status: draft on a local branch, not pushed.** Do not merge before the VPS exists and `VALIDATION-PLAN.md` passes on
it. The routing uses literal labels, so a merge with no VPS leaves every heavy gate job waiting for a machine that does
not exist, and the watchdog then fails every gate. That is safe, and it stops promotion.

## Changes, every one

**`master-deploy-gate.yml`**
- `agent-browser`, `agent-browser-union`, `pine-runtime`: `runs-on` becomes a literal `uct-vps`, or hosted only for a
  manual dispatch on master with `lane=hosted-fallback`. No repository variable is read anywhere in this file.
- New `workflow_dispatch` trigger with a `lane` choice input, default `vps`.
- New hosted job `runner-watchdog`, added to `verdict.needs`, and required as `= success` in the verdict's condition.
- The "CI cost rails" step also runs `tests/test_ci_runner_routing.py`.
- Unchanged: `gate` and `verdict` stay on `ubuntu-latest`. Timeouts are 30, 15 and 30. No job was renamed, no `if:` and
  no `continue-on-error` were added, and `concurrency` is the same.

**`agent-ci.yml`**: `agent ci` checks are read by name for merges, so they cannot run on the PC.
- `server`, `browser`, `capability-regression-clock`, `union`: literal `uct-vps`, hosted only by manual dispatch.
- New `workflow_dispatch` trigger with the same input.
- Five `if:` lines change from `github.event_name == 'push' || ...` to `github.event_name != 'pull_request' || ...`, so
  a dispatch run is not skipped. Push and PR behaviour are unchanged.
- `capability-regression` stays hosted.

**`full-suite-report.yml`**: `vitest`, `pytest`, `collect_profile` as above, plus the `lane` input. `plan`, `publish`
(which holds `contents: write`) and `gate` stay hosted.

**PR leg on the VPS, master leg hosted**: `runs-on: ${{ github.event_name == 'pull_request' && 'uct-vps' || 'ubuntu-latest' }}`
in `clock-parity-fixture` (fixture), `notebook-a11y` (a11y), `notebook-bytes` (bytes), `notebook-latency` (ratio,
write-protection), `optionsflow-guard` (guard), `term018-guards` (static), `vite-build-args` (build-args), `wisdom-rails`
(rails). Promotion reads the master leg, so that leg does not move.

**PC, advisory only, off by default**: `notebook-budgets` (latency), `preference-allowlist` (allowlist),
`flow-worker-deploy-coverage` (coverage), PR leg only, and only if `vars.UCT_PC_ADVISORY == 'on'`. The value is compared
to a literal and never used as a label, so an unset or wrong value lands on hosted and no value can name another machine.

**New files**: `.github/workflows/ci-runner-watch.yml`, `tools/ci_runner_watchdog.py`, `tests/test_ci_runner_watchdog.py`,
`tests/test_ci_runner_routing.py`, `tools/ci_equivalence.py`, `tests/test_ci_equivalence.py`,
`tests/test_ci_runner_launcher.py`, `infra/ci-runner/*`.

**Not changed**: `promote-production.yml`, `tools/promotion_gate.py`, `tests/test_ci_cost_rails.py`,
`tests/test_uct_agent_deploy_gate.py`, `joystick-device.yml`.

**Cannot move**: `indicators-security-suite` and `ocr-linux-cert` use `container:`, which needs a Docker socket on the
runner. Everything that reads `secrets.*` stays hosted, and `test_ci_runner_routing.py` holds that.

## Outage

Everything about promotion below is proved through the real `promotion_gate.decide`. Everything about GitHub's
queueing is from its docs and is UNTESTED here, because no runner was registered.

**A queued job with no runner online.** It stays queued, and GitHub cancels it after 24 hours. It cannot report success.
`timeout-minutes` does not count queue time, so the job timeouts do not bound this.

**The gate verdict and promote.** `runner-watchdog` fails after 10 minutes with no `uct-vps` runner online, then cancels
the run. The heavy jobs report `cancelled`, `verdict` still runs because it is `always()` on hosted, sees a result other
than `success`, and fails. The run's conclusion is not `success`, so promotion refuses. A scheduled promote that reaches
a still-queued gate gets WAIT, times out after about 20 minutes, and fails. Red and noisy, never a promotion.

**A cancelled or interrupted job.** A lost runner ends the job as `failure` or `cancelled`. The verdict requires exactly
`success`, so `skipped`, `cancelled` and `failure` all fail, and `decide` refuses every conclusion except `success`
(`test_no_conclusion_but_success_promotes`). What GitHub reports for a killed container is UNTESTED: VALIDATION-PLAN check 6.

**The serial gate queue during an outage.** `master-deploy` holds one running and one pending run. The watchdog bounds
each held run to about 10 minutes. **A third push cancels the pending second run**, per GitHub's docs. That commit never
gets a gate run, so its per-commit secret scan never runs, and the next green commit promotes its code anyway. Only the
advisory whole-range scan sees it. This happens today (`48b5c77903` was cancelled at 00:23Z on 11-06), and an outage
makes it more likely. See question 4.

**Detection.** Three layers, all hosted, so none shares a fate with the runner:
- `runner-watchdog` on every gate, within 10 minutes.
- `ci-runner-watch.yml` hourly, for jobs on `uct-vps` or `uct-pc` queued 30 minutes or more. It goes red, and GitHub
  emails the workflow's last editor.
- The red scheduled promotes.

**Fallback.** Never automatic. The owner, or AUDIT with the owner's OK, runs:

```sh
gh workflow run master-deploy-gate.yml --ref master -f lane=hosted-fallback
gh workflow run agent-ci.yml --ref <branch> -f lane=hosted-fallback
```

The heavy jobs then run on hosted, and the run is labelled with a warning and a summary heading naming the actor. It
spends real minutes and the spending limit still applies. **It has a limit you need to rule on:** `decide` reads every
run for a SHA, so a commit whose push run was cancelled stays refused even after a green fallback
(`test_a_green_fallback_run_does_not_launder_a_cancelled_run_on_the_same_commit`). See question 3.

**Recovery once the VPS is back.** `gh run rerun <id> --failed` on the failed run, then
`gh workflow run promote-production.yml -f sha=<sha>`, as `notebook-latency.yml` already documents. A rerun replaces the
run's result, so this does work with `decide`.

## Questions for AUDIT

1. **A worker can impersonate the VPS. This is the big one.** Labels are chosen at registration. GitHub documents
   `generate-jitconfig` as accepting a classic token with `repo` scope and admin access, and the owner's `gh` token on
   this PC has `repo` scope. So a worker here could register a runner labelled `uct-vps`, take gate jobs and return
   success. That breaks "refused if a token any worker holds produced it", and neither your label rule, the watchdog nor
   the launcher can see it, because names are caller-chosen too. Runner groups are not available on a user-owned repo. As
   far as I can see the only real fix is that no worker-reachable token has admin on this repo: the owner replaces the
   PC's `gh` login with a fine-grained token that has no Administration permission. Does the VPS plan proceed without that?
2. **`gate` mixes deploy-correctness with the Agent server tests.** You allow the server tests on the VPS, but moving them
   means splitting a job, which changes `needs` and the check name. I left `gate` whole on hosted: 8.5 minutes per master
   push, of which the server tests are about 3. Split it, or keep it?
3. **Fallback against `promotion_gate`.** As it stands the fallback cannot rescue a commit whose push run was cancelled,
   and during a VPS outage every push run gets cancelled, so nothing promotes until the VPS returns. Safe, but the
   fallback then only helps after a rerun. A fix would need `decide` to prefer a later owner-dispatched run on the same
   SHA, which changes what promotion reads, so I did not draft it. Accept the limit, or do you want a patch to review?
4. **`queue: max` on `master-deploy`.** GitHub's concurrency now supports `queue: max`, keeping up to 100 pending runs
   instead of cancelling. It would close the dropped-commit hole above, outage or not. It changes the gate's queueing, so
   it is not in this draft. Do you want it?
5. **New secret `CI_RUNNER_READ_TOKEN`.** The runners API refuses `GITHUB_TOKEN`, so your watchdog needs one. It is
   read-only and read only by a hosted step. Approved?
6. **Which checks do you read by name?** I treated all of `agent ci` and the PR leg of every `promotion-gate: yes`
   workflow as merge-deciding, and these three as not: `notebook budgets`, `preference allow-list`, `flow-worker deploy
   coverage`. Is that right? If you read any of the three, it moves off the PC.
7. **Does your VPS allow-list cover small rails and `agent ci`?** You listed the gate's heavy jobs. I extended it to the PR
   leg of small rails and to `agent ci`, because the PC is out and the cost plan needs them off hosted. If not, they stay hosted.
8. **PR-leg rails have no fallback.** Those workflows have no dispatch input, so a VPS outage holds their PR checks pending
   until it ends. Acceptable, or add the input to all eight?
9. **`notebook latency` on the VPS.** It is a timing check, and its header says flapping sends it back to advisory. The PR
   leg moves. Watch it, or keep it hosted?
10. **`ubuntu-latest` floats, the image does not.** Jobs moved from 24.04 to 26.04 without a workflow change. The kit pins
    26.04, so hosted and VPS can diverge the day GitHub moves it. Pin `runs-on: ubuntu-26.04` on the hosted jobs?
11. **The owner's 11-06 hold** says no workflow changes without approval. This branch only prepares them. Confirm that
    merging needs both your review and the owner's go.

# Notes for AUDIT: draft workflow change

**Status: draft on a local branch, not pushed, nothing approved.** Do not merge before the VPS exists and
`VALIDATION-PLAN.md` passes on it. Labels are literal, so a merge with no VPS leaves every heavy gate job queued, the
watchdog red, and nothing promoted. Safe, but it stops deploys.

Two commits, so the rail switch can be held: **routing** now, **switch** after ten shadow gates match.

## Rulings applied

| # | Ruling | How |
|---|---|---|
| 1 | Split `gate` | New `agent-server` job on the VPS. `gate` keeps deploy-correctness, production check, secret scan, rails and the boots check |
| 2 | Eight workflows may move | Shadow first (`ci-vps-shadow.yml`); the switch commit moves them. `vite-build-args`, `notebook-latency`, `clock-parity-fixture` never move |
| 3 | Named set at merge-candidate time | `workflow_dispatch` only, no PR or push trigger. PC reports nowhere on GitHub |
| 4 | Rail consolidation | Not done. Later, separate PR |
| 5 | Watchdog | One-shot hosted step, plus scheduled `ci-queue-watch.yml` built on `tools/ci_queue_watch.py` |
| 6 | Proofs | Both done, see below |

**Where I went past or against what you wrote:**
- Ruling 3 offered "label or `workflow_dispatch`". **I rejected labels.** A `labeled` trigger skips the check on every other
  label, and your queue accepts SKIPPED, so a PR with any unrelated label could clear the named set with nothing having
  run. A rail forbids `labeled`. Dispatch has no such state, and it runs at the exact branch tip rather than a merge ref.
- Ruling 3 said PC checks need different names. **I went further: the PC has no GitHub presence at all.** Your queue stops
  on anything not SUCCESS or SKIPPED, so a queued PC check on a powered-off PC would stop it, whatever its name. PC runs are
  `launcher.py local` and report locally. That also means no runner token on the PC, and no `uct-pc` label anywhere.

## Changes, every one

**`master-deploy-gate.yml`**
- `gate`: renamed `deploy-correctness checks`. Lost the server-test step. The "CI cost rails" step also runs `tests/test_ci_runner_routing.py`.
- New `agent-server`, name `UCT Agent server tests (production dependency set)`, `timeout-minutes: 20`, `fetch-depth: 0`, builds its own
  production venv, no secret. Its step starts with `test "$(git rev-parse HEAD)" = "$GITHUB_SHA"`.
- `agent-browser`, `agent-browser-union`, `pine-runtime`: literal `uct-vps`, hosted only for a manual dispatch on master with
  `lane=hosted-fallback`. No repository variable appears in this file. Timeouts 30, 15, 30, unchanged.
- New `runner-watchdog`, hosted, one-shot, `contents: read` only.
- New `workflow_dispatch` with a `lane` choice, default `vps`.
- `verdict.needs` gains `agent-server` and `runner-watchdog`, each required `= success`. `verdict` and `gate` stay on `ubuntu-latest`.

**`agent-ci.yml`**: only trigger is now `workflow_dispatch` with `lane`. `server`, `browser`, `capability-regression-clock`, `union` go to
`uct-vps`, hosted only by that input. The `if:` lines that skipped same-repo PRs go, since no PR event remains. `capability-regression` stays hosted.

**Rails, five that may move** (`wisdom-rails`, `term018-guards`, `optionsflow-guard`, `notebook-bytes`, `notebook-a11y`): no `pull_request`
trigger. New `workflow_dispatch` with `lane`, new `workflow_call` for the shadow, `-${{ inputs.tag }}` added to the concurrency group. Dispatch
runs on the VPS, a master push stays hosted. **Switch commit**: a master push moves too, `ci-vps-shadow.yml` is deleted, and the watch may
cancel them.

**Rails that stay hosted** (`vite-build-args`, `notebook-latency`, `clock-parity-fixture`): no `pull_request` trigger, dispatchable. `runs-on` unchanged.

**Three advisory workflows, master side only** (`notebook-budgets`, `preference-allowlist`, `flow-worker-deploy-coverage`): new `workflow_call` and `-${{ inputs.tag }}` for the shadow. PR triggers and PR legs stay hosted. `flow-worker`'s exit 0 is untouched, and a rail holds it. **Switch commit**: a master push moves to the VPS. `notebook-budgets`' runner claim is updated there, but its budgets are **not re-baselined**, because that needs real VPS readings. Do that from the shadow's numbers before the switch.

**`indicators-security-suite`** stays hosted, and a rail holds it.

**`full-suite-report.yml`**: `vitest`, `pytest`, `collect_profile` to `uct-vps`, `lane` input added. `plan`, `publish` (`contents: write`), `gate` stay hosted.

**New workflows**: `ci-queue-watch.yml`, `ci-vps-shadow.yml` (both `promotion-gate: no`).

**Rails edited, because ruling 3 changes what they pin**:
- `tests/test_ci_cost_rails.py`: `test_agent_ci_push_and_pr_run_on_the_same_paths` becomes `test_agent_ci_runs_only_when_dispatched`. `UNFILTERED_PR_OK` is now empty.
- `tests/test_uct_agent_deploy_gate.py`: `test_no_OTHER_workflow_is_an_agent_gate` accepts a dispatch-only workflow, which cannot run on a master push.

**New tests and tools**: `tools/ci_queue_watch.py`, `tools/ci_equivalence.py`, `tests/test_ci_queue_watch.py`, `tests/test_ci_runner_routing.py`, `tests/test_ci_equivalence.py`, `tests/test_ci_runner_launcher.py`, `infra/ci-runner/*`.

**Not changed**: `promote-production.yml`, `tools/promotion_gate.py`, `joystick-device.yml`, the secret scan. The three advisory workflows above and `indicators-security-suite` keep their PR triggers on hosted, so they still run on every PR push. See question 7.

## Running the named set

```sh
B=<branch>; for w in agent-ci vite-build-args notebook-latency clock-parity-fixture wisdom-rails term018-guards optionsflow-guard notebook-bytes notebook-a11y; do gh workflow run $w.yml --ref "$B"; done
```

Confirm every run's `head_sha` is the SHA you mean to merge: a push between dispatches gives mixed SHAs. Path filters no longer apply, so all nine always run.
Workers lose CI on push. Their signal is the PC's local run, in `VALIDATION-PLAN.md`.

## Proofs you required

- **A failing server test turns the verdict red.** The real glob in a real container exits 1 (`fail-server`), and the verdict step, executed by bash from
  the real YAML, fails on `agent-server=failure`.
- **A missing job turns it red.** The same step with any job's result absent fails, for all six jobs. A rail also holds `verdict.needs` equal to every other job in the file.
- `skipped` and `cancelled` turn it red for all six as well: 25 cases in `test_ci_runner_routing.py`, run on Linux in the image.
- **UNTESTED**: none of this has gone through GitHub. Both need repeating on real runs: VALIDATION-PLAN checks 4 and 6.

## Outage

Promotion claims are proved through the real `promotion_gate.decide`. GitHub's queueing is from its docs and UNTESTED here, because no runner was registered.

**A queued job with no runner online.** It stays queued, and GitHub cancels it after 24 hours. It cannot report success. `timeout-minutes` does not count queue time.

**The gate verdict and promote.** `runner-watchdog` fails at once if no runner is online, which is the clear message. The heavy jobs stay queued, so `verdict`
cannot run yet, because `needs` waits. `ci-queue-watch` then cancels the run once a job has queued 45 minutes, 45-75 minutes in at a 30-minute cadence. The heavy
jobs report `cancelled`, `verdict` runs on hosted, and it fails. Promotion refuses every conclusion except `success`. A scheduled promote reaching a queued gate
gets WAIT, times out after about 20 minutes and fails, which is red and noisy but never a promotion.

**A cancelled or interrupted job.** A lost runner ends the job `failure` or `cancelled`. Both fail the verdict. What GitHub reports for a killed container is UNTESTED: check 6.

**The serial gate queue during an outage.** `master-deploy` holds one running and one pending run, now for up to 75 minutes instead of 24 hours. **A third push
cancels the pending run**, per GitHub's docs, so that commit never gets a gate run and its per-commit secret scan never runs. The next green commit promotes its code,
and only the advisory whole-range scan sees it. It happens today (`48b5c77903`, 00:23Z on 11-06), and an outage makes it likelier. See question 3.

**The watch never drops a commit**: it cancels only a run with a job actually queued on `uct-vps`, so a run waiting in the concurrency queue, which has no such job, is
left alone. It refuses `promote to production` in code, whatever its arguments say. Tested.

**Detection, all hosted**: `runner-watchdog` per gate, at once. `ci-queue-watch` every 30 minutes, red on anything stuck, emailing the workflow's last editor. Red scheduled promotes.

**Fallback.** Never automatic. The owner, or AUDIT with the owner's OK:

```sh
gh workflow run master-deploy-gate.yml --ref master -f lane=hosted-fallback
gh workflow run agent-ci.yml --ref <branch> -f lane=hosted-fallback
```

It is labelled with a warning and a summary heading naming the actor, spends real minutes, and the spending limit still applies. **Limit:** `decide` reads every run for a
SHA, so a commit whose push run was cancelled stays refused after a green fallback (tested). See question 2.

**Recovery once the VPS is back.** `gh run rerun <id> --failed`, then `gh workflow run promote-production.yml -f sha=<sha>`. A rerun replaces the run's result, so this works with `decide`.

## Findings

- **Splitting `gate` nearly lost two tests, silently.** The server tests were inheriting history from earlier steps' `--depth=200` fetches. A new job at the old `fetch-depth: 2` gave
  **3652 passed, 2 skipped**, green, against hosted's 3654 passed: two F-16 rails skip when their pinned commit is absent. Fixed with `fetch-depth: 0`, pinned by a rail. `ci_equivalence` says DIFFERENT on that pair. A job that can lose tests and stay green is what the count comparison is for, so compare counts on the first real VPS gate too.
- **Near-limit jobs.** Hosted: capreg @ rth 15.2 of 20 min, shards up to 18.4 of 25 in `agent ci` and of 30 in the gate. No timeout was raised, and a rail pins them. On the PC's
  4 CPUs these took 3.5 and 4.5 min, but that is an i7-13700KF. **A VPS must be measured before anything relies on it.**
- **The one suite slower here is the Agent server tests**: 6.1 min alone, 9.1 min under load, against 2.0-3.3 on hosted. Nothing is slow individually (the slowest test is under 5 s) and there are no hangs,
  so it is spread across 3654 tests. fsync measured about 2 ms. That makes disk latency a plausible cause, but **I did not prove it**. Check fsync on any VPS you shortlist.
- **The "harness did not load: booting…" flake did not appear** in these runs, which proves little: it is load-dependent and these were not its conditions.
- **A container's exit code is not a health signal.** A runner with a bad config exits 0, because `run.sh` maps "terminated, no retry" to success. No result travels that way: the runner reports to GitHub.
- **`interop=false` is not enough in WSL.** See ISOLATION.md, note 1.

## Questions for AUDIT

1. **A worker can impersonate the VPS. This is the big one.** Labels are chosen at registration. GitHub documents `generate-jitconfig` as accepting a classic token with `repo` scope and
   admin access, and the owner's `gh` token on this PC has `repo` scope. So a worker here could register a runner labelled `uct-vps`, take gate jobs and return success. That breaks "refused if a
   token any worker holds produced it", and neither your label rule, the watchdog nor the launcher can see it, because names are caller-chosen too. Runner groups are not available on a user-owned
   repo. As far as I can see, the only real fix is that no worker-reachable token has admin on this repo: the owner replaces the PC's `gh` login with a fine-grained token with no Administration permission. Does the VPS plan proceed without that?
2. **The runner-read token, ruling 5.** Reading runners needs admin access. GitHub's docs name only the classic `repo` scope; whether a fine-grained `Administration: read` works is unverified. In repository
   secrets it is readable by **any workflow on any branch**: a worker who can push a branch can add a workflow that prints it. So a classic token there hands workers admin, which reopens question 1, and a fine-grained read-only one hands them read-only runner data. Environment protection might limit it, but
   that may need a paid plan on a private repo. The alternative is no token at all: drop the `online` step, and rely on `ci-queue-watch`, which needs only `actions: write`. You lose the immediate message and keep the same bound. Which do you want? The draft has the step, and it fails closed.
3. **`queue: max` on `master-deploy`.** GitHub's concurrency now supports it, keeping up to 100 pending runs instead of cancelling. It would close the dropped-commit hole, outage or not. It changes the gate's queueing, so it is not in this draft.
4. **Fallback against `promotion_gate`.** During a VPS outage push runs get cancelled, and a green fallback cannot rescue those commits, so nothing promotes until the VPS returns. Safe. A fix means `decide` preferring a later owner-dispatched run on the same SHA, which changes what promotion reads, so I did not draft it. Accept the limit, or do you want a patch to review?
5. **Dispatch runs on a PR's rollup.** I could not confirm that a `workflow_dispatch` run appears in a PR's check rollup. If your queue reads the rollup, it may not see them, and it must read the runs by name and SHA instead. Please confirm how it reads them.
6. **`gh` reading the renamed job.** No tool in the repo reads the old `gate` job name. Does your queue script?
7. **The four workflows still on every PR push**: `notebook budgets`, `preference allow-list`, `flow-worker deploy coverage`, `indicators security suite`. You cleared the first three to move master-side; their PR legs stay hosted and keep costing. Can those PR legs move to dispatch too, or to the VPS?
8. **`ubuntu-latest` floats, the image does not.** Jobs moved from 24.04 to 26.04 without a workflow change. The kit pins 26.04, so hosted and VPS can diverge the day GitHub moves it. Pin `runs-on: ubuntu-26.04` on hosted jobs?
9. **`agent ci` capacity.** About 30 slot-minutes per run on the PC's CPUs. At 2 slots that is 4 runs an hour; dispatching only at merge-candidate time makes this reasonable, but a VPS slower than the PC reduces it.
10. **The owner's 11-06 hold** says no workflow changes without approval. Confirm merging needs both your review and the owner's go.

# Promotion catch-up: a held promotion resumes itself, on the exact gated SHA

Branch `agent/pl/promote-catchup`, off master 5fed0561f1. DRAFT for AUDIT. This touches deploy infrastructure, so it
needs AUDIT GO **and the owner's own approval in the PR** before any merge.

## Root cause
1. **The freeze held the promotion, and nothing reliable resumed it.**
   - On 2026-11-10 #1016's gate passed at 14:32Z. Its promotion ran at 14:31–14:32Z (09:31 ET), inside the opening rush
     (09:20–09:45 ET, `tools/deploy_freeze.py`), so it was held.
   - The catch-up was the `schedule:` cron `50 14 * * 1-5`, and it never fired. Measured delivery of this workflow's
     scheduled runs (`gh run list --workflow promote-production.yml --event schedule`): created at 23:11Z, 23:35Z, 02:46Z
     and 03:34Z for crons due at 13:50–21:20Z. That is 7–12 h late, or missing altogether.
2. **The catch-up promoted "the tip of master",** not the commit whose gate was held. A newer tip whose own gate had not
   finished, or had failed, could be promoted by a cron.
3. **A person cannot be the fix.** The Lead verified that the automation token is a fine-grained PAT without
   Actions: write (a dispatch probe returned 403 with `X-Accepted-Github-Permissions: actions=write`), and the owner will
   not widen it. The fix lives inside Actions and uses `GITHUB_TOKEN` with least privilege.

## Options evaluated
| | Design | Verdict |
|---|---|---|
| 1 | The held run waits **in-job** until the window closes (bounded), then re-checks everything on the SAME SHA | **Adopted.** It needs no other trigger. Rush holds last ≤ 46 min and the Wednesday window ≤ 121 min, both inside a 200-min job (cap 6 h) |
| 2 | The held SHA is recorded **PENDING** in `deploy-gate-state`, and a later trigger resumes it | **Adopted as the safety net.** The record is written before the wait, so an interrupted run leaves it behind |
| 2b | A `GITHUB_TOKEN` self re-dispatch (`workflow_dispatch` from `GITHUB_TOKEN` DOES start a run) | **Adopted, capped:** at most 2 per pending SHA, counted in the record, from its own job (the only one with `actions: write`) |
| 3 | The `schedule:` crons | **Kept, as a backup only.** They now resume the PENDING SHA, and with nothing pending they do nothing |

## Architecture (`.github/workflows/promote-production.yml` + `tools/promote_decision.py`)
The workflow does the I/O (git, the GitHub API). Every decision is made in `tools/promote_decision.py`: pure, tested, and
run as `--self-check` at the start of every promotion.

1. **Candidate** (`resolve`). The candidate is one of:
   - the triggering gate's `head_sha`, from `workflow_run`, and only if that gate succeeded;
   - the `sha` input of a dispatch;
   - the PENDING record.

   Master's tip is not even an input. A schedule or resume with nothing pending does nothing.
2. **Freeze plus a bounded wait** (`deploy_freeze.py --wait-plan`). When the candidate is frozen:
   - the plan is the seconds until the window's end plus a 60 s margin, at most `MAX_WAIT_MIN = 125` minutes;
   - the SHA is first recorded PENDING (`deploy-gate-state/pending-promotion.json`);
   - then the job sleeps. The wait step has its own `timeout-minutes: 130`, plus a 7620 s shell guard.
3. **Re-check at fire time, on the same SHA.** After the wait the job runs:
   - the same freeze decision again;
   - the gating-check poll (`promotion_gate.py`, unchanged);
   - the candidate's OWN `master deploy gate` run: success, with the expected job count. That count is derived from
     `master-deploy-gate.yml`, matrix-aware, and is 8 today;
   - fresh ancestry checks: SHA ⊑ master, production ⊑ SHA, and production ⊒ SHA (the latter means "Already promoted").
4. **Decision** (`decide`). The action is one of PROMOTE (target = the candidate, always), ALREADY_PROMOTED, HOLD,
   REFUSE_GATE, REFUSE_NOT_ON_MASTER or REFUSE_PRODUCTION_NOT_ANCESTOR. The decision also says what the PENDING record
   becomes (written, replaced or cleared). A newer gated SHA replaces the pending one ONLY if it descends from it.
5. **Fast-forward** to exactly that target. `production ⊑ target` is re-checked at push time, the push is a plain one
   (never `--force`), and the Railway `web` wait is unchanged.
6. **Second layer** (job `resume`). This job alone has `actions: write`. When the promote job failed, timed out or ended
   still HELD, and a record is pending with fewer than 2 re-dispatches, it increments the count in the record FIRST and
   then dispatches `resume=yes`. At the cap it stops, and leaves a warning and the record.
7. **The PR dry run** (job `dryrun`, `pull_request` only, path-filtered to the promotion files; `contents: read`).
   It runs the decision tests plus `tests/test_ci_cost_rails.py`, then `tools/promote_dryrun.py` on three simulated
   clocks: inside the opening rush, inside the Wednesday window, and outside every window.
   - `promote_dryrun.py` executes the promote job's REAL `run:` blocks, extracted from the YAML, in a throwaway local
     repository: a local bare origin, a stubbed `gh`, and an extra UNGATED master commit.
   - It fails unless the target is the gated candidate, is not the ungated tip, and production is unchanged.
   - The `promote` and `resume` jobs exclude `pull_request` in their job-level `if:` (a test asserts it). The PR run
     has its own per-PR concurrency group, cancelled when superseded, so it can never queue behind or cancel a real
     promotion. Every other event stays on the single `promote-production` queue with cancel false.
8. **Dry run by dispatch** (`dry_run=yes`, optional `now=` simulated clock). The job decides and reports in full, but makes no push,
   no state write, no sleep (the simulated clock advances instead) and no re-dispatch.

Kept exactly:
- one concurrency group with `cancel-in-progress: false`;
- skipping a cancelled gate;
- the gating poll;
- the pre-cutover no-op;
- FF-only;
- the promotion and gate-run records (the gate-run record gains `held_by_freeze` and `decision`);
- the Railway wait;
- every freeze, with fail-open on a broken freeze reader.

## Operator: a manual dispatch
- **`sha=<commit>`** promotes that commit through every fire-time check.
- **Blank** (no `sha`):
  - With something pending, it promotes the **pending** SHA.
  - With nothing pending, it promotes **master's tip ONLY IF** that tip's own `master deploy gate` run is success with
    every expected job (the fire-time check: runs fetched with `head_sha=<tip>&branch=master&event=push`).
  - Otherwise it promotes nothing.
  - The summary always names the choice: "pending X", "tip (manual fallback, own gate verified): tip Y with green gate
    run N", or "nothing pending and tip Y has no green gate; pass sha=<commit>".
- **The fallback is for a human only:** a `workflow_dispatch` with no `sha`, no `resume` and no `dry_run`, and an actor
  other than `github-actions[bot]`. `schedule`, `workflow_run` and the `resume` job's re-dispatch can never reach it
  (decision cases A4).
- **A fallback candidate gets every check:** freeze (HOLD, with the tip recorded PENDING), production ⊑ tip, and
  fast-forward only.
- **The tests' strict never-master's-tip control** still covers every other source. The fallback has its own case and
  control (A1–A3).

## Why one pending run per group is safe (GitHub cancels an older PENDING run when a newer one queues)
- Suppose A is held and waiting. B's run queues; then C's run queues, and GitHub cancels B's pending run.
- C's run promotes C, its own gated SHA. C descends from A and B on master, and its gate's range scan covers everything
  since `production`.
- So production ends at C, and B's gate result is never needed: no decision ever reads a fact about B.
- Decision case `B` pins this.

## Liveness: a newcomer never displaces a verified pending SHA
- A candidate that arrives inside a freeze replaces the PENDING SHA only if it descends from it AND its OWN gate is
  already known green. That covers a `workflow_run` (its gate just succeeded) and the manual fallback (gate verified).
- A dispatch `sha` or a resume of unknown gate state does not replace it.
- So with A verified and pending, an unverified B that arrives and whose gate later fails leaves A pending, and A is
  promoted on the next run (cases C1–C4).

## Failure modes
| Case | What happens |
|---|---|
| The candidate's gate fails, or a gating check fails, during the wait | The fire-time poll refuses it (REFUSE_GATE), the PENDING record is cleared, and production does not move |
| The gating poll only times out (checks still running) | REFUSE_GATE, but the SHA stays PENDING (`gate_unknown`). The capped re-dispatch tries again |
| Master moves during the wait (descendant) | This run still promotes ITS candidate. The newer gate's run is queued behind it in the group and promotes its own SHA |
| Master rewritten so it no longer contains the SHA | REFUSE_NOT_ON_MASTER. The record is cleared |
| A second gate arrives during the wait | It queues in `promote-production` (one pending run per group; GitHub cancels an OLDER pending run when a third arrives). That is safe: the gate's range scan since `production` covers every skipped commit (master-deploy-gate.yml "Secret scan over the whole range") |
| A newer HELD SHA that does not descend from the pending one | The pending SHA is kept. The newer one is not recorded |
| Duplicate `workflow_run` on the same SHA | The second one is ALREADY_PROMOTED, a no-op |
| An old SHA arrives after production moved past it (stale) | ALREADY_PROMOTED. Production never moves backwards |
| production was pushed to directly | REFUSE_PRODUCTION_NOT_ANCESTOR, never forced (and the gate's promotion-control check halts too) |
| The runner dies mid-wait, or the job times out | The PENDING record already exists. Job `resume` re-dispatches (≤ 2 per SHA), and the backup crons and the next gate also resume it |
| The 6 h job cap | Not reachable: job 200 min, wait step 130 min, planned wait ≤ 126 min |
| The freeze reader breaks | Fail-open as today: no wait and no hold |
| A runner-minutes limit | 0 billable minutes (see below). A private repo would cost up to ~2.2 runner-hours per held promotion; re-evaluate if the repo goes private |

## Billing
- The repository is public (`gh api repos/... --jq .visibility` gives `public`).
- Standard GitHub-hosted runners bill 0 minutes there. The last promotion run's timing API reports
  `"billable":{"UBUNTU":{"total_ms":0}}`, for run 42834815999.
- The in-job wait therefore costs 0 billable minutes.

## Tests and evidence
- **`tools/promote_decision.py --self-check`**, run by promote-production.yml before any decision. It covers the 8 cases
  (normal; freeze deferral then resume; missed cron; duplicate events; interrupted-run recovery; master moving
  (4 sub-cases); gate failing plus a poll timeout; stale SHA plus diverged). EACH case carries the control that the target
  is the candidate and never master's tip. Locally: `self-check: PASS`.
- **`tools/deploy_freeze.py --self-check`** gains 12 wait-plan cases. One of them is a minute-by-minute sweep of 12 h
  asserting that every planned wait is within the bound. Locally `self-check: PASS`; this needs tzdata, which Ubuntu has.
- **`tests/test_promote_decision.py`** (new; pytest). It GATES: it was added to the master deploy gate's existing `CI cost rails` step (same runner, about 1 s) and runs in the PR `dryrun` job. It covers:
  - the same 8 cases, each with the never-the-tip control;
  - the gate job-count check;
  - workflow wiring: the job is 200 min and the wait 130; `cancel-in-progress: false` and no `true`; no `--force`; the
    push is to `$TARGET`; `actions: write` only in `resume`.
  - It also runs in the nightly `full suite report`. The same cases also run as
    `--self-check` inside promote-production.yml at promote time. pytest is not allowed on this machine, so the file was
    run with a plain-Python runner: 11 passed, 0 failed. The existing rails that read this workflow were run the same way:
    `test_promote_skips_only_cancelled_gates` 3/3, `test_ci_cost_rails` 6/6 (the parametrized ones were not run). The
    `test_measurement_window` and `test_promotion_gate_branch` / `_supersede` workflow assertions still hold (checked by
    string).
- **`bash -n` over all 20 `run:` blocks:** all OK.
- **A simulated deferred cycle** (the REAL `run:` blocks extracted from the YAML, in a throwaway git repo whose origin
  has `master`, `production` and an extra UNGATED master commit, with `dry_run=yes` and a simulated clock). The summary
  output for 09:31 ET:

  ```
  - candidate: `<gated SHA>`
  - dry run: **yes**
  - freeze before / after the wait: **yes** / **no** (planned wait 900s)
  - decision: **PROMOTE** → `<gated SHA>`
  - production existed: **yes**
  - promoted: **dry-run**
  CONTROL: decision target == gated candidate: True; target != ungated master tip: True
  ```

  Also run: Wednesday 09:05 ET (a planned wait of 6960 s, then PROMOTE) and 11:00 ET on a non-freeze day (no wait,
  PROMOTE). Raw output is in the pl-auto scratchpad (`runs/promote-sim-*.txt`). The gating poll is a stand-in in the
  simulation (it needs the GitHub API); its code is unchanged by this PR.
- **Real Actions dry run with no click:** the PR's `dryrun` job, whose summary shows all three clocks. A manual one is also possible: Actions → "promote to production" → Run workflow, on
  branch `agent/pl/promote-catchup`, with `dry_run=yes`, `sha=<a gated master SHA>` and `now=2026-11-11T14:05:00Z`. The
  summary shows the plan; nothing is pushed or written.

## What is not changed
- `master-deploy-gate.yml`, except one line: its `CI cost rails` step also runs `tests/test_promote_decision.py`.
- `promotion_gate.py`.
- The freeze windows.
- Branch protection.
- The Railway wait (still a documented stub).
- `cancel-in-progress` anywhere.

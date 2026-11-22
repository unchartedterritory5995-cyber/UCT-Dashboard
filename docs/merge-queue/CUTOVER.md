# Merge queue on `master`: cutover runbook

**Status: NOT RUN.** This is the procedure for the day the queue is switched on. Read `DESIGN.md` first.
Every step here is reversible with one switch (the last section).

## Before the day: all of these are true

- [ ] AUDIT has re-reviewed `DESIGN.md` and the Agent pull request after its "CHANGES NEEDED" of 2026-11-22 and
      said APPROVED on both.
- [ ] The verdict's GitHub App exists, is installed on this repo with commit statuses read and write, and its
      credentials are in the environment `agent-ci-verdict`, whose deployment-branch policy allows `master` only.
- [ ] The follower was rehearsed with that App in the rehearsal repo at #2501's FINAL head (`01a295991c`), three rows:
  - [x] it posts the verdict; a job on a `gh-readonly-queue/...` ref is refused the environment; a status posted by
        GitHub Actions under the same name does not satisfy the required check (2026-11-22);
  - [x] a pull request that adds a workflow whose `environment` is an expression never enters the queue: its PR-head
        `agent-ci-required` is failure (2026-11-22, 21:21Z round);
  - [ ] after such a workflow is landed on the rehearsal repo's `master` OUTSIDE the queue, an ordinary no-Agent-path
        entry branched before it is REMOVED by the follower, and lands once the file is gone.
- [ ] `git diff origin/master origin/agent/int -- .github/workflows/agent-ci-required.yml` is empty. Done by the
      Agent Lead (merge `master` into `agent/int` after #2501 lands, outside a re-arm or evidence run: the file is an
      Agent path, so the merge starts an 18-job run). Checked by AUDIT.
      When: #2501 has merged (done 2026-11-22, `a5d74997a9`), its master deploy gate run is green, AUDIT has confirmed
      that the first pull request into master after it carries the App's status, and no Agent re-arm or evidence
      run is in flight.
- [ ] Environment `agent-ci-verdict` has "Allow administrators to bypass" OFF (`can_admins_bypass: false`).
      Set on 2026-11-22; re-read it on the day:
      `gh api repos/northstar-quarry/UCT-Dashboard/environments/agent-ci-verdict --jq .can_admins_bypass`
- [ ] The list of open pull requests is recorded: each needs a push, a reopen or an agent ci run before the
      App's status exists on its head. The cutover message says so.
- [x] The Agent part is merged: #2501, 2026-11-22, `a5d74997a9`, on AUDIT's GO line, with the queue off.
- [ ] The Agent part was exercised by real `merge_group` events in the rehearsal repo at #2501's FINAL head (with a
      stand-in for the 18 Agent jobs): no Agent path, Agent path, Agent + self-protected, and an Agent entry stacked
      behind a machinery edit.
- [ ] The owner has said go for the switch-on.
- [ ] No required check is flaky. Check the last 7 days of `master gate static checks` and `agent-ci-required`
      for a red that went green on a rerun with no change.
- [ ] GitHub Actions is healthy and the organization is not at its job limit at the chosen hour.

## The hour

A weekend, or a weekday between 20:00 and 05:00 CT. Not while a worker or flow-worker deploy is in progress.

## Steps

1. **Tell everyone, 30 minutes ahead.** Sessions on this machine by cross-session message; Bracco and Ravi on
   Discord. The message is in the next section.
2. **Record the state:** `master` and `production` SHAs, the open pull request count, the rulesets on `master`
   (`gh api repos/northstar-quarry/UCT-Dashboard/rules/branches/master`).
3. **Turn on "Allow auto-merge"** (repo Settings, General, Pull Requests), or
   `gh api -X PATCH repos/northstar-quarry/UCT-Dashboard -F allow_auto_merge=true`.
   Without it `gh pr merge` answers "Auto merge is not allowed for this repository" (rehearsed).
4. **Create ONE new ruleset** on `refs/heads/master`, enforcement active, no bypass list except the role named in
   `DESIGN.md` 3.4, with these rules:
   - `pull_request`: 0 approvals;
   - `required_status_checks`: `agent-ci-required`, source = the verdict's GitHub App (its integration id, NOT
     15368), not strict;
   - `merge_queue`: merge method MERGE, `max_entries_to_build` 5, `min_entries_to_merge` 1,
     `max_entries_to_merge` 5, `min_entries_to_merge_wait_minutes` 1, grouping ALLGREEN,
     `check_response_timeout_minutes` 60 (the Agent browser shards carry a 40-minute timeout).

   Rulesets 27828221 (no deletion, no force push) and 27829824 (`master gate static checks` required) stay as
   they are. Keeping the queue in its own ruleset is what makes rollback one switch.
5. **Prove it on one small pull request** (a docs change): `gh pr merge <n> --merge`, then watch it.
   Expect, in order: "The merge strategy for master is set by the merge queue"; a `merge_group` run of
   `gate static rails (PR)` and of the Agent scope on `gh-readonly-queue/master/pr-<n>-<sha>`; state MERGED; one
   push to `master`; the master deploy gate starts on that SHA; the SHA on `master` equals the SHA the
   `merge_group` runs tested.
6. **Prove the Agent path** on one pull request that touches an Agent path. This is the first time the real
   Agent suite runs in a merge group (the rehearsals used a stand-in); that is acceptable only because a failure
   removes the entry and rollback is one switch. The Agent jobs run on the merge
   group's commit and the pull request lands only after `agent-ci-required` is success there.
7. **Tell everyone it is live**, with the number of the first queued pull request as the example.

## The message (step 1)

> From (time), `master` takes changes through GitHub's merge queue.
> 1. Merge as before with `gh pr merge <n> --merge`. It now QUEUES the pull request. If its checks are still
>    running it waits and joins the queue by itself when they pass. Run the command once; do not poll and retry.
> 2. It has landed only when `gh pr view <n> --json state` says MERGED. Do not report "merged" before that.
> 3. If it was removed from the queue, a check failed on the queued commit: read it, fix, queue again.
> 4. No quiet-`master` wait any more. Agent pull requests are still queued only by the Agent Lead, after AUDIT's
>    GO, outside the freeze windows, one at a time after the previous one is prod-verified.
> 5. No direct push to `master`. Never `--admin`.
>    A pull request that was already open before the cutover needs one push (or close and reopen) first.
> 6. A pull request queued behind an Agent one lands with it, up to about 20 minutes later.
> If the queue looks stuck for 30 minutes, tell the owner: it can be switched off in one step.

## Watch, first week

Daily, from the Actions and pull request APIs: queue wait (median, p90) from `added_to_merge_queue` to merged;
`removed_from_merge_queue` events and their cause, queue-timeout removals of Agent entries in particular; Agent pull requests' open-to-merge time against the 13.4 hour
median measured before; runner minutes; peak jobs against the organization's limit.

## Abort and rollback

**Abort rule:** queue wait p90 over 45 minutes, or the queue stuck for 30 minutes.

**Rollback:** set the queue ruleset's enforcement to Disabled (Settings, Rules, Rulesets, or
`gh api -X PUT repos/northstar-quarry/UCT-Dashboard/rulesets/<id>` with `"enforcement": "disabled"`).
Pull requests then merge exactly as they did before the cutover. Pull requests that were in the queue stay
open and are merged by hand. Nothing else needs undoing; "Allow auto-merge" can stay on.
Say what happened in the owner's channel and in `docs/merge-queue/`.

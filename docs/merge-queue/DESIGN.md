# Merge queue on `master`: design for review

**Status: PROPOSAL, revised after AUDIT's review of 2026-11-22 ("CHANGES NEEDED", on pull requests #2495 and
#2501). Nothing in this document is switched on.** Section 9 lists AUDIT's findings and where each is answered.
Reviewers: the Agent program's AUDIT, and the owner. Section 8 lists the questions that need an answer
before the Agent part is built.

## 1. Why

Two different problems were being discussed as one.

**A. `master` going red.** Cause: checks that only the deploy gate ran, after the merge. Fixed on
2026-11-22 by running them on pull requests (`gate-static-rails-pr.yml`, `derived-inventories.yml`,
`bars-rails-pr.yml`) and requiring `master gate static checks` to merge. A queue was not needed for it.

**B. An Agent release cannot get through.** The Agent program requires proof that the exact tree that
lands was tested (`tools/agent_ci_evidence.py`: `stale-base`, the tested commit's first parent must be
`master`'s tip at verify time). That proof is void the moment `master` moves, and `master` moves all day.
Measured over 2026-11-17 to 11-21, 718 merges into `master`:

| Fact | Value |
|---|---|
| A 30-minute window with no merge into `master` exists | 12% of the time |
| A 20-minute window | 20% of the time |
| An evidence run (re-arm), wall time | median 16 min, p90 19 min |
| `agent/**` pull requests into `master` since 11-14 | 34 (about 4 a day) |
| Their time from open to merge | median 13.4 h, p90 42 h, worst 102 h |
| Merges into `master` that touch an Agent path | 13% (92 of 718) |

"The tested tree is the tree that lands, while other people keep merging" is what a merge queue provides.
This design is about problem B.

## 2. What GitHub's queue does, as rehearsed

Throwaway public repo `northstar-quarry/mq-rehearsal`, 2026-11-22, three rounds and eleven pull requests, a ruleset
with the `merge_queue` rule (merge method MERGE, 5 builds at once, groups of 1 to 5).

| Observed | Detail |
|---|---|
| The tested commit is the commit that lands | All four landed SHAs on `main` equal the SHAs the queue tested. |
| What is tested | A merge commit: first parent = the base branch plus the entries ahead, second parent = the pull request's head. |
| An entry's own change | `merge_group.base_sha..head_sha` is exactly the queued pull request's diff (checked on entry 2). |
| CI runs once per queued pull request | Five entries, five `merge_group` runs, plus one re-run after a failure. Not once per batch. |
| A slow entry holds the ones behind it | Entry 3 was green after 2 min and landed with entry 2 (the 3-minute one) at 4.5 min. |
| A failure inside the queue | The pull request is removed and stays open; the entry behind it is rebuilt (75 s). Its first run, stacked on the failure, is wasted. |
| The base branch still gets a normal push | One push per landed group. A push-triggered gate and a `workflow_run` follower both fired. |
| Push triggers with no branch filter | They run on every temporary `gh-readonly-queue/**` branch. |
| `gh pr merge` | Needs the repo setting "Allow auto-merge". Then it queues the pull request, or, if its checks are still running, arms auto-merge and the pull request queues itself when they pass. |
| Queued while its checks were running | Auto-merge was armed and the pull request joined the queue by itself 54 s later, when they passed. |
| A required COMMIT STATUS posted through the API | Honoured on the merge group's commit: a `success` status let two entries land; a `failure` status removed its entry about 70 s after it was queued, without waiting for the other checks, and the entry behind was rebuilt and landed. This is how `agent-ci-required` is posted today. |
| Required checks split over two rulesets | Both enforced: with the queue rule in one ruleset and a required check in another, an entry failing that check was removed and the next one landed. |
| The Agent draft itself (#2501), round 4 | `agent-ci-queue.yml` and the deciding tools ran byte for byte on real merge groups, with a generated 18-job stand-in for `agent-ci.yml`: an Agent-path entry landed ("all 18 Agent jobs passed on the merge group's commit"), two plain entries landed ("no Agent paths changed"), a failing-Agent entry and a self-protected entry were removed. Round 5 repeated it at `998db51f39` with the corrected rule of 3.4: a self-protected entry with no Agent path landed ("no Agent paths changed (1 self-protected path(s) touched, no Agent evidence needed)"), and one with an Agent path was removed. The real Agent suite has not run inside a merge group. |

## 3. Design

### 3.1 Rules on `master`

Today: no deletion, no force push (ruleset 27828221); `master gate static checks` required (27829824).
Added at cutover, in ONE NEW ruleset, so one switch turns the queue off and the two rulesets above stay as they are:

- pull request required (0 approvals), which ends direct pushes to `master`;
- merge queue: method merge, 5 builds at once, groups of 1 to 5, check timeout 60 minutes (the Agent browser
  shards carry a 40-minute timeout of their own);
- required check `agent-ci-required`, pinned to the dedicated GitHub App of 3.6 as its source, NOT to GitHub
  Actions: every workflow token posts as GitHub Actions, the merge group's own included.
  `master gate static checks` stays required through ruleset 27829824, whose bypass list stays empty, so it
  still applies to a merge that bypasses the queue.

The repo setting "Allow auto-merge" is turned on.

### 3.2 Unchanged

- The master deploy gate, including the full Agent suite it runs on every `master` push.
- `promote-production.yml` and every Railway service.
- `agent/int`, every other branch, and every advisory pull-request workflow.

### 3.3 Agent evidence inside the queue

A new workflow, `agent-ci-queue.yml`, runs on `merge_group`. Its `scope` job runs first, and its `agent` job calls
`agent-ci.yml` (which gains only a `workflow_call` trigger: a `merge_group` trigger on `agent-ci.yml` itself would run
every Agent job for every queued pull request, and `agent-ci-required.yml` would post over the verdict). Draft: #2501.


1. `scope` reads the queued pull request's own diff (`merge_group.base_sha..head_sha`) and answers two
   questions with the code that already answers them today, taken from the default branch as
   `agent-ci-required.yml` does now:
   - does it touch an Agent path (the `paths` list in `agent-ci.yml`, read at run time, never restated);
   - does it touch a self-protected path (`agent_ci_evidence.SELF_PROTECTED` and its derived lists).
2. If it touches an Agent path, every Agent job runs on the merge group's commit: `server`, `browser`
   (12 shards), `capability-regression-clock` (3), `capability-regression`, `union`. `GITHUB_SHA` is the
   commit under test, so the checkout needs no payload and no tool-owned ref.
3. Each job still uploads its evidence record (tested commit, tree, parents, failed tests).
4. `agent-ci-required` is reported on the merge group's commit:
   - success when the queued pull request touches no Agent path;
   - success when every Agent job succeeded on that commit;
   - failure otherwise, including a queued pull request that touches an Agent path AND a self-protected path (3.4).

On a pull request `agent-ci-required` keeps today's meaning, so a pull request can enter the queue exactly
when it can be merged today.

### 3.4 A pull request that edits what its own run executes

In a merge group the workflow file comes from the merge group's commit, so it includes the queued pull
request's edits. That is weaker than today's re-arm, where a `repository_dispatch` always runs `master`'s
copy. The design keeps today's rule, no weaker and no stricter:

- Today `self-protected-diff` exists only inside `verify`, so it only ever matters for a pull request that
  needs Agent evidence. A pull request that edits some other workflow and touches no Agent path merges today
  with `agent-ci-required` = success.
- So in the queue: a queued pull request that touches an Agent path AND a self-protected path fails the
  verdict, with today's message (its own run could vouch for itself, AUDIT's local evidence decides). It lands
  outside the queue, by an owner or admin, after AUDIT signs off; the ruleset's bypass list holds that one role,
  for pull requests only.
- A queued pull request that touches a self-protected path and NO Agent path needs no Agent evidence and is
  not held. The status description says how many self-protected paths it touched.
- Measured on 2026-11-17 to 11-21 (718 merges): 47 touch a self-protected path, 35 of them touch no Agent
  path, 12 touch both (about 2 to 3 a day). Nine of the 12 edit the Agent program's own CI machinery
  (`agent-ci.yml`, `tools/agent_ci_*.py`, the shard planner and its timings); three edit
  `app/scripts/chartLibraryPatch.mjs`, a script the vite config imports, alongside Agent code.
  The first draft of this section failed all 47; that would have sent about 9 ordinary pull requests a day to
  an admin bypass.
- `.github/workflows/agent-ci.yml` and `tools/agent_*` are in the Agent path list already, so editing them
  always needs AUDIT. `agent-ci-queue.yml` and `agent-ci-required.yml` are NOT in that list today: question 8.1.
- For every pull request that needs Agent evidence and passes, "touches no self-protected path" means its
  workflow files and evidence tools are byte-identical to `master`'s, which is what `dispatch-ref` protects today.

A stronger option exists if the organization's plan offers it: an organization ruleset with "Require
workflows to pass", which runs a named workflow from a pinned ref whatever the pull request contains.
Not verified; it needs an organization admin to look.

### 3.5 What retires, and when

Nothing retires at cutover. `tools/agent_ci_rearm.py`, the `refs/agent-ci-evidence/**` namespace and the
`repository_dispatch` trigger stay until AUDIT accepts, and AUDIT's acceptance is conditional on 3.6 being built
and rehearsed and on the merge-group mode of `verify` (3.7).

### 3.6 The verdict comes from an identity the merge group cannot reach (AUDIT D1 / F1)

In a queue the status is the gate, and there is no human step after it. A status pinned to "GitHub Actions" can be
posted by any workflow in the merge group, which runs from the queued pull request's tree. So:

- `agent-ci-queue-verdict.yml` runs on `workflow_run` of "agent ci queue" (completed). A `workflow_run` run uses the
  default branch's copy of the file, on the default ref.
- It trusts nothing the merge group's run says about itself. It recomputes the scope from `head_sha` with `master`'s
  code, re-reads that run's jobs through the API, and decides with `master`'s `decide_queue`.
- For an entry that needs Agent evidence, every self-protected path must be byte-identical between `head_sha` and
  the `master` commit the group was built on (`merge-base(head_sha, master)`). That covers an entry AHEAD in the
  group that edited the Agent CI machinery, which the scope of this entry's own diff cannot see.
- It posts `agent-ci-required` with a dedicated GitHub App. The App's key is a secret of an environment whose
  deployment-branch policy allows `master` only; a merge-group job runs on `gh-readonly-queue/...` and cannot use
  it. The ruleset pins the required check to that App.
- The in-group job no longer posts the required context and holds no `statuses: write`.
- `agent-ci-queue.yml`, `agent-ci-required.yml` and `agent-ci-queue-verdict.yml` are in the Agent path list
  (AUDIT F2), so editing any of them is Agent + self-protected and lands only through AUDIT.

The alternative, an organization ruleset "Require workflows to pass" on a pinned ref, was not confirmed for the
Team plan and is not relied on.

Rehearsed with the real App (`northstar-agent-ci-verdict`, App ID 5877416, commit statuses only) on 2026-11-22:

| Observed | Consequence |
|---|---|
| A merge-group job asking for the environment is refused: "Branch gh-readonly-queue/master/pr-N-... is not allowed to deploy to agent-ci-verdict due to environment protection rules." | The key never reaches merge-group code. |
| A `success` under the context posted by GitHub Actions does not satisfy the App-pinned requirement, on a pull request or a merge group. | A queued pull request cannot approve itself. |
| A FAILURE under the context from the wrong source still removes the entry. | Merge-group code can hurt its own entry, never help it. |
| Statuses under one context are last-writer-wins: a later GitHub Actions status under the name put a pull request back to BLOCKED. | Nothing but the App may post `agent-ci-required`, anywhere. A rail holds that. |
| A pull request cannot enter the queue until the App has posted on the pull request's head. | `agent-ci-required.yml` also posts with the App, from `pull_request_target` (the base branch's file on the base ref; nothing of the pull request is checked out or run). |
| The App's success landed an entry 32 seconds later; its failure removed one; an Agent entry stacked behind an entry that edited the machinery failed, was rebuilt after the removal, and landed. | The follower and the machinery guard behave as designed (#2501 at `6b9fffe029`, byte for byte, with an 18-job stand-in for the Agent suite). |

Three consequences for the cutover:

- #2501 is not inert: `agent-ci-required.yml` changes behaviour when it merges, before any queue exists.
- A `pull_request_target` job for a pull request into `agent/int` runs on `agent/int`, which the master-only environment
  refuses, as it must. Those pull requests get the status from the `workflow_run` leg only, and `agent/int` must take
  `master`'s copy of the workflow before cutover.
- Every pull request open at cutover needs a push, a reopen or an agent ci run before the App's status exists on its head.

What this does not close: anything that lands on `master` can name the environment. A rail in the required static check
refuses any workflow but the two posters from naming the environment, the variable, the secret or the context; whether the
rail files or all of `.github/workflows/**` should be Agent paths is a question for AUDIT (on #2501).

### 3.7 Safeguards the queue does not replace (AUDIT D2, 8.3, 8.4)

- **Freeze windows.** The verdict fails an Agent entry on a weekday inside 09:20-09:45 or 15:30-16:15 ET, with a
  status that names the window. Other entries are not affected.
- **One Agent landing at a time.** The Agent Lead queues the next Agent pull request only after AUDIT's verified
  line for the previous one ("the previous Agent landing is prod-verified"). A stated rule, not a ruleset rule.
- **GO.** Agent pull requests are queued only by the Agent Lead, and only on AUDIT's GO line for that head. A stated
  rule in this round: the ruleset asks for 0 approvals, and `CODEOWNERS` still names the old account.
- **Records.** `agent_ci_evidence.py verify` gets a merge-group mode: the landed `master` commit equals the run's
  `merge_group.head_sha` and is on `master`'s first-parent chain; the queue ref names the pull request; all 18
  records agree on commit, tree and parents; the pull request's head is the second parent.

## 4. Today's evidence guards, one by one

| Guard in `agent_ci_evidence.py verify` | In the queue |
|---|---|
| `stale-base`, `stale-head`, `wrong-parents`, `tree-mismatch` | Held by construction: GitHub lands the commit it tested. Rehearsed, 4 of 4. |
| `evidence-ref` | Not needed: there is no tool-built commit. The tested commit is GitHub's merge group commit. |
| `dispatch-ref` | Replaced by 3.6: the verdict is computed by `master`'s copy on the default ref and posted by an identity the merge group cannot use, and the self-protected paths must be byte-identical to the `master` commit the group was built on. |
| `self-protected-diff` | Kept, same lists, same reach (a pull request that needs Agent evidence), same outcome (AUDIT's local evidence decides). |
| `missing-job`, `job-not-success`, `run-in-progress` | The verdict needs every Agent job and fails on any result but success. |
| `missing-artifact`, `record-mismatch` | Records are still uploaded per job, and `verify`'s merge-group mode reads them (3.7). |
| `pr-not-open`, `pr-not-master`, `pr-not-agent-head`, `non-pr-event`, `no-run` | Not applicable: the queue only ever builds an open pull request into `master`, and runs the Agent jobs for any head that touches an Agent path. |

## 5. What changes for people and sessions

- **Merging is "queue it".** `gh pr merge <n>` adds the pull request to the queue, or arms it to join when its
  checks pass. It has landed only when its state is MERGED. A session that reports "merged" straight after
  the command is wrong.
- **A pull request can be removed from the queue.** Read the failed check, fix, queue again.
- **No direct push to `master`.** Web-page uploads already go through a pull request since 2026-11-22.
- **Never `--admin`**, except the one case in 3.4.
- **No quiet-master wait.** The queue replaces "other release sessions are holding" and the quiet window. It
  does not replace the rules of 3.7: Agent pull requests are still queued only by the Agent Lead, after AUDIT's
  GO, outside the freeze windows, one at a time after the previous one is prod-verified.

## 6. Costs

- **Waiting behind an Agent entry.** A pull request queued behind an Agent one lands with it: up to about
  16 to 19 minutes, about 4 times a day. Other pull requests behind it are built meanwhile and land together.
- **CI.** One more run of the static check per merge (about 1,000 runner-minutes a day), and the Agent jobs
  once per queued Agent pull request, in place of today's re-arm runs. The organization's 60 job slots were
  about 52 busy on a Saturday night (2026-11-22 07:16Z); a request for 80 is with GitHub Support.
- **A flaky required check removes pull requests.** `tests/test_bars_since_index_scan.py` is intermittent
  today. It is not in either required check, and must stay out until it is fixed.

## 7. Cutover and rollback

1. Prep with no behaviour change: push triggers ignore `gh-readonly-queue/**`; the static check answers
   `merge_group` (pull request #2494).
2. The Agent part (3.3, 3.4), built and reviewed by AUDIT while switched off: the `merge_group` trigger does
   nothing until a queue exists.
3. Rehearse the Agent workflow itself on a branch of the throwaway repo.
4. Cutover in a quiet hour, sessions and people told first: "Allow auto-merge" on, then the ruleset in 3.1.
   The procedure, the message and the rollback are in `CUTOVER.md`.
5. Watch one week: queue wait (median, p90), removals, Agent open-to-merge time, runner minutes.

**Rollback:** an admin sets the queue ruleset to Disabled. Merging returns to today's behaviour at once;
nothing else was changed. **Abort rule:** queue wait p90 over 45 minutes, or the queue stuck for 30 minutes.

## 8. Questions for AUDIT

1. **Self-protected pull requests (3.4).** Two parts.
   (a) Is "fails the verdict only when the pull request also touches an Agent path; then AUDIT's local evidence
   decides and an admin lands it outside the queue" acceptable? It is today's rule carried over.
   (b) `agent-ci-queue.yml` and `agent-ci-required.yml` are the queue's own judges and are not in the Agent path
   list, so a pull request that edits only them is not held. Do you want them added to that list (your list,
   not changed by this work), so that editing the judge always needs AUDIT?
2. **Scope.** Inside the queue the Agent jobs run when the queued pull request touches an Agent path, which
   is today's rule for pull requests (`agent-ci-required`). A change outside those paths can still affect
   Agent behaviour; today that is caught by the deploy gate's full Agent run after the merge, and it would
   be in the queue too. Is that enough, or should the Agent jobs run for more paths, or for every entry
   (16 minutes per merge for everyone)?
3. **Records.** Do you want `agent_ci_evidence.py verify` kept and taught to read a merge group's records as
   the written audit trail, or are the queue's own check results enough?
4. **The hold.** Does a queue landing replace "production equals master, no promotion in flight, other
   sessions holding" in the release checklist, or does part of that stay?
5. **Anything missing.** A safeguard of yours that this table does not name.

## 9. AUDIT's review of 2026-11-22 and where each finding is answered

| Finding | Answer |
|---|---|
| D1 / F1 (blocking): the required status's source is not a trusted identity | 3.6. Built in #2501; must be rehearsed with the App before cutover. |
| D2.1 freeze windows | 3.7: the verdict fails an Agent entry inside a window. |
| D2.2 one Agent landing at a time, prod-verified | 3.7, a stated rule. |
| D2.3 GO not enforced by the ruleset | 3.7, a stated rule; a code-owner rule needs `CODEOWNERS` fixed first (owner). |
| D3 the cutover message overstates | Reworded in `CUTOVER.md` and in section 5. |
| D4 retirement | 3.5: nothing retires until AUDIT accepts. |
| 8.1(a) | Accepted by AUDIT as written (3.4). The bypass is on the queue ruleset only, for pull requests only. |
| 8.1(b) / F2 | 3.6: the three workflow files are Agent paths. |
| 8.2 scope | Accepted by AUDIT: today's path list; widen by a path if a deploy-gate Agent red is ever traced outside it. |
| 8.3 records | 3.7: `verify` merge-group mode. |
| 8.4 the hold | 3.7 and section 5. |
| 8.5 | The real Agent suite first runs in a merge group at cutover step 6 (acceptable only because a failure removes the entry and rollback is one switch); queue-timeout removals of Agent entries are on the week-one watch list. |

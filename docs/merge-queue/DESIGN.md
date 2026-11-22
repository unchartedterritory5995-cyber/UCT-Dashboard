# Merge queue on `master`: design for review

**Status: PROPOSAL. Nothing in this document is switched on.** Written 2026-11-22.
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

## 3. Design

### 3.1 Rules on `master`

Today: no deletion, no force push (ruleset 27828221); `master gate static checks` required (27829824).
Added at cutover, in ONE NEW ruleset, so one switch turns the queue off and the two rulesets above stay as they are:

- pull request required (0 approvals), which ends direct pushes to `master`;
- merge queue: method merge, 5 builds at once, groups of 1 to 5, check timeout 30 minutes;
- required check `agent-ci-required`, pinned to GitHub Actions as its source (it exists as a commit status today;
  see 3.3). `master gate static checks` stays required through ruleset 27829824.

The repo setting "Allow auto-merge" is turned on.

### 3.2 Unchanged

- The master deploy gate, including the full Agent suite it runs on every `master` push.
- `promote-production.yml` and every Railway service.
- `agent/int`, every other branch, and every advisory pull-request workflow.

### 3.3 Agent evidence inside the queue

`agent-ci.yml` gets a `merge_group` trigger and one small `scope` job that runs first:

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
   - failure otherwise, and always failure when `scope` found a self-protected path (3.4).

On a pull request `agent-ci-required` keeps today's meaning, so a pull request can enter the queue exactly
when it can be merged today.

### 3.4 A pull request that edits what its own run executes

In a merge group the workflow file comes from the merge group's commit, so it includes the queued pull
request's edits. That is weaker than today's re-arm, where a `repository_dispatch` always runs `master`'s
copy. The design keeps today's rule rather than weakening it:

- `scope` fails the verdict for any queued pull request that touches a self-protected path, with the same
  message as today: its own run could vouch for itself, so AUDIT's local evidence decides.
- Such a pull request lands outside the queue, by an owner or admin, after AUDIT signs off. The ruleset's
  bypass list holds that one role, for pull requests only.
- For every other pull request, "touches no self-protected path" means its workflow files and evidence
  tools are byte-identical to `master`'s, which is the property `dispatch-ref` protects today.

A stronger option exists if the organization's plan offers it: an organization ruleset with "Require
workflows to pass", which runs a named workflow from a pinned ref whatever the pull request contains.
Not verified; it needs an organization admin to look (question 8.1).

### 3.5 What retires, after AUDIT accepts

`tools/agent_ci_rearm.py`, the `refs/agent-ci-evidence/**` namespace and the `repository_dispatch` trigger
are no longer needed to merge. They stay in the tree until AUDIT says the queue's records replace them.

## 4. Today's evidence guards, one by one

| Guard in `agent_ci_evidence.py verify` | In the queue |
|---|---|
| `stale-base`, `stale-head`, `wrong-parents`, `tree-mismatch` | Held by construction: GitHub lands the commit it tested. Rehearsed, 4 of 4. |
| `evidence-ref` | Not needed: there is no tool-built commit. The tested commit is GitHub's merge group commit. |
| `dispatch-ref` | Replaced by 3.4: either the workflow is byte-identical to `master`'s, or the verdict fails. |
| `self-protected-diff` | Kept, same lists, same outcome (AUDIT's local evidence decides). |
| `missing-job`, `job-not-success`, `run-in-progress` | The verdict needs every Agent job and fails on any result but success. |
| `missing-artifact`, `record-mismatch` | Records are still uploaded per job. Whether `verify` keeps reading them is question 8.3. |
| `pr-not-open`, `pr-not-master`, `pr-not-agent-head`, `non-pr-event`, `no-run` | Not applicable: the queue only ever builds an open pull request into `master`, and runs the Agent jobs for any head that touches an Agent path. |

## 5. What changes for people and sessions

- **Merging is "queue it".** `gh pr merge <n>` adds the pull request to the queue, or arms it to join when its
  checks pass. It has landed only when its state is MERGED. A session that reports "merged" straight after
  the command is wrong.
- **A pull request can be removed from the queue.** Read the failed check, fix, queue again.
- **No direct push to `master`.** Web-page uploads already go through a pull request since 2026-11-22.
- **Never `--admin`**, except the one case in 3.4.
- **No more "hold while Agent releases".** The release checklist's "other release sessions have been told and
  are holding" (docs/agent/program/INTEGRATION.md) is what the queue replaces; see question 8.4.

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

1. **Self-protected pull requests (3.4).** Is "the verdict fails, AUDIT's local evidence decides, an admin
   lands it outside the queue" acceptable? Or do you want the organization-level required workflow
   investigated first?
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

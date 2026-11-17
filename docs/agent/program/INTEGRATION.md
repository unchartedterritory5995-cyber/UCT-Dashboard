# Integration and release readiness

## A specialist PR is ready to merge into `agent/int` when

- [ ] `tools/agent_ownership_check.py --as <owner>` passes. Any EXTERNAL file has agent-lead's written approval in the PR.
- [ ] New behaviour is dark: the server flag defaults off, and nothing changes for members or admins while the flag is off.
- [ ] Its own tests are present and pass: unit and contract tests, and a `panelHarness` scenario for anything a user can see.
- [ ] The Agent pytest and vitest suites pass locally under the suite lock, with counts in the PR.
- [ ] Every new data kind returns valid MD-1 envelopes (`validate_envelope`), with an honest `as_of` and freshness class.
- [ ] No new upstream connection, scheduler job, database or engine. Price reads don't trigger alerts.
- [ ] No paid model calls. Budgets and limits are unchanged, or the change is approved.
- [ ] The golden manifest is unchanged, or the PR says why a capability registration changes it.
- [ ] The author's `status/<session>.md` is updated.

## `agent/int` is healthy when, after every merge

- [ ] agent-lead has regenerated the golden manifest if needed, and the Agent pytest and vitest suites pass on `agent/int`.
- [ ] agent-qa's conformance, cost and integration suites pass on `agent/int`, and the verdict is in `status/agent-qa.md`.

## An `agent/int` → master release is ready when

- [ ] The owner has authorized this release.
- [ ] `agent/int` is healthy, as above.
- [ ] Production equals master at the current commit, no promotion is in flight, and the other release sessions (Indicators, News …) have been told and are holding.
- [ ] `agent/int` has been refreshed against master, and the suites have been re-run.
- [ ] All required PR checks are green on the release candidate.
- [ ] Flags stay off in production. Turning one on is a separate owner decision.
- [ ] After promotion: the exact production commit, the live bundle, `/api/health`, `/healthz`, and admin-only access are verified. flow-worker is not restarted.

## Merge-tree evidence for an `agent/**` PR into master (P2, proposed 2026-11-17)

**Status: inert until its PR is merged. Activation = that merge, after AUDIT's full T2 review AND the owner's OK.**
Until then, the push run on the branch head (the head on its OLD base) stays the only evidence, as today.

The push run proves the PR head; what lands on master is the merge of that head with master's current tip. Once
active, `.github/workflows/agent-ci.yml` also runs all 13 required jobs (8 browser shards) on the `pull_request`
event of a same-repo `agent/**` PR into master, i.e. on `refs/pull/N/merge`. PRs into `agent/int` are unchanged.
Push runs are unchanged (every added step is skipped on push; rails: `tests/test_ci_agent_merge_ref.py`).

1. **Run.** Each required job uploads `agent-ci-evidence-pr<N>-<job key>`: the merge commit, its tree, its parents
   (base tip, PR head), the run id, and the failed test names per suite (pytest junit, vitest JSON), so two runs'
   offenders can be compared. The concurrency group is per PR (`agent-ci-pr-<N>`): pushes elsewhere never cancel
   it; a new push to the same PR supersedes it (its tree is no longer the PR's).
2. **Re-arm** when master moved: `python tools/agent_ci_rearm.py --pr <N>`. It waits for GitHub's merge ref to be
   exactly [master tip, PR head], refuses a conflict / stale ref / non-agent / non-master PR, then dispatches
   agent-ci.yml ONCE (`workflow_dispatch`, inputs `pr` + `merge_sha`) for that PR only. No commit is made; the PR is
   not touched. Every job checks out that one merge commit.
3. **Verify** from a master checkout: `python tools/agent_ci_evidence.py verify --pr <N> --tree <expected tree>`
   (add `--accept-dispatch` to accept a re-arm run, and only one whose workflow is master's
   `.github/workflows/agent-ci.yml`). PASS only when the newest evidence run for the PR is completed,
   every required job (read from master's agent-ci.yml) is success, all 13 records are present and agree, the merge
   commit's parents are the CURRENT master tip and PR head, and its tree is the expected tree. Everything else is a
   named FAIL (self-protected diff, dispatch ref, no run, run in progress, non-PR event, missing job, job not success, missing artifact, record
   mismatch, stale merge ref, tree mismatch, API error).

Cost: an `agent/**` PR into master that touches an Agent path pays one more full Agent run per PR push (the push run
still runs). `agent-ci-required` is unchanged and still reads the push run.

**Self-protected PRs never pass on their own run (AUDIT F1).** A `pull_request` run executes the merge ref's workflow,
record tool, test config and dependencies. A PR whose diff touches `.github/workflows/**`, `tools/agent_ci_*.py`,
`tools/agent_suite_lock.py`, `app/package*.json`, `app/vite*.config.*`, `app/vitest*.config.*`, a vitest `setupFiles`
entry (read from master's config), `pytest.ini`, any `conftest.py` or any `requirements*.txt` gets
`FAIL self-protected-diff` (as does an unreadable or truncated diff); such a PR falls back to AUDIT's local evidence.
The re-arm tool has no `--ref`: it always dispatches master's agent-ci.yml (AUDIT F2).

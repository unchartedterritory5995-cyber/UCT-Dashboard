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

## Merge-tree evidence for an `agent/**` PR into master (P2 + P2b, 2026-11-17)

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
2. **Re-arm** when master moved: `python tools/agent_ci_rearm.py --pr <N>` (P2b). GitHub does not refresh
   `refs/pull/N/merge` while master moves fast (2026-11-17: all ~40 open PRs stale), so the tool no longer waits for
   it. It fetches the master tip and the PR head, builds the merge ITSELF (`git merge-tree --write-tree`, a conflict =
   refuse; `git commit-tree T -p <master tip> -p <PR head>`, fixed identity and date), re-reads the commit's parents
   and tree, pushes it to `refs/agent-ci-evidence/pr-<N>`, then starts agent-ci.yml ONCE for that PR only with a
   `repository_dispatch` (P2c, 2026-11-18: event_type `agent-ci-evidence`, client_payload `{pr: <int>, merge_sha: C}`;
   the re-arm token may POST /dispatches but not workflow_dispatch, and workflow_dispatch is no longer a trigger).
   A repository_dispatch always runs master's copy of the workflow. Every job validates the payload FIRST (pr
   `^[1-9][0-9]{0,6}$`, merge_sha `^[0-9a-f]{40}$`, through `env:`, never in a shell) and checks out that one commit;
   the run's GITHUB_SHA is master's tip, so the evidence record carries `git rev-parse HEAD` after checkout. The
   dispatch returns no run id: verify finds the run by its `agent-ci-evidence-pr<N>-*` artifacts. The PR and its
   branch are not touched.
   **New write capability: the re-arm tool pushes refs matching `agent-ci-evidence/pr-<N>`** (the full ref is
   `refs/agent-ci-evidence/pr-<N>`). That namespace is tool-owned: one ref per PR, force-updated only by
   `tools/agent_ci_rearm.py`, from a refspec built from the integer PR number and re-checked before every push; it
   can never target master, production, `agent/*`, `refs/pull/*` or `handoff/*`. It is not under `refs/heads/` or
   `refs/tags/`, so no workflow's push / create / pull_request trigger fires on it (a rail derived from
   `.github/workflows/*.yml` in `tests/test_agent_ci_evidence.py` holds that). Deleting a stale one is harmless.
3. **Verify** from a master checkout: `python tools/agent_ci_evidence.py verify --pr <N> --tree <expected tree>`
   (add `--accept-dispatch` to accept a repository_dispatch re-arm run, and only one whose workflow is master's
   `.github/workflows/agent-ci.yml`, whose workflow commit is on master's current history, and whose recorded checkout
   is what `refs/agent-ci-evidence/pr-<N>` points at now; a workflow_dispatch run is never accepted). It trusts
   the tested commit's CONTENT, not a ref name or an author: PASS only when the newest evidence run for the PR is
   completed, every required job (read from master's agent-ci.yml) is success, all 13 records are present and agree,
   the commit's parents are exactly [master tip, PR head] AT VERIFY TIME, and its tree is the expected tree.
   Everything else is a named FAIL (self-protected diff, dispatch ref, evidence ref, no run, run in progress, non-PR
   event, missing job, job not success, missing artifact, record mismatch, wrong parents, stale base, stale head,
   tree mismatch, API error). The self-protected check still reads the PR's own diff vs its merge base with master
   (`pulls/N/files`), never the evidence commit's diff.

Cost: an `agent/**` PR into master that touches an Agent path pays one more full Agent run per PR push (the push run
still runs). `agent-ci-required` is unchanged and still reads the push run.

**Self-protected PRs never pass on their own run (AUDIT F1).** A `pull_request` run executes the merge ref's workflow,
record tool, test config and dependencies. A PR whose diff touches `.github/workflows/**`, `tools/agent_ci_*.py`,
`tools/agent_suite_lock.py`, `tools/agent_vitest_shards.py`, `tools/agent_vitest_shard_timings.json`, `app/scripts/**`,
`app/package*.json`, `app/vite*.config.*`, `app/vitest*.config.*`, a vitest `setupFiles` entry, every file the configs
import by a relative path (followed transitively; all read from master's checkout, unreadable = FAIL), `pytest.ini`, any `conftest.py` or any `requirements*.txt` gets
`FAIL self-protected-diff` (as does an unreadable or truncated diff); such a PR falls back to AUDIT's local evidence.
The re-arm tool has no `--ref`: it always dispatches master's agent-ci.yml (AUDIT F2).

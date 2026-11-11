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

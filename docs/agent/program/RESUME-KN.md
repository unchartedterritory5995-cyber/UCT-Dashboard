# RESUME — Trading Brain knowledge integration (KN-1), appended record for the integrator

Kept as its own file on `agent/kn/knowledge-poc` (not an edit to `RESUME.md`) so merging it can never conflict with the integrator's RESUME.md on `agent/int`.

- Branch: `agent/kn/knowledge-poc` (worktree `C:/w/kn-1`), base `agent/int` `06ba3eefcf`.
- PR: draft into `agent/int-w2` (per AUDIT 2026-11-03). Do not merge while merges are frozen.
- Board: `docs/agent/knowledge/STATUS.md`. QA record: `docs/agent/knowledge/QA-RESULTS.md`. Design: PR #723.
- Shared files touched (additive, AUDIT-approved): `api/services/uct_agent/marketdata/gateway.py` (REGISTRARS, CATEGORIES, enabled_kinds filter), `api/services/uct_agent/turn_v2.py` (_DOMAIN_OF), `app/src/agent/builtins.js` (one call), `app/src/agent/routing.js` (one group with empty words). Expect trivial merges with #724/#726/#728/#729/#734 at integration.
- Golden manifest: not regenerated here (the capabilities are server-gated and absent from the golden run); regenerate on the integration branch.
- Activation (owner only): `UCT_AGENT_KNOWLEDGE=1` + `knowledge.search,setup.playbook,setup.record` in `UCT_AGENT_DATA_KINDS`.

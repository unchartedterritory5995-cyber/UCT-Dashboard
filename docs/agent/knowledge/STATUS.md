# Trading Brain → UCT Agent knowledge program — STATUS (the durable board)

Resume from this file. It is the record; chat messages are notices only.

## Authority and boundaries
- Owner authorized implementation 2026-11-03 (overnight program after design PR #723): three-kind PoC on the MD-1 gateway over the read-only Brain facades; dashboard-side source policy, default-deny, team-owned sources only; free deterministic tests only.
- NOT authorized: merge to master, deploy, flag activation, member rollout, paid model calls, external model calls, new source families, proprietary-data export, flow-worker restart, any change to the partner's pipeline, the planner, the Brain engines or the indicator systems.
- Owner usage note 2026-11-03: usage limit near; commit and push coherent work early; keep this board current.

## Branches
| Branch | Worktree | Base | Purpose |
|---|---|---|---|
| `docs/agent-brain-integration-2026-11-03` | scratch clone (session scratchpad) | master `e6740b5b08` | design docs, draft PR #723 (commit `33a87385`) |
| `agent/kn/knowledge-poc` | `C:/w/kn-1` | `origin/agent/int` `06ba3eefcf` | implementation (this board) |

## Shared-file rule (main Agent team is active)
Wave 1.1 (`agent/w11/*`), Wave 2 (`agent/w2/*`, `agent/int-w2`) and Wave 3 (`agent/w3/*`, `agent/int-w3`) are editing `turn.py`, `turn_v2.py`, `routing.js`, `builtins.js`, `capabilities.js`, `api/routers/uct_agent.py`, `manifest.golden.json`. This program edits **none of them** until the main integrator (session AUDIT) approves. All new code lives in owned new paths:
- `api/services/uct_agent/knowledge/**`, `tests/test_uct_agent_knowledge*.py`, `tests/fixtures/knowledge/**`
- `app/src/agent/capabilities/knowledge*.js`, `app/src/agent/agentKnowledge*.test.*`
- `docs/agent/knowledge/**`

The hook edits still needed (requested from AUDIT, not done): `marketdata/gateway.py` REGISTRARS + CATEGORIES; `builtins.js` one registration call; `routing.js` group for the knowledge capabilities; `turn_v2._DOMAIN_OF` prefix; manifest golden regen; feature_flags.json row for `UCT_AGENT_KNOWLEDGE`.

## Overlap with Wave 3 (recorded, not duplicated)
W3-1 `coach.explain` serves a curated concept set in `docs/agent/coach/concepts/*.md`. The brain kinds serve the partner's Brain Pack KB and templates. They are complementary sources; neither replaces the other. W3-5 / W3-6 (setup analysis / historical comparison) can consume `setup.playbook` / `setup.record` once integrated.

## Tasks
| id | task | state | commit | evidence |
|---|---|---|---|---|
| K-00 | Worktree + board | done | (this commit) | |
| K-01 | Policy file `docs/agent/knowledge/policy.json` + `policy.py` (default-deny, licence classes, floors, dated rules) | todo | | |
| K-02 | FTS index over the installed pack, keyed on pack ts (lazy rebuild + on_install), no external calls | todo | | |
| K-03 | Kinds `knowledge.search`, `setup.playbook`, `setup.record` (+ `register(registry)`) | todo | | |
| K-04 | Server tests with a synthetic fixture pack (no real brain data in git) | todo | | |
| K-05 | Browser QUERY capabilities `playbook.*` (dark unless kinds served) + tests | todo | | |
| K-06 | Health / coverage report at reindex | todo | | |
| K-07 | With/without-brain comparison suite (deterministic) | todo | | |
| K-08 | Local demo against the real snapshot (output kept in the scratchpad, not git) | todo | | |
| K-09 | Hook edits (needs AUDIT OK) | blocked (coordination) | | |
| K-10 | Independent review + consolidated RC branch | todo | | |

## Next step to resume
Pick the first `todo` row above. Run server tests with `C:/Users/blake/projects/UCT-Dashboard/.venv/Scripts/python.exe -m pytest tests/test_uct_agent_knowledge*.py -q` from `C:/w/kn-1`.

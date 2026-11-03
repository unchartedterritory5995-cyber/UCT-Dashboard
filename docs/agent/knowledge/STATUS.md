# Trading Brain → UCT Agent knowledge program — STATUS (the durable board)

Resume from this file. It is the record; chat messages are notices only. Last updated 2026-11-03 (overnight session).

## Authority and boundaries
- Owner authorized implementation 2026-11-03 (overnight program after design PR #723): three-kind PoC on the MD-1 gateway over the read-only Brain facades; dashboard-side source policy, default-deny, team-owned sources only; free deterministic tests only.
- NOT authorized: merge to master, deploy, flag activation, member rollout, paid model calls, external model calls, new source families, proprietary-data export, flow-worker restart, any change to the partner's pipeline, the planner, the Brain engines or the indicator systems.
- Main integrator (session AUDIT) 2026-11-03: OK for hooks 1–6 as one commit on this branch; **merges are frozen program-wide until the owner returns**; open a DRAFT PR into `agent/int-w2` (not `agent/int`); integrator regenerates the golden manifest at merge time.

## Branches, commits, PRs
| Branch | Worktree | Base | Head | PR |
|---|---|---|---|---|
| `docs/agent-brain-integration-2026-11-03` | session scratchpad clone | master `e6740b5b08` | `33a87385` | #723 draft → master (design docs) |
| `agent/kn/knowledge-poc` | `C:/w/kn-1` | `origin/agent/int` `06ba3eefcf` | see `git log` (last recorded below) | draft → `agent/int-w2` (see RESUME-KN) |

Commits on `agent/kn/knowledge-poc`, oldest first:
| Commit | What |
|---|---|
| `20db0d1534` | this board (K-00) |
| `1e95267442` | server package: policy, pack, FTS index, guard, stats, three kinds, 41 tests (K-01..K-04) |
| `e106cc1932` | health / coverage report (K-06) |
| `6c7e2d88a2` | browser QUERY capabilities `playbook.*` + 13 tests (K-05) |
| `68c401482a` | hooks 1–4 (gateway, builtins, routing group, turn_v2 domain), AUDIT-approved |
| `17e553f48b` | with/without-Brain comparison suite (K-07) |
| `3f3afea069` | fix: dark routing regression, isolation rail (literal kinds), clock rail |
| `f9a03577da` | independent review round 1 fixes (findings 2–7, 9) |

## Tasks
| id | task | state | evidence |
|---|---|---|---|
| K-00 | Worktree + board | done | |
| K-01 | Default-deny policy (`docs/agent/knowledge/policy.json`, `policy.py`) | done | admitted: trader_archive, setup_knowledge only |
| K-02 | Local FTS index keyed on pack version (lazy rebuild + on_install, atomic, cooldown) | done | real snapshot: 19,024 rows in 0.66 s |
| K-03 | Kinds `knowledge.search`, `setup.playbook`, `setup.record` | done | |
| K-04 | Server tests (synthetic fixture pack) | done | 67 passed |
| K-05 | Browser capabilities + tests | done | 13 passed |
| K-06 | Health / coverage report | done | QA-RESULTS.md §1 |
| K-07 | With/without-Brain comparison | done | 20/20 vs 0/20; 0/8 control false matches |
| K-08 | Real-snapshot demo (scratchpad only) | done | QA-RESULTS.md §2 |
| K-09 | Hooks | done (1–4); 5 deferred to integrator; 6 dropped (ledger lists no Agent flags) | `68c401482a` |
| K-10 | Independent review round 1 | done; all findings fixed except 8 (known limitation) | QA-RESULTS.md §5 |
| K-11 | Full Agent suites on head `f9a03577da` | running at handoff time if not recorded below | logs: scratchpad `kn-runs/server-f9a035.log`, `browser-f9a035.log` |
| K-12 | Draft PR into `agent/int-w2` + RESUME-KN note | todo → see RESUME-KN | |
| K-13 | Second review round on the final head | todo | |

## Full-suite record
| Head | Server (tests/test_uct_agent*.py + brain tests) | Browser (src/agent) |
|---|---|---|
| `68c401482a` | 2,148 passed, 1 failed (clock rail — this branch; fixed) | 2,576 passed, 3 failed (this branch; fixed) |
| `f9a03577da` | (pending) | (pending) |

## Blocked / needs the owner
- Admitting `self_review`, `manual`, `chart_intake:*` or any `intake:*` source (policy.json is the switch; default-deny until the owner rules).
- Activation: `UCT_AGENT_KNOWLEDGE=1` and the three kinds in `UCT_AGENT_DATA_KINDS` — owner only, after merge.
- Paid real-model comparison — not authorised.
- Partner: additive PACK_MANIFEST fields `schema_version`, `kb_sources`, `stats_updated_at` (compat behaviour in place; reported missing, never invented); fix the "high tight flag" alias attached to two templates.

## Known limitations (recorded for the integrator)
- With the feature ON, a message that matches ONLY the playbook group narrows the routed request to it (review finding 8). Does not affect dark mode.
- Retrieval is lexical (FTS5, porter stemming); no embeddings by design (no external calls).

## Next step to resume
1. Read the two `kn-runs/*-f9a035.log` tails (or rerun: from `C:/w/kn-1`, `python tools/agent_suite_lock.py run --who agent-kn -- <python> -m pytest tests/test_uct_agent*.py -q`; from `C:/w/kn-1/app`, `... -- npx vitest run src/agent`) and record them above.
2. If green: open the draft PR into `agent/int-w2` (K-12) and run review round 2 (K-13).
3. Do not merge anything; merges are frozen until the owner returns.

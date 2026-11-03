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
| `224f057b8e` | board, QA record, RESUME-KN |
| `8a4993b520` | independent review round 2 fixes (live figure not withheld; pack-scoped cooldown) |
| `f4e89bf1d8` | relevance: query expansion from the pack template aliases (K-14) |
| `a288af7607` | routing narrowing pinned as an expected failure |
| `f0e2e24c6c` | retrieval quality round (K-15) |
| `8f8bdd1605` | routing: playbook group add-only (review finding 8; AUDIT-approved shared-file change) |
| `3852446f29` | setup-criteria pilot + KN-1 contract with the measurables table (K-16; AUDIT go) |

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
| K-11 | Full Agent suites on head `f9a03577da` | done: all green | server 2,156 passed; browser 2,653 passed, 6 skipped |
| K-12 | Draft PR into `agent/int-w2` + RESUME-KN note | done | PR #735 (draft) |
| K-13 | Second review round | done: 0 blocking; findings 1, 2, 4 fixed in `8a4993b520`; 3 and 5 recorded | |
| K-14 | Relevance: expand shorthand (EP, U&R, VCP, HTF…) with the template names/aliases from the pack, whole-word only | done | real snapshot, 6 shorthand questions: top passages naming the setup in full 7/14 → 9/13 |

| K-15 | Retrieval quality: adjacent-word phrases, precise alias expansion (name match wins), focused excerpts, whole-passage injection check, guard precision | done | real snapshot, 40 questions: P@3 0.86 -> 0.89; success 37 -> 38/40; guard false positives 3 -> 0 of 5,270; p95 23.6 -> 18.8 ms |
| K-16 | Derived setup criteria (pilot: Stage 2 Breakout, EP, VCP, HTF, U&R), validated, served only when reviewed; KN-1 contract measurables | done (all reviewed:false) | criteria tests; contract-table equality test |
| K-17 | Routing finding 8 fixed (add-only group) | done | "explain this setup" keeps chart actions |

## Full-suite record
| Head | Server (tests/test_uct_agent*.py + brain tests) | Browser (src/agent) |
|---|---|---|
| `68c401482a` | 2,148 passed, 1 failed (clock rail — this branch; fixed) | 2,576 passed, 3 failed (this branch; fixed) |
| `f9a03577da` | 2,156 passed, 0 failed | 2,653 passed, 6 skipped, 0 failed |
| `8a4993b520` | knowledge + clock rail 69 passed (change is knowledge-package only) | knowledge suites 87 passed |

## Blocked / needs the owner
- Admitting `self_review`, `manual`, `chart_intake:*` or any `intake:*` source (policy.json is the switch; default-deny until the owner rules).
- Activation: `UCT_AGENT_KNOWLEDGE=1` and the three kinds in `UCT_AGENT_DATA_KINDS` — owner only, after merge.
- Paid real-model comparison — not authorised.
- Partner: additive PACK_MANIFEST fields `schema_version`, `kb_sources`, `stats_updated_at` (compat behaviour in place; reported missing, never invented); fix the "high tight flag" alias attached to two templates.

## Known limitations (recorded for the integrator)
- (fixed in 8f8bdd1605) knowledge-only messages no longer narrow the routed request.
- 31 of 48 templates have no Wisdom vocabulary id (owner decision raised by AUDIT); resolution is by template name + alias, ambiguity refused.
- The VCP RS-rank criterion is blocked by F-16 until an owner-approved public alternative exists.
- Routing words are armed when the capabilities register and only disarmed by the test reset; nothing unregisters them at runtime today (review round 2, latent).
- A facade row with a win rate but no win count is withheld (fails closed).
- Retrieval is lexical (FTS5, porter stemming); no embeddings by design (no external calls).

## Next step to resume
The PoC is complete and reviewed; it is waiting on the owner. Release candidate = PR #735 head (GO for owner evaluation as a dark admin-only RC; HOLD on activation until the owner admits sources and sets the flag).
1. Owner: review PR #735; decide sources beyond team-owned; when merges reopen, the integrator merges into `agent/int-w2` and regenerates the golden manifest.
2. Optional free work within scope: an FTS synonym table for UCT slang (EP, U&R, HTF) to raise recall; health card on the Admin page (needs a page-owner OK).
3. Do not merge anything; merges are frozen until the owner returns.

# Wave 1.1 — conditional overnight release checklist (owner's eight conditions)

Fill every row with evidence before any merge to master. Any row not PASS → HOLD (keep the RC on `agent/int`, continue safe work, report in the morning).

| # | Condition (owner, 2026-11-03) | How verified | Result |
|---|---|---|---|
| 1 | Changes limited to the listed fixes (LT-1, LT-3, LT-4, LT-8, LT-9, LT-10, LT-11, LT-12, F-16/F-23 re-check, regression tests, flag investigation record, template read-only check) and their tests | `git diff --stat origin/master...agent/int` reviewed file by file; independent reviewer confirms scope | |
| 2 | Independent review explicitly approves the final combined release | reviewer verdict recorded here with the RC head | |
| 3 | All required Agent, security, isolation and master deployment gates pass | agent-ci green on the RC head (server + 4 shards + union); QA rails (isolation*, f16, member_refused, scan_hidden) counts; master deploy gate green after the push | |
| 4 | No unrelated change, security weakening, database migration, or destructive operation | diff scan: no file under api/services/uct_agent/store.py schema changes (new tables), no budget.py/limits.py/auth changes, no flag default changes, no deletions of rails | |
| 5 | No new production feature flag or member access enabled | no new env read with a default that changes behaviour; `require_admin_dark` unchanged; no flag change on Railway | |
| 6 | Production deployment gate idle before merge; release synchronized with the latest master | `gh run list --workflow "master deploy gate"` shows no in-progress run; `agent/int` contains `origin/master` at merge time | |
| 7 | Rollback path verified and available | `git revert -m 1 <merge>` dry-run applies cleanly on a scratch branch; flags unchanged so no flag rollback needed | |
| 8 | Compatible with the current production configuration | the fixes assume the flags as read on 11-03 04:45Z (all ON; planner v1); no new kind must be added to `UCT_AGENT_DATA_KINDS` | |

Post-deploy (owner's instruction): verify exact production commit (production branch + live bundle), `/api/health`, authorization (anonymous 401; admin 200), budgets (`/api/agent/budget`), flags (`/api/agent/config`); rerun the failed live scenarios within the production Agent budget on the disposable test layout; no real user data touched; stop if a step would need the paid eval infrastructure. Wave 1.1 is NOT owner-accepted overnight.

## Results — candidate agent/rc/w11 @ b3ed064223 (draft PR #747), recorded 2026-11-03
| # | Result | Evidence |
|---|---|---|
| 1 | MET | final independent review (reviews/review-w11-final.md): every code change maps to LT-1/3/4/8/9/10/11/12, F-16 or review fixes; b3ed064223 adds only the test-only modelIsolation pre-filter |
| 2 | MET (technical) | review-w11-final.md technical GO on e4d958cccd; delta e4d958cccd..b3ed064223 = one test file (qa/modelIsolation.test.jsx), independently re-verified by the #735 reviewer (byte-identical cherry-pick, knowledge reader proven scanned) |
| 3 | MET | agent ci run 41690742464 on b3ed064223: server, 4 browser shards, shard-equivalence rail all success; other PR checks success (term018 guards re-run success after a cancelled attempt); local full suites pytest 2350 / vitest 2799 + 6 skipped, 0 failed; modelIsolation scan 0.5 s (was ~10 s) |
| 4 | MET | no store/budget/limits/auth/migration file in the diff; no file deleted; one rail intentionally inverted (NL-1 legacy coercion, recorded) |
| 5 | MET | no new env read, no default change, require_admin_dark untouched |
| 6 | RE-CHECK AT MERGE | master moved to f014e73506 (+4 commits, docs/pine/W4-BREAKDOWN.md only); candidate merges cleanly; master deploy gate was in_progress for f014e73506 — must be idle and candidate synced immediately before merge |
| 7 | MET | scratch merge onto master + `git revert -m 1` applies cleanly and restores master's tree exactly; no data/flag rollback needed |
| 8 | MET | review-w11-final.md: behaviour changes under the current ON flags are the listed fixes only; no new kind for UCT_AGENT_DATA_KINDS |
Non-blocking follow-ups: NB-A claim qualifiers; NB-B sector_rs ordering; tools/agent_eval_ledger.stub_research stays bound to turn._research across tests (test-isolation leak, test-only; can mask a test that stubs turn._web_search); app/src/noRegexLookbehind.test.js pre-existing failure from agent/__fixtures__/program/sentinels.js:16 (identical on master; not in any gate).

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

# Flaky tests — DERIVED

⚠️ Written by `tools/ci_inventory.py --flaky`. **Not hand-edited, and not a quarantine list**: it is re-derived from the record on every run, so a test leaves it the moment the evidence stops supporting it.

**The rule (F-CI-30).** A test is FLAKY when the record shows it in BOTH states across two runs that no code change can distinguish — the same commit SHA, or a diff that cannot reach a test. It leaves after **5** consecutive stable runs. ⛔ There is NO rerun-on-failure anywhere in this pipeline.

| FLAKY_SIZE | FLAKY_NEW | FLAKY_FIXED |
|---|---|---|
| **0** | 0 | 0 |

## The pairs the record could compare

| runs | comparable | why |
|---|---|---|
| #1508 → #1509 | no | api/live_massive_router.py is referenced by 66 source file(s); api/main.py is referenced by 2203 source file(s); api/routers/admin_twitter.py is referenced by 1 source file(s) |
| #1509 → #1510 | no | .github/workflows/full-suite-report.yml changed the suite-running job(s) vitest; api/flow_router.py is referenced by 50 source file(s); api/live_massive_router.py is referenced by 68 source file(s) |
| #1510 → #1511 | no | .github/workflows/full-suite-report.yml changed the suite-running job(s) pytest; .github/workflows/master-deploy-gate.yml changed the suite-running job(s) gate; .github/workflows/promote-production.yml changed OUTSIDE `jobs:` — every job sees that |
| #1511 → #1512 | no | .github/workflows/agent-ci.yml changed the suite-running job(s) browser; .github/workflows/full-suite-report.yml changed the suite-running job(s) collect_profile; .gitignore is referenced by 15 source file(s) |
| #1512 → #1513 | **UNREADABLE** | .github/workflows/agent-ci-required.yml is UNREADABLE at one of the two commits |
| #1513 → #1514 | no | .github/workflows/agent-ci.yml changed the suite-running job(s) browser, capability-regression-clock, server, union; api/backfill_from_patches.py is referenced by 5 source file(s); api/backfill_ticktest.py is referenced by 3 source file(s) |
| #1514 → #1515 | **UNREADABLE** | .github/workflows/front-door.yml is UNREADABLE at one of the two commits |
| #1515 → #1516 | **UNREADABLE** | .github/workflows/live-check.yml is UNREADABLE at one of the two commits |
| #1516 → #1519 | **UNREADABLE** | .github/workflows/authoring-eval-runner.yml is UNREADABLE at one of the two commits |
| #1519 → #1521 | no | the shard plan differs (3a534f99e vs b790d6af0): who shares a process changed |
| #1521 → #1524 | no | the shard plan differs (b790d6af0 vs 60f9a84fb): who shares a process changed |
| #1524 → #1528 | no | the shard plan differs (60f9a84fb vs 9a69e30c0): who shares a process changed |

⛔ **0 of 12 consecutive pairs were comparable.** A pair that is not comparable contributes NO evidence in either direction — it cannot make a test flaky and it cannot clear one.

## No test qualifies

⭐ That is a statement about the EVIDENCE, not a clean bill of health: with 0 comparable pair(s) in the record, the set can only be as large as what those pairs could show.


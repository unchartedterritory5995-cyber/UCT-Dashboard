# Indicators Phase A0 — final release preparation

**Release candidate:** `release/indicators-a0` @ **`f37a754a06`** (worktree `C:/w/ia0rc`). Local only, not pushed.

**Bases:**
- Master: `8f2b324a65`.
- Production: `1eba7c105c`.
- Flow-worker's last redeploy: marker #15, `af02539345`.

## 1. Changes on master since A0 branched (`1eba7c105c`)

| Commit | Owner | Files | Overlap with A0 |
|---|---|---|---|
| `a069e34736` | Agent (Open chart) | `app/src/agent/*` | none |
| `613176029c` | Breadth (first-read warm-up) | `breadth_authority.py`, `breadth_symbols.py`, test | none |
| `8f2b324a65` | Breadth (ledger classification) | `LEDGER.md` | none |

**Master is 3 commits ahead of production that are not A0's.** Promoting any master tip that contains A0 also promotes them, unless their owners promote first.

## 2. The candidate: only approved A0 changes

| Commit | Content | Notes |
|---|---|---|
| `a6093dff2c` | A0 code | patch-id equal to the reviewed `e5be36329f` |
| `0c291d345a` | A0 report | patch-id equal to `6f4847b12e` |
| `f37a754a06` | flow-worker marker bump **#17** | the only new content |

The candidate diff equals the reviewed A0 diff byte for byte, apart from the marker line.

## 3. Marker ownership

- **#16 stays reserved** for the alert-coverage RC (`C:/w/uie7`). That RC was prepared in this session and has no other live owner.
- **A0 takes #17**, and its marker line says so, so no number is reused whichever ships first.

Flow-worker was measured from its last redeploy, not from production. No watched file changed on master after #15 (`af02539345`), so #17 discharges **13 stranded files**:

| Group | Files | Classification | Source |
|---|---|---|---|
| A0 | `indicator_alert_service.py`, `user_definitions.py` | NOT EXERCISED | Reached only via delivery/`claim_delivery`. The save guard runs on web save routes; the sweep is web's 5-minute job |
| Breadth ×8 | `breadth_{alerts,authority,current,eod_source,exchange_authority,live_universes,nhnl_validation,symbols}.py` | Owner classified no-bump in `LEDGER.md` | BREADTH confirmed on 2026-10-13 that riding along is harmless |
| `fmp_client.py` | — | ADDITIVE | LEDGER |
| `session_guard.py` (`caf67367b5`) | — | NOT EXERCISED | Unclassified by its owner; my reading: runs only after `create_session` on web sign-in |
| `earnings_session_resolver.py` (`0750bf14f7`) | — | EQUIVALENT | Unclassified by its owner; my reading: press releases move onto the shared `fmp_client` |

## 4. Release gates on the exact candidate (Windows, local)

These are the `master deploy gate` steps.

| Gate | Result |
|---|---|
| Secret scan (18 changed paths) | 0 findings |
| No shadowed definitions | 11 passed |
| VITE build args and ledger | 11 passed |
| Visibility flag ledger | 24 passed |
| Repo hygiene / line endings | clean (29,307 files) |
| Discord render goldens and ops | 42 passed |
| Production dependency smoke | PASS (project venv; A0 changes no requirements) |
| UCT Agent server tests | 493 passed |
| UCT Agent browser tests | 1,219 passed, 4 skipped |
| Feature-flag ledger | 392 passed |
| Promotion gate tests + self-check | 28 passed; 9/9 cases |
| Workflow expressions (17 files) | all documented |
| `ci_inventory` self-check | PASS |
| Flow-worker coverage (vs master; vs `af02539345`) | OK; 2 and 13 files ride the marker |

The full gate set ran on `15eeddaa48`. `f37a754a06` differs only in the marker text; the secret scan, hygiene and coverage were re-run on it and pass.

## 5. Security suite and regression vs the matching master (`8f2b324a65`)

| Suite | RC | Master | Verdict |
|---|---|---|---|
| Security, Python (28 files) | **1,356 passed, 0 failed** | 70 failed, 1,267 passed | 70 fixed, 0 new |
| Security, vitest (18 files) | 18/18 | 18/18 | unchanged |
| Wider regression (definitions, alerts, scans, screener, starters, phase E) | 29 failed, 2,229 passed | 29 failed, 2,197 passed | **identical 29**; +32 passes are A0's tests |

**The 29 failures shared with master:**

| Count | Test file |
|---|---|
| 5 | `test_definition_concierge` |
| 4 | `test_starter_library` |
| 3 | `test_phase_e_acceptance` |
| 16 | screener: filters 2, columndefs 1, analyst store 9, earnings dates 4 |
| 1 | `test_user_definitions_auth` (`PER_ROUTER`) |

## 6. The frontend CI completion check rejects incomplete runs: real data

The published `ci-results` records were replayed through master's `tools/ci_inventory.py` and the RC's. The runs chosen are the ones published as NO_NEW_FAILURES while vitest collected 0:

| Run | Published | Master's tool | RC's tool |
|---|---|---|---|
| 37491758202 | NO_NEW_FAILURES | NO_NEW_FAILURES | **INVALID** — "vitest collected 0 with no totals line — the frontend suite did not finish" |
| 37614383913 | NO_NEW_FAILURES | NEW_FAILURES | **INVALID** (same reason) |
| 37680294140 | NO_NEW_FAILURES | NEW_FAILURES | **INVALID** (same reason) |
| 38145431236 | NO_NEW_FAILURES | NO_NEW_FAILURES | **INVALID** (same reason) |

Across the last 110 published runs, 4 were green with vitest = 0, and 0 were green with vitest present.

The "NEW_FAILURES" re-derivations differ from the published verdicts because of the baseline the publish step chose at the time. The new INVALID does not depend on the baseline: the vitest check runs before any comparison.

## 7. No saved data is migrated or modified

The RC diff adds no `ALTER`, `UPDATE`, `INSERT`, `DELETE` or `CREATE`, and no preference or localStorage write. Its only database call is the detector's `SELECT`.

**One indirect effect:** the existing orphan sweep, whose writer is unchanged, will now set `instance_missing_at` on alerts whose chart instance was deleted (tombstoned). That is a disclosure column; firing, thresholds and state are untouched. The flag clears itself if the instance comes back.

## 8. Linux security CI: not yet run (needs your authorisation)

It cannot run without a push. `workflow_dispatch` needs the workflow file on the default branch, which it isn't yet.

**Safe procedure (no master push, no deploy, no promotion):**
1. Push the candidate as its own branch: `git push origin release/indicators-a0` from `C:/w/ia0rc`. This is not master.
   - Branch filters checked: `master deploy gate` runs only on master; `promote to production` runs only after that gate on master, or on its schedule from the tip of master. Railway deploys from `production`.
   - A branch push therefore cannot deploy or promote.
2. Open a **draft** PR `release/indicators-a0 → master`, marked "do not merge". That `pull_request` event runs:
   - `indicators security suite`, the Linux validation;
   - the report-only full suite, which publishes to `ci-results` as usual;
   - the normal path-filtered PR checks.
3. Read the results (`gh pr checks`, `gh run view`). The expected security-suite result is 0 failed.
4. Merging, pushing master and promotion each remain separate authorisations.

## 9. Deployment and rollback (after authorisation)

- **Deploy:**
  1. Fast-forward master to the candidate, rebased if master has moved; re-run coverage and the marker text.
  2. Run `tools/pre_push_guard.py` from a Railway-linked checkout at push time.
  3. Push after hours.
  4. Web, worker and bars-api rebuild for `api/**`. Flow-worker redeploys for marker #17, so do it outside RTH to avoid an OPRA tape gap.
  5. Promotion follows the normal gate.
- **Rollback:**
  - Revert the A0 commits. There is no data migration.
  - Alerts flagged `instance_missing` are cleared by the next sweep on old code.
  - Keep the marker line; a revert of code is itself a flow-worker-relevant change, so bump again when reverting.

## 10. Remaining risks

- **The Linux job has never run** (§8). Its container setup (the Node tarball) is unproven.
- **Coupled promotion.** Master carries 3 unpromoted commits from other owners (§1).
- **Two flow-worker classifications are mine,** not their owner's (`session_guard`, `earnings_session_resolver`).
- **The full-suite gate will now read INVALID** whenever vitest doesn't finish. That is intended, but it will look like new red.
- **N11 is still live:** screen alerts on semantics-2 formulas don't fire. A0 detects it; it is not fixed.

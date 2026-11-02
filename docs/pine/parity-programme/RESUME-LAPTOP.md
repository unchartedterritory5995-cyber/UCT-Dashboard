# Resume the Pine full-parity programme on another machine

Last updated: 2026-11-02 (round 1 in progress on the desktop). Update this file at every hand-off.

## 1. What is live (production `1cfb77fbc2`, all smoke PASS)
#613 de3f480f98 · #673 B d525ed6c6c · #674 A a223e7b745 · #675 engine bump 9a1f99ef49 ·
#676 C 3568af3722 (engine 3) · #679 D 1cfb77fbc2 (engine 4). SCRIPT_ENGINE_VERSION = 4.

## 2. Where the programme stands
- Plan + mockups: `PLAN.md` (this folder). Agent rules: `AGENT-RULES.md` (this folder; its absolute
  paths are the desktop's: substitute your own).
- Owner decisions so far: server-side interpreter = separate sandboxed service; strategies in scope.
- Workstream branches (all pushed to GitHub; `git fetch origin` to see them):

| stream | branch | FINAL state at hand-off (2026-11-02 ~12:30 CT, all agents stopped, lock free) |
|---|---|---|
| W0 measure | `docs/pine-coverage-2026-11-02` | DONE `89c7e8a7d5`: COVERAGE-MAP-2026-11-02.md + coverage-targets-2026-11-02.json (per-wall/per-wave script lists). Prod 211/679, runtime-on 250/679; harness rt 111/107/118. Not run: pre-commit pytest + hygiene, optional engine-door probe. Raw outputs only on desktop (`_w0-2026-11-02`); regenerate via doc s10 |
| W1 names | `feat/pine-w1-names` | FINAL `f33d776c76` (code b886fde2ca); pineW1Builtins+pinePhase1Builtins 77/77, mutations 13/14 (survivor equivalent); DELETE scratch `app/src/w1probe` before merge; ta.obv/pvt/wad, ta.iii/wvad, ta.cmo/ta.cog, v1-v4 barssince; rails pineW1Builtins.test.js; capture queue capture-queue-2026-11-02-w1.md. Next: re-run 27 targeted files (2 rail fixes), 14-mutation job, pytest gates + hygiene; then `second`, host timestamp() of constants, timeout cycles. ta.cmf is NOT a v6 name (correctly refused) |
| W2 arming packet | `feat/pine-w2-arming` | FINAL `585b303341`; job script docs/pine/evidence/w2-arming-2026-11-02/jobs.sh (set S, start at J4); packet NOT yet written; audit S1/S4/S6/S7/S8 met (S8 router mounted api/main.py:10366); runtime-on harness 111/107/118 vs prod 93/103/140, 0 MATCH regressions; new rail runtimeAllowlistParity.test.js not yet run; next: RF readiness census, vite build B4, worker probe B2/B5, write ARMING-PACKET (commands in commit msg) |
| W3 drawings | `feat/pine-w3-drawings` | FINAL `492185859e` (object-drop why-measurement landed); measure harness zzW3Why.measure.test.js committed, not yet run over the 195 drawing-walled scripts; no engine change yet. Next slice S1: cell:text on captured scripts (artemis-oscillator-pro, ema-ribbon, position-size-calc, vdubus) graded vs harness tableCells |
| Editor status panel | `feat/pine-editor-status` | FINAL `84e42c5e1f` (build 2d978b028d); NO new test has run yet (spec `bee9bcabb2`): panel built dark (VITE_PINE_EDITOR_STATUS + Dockerfile/ledger); 4 new test files NOT yet run; next: run + fix, flag-off byte-identical rail (pineBoxImportVerdict.test.jsx), mutations M1-M4, ledger pytest + hygiene |
| W5 server runtime | `docs/pine-w5-server-runtime` | design COMPLETE `b346688652` (SERVER-RUNTIME-DESIGN.md s0-10; 20 tasks T1-T20, first wave T1/T3/T5/T6/T12, critical path 3-4 weeks); not yet run: bare-Node closure check + pre-commit pytest/hygiene |
| E evidence engine | `feat/pine-evidence-engine` | FINAL `ec0882c16a`; 17/17 rails pass; owner capture: `python tools/vendor_harness/evidence_engine.py batch --top 20` then `promote --run-dir <run> --packet-sha <12 hex>`; evidence_engine.py (queue aggregator, manifest, fixture gate, packet, promote, ledger) + batch_capture.py provenance/throttle; tests/test_evidence_engine.py 17 rails (15/17 last run, fixes applied, re-run pending); next: 8 mutations, gate tests + hygiene. Pre-existing red: test_vendor_batch_capture manifest test |
| W4, W6-W9 | not started (see WAVE-TASKS.md) | - |

Detailed task list for every stream: `WAVE-TASKS.md` (this folder).

The coordinator updates this table at hand-off with each branch's tip SHA and what is left.

## 3. Set up the laptop
1. Clone UCT-Dashboard; create a worktrees folder, e.g. `~/uct-worktrees`.
2. One shared install: `git worktree add --detach ~/uct-worktrees/pine-base origin/master`, then
   `cd pine-base/app && npm ci`. Every other worktree junctions/symlinks `app/node_modules` to it.
3. Smoke worktree for deploy verification: `git worktree add --detach ~/uct-worktrees/_smoke-1031 origin/master`.
   `tools/hub_nav_smoke.py --auth` needs `SMOKE_EMAIL` / `SMOKE_PASSWORD` in the environment (never in the repo).
   Railway CLI must be logged in (`railway login`) and linked to the project for `verify_deploy.sh`.
4. Heavy-job lock: the desktop uses `uct-clips/tools/heavy_lock.py`. On the laptop either clone
   uct-clips too or point `HEAVY_LOCK` at a copy. Keep the rule: one heavy job at a time,
   vitest `--maxWorkers=2`, check free RAM first.
5. Portable script paths: `scripts/*.sh` read `UCT_WORKTREES`, `UCT_RESUME` (a scratch folder for
   run outputs) and `HEAVY_LOCK`; set them for the laptop. `measure-pair.sh` finds its audit
   instruments in `../audit` next to it (`audit/plotvar/` is the plot-column-hashing variant).
6. Coverage sample (needed for census runs; not committed by licensing ruling):
   `python tools/pine_coverage/fetch_sample.py --cache <dir>` (public, unauthenticated endpoints).
   The census also needs `--ref <pine_v6_reference.json>`: regenerate with
   `tools/pine_survey/pine_reference_extract.js` (see docs/pine/COVERAGE-MAP.md "How to re-run").
7. Claude memory: the memory folder is its own git repo (`uct-claude-memory`). Its latest commits
   live on branch `docs/notebook-incident-followup` (NOT master; master is 275+ commits behind).
   On the laptop: `git fetch origin && git checkout docs/notebook-incident-followup && git pull`
   in the Claude memory folder, so `project_indicator_ecosystem_resume_2026_10_31.md` carries over.

## 4. The ship loop (per branch / batch)
review (independent opus reviewer, GO) -> merge origin/master into the branch ->
`scripts/final-tip.sh <worktree> <label> [pytest rails]` under the lock (deploy-gate pytest,
hygiene, rails, full `src/components/chart` + `src/hooks` vitest) -> for engine changes
`scripts/measure-pair.sh` vs a base worktree at the same master (C18 audit, probes, census,
harness; 0 unintended diffs) -> bump SCRIPT_ENGINE_VERSION +1 if translator output changed ->
`gh pr create` + `gh pr merge --merge` (one master merge at a time; wait for any other session's
merge to promote) -> `scripts/verify_deploy.sh <merge-sha>` (expect `SMOKE PASS (authenticated)`).
Known pre-existing failures that are not ours: `pollingSites.rail`, the `converseClient.conversationId`
random-id flake, `definition_concierge` x5, `require_paid` sentence, `test_entitlements` NUMBERS.

## 5. Owner items open
- W2 decisions: (1) deadband/fibonacci/renko MATCH but R1's capability scan tags them
  conditional-ta (registry row marked divergent): reclassify? (2) kalman + parabolic-sar need
  capability rows (fn-*, for, if-block, typed-array, var) marked conformant on their own captures;
  (3) arming stages. Stage 1 proposal: PINE_RUNTIME_STAGE=admins with allowlist adx-and-di-for-v4.
- Copy-paste prompt for the laptop session: `LAPTOP-PROMPT.md` (this folder).
- W5 design questions (SERVER-RUNTIME-DESIGN.md): R3 verdicts on instruction budget, wall time
  only as safety stop (blocking); Q2 service size 2 vCPU/2 GB and 25 runtime docs per sweep;
  Q3 closed-bar-only alerts in v1; Q4 separate PINE_RUNTIME_SERVER_STAGE (recommended); Q5 caller
  ships bars (recommended); Q6 accept last-ulp diffs on Safari/Firefox; Q7 accept minutes of
  engine-mismatch withholding per bump; Q8 sweepable only once allowlisted.
- Read-only refused count after the bumps (pod read was blocked on the desktop):
  `SELECT engine,status,COUNT(1) FROM definition_engine_status GROUP BY engine,status` on `/data/user_definitions.db` (service web).
- Move the desktop page file D: -> C: (then two concurrent heavy jobs become safe).
- Runtime-lane arming decision (W2 packet), capture sessions on the dedicated Chrome rig (E),
  W7 data contracts.

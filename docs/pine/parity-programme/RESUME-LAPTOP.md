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

| stream | branch | state at last update |
|---|---|---|
| W0 measure | `docs/pine-coverage-2026-11-02` | running |
| W1 names | `feat/pine-w1-names` | running |
| W2 arming packet | `feat/pine-w2-arming` | running |
| W3 drawings | `feat/pine-w3-drawings` | running |
| Editor status panel | `feat/pine-editor-status` (flag `VITE_PINE_EDITOR_STATUS`, dark) | running |
| W5 server runtime design | `docs/pine-w5-server-runtime` | running |
| E evidence engine | `feat/pine-evidence-engine` | running |
| W4, W6-W9 | not started (W4 after W2 arming) | - |

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
7. Claude memory: the memory folder is its own git repo (`uct-claude-memory`); pull it on the
   laptop so the topic file `project_indicator_ecosystem_resume_2026_10_31.md` carries over.

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
- Read-only refused count after the bumps (pod read was blocked on the desktop):
  `SELECT engine,status,COUNT(1) FROM definition_engine_status GROUP BY engine,status` on `/data/user_definitions.db` (service web).
- Move the desktop page file D: -> C: (then two concurrent heavy jobs become safe).
- Runtime-lane arming decision (W2 packet), capture sessions on the dedicated Chrome rig (E),
  W7 data contracts.

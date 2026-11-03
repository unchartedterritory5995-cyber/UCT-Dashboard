# Resume the Pine full-parity programme on another machine

Last updated: 2026-11-02 ~18:00 CT on the LAPTOP (coordinator session af33efb6). Update this file at every hand-off.

## 1. What is live (production `e055b21e7f` at 2026-11-03 ~04:40 CT; SCRIPT_ENGINE_VERSION = 5)

#613 de3f480f98 · #673 B d525ed6c6c · #674 A a223e7b745 · #675 engine bump 9a1f99ef49 ·
#676 C 3568af3722 (engine 3) · #679 D 1cfb77fbc2 (engine 4) · #709 E ad571054dd ·
#710 W0 e6740b5b08 · #736 W1 0afa7645dd (engine 5) · #737 W5 T12 + design doc e055b21e7f.
Every merge since #709 was checked with scripts/verify_deploy_nologin.sh (VERIFY PASS each time).

## 2. Where the programme stands
- Plan + mockups: `PLAN.md` (this folder). Agent rules: `AGENT-RULES.md` (this folder; its absolute
  paths are the desktop's: substitute your own).
- Owner decisions so far: server-side interpreter = separate sandboxed service; strategies in scope.
- Workstream branches (all pushed to GitHub; `git fetch origin` to see them):

| stream | branch | state on the laptop (2026-11-03 ~04:45 CT) |
|---|---|---|
| E evidence engine | `feat/pine-evidence-engine` | MERGED #709 -> `ad571054dd` (web SKIPPED, no-login verify PASS). 5 low review findings queued as a follow-up. |
| W0 measure | `docs/pine-coverage-2026-11-02` | MERGED #710 -> `e6740b5b08` (VERIFY PASS). Two lows queued for the next W0 re-run (section 7.1 lane credit; capture count overstated by up to 11) plus the engine-door probe. |
| W1 names | `feat/pine-w1-names` | MERGED #736 -> `0afa7645dd`, SCRIPT_ENGINE_VERSION 5. measure-pair: production attached 394->402, runtime-on 477->486, 0 losses, 0 of 331 harness verdicts changed; mutations 6/6; final vitest 2 failed files (master's own). VERIFY PASS. |
| Editor status panel | `feat/pine-editor-status` | PARKED after round 3 NO-GO: the chart row ignores the meta.otherSymbols / lowerTf stamps. Flag stays dark. |
| W2 arming packet | `feat/pine-w2-arming` | Round-1 review NO-GO (P11 six-shard gate not run; S8 rails need linkify; packet INTERIM; re-pin to production after W1; B5 x4 miss). Round-2 fix in workflow wf_42d2affb-4e4. Coordinator accepts the B5 x4 miss for adx-only stage 1. Nothing is armed. |
| W3 drawings | `feat/pine-w3-drawings` | S1 `5f7da680d0` round-1 NO-GO (percent half-tie guess; measured on an old base; engine bump). Round-2 fix (Opus) in wf_42d2affb-4e4; the coordinator bumps the engine to 6 at merge. |
| W5 server runtime | `docs/pine-w5-server-runtime` | Design doc + T12 MERGED #737 -> `e055b21e7f` (server lanes admit only the graded allowlist; PINE_RUNTIME_SERVER_STAGE dark). T3 codec `43db4f59a8` review GO, closing its medium/lows in wf_42d2affb-4e4. Next: T1, T6. |
| Language coverage | `docs/pine-language-coverage` | `13257ce426` round-1 NO-GO (EXACT credited from uncompared outputs; DIVERGE corroboration; pine:timeout blame). Round-2 fix in wf_42d2affb-4e4. |
| W4, W6-W9 | not started (see WAVE-TASKS.md) | The W4 task breakdown (Fable) is queued after the first laptop wave. |

Detailed task list for every stream: `WAVE-TASKS.md` (this folder).

The coordinator updates this table at hand-off with each branch's tip SHA and what is left.

## 3. Set up the laptop

### 3.0 The laptop as set up on 2026-11-02 (profile `C:\Users\pgosz`)
- `source docs/pine/parity-programme/scripts/env-laptop.sh` (this branch) sets UCT_WORKTREES
  (`C:\Users\pgosz\uct-worktrees`), UCT_RESUME (`_resume-laptop`), HEAVY_LOCK
  (`C:\Users\pgosz\uct-tools\heavy_lock.py`, a copy of uct-clips' with the lock file at
  `C:\Users\pgosz\.claude\uct-heavy.lock`), UCT_PY (the venv `C:\Users\pgosz\uct-venv`, which has
  pytest + playwright), and defines `freeram`, `smoke_creds` and `hl <label> -- <cmd>`.
- Worktrees made by session af33efb6 carry `.uct-session-owner`: pine-base (shared npm install),
  _smoke-1031 (Railway-linked, production / web), pine-handoff, pine-w0, pine-w1, pine-editor,
  pine-e, pine-w2, pine-w3, pine-w5, pine-w5-t12, pine-lang. The 71 older worktrees are not ours.
- Licence-held inputs (never commit): `_resume-laptop/pine-sample` (679 scripts) and
  `_resume-laptop/runs/C/ref_rebuilt.json` (the v6 reference).
- Measured on the laptop: the full chart+hooks vitest takes 1.7 h; free RAM is 2-4 GB (another
  Claude session's study dev servers use about 1 GB), so heavy jobs stay strictly one at a time.
- Smoke: `SMOKE_EMAIL` is set. `SMOKE_PASSWORD` is being reset by the owner (2026-11-02) with
  `C:\Users\pgosz\uct-tools\reset-smoke-password.ps1` (hidden input; it calls the documented admin
  recovery `POST /api/auth/admin/reset-password` from the owner's own browser). After that the
  DESKTOP's saved SMOKE_PASSWORD is stale: update it there before any desktop smoke run.
- The laptop's first live check could not sign in (HTTP 401, wrong saved password) and measured
  nothing (0 nav entries clickable). Once the login works, confirm the smoke account still has its
  comped grant (`/dashboard` is paid-only); restore with the Admin page's Comp button
  (`POST /api/auth/admin/comp-access`).

### 3.1 Generic steps
1. Clone UCT-Dashboard; create a worktrees folder, e.g. `~/uct-worktrees`.
2. One shared install: `git worktree add --detach ~/uct-worktrees/pine-base origin/master`, then
   `cd pine-base/app && npm ci`. Every other worktree junctions/symlinks `app/node_modules` to it.
   A worktree WITHOUT that junction fails Python rails that shell out to node (`Cannot find module 'acorn'`,
   e.g. tests/test_refusal_reaches_every_surface.py): `cmd /c mklink /J <wt>\app\node_modules <pine-base>\app\node_modules`.
   The venv also needs `linkify-it-py` (requirements.txt) or any test importing api.main fails to collect;
   installed in uct-venv 2026-11-03 (2.2.0).
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
Laptop baseline, master `4d059b10ae` (E's merged tip, app/ identical): 3 failed files / 1320 passed /
27 skipped: `pollingSites.rail` (2), `vendorHarness.coverageAudit` (2: fibonacci-dolphintradebot SPY and
delta-rsi RDDT, `it.fails` rows that no longer fail) and `targetScriptReport.measure` (1).
A branch with no app/ change carries master's vitest result (`tools/gate_carry_over.py <gated> <landing>
<base>`); C4-PYTHON still runs on the landing tree.

## 5. Owner items open
- SMOKE: finish the password reset on the laptop (window "UCT smoke password reset"), then update
  the desktop's SMOKE_PASSWORD; confirm the smoke account's comped grant (Admin page, Comp).
- Capture machine (E): set `HEAVY_LOCK` and `UCT_PROVENANCE_SALT` (16+ characters) once, then
  `python tools/vendor_harness/evidence_engine.py batch --top 20` and
  `promote --run-dir <run> --packet-sha <12 hex>`. The 13 NEEDS_CHART rows want a chart named in
  their capture-queue doc.
- W7 data contracts (purchases) stay the owner's.
- Delegated to the coordinator on 2026-11-02 (full autonomy, recorded in AGENT-RULES.md): the W2
  decisions and staged arming (admins first), the W5 rulings (section 9.1 of
  SERVER-RUNTIME-DESIGN.md), agent count and models.
- Read-only refused count after the next engine bump:
  `SELECT engine,status,COUNT(1) FROM definition_engine_status GROUP BY engine,status` on `/data/user_definitions.db` (service web).
- Move the desktop page file D: -> C: (then two concurrent heavy jobs become safe there).

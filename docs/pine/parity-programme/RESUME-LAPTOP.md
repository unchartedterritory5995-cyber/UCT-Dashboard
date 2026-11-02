# Resume the Pine full-parity programme on another machine

Last updated: 2026-11-02 ~18:00 CT on the LAPTOP (coordinator session af33efb6). Update this file at every hand-off.

## 1. What is live (production `cfc35a3b3f` at 2026-11-02 ~17:40 CT; the Pine engine is still the one from `1cfb77fbc2`)
#613 de3f480f98 · #673 B d525ed6c6c · #674 A a223e7b745 · #675 engine bump 9a1f99ef49 ·
#676 C 3568af3722 (engine 3) · #679 D 1cfb77fbc2 (engine 4). SCRIPT_ENGINE_VERSION = 4.

## 2. Where the programme stands
- Plan + mockups: `PLAN.md` (this folder). Agent rules: `AGENT-RULES.md` (this folder; its absolute
  paths are the desktop's: substitute your own).
- Owner decisions so far: server-side interpreter = separate sandboxed service; strategies in scope.
- Workstream branches (all pushed to GitHub; `git fetch origin` to see them):

| stream | branch | state on the laptop (2026-11-02 ~18:00 CT) |
|---|---|---|
| E evidence engine | `feat/pine-evidence-engine` | READY TO MERGE. Merged tip `33e518f6ff` (master `4d059b10ae`). Review GO at `f924d174aa`. Rails 56 passed + the known pre-existing red manifest test; mutations 52/52 KILLED; gates 52; hygiene clean; full chart+hooks vitest on the merged tip 3 failed files / 1320 passed / 27 skipped, all master's (app/ byte-identical to master). PR body drafted. Waiting only on a working signed-in smoke (see section 5). 5 low review findings queued as a follow-up. |
| W0 measure | `docs/pine-coverage-2026-11-02` | Review GO at `b1f4247452` (status note final: engine-door list not measured). Fix round in progress for 2 medium + 3 low findings (section 10 wording; runtime-on capture targets filtered on the production verdict; tool determinism), then re-review. Docs/tools only. |
| W1 names | `feat/pine-w1-names` | `541909eb52`: round-1 fixes (obv/pvt/wad held from drawings, cog window decided by budget.js, bare-spelling arm change railed); 622/622 targeted, 9/9 mutations. Round-2 review NO-GO: HIGH `ta.iii` multiplies by volume where TradingView's published body divides; MEDIUM paints reading a window-dependent level get no history-depth badge; LOW dark runtime pane drawings not held. Round-2 fix in progress (also: every W1 formula re-verified against TradingView's published text, sources committed). Then measure-pair (prod + rt), final-tip, engine bump to 5, merge. |
| Editor status panel | `feat/pine-editor-status` | `31be0dd78e`: round-1 fixes done (Dockerfile ENV line, paneFor, block-run/period reads, held rule, families); 33/33 mutations; 71 rails. Round-2 review NO-GO: 2 HIGH (rows answered from the wrong lane), 2 MEDIUM, 4 LOW. Round-2 fix in progress. Flag stays dark. |
| W2 arming packet | `feat/pine-w2-arming` | `585b303341`, not yet resumed on the laptop. Next (Sonnet builder, Opus review): merge master, J1 allowlist-parity rail + mutations, python rails, J4 readiness census, J5 vite build (B4), worker probe B1/B2/B5, ARMING-PACKET-2026-11-02.md. Arming decisions are delegated to the coordinator (stage 1 admins first). |
| W3 drawings | `feat/pine-w3-drawings` | `492185859e`, not yet resumed. Next (Fable builder, Opus review): slice S1, the 22 table cells the text reader leaves unexplained (`textNodeOf`). |
| W5 server runtime | `docs/pine-w5-server-runtime` | `3f819db7e3`: design + the eight owner rulings (section 9.1). Wave 1 next: T12 admission + flags (worktree `pine-w5-t12`, branch `feat/pine-w5-t12-admission`), then T1, T3, T6. |
| Language coverage | `docs/pine-language-coverage` | NEW (worktree `pine-lang`, from master `cfc35a3b3f`): a scoreboard of every Pine v6 reference item that works exactly per lane, the owner's "any indicator" measure. Sonnet builder next. |
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

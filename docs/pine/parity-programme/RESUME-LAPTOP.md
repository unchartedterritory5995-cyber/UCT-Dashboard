# Resume the Pine full-parity programme on another machine

Last updated: 2026-11-03 ~16:45 CT by the LAPTOP coordinator (session af33efb6), at a hand-off forced by the account's weekly usage limit. The next coordinator starts from LAPTOP-PROMPT.md v5.

> **Two machines (2026-11-03):** the desktop is now a second build machine. Roles, the GitHub channel
> (`ops/pine-coord` written by the laptop, `ops/pine-desktop` by the desktop), setup and its lane list:
> `DESKTOP-PROMPT.md`. Builder rules for both machines: `BUILDER-RULES.md`. The laptop stays the only
> reviewer/merger/engine-bumper/deployer.

> **PAUSED 2026-11-03 ~17:00 CT by the owner.** Every laptop lane is pushed and stopped. The desktop
> was told to pause through ASSIGNMENTS.md (it sets each lane `PAUSED` with a `next:` line). To
> resume, the new coordinator:
> 1. Reads `git show origin/ops/pine-desktop:DESKTOP-STATUS.md` to see where each desktop lane stopped.
> 2. Replaces the PAUSE banner in ASSIGNMENTS.md with "RESUMED 2026-..": `PAUSED` lanes go back to
>    `QUEUED`, and the re-homed laptop lanes stay QUEUED for the desktop.
> 3. Asks the owner to re-paste the DESKTOP PROMPT line on the desktop.
> 4. Starts the merge queue below.

## 1. What is live (production `d8d4f0937d` at 2026-11-03 16:08 CT; SCRIPT_ENGINE_VERSION = 5)

#613 de3f480f98 · #673 B d525ed6c6c · #674 A a223e7b745 · #675 engine bump 9a1f99ef49 ·
#676 C 3568af3722 (engine 3) · #679 D 1cfb77fbc2 (engine 4) · #709 E ad571054dd ·
#710 W0 e6740b5b08 · #736 W1 0afa7645dd (engine 5) · #737 W5 T12 + design doc e055b21e7f ·
#749 W4 breakdown f014e73506 (docs).
Every merge since #709 was checked with scripts/verify_deploy_nologin.sh. #749 passed every check
except the log count: 8 new error lines, all `wisdom_same_night_scoring ReconcileRefused` from
another team's job, already seen in the morning baseline.

## 2. Where the programme stands

- Plan + mockups: `PLAN.md`. Agent rules: `AGENT-RULES.md`. Builder rules: `BUILDER-RULES.md`.
  Two-machine protocol: `DESKTOP-PROMPT.md`. The live channel is `ops/pine-coord`
  (ASSIGNMENTS.md, written by the coordinator) and `ops/pine-desktop` (DESKTOP-STATUS.md).
- Owner decisions: server-side interpreter = separate sandboxed service; strategies in scope; full
  autonomy (2026-11-02), arming in stages; W5 rulings in SERVER-RUNTIME-DESIGN.md section 9.1.

### Merge queue (next coordinator: land these in order, one at a time, outside the deploy freeze)

Landing rule:
- If master moved since the SHA below and that delta touches no engine path
  (`app/src/components/chart/engine`, Pine `api/services`), merge origin/master into the branch,
  re-run the short landing checks (deploy-gate pytest incl. the engine-version gate, hygiene, and
  the lane's own vitest files), then merge.
- If the delta does touch an engine path, re-run final-tip and measure-pair on a build machine.

| # | lane | branch @ tip | state | engine |
|---|---|---|---|---|
| 1 | Language scoreboard | `docs/pine-language-coverage` @ 397ecee294 | review GO (2 lows folded); short landing PASS on 1ae3bb9540 (gate 46, hygiene, 3 vitest files) | no bump |
| 2 | W4 T1 classifier honesty | `feat/pine-w4-t1-wall-report` @ f9b85fb442 | review GO; PR body at the end of this table; short landing PASS (gate 46, hygiene, 142 vitest files / 2021 tests) | no bump |
| 3 | W4 T4 conditional arms | `feat/pine-w4-t4-conditional-arms` @ 311fb46c7a (the old laptop worktree has an uncommitted regenerated capture-queue.json; do not commit it, regenerate with `evidence_engine.py queue` at merge) | review GO (mediums folded into docs/pine/evidence/2026-11-03-w4-t4/EVIDENCE.md); short landing PASS (gate 52 incl. version gate, hygiene, 144 files / 2062 tests) | **already bumped 5->6 on the branch** |
| 4 | W4 T3 text constants | `feat/pine-w4-t3-session-text` @ 572376edf6 | review GO with must-fix M1; M1 FIXED (2 guards, each mutation-proved; 10 new rails; delta rails 81/81, 88/88, 38/38; L1 done; EVIDENCE.md written). Pending: final-tip (exact command at the end of EVIDENCE.md) + delta Opus re-review | bump to 7 at merge (needs a 6->7 commit after T4 merges) |

W4 T1 PR text: "Refusal names only; nothing newly draws. No SCRIPT_ENGINE_VERSION bump. 22/22 rail
(6 fail on master). Mutations 11 killed, 1 equivalent survivor (null version). measure-pair:
runtime-on 0 attach/clean/stuck changes, 16 step-0 rows moved to request-with-state, harness
byte-identical. Camarilla's C18 diff is label-only; the spec now reads '0 C18 verdict diffs'."

### Stream table (2026-11-03 ~16:45 CT)

| stream | branch @ tip | state | exact next step |
|---|---|---|---|
| W2 arming packet | `feat/pine-w2-arming` @ 1a8dddb408 (WIP) | Round 2: J3a 110/107/119, J3b 93/103/140, adx MATCH on both captures; pytest rails 202 pass, deploy gate 82. P11 (25 failed files over 6 shards) is unclassified. | `docs/pine/evidence/w2-arming-2026-11-02/round2/WIP-STATE.md` and `round3-job.sh`: re-run the 25 files on branch vs master, merge master, re-run rails + J3; classify P11; edit the packet; delta Opus review. Stage 1 = admins, adx-and-di-for-v4 only (sha256 d0853c47...), PINE_RUNTIME_ALLOWLIST unset; the B5 x4 miss is accepted. Nothing is armed. |
| W3 drawings S1 | `feat/pine-w3-drawings` @ 7eaca7777f | Round 2 fix built; the commit records the merge bump as **8** (T4 6, T3 7) | Read its newest commit for the pending checks (measure-pair / final-tip), finish them on a build machine, then a delta Opus review. |
| W4 T0 / W0 census peel | `fix/pine-w0-census-peel` @ 75c4c400c2 (WIP) | Code done: statement-level peel (tools/pine_coverage/census_peel.mjs), probe via the drawing build, wall attribution, 7.1 credit fix. 11 vitest + 10 pytest rails green; mutations 6/6 JS, 8/8 Python. | Census/map re-run never ran (8 h in the lock queue). Run `docs/pine/evidence/2026-11-03-w0-peel/job.sh` (fix its env-laptop.sh path), write coverage-map.json, the targets JSON, COVERAGE-MAP-2026-11-03.md and the 7.1 corrigendum; then Opus review. No engine bump. |
| E evidence-engine lows | `fix/pine-evidence-engine-lows` @ e58edcbeaf | All 5 #709 lows closed in one commit (manifest stem, section chart rail, prose cells, headings, doc promises) | Its gate run never got the lock: run deploy-gate pytest + hygiene + its rails, Opus review, ship (offline tooling, no engine bump). |
| W5 T3 codec | `feat/pine-w5-t3-codec` @ cd61d6741d | Review round 2 fix pushed (byte layout matches design 2.3/3.2; JS and Python accept and refuse the same inputs) | Delta Opus review, final-tip on a build machine, merge. `columnDigest.js` is new and uncalled, so no engine bump. |
| W5 T1, T6, T2 / W4 T2, T7, T11, T12, T17+T13 | desktop lanes (see ASSIGNMENTS.md / DESKTOP-STATUS.md) | BUILDING on the desktop since 2026-11-03 ~15:00 CT | Review each when it is READY. |
| Editor status panel | `feat/pine-editor-status` @ a2f137dc67 | PARKED after round 3 NO-GO; flag dark | Unpark only after W2/W3. |
| Follow-ups F1/F2 | none yet | found by the W4 T3 review (in ASSIGNMENTS.md notes) | Assign as small desktop lanes. |

Detailed task list for every stream: `WAVE-TASKS.md`, W4: `docs/pine/W4-BREAKDOWN.md`, W5:
`docs/pine/SERVER-RUNTIME-DESIGN.md` section 7.

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
Laptop baseline is now 2 failed files (`targetScriptReport.measure`, `pollingSites.rail`; 2026-11-03,
W4 T1/T4 final-tips). Older note: master `4d059b10ae` (E's merged tip, app/ identical): 3 failed files / 1320 passed /
27 skipped: `pollingSites.rail` (2), `vendorHarness.coverageAudit` (2: fibonacci-dolphintradebot SPY and
delta-rsi RDDT, `it.fails` rows that no longer fail) and `targetScriptReport.measure` (1).
A branch with no app/ change carries master's vitest result (`tools/gate_carry_over.py <gated> <landing>
<base>`); C4-PYTHON still runs on the landing tree.

**Laptop half of the two-machine loop (DESKTOP-PROMPT.md sections 2 and 8):**
- Keep a background poll on `ops/pine-desktop`.
- On READY: set `REVIEWING @tip`, then run the Opus review.
- Write `ASSIGNMENTS.md` and `reviews/<lane>.md` to `ops/pine-coord` with
  `scripts/status-push.sh`. Every laptop state names the tip it judged (`@sha10`).
- Engine numbers are taken in merge order and recorded in ASSIGNMENTS.md.

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

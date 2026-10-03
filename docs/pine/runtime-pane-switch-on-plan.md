# Runtime pane — switch-on plan (RF, 2026-10-02)

The runtime pane is the member door's general fallback: a Pine script the host
(columnar) translator refuses is run bar by bar by the runtime lane, off the main
thread, and drawn when everything it would draw is exact
(`memberPaneDefinition.js::runtimeLaneDefinition`). It is dark behind three
switches, and **this document flips none of them** — the owner decides.

> ⭐ **GT (2026-10-02): the owner's rulings D1–D6 are implemented** on
> `pine/gt-runtime-switch-on` — a per-member stage (`PINE_RUNTIME_STAGE`), the
> starter allowlist, the 128 KiB runtime cap, and the repaint-label notice. The
> exact operator steps, in order, with rollback, are **[GT operator steps](#gt-operator-steps)**
> at the end of this file; the RF sections below are kept as the evidence they were.

| switch | where | kind | what it does | rollback |
|---|---|---|---|---|
| `VITE_PINE_RUNTIME_PANE_ENABLED` | build arg (`Dockerfile.web`), read by `engine/runtimePaneGate.js` | BUILD-TIME, default off | the member door offers refused scripts to the runtime lane; the install door admits `compute.kind: 'runtime'` documents | **a deploy**: rebuild with the flag unset |
| `PINE_RUNTIME_SAVE_ENABLED` | `web` env, `api/services/runtime_definitions.py` | per request, default off | the store accepts runtime documents (else refuses with its own sentence, which `MemberPane` renders) | unset the variable (verify a new boot) |
| `PINE_RUNTIME_KILL_LIST` | `web` env, same module | per request, empty | a listed script (definition id `u_`+12 hex, or the sha256 / a >=12-hex prefix of its source) is not drawn by the runtime lane and cannot be saved; nothing is deleted | edit the variable — **no deploy** |
| `PINE_RUNTIME_STAGE` (GT) | `web` env, same module | per request, **default `off`** | `off` / `admins` / `all`: who the pane is for. Rides the auth payload as `pine_runtime_pane_enabled`; the client needs BOTH it and the build flag; the save door asks the saving member the same question | set `off` — **no code deploy** |
| `PINE_RUNTIME_ALLOWLIST` + `api/data/pine_runtime_allowlist.json` (GT) | `web` env ∪ committed file | per request | while the stage is on, only a listed script (source sha256 / >=12-hex prefix) is drawn, saved or served; others decline `runtime:not-yet-graded`; empty = none. Holds adx-and-di-for-v4 only | remove the line / entry |

Evidence for every number below is in `docs/pine/evidence/rf-runtime-readiness-2026-10-02/`
and in the RF section of `docs/pine/vendor-harness/objects-triage-2026-09-28.md`.

## What switching it on adds, measured

Member-door census on the 266 committed corpus scripts (this tree, `666ea1c854` + RF):
objects-only off **55**, on (production today) **80**, runtime on **86**. The runtime pane
adds exactly **six** scripts (attached with it on, refused today); it loses none.

| script | plots | capture verdict (runtime on) | 5,000 daily bars in a real browser worker | notes |
|---|---|---|---|---|
| adx-and-di-for-v4 | 3 | **MATCH** (`adx-and-di-for-v4-rddt-1d-2026-09-27`) | 99–136 ms | the one script graded MATCH |
| inside-bar-range-mother-candle-… | 2 | **DIVERGE on paints only** (plots and objects MATCH) | 84–114 ms | its two `barcolor`s are not drawn by a runtime document (now disclosed) |
| delta-rsi-oscillator-strategy | 4 | no capture | 65–114 ms, stops `runtime:failed` (`array.sum over an na element`) on AAPL | draws nothing on that series, by name |
| fibonacci-dolphintradebot | 2 | no capture | 1,191–1,241 ms, stopped `runtime:time-budget` (807–890 ms and drawn in an earlier run) — **at the 1,000 ms budget** on this box | stops `runtime:time-budget` by name when it passes |
| trend-targets-algoalpha | 4 | no capture | 172–184 ms | document ~84 KB: **the store refuses it** (64 KiB cap) |
| wyckoff-accumulation-distribution | 5 | no capture | 195–271 ms, stops `runtime:failed` (`array.max of an empty array`) on AAPL | three rows withheld (per-bar colour); bar colour now disclosed |

Browser timings are the two runs of `evidence/.../browser-worker-probe.log` (headless Chromium, this box, six lanes running). The worker's main-thread cost: `postMessage` of the rows, 1–2 ms at 5,000 bars and
13–17 ms at 32,000. Worst frame gap on the main thread during any worker run: **17 ms**
(one frame), against a 400 ms deliberate block the same instrument saw as 383 ms
(`tools/runtime_pane_worker_probe.py`). Worker bundle: **1,303,711 B / 380,686 B gzip**
(standalone build with the app's prose stripping; the in-app chunk could not be measured,
see blockers), fetched only when a runtime pane computes.

## Preconditions

| # | precondition | status | evidence |
|---|---|---|---|
| P1 | The run never blocks the main thread | **MET** | browser probe: worst gap 17 ms vs control 383 ms; `evidence/.../browser-worker-probe.*` |
| P2 | Every stop of a run is named, never `engine:error` and never a freeze | **MET (RF)** | `runtime:time-budget`, `runtime:limit`, `runtime:failed`, `runtime:worker-unresponsive`, `runtime:worker-failed`, `runtime:load-failed`; `runtime/__tests__/runtimePaneSafety.test.jsx` |
| P3 | The member SEES why a runtime pane is empty | **MET (RF)** | the binder publishes the stop on the disclosure strip (was rendered nowhere before RF) |
| P4 | A worker that dies or hangs leaves the chart usable and never re-runs on the main thread | **MET (RF)** | watchdog 20 s, start cap 3 per tab, coalescing per pane |
| P5 | A runtime landing cannot loop its host (H14) | **MET** | bounded renders under the real `useServerColumns` + one run in flight per pane (`runtimePaneSafety`) |
| P6 | Save/load round trip with the save switch on | **MET for 6 of 6 (GT, D2)** | `tests/test_runtime_document_round_trip.py`; trend-targets saves under the 128 KiB runtime cap |
| P7 | Kill list reaches an open tab, deletes nothing | **MET (RF)** | `engine/__tests__/runtimeKillSwitch.test.js` + the pytest above; reach = the next read of `/api/user-definitions` (page load or the chart remounting), not mid-session |
| P8 | Everything a runtime document does not draw is disclosed | **MET (RF)** | bar colours (3 of 6 documents) were silently omitted since B1; now named |
| P9 | Every newly-attached script is graded on a TradingView capture | **MET BY CONSTRUCTION (GT, D6)** | only allowlisted scripts are served; the list holds the 1 MATCH (adx-and-di-for-v4); the other 5 decline `runtime:not-yet-graded` until CAP2 grades them |
| P10 | A staged (admins-first) rollout exists | **MET (GT, D1)** | `PINE_RUNTIME_STAGE` per member, per request; `tests/test_pine_runtime_switch_on.py`, `engine/__tests__/runtimeSwitchOn.test.js` |
| P11 | A full suite gate on the landing tree | **NOT MET here** | the shared `node_modules` lost jsdom's and the app's dependencies mid-session (see blockers) |

## Staged rollout

There is **no per-user gate on the runtime pane today**: `runtimePaneEnabled()` reads only
the build flag, so turning it on turns it on for every member at once.

The repo already has the server half of a staged rollout: `api/services/rollout_gate.py`
cohorts (membership in `user_tags`, written by `tools/rollout_cohort.py`; each cohort behind
its own kill switch; reported per request on the auth payload as `cohorts`). What is missing:

1. register a cohort, e.g. `pine-runtime-pane`, in `COHORT_KILL_SWITCHES` beside a new
   enablement flag (`PINE_RUNTIME_COHORT_ENABLED`, declared in `docs/feature_flags.json`);
2. `AuthContext` latches the `cohorts` list (today it keeps only `cohorts_withdrawn`) into a
   module the non-React gate can read, the way `runtimeKill.js` latches the kill list;
3. `runtimePaneGate.runtimePaneEnabled()` = build flag **and** (cohort member, or a later
   "all members" stage). Rails: a member outside the cohort reads the host refusal exactly as
   today; the cohort kill switch off empties it with no tag touched.

**Stage A — admins / smoke account only** (needs 1–3): build with the flag, tag the admins.
**Stage B — allowlisted scripts for all members** (ruling R-RT): only scripts graded MATCH on
a capture. ⚠️ R-RT names inside-bar-range and wyckoff; measured today only **adx-and-di-for-v4**
qualifies (inside-bar DIVERGEs on paints; wyckoff has no capture). A per-script ALLOW list does
not exist either (the kill list is its inverse); it would be the same mechanism with the
opposite polarity.
**Stage C — everyone**, widened as CAP2's captures grade the rest.

If the owner prefers no new code: the alternative is Stage C directly behind the kill list,
with the four ungraded scripts killed by hash on day one (`PINE_RUNTIME_KILL_LIST` takes the
`meta.runtimeSourceHash` values in `tests/fixtures/runtime_documents/documents.json`).

## The flip, in order (owner-run)

1. Land RF on the integration branch; run the full gate on a machine whose shared install is
   whole (P11).
2. Stage A code (above), or the owner's decision to skip it.
3. Build with `VITE_PINE_RUNTIME_PANE_ENABLED=1` (a deploy: "deploy wave N").
4. Optionally `PINE_RUNTIME_SAVE_ENABLED=1` on `web` (independent; verify a new boot and the
   value in-process, never from `--kv`). Without it the pane previews and the Save button
   answers with the store's sentence.
5. Update `docs/feature_flags.json` in the same docs push that records the flip time.

## The smoke after the deploy

```
python tools/hub_nav_smoke.py --auth                 # the app still navigates (H15 reads its exit)
python tools/runtime_pane_smoke.py --auth            # the runtime pane's own four checks
```

`tools/runtime_pane_smoke.py` (read-only, smoke account only): (1) the served bundle carries the
flag ON; (2) it ships a `runtimeWorker-*.js` chunk (bytes recorded); (3) in a signed-in page, the
real worker chunk runs the ADX document over the origin's own RDDT daily bars, inside the budget,
with finite columns, while the main thread keeps painting (frame-gap instrument with a 400 ms block
control); (4) the kill-list endpoint answers. Exit 0 PASS, 1 FAILED (roll back first — H15),
2 INCONCLUSIVE (never a rollback trigger). It has **not** been run against production (this lane's
brief forbids production); `--self-check` proves its helpers can fail.

## Rollback

| what | lever | cost |
|---|---|---|
| one script draws wrong or costs too much | add its hash or id to `PINE_RUNTIME_KILL_LIST` | no deploy; reaches each member on the next read of their definitions (P7) |
| the save door | unset `PINE_RUNTIME_SAVE_ENABLED` | no deploy; saved rows stay (served, and drawn while the pane is on) |
| the whole pane | rebuild without `VITE_PINE_RUNTIME_PANE_ENABLED` | **a deploy**; an open tab keeps its bundle until reload |

⛔ Nothing in any rollback deletes a member's saved definition.

## What to watch

- The disclosure strip sentences `not drawn on this chart (runtime:…)`: `time-budget` counts
  (fibonacci-dolphintradebot is at the edge on this box), `worker-unresponsive` /
  `worker-failed` / `load-failed` (should be ~0; any is a bundle or device problem).
- Intraday charts: every routed document (inside-bar, wyckoff) stops `runtime:limit` once a
  chart's backfill passes 20,000 bars (`limits.js` `HISTORY`); fallback documents are refused
  `runtime:history-start` on every intraday chart by design (R-W).
- `PINE_RUNTIME_KILL_LIST` length; save refusals by the 64 KiB cap.
- The H14 class: any report of a chart repainting continuously with a runtime pane open.

## Decisions for the owner

> ⭐ **RULED 2026-10-02 (owner), built by GT:** D1 admins first, then everyone, with the kill
> list as the safety net (`PINE_RUNTIME_STAGE`, per member, per request, default off); D2 the
> store's cap for RUNTIME documents is 128 KiB, formulas keep 64 KiB; D3 keep the 1,000 ms
> budget; D4 keep disclosing omitted bar colours; D5 keep the 20,000-bar intraday limit; D6 a
> starter allowlist holding only adx-and-di-for-v4, extended one line at a time as captures grade
> MATCH. D3/D4/D5 needed no code: GT moved none of those numbers. The questions as RF put them:

- **D1** Stage A cohort gate: build it (spec above) or go straight to an allowlisted Stage B/C.
- **D2** trend-targets-algoalpha's document (~84 KB) exceeds the store's 64 KiB cap: raise the
  cap for runtime documents, slim the document (it carries the host object program), or accept
  that it previews but cannot be saved.
- **D3** fibonacci-dolphintradebot runs 0.8–1.9 s on 5,000 daily bars here: keep the 1,000 ms
  budget (it stops by name on slower devices), raise it, or kill-list it until the lane is faster.
- **D4** bar colours on a runtime document: carry the host's paints (as RT4 ruled for objects,
  "drawings go with their run") so inside-bar can grade MATCH, or keep disclosing.
- **D5** intraday `HISTORY` 20,000: raise it, or run routed documents over the newest 20,000 bars.
- **D6** R-RT's starter allowlist is wrong on its own evidence (wyckoff has no capture): restate it.

## Blockers recorded by RF

- The shared `node_modules` (junction target in `.claude/worktrees/deploy-int`) lost
  `@asamuzakjp/css-color`, `@adobe/css-tools` and `@discord/embedded-app-sdk` during this
  session (all were present when RF's 22:27 run passed). jsdom tests and `vite build` cannot
  run until it is reinstalled — not done here (lane rule: never `npm ci` the shared install).

## GT operator steps

Owner rulings of 2026-10-02, as built on `pine/gt-runtime-switch-on` (section **GT** of
`docs/pine/vendor-harness/objects-triage-2026-09-28.md`, step 80). Nothing here has been run
against production by the lane; the integrator ships, and these steps are the owner's/operator's.

### What decides whether a member sees a runtime pane

```
pane draws through the runtime lane  =  VITE_PINE_RUNTIME_PANE_ENABLED baked '1'   (build)
                                      AND pine_runtime_pane_enabled for THIS member (auth payload,
                                          from PINE_RUNTIME_STAGE: off | admins | all, per request)
                                      AND the script's source sha256 on the starter allowlist
                                          (api/data/pine_runtime_allowlist.json + PINE_RUNTIME_ALLOWLIST)
                                      AND the script not on PINE_RUNTIME_KILL_LIST
saving a runtime document            =  PINE_RUNTIME_SAVE_ENABLED=1 AND the same stage check of the
                                          SAVING member AND not killed AND allowlisted AND <= 128 KiB
```

The client latches the per-member answer for the tab's life (first auth payload wins, like the
Notebook's flags): a change reaches a member on their **next authenticated request or reload**,
never a tab mid-session. Nothing latched = not permitted; nothing on the allowlist = nothing drawn.

### How a production build receives the `VITE_*` flag (confirmed, not assumed)

`web` builds from `Dockerfile.web` (`railway.web.json`). `Dockerfile.web` declares
`ARG VITE_PINE_RUNTIME_PANE_ENABLED` and passes it into the frontend build (lines 113 and 136 at
this commit), so a Railway **variable on `web`** becomes the build arg; an undeclared one is dropped
in silence. `tests/test_dockerfile_vite_build_args.py` + `tests/test_vite_flag_ledger.py` hold that
and run in the `master deploy gate` (`.github/workflows/master-deploy-gate.yml`). `web` deploys from
`production`, promoted after that gate. The flag is read as `=== '1'`.

### The flip, in order

| # | step | command / check | what proves it |
|---|---|---|---|
| 0 | GT (and RF) land on master; master deploy gate green; promoted to `production` | `git merge-base --is-ancestor <GT sha> origin/production` | ancestry, never a push log |
| 1 | **Deploy with the build flag ON and the stage OFF.** Set the stage explicitly so "off on purpose" is distinguishable from "unset" | `railway variables --service web --set "PINE_RUNTIME_STAGE=off"`, then `railway variables --service web --set "VITE_PINE_RUNTIME_PANE_ENABLED=1"` (a build variable: the rebuild is the deploy) | a NEW boot (`/api/health` `uptime_seconds` reset); never `--kv` alone |
| 2 | **Verify nothing changed for anyone** | `python tools/runtime_pane_smoke.py --auth --expect-pane off` → `[1] flag ON`, `[5] pine_runtime_pane_enabled=False`; `python tools/hub_nav_smoke.py --auth` | exit 0 from both (stage off = no member, not even admins) |
| 3 | **Stage admins** | `railway variables --service web --set "PINE_RUNTIME_STAGE=admins"`; read it IN-PROCESS (`railway ssh` → `/opt/venv/bin/python -c "import os;print(os.environ.get('PINE_RUNTIME_STAGE'))"`) | the running process has `admins` |
| 3b | (optional) the save door | `railway variables --service web --set "PINE_RUNTIME_SAVE_ENABLED=1"` | same in-process read |
| 4 | **Smoke as the admin smoke account** | `python tools/runtime_pane_smoke.py --auth --expect-pane on` and `python tools/hub_nav_smoke.py --auth` | exit 0: flag ON, worker chunk, ADX run finite inside the budget with the main thread painting, kill read OK, `[5] pine_runtime_pane_enabled=True` with the graded script listed |
| 5 | **Later: everyone** | `railway variables --service web --set "PINE_RUNTIME_STAGE=all"`, then step 4 again | exit 0 |
| 6 | Record each flip | `docs/feature_flags.json`: `PINE_RUNTIME_STAGE` / `VITE_PINE_RUNTIME_PANE_ENABLED` / `PINE_RUNTIME_SAVE_ENABLED` → `armed`, `where: ["web"]`, the flip time in the note, in the same docs push | the ledger, not memory |

⚠️ `railway variables --set` has been measured both to stage and to redeploy (CLAUDE.md); either
way, verify a new boot and the value in-process. A restart of `web` is an `/api/*` blip
(`docs/runbooks/deploy-windows.md`). Exit codes are H15's: **1 = roll back first**, 2 = inconclusive
(never a rollback trigger).

### Widening the allowlist (as CAP2 grades scripts MATCH)

One line, either place: add `{"slug", "sha256", "source", "evidence"}` to
`api/data/pine_runtime_allowlist.json` (a commit + deploy; the evidence names the capture), or
append the sha256 (or a >=12-hex prefix) to `PINE_RUNTIME_ALLOWLIST` on `web` (no code deploy). The
server reads the union per request. ⛔ Only a script graded **MATCH** against a TradingView capture.
⚠️ The identity is the sha256 of the source **as written**: a member's copy of a graded script that
differs by one byte (line endings, a trailing newline, a renamed input) is a different script and
declines `runtime:not-yet-graded`. How often a pasted copy matches the corpus bytes: **not measured**.

### Rollback

| what | lever | cost |
|---|---|---|
| everyone / the admins | `railway variables --service web --set "PINE_RUNTIME_STAGE=off"` | **no code deploy**; reaches each member on their next authenticated request or reload (an open tab keeps its latched answer until reload); the variable set itself may restart `web` |
| one script | add its sha256 / id to `PINE_RUNTIME_KILL_LIST`, or take it off the allowlist | no code deploy; reaches each member on the next read of their definitions / the member door's next kill read |
| the save door | `railway variable delete PINE_RUNTIME_SAVE_ENABLED --service web`, then `railway redeploy --service web --yes` (a delete does not restart) | saved rows stay; served (and drawn while the pane is on) |
| the whole pane | `railway variable delete VITE_PINE_RUNTIME_PANE_ENABLED --service web`, then `railway redeploy --service web --yes` | **a deploy** (rebuild); an open tab keeps its bundle until reload |

⛔ Nothing in any rollback deletes a member's saved definition.

### The repaint-label notice (RT4 follow-up)

A formula saved before `3a77b89423` that reads one of the nine last-bar clock leaves keeps its stored
`non-repainting`. The store now serves `repaint_notice` beside such a row
(`user_definition_relint.member_notice`, the relint pass's direction B), and the Builder shows the
sentence when its owner opens it. The stored label is never flipped; no variable controls this. How
many production rows carry it: **not measured** (the relint pass counts them when run against
production).

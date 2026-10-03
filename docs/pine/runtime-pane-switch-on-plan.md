# Runtime pane — switch-on plan (RF, 2026-10-02)

The runtime pane is the member door's general fallback: a Pine script the host
(columnar) translator refuses is run bar by bar by the runtime lane, off the main
thread, and drawn when everything it would draw is exact
(`memberPaneDefinition.js::runtimeLaneDefinition`). It is dark behind three
switches, and **this document flips none of them** — the owner decides.

| switch | where | kind | what it does | rollback |
|---|---|---|---|---|
| `VITE_PINE_RUNTIME_PANE_ENABLED` | build arg (`Dockerfile.web`), read by `engine/runtimePaneGate.js` | BUILD-TIME, default off | the member door offers refused scripts to the runtime lane; the install door admits `compute.kind: 'runtime'` documents | **a deploy**: rebuild with the flag unset |
| `PINE_RUNTIME_SAVE_ENABLED` | `web` env, `api/services/runtime_definitions.py` | per request, default off | the store accepts runtime documents (else refuses with its own sentence, which `MemberPane` renders) | unset the variable (verify a new boot) |
| `PINE_RUNTIME_KILL_LIST` | `web` env, same module | per request, empty | a listed script (definition id `u_`+12 hex, or the sha256 / a >=12-hex prefix of its source) is not drawn by the runtime lane and cannot be saved; nothing is deleted | edit the variable — **no deploy** |

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
| P6 | Save/load round trip with the save switch on | **MET for 5 of 6** | `tests/test_runtime_document_round_trip.py`; trend-targets refused by the size cap (D2) |
| P7 | Kill list reaches an open tab, deletes nothing | **MET (RF)** | `engine/__tests__/runtimeKillSwitch.test.js` + the pytest above; reach = the next read of `/api/user-definitions` (page load or the chart remounting), not mid-session |
| P8 | Everything a runtime document does not draw is disclosed | **MET (RF)** | bar colours (3 of 6 documents) were silently omitted since B1; now named |
| P9 | Every newly-attached script is graded on a TradingView capture | **NOT MET** | 1 MATCH, 1 paints-DIVERGE, 4 no capture (hand to CAP2) |
| P10 | A staged (admins-first) rollout exists | **NOT MET** | see Stage A below — needs a client cohort gate |
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

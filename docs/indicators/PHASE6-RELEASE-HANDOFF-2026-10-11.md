# UIE Phase 6 — release handoff: level lines never block an alert

Feature commit **`fe27af6ff0`** on `feat/uie-phase6` (worktree `C:\w\uie6`), from master `b4282b5d9d`; this
handoff is the only commit on top of it. Owner-accepted for release review 2026-10-11. **Not pushed, not
merged, not deployed.**

## 1. The failure (production, 2026-10-08 — OPEN-FINDINGS-2026-10 §1)

"Build me an RSI indicator with a moving average", then "Alert me when the RSI crosses above 70" was
refused at authoring time: *"Its sibling plot `levels` is refused by the alert lane (plot), and the lane
admits a definition whole…"*. The 70/30 `hlines` guide has no formula tree; the alert lane raised `plot` for
it, and `plot` refuses the WHOLE definition — so the RSI line and its MA could not alert either.

## 2. The corrected behaviour

| Request | Before | After |
|---|---|---|
| Alert on the RSI line (RSI + MA + 70/30 lines) | refused (`plot`, whole definition) | **arms** |
| Alert on the MA line of the same indicator | refused | **arms** |
| Alert on the 70/30 guide itself | refused (`plot`, engine language) | refused, gate **`presentation`**: "These are level lines — a guide drawn at fixed values… Alert on the indicator's own line instead (for example, RSI crossing above 70)." |
| A single-tree indicator's guide | armed on the FORMULA's own number under the guide's name | refused (`presentation`) |
| A data plot with no tree | refused whole (`plot`) | unchanged |
| Chart drawing of the guide | drawn | unchanged |

Already-armed alerts are unaffected: before this change no alert could be armed on such a definition, and
none of the gates an existing alert passed is altered.

## 3. Files changed (`git diff b4282b5d9d fe27af6ff0`)

- `api/services/alert_user_series.py` — gate `presentation` (`GATES`, `REFUSAL_FRAGMENTS`), raised in
  `_make_value_fn` before any tree lookup for an `hlines` plot; `PER_PLOT_GATES` gains it (the ONE deleted
  `api/` line is that constant, rewritten).
- `app/src/components/chart/engine/evaluability.js` — the browser preflight mirror (`alertPlotGate`,
  `ALERT_PER_PLOT_GATES`, the member sentence).
- Tests: `tests/test_alert_level_lines_p6.py` (new), `app/src/components/chart/engine/evaluability.levelLines.test.js`
  (new), `tests/fixtures/ast/p1_evaluability_alert.json` (+4 cases), `tests/test_alert_user_admission.py`
  (gate-totality driver), `tests/test_p2_truth_policy.py` (`PER_PLOT_GATES` pin).
- Docs: `docs/indicators/PHASE6-ENGINE-LEDGER-2026-10-11.md`, `AGENT-ENGINE-HANDOFF-2026-10-11.md`,
  `OPEN-FINDINGS-2026-10.md` (§1 marked).

## 4. Browser ⇄ server parity

`tests/fixtures/ast/p1_evaluability_alert.json` is the shared case table: the server (`test_p1_truth_core.py`,
`test_p1_truth_signal.py`, `test_p2_truth_policy.py`) and the browser (`__truth__/p1.core.truth.test.js`,
`p1.signal`, `p2.policy`) run the SAME 25 cases. Both pass; reverting either lane's change fails its half
(server: 9 failures; browser: 4).

## 5. Regression vs. clean master

| Suite | Branch | Clean master (same run) | New failures |
|---|---|---|---|
| Python: alert*, p0–p2 truth, user_definition*, definition_*, ast_*, scan_*, indicator_alert*, runtime_definitions, uct_agent* (170 files) | 15 failed / 4,634 passed | 16 failed | **0** (every branch failure also fails on master; the 4 `test_alert_outbound` failures are order-dependent — 29/29 pass alone) |
| Frontend: `src/components/chart` + `src/agent` (20,442 tests) | 14 files red in the full run; **5** when re-run alone | **6** of the same 14 files re-run alone | **0** (the 5 are a subset of master's 6) |
| Alert-lane focus (6 Python files) | 212 passed | — | — |
| Engine truth (browser) | 674 passed | — | — |
| Repo hygiene | clean | — | — |

## 6. Production flags (unchanged by this release; read 2026-10-11)

ON: `VITE_PINE_MEMBER_PANE_ENABLED`, `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`, `VITE_INDICATOR_TEMPLATES_ENABLED`,
`INDICATOR_VISION_ENABLED`. **OFF (keep off):** `VITE_PINE_RUNTIME_PANE_ENABLED` (+ `PINE_RUNTIME_STAGE`
unset), `VITE_PINE_LOWER_TF_ENABLED`. This release adds no flag and reads none.

## 7. Deployment requirements (procedure verified; NOT performed)

Per `docs/runbooks/deploy-windows.md` and `tools/flow_worker_watch_coverage.py`:

- **Which services change.** `api/**` ⇒ `web`, `worker`, `bars-api` rebuild from `master`/`production`
  as usual. The fix is EXECUTED only by **web**: alert arming (`indicator_alert_service.create` →
  `arm_for_alert`, behind `api/routers/indicator_alerts.py`) and the user-alert evaluator
  (`indicator_alert_evaluator.start_evaluator`, started in `api/main.py`). `worker_main.py` does not start
  the evaluator.
- **flow-worker — a stranded file, classified.** The rail exits 1: flow-worker REACHES
  `alert_user_series.py` (`flow_worker_main → flow_gap_autofill → alert_destination → alert_routing →
  alerts → alert_taxonomy.document_arrival → delivery → watchlist_alert_service →
  indicator_alert_service → alert_user_series`) and does not watch it. It never CALLS the changed
  functions (`_make_value_fn`, `plot_admissions`, `arm_for_alert`, run only by arming and evaluation on
  web), and the one deleted `api/` line is the rewritten `PER_PLOT_GATES` constant ⇒ **ADDITIVE, safe**:
  record it in the push ledger as *"flow-worker stranded: ADDITIVE, safe; discharge by marker bump"*.
- **Ordering.** No ordering dependency: web alone delivers the fix; a stale flow-worker copy never runs
  the changed path. Do NOT redeploy flow-worker with `railway redeploy` (it rebuilds the old image).
- **Marker bump.** Append one dated line to `api/flow_worker_deploy_marker.txt` in the release commit —
  **only in a weekend/after-hours window** (it restarts flow-worker: an OPRA tape gap). If the release
  lands during market hours, merge without the marker (ADDITIVE allows it) and bump at the next window.
  Confirm by ARTIFACT: flow-worker's running commit advances to master's tip.
- **Gates.** `tools/pre_push_guard.py` (web SUCCESS and settled, no burst) before the push; promotion to
  `production` waits on the gating workflows incl. `master deploy gate` and `UCT Agent guard`.

## 8. Recommended follow-up milestone (recorded, not started)

Check every saved-indicator shape — the Batch 1–2 authoring outputs, the Pine/thinkScript/PCF import
corpora, member definitions by shape — through the alert-lane preflight, and list each output that is
still refused **together with its valid siblings** (the class Phase 6 fixed for `hlines`). Fix only those
with evidence, per plot, in both lanes and the shared fixture.

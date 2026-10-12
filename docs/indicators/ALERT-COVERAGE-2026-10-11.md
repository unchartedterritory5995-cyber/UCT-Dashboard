# Alert compatibility & saved-indicator coverage (2026-10-11)

Branch `feat/uie-alert-coverage` (worktree `C:\w\uie7`), from master `8179ab21be`. The follow-up recorded by
UIE Phase 6: does an unsupported or non-alertable part of a saved indicator still stop a VALID plot from
carrying an alert? **Not pushed, not merged, not deployed.**

## Method — both lanes, the same documents, the real doors

1. **Browser half** — `app/src/components/chart/engine/__tests__/alertCoverage.measure.test.js`
   (opt-in `UIE_ALERT_COVERAGE=1`, `UIE_ALERT_COVERAGE_OUT=<file>`). Collects every saved-indicator shape
   the repository holds and runs the alert preflight (`evaluability`, lane alert) per plot:
   every committed fixture holding a formula document (Batch 1–2 authoring outputs, pane documents,
   graph-wire documents — hydrated, as `useUserDefinitions` hydrates them), the Pine corpus through the
   member door (`memberPaneDefinition`), every thinkScript fixture output, and every accepted TC2000 PCF
   corpus formula (each as the single-tree document the import saves, `fn: astHash`). It also records
   the form the save hook POSTS (`reduceIfOversized` — an oversized document as its shared graph).
2. **Server half** — `tests/test_alert_coverage_audit.py` (opt-in `UIE_ALERT_COVERAGE_IN`). Saves each
   POSTed form through the MEMBER'S door (`user_definitions.save`, with the save-time acknowledgement a
   member gives — so a `repaints` plot is never stored and only shapes that can exist in production are
   measured), admits it once on the real 579-bar parity tape (every gate, in order) and derives each
   plot's verdict as `arm_for_alert` does. It then compares with the browser and **asserts the
   invariant**: no admitted plot's OWN tree carries a requirement the alert lane refuses, nor an
   unclean verdict nobody acknowledged.

## Coverage matrix (same 167 shapes, same 597 plots; master code vs. this branch)

| Source | Shapes | Multi-plot | Not saveable* | Plots | Alertable on master | Alertable now |
|---|---|---|---|---|---|---|
| Committed fixtures | 22 | 15 | 4 | 55 | 32 | **44** |
| Pine corpus (member door) | 61 | 59 | 10 | 458 | 303 | **409** |
| thinkScript fixtures | 34 | 0 | 0 | 34 | 34 | 34 |
| TC2000 PCF corpus | 50 | 0 | 0 | 50 | 50 | 50 |
| **Total** | **167** | **74** | **14** | **597** | **419** | **537** |

**+118 alertable plots, 0 lost**; invariant: 0 violations. *Not saveable through the member's door, each
refused BY NAME at save (not an alert matter): a plot measures `repaints` (5 — 4 fixtures, 1 Pine), a plot
over the 2,048-node per-plot expansion ceiling (3 Pine), over the series-reference budget (2 Pine), over
the lookback budget (2 Pine), over the 64 KB store cap (1 Pine), `resolve:window` (1 Pine).

## Confirmed defects (both the Phase 6 class — a valid plot refused for a SIBLING)

**D1 · `requirements` was whole-definition.** `requirements` is stamped per DEFINITION
(`requirement_tags` walks the whole document), and the alert lane refused every plot when any tag was
refused — but the reason behind a tag is per tree.
- `mcclellan-indicators`: 2 of 16 plots call `cum` (window_dependent) → 14 plain plots refused. Now 12
  arm; the other 4 are refused for their own reasons (other-symbol reads; window dependence).
- `artemis-oscillator-pro`, `average-day-range-adr-pivots`, `extrapolated-pivot-connector`,
  `liquidity-pools`, `price-action-…-trendline`, `trend-duration-forecast`,
  `tradingview-alerts-to-mt4-mt5-…`: no plot tree carries the tag — it comes from `objects.trees`, the
  script's DRAWINGS (never an alert value) — so every plot was refused although none computes the call.
- `trendlines` (4 of 8 plots) and `pa-zigzag-fibonacci-fan` (1 of 9): the tag is in SOME plot trees;
  only the untagged plots gained.
- `ema-ribbon-trend-filter`: the tag comes from `meta.runtimeErrors.stops` (metadata; see finding F2).

**D2 · `repaint` was whole-definition.** The verdict is stored per plot; the gate refused the whole
definition on the first unclean one — and the alert-arm acknowledgement (`meta.repaintAck`) has no
surface that writes it (`user_definition_relint`).
- `cpr-with-mas-super-trend-vwap`: saves (14 `preview-repaints` plots acknowledged at save), then none of
  its 53 plots could alert. Now 39 arm; the 14 are refused for themselves.

## Fixes (server: `api/services/alert_user_series.py` only)

- `_requirement_refusals` / `_repaint_refusals`: each asks the existing gate first (`_gate_requirements`,
  `_gate_repaint` — still the stored-answer authority and the seam the tests stub); only when it refuses
  is the refusal attributed to the data plots whose OWN tree (or stored verdict) carries it. The whole
  definition is refused, with the unchanged sentence, when no data plot is clean — and, for requirements,
  when the stored stamp does not reproduce from the stored document (the safe direction).
- Applied at all three readers: admission (`admit_user_definition` → withheld per plot, never
  registered), the single-address value door (`user_value_function`), and the alert catalog
  (`user_catalog` — clean plots offered, refused ones not).
- **Browser unchanged.** The preflight already defers repaint, requirements, budget and the two-lane proof
  to the server (`final: false`); the fix moves the server TOWARD it. Parity on the 597 plots: 552 agree;
  the 45 that differ are all `requirements` (26), `repaint` (15) or `cross-lane` (4) — the server-only
  gates, refused per plot where attributable. The shared fixture `p1_evaluability_alert.json` (lane +
  `plot_admissions`) is untouched and passes.

## Remaining unsupported shapes (not changed — by design or not demonstrated)

| Shape | Why it stays refused |
|---|---|
| Every plot carries the tag (`atr-trailing-stoploss`, both `support-and-resistance`) | whole refusal is correct |
| `hlines` guides | `presentation`, per plot (Phase 6) |
| Other-symbol reads that cannot be served (ambiguous, fan-out), lower-timeframe reads, current-only scalars | `withheld` / `scalar`, per plot |
| A single-plot `preview-repaints` document | no surface records the alert-arm acknowledgement (F1) |
| Runtime (per-bar Pine) documents | `lane`, by design (runtime stays dark) |

## Findings recorded, not fixed

- **F1 — the alert-arm acknowledgement has no surface.** `meta.repaintAck` is read by the alert gate and
  written by nothing (already noted in `user_definition_relint`); a `preview-repaints` plot can never arm.
  A product decision (a checkbox on the alert dialog) — owner.
- **F2 — `requirement_tags` walks metadata.** `ema-ribbon-trend-filter` is stamped `window_dependent`
  from `meta.runtimeErrors.stops`, which nothing executes. The alert lane is now immune (it attributes per
  plot), but the same stamp still refuses the screener, sweep, share and listing consumers. The stamp is
  shared by five consumers — owner decision before narrowing it.
- **F3 — the two-lane proof covers only the scan plot.** `_gate_cross_lane` (and `_gate_budget`) run on
  `compute.ast`: a non-scan plot is armed on its sibling's proof, and an uncomputable scan plot refuses
  every sibling (seen once, on the legacy `saved-document-volume-v2-pre-c46` fixture — the JS lane's
  `TableRefusal` reported as "could not be compared"). A per-plot proof is one subprocess per plot —
  a performance and scope decision, not taken here.
- **F4 — a whole indicator is unsaveable for one `repaints` plot.** The save door refuses the document
  (e.g. `btc-charlie-trader-xo` with 3 of 14 plots `repaints`). Save-lane policy, outside alerts.

## Release requirements (verified; nothing performed)

- **One production file changes:** `api/services/alert_user_series.py`, executed only by **web** (alert arming,
  the user-alert evaluator, the alert catalog, the current-value prefill). No browser source changes; no flag.
- **flow-worker:** reaches the file only through alert-delivery imports (traced for Phase 6:
  `flow_gap_autofill → … → indicator_alert_service → alert_user_series`) and never calls the changed
  functions (`admit_user_definition`, `user_value_function`, `user_catalog`). The 6 deleted `api/` lines
  are those functions' gate calls, rewritten. ⇒ *"flow-worker stranded: ADDITIVE, safe; discharge by
  marker bump"* — marker bump only in a weekend/after-hours window; no ordering dependency.
- **Behaviour change in production:** strictly MORE plots alertable (+118 on the measured shapes, 0 lost);
  every refusal that remains keeps its gate and sentence. Already-armed alerts are unaffected (nothing that
  passed before is refused now).
- **Regression vs. clean master:** Python 3,317 passed / 15 failed, every failure a known master baseline
  (`test_alert_outbound` ×4 order-dependent, `test_alert_channel_registry`, the taxonomy schema test,
  `test_c45_withheld_doors` ×2 and `test_requirements_pins` — both failing identically on master code —,
  `test_definition_concierge` ×5, `test_user_definitions_auth`); browser truth + Agent suites 1,579 passed.

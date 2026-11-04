# Moving-average crossover alerts (`ma_cross`) — design note

Status: built on `feat/alerts-ma-cross` (from `origin/master` 3d3d444d4f), DRAFT PR, not deployed.
Owner approval for development: 2026-11-04. No flags, no paid calls, no production change.

## 1. The existing indicator-alert system (as mapped on master)

| Concern | Where | Notes |
|---|---|---|
| Catalog | `api/services/indicator_alert_evaluator.py::alert_catalog(user_id)` | Built from `all_addresses()` = the address partitions (`INDICATOR_FUNCS`, `EVENT_FUNCS`, `PRICE_FUNCS`), grouped by `plot_base`. Each plot carries `conditions` (`ALERT_CONDITIONS`), `default_threshold`, `inputs` (read off the series function's `fn.inputs`) and `instance_label`. User formulas are appended by `alert_user_series.user_catalog`. |
| Catalog served | `GET /api/indicator-alerts/catalog` (`api/routers/indicator_alerts.py::get_alert_catalog`) | Auth-gated (`get_current_user`); returns `{catalog, refusals}`. |
| Series math | `api/services/alert_series.py::SERIES_FUNCS` | One table: address → aligned column. Every column comes from `indicator_compute` (`compute_sma` is an adapter onto `ast_interpret.FN["sma"]`; `compute_ema` is seeded by the SMA of the first `period` values — the same seeding as the chart's `emaOfSeries`). `price_vs_ma` already reads them. |
| Storage | `indicator_alerts` table in `AUTH_DB_PATH` (`indicator_alert_service._SCHEMA` + additive `_MIGRATIONS`) | `indicator` = plot address, `condition`, `threshold`, `tf`, `params_json` (the instance snapshot the evaluator reads), `instance_id`, `scope`, `state`, `arm_epoch`, `last_fire_key`. Fires live in `alert_fired_log` with `UNIQUE(alert_id, fire_key)`. |
| Evaluation | `indicator_alert_evaluator._run_one_cycle`, a daemon thread started from the `api/main.py` lifespan (`start_evaluator(interval_sec=60)`) — the **web** service, not flow-worker. | Groups active alerts by (sym, tf) and reads bars from `bars_sqlite` (no remote calls). Lane = `eval_mode()` → committed `"closed"`: `_evaluate_one_closed` judges `closed_bar_index(...)` (the newest bar whose close time has passed) with `prev = series[i-1]`. The forming lane is a rollback lever only (`ALERT_EVAL_MODE` env). |
| Conditions | `alert_conditions.check_condition` (pure, frozen by two oracles) + `THRESHOLD_OPERAND` (declared right-hand sides per (address, condition)) | `cross_above`: `prev <= thr < cur`; `cross_below`: `prev >= thr > cur`. |
| Dedup / fire-once | `ias.record_trigger` → `alert_fired_log.fire_key`: cross conditions key on the **bar** (`bar:<t>`), level conditions on the armed episode (`ep:<n>`). | One fire per bar per alert, enforced by a DB constraint. |
| Re-arm | `ias.record_evaluation`: a `fired` alert re-arms (`arm_epoch+1`) on the first evaluation where the condition is false. Snooze windows are honoured by the clock. | |
| Notify | `_dispatch_delivery` → `watchlist_alert_service.deliver_alert_payload` (bell + email + Discord per the member's own settings), with a lease through `claim_delivery`/`release_delivery`. A Signature-ledger receipt goes through `admit_alert_fire` (closed lane only). | |
| Create path | `POST /api/indicator-alerts`: price-alias redirect → unknown-address 400 → `alert_trigger_policy.admit_request` → `ias.refusal_for` (unjudgeable rule / intraday-only / closed-lane-dead / missing level) → `ias.create` (cap `MAX_ALERTS_PER_USER`, `BEGIN IMMEDIATE`). | |
| Chart UI | `app/src/components/chart/IndicatorAlertPopover.jsx` via `hooks/useIndicatorAlerts.js` | Renders only what the served catalog offers. Knobs come from the plot's `inputs`; `instance_id` comes from `alertSets.instancesForAddress` (address base ↔ chart `defId`). |
| Agent | `app/src/agent/capabilities/indicatorAlerts.js` — `indicatorAlert.create` / `.toggle` (pause/resume) / `.delete` | `create` takes `{instance, plot, condition, threshold}`. It matches the instance's `defId` to catalog plots (`instancesForAddress`), builds the popover's payload (`toCreate`): `{sym, indicator: plot, condition, tf, params (instance inputs for the plot's declared knobs), instance_id, threshold?}`, and posts it through the hook. |

Before this change the catalog had `rsi, macd(+signal/histogram), bb(+bands), stoch(+d), williams_r, cci, mfi, price_vs_ma, vwap, atr, adx.*, obv, donchian.*, ichimoku.*, sar.* events, close`: 31 addresses and no MA cross. The chart's moving averages (`movingAverage` instances, adopted from `cs.overlays`: EMA 9, EMA 20, SMA 50, SMA 200) had **no alert address**, so the Agent answered "Alerts aren't available for EMA 9" (the PR #758 note).

## 2. Design

### Address and partition
* A new address, **`ma_cross`**, in a fourth GLOBAL partition `CROSS_FUNCS` (`CROSS_ADDRESSES = ("ma_cross",)`), appended to `ADDRESS_PARTITIONS` after `PRICE_FUNCS`.
* ⛔ It is deliberately **not** in `INDICATOR_FUNCS`. The frozen replay grid (`tools/alert_replay.py`, 691,195 recorded fires) and the 5,040-row baseline are generated from `INDICATOR_FUNCS` in order. This is the same argument the `sar` events and `close` used. `THRESHOLD_ADDRESSES` is unchanged.
* Catalog position: appended last (new group `ma_cross`, label "MA Cross"), so every existing dropdown opens where it did.

### Series (no second MA formula)
`alert_series._series_ma_cross(bars, params)` = `fast_MA − slow_MA`, aligned to `len(bars)`, `None` wherever either MA is undefined. Both MAs are `indicator_compute.compute_ema` / `compute_sma`, the same functions `price_vs_ma` uses.
`fn.inputs = {"ma_type": "ema", "fast": 9, "slow": 20}` feeds the catalog's `inputs` and the popover's knobs. The window is DECLARED by the column (`fn.lookback`): an EMA gets a convergence prefix of 6×slow (seed weight ≈ e^-12), an SMA gets `slow`; `bars_needed_for_alert` reads it (`bars_wanted`: +400 floor, cap 5000), and the column is computed over exactly that many newest bars, so the cross lands on the full-history (chart) bar and never depends on a neighbour alert's wider fetch (review round 1). Stored params are normalised (`fn.normalize`: int periods, lowercased vocabularies). Invalid params produce an all-`None` column: a silent no-fire that the existing `needs_attention` diagnosis reports. They are also refused at create (below).

### Conditions — no change to `check_condition`
`ALERT_CONDITIONS["ma_cross"]` = `cross_above` ("Fast MA crosses above slow MA") and `cross_below` ("Fast MA crosses below slow MA"), both `needs_threshold: False`, with declared operands
`THRESHOLD_OPERAND[("ma_cross", "cross_above" | "cross_below")] = {"kind": "const", "value": 0.0}`.
So "fast crosses above slow" is exactly `check_condition("cross_above", spread[i], spread[i-1], 0.0)`, i.e. `spread[i-1] <= 0 < spread[i]`. It rides the existing grammar, and the two oracles are untouched.

### Params contract (`params_json`)
`{ma_type: "ema" | "sma", fast: int, slow: int, direction?: "above" | "below", confirm?: "close"}`
* `fast`, `slow`: integers 1..500 (the chart's MA period bound), with `fast < slow`. Otherwise the create returns **400**.
* `direction` is optional and must agree with `condition` (`above` ↔ `cross_above`). The condition is the stored truth (dedup keys on it); `direction` is recorded for readers.
* `confirm` is optional; only `"close"` is accepted, so evaluation is completed-candle only.
* Any other condition on `ma_cross` (e.g. `above` with a typed level) is refused: only the two offered rules are accepted.
* The validation is declared on the series function (`fn.validate`) and read by `indicator_alert_evaluator.params_refusal(address, condition, params)`, which the router calls after `refusal_for`.

### Closed bars only, even under the rollback lever
`ma_cross` is in `CLOSED_ONLY_ADDRESSES`. `_evaluate_for_cycle` and `_evaluate_one` route it to `_evaluate_one_closed` whatever `eval_mode()` says, so pulling `ALERT_EVAL_MODE=forming` never makes an MA-cross alert fire intrabar. Every other address keeps following the mode, unchanged. Ledger receipts keep their own gate (`admit_alert_fire` still refuses under a forming override).

### Dedup / re-arm / notification — inherited, not re-implemented
* The fire key is `bar:<t>` (a cross condition), so there is one trigger per cross bar per alert (DB unique).
* Re-arm happens on the first closed bar where the condition is false. The bar after a strict cross is always false, so the next cross in the same direction fires again.
* Snooze, the delivery lease, channels and the member's notification settings all use the existing pipeline. The notification label comes from `instance_label` through a `fn.describe(params)` hook (`"EMA(9) vs EMA(20)"`). The value is the spread (price units, 2 dp).

### Persistence
**No schema change.** `ma_cross` is a new value of the existing `indicator TEXT` column, and its knobs ride the existing `params_json`. There is nothing to migrate.

### Permissions / entitlements
Unchanged: the same router, the same `get_current_user`, the same per-member cap (`MAX_ALERTS_PER_USER`) and the same delivery settings. Tests pin that the catalog and create still return 401 without a session.

### Chart UI
The popover renders the new group from the catalog, with no new list. One affordance is added: a plot may declare `input_options` (`{"ma_type": ["ema", "sma"]}`), and the popover then renders that knob as a `<select>` instead of a free-text box.

### Agent — through the existing `indicatorAlert.create`
* The catalog plot declares `instance_defs: ["movingAverage"]`, the chart definition(s) whose instances this address reads. `plotsForInstance` matches by it in addition to `instancesForAddress`, so an `EMA 9` instance now offers `ma_cross`. Nothing changes for other definitions.
* A new nullable arg, **`crossWith`** (absent ⇒ null, via `absentAsNull`), names the OTHER average's instance. `instance` = the line that crosses ("the 9 ema"); `crossWith` = the one it crosses ("the 20").
* The body is built from the two chart instances. `ma_type` comes from `maType` (both must be the same type, ema or sma, on `close`); `fast`/`slow` are the smaller/larger period. If the member's line is the slower one ("the 50 crosses above the 20"), the pair is swapped and the direction inverted, so the stored alert always reads fast-vs-slow. Equal periods, different types, other MA kinds and different charts are refused with a sentence.
* "alert me when the 9 ema crosses above the 20 on this chart" produces
  `{sym, tf, indicator: "ma_cross", condition: "cross_above", params: {ma_type: "ema", fast: 9, slow: 20, direction: "above", confirm: "close"}, instance_id: <EMA 9 id>}` with no threshold and global scope.
* Pause / resume (`indicatorAlert.toggle`) and `indicatorAlert.delete` need no change.
* **PR #758 (agent/w2/followups, 01ae3ee47c)** resolves human references ("EMA 9", "the 20") inside `findInstance`. `crossWith` is resolved through the same `findInstance`, so once #758 lands both arguments accept "EMA 20"-style references with no further change. Merge note: both PRs touch `indicatorAlerts.js` (#758 the `findInstance` region, this PR the `check`/`toCreate` region). The conflict is textual, not semantic.

## 3. Open questions for the owner
1. `instance_id` stores only the crossing (fast) line, so deleting the slow average is not reported by the orphan sweep. A second column would need an additive migration; it was not added.
2. Mixed-type crosses (EMA 9 vs SMA 50) are refused. Supporting them would mean `fast_type`/`slow_type` params.
3. Closed `ma_cross` fires accrue Signature-ledger receipts like every other builtin closed fire. Please confirm that is wanted.
4. Resolved in review round 1: the EMA window is 400 + 6×slow (cap 5000), pinned against a full-history EMA for 50/200 and 100/500.
5. Operator paths (`ias.create` direct, `tools/alert_soak_matrix.py --arm`) bypass `params_refusal`, as they bypass `refusal_for`; the column still answers no value for invalid params.

// Wave 9 (Task 9.17): the catalog with routines and trackers in it, for the builder's tests. Tests only.
//
// ⛔ TEST-LOCAL until the 9.20 be->impl merge. `toolCatalog.be.json` is GENERATED from the be branch
// (feat/notebook-widgets-p2-be, Task 9.8): `notebook_widget_definitions._static_vocabulary(tools=True)` over
// `widget_engine/sources.py` -- the two tool sources (`routine_history`, `tracker_history`), the three trading-days
// fields that name one (`routine_done`, `tracker_value`, `tracker_bucket`, each with `refKind`), and the tool
// measures, verbatim. It is layered on the impl `serverCatalog.json` here; at 9.20 `serverCatalog.json` is regenerated
// from the merged router and this file goes.
//
// Two `reasons` rows the be router does not serve yet (it has no `_reasons()`; impl's does). They are the engine's own
// sentences, and the 9.20 hand-merge adds them to `_reasons()`:
//   * `one_ref`       = widget_engine/plan.py S_ONE_REF (a second, different routine or tracker in one plan)
//   * `unknown_range` = widget_engine/plan.py S_UNKNOWN_RANGE (a tool source refuses `last_*_trades`)
import SERVER_CATALOG from './serverCatalog.json'
import BE from './toolCatalog.be.json'

export const S_ONE_REF = 'A widget can look at one routine and one tracker.'
export const S_UNKNOWN_RANGE = "That date range isn't available."

/** The catalog wave 9 serves: impl's catalog plus be's tool rows. */
export const TOOL_CATALOG = {
  ...SERVER_CATALOG,
  sources: [
    ...SERVER_CATALOG.sources.map((s) => (s.key === 'trading_days'
      ? { ...s, fields: [...s.fields, ...BE.tradingDaysRefFields] } : s)),
    ...BE.sources,
  ],
  measures: [...SERVER_CATALOG.measures, ...BE.measures],
  reasons: { ...SERVER_CATALOG.reasons, one_ref: S_ONE_REF, unknown_range: S_UNKNOWN_RANGE },
}

// The member's routines and trackers as `GET /vocabulary?field=routine|tracker` answers them
// (`_member_values`: `{id, name}`, a routine id a uuid4; the tracker list leads with the check-in built-ins).
export const R1 = '11111111-1111-4111-8111-111111111111'
export const R2 = '22222222-2222-4222-8222-222222222222'
export const T1 = '33333333-3333-4333-8333-333333333333'
export const ROUTINES = [{ id: R1, name: 'Morning prep' }, { id: R2, name: 'Post-market review' }]
export const TRACKERS = [
  { id: 'checkin:mood', name: 'Check-in mood' }, { id: 'checkin:focus', name: 'Check-in focus' },
  { id: T1, name: 'Sleep' },
]

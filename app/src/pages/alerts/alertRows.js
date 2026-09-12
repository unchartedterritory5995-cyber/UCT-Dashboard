import { tfLabel } from '../../components/chart/timeframes'
import { policyOf } from '../../components/chart/engine/triggerPolicy'

// ─── ONE ALERT LIST, THREE BACKENDS ─────────────────────────────────────────
//
// ⭐⭐ A MEMBER HAS **ALERTS**. That the chart-condition ones live in
// `indicator_alerts` and the price/drawing ones in `watchlist_alerts` is an
// implementation fact, and it is not one they should have to learn to find the
// alert they set on Tuesday. This module is the ONLY place the two shapes are
// reconciled, and it does it in the CLIENT — no migration, no new table, no
// change to either lifecycle.
//
// ⛔⛔ AND IT DOES NOT PRETEND THEY ARE THE SAME. They genuinely are not:
//
//     CONDITION   a 5-state machine, fire-once per episode, snooze, re-arm,
//                 a fire history, and it goes on watching after it fires.
//     PRICE       ONE-SHOT. Firing IS deactivation (`is_active = 0`). No snooze,
//                 no re-arm, no history table, no state column.
//     DRAWING     a PRICE alert with a `drawing_id` and four anchors, which the
//                 chart re-points when the line moves.
//
// Rendering a price alert with a "Mute for…" control would be a control that
// cannot work, and calling a fired one "waiting to reset" would be a lie about
// a row that is finished. Each row therefore declares the actions it SUPPORTS,
// and the UI offers exactly those.

export const KIND_CONDITION = 'condition'
export const KIND_INDICATOR = 'indicator'
export const KIND_PRICE = 'price'
export const KIND_DRAWING = 'drawing'

/** Member-facing group labels. The order is the order the filter renders. */
export const KIND_LABEL = Object.freeze({
  [KIND_CONDITION]: 'Conditions',
  [KIND_INDICATOR]: 'Indicators',
  [KIND_PRICE]: 'Price',
  [KIND_DRAWING]: 'Drawings',
})

/** `u_<12 hex>.<plotKey>` — an alert on a member's OWN saved formula. */
const USER_ADDRESS_RE = /^u_[0-9a-f]{12}\.[A-Za-z0-9_][A-Za-z0-9_-]*$/

/** The definition id inside a user address, or `null` for a builtin. */
export const defIdOf = (address) => (
  USER_ADDRESS_RE.test(String(address || '')) ? String(address).split('.')[0] : null
)

// ─── the member-facing state, from the REAL engine model ────────────────────
//
// ⛔ FIVE ENGINE STATES AND TWO ORTHOGONAL FLAGS, TRANSLATED — NEVER INVENTED.
// "Delivery issue" is deliberately NOT here: it is a property of individual
// FIRES (`channels_failed`), not of an alert, and an alert can be perfectly
// healthy with one undelivered fire behind it.
export const TONE_OK = 'ok'
export const TONE_MUTED = 'muted'
export const TONE_FIRED = 'fired'
export const TONE_FAULT = 'fault'

function conditionStatus(a) {
  // ⚠️ `active` IS A FLAG, NOT A STATE, and it wins — a paused alert is not
  // evaluated at all, so whatever `state` column it carries is a fact about the
  // last time it ran rather than about now.
  if (a.active === false) return { label: 'Paused', tone: TONE_MUTED }
  // ⚠️ THE ORPHANED-INSTANCE FLAG IS ALSO NOT A STATE, deliberately — see the
  // service: `record_evaluation` would clear a state on the next cycle, and an
  // orphaned alert keeps producing values.
  if (a.instance_missing || a.orphaned_instance) {
    return { label: 'Source unavailable', tone: TONE_FAULT, detail: a.state_detail || null }
  }
  switch (a.state) {
    case 'snoozed':
      return { label: 'Muted', tone: TONE_MUTED, detail: a.state_detail || null, until: a.snooze_until || null }
    case 'fired':
      return { label: 'Fired', tone: TONE_FIRED, detail: 'waiting for the condition to go false' }
    case 'needs_attention':
    case 'error':
      return { label: 'Not working', tone: TONE_FAULT, detail: a.state_detail || null }
    default:
      return { label: 'Watching', tone: TONE_OK }
  }
}

/**
 * One `indicator_alerts` row → a list row.
 *
 * ⭐ THE TRIGGER IS READ THROUGH `policyOf`, so a boolean condition alert reads
 * "becomes true" and a hand-built numeric one keeps its own threshold. A
 * `cross_above` at 0.5 and a `cross_above` at 70 are different sentences and the
 * policy table is the only thing that knows which is which.
 */
export function conditionRow(a, { nameOf = null } = {}) {
  const defId = defIdOf(a.indicator)
  const isUser = !!defId
  const policy = policyOf(a)
  // ⛔⛔ `instance_label` IS THE RAW ADDRESS FOR A USER FORMULA, AND A MEMBER MUST
  // NEVER READ `u_0b81da2b98a9.value`. That field is computed by
  // `indicator_alert_evaluator.instance_label`, whose job is naming a BUILTIN's
  // knobs ("RSI(14)"); handed a member's own formula it has nothing to say and
  // echoes the address back. The name lives in the definition, so `nameOf`
  // resolves it — and the address survives only as the last resort, where its
  // presence on screen is a visible bug report rather than a silent blank.
  const name = (nameOf && nameOf(a)) || a.instance_label || a.indicator
  return {
    key: `ind:${a.id}`,
    id: a.id,
    kind: isUser ? KIND_CONDITION : KIND_INDICATOR,
    sym: String(a.sym || '').toUpperCase(),
    tf: a.tf || null,
    tfText: a.tf ? tfLabel(a.tf) : null,
    what: name,
    // ⛔ THE MEMBER'S WORDS WHEN THE POLICY KNOWS THEM, the raw comparison when
    // it does not — never `cross_above 0.5`, and never a guess for a threshold
    // alert somebody built by hand.
    trigger: policy
      ? policy.label.toLowerCase()
      : `${String(a.condition || '').replace(/_/g, ' ')}${a.threshold != null ? ` ${a.threshold}` : ''}`,
    status: conditionStatus(a),
    lastFired: a.triggered_at ? a.triggered_at * 1000 : null,
    fireCount: a.trigger_count || 0,
    scope: a.scope || null,
    // ⭐ WHAT THIS ROW CAN ACTUALLY DO. The UI offers exactly this.
    can: {
      pause: true,
      mute: true,
      // ⚠️ RE-ARM IS OFFERED ONLY WHERE IT DOES SOMETHING. A fired alert comes
      // back by itself when the condition goes false, and an expired snooze
      // re-arms too; this is the advanced case of asking for it NOW.
      rearm: a.state === 'fired' || a.state === 'snoozed',
      history: true,
      delete: true,
    },
    raw: a,
  }
}

/**
 * One `watchlist_alerts` row → a list row.
 *
 * ⛔ ONE-SHOT, AND THE ROW SAYS SO. `_trigger_alert` sets `is_active = 0` and
 * stamps `triggered_at`; there is no state machine, no episode and no history
 * table behind it. A fired price alert is FINISHED, which is a different
 * sentence from a condition alert's "waiting to reset".
 */
export function priceRow(a) {
  const bound = !!a.drawing_id
  const dir = String(a.direction || '').toLowerCase()
  const above = dir === 'above' || dir === 'up' || dir === 'over'
  const done = a.is_active === 0 || a.is_active === false
  return {
    key: `wl:${a.id}`,
    id: a.id,
    kind: bound ? KIND_DRAWING : KIND_PRICE,
    sym: String(a.sym || '').toUpperCase(),
    tf: null,
    tfText: null,
    what: bound
      // ⭐ THE DISTINCTION THE CHART'S OWN TOOLTIP ALREADY MAKES — a bound line
      // follows the drawing when it moves; a fixed level does not.
      ? (a.alert_type === 'trendline' ? 'Price crosses this trendline' : 'Price crosses this line')
      : `Price crosses ${above ? 'above' : 'below'}`,
    trigger: a.target_price != null ? formatPrice(a.target_price) : null,
    status: done
      ? { label: 'Triggered', tone: TONE_FIRED, detail: 'one-time alert — finished' }
      : { label: 'Watching', tone: TONE_OK },
    lastFired: a.triggered_at ? Date.parse(a.triggered_at) || null : null,
    fireCount: done ? 1 : 0,
    scope: null,
    // ⛔ NO PAUSE, NO MUTE, NO RE-ARM, NO HISTORY — because the backend has none.
    // Offering them would be four controls that cannot work.
    can: { pause: false, mute: false, rearm: false, history: false, delete: true },
    raw: a,
  }
}

const formatPrice = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Both listings → one list.
 *
 * ⭐ ORDERED BY WHAT NEEDS THE MEMBER, then by symbol. The manager's own reason
 * for existing is that it is where somebody DISCOVERS an alert that can never
 * fire, so a fault must not be sorted below forty healthy rows.
 */
export const TONE_RANK = Object.freeze({
  [TONE_FAULT]: 0, [TONE_FIRED]: 1, [TONE_OK]: 2, [TONE_MUTED]: 3,
})

export function buildRows(indicatorAlerts, watchlistAlerts, opts = {}) {
  const rows = [
    ...(Array.isArray(indicatorAlerts) ? indicatorAlerts : []).map((a) => conditionRow(a, opts)),
    ...(Array.isArray(watchlistAlerts) ? watchlistAlerts : []).map(priceRow),
  ]
  rows.sort((x, y) => {
    const t = TONE_RANK[x.status.tone] - TONE_RANK[y.status.tone]
    if (t) return t
    const s = x.sym.localeCompare(y.sym)
    if (s) return s
    return (y.lastFired || 0) - (x.lastFired || 0)
  })
  return rows
}

/** Counts per kind, for the filter — including the ones with zero. */
export function countByKind(rows) {
  const out = { all: rows.length }
  for (const k of Object.keys(KIND_LABEL)) out[k] = 0
  for (const r of rows) out[r.kind] = (out[r.kind] || 0) + 1
  return out
}

/**
 * One fire row → the member's sentence.
 *
 * ⛔ `fire_key`, the comparator and `0.5` STAY INTERNAL. `bar_time` becomes the
 * date the member recognises, and the policy supplies the verb.
 */
export function fireLine(fire, row) {
  const when = fire.bar_time ? fire.bar_time * 1000 : (fire.fired_at ? fire.fired_at * 1000 : null)
  const policy = policyOf(fire)
  const failed = Object.entries(
    (fire.delivery_channels && typeof fire.delivery_channels === 'object') ? fire.delivery_channels : {},
  ).filter(([, v]) => v === 'failed').map(([k]) => k)
  return {
    when,
    // ⚠️ THE BAR, NOT THE POLL. A fire is about the bar that produced it, and
    // saying "10:31" for a daily bar would describe when the evaluator noticed.
    barText: row && row.tfText ? `${row.tfText} bar` : null,
    verb: policy ? policy.label.toLowerCase() : 'triggered',
    failedChannels: failed,
  }
}

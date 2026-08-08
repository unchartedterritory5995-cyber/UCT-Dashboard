// app/src/components/chart/alertState.jsx
//
// ─── ONE READING OF AN ALERT'S LIFECYCLE STATE, FOR EVERY SURFACE ───────────
//
// ⭐ `sweep_silent_alerts` (`api/services/indicator_alert_service.py`) runs in
// production every five minutes, DIAGNOSES an alert that has gone quiet, and
// writes `state='needs_attention'` with a `state_detail` sentence naming the
// cause — missing tzdata, no stored bars, an address that resolves to nothing.
// `afbf0470` gave that pair its first reader, inside `IndicatorAlertPopover`.
//
// 🔴 IT LIVES HERE NOW BECAUSE THERE IS A SECOND SURFACE. The popover shows one
// symbol's alerts; the alert manager on `/settings` shows all of them, and the
// manager is where a member with alerts on twelve names actually DISCOVERS that
// one of them can never fire — including the `ichimoku.chikou` alerts that go
// permanently silent at the cutover. Two components each deciding what counts as
// a fault, and each writing its own fallback sentence, is the twin this phase
// spends its budget retiring: the second copy would drift the first time the
// service adds a state, and the drift would be SILENCE, which is the exact
// failure mode the read exists to close.
//
// ⛔ ONLY THE FAULT STATES. `state_detail` is NOT a fault marker on its own —
// `rearm` writes one under `armed` ("re-armed by …") and `snooze` writes
// "snoozed for 60 min" under `snoozed`. A component that rendered every detail
// it was handed would report a snooze the member just asked for as a broken
// alert. The two members below are the service's `STATE_NEEDS_ATTENTION` and
// `STATE_ERROR`, and that they still spell these exact strings is asserted
// against the service's own source in `IndicatorAlertPopover.test.jsx`.

/** The states the service treats as "this alert is not doing its job". */
export const ATTENTION_STATES = new Set(['needs_attention', 'error'])

/** @param {object} alert a served row (`_row_to_dict` shape) */
export function alertNeedsAttention(alert) {
  return ATTENTION_STATES.has(alert && alert.state)
}

/**
 * The row's lifecycle line — the server's own diagnosis, VERBATIM.
 *
 * ⛔ NEVER A PARAPHRASE. `state_detail` is written by the sweep after it re-runs
 * the compute and names the cause; a client-side summary ("this alert is
 * broken") would be a second, rotting description of a diagnosis the server
 * already wrote for this exact row.
 *
 * ⚠️ THE FALLBACK NAMES THE STATE RATHER THAN GUESSING A CAUSE. `_set_state` can
 * move a row to a fault state without a sentence, and a fault with no recorded
 * detail is still a fault the member must be told about — silence there is the
 * failure being closed.
 *
 * Renders `null` for a healthy row, so a caller can mount it unconditionally.
 *
 * @param {{alert: object, className?: string}} props
 */
export default function AlertStateLine({ alert, className }) {
  if (!alertNeedsAttention(alert)) return null
  return (
    <span
      className={className}
      data-testid="alert-state-detail"
      data-state={alert.state}
    >
      {alert.state_detail || `This alert is not firing (${alert.state}).`}
    </span>
  )
}

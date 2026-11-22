// List alerts: the "Alert me when a stock I follow appears here" switch on a Terminal list (H52,
// CONFL, ACCUM). One button; the read, the write and the rules are useListAlerts.js, and the pure
// half (the routes, the gate, the sentences) is listAlertModel.js.
//
// DARK BY DEFAULT. The control draws NOTHING until the server says the alerts are available
// (TERMINAL_LIST_ALERTS_ENABLED; off, the route answers 404). Loading draws nothing either, so a
// panel never shows a switch that then disappears.
//
// A toggle button (`aria-pressed`): Tab reaches it, Enter and Space press it, and a screen reader
// hears the label and "pressed" or "not pressed". The words On and Off sit beside it, so the state
// is never carried by color alone. While a write is out the button says so and takes no second
// press; the result is said in a status line, and a write that did not land leaves the switch
// where the server has it.
import { failureText } from './marketRead'
import { LIST_ALERT_KINDS, LIST_ALERT_LABEL, howTold, switchOf } from './listAlertModel'
import { useListAlerts } from './useListAlerts'
import styles from './marketPanels.module.css'

const WHAT = 'Your alert switch for this list'
/** Outcomes with nothing to put right; anything else is drawn as a warning note. */
const SETTLED = new Set(['on', 'off'])

/** The control for one list: `kind` is 'highs52' | 'confluence' | 'repeat_contracts'. */
export default function ListAlertSwitch({ kind }) {
  const alerts = useListAlerts()
  const info = LIST_ALERT_KINDS[kind]
  if (!info || alerts.state === 'loading' || alerts.state === 'off') return null

  if (alerts.state === 'unreadable') {
    return (
      <p className={styles.note} role="status" data-testid="terminal-list-alert-error">
        {alerts.error ? failureText(alerts.error, WHAT) : `${WHAT} could not be read just now.`}{' '}
        So this panel cannot say whether the alert is on.{' '}
        <button type="button" className={styles.linkBtn} onClick={alerts.retry}>Retry the alert switch</button>
      </p>
    )
  }

  const on = switchOf(alerts.view, kind)
  if (on === null) return null
  const busy = alerts.busy === kind
  const result = alerts.result?.list === kind ? alerts.result : null

  return (
    <div data-testid="terminal-list-alert" data-kind={kind} data-on={on ? 'true' : 'false'}>
      <div className={styles.head}>
        <button type="button" className={styles.chip} aria-pressed={on} aria-disabled={alerts.busy ? 'true' : undefined}
          aria-busy={busy || undefined} onClick={() => alerts.toggle(kind)} data-testid="terminal-list-alert-button">
          {busy ? (on ? 'Switching the alert off' : 'Switching the alert on') : LIST_ALERT_LABEL}
        </button>
        <span className={styles.lede} data-testid="terminal-list-alert-how">{howTold(alerts.view, kind)}</span>
      </div>
      <div role="status" data-testid="terminal-list-alert-status" data-outcome={result?.kind || ''}>
        {result ? <p className={SETTLED.has(result.kind) ? styles.muted : styles.note}>{result.text}</p> : null}
      </div>
    </div>
  )
}

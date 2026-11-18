// List alerts in Settings, Notifications: the three "Alert me when a stock I follow appears
// here" switches in one place (New 52-week highs, the confluence board, repeat-hit option
// contracts). The same switches sit on the lists themselves in the UCT Terminal (H52, CONFL,
// ACCUM); both read and write `GET/PUT /api/alerts/lists` through ONE hook
// (pages/terminal/panels/useListAlerts.js), so there is one source of truth.
//
// DARK BY DEFAULT, the idiom of the rows beside it (AlertRoutingPanel, StandingAlertsPanel): the
// server setting is read server-side only, so a 404 here means "render nothing" rather than a
// second client-side flag to keep in step with the real gate.
//
// ⛔ The row shows the server's answer only. A box is checked when the server says the switch is
// on; a write that did not land says so and the box stays where the server has it.
import styles from '../../pages/Settings.module.css'
import { failureText } from '../../pages/terminal/panels/marketRead'
import { LIST_ALERT_KINDS, alertNotes, howTold, switchOf } from '../../pages/terminal/panels/listAlertModel'
import { useListAlerts } from '../../pages/terminal/panels/useListAlerts'

const WHAT = 'Your list alert switches'

export default function ListAlertsPanel() {
  const alerts = useListAlerts()
  if (alerts.state === 'loading' || alerts.state === 'off') return null

  if (alerts.state === 'unreadable') {
    return (
      <div className={styles.prefRow} data-testid="list-alerts-row">
        <div className={styles.prefLabelGroup}>
          <span className={styles.prefLabel}>List alerts</span>
          <span className={styles.prefDesc} role="status">
            {alerts.error ? failureText(alerts.error, WHAT) : `${WHAT} could not be read just now.`}{' '}
            Nothing here says whether an alert is on.
          </span>
        </div>
        <button type="button" className={styles.btn} onClick={alerts.retry}>Retry</button>
      </div>
    )
  }

  const kinds = Object.keys(LIST_ALERT_KINDS).filter((kind) => switchOf(alerts.view, kind) !== null)
  if (!kinds.length) return null
  const notes = alertNotes(alerts.view)

  return (
    <div className={styles.prefRow} data-testid="list-alerts-row">
      <div className={styles.prefLabelGroup}>
        <span className={styles.prefLabel}>List alerts</span>
        <span className={styles.prefDesc}>
          Be told when a stock on your watchlists or your Flagged list comes onto one of these UCT Terminal lists.
          Every switch starts off.
        </span>
        {kinds.map((kind) => {
          const info = LIST_ALERT_KINDS[kind]
          const on = switchOf(alerts.view, kind)
          return (
            <span key={kind} className={styles.prefDesc} data-testid={`list-alerts-${kind}`}>
              <label>
                {/* Never `disabled` while a write is out: that would drop the keyboard focus. A second
                    press is ignored by the hook, and the box only moves when the server answers. */}
                <input type="checkbox" checked={on} aria-busy={alerts.busy === kind || undefined}
                  onChange={() => alerts.toggle(kind)} />
                {' '}{info.name} ({info.code})
              </label>
              {' '}{howTold(alerts.view, kind)}
            </span>
          )
        })}
        {notes.length ? <span className={styles.prefDesc} data-testid="list-alerts-notes">{notes.join(' ')}</span> : null}
        <span role="status" data-testid="list-alerts-status">
          {alerts.result ? <span className={styles.prefDesc}>{alerts.result.text}</span> : null}
        </span>
      </div>
    </div>
  )
}

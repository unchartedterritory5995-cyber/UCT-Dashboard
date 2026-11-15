// "Tell me what joins and leaves" (RS screens unit U13): one small text switch at the end of an
// RS screen's header line, beside the list's own new/dropped counts. On, the member gets one
// message a day for this screen (rsAlerts.js says where the answer comes from).
//
// Rendered by FocusScreener only on a screen whose starter has `row`, and only when the server
// says the message is available; every other screen never mounts it.
//
// OPTIMISTIC: `on` is the saved-screens payload's own answer, which `onSet` changes at once and
// puts back if the server refuses (useSavedScreens.setRsAlert). A refusal says so here, in one
// short sentence, and the switch is back where it was.
//
// A native button with role="switch": Tab reaches it, Enter and Space press it, and a screen
// reader hears the label, "switch", on or off, then what it does. The visible On / Off word is
// hidden from it (the switch state already says it).
import { useId, useState } from 'react'
import { RS_ALERT_LABEL, RS_ALERT_FAILED, rsAlertHint } from './rsAlerts'
import focus from './FocusScreener.module.css'
import styles from './RsScreens.module.css'

// `onSet(next)` resolves to { ok }. FocusScreener keys this by the screen, so a refusal about one
// screen is never shown under another.
export default function RsAlertToggle({ screenName, on, onSet }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const hintId = useId()
  const hint = rsAlertHint(screenName)
  const press = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    let out = null
    try { out = await onSet(!on) } catch { out = null }
    setBusy(false)
    if (!out?.ok) setFailed(true)
  }
  return (
    <span className={styles.alert} data-testid="rs-alert">
      <button type="button" role="switch" aria-checked={!!on} aria-describedby={hintId} aria-busy={busy || undefined}
        className={`${focus.linkBtn} ${styles.alertToggle}`} title={hint} onClick={press}>
        <span className={styles.alertLabel}>{RS_ALERT_LABEL}</span>
        <span aria-hidden="true" className={on ? styles.alertOn : styles.alertOff}>{on ? 'On' : 'Off'}</span>
      </button>
      <span id={hintId} className="sr-only">{hint}</span>
      {failed && <span role="alert" className={styles.alertFailed}>{RS_ALERT_FAILED}</span>}
    </span>
  )
}

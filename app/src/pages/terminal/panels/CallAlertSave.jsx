// TSRC call alerts: save the search just run as an earnings-call keyword alert, and take it back.
//
// ⭐ NO NEW ROUTE. `GET`, `POST` and `DELETE /api/earnings/keyword-alerts` (paid), until now only
// the chips in the Calendar's transcript panel. The pure half (what can be saved, the server's
// answers as sentences, how a member is told) is callAlertModel.js.
//
// ⛔ THE SCREEN ONLY EVER SHOWS THE SERVER'S ANSWER. Nothing flips before the write lands: the
// button waits, then the list the server sent back with the write is what is drawn, and the list
// is read again after every write, landed or not. A failed write changes nothing on screen.
// ⛔ A SEARCH AN ALERT CANNOT HOLD IS NEVER SENT. Too short, too long, a NEAR search, a full list
// and switched-off alerts each say why in place of the button.
// ⛔ A FAILED LIST READ IS NOT "NOT SAVED". Without the list the panel cannot know, so it offers a
// retry and no save.
//
// Removal follows ALRT (AlertsPanel): one press, the button says it is working, and a removal that
// did not land says so and leaves the alert shown as saved. Saving it again is one press.
//
// The full list of a member's call alerts already lives with a company's transcript (`NVDA TRAN`,
// Full transcript), so this panel points there and does not draw a second copy.
import { useRef, useState } from 'react'
import jsonFetcher from '../../../utils/jsonFetcher'
import { canRetry, failureText, useMarketRead } from './marketRead'
import {
  CALL_ALERTS_URL, HOW_PAUSED, HOW_TOLD, alertNotes, alertsRead, callAlertRemoveUrl, countSentence, removeOutcome, saveOutcome,
  saveState, writeFailureText,
} from './callAlertModel'
import styles from './marketPanels.module.css'

const WHAT = 'The call alert list'
/** Outcomes with nothing to put right; anything else is drawn as a warning note. */
const SETTLED = new Set(['saved', 'removed', 'gone'])

const send = (action, keyword) => (action === 'remove'
  ? jsonFetcher(callAlertRemoveUrl(keyword), { method: 'DELETE' })
  : jsonFetcher(CALL_ALERTS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword }) }))

/** The control: shown on a search result, for the search `q` exactly as it was run. */
export default function CallAlertSave({ q }) {
  const read = useMarketRead(CALL_ALERTS_URL)
  const view = alertsRead(read.body)
  // The list the server sent back with the last write, shown until a later read of the list lands
  // (`since` is the read on screen when the write was answered).
  const [written, setWritten] = useState(null)   // { keywords, since }
  const [busy, setBusy] = useState(null)         // 'save' | 'remove'
  const [result, setResult] = useState(null)     // { kind, text }
  const working = useRef(false)
  const lastRead = useRef(null)
  lastRead.current = read.receivedAt

  const status = (
    <div role="status" data-testid="terminal-tsrc-alert-status" data-outcome={result?.kind || ''}>
      {result ? <p className={SETTLED.has(result.kind) ? styles.muted : styles.note}>{result.text}</p> : null}
    </div>
  )

  if (read.loading) {
    return <p className={styles.muted} data-testid="terminal-tsrc-alert-loading">Reading your call alerts, to see whether this search is one.</p>
  }
  if ((read.error && !read.body) || view.state !== 'ok') {
    const err = read.body ? null : read.error
    return (
      <>
        <p className={styles.note} role="status" data-testid="terminal-tsrc-alert-error">
          {err ? failureText(err, WHAT) : 'The call alert list could not be read just now.'}{' '}
          {!err || canRetry(err) ? (
            <>
              So this panel cannot say whether this search is already a call alert, and will not save it without
              knowing.{' '}
              <button type="button" className={styles.linkBtn} onClick={read.retry}>Retry the call alert list</button>
            </>
          ) : null}
        </p>
        {/* a write just answered and the read after it came back unreadable: its result is still said */}
        {result ? status : null}
      </>
    )
  }

  const fresh = written && written.since === read.receivedAt ? written.keywords : view.keywords
  const list = { ...view, keywords: fresh }
  const state = saveState(q, list)
  const action = state.kind === 'saved' ? 'remove' : 'save'

  const write = async () => {
    if (working.current || state.kind === 'blocked') return
    working.current = true
    setBusy(action)
    setResult(null)
    try {
      const res = await send(action, state.keyword)
      const out = action === 'remove' ? removeOutcome(res, state.keyword) : saveOutcome(res, state.keyword, list)
      if (out.keywords) setWritten({ keywords: out.keywords, since: lastRead.current })
      setResult({ kind: out.kind, text: out.text })
    } catch (err) {
      setResult({ kind: 'failed', text: writeFailureText(err, action, state.keyword) })
    } finally {
      working.current = false
      setBusy(null)
      read.retry()   // every panel showing the list reads it again, whether or not the write landed
    }
  }

  const label = busy === 'save' ? `Saving the call alert: ${state.keyword}`
    : busy === 'remove' ? `Removing the call alert: ${state.keyword}`
      : action === 'remove' ? `Remove the call alert: ${state.keyword}`
        : `Save this search as a call alert: ${state.keyword}`

  return (
    <div data-testid="terminal-tsrc-alert" data-state={state.kind} data-problem={state.problem || ''}>
      <div className={styles.head}>
        {state.kind === 'blocked' ? (
          <span className={styles.lede} data-testid="terminal-tsrc-alert-blocked">
            This search cannot be saved as a call alert. {state.message}
          </span>
        ) : (
          <>
            {/* The saved line holds a slot of its own, so the one button stays the same element
                (and keeps the keyboard focus) when a save turns it into Remove and back. */}
            {state.kind === 'saved' ? <span className={styles.lede} data-testid="terminal-tsrc-alert-saved">This search is a call alert.</span> : null}
            <button type="button" className={styles.chip} onClick={write} aria-disabled={busy ? 'true' : undefined}
              data-testid="terminal-tsrc-alert-button" data-action={action}>
              {label}
            </button>
          </>
        )}
        <span className={styles.lede} data-testid="terminal-tsrc-alert-how">
          {state.kind === 'blocked' ? '' : `${list.sending ? HOW_TOLD : HOW_PAUSED} `}{countSentence(list)}
        </span>
      </div>
      {status}
    </div>
  )
}

/** The small print under the results: what a check reads, what is not caught, where the list is. */
export function CallAlertNotes() {
  const read = useMarketRead(CALL_ALERTS_URL)
  const view = alertsRead(read.body)
  const notes = alertNotes(view)
  if (!notes.length) return null
  return (
    <p className={styles.muted} data-testid="terminal-tsrc-alert-notes">
      Call alerts: {notes.join(' ')} Every call alert you have is listed, and can be removed, with any
      company&apos;s transcript: run <kbd>NVDA TRAN</kbd>, open Full transcript, and look under Search all transcripts.
    </p>
  )
}

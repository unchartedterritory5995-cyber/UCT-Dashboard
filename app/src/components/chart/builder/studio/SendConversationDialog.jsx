// app/src/components/chart/builder/studio/SendConversationDialog.jsx
//
// ─── ⭐ L8 (Studio plan, section 7): "SEND THIS TO UCT" ───────────────────────
//
// One consented press sends a Create Indicator conversation to UCT: the member's words, what UCT
// Intelligence answered, the indicator as it stands and its read-back. It rides the support
// loop's report door (`supportLoop/supportApi.submitReport`, kind 'converse'), so it is off
// unless that door is on, sent only after the box is ticked, capped in size and rate, kept only
// to improve Create Indicator, withdrawable by the member (which deletes it), deleted with the
// account, and purged on the door's own schedule (docs/pine/support-loop/PHASE-A.md).
//
// ⛔ WHAT IS SENT IS SHOWN FIRST. The dialog lists the conversation it will send; nothing is sent
// that the member did not see listed.

import { useCallback, useId, useMemo, useState } from 'react'
import Sheet from '../../../mobile/Sheet'
import { submitReport, withdrawReport } from '../../supportLoop/supportApi'
import styles from '../../supportLoop/ReportMismatchDialog.module.css'
import { conversationReport } from './sendConversation'

export { conversationReport, hasSomethingToSend, REPORT_TURNS_MAX } from './sendConversation'

export default function SendConversationDialog({
  open, onClose, transcript, working, readbackLines, sym = null, tf = null,
  maxSourceBytes = 131072, maxNoteChars = 1000, submit = submitReport, withdraw = withdrawReport,
}) {
  const uid = useId()
  const [consent, setConsent] = useState(false)
  const [note, setNote] = useState('')
  const [state, setState] = useState({ phase: 'idle', error: null, report: null })

  const doc = useMemo(() => conversationReport({ transcript, working, readbackLines, sym, tf }),
    [transcript, working, readbackLines, sym, tf])
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(doc).length : doc.length
  const tooBig = bytes > maxSourceBytes
  const turns = useMemo(() => JSON.parse(doc).transcript, [doc])
  const canSend = consent && turns.length > 0 && !tooBig && state.phase !== 'busy'

  const send = useCallback(async () => {
    if (!canSend) return
    setState({ phase: 'busy', error: null, report: null })
    const res = await submit({
      consent: true, kind: 'converse', source: doc,
      note: note.trim() || null, symbol: sym || null, timeframe: tf || null,
    })
    if (res.ok) setState({ phase: 'done', error: null, report: res.report })
    else setState({ phase: 'idle', error: res.error, report: null })
  }, [canSend, submit, doc, note, sym, tf])

  const takeBack = useCallback(async () => {
    const id = state.report && state.report.id
    if (!id) return
    const ok = await withdraw(id)
    setState(ok ? { phase: 'withdrawn', error: null, report: null }
      : { ...state, error: 'It could not be withdrawn just now. Try again.' })
  }, [state, withdraw])

  return (
    <Sheet open={open} onClose={onClose} variant="auto" title="Send this conversation to UCT" labelledByTitle maxWidth={520}>
      <div className={styles.root} data-testid="send-conversation-dialog">
        {state.phase === 'done' ? (
          <>
            <p className={styles.done} role="status" data-testid="send-conversation-done">
              Sent{state.report && state.report.duplicate ? ' (you had already sent this conversation, so it was not stored twice)' : ''}.
              {' '}Thank you. UCT reads these to make Create Indicator better.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.btn} data-testid="send-conversation-withdraw" onClick={takeBack}>
                Withdraw it
              </button>
              <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={onClose}>Close</button>
            </div>
            {state.error && <p className={styles.err} role="alert">{state.error}</p>}
          </>
        ) : state.phase === 'withdrawn' ? (
          <p className={styles.done} role="status" data-testid="send-conversation-withdrawn">
            Withdrawn and deleted.
          </p>
        ) : (
          <>
            <p className={styles.privacy} data-testid="send-conversation-privacy">
              This sends the conversation below to UCT: what you wrote, what UCT Intelligence
              answered, and the indicator as it stands. We keep it only to improve Create Indicator,
              and you can withdraw it, which deletes it, at any time.
            </p>
            <ol className={styles.meta} data-testid="send-conversation-preview" aria-label="What will be sent">
              {turns.map((t, i) => (
                <li key={i}>{t.role === 'member' ? `You: ${t.text}` : `UCT: ${t.lines.join(' ')}`}</li>
              ))}
            </ol>
            {tooBig && (
              <p className={styles.err} role="alert">
                This conversation is larger than the {Math.round(maxSourceBytes / 1024)} KB a report can carry.
              </p>
            )}
            <div className={styles.field}>
              <label htmlFor={`${uid}-note`}>What went wrong? <span className={styles.opt}>(optional)</span></label>
              <textarea id={`${uid}-note`} rows={3} maxLength={maxNoteChars}
                value={note} onChange={(e) => setNote(e.target.value)} data-testid="send-conversation-note" />
            </div>
            <label className={styles.ack}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
                data-testid="send-conversation-consent" />
              <span>Send this conversation to UCT and keep it to improve Create Indicator</span>
            </label>
            {state.error && <p className={styles.err} role="alert">{state.error}</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={onClose}>Cancel</button>
              <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={!canSend}
                onClick={send} data-testid="send-conversation-send">
                {state.phase === 'busy' ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}

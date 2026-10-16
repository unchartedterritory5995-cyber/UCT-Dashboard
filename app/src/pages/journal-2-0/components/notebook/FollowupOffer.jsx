// Tier 2 part B (R-T2B-7): the member-pressed door of an earnings follow-up. The notice links to
// /journal/notebook?followup=SYM&reportDate=YYYY-MM-DD; this card names the report and makes the note
// ONLY on "Write follow-up" (decision R5: the server never writes a note). A lazy chunk: NotebookTab
// fetches it (through FollowupOfferSlot) the first time such a link is open. A refusal is a fixed
// sentence, never the server's.
import { useRef, useState } from 'react'
import { createFollowupNote, followupWhen, parseFollowupParams } from '../../lib/followupCreate'
import styles from './FollowupOffer.module.css'

export const FOLLOWUP_REGION = 'Earnings follow-up'
// True for every failure, including a create whose answer was lost: the note may have been made, so never say it was not.
export const FAILED_SENTENCE = 'The follow-up note could not be confirmed. Check your notes before trying again.'

export default function FollowupOffer({ open, searchParams, folderId, onCreated, onDismiss, focusFallback }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const pressed = useRef(false)
  const cardRef = useRef(null)
  // What had focus when the card appeared (a notice link, usually, or nothing on a fresh load). Read once, on the first
  // render only (a lazy initialiser), not on every render.
  const [prior] = useState(() => (typeof document !== 'undefined' ? document.activeElement : null))
  const p = open ? parseFollowupParams(searchParams) : null
  if (!p) return null
  const notNow = () => {
    // Focus first, then leave: the card's own button holds focus until it unmounts, and an unmounted focus owner drops it to <body>.
    // What was focused before the card appeared if it is still on the page, else the tab's own fallback (the Notebook pane's
    // heading: no note is open while the card shows, so there is no editor to land in).
    if (prior && prior !== document.body && prior.isConnected && !cardRef.current?.contains(prior)) prior.focus?.()
    else focusFallback?.()
    onDismiss?.()
  }
  const write = async () => {
    if (pressed.current) return
    pressed.current = true
    setBusy(true)
    setError(null)
    try {
      const note = await createFollowupNote({ ...p, folderId })
      // A create that answers without an id made nothing the tab can open: say so, and let the member press again.
      if (!note?.id) {
        pressed.current = false
        setError(FAILED_SENTENCE)
        return
      }
      onCreated?.(note)
    } catch {
      pressed.current = false
      setError(FAILED_SENTENCE)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section ref={cardRef} className={styles.card} aria-label={FOLLOWUP_REGION} data-followup-offer>
      <h2 className={styles.title}>Earnings follow-up for {p.symbol}</h2>
      <p className={styles.line}>
        {p.symbol} reported on {followupWhen(p.reportDate)}. Write what you expected, what happened, and what you&apos;ll do differently.
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={write} aria-busy={busy || undefined}>Write follow-up</button>
        <button type="button" className={styles.secondary} onClick={notNow} disabled={busy}>Not now</button>
      </div>
    </section>
  )
}

// Tier 2 part B (R-T2B-7): the member-pressed door of an earnings follow-up. The notice links to
// /journal/notebook?followup=SYM&reportDate=YYYY-MM-DD; this card names the report and makes the note
// ONLY on "Write follow-up" (decision R5: the server never writes a note). A lazy chunk: NotebookTab
// fetches it (through FollowupOfferSlot) the first time such a link is open. A refusal is a fixed
// sentence, never the server's.
import { useRef, useState } from 'react'
import { createFollowupNote, followupWhen, parseFollowupParams } from '../../lib/followupCreate'
import styles from './FollowupOffer.module.css'

export const FOLLOWUP_REGION = 'Earnings follow-up'
export const FAILED_SENTENCE = "Couldn't create the follow-up. Nothing was saved."

export default function FollowupOffer({ open, searchParams, folderId, onCreated, onDismiss }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const pressed = useRef(false)
  const p = open ? parseFollowupParams(searchParams) : null
  if (!p) return null
  const write = async () => {
    if (pressed.current) return
    pressed.current = true
    setBusy(true)
    setError(null)
    try {
      const note = await createFollowupNote({ ...p, folderId })
      onCreated?.(note)
    } catch {
      pressed.current = false
      setError(FAILED_SENTENCE)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={styles.card} role="region" aria-label={FOLLOWUP_REGION} data-followup-offer>
      <h2 className={styles.title}>Earnings follow-up for {p.symbol}</h2>
      <p className={styles.line}>
        {p.symbol} reported on {followupWhen(p.reportDate)}. Write what you expected, what happened, and what you’ll do differently.
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={write} aria-busy={busy || undefined}>Write follow-up</button>
        <button type="button" className={styles.secondary} onClick={() => onDismiss?.()} disabled={busy}>Not now</button>
      </div>
    </section>
  )
}

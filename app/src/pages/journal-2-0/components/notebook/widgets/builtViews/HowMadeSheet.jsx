import { useState } from 'react'
import Sheet from '../../../../../../components/mobile/Sheet'
import styles from './builtViews.module.css'
import { snapshotStyles as s } from '../SnapshotFrame'
import { planChanges, NOTHING_VISIBLE, NO_COPY } from './planChanges'

/**
 * Built widgets (wave 8, Task 8.14): "How this is made", from a placed widget's ⋯ menu. It says, in the member's
 * words, what the widget adds up (`params.summary`, the sentence the server wrote for this revision) and offers
 * "Edit widget" (or "Edit a copy" for one of the firm's examples, which the member cannot change in place).
 *
 * When a newer revision of the widget exists (`latest`, read when the menu opened), it says what the update changes
 * (the W10.4 walk fix): the two sentences side by side only when they differ, then every difference between the plan
 * this note runs (`placedPlan`) and the newer one that the sentences do not name (planChanges: the view, a running
 * total, a stop rule, the member's own fields...), or plainly that nothing visible changes. "Use the updated version"
 * re-runs the widget at that revision.
 * ⛔ Never rendered while the widget is shared, nor on a public page: the summary names the member's filters (the ⋯
 * menu is not drawn then).
 */
export const UPDATED_VERSION = 'Updated version available'

export default function HowMadeSheet({ open, onClose, summary, shelf = false, onEdit, latest, onApply, placedPlan = null }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const own = typeof summary === 'string' && summary ? summary : 'This widget has no description saved with it.'
  const latestSummary = latest && typeof latest.summary === 'string' && latest.summary
    ? latest.summary : 'No description saved with the update.'
  const plansKnown = !!placedPlan && typeof placedPlan === 'object' && !!latest?.plan && typeof latest.plan === 'object'
  const changes = latest ? planChanges(placedPlan, latest.plan) : []
  const apply = async () => {
    if (busy || typeof onApply !== 'function') return
    setBusy(true)
    setMessage('')
    let got
    try { got = await onApply() } catch { got = { ok: false, text: "Couldn't refresh. The saved snapshot is unchanged." } }
    setBusy(false)
    if (got?.ok) onClose?.()
    else if (got?.text) setMessage(got.text)
  }
  return (
    <Sheet open={open} onClose={onClose} title="How this is made" labelledByTitle maxWidth={560}>
      <div className={styles.howMade} data-testid="built-how-made">
        <p className={styles.howSummary}>{own}</p>
        {latest && typeof latest.summary === 'string' && (
          <section className={styles.howUpdate} aria-label={UPDATED_VERSION}>
            <h3 className={styles.howHeading}>{UPDATED_VERSION}</h3>
            {latestSummary !== own && (
              <div className={styles.howCompare}>
                <div>
                  <span className={styles.metricLabel}>In this note</span>
                  <p className={styles.howSummary}>{own}</p>
                </div>
                <div>
                  <span className={styles.metricLabel}>Updated</span>
                  <p className={styles.howSummary} data-testid="built-how-latest">{latestSummary}</p>
                </div>
              </div>
            )}
            {changes.length > 0 ? (
              <>
                <span className={styles.metricLabel}>What changes</span>
                <ul className={styles.howChanges} data-testid="built-how-changes">
                  {changes.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </>
            ) : latestSummary === own && (
              <p className={styles.howSummary} data-testid="built-how-changes">{plansKnown ? NOTHING_VISIBLE : NO_COPY}</p>
            )}
            <button type="button" className={s.btn} onClick={apply} disabled={busy} aria-busy={busy || undefined}>
              Use the updated version
            </button>
            {message && <p className={s.message} role="status">{message}</p>}
          </section>
        )}
        <div className={styles.howActions}>
          <button type="button" className={s.btn} onClick={onEdit}>{shelf ? 'Edit a copy' : 'Edit widget'}</button>
        </div>
      </div>
    </Sheet>
  )
}

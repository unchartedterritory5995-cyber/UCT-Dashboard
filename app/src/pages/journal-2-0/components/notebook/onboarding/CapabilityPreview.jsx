import { useId } from 'react'
import { armedCapabilities, PREVIEW_COPY } from './capabilityList'
import CaptureDoors from '../CaptureDoors'
import styles from './CapabilityPreview.module.css'

/**
 * Wave 14 lane W14-A (plan 4.1, default D1): a short, plain-text preview of what the
 * Notebook can do, under the first-run welcome's buttons, plus the sample-notebook
 * promotion.
 *
 * ⛔ IN-FLOW PAGE CONTENT, NOT A FIRST-RUN CARD (plan 5.6). It renders where Research Home
 * puts it, never into the first-run slot, and never claims the stage: it cannot cover a
 * control, and a tour or the "Meet Compass" card never has to wait for it.
 * ⛔ Lists only the capabilities armed for this member (capabilityList.js). Nothing armed
 * and no sample to offer renders nothing at all, so the welcome reads exactly as before.
 * ⛔ The promotion is TEXT that describes the existing "Add a sample notebook" button (the
 * button points at it with aria-describedby). There is no second button doing the same job.
 *
 * @param canAddSample  the sample button is on screen (onboarding on, paid, no sample yet)
 * @param promoId       the id the sample button's aria-describedby names
 * @param hideHeading   the caller already shows this title (Learn's "What your Notebook can do"
 *                      sheet): leave the heading out and name the region and list by label instead
 */
export default function CapabilityPreview({ canAddSample = false, promoId, hideHeading = false }) {
  const headingId = useId()
  const lines = armedCapabilities()
  if (lines.length === 0 && !canAddSample) return null
  const named = hideHeading
    ? { 'aria-label': PREVIEW_COPY.heading }
    : { 'aria-labelledby': headingId }
  return (
    <section className={styles.preview} {...(lines.length ? named : {})}>
      {lines.length > 0 && (
        <>
          {!hideHeading && <h3 id={headingId} className={styles.heading}>{PREVIEW_COPY.heading}</h3>}
          <ul className={styles.list} {...named}>
            {lines.map((c) => (
              <li key={c.id} className={styles.item}>
                <span className={styles.label}>{c.label}.</span> {c.line}
              </li>
            ))}
          </ul>
        </>
      )}
      {canAddSample && (
        <p id={promoId} className={styles.promo}>
          {PREVIEW_COPY.sampleLead} <span className={styles.promoName}>{PREVIEW_COPY.sampleButton}</span>{' '}
          {PREVIEW_COPY.sampleTail}
        </p>
      )}
      {/* P0.8: how notes get in from outside the Notebook. Only under a preview that is already
          showing (nothing armed and no sample offer renders nothing at all, above), and it asks
          nothing but the two capture gates the Settings cards ask. */}
      <CaptureDoors compact />
    </section>
  )
}

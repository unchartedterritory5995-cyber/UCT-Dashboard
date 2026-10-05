// The "new in your Notebook" offer card (wave 14, lane W14-C2) -- the LAZY half; its
// gate is TourOfferGate.jsx, which decides whether it shows at all and portals it into
// Layout's in-flow first-run slot.
//
// Small and dismissible, NEVER a modal: no dialog role, no focus moved here on arrival,
// nothing traps Tab (plan 5.3, risk R4). It is a labelled region in the page flow, so a
// keyboard member reaches it in reading order (it is the first thing in <main>) and a
// screen reader can find it by its heading. Escape inside it is "Not now".
import { useId } from 'react'
import { OFFER_COPY } from './tourOfferCopy'
import styles from './TourOfferPrompt.module.css'

export default function TourOfferPrompt({ entry, onAccept, onLater }) {
  const titleId = useId()
  const bodyId = useId()
  if (!entry) return null
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onLater()
    }
  }
  return (
    <section
      className={styles.card}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-tour-offer=""
      onKeyDown={onKeyDown}
    >
      <div className={styles.text}>
        <h2 id={titleId} className={styles.title}>{OFFER_COPY.title(entry.title)}</h2>
        <p id={bodyId} className={styles.body}>{OFFER_COPY.body}</p>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.accept} onClick={onAccept}>{OFFER_COPY.accept}</button>
        <button type="button" className={styles.later} onClick={onLater}>{OFFER_COPY.later}</button>
      </div>
    </section>
  )
}

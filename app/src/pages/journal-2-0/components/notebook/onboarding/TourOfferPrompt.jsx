// The "new in your Notebook" offer card (wave 14, lane W14-C2) -- the LAZY half; its
// gate is TourOfferGate.jsx, which decides whether it shows at all and portals it into
// Layout's in-flow first-run slot.
//
// Small and dismissible, NEVER a modal: no dialog role, no focus moved here on arrival,
// nothing traps Tab (plan 5.3, risk R4). It is a labelled region in the page flow, so a
// keyboard member reaches it in reading order (it is the first thing in <main>) and a
// screen reader can find it by its heading. Escape inside it is "Not now".
import { useId, useRef } from 'react'
import useRovingTabIndex from '../../../../../hooks/useRovingTabIndex'
import { OFFER_COPY } from './tourOfferCopy'
import styles from './TourOfferPrompt.module.css'

/**
 * FIN-A11Y (review R4, M-2): answering the offer unmounts this card with focus on one of its
 * buttons, so focus fell to <body>; and after "Take the tour" the tour recorded <body> as
 * where to return focus. Before it answers, the card hands focus to the page heading (the
 * first-run heading when the page has one), so there is always a named place to be and to
 * come back to. Focus a member has put somewhere else is left alone.
 */
function handFocusToPage(card) {
  if (!card || typeof document === 'undefined') return
  const active = document.activeElement
  if (active && active !== document.body && !card.contains(active)) return
  const scope = card.closest('main') || document
  const heading = scope.querySelector('[data-first-run-heading]')
    || [...scope.querySelectorAll('h1, h2')].find((h) => !card.contains(h))
  if (!heading) return
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
  heading.focus()
}

export default function TourOfferPrompt({ entry, onAccept: acceptOffer, onLater: declineOffer }) {
  const cardRef = useRef(null)
  const onAccept = () => { handFocusToPage(cardRef.current); acceptOffer() }
  const onLater = () => { handFocusToPage(cardRef.current); declineOffer() }
  const titleId = useId()
  const bodyId = useId()
  // W14-keys: the two answers are ONE Tab stop (a toolbar named by the card; Arrow keys move
  // between them). Escape anywhere in the card is still "Not now", and the button says so.
  const { containerProps, itemProps } = useRovingTabIndex({ orientation: 'horizontal' })
  if (!entry) return null
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onLater()
    }
  }
  return (
    <section
      ref={cardRef}
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
      <div className={styles.actions} role="toolbar" aria-labelledby={titleId} {...containerProps}>
        <button type="button" className={styles.accept} onClick={onAccept} {...itemProps('accept')}>{OFFER_COPY.accept}</button>
        <button type="button" className={styles.later} onClick={onLater} aria-keyshortcuts="Escape"
          {...itemProps('later')}>{OFFER_COPY.later}</button>
      </div>
    </section>
  )
}

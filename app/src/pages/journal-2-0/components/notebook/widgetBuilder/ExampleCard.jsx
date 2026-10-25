import { memo, useCallback, useId } from 'react'
import MiniPreview, { Glyph } from './miniPreview'
import styles from './ExamplesGallery.module.css'

/** The ribbon a card carries while the member is on the bundled sample book (spec 5.2 step 1). */
export const SAMPLE_RIBBON = 'Sample data'

/**
 * Notebook widgets phase 2 (wave 8, Task 8.16): one example card in "Start from an example".
 *
 * ONE button per card (its name is the card's name; its description and its range are read as the description), in a
 * list item the gallery observes for scrolling into view (`observe(id, el)`; `data-example-id` says which).
 *
 * The thumbnail, by the card's state:
 *   * `loading` (asked for, or never asked yet): a skeleton. It shimmers only when motion is allowed (`motion`).
 *   * `ok`: the payload's static thumbnail (miniPreview), or its own empty sentence (spec 5.9) when it has no rows.
 *   * `static`: the view's bare shape. A card whose numbers could not be had never says why ("busy" is never shown
 *     on a card); the live preview, once it is opened, has the full story.
 * On sample data, "Sample data" sits beside the range label.
 */
function ExampleCard({ example, card, sample, motion, onOpen, observe }) {
  const nameId = useId()
  const descId = useId()
  const metaId = useId()
  const id = example.id
  const itemRef = useCallback((el) => observe?.(id, el), [observe, id])
  const status = card?.status || 'loading'
  const payload = status === 'ok' ? card.payload : null
  const viewType = typeof example.plan?.view?.type === 'string' ? example.plan.view.type : 'number'
  const empty = payload && typeof payload.empty === 'string' && payload.empty && !payload.tooLarge ? payload.empty : null
  const rangeLabel = payload && typeof payload.rangeLabel === 'string' ? payload.rangeLabel : ''
  // The card's OWN answer says whether it read the sample book (the gallery's banner says it for all of them).
  const ribbon = payload?.sample === true || (!!payload && sample === true)
  let thumb
  if (status === 'loading') {
    thumb = <span className={`${styles.skeleton} ${motion ? styles.shimmer : ''}`} data-testid="example-skeleton" />
  } else if (empty) {
    thumb = <span className={styles.cardEmpty}>{empty}</span>
  } else if (payload) {
    thumb = <MiniPreview payload={payload} />
  } else {
    thumb = <Glyph type={viewType} />
  }
  return (
    <li className={styles.item} ref={itemRef} data-example-id={id}>
      <button type="button" className={styles.card} aria-labelledby={nameId}
        aria-describedby={`${descId} ${metaId}`} aria-busy={status === 'loading' || undefined}
        onClick={(e) => onOpen(example, e.currentTarget)} data-testid={`example-card-${example.id}`}>
        <span className={styles.thumbBox}>{thumb}</span>
        <span className={styles.cardName} id={nameId}>{example.name}</span>
        <span className={styles.cardDesc} id={descId}>{example.description}</span>
        <span className={styles.cardMeta} id={metaId}>
          {rangeLabel && <span className={styles.cardRange}>{rangeLabel}</span>}
          {ribbon && <span className={styles.ribbon}>{SAMPLE_RIBBON}</span>}
        </span>
      </button>
    </li>
  )
}

export default memo(ExampleCard)

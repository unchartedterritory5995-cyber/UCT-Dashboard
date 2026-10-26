// Notebook widgets phase 2, wave 11 (Task 11.16): the facts every library card shows while wave 11 is on.
//
// One block, read by the community gallery's outline card (`GalleryCard`, which also draws the three tool types),
// the style card (`StyleLibraryCard`) and the Template library section's cards, so a card's words are decided once:
//   * a type chip: "Template", "Widget", "Routine" or "Tracker";
//   * "For: <description>"; "Contains: <names>" (at most four, then "and <n> more");
//   * "Used by <n> traders", or "New" for an item nobody has used yet (no zeros, W9-R7); "Updated <Mon D>";
//   * the Helpful count, only once somebody found it helpful (never "0 found this helpful");
//   * the credit for a viewer's own copy, exactly as the server wrote it (W11-R7, W11-R24: nothing here builds one);
//   * on a template that holds a widget, routine or tracker: "Fills in with your own data when you make a note."
// ⛔ Every value is the server's summary field (`contains`, `usedBy`, `updatedAt`, `helpfulCount`, `credit`,
//    `author`); a list card never asks for a preview with the member's data (`preview-mine` is the detail's only).
// ⛔ LAZY. Imported only by lazy chunks (the community gallery, the Template library section).
import styles from './library.module.css'

export const FILLS_SENTENCE = 'Fills in with your own data when you make a note.'
export const NEW_WORDS = 'New'
export const CONTAINS_MAX = 4

/** The type chip's word for a listed item type. */
const TYPE_WORDS = Object.freeze({
  style: 'Template',
  outline: 'Template',
  widget_definition: 'Widget',
  routine: 'Routine',
  tracker: 'Tracker',
})

/** The adoption sheet's kind for a listed tool type (`openAdoptSheet({kind})`); a template is 'template'. */
export const ADOPT_KIND = Object.freeze({ widget_definition: 'widget', routine: 'routine', tracker: 'tracker' })

const text = (v) => (typeof v === 'string' ? v.trim() : '')
const count = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0)

export function typeWords(itemType) {
  return TYPE_WORDS[itemType || 'outline'] || ''
}

/** "Used by 3 traders" / "Used by 1 trader", and "New" when nobody has (a 0 is never shown). */
export function usedByWords(n) {
  const k = count(n)
  if (k < 1) return NEW_WORDS
  return k === 1 ? 'Used by 1 trader' : `Used by ${k} traders`
}

/** "Contains: A, B, C, D and 2 more" (at most four names); '' when the item names none. */
export function containsWords(names) {
  const list = (Array.isArray(names) ? names : []).map(text).filter(Boolean)
  if (!list.length) return ''
  const shown = list.slice(0, CONTAINS_MAX).join(', ')
  const rest = list.length - CONTAINS_MAX
  return `Contains: ${rest > 0 ? `${shown} and ${rest} more` : shown}`
}

/** "Updated Oct 3" (the US Eastern day); '' when the stamp is missing or unreadable. A stamp without a zone is UTC,
 *  as the server writes it (`datetime.utcnow().isoformat()`), the client rule of ruling W11-R15. */
export function updatedWords(stamp) {
  const raw = text(stamp)
  if (!raw) return ''
  // A bare day ("2026-10-03") is that day, whatever the zone; an instant is read on the Eastern clock.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw)
  const zoned = dateOnly || /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`
  const t = Date.parse(zoned)
  if (!Number.isFinite(t)) return ''
  const timeZone = dateOnly ? 'UTC' : 'America/New_York'
  const day = new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })
  return `Updated ${day}`
}

/** "5 found this helpful", only from 1 up. */
export function helpfulWords(n) {
  const k = count(n)
  return k >= 1 ? `${k} found this helpful` : ''
}

/**
 * @param item         a listed item (the gallery's `_summary`, plus the Template library's `contains`)
 * @param helpfulCount the card's live count when it holds a Helpful toggle (the style card); else the item's
 * @param showAuthor   draw the author label too (the section's cards; the gallery's cards already show it)
 */
export default function LibraryCardFacts({ item, helpfulCount, showAuthor = false }) {
  const chip = typeWords(item?.itemType)
  const desc = text(item?.description)
  const contains = containsWords(item?.contains)
  const helped = helpfulWords(helpfulCount === undefined ? item?.helpfulCount : helpfulCount)
  const meta = [usedByWords(item?.usedBy), updatedWords(item?.updatedAt), helped].filter(Boolean).join(' · ')
  const credit = text(item?.credit)
  const author = showAuthor ? text(item?.author) : ''
  const fills = chip === 'Template' && contains !== ''
  return (
    <div className={styles.facts} data-library-facts="">
      {chip && <span className={styles.typeChip} data-type-chip="">{chip}</span>}
      {author && <p className={styles.factLine} data-author-label="">{author}</p>}
      {desc && <p className={styles.factLine}>For: {desc}</p>}
      {contains && <p className={styles.factLine} data-contains="">{contains}</p>}
      <p className={styles.factLine} data-used-by="">{meta}</p>
      {credit && <p className={styles.factLine} data-credit="">{credit}</p>}
      {fills && <p className={styles.factLine}>{FILLS_SENTENCE}</p>}
    </div>
  )
}

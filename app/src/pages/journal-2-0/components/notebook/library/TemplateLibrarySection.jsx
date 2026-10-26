// Notebook widgets phase 2, wave 11 (Task 11.16): the Template library, inside the template picker.
//
// UCT's official templates (ruling W11-R4), one row of cards per group, in the server's group order
// (`LIBRARY_GROUPS`). TemplatePicker.jsx draws this ABOVE "Your templates" while wave 11 is on, loading it on demand.
//   * It reuses the picker's search box and category chips: a search matches a template's title, description and
//     what it contains; a category chip keeps the templates of that category (the "Your templates" chip hides the
//     library; a chip no library template carries shows none).
//   * Each card shows the library facts (LibraryCardFacts: type chip, author, "For:", "Contains:", "Used by" or "New",
//     "Updated", the Helpful count) and an "In your templates" badge when the member already holds a live copy.
//   * A card's "Preview" opens TemplateDetailSheet (the outline, then the member's own data, then "Use this
//     template"). ⛔ The list itself never asks for a preview with the member's data: one `GET /library`, nothing else.
// ⛔ Its cards are NOT picker cards (`data-template-card`): the picker's arrow keys, Home/End, Tab order and the
//    search box's Enter target stay exactly as they were (TemplatePicker.gallery.test.jsx's rails).
// ⛔ LAZY. Reached only through TemplatePicker.jsx's dynamic import while `widgetsWaveOn(11)`.
import { useEffect, useId, useMemo, useState } from 'react'
import { LIBRARY_GROUPS, libraryList } from '../../../lib/templateLibrary'
import LibraryCardFacts from './LibraryCardFacts'
import TemplateDetailSheet from './TemplateDetailSheet'
import UIcon from '../../../../../components/ui/UIcon'
import styles from './library.module.css'

export const SECTION_TITLE = 'Template library'
export const IN_YOURS = 'In your templates'
export const PREVIEW_LABEL = 'Preview'
export const LOADING_SENTENCE = 'Loading the Template library…'

const ALL = 'all'
const MEMBER = 'member'
const text = (v) => (typeof v === 'string' ? v : '')
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The listed rows of a `GET /library` answer (`{templates: [...]}`, the gallery's list envelope). */
export function libraryRows(data) {
  const rows = isRecord(data) ? (Array.isArray(data.templates) ? data.templates : data.items) : null
  return (Array.isArray(rows) ? rows : []).filter((r) => isRecord(r) && (typeof r.id === 'string' || typeof r.id === 'number'))
}

/** Does a library row match the picker's search (already trimmed and lower-cased)? Title, description, contains. */
export function libraryMatches(row, q) {
  if (!q) return true
  const names = Array.isArray(row.contains) ? row.contains.filter((n) => typeof n === 'string') : []
  return [text(row.title), text(row.description), ...names].join(' ').toLowerCase().includes(q)
}

/** Does a library row pass the picker's category chip? */
export function libraryInCategory(row, category) {
  if (!category || category === ALL) return true
  if (category === MEMBER) return false
  return row.category === category
}

function LibraryCard({ item, busy, onPreview }) {
  const uid = useId()
  return (
    <li className={styles.libraryCard} data-library-card={item.id}>
      <p className={styles.previewTitle} id={`${uid}-title`}>{text(item.title)}</p>
      {item.inYourTemplates === true && <span className={styles.badge} data-in-yours="">{IN_YOURS}</span>}
      <LibraryCardFacts item={item} showAuthor />
      <div className={styles.actions} role="group" aria-labelledby={`${uid}-title`}>
        <button type="button" className={styles.btn} onClick={() => onPreview(item)} disabled={busy}
          aria-label={`${PREVIEW_LABEL} ${text(item.title)}, from the Template library`}>
          <UIcon name="eye" size={13} gold={false} /> {PREVIEW_LABEL}
        </button>
      </div>
    </li>
  )
}

/**
 * @param query    the picker's search, trimmed and lower-cased
 * @param category the picker's category chip ('all', a family key, or 'member')
 * @param busy     the picker is making a note
 * @param navigate the app router's navigate, for the adoption sheet a detail opens
 */
export default function TemplateLibrarySection({ query = '', category = ALL, busy = false, navigate = null }) {
  const uid = useId()
  const [answer, setAnswer] = useState(null)      // null while asking, then {ok, data | code, message}
  const [open, setOpen] = useState(null)          // the row whose detail is open

  useEffect(() => {
    let alive = true
    libraryList().then((out) => { if (alive) setAnswer(out) })
    return () => { alive = false }
  }, [])

  const rows = useMemo(() => libraryRows(answer?.ok ? answer.data : null), [answer])
  const groups = useMemo(() => {
    const shown = rows.filter((r) => libraryMatches(r, query) && libraryInCategory(r, category))
    return LIBRARY_GROUPS
      .map((g) => ({ ...g, items: shown.filter((r) => r.group === g.key) }))
      .filter((g) => g.items.length > 0)
  }, [rows, query, category])

  if (category === MEMBER) return null
  // Dark (wave 11 or the library switch off at the server): the route is the gallery's 404, and the picker shows
  // nothing for it, as it shows no gallery door while the gallery is off.
  if (answer && !answer.ok && answer.code === 'unavailable') return null
  if (answer?.ok && !groups.length) return null

  return (
    <section className={styles.librarySection} aria-labelledby={`${uid}-title`} data-template-library="">
      <h3 className={styles.subheading} id={`${uid}-title`}>{SECTION_TITLE}</h3>
      {answer === null && <p className={styles.hint} role="status">{LOADING_SENTENCE}</p>}
      {answer && !answer.ok && <p className={styles.notice} role="status" data-refusal={answer.code}>{answer.message}</p>}
      {groups.map((g) => (
        <div key={g.key} className={styles.libraryGroup} data-library-group={g.key}>
          <h4 className={styles.label} id={`${uid}-${g.key}`}>{g.label}</h4>
          <ul className={styles.libraryRow} aria-labelledby={`${uid}-${g.key}`}>
            {g.items.map((item) => <LibraryCard key={item.id} item={item} busy={busy} onPreview={setOpen} />)}
          </ul>
        </div>
      ))}
      {open && <TemplateDetailSheet item={open} onClose={() => setOpen(null)} navigate={navigate} />}
    </section>
  )
}

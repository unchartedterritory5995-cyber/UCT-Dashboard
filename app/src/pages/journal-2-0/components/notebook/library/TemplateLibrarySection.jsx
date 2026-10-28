// Notebook widgets phase 2, wave 11 (Task 11.16): the Template library, inside the template picker.
//
// UCT's official templates (ruling W11-R4), one row of cards per group, in the server's group order
// (`LIBRARY_GROUPS`). TemplatePicker.jsx draws this ABOVE "Your templates" while wave 11 is on, loading it on demand.
//   * It reuses the picker's search box and category chips: a search matches a template's title, description and
//     what it contains; a family chip keeps the templates pinned to it by seed key, and otherwise those whose
//     library group (spec §10's routine category) is that family's (`FAMILY_TEMPLATES` / `FAMILY_GROUPS` /
//     `familyKeeps`, lib/templateLibrary.js, the ONE mapping; W11-R68 and the owner's 2026-10-27 ruling);
//     "Your templates" hides it.
//   * It tells the picker how many templates it is showing (`onMatches`), so the picker's "No templates match" line
//     and its screen-reader line never contradict a library match on the same screen (fix round 1 I-2).
//   * Each card shows the library facts (LibraryCardFacts: type chip, author, "For:", "Contains:", "Used by" or "New",
//     "Updated", the Helpful count) and an "In your templates" badge when the member already holds a live copy.
//   * A card's "Preview" opens TemplateDetailSheet (the outline, then the member's own data, then "Use this
//     template"). ⛔ The list itself never asks for a preview with the member's data: one `GET /library`, nothing else.
// ⛔ Its cards are NOT picker cards (`data-template-card`): the picker's arrow keys, Home/End, Tab order and the
//    search box's Enter target stay exactly as they were (TemplatePicker.gallery.test.jsx's rails).
// ⛔ LAZY. Reached only through TemplatePicker.jsx's dynamic import while `widgetsWaveOn(11)`.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { familyKeeps, LIBRARY_GROUPS, libraryList } from '../../../lib/templateLibrary'
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

/** Does a library row pass the picker's category chip (a FAMILIES key, 'all' or 'member')? */
export function libraryInCategory(row, category) {
  if (!category || category === ALL) return true
  if (category === MEMBER) return false
  return familyKeeps(category, row)
}

function LibraryCard({ item, busy, onPreview }) {
  const uid = useId()
  return (
    <li className={styles.libraryCard} data-library-card={item.id}>
      <h5 className={styles.previewTitle} id={`${uid}-title`}>{text(item.title)}</h5>
      {item.inYourTemplates === true && <span className={styles.badge} data-in-yours="">{IN_YOURS}</span>}
      <LibraryCardFacts item={item} showAuthor />
      {/* ⛔ A plain wrapper, not a `group` named by the title: the title is already the card's h5 and inside the
          button's own name, so a named group made a screen reader say it a third time around one button. */}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={(e) => onPreview(item, e.currentTarget)} disabled={busy}
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
 * @param onMatches `(n, settled) => void`: how many templates the section shows right now (0 when it shows none);
 *                 `settled` is false until the list has answered
 * @param landNote `(note) => void`: the picker's host lands a note made by a Use (closing its sheet; 11.20 walk D1)
 */
export default function TemplateLibrarySection({ query = '', category = ALL, busy = false, navigate = null, onMatches, landNote = null }) {
  const uid = useId()
  const [answer, setAnswer] = useState(null)      // null while asking, then {ok, data | code, message}
  const [open, setOpen] = useState(null)          // the row whose detail is open
  // The Preview button that opened it: focus returns there on close, a tap included (WebKit never focuses a tapped
  // button, so the Sheet's own record of "where focus was" is the New note panel, not this button).
  const openerRef = useRef(null)
  const preview = (item, button) => { openerRef.current = button || null; setOpen(item) }

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

  const shownCount = answer?.ok && category !== MEMBER ? groups.reduce((n, g) => n + g.items.length, 0) : 0
  // The second argument says the count is an answer: false while the list is still being asked for (0 then means
  // "not yet", not "none"), so the picker's touch count waits for it instead of speaking a number that will change.
  const settled = answer !== null
  useEffect(() => { onMatches?.(shownCount, settled) }, [shownCount, settled, onMatches])
  useEffect(() => () => { onMatches?.(0) }, [onMatches])

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
            {g.items.map((item) => <LibraryCard key={item.id} item={item} busy={busy} onPreview={preview} />)}
          </ul>
        </div>
      ))}
      {open && <TemplateDetailSheet item={open} onClose={() => setOpen(null)} navigate={navigate} busy={busy}
        landNote={landNote} returnFocusTo={openerRef} />}
    </section>
  )
}

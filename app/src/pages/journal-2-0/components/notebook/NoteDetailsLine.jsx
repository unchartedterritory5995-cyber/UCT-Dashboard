// app/src/pages/journal-2-0/components/notebook/NoteDetailsLine.jsx
//
// The note's details, folded into ONE quiet line under the title (owner ask, 2026-10-10:
// "easy and simple to use but has tons of cool stuff"). Before this, a real note stacked
// subtitle, tags, evidence, four property rows, a review line and a changelog between the
// title and the body, and the first body line sat ~300 px down the page.
//
// It READS like metadata: `#thesis · NVDA · Technology · 4 properties · Not reviewed`, then a
// `Details` toggle. Only the parts that have a value are said; a note with nothing set shows
// just a quiet `Add details`. The toggle is a real button that names what it controls
// (`aria-controls`) and says whether it is open (`aria-expanded`); the controls it reveals are
// the editor's own, unchanged, kept MOUNTED while hidden (NoteEditorPage owns that region).
//
// Pure presentation: the editor computes `items` from data it already reads. A summary item is
// `{ key, text, kind }`, where `kind` only picks a tone ('tag' | 'ticker' | 'meta' | 'status').
import { REGISTRY_TOUR_OPEN_EVENT, REGISTRY_TOUR_CLOSED_EVENT } from './onboarding/tourRegistryControl'
import styles from './NoteDetailsLine.module.css'

// ⛔ A WALKTHROUGH MUST BE ABLE TO SEE WHAT IT POINTS AT. The formulas tour points at
// PropertiesSection's "Add property", which now sits in the collapsed details region; the tour
// engine counts an anchor under `[hidden]` as absent and would say it could not open. So while
// a registered tour is running, the editor reveals the details for that visit (never saved).
// The latch lives at MODULE scope because a tour usually opens BEFORE the note does (its start
// navigates to a note), and this module loads with the Notebook tab, ahead of both.
// ⚠️ A tour started from Help's Replay link arrives through router state, which fires no event;
// that path is not seen here (it needs the gate to announce it).
let registryTourRunning = false
if (typeof window !== 'undefined') {
  window.addEventListener(REGISTRY_TOUR_OPEN_EVENT, () => { registryTourRunning = true })
  window.addEventListener(REGISTRY_TOUR_CLOSED_EVENT, () => { registryTourRunning = false })
}
/** Whether a registered tour was asked to open and has not closed yet. */
export function registeredTourRunning() {
  return registryTourRunning
}

/** The editor's details preference, per browser. Every read and write is guarded: private
 *  windows, blocked site data and previews can throw, and the page must render without it. */
export const NOTE_DETAILS_PREF_KEY = 'uct.notebook.noteDetails.open'

export function readNoteDetailsOpen() {
  try {
    return window.localStorage.getItem(NOTE_DETAILS_PREF_KEY) === '1'
  } catch {
    return false
  }
}

export function writeNoteDetailsOpen(open) {
  try {
    window.localStorage.setItem(NOTE_DETAILS_PREF_KEY, open ? '1' : '0')
  } catch {
    // no storage: the choice lasts this visit only
  }
}

const TONE = { tag: 'itemTag', ticker: 'itemTicker', status: 'itemStatus', meta: 'itemMeta' }

export default function NoteDetailsLine({ items = [], open, onToggle, controls, buttonRef = null }) {
  const has = items.length > 0
  return (
    <div className={styles.line} data-export-exclude data-note-details-line="">
      {has && (
        // Read as one phrase. The separators are decoration, so a screen reader hears
        // "thesis, NVDA, Technology" rather than "thesis dot NVDA dot".
        <span className={styles.summary} data-note-details-summary="">
          {items.map((it, i) => (
            <span key={it.key} className={styles.part}>
              {i > 0 && <span className={styles.sep} aria-hidden="true">·</span>}
              <span className={`${styles.item} ${styles[TONE[it.kind] || 'itemMeta']}`}>{it.text}</span>
            </span>
          ))}
        </span>
      )}
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.toggle} ${has ? '' : styles.toggleQuiet}`}
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
        data-note-details-toggle=""
      >
        <svg className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
          width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {has ? 'Details' : 'Add details'}
      </button>
    </div>
  )
}

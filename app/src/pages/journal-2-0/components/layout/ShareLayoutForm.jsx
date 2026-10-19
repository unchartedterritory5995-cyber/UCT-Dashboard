// P4b Task 8: "Share this layout", inside the Customize editor's sheet body (PageLayoutEditor opens it; never a
// second sheet). The SERVER builds what leaves from the member's own SAVED layout for this page (R-P4b-3/4): this
// form only names the item and says, before Submit, what is shared and that an admin reviews it.
// ⛔ The body is exactly {page, title, description, category, tradingStyle} (shareLayout): never a list, never an
//    id or an email, and no note is written.
// ⛔ Lazy-only: PageLayoutEditor.jsx (itself behind PageLayoutEditorSlot's lazy import) is the one importer.
import { useEffect, useId, useRef, useState } from 'react'
import { GALLERY_CATEGORIES } from '../../lib/templateGallery'
import { TRADING_STYLES, shareLayout } from '../../lib/styleLibrary'
// refusalSentence (StyleLibraryCard.jsx) is this same function; it is imported from its own module so the editor's
// chunk does not carry the library card.
import { libraryError as refusalSentence } from '../notebook/styles/styleErrors'
import styles from './PageLayoutEditor.module.css'

export const SHARE_LAYOUT_NOTE = 'An admin reviews it before it is listed. Only which panels show, and their order, are shared.'
export const LAYOUT_SENT_SENTENCE = 'Sent for review. It is listed once an admin approves it.'
// Sharing a page whose layout is ALREADY listed holds the new version for review; the listed one stays (R-P3-3).
export const LAYOUT_REVISION_SENT_SENTENCE = 'Sent for review. The version listed now stays listed until an admin approves this update.'
export const SHARE_LAYOUT_FAILED = "Couldn't share that layout. Nothing was sent."
const DEFAULT_TITLES = { today: 'My Today layout', trade: 'My trade page layout' }
const MAX_TITLE = 80          // template_gallery.MAX_TITLE_CHARS
const MAX_DESCRIPTION = 280   // template_gallery.MAX_DESCRIPTION_CHARS

/** The words after a share: the sent sentence (a first listing, or an update to a listed layout), and how many
 *  panels this build does not know were left out of what was shared (`droppedPanels`, R-P4b-6). */
export function layoutSharedSentence(droppedPanels, { revision = false } = {}) {
  const sent = revision ? LAYOUT_REVISION_SENT_SENTENCE : LAYOUT_SENT_SENTENCE
  const n = Number(droppedPanels) || 0
  if (n <= 0) return sent
  return `${sent} ${n} ${n === 1 ? 'panel' : 'panels'} this version doesn't show ${n === 1 ? 'was' : 'were'} left out.`
}

/**
 * @param page     'today' | 'trade'
 * @param existing the member's shared item for this page (`status.shared[page]`), or null
 * @param onDone   `(sentence) => void` once the server took it
 * @param onCancel Cancel, or the sheet's own close
 */
export default function ShareLayoutForm({ page, existing, onDone, onCancel }) {
  const uid = useId()
  const [title, setTitle] = useState(DEFAULT_TITLES[page] || DEFAULT_TITLES.trade)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [tradingStyle, setTradingStyle] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(null)
  const titleRef = useRef(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (working || !title.trim() || !category) return
    setWorking(true)
    setError(null)
    try {
      const out = await shareLayout({ page, title, description, category, tradingStyle })
      // The server's answer says whether this share was held as an update to a listed layout; only an answer with no
      // summary falls back to what the status said before Submit.
      const revision = out?.template ? out.template.hasRevision === true : existing?.status === 'approved'
      onDone?.(layoutSharedSentence(out?.droppedPanels, { revision }))
    } catch (err) {
      setError(refusalSentence(err, SHARE_LAYOUT_FAILED))
      setWorking(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-label="Share this layout">
      <div className={styles.field}>
        <label htmlFor={`${uid}-title`}>Title in the library</label>
        <input id={`${uid}-title`} ref={titleRef} type="text" value={title} maxLength={MAX_TITLE} required
          onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor={`${uid}-desc`}>What it's for (optional)</label>
        <textarea id={`${uid}-desc`} rows={3} maxLength={MAX_DESCRIPTION} value={description}
          onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor={`${uid}-cat`}>Category</label>
        <select id={`${uid}-cat`} value={category} required onChange={(e) => setCategory(e.target.value)}>
          <option value="">Choose a category</option>
          {GALLERY_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor={`${uid}-ts`}>Trading style (optional)</label>
        <select id={`${uid}-ts`} value={tradingStyle} onChange={(e) => setTradingStyle(e.target.value)}>
          <option value="">No trading style</option>
          {TRADING_STYLES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>
      <p className={styles.hint} id={`${uid}-what`}>{SHARE_LAYOUT_NOTE}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <span className={styles.spacer} />
        <button type="button" className={styles.btn} onClick={onCancel} disabled={working}>Cancel</button>
        <button type="submit" className={`${styles.btn} ${styles.primary}`} aria-describedby={`${uid}-what`}
          disabled={working || !title.trim() || !category}>
          {working ? 'Sending…' : 'Submit'}
        </button>
      </div>
    </form>
  )
}

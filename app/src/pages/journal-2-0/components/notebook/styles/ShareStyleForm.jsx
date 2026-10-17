// P3a Task 10: "Share to community" for one of the member's own styles (StylesManager opens it).
// The SERVER builds what leaves (template_gallery.style_payload: a built-in kind only, the outline inlined,
// known blocks, built-in property defaults); this form only names the item and says, before Submit, what
// will happen. A submission waits for an admin before anyone else can see it.
// ⛔ Lazy-only: StylesManager's own chunk imports this, nothing eager does (R-P3-5).
// ⛔ An author is only the opaque handle the server assigns; nothing here sends an id or an email beyond the
//    member's own style id (shareStyle's body is exactly {styleId, title, description, category, tradingStyle}).
// ⛔ P3a-T4-m6: a style whose outline points at a template the member deleted is shared WITHOUT an outline.
//    The server does that silently, so this form says it first (OUTLINE_GONE_SENTENCE).
import { useEffect, useId, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import { GALLERY_CATEGORIES } from '../../../lib/templateGallery'
import { TRADING_STYLES, shareStyle } from '../../../lib/styleLibrary'
import { getJournalStyle } from '../../../lib/journalStyles'
import { useMemberTemplates } from '../../../lib/memberTemplates'
import { libraryError } from './styleErrors'
import styles from './StylesManager.module.css'

export const SHARE_NOTE = 'An admin reviews it before it is listed. Your own property defaults are not shared.'
export const SENT_SENTENCE = 'Sent for review. It is listed once an admin approves it.'
export const OUTLINE_GONE_SENTENCE = 'This style’s outline came from a template you deleted, so it will be shared without an outline.'
const FAILED_SENTENCE = "Couldn't share that style. Nothing was sent."
const MAX_TITLE = 80          // template_gallery.MAX_TITLE_CHARS
const MAX_DESCRIPTION = 280   // template_gallery.MAX_DESCRIPTION_CHARS

/** The words after a share: the sent sentence, and how many of the member's own defaults stayed home. */
export function sharedSentence(droppedProperties) {
  const n = Number(droppedProperties) || 0
  if (n <= 0) return SENT_SENTENCE
  return `${SENT_SENTENCE} ${n} of your own property defaults ${n === 1 ? 'was' : 'were'} left out.`
}

/** True when the outline the server would share comes from a template that no longer exists. Unknown (the
 *  style or the templates could not be read) is never "gone": the line is a warning, not a guess. */
function outlineGone(full, templates) {
  if (!full || !templates) return false
  if (full.outlineBodyJson?.content?.length) return false          // the server shares the style's own outline first
  return Boolean(full.outlineTemplateId) && !templates.some((t) => t.id === full.outlineTemplateId)
}

/**
 * @param style    the member's style row (from the journal styles list)
 * @param onShared `(droppedProperties) => void` after the server took it
 * @param onClose  Cancel, Escape, or the Sheet's own close
 */
export default function ShareStyleForm({ style, onShared, onClose }) {
  const uid = useId()
  const [title, setTitle] = useState(style?.name || '')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [tradingStyle, setTradingStyle] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(null)
  const [full, setFull] = useState(null)               // the style with its outline, for the deleted-template check
  const { templates, isLoading: templatesLoading, error: templatesError } = useMemberTemplates({ enabled: Boolean(style?.outlineTemplateId) })

  useEffect(() => {
    if (!style?.outlineTemplateId) return undefined
    let live = true
    getJournalStyle(style.id).then(
      (out) => { if (live) setFull(out?.style || null) },
      () => { if (live) setFull(null) },          // unknown: no warning (the share itself still answers for itself)
    )
    return () => { live = false }
  }, [style?.id, style?.outlineTemplateId])

  const gone = outlineGone(full, templatesLoading || templatesError ? null : templates)

  const submit = async (e) => {
    e.preventDefault()
    if (working || !title.trim() || !category) return
    setWorking(true)
    setError(null)
    try {
      const out = await shareStyle({ styleId: style.id, title, description, category, tradingStyle })
      onShared?.(out?.droppedProperties)
    } catch (err) {
      setError(libraryError(err, FAILED_SENTENCE))
      setWorking(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Share ${style?.name || 'this style'} to community`} labelledByTitle variant="auto" maxWidth={560}>
      <form className={styles.editor} onSubmit={submit} aria-label={`Share ${style?.name || 'this style'} to community`}>
        <div className={styles.field}>
          <label htmlFor={`${uid}-title`}>Title in the library</label>
          <input id={`${uid}-title`} type="text" value={title} maxLength={MAX_TITLE} required onChange={(e) => setTitle(e.target.value)} />
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
        <p className={styles.hint} id={`${uid}-what`}>{SHARE_NOTE}</p>
        {gone && <p className={styles.notice}>{OUTLINE_GONE_SENTENCE}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.btn} aria-describedby={`${uid}-what`}
            disabled={working || !title.trim() || !category}>
            {working ? 'Sending…' : 'Submit'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

// P3a Task 9: one community STYLE item in the library (TemplateGallery.jsx renders it for every item
// whose itemType is 'style'; AuthorView.jsx too). Lazy-only: it is imported by TemplateGallery.jsx
// alone, which is itself a lazy chunk (TemplatePicker.jsx), so none of this is in the first open.
//
// The card's controls are SIBLINGS (never a button in a button): Preview, Adopt, Helpful, Report, and
// the author's name as its own button when the author has a handle.
//   * Adopt opens an inline confirm: "Notify me when the author updates" (off by default), then Adopt
//     and Cancel. The copy is the member's own style row; the server makes it (adoptStyle).
//   * Helpful is a toggle (aria-pressed). It is not offered on your own item (the server refuses it too).
// ⛔ An author is only ever the opaque `authorHandle` (R-P3-2); nothing here sees an id or an email.
// ⛔ Every failure is a sentence on screen; a server refusal shows the server's fixed sentence, and a
// missing item or an outage a fixed sentence of our own. Nothing fails silently.
import { useId, useRef, useState } from 'react'
import { adoptStyle, markHelpful, tradingStyleLabel } from '../../lib/styleLibrary'
import { categoryLabel } from '../../lib/templateGallery'
import { ReportForm, PreviewLines } from './TemplateGallery'
import UIcon from '../../../../components/ui/UIcon'
import styles from './TemplateGallery.module.css'

/** The server's own sentence for a refusal it explains (400 / 402 / 409 / 429); otherwise ours. A 404's
 *  "Not found" and a 5xx say nothing a member can act on. */
export function refusalSentence(err, fallback) {
  const s = err?.status
  const spoken = s === 400 || s === 402 || s === 409 || s === 429
  return spoken && err?.message ? err.message : fallback
}

const withStop = (s) => (/[.!?]$/.test(s) ? s : `${s}.`)

export default function StyleLibraryCard({ item, onPreview, onAdopted, onOpenAuthor, onMessage, busy = false }) {
  const uid = useId()
  const [confirming, setConfirming] = useState(false)
  const [notify, setNotify] = useState(false)
  const [adopting, setAdopting] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [helped, setHelped] = useState(Boolean(item.helpedByMe))
  const [helpfulCount, setHelpfulCount] = useState(Number(item.helpfulCount) || 0)
  const [voting, setVoting] = useState(false)
  const adoptBtnRef = useRef(null)
  const reportBtnRef = useRef(null)
  const ts = tradingStyleLabel(item.tradingStyle)

  const closeConfirm = () => { setConfirming(false); setNotify(false); adoptBtnRef.current?.focus() }
  const closeReport = () => { setReporting(false); reportBtnRef.current?.focus() }

  const adopt = async () => {
    if (adopting) return
    setAdopting(true)
    try {
      const out = await adoptStyle(item.id, { notify })
      const name = out?.style?.name || item.title
      const credit = typeof out?.credit === 'string' && out.credit.trim() ? ` ${withStop(out.credit.trim())}` : ''
      onMessage?.({ tone: 'ok', text: `Added "${name}" to your styles.${credit}` })
      setConfirming(false)
      setNotify(false)
      onAdopted?.(out?.style)
    } catch (err) {
      onMessage?.({ tone: 'error', text: refusalSentence(err, `Couldn't add "${item.title}" to your styles. Nothing was changed.`) })
    } finally {
      setAdopting(false)
    }
  }

  const toggleHelpful = async () => {
    if (voting) return
    setVoting(true)
    try {
      const out = await markHelpful(item.id, !helped)
      setHelped(Boolean(out?.helpful))
      setHelpfulCount(Number(out?.count) || 0)
    } catch (err) {
      onMessage?.({ tone: 'error', text: refusalSentence(err, `Couldn't record that for "${item.title}". Nothing was changed.`) })
    } finally {
      setVoting(false)
    }
  }

  return (
    <li className={styles.card} data-gallery-card="" data-gallery-id={item.id} data-library-style="">
      <div className={styles.cardHead}>
        <h4 className={styles.cardTitle} id={`${uid}-title`}>{item.title}</h4>
        <span className={styles.meta}>
          {item.firm ? <span className={styles.firmBadge}>UCT</span> : item.authorHandle && onOpenAuthor ? (
            <button type="button" className={styles.authorBtn} data-author-door={item.authorHandle}
              onClick={() => onOpenAuthor(item.authorHandle)} aria-label={`See styles by ${item.author}`}>
              {item.author}
            </button>
          ) : <>by {item.author}</>}
          {' · '}{ts || categoryLabel(item.category)}
        </span>
        <span className={styles.meta}>
          Adopted by {Number(item.usedBy) || 0}{' · '}
          <span data-helpful-count="">{helpfulCount} found this helpful</span>
        </span>
      </div>
      {item.description && <p className={styles.cardDesc}>{item.description}</p>}
      <PreviewLines lines={item.preview} />
      <div className={styles.actions} role="group" aria-labelledby={`${uid}-title`}>
        <button type="button" className={styles.btn} onClick={() => onPreview?.(item)} disabled={busy}
          aria-label={`Preview ${item.title}`}>
          <UIcon name="eye" size={13} gold={false} /> Preview
        </button>
        {!item.mine && (
          <button type="button" ref={adoptBtnRef} className={`${styles.btn} ${styles.primary}`}
            onClick={() => (confirming ? closeConfirm() : setConfirming(true))} disabled={busy}
            aria-expanded={confirming} aria-label={`Adopt ${item.title}`}>
            Adopt
          </button>
        )}
        {!item.mine && (
          <button type="button" className={styles.btn} onClick={toggleHelpful} disabled={voting}
            aria-pressed={helped} aria-label={`Helpful: ${item.title}`}>
            <UIcon name="thumbsUp" size={13} gold={false} /> Helpful
          </button>
        )}
        {!item.mine && (
          <button type="button" ref={reportBtnRef} className={styles.btn} onClick={() => setReporting((v) => !v)}
            aria-expanded={reporting} aria-label={`Report ${item.title}`}>
            Report
          </button>
        )}
      </div>
      {confirming && (
        <div className={styles.confirm} role="group" aria-label={`Adopt ${item.title}?`}>
          <label className={styles.check} htmlFor={`${uid}-notify`}>
            <input id={`${uid}-notify`} type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <span>Notify me when the author updates</span>
          </label>
          <div className={styles.actions}>
            <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={adopt} disabled={adopting || busy}>
              Adopt
            </button>
            <button type="button" className={styles.btn} onClick={closeConfirm}>Cancel</button>
          </div>
        </div>
      )}
      {reporting && (
        <ReportForm
          item={item}
          onCancel={closeReport}
          onDone={(text) => { closeReport(); onMessage?.({ tone: 'ok', text }) }}
        />
      )}
    </li>
  )
}

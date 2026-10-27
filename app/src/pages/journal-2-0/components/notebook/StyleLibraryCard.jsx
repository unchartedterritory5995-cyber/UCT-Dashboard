// P3a Task 9: one community STYLE item in the library (TemplateGallery.jsx renders it for every item
// whose itemType is 'style'; AuthorView.jsx too). Lazy-only: it is imported by TemplateGallery.jsx
// alone, which is itself a lazy chunk (TemplatePicker.jsx), so none of this is in the first open.
//
// The card's controls are SIBLINGS (never a button in a button): Preview, Adopt, Helpful, Report, and
// the author's name as its own button when the author has a handle. An admin also gets Feature/Unfeature
// and Hide (GalleryAdminActions, the one copy GalleryCard renders too; P5 fix round 1).
//   * Adopt opens an inline confirm: "Notify me when the author updates" (off by default), then Adopt
//     and Cancel. The copy is the member's own style row; the server makes it (adoptStyle).
//   * Helpful is a toggle (aria-pressed). It is not offered on your own item (the server refuses it too).
// ⛔ An author is only ever the opaque `authorHandle` (R-P3-2); nothing here sees an id or an email.
// ⛔ Every failure is a sentence on screen; a server refusal shows the server's fixed sentence, and a
// missing item or an outage a fixed sentence of our own. Nothing fails silently.
import { useId, useRef, useState } from 'react'
import { adoptStyle, tradingStyleLabel } from '../../lib/styleLibrary'
import { categoryLabel, getGalleryTemplate } from '../../lib/templateGallery'
import { NOTEBOOK_EVENTS, trackNotebookEvent } from '../../lib/notebookTelemetry'
import { ReportForm, PreviewLines } from './TemplateGallery'
import UIcon from '../../../../components/ui/UIcon'
import { libraryError } from './styles/styleErrors'
import GalleryAdminActions from './GalleryAdminActions'
import { useHelpfulToggle, withStop } from './useHelpfulToggle'
import styles from './TemplateGallery.module.css'
// Notebook widgets wave 11 (Task 11.16): the library facts block, only while wave 11 is on.
import { doorLostSentence, widgetsWaveOn } from '../../lib/notebookWidgetsFlags'
import { slotFamily } from '../../lib/templateSlots'
import LibraryCardFacts from './library/LibraryCardFacts'

const listedBlocks = (listing) => {
  const blocks = listing?.payload?.blocks ?? listing?.blocks
  return Array.isArray(blocks) ? blocks : null
}

/** Ruling W11-R25: does a listed style hold a widget, routine or tracker slot? The listing's own blocks decide
 *  (`templateSlots.slotFamily`, the one family test); a listing whose blocks are unknown holds none. */
export function holdsFamilySlot(listing) {
  const blocks = listedBlocks(listing)
  return Boolean(blocks) && blocks.some((b) => slotFamily(b !== null && typeof b === 'object' ? b.block : b) !== null)
}

/** The server's own sentence for a refusal it explains (400 / 402 / 409 / 429); otherwise ours. A 404's
 *  "Not found" and a 5xx say nothing a member can act on. ⛔ ONE rule, `libraryError`'s (final review M-7):
 *  this was a second copy of it without its guard, so a body-less 429 ("request failed (429)", a proxy's own
 *  page) reached a member's card as written. */
export function refusalSentence(err, fallback) {
  return libraryError(err, fallback)
}


export default function StyleLibraryCard({ item, onPreview, onAdopted, onOpenAuthor, onMessage, onChanged, isAdmin = false, busy = false }) {
  const uid = useId()
  const [confirming, setConfirming] = useState(false)
  const [notify, setNotify] = useState(false)
  const [adopting, setAdopting] = useState(false)
  const [reporting, setReporting] = useState(false)
  // Helpful, re-seeded from the server when the item changes (review M-6): one shared copy (P4b review M-1).
  // Wave 11 (Task 11.18): `daysNote` is the 3-day rule's refusal, said under the Helpful button (W11-R8).
  const { helped, helpfulCount, voting, toggleHelpful, daysNote } = useHelpfulToggle(item, onMessage)
  const adoptBtnRef = useRef(null)
  const reportBtnRef = useRef(null)
  const ts = tradingStyleLabel(item.tradingStyle)
  // Wave 11 (Task 11.16): the facts block replaces "Adopted by N" (a 0 read "Adopted by 0"; now "New"), the helpful
  // line (shown from 1 up) and the description. Wave 11 off: exactly as before.
  const w11 = widgetsWaveOn(11)
  // Ruling W11-R25: under wave 11, Adopt on a style that holds a family slot opens the adoption sheet (its choices and
  // its preview with the member's data); a style without one keeps today's confirm and `adoptStyle`. The summary
  // carries no blocks, so the listing is read once (`GET /{id}`, the same read the Preview makes).
  const [checking, setChecking] = useState(false)
  const startAdopt = async () => {
    if (confirming) { closeConfirm(); return }
    if (!w11) { setConfirming(true); return }
    if (checking) return
    setChecking(true)
    let listing = listedBlocks(item) ? item : null
    if (!listing) {
      try { listing = await getGalleryTemplate(item.id) } catch { listing = null }
    }
    setChecking(false)
    if (!holdsFamilySlot(listing)) { setConfirming(true); return }
    try {
      const mod = await import('./library/openAdoptSheet')
      mod.openAdoptSheet({ galleryId: item.id, kind: 'template', mode: 'adopt' })
    } catch {
      onMessage?.({ tone: 'error', text: doorLostSentence() })
    }
  }

  const closeConfirm = () => { setConfirming(false); setNotify(false); adoptBtnRef.current?.focus() }
  const closeReport = () => { setReporting(false); reportBtnRef.current?.focus() }

  const adopt = async () => {
    if (adopting) return
    setAdopting(true)
    try {
      const out = await adoptStyle(item.id, { notify })
      // P3a Task 11: counted only once the server made the copy; the choice, never the item.
      trackNotebookEvent(NOTEBOOK_EVENTS.STYLE_ADOPTED, { notify })
      const name = out?.style?.name || item.title
      const credit = typeof out?.credit === 'string' && out.credit.trim() ? ` ${withStop(out.credit.trim())}` : ''
      onMessage?.({ tone: 'ok', text: `Added "${name}" to your styles.${credit}` })
      // The confirm (and the Adopt button that had focus) goes away: focus returns to the card's own
      // Adopt button, as Cancel does, never to the page (review M-1).
      closeConfirm()
      onAdopted?.(out?.style)
    } catch (err) {
      onMessage?.({ tone: 'error', text: refusalSentence(err, `Couldn't add "${item.title}" to your styles. Nothing was changed.`) })
    } finally {
      setAdopting(false)
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
        {!w11 && (
          <span className={styles.meta}>
            Adopted by {Number(item.usedBy) || 0}{' · '}
            <span data-helpful-count="">{helpfulCount} found this helpful</span>
          </span>
        )}
      </div>
      {w11 ? <LibraryCardFacts item={item} helpfulCount={helpfulCount} />
        : item.description && <p className={styles.cardDesc}>{item.description}</p>}
      <PreviewLines lines={item.preview} />
      <div className={styles.actions} role="group" aria-labelledby={`${uid}-title`}>
        <button type="button" className={styles.btn} onClick={() => onPreview?.(item)} disabled={busy}
          aria-label={`Preview ${item.title}`}>
          <UIcon name="eye" size={13} gold={false} /> Preview
        </button>
        {!item.mine && (
          <button type="button" ref={adoptBtnRef} className={`${styles.btn} ${styles.primary}`}
            onClick={startAdopt} disabled={busy || checking}
            aria-expanded={confirming} aria-label={`Adopt ${item.title}`} data-tour="library-adopt">
            Adopt
          </button>
        )}
        {!item.mine && (
          <button type="button" className={styles.btn} onClick={toggleHelpful} disabled={voting}
            aria-pressed={helped} aria-label={`Helpful: ${item.title}`}
            aria-describedby={daysNote ? `${uid}-helpful-days` : undefined}>
            <UIcon name="thumbsUp" size={13} gold={false} /> Helpful
          </button>
        )}
        {!item.mine && (
          <button type="button" ref={reportBtnRef} className={styles.btn} onClick={() => setReporting((v) => !v)}
            aria-expanded={reporting} aria-label={`Report ${item.title}`}>
            Report
          </button>
        )}
        {isAdmin && <GalleryAdminActions item={item} onChanged={onChanged} onMessage={onMessage} />}
      </div>
      {/* The 3-day sentence's live region exists before its text (fix round 1, M-3), so the change is announced. */}
      <p className={daysNote ? styles.note : styles.liveIdle} id={`${uid}-helpful-days`} role="status" data-helpful-days="">{daysNote}</p>
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

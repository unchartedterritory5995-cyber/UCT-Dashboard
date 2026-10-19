// P4b Task 7: one shared PAGE LAYOUT in the community library (LibraryCard.jsx renders it for every `page_layout`
// item, and only while the list answer says `capabilities.layoutSharing`). Lazy-only, inside the gallery chunk.
//
// The card's controls are SIBLINGS (never a button in a button): Preview, Use this layout, Helpful, Report, and the
// author's name as its own button when the author has a handle.
//   * Preview opens LayoutPreviewSheet: the shared lists beside the member's own, by panel label.
//   * Use this layout reads the item in full (its listed `payload` and `version`), then opens AdoptLayoutSheet, the
//     confirm that shows what changes. A layout whose `payload` is null cannot be used: it says the server's
//     sentence and opens nothing (P4b-T6b-R1).
//   * Helpful is a toggle (aria-pressed), not offered on your own item.
// ⛔ The sheets are the card's; the message they leave (the success line and its Undo) goes to the gallery's own
//    message host, which outlives this card and both sheets (F19).
// ⛔ An author is only ever the opaque `authorHandle` (R-P3-2).
import { useId, useRef, useState } from 'react'
import { LAYOUT_UNSUPPORTED_SENTENCE, tradingStyleLabel } from '../../lib/styleLibrary'
import { categoryLabel, getGalleryTemplate } from '../../lib/templateGallery'
import { ReportForm } from './TemplateGallery'
import { refusalSentence } from './StyleLibraryCard'
import { useHelpfulToggle } from './useHelpfulToggle'
import LayoutPreviewSheet from './LayoutPreviewSheet'
import AdoptLayoutSheet from './AdoptLayoutSheet'
import UIcon from '../../../../components/ui/UIcon'
import styles from './TemplateGallery.module.css'

export const PAGE_BADGES = Object.freeze({ today: 'Today', trade: 'Trade page' })

export default function LayoutLibraryCard({ item, onMessage, onOpenAuthor, busy = false }) {
  const uid = useId()
  const [previewing, setPreviewing] = useState(false)
  const [adopting, setAdopting] = useState(null)          // { version, layout } while the confirm is open
  const [loadingUse, setLoadingUse] = useState(false)
  const [reporting, setReporting] = useState(false)
  const { helped, helpfulCount, voting, toggleHelpful } = useHelpfulToggle(item, onMessage)
  const reportBtnRef = useRef(null)
  const ts = tradingStyleLabel(item.tradingStyle)
  const badge = PAGE_BADGES[item.layoutPage] || null

  const closeReport = () => { setReporting(false); reportBtnRef.current?.focus() }

  // The confirm needs the LISTED payload and version, which only the single read carries.
  const openAdopt = (full) => {
    if (!full || full.payload == null) {
      onMessage?.({ tone: 'error', text: LAYOUT_UNSUPPORTED_SENTENCE })
      return
    }
    setAdopting({ version: full.version, layout: full.payload })
  }
  const use = async () => {
    if (loadingUse) return
    setLoadingUse(true)
    try {
      openAdopt(await getGalleryTemplate(item.id))
    } catch (err) {
      onMessage?.({ tone: 'error', text: refusalSentence(err, "Couldn't load this layout. Nothing was changed.") })
    } finally {
      setLoadingUse(false)
    }
  }

  return (
    <li className={styles.card} data-gallery-card="" data-gallery-id={item.id} data-library-layout="">
      <div className={styles.cardHead}>
        <h4 className={styles.cardTitle} id={`${uid}-title`}>{item.title}</h4>
        <span className={styles.meta}>
          {item.firm ? <span className={styles.firmBadge}>UCT</span> : item.authorHandle && onOpenAuthor ? (
            <button type="button" className={styles.authorBtn} data-author-door={item.authorHandle}
              onClick={() => onOpenAuthor(item.authorHandle)} aria-label={`See what ${item.author} shared`}>
              {item.author}
            </button>
          ) : <>by {item.author}</>}
          {' · '}{ts || categoryLabel(item.category)}
        </span>
        <span className={styles.meta}>
          {badge && <span className={styles.pageBadge} data-layout-page={item.layoutPage}>{badge}</span>}
          {badge && ' · '}Used by {Number(item.usedBy) || 0}{' · '}
          <span data-helpful-count="">{helpfulCount} found this helpful</span>
        </span>
      </div>
      {item.description && <p className={styles.cardDesc}>{item.description}</p>}
      <div className={styles.actions} role="group" aria-labelledby={`${uid}-title`}>
        <button type="button" className={styles.btn} onClick={() => setPreviewing(true)} disabled={busy}
          aria-label={`Preview ${item.title}`}>
          <UIcon name="eye" size={13} gold={false} /> Preview
        </button>
        <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={use} disabled={busy || loadingUse}
          aria-label={`Use this layout: ${item.title}`}>
          Use this layout
        </button>
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
      {reporting && (
        <ReportForm
          item={item}
          onCancel={closeReport}
          onDone={(text) => { closeReport(); onMessage?.({ tone: 'ok', text }) }}
        />
      )}
      {previewing && (
        <LayoutPreviewSheet
          item={item}
          onClose={() => setPreviewing(false)}
          onUse={(full) => { setPreviewing(false); openAdopt(full) }}
        />
      )}
      {adopting && (
        <AdoptLayoutSheet
          item={item}
          version={adopting.version}
          layout={adopting.layout}
          onClose={() => setAdopting(null)}
          onMessage={onMessage}
        />
      )}
    </li>
  )
}

// P4b Task 7: a shared PAGE LAYOUT's Preview (LayoutLibraryCard.jsx opens it). READ-ONLY: it writes nothing.
//
// It reads the item in full (`getGalleryTemplate`: the LISTED payload, exactly what adopting applies, P4b-T6-R1)
// and the member's own layout, then shows two lists side by side, `Shared` and `Yours now`, of panel labels with
// `Shown` / `Hidden`. `Shared` is the shared lists applied to the member's layout (`applySharedPage`), so a panel
// the shared list leaves out reads Hidden, as adopting would leave it. For Today a phase tab row picks the phase
// (real buttons with aria-pressed, the Customize editor's pattern); a phase the layout has no list for says so.
// ⛔ A layout whose payload is null cannot be used: the server's sentence, no "Use this layout", and payload.lists
//    is never read (P4b-T6b-R1).
// ⛔ Tab order: the phase tabs, the lists, then the actions (the Sheet's footer).
import { useEffect, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import usePreferences from '../../../../hooks/usePreferences'
import { getGalleryTemplate } from '../../lib/templateGallery'
import { LAYOUT_UNSUPPORTED_SENTENCE } from '../../lib/styleLibrary'
import { LAYOUT_PREF, PHASES, PHASE_LABELS, applySharedPage, normalizeLayout, resolvePanels } from '../../lib/pageLayouts'
import { refusalSentence } from './StyleLibraryCard'
import styles from './TemplateGallery.module.css'

function PanelList({ title, label, panels }) {
  return (
    <div className={styles.layoutCol}>
      <h5 className={styles.layoutColTitle}>{title}</h5>
      <ul className={styles.layoutList} aria-label={label}>
        {panels.map((p) => (
          <li key={p.id} className={styles.layoutRow} data-shown={p.shown ? 'true' : 'false'}>
            <span>{p.label}</span>
            <span className={styles.layoutState}>{p.shown ? 'Shown' : 'Hidden'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function LayoutPreviewSheet({ item, onClose, onUse }) {
  const page = item.layoutPage === 'today' ? 'today' : 'trade'
  const { prefs } = usePreferences()
  const [full, setFull] = useState(null)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState(null)

  useEffect(() => {
    let live = true
    getGalleryTemplate(item.id).then(
      (t) => { if (live) setFull(t || { payload: null }) },
      (err) => { if (live) setError(refusalSentence(err, "Couldn't load this layout.")) },
    )
    return () => { live = false }
  }, [item.id])

  const usable = full && full.payload != null
  const lists = usable && full.payload.lists && typeof full.payload.lists === 'object' ? full.payload.lists : null
  const firstPhase = lists ? (PHASES.find((ph) => ph === 'market' && lists.market) || PHASES.find((ph) => lists[ph]) || 'market') : 'market'
  const shownPhase = page === 'today' ? (phase || firstPhase) : null
  const listName = page === 'trade' ? 'trade' : shownPhase
  const where = page === 'trade' ? 'trade page' : PHASE_LABELS[shownPhase]

  let body
  if (error) body = <p className={styles.error} role="alert">{error}</p>
  else if (!full) body = <p className={styles.note} role="status">Loading this layout…</p>
  else if (!usable || !lists) body = <p className={styles.note} role="status">{LAYOUT_UNSUPPORTED_SENTENCE}</p>
  else {
    const mine = normalizeLayout(prefs?.[LAYOUT_PREF])
    const has = Array.isArray(lists[listName])
    body = (
      <div className={styles.layoutPreview}>
        {page === 'today' && (
          <div className={styles.chipRow} role="group" aria-label="Phase">
            {PHASES.map((ph) => (
              <button key={ph} type="button" aria-pressed={ph === shownPhase}
                className={`${styles.chip} ${ph === shownPhase ? styles.chipActive : ''}`} onClick={() => setPhase(ph)}>
                {PHASE_LABELS[ph]}
              </button>
            ))}
          </div>
        )}
        {has ? (
          <div className={styles.layoutCols}>
            <PanelList title="Shared" label={`Shared, ${where}`}
              panels={resolvePanels(applySharedPage(mine, page, { [listName]: lists[listName] }), page, shownPhase)} />
            <PanelList title="Yours now" label={`Yours now, ${where}`} panels={resolvePanels(mine, page, shownPhase)} />
          </div>
        ) : (
          <p className={styles.note}>This layout doesn&apos;t change {PHASE_LABELS[shownPhase] || 'this page'}.</p>
        )}
      </div>
    )
  }

  const footer = (
    <div className={styles.actions}>
      {usable && lists && (
        <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => onUse?.(full)}>
          Use this layout
        </button>
      )}
      <button type="button" className={styles.btn} onClick={onClose}>Close</button>
    </div>
  )

  return (
    <Sheet open onClose={onClose} title={`Preview: ${item.title}`} footer={footer} maxWidth={560} labelledByTitle>
      {body}
    </Sheet>
  )
}

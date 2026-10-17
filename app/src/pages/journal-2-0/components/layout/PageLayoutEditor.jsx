// P4a -- the Customize editor for Today and the trade page. A Sheet over ONE preference blob
// (`journal_page_layout`): which panels a page shows and in what order. The model is lib/pageLayouts.js (pure
// functions); this file is the screen over it.
//
// ⛔ The editor edits a DRAFT. Nothing is written until Save, and Save replaces only the list(s) the member
//    changed, applied to the FRESHEST stored layout (the updater setPrefMerged hands us), so another tab's
//    save of a list the member did not touch is never undone, and ids this build does not know ride along.
// ⛔ A save is judged by what the hook ANSWERS, never by "it did not throw": `setPrefMerged` resolves
//    `{ ok: false }` on a refused write (a 400, a stale revision) and resolves with nothing when its own POST
//    threw. Only `{ ok: true }` is a save. A failure keeps the sheet open, says so, and re-reads the server's
//    layout into the shared cache, because the hook applies the new value optimistically before it posts and
//    a refused write would otherwise leave the page showing a layout that was never saved.
// ⛔ Reorder works by KEYBOARD (Move up / Move down buttons, the pattern StyleEditor uses); there is no drag.
//    Focus stays on the pressed button, or on the row's other move button when the press just disabled it.
// ⛔ Nothing eager may import this file: it is opened through PageLayoutEditorSlot's lazy import.
import { useEffect, useRef, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import usePreferences, { refreshPreferences } from '../../../../hooks/usePreferences'
import {
  LAYOUT_PREF, PHASES, PHASE_LABELS, normalizeLayout, resolvePanels, movePanel, togglePanel, resetPage,
} from '../../lib/pageLayouts'
import styles from './PageLayoutEditor.module.css'

export const SAVE_FAILED = "Couldn't save your layout. Nothing was changed."
const TITLES = { today: 'Customize Today', trade: 'Customize trade page' }
const PAGE_WORDS = { today: 'Today', trade: 'The trade page' }

// The lists of one page that differ between two normalized layouts: [{ phase, list }] (phase is null for
// the trade page). Compared as JSON, so a toggle that was undone is not an edit.
function changedLists(page, draft, baseline) {
  if (page === 'trade') {
    return JSON.stringify(draft.trade) === JSON.stringify(baseline.trade) ? [] : [{ phase: null, list: draft.trade }]
  }
  return PHASES
    .filter((ph) => JSON.stringify(draft.today[ph]) !== JSON.stringify(baseline.today[ph]))
    .map((ph) => ({ phase: ph, list: draft.today[ph] }))
}

// Those lists put into `layout`, leaving every other list, unknown phase and unknown field as it was.
function withLists(layout, page, edits) {
  let next = layout
  for (const { phase, list } of edits) {
    next = page === 'trade' ? { ...next, trade: list } : { ...next, today: { ...next.today, [phase]: list } }
  }
  return next
}

function Editor({ page, initialPhase, onClose, onSaved, saved, setPrefMerged }) {
  const [baseline] = useState(() => normalizeLayout(saved))
  const [draft, setDraft] = useState(baseline)
  const [phase, setPhase] = useState(PHASES.includes(initialPhase) ? initialPhase : 'market')
  const [moved, setMoved] = useState('')            // what a keyboard change says, for a screen reader
  const [tick, setTick] = useState(0)               // a repeated sentence must still change the live region's text
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const rowRefs = useRef({})
  const pendingFocus = useRef(null)

  const rows = resolvePanels(draft, page, phase)

  // After a keyboard move focus stays on the moved row. The pressed button can have just become disabled (the
  // row reached an end of the list) and React relocates the row's element, so: the pressed button if it
  // still works, else the row's other move button, else the row itself.
  useEffect(() => {
    const pf = pendingFocus.current
    if (!pf) return
    pendingFocus.current = null
    const li = rowRefs.current[pf.id]
    if (!li) return
    const up = li.querySelector('[data-move="up"]')
    const down = li.querySelector('[data-move="down"]')
    const pressed = pf.dir === 'up' ? up : down
    const other = pf.dir === 'up' ? down : up
    const target = (pressed && !pressed.disabled && pressed) || (other && !other.disabled && other) || li
    target.focus()
  })

  const say = (text) => { setMoved(text); setTick((t) => t + 1) }

  const move = (row, dir) => {
    setDraft((d) => movePanel(d, page, phase, row.id, dir))
    say(`${row.label} moved ${dir}`)
    pendingFocus.current = { id: row.id, dir }
  }
  const toggle = (row) => setDraft((d) => togglePanel(d, page, phase, row.id))
  const reset = () => {
    setDraft((d) => resetPage(d, page, phase))
    say(page === 'trade' ? 'The trade page was reset to the default layout.' : `${PHASE_LABELS[phase]} was reset to the default layout.`)
  }

  const save = async () => {
    const edits = changedLists(page, draft, baseline)
    if (!edits.length) { onClose(); return }
    setSaving(true); setError('')
    let ok = false
    try {
      const answer = await setPrefMerged(LAYOUT_PREF, (prev) => withLists(normalizeLayout(prev), page, edits))
      ok = answer?.ok === true
    } catch {
      ok = false
    }
    if (ok) { onSaved?.(); onClose(); return }
    setSaving(false)
    setError(SAVE_FAILED)
    refreshPreferences()
  }

  const tabs = page === 'today' && (
    <div className={styles.tabs}>
      {PHASES.map((ph) => (
        <button key={ph} type="button" className={styles.tab} aria-pressed={ph === phase} onClick={() => setPhase(ph)}>
          {PHASE_LABELS[ph]}
        </button>
      ))}
    </div>
  )

  const footer = (
    <div className={styles.footer}>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={reset} disabled={saving}>Reset to default</button>
        <span className={styles.spacer} />
        <button type="button" className={styles.btn} onClick={onClose}>Cancel</button>
        <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )

  return (
    <Sheet open onClose={onClose} title={TITLES[page]} footer={footer} dismissOnBackdrop={false} maxWidth={520} labelledByTitle>
      <div className={styles.editor}>
        {tabs}
        <p className={styles.hint}>
          {page === 'today'
            ? `Choose which panels Today shows ${phase === 'market' ? 'while the market is open' : phase === 'premarket' ? 'before the open' : 'after the close'}, and in what order.`
            : 'Choose which sections the trade page shows, and in what order.'}
        </p>
        <ol className={styles.rows} aria-label={`${PAGE_WORDS[page]} panels${page === 'today' ? `, ${PHASE_LABELS[phase]}` : ''}`}>
          {rows.map((row, i) => (
            <li
              key={row.id}
              ref={(el) => { if (el) rowRefs.current[row.id] = el; else delete rowRefs.current[row.id] }}
              tabIndex={-1}
              className={styles.row}
            >
              <label className={styles.show}>
                <input type="checkbox" checked={row.shown} aria-label={`Show ${row.label}`} onChange={() => toggle(row)} />
                <span>{row.label}</span>
              </label>
              <span className={styles.moves}>
                <button type="button" className={styles.iconBtn} aria-label={`Move ${row.label} up`} title="Move up" data-move="up"
                  disabled={i === 0} onClick={() => move(row, 'up')}>
                  <UIcon name="chevronUp" size={16} gold={false} />
                </button>
                <button type="button" className={styles.iconBtn} aria-label={`Move ${row.label} down`} title="Move down" data-move="down"
                  disabled={i === rows.length - 1} onClick={() => move(row, 'down')}>
                  <UIcon name="chevronDown" size={16} gold={false} />
                </button>
              </span>
            </li>
          ))}
        </ol>
        <p className={styles.srOnly} role="status" aria-live="polite">{moved}{tick % 2 ? ' ' : ''}</p>
      </div>
    </Sheet>
  )
}

/**
 * @param {{ page: 'today'|'trade', initialPhase?: string, onClose: () => void, onSaved?: () => void }} props
 *   onSaved fires once, when the write was confirmed, just before onClose: the page shows "Layout saved." in
 *   its OWN toast host, which outlives this sheet.
 */
export default function PageLayoutEditor({ page, initialPhase, onClose, onSaved }) {
  const { prefs, setPrefMerged, loading } = usePreferences()
  if (loading) {
    return (
      <Sheet open onClose={onClose} title={TITLES[page]} dismissOnBackdrop={false} maxWidth={520} labelledByTitle>
        <p className={styles.hint} role="status">Loading your layout…</p>
      </Sheet>
    )
  }
  return (
    <Editor
      page={page}
      initialPhase={initialPhase}
      onClose={onClose}
      onSaved={onSaved}
      saved={prefs?.[LAYOUT_PREF]}
      setPrefMerged={setPrefMerged}
    />
  )
}

// P4a -- the Customize editor for Today and the trade page. A Sheet over ONE preference blob
// (`journal_page_layout`): which panels a page shows and in what order. The model is lib/pageLayouts.js (pure
// functions); this file is the screen over it.
//
// ⛔ The editor edits a DRAFT. Nothing is written until Save, and Save replaces only the list(s) the member
//    changed, applied to the layout THIS TAB's preference cache holds at that moment (the updater
//    setPrefMerged hands us). That keeps ids this build does not know, and a list another writer in this tab
//    changed meanwhile. It is NOT the server's latest: the cache is read once per tab (5-minute dedupe, no
//    re-read on focus), so a list saved in another tab or on the phone since this tab read is written back
//    over by this tab's copy of it.
// ⛔ If the preference read failed (`readFailed`: a refused read is served as `{}`), the cache holds no layout
//    at all, and a merge onto it would write the defaults over every list the member did not touch. So the
//    editor says the layout could not be loaded and Save is disabled. Nothing is written.
// ⛔ One Save at a time: a second press while one is in flight sends nothing (`savingRef`, which a press reads
//    before the re-render that disables the button).
// ⛔ A save is judged by what the hook ANSWERS, never by "it did not throw": `setPrefMerged` resolves
//    `{ ok: false }` on a refused write (a 400, a stale revision) and resolves with nothing when its own POST
//    threw. Only `{ ok: true }` is a save. A failure keeps the sheet open, says so, and re-reads the server's
//    layout into the shared cache, because the hook applies the new value optimistically before it posts and
//    a refused write would otherwise leave the page showing a layout that was never saved.
// ⛔ Reorder works by KEYBOARD (Move up / Move down buttons, the pattern StyleEditor uses); there is no drag.
//    Focus stays on the pressed button, or on the row's other move button when the press just disabled it.
// ⛔ Nothing eager may import this file: it is opened through PageLayoutEditorSlot's lazy import.
// P4b Task 8: sharing. The editor reads the member's own shared layouts (useLayoutSharingStatus). While layout
//    sharing is off (a 404) or the read failed, nothing new renders. On an answer it adds, above the footer
//    actions, a status line, "Share this layout" (disabled while the draft differs from the saved layout: the
//    server shares what is SAVED, never this draft), and "Find shared layouts" (the page closes this editor and
//    opens the library). Share opens ShareLayoutForm inside this sheet's body, never a second sheet. The client
//    sends a page name and the form's fields only, never a list, and writes no note.
import { useEffect, useId, useRef, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import usePreferences, { refreshPreferences } from '../../../../hooks/usePreferences'
import {
  LAYOUT_PREF, LOAD_FAILED, PHASES, PHASE_LABELS, normalizeLayout, resolvePanels, movePanel, togglePanel, resetPage,
  replaceLists,
} from '../../lib/pageLayouts'
import { useLayoutSharingStatus } from '../../lib/styleLibrary'
import ShareLayoutForm from './ShareLayoutForm'
import styles from './PageLayoutEditor.module.css'

export const SAVE_FAILED = "Couldn't save your layout. Nothing was changed."
// The sentence lives in lib/pageLayouts.js (P4b X16: the library's adopt confirm says it too); re-exported here.
export { LOAD_FAILED }
const TITLES = { today: 'Customize Today', trade: 'Customize trade page' }
const PAGE_WORDS = { today: 'Today', trade: 'The trade page' }
export const SAVE_FIRST_HINT = 'Save your changes first, then share.'

/** The status line for one page's shared layout (`status.shared[page]`), or '' when it is not shared. */
export function sharingStatusLine(shared) {
  if (!shared || typeof shared !== 'object') return ''
  if (shared.status === 'pending') return 'Shared, waiting for review.'
  if (shared.status === 'approved') {
    return shared.hasRevision ? 'Listed. Your update is waiting for review.' : `Listed. Version ${shared.version}.`
  }
  return ''
}

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

// Those edits as the `{listName: list}` object replaceLists (lib/pageLayouts.js) takes: the trade page's one list
// is named `trade`, a Today list by its phase. replaceLists leaves every other list, unknown phase and unknown
// field as it was.
const asLists = (page, edits) => Object.fromEntries(edits.map(({ phase, list }) => [page === 'trade' ? 'trade' : phase, list]))

function Editor({ page, initialPhase, onClose, onSaved, saved, setPrefMerged, readFailed, onFindLayouts }) {
  const [baseline] = useState(() => normalizeLayout(saved))
  const [draft, setDraft] = useState(baseline)
  const [phase, setPhase] = useState(PHASES.includes(initialPhase) ? initialPhase : 'market')
  const [moved, setMoved] = useState('')            // what a keyboard change says, for a screen reader
  const [tick, setTick] = useState(0)               // a repeated sentence must still change the live region's text
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const rowRefs = useRef({})
  const pendingFocus = useRef(null)
  const savingRef = useRef(false)               // read by the dismiss paths, which can fire between a press and a render
  const uid = useId()
  const [sharing, setSharing] = useState(false)     // ShareLayoutForm in this sheet's body
  const [shareNote, setShareNote] = useState('')    // what the last share said
  const shareBtnRef = useRef(null)
  const { status: sharingStatus, refresh: refreshSharing } = useLayoutSharingStatus()
  // An answer that carries `shared` is the switch on; a 404 (off), an error, or anything else renders nothing new.
  const shareable = Boolean(sharingStatus?.shared && typeof sharingStatus.shared === 'object')
  const existing = shareable ? sharingStatus.shared[page] || null : null

  const rows = resolvePanels(draft, page, phase)
  // F7: the server shares the SAVED layout, so Share waits while the draft differs from it.
  const unsaved = changedLists(page, draft, baseline).length > 0

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

  // ⛔ While a save is in flight NOTHING dismisses the sheet: Cancel is disabled, and Escape, the title bar's close
  //    button and a drag all arrive here (Sheet has no way to block dismissal, so the guard lives in the handler).
  //    Closing mid-save would unmount the editor before it learned whether the write took, losing the failure
  //    line and the member's draft. The save path itself closes through `onClose` directly, once it has an answer.
  const dismiss = () => { if (savingRef.current) return; onClose() }

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
    if (savingRef.current || readFailed) return
    const edits = changedLists(page, draft, baseline)
    if (!edits.length) { onClose(); return }
    setSaving(true); savingRef.current = true; setError('')
    let ok = false
    try {
      const answer = await setPrefMerged(LAYOUT_PREF, (prev) => replaceLists(normalizeLayout(prev), page, asLists(page, edits)))
      ok = answer?.ok === true
    } catch {
      ok = false
    }
    if (ok) { onSaved?.(); onClose(); return }
    savingRef.current = false
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

  const openShare = () => { if (unsaved || savingRef.current) return; setShareNote(''); setSharing(true) }
  const closeShare = () => {
    setSharing(false)
    requestAnimationFrame(() => shareBtnRef.current?.focus())
  }
  const shared = (sentence) => {
    setShareNote(sentence)
    refreshSharing()
    closeShare()
  }

  const statusLine = sharingStatusLine(existing)
  const sharingRow = shareable && (
    <div className={styles.share}>
      {statusLine && <p className={styles.shareStatus} data-layout-share-status="">{statusLine}</p>}
      {shareNote && <p className={styles.shareStatus} role="status">{shareNote}</p>}
      <div className={styles.actions}>
        <button type="button" ref={shareBtnRef} className={styles.btn} onClick={openShare} disabled={unsaved || saving}
          aria-describedby={unsaved ? `${uid}-save-first` : undefined}>
          Share this layout
        </button>
        {onFindLayouts && (
          <button type="button" className={styles.btn} onClick={() => { if (!savingRef.current) onFindLayouts() }} disabled={saving}>
            Find shared layouts
          </button>
        )}
      </div>
      {unsaved && <p className={styles.hint} id={`${uid}-save-first`}>{SAVE_FIRST_HINT}</p>}
    </div>
  )

  const footer = sharing ? null : (
    <div className={styles.footer}>
      {readFailed && <p role="alert" className={styles.error}>{LOAD_FAILED}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {sharingRow}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={reset} disabled={saving}>Reset to default</button>
        <span className={styles.spacer} />
        <button type="button" className={styles.btn} onClick={dismiss} disabled={saving}>Cancel</button>
        <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={save} disabled={saving || readFailed}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )

  return (
    <Sheet open onClose={sharing ? closeShare : dismiss} title={TITLES[page]} footer={footer} dismissOnBackdrop={false} maxWidth={520} labelledByTitle>
      {sharing ? (
        <ShareLayoutForm page={page} existing={existing} onDone={shared} onCancel={closeShare} />
      ) : (
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
      )}
    </Sheet>
  )
}

/**
 * @param {{ page: 'today'|'trade', initialPhase?: string, onClose: () => void, onSaved?: () => void,
 *   onFindLayouts?: () => void }} props
 *   onSaved fires once, when the write was confirmed, just before onClose: the page shows "Layout saved." in
 *   its OWN toast host, which outlives this sheet. onFindLayouts (P4b): the page closes this editor and opens the
 *   shared layouts library; without it there is no "Find shared layouts" button.
 */
export default function PageLayoutEditor({ page, initialPhase, onClose, onSaved, onFindLayouts }) {
  const { prefs, setPrefMerged, loading, readFailed } = usePreferences()
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
      readFailed={readFailed === true}
      onFindLayouts={onFindLayouts}
    />
  )
}

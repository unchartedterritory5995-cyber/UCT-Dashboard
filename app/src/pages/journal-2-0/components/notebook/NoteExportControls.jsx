// The editor's per-note export group: the Export menu, holding PNG, Print and the file formats (wave 8).
//
// Notebook simplify, Task 4: PNG and Print were two buttons beside Export; they are now the menu's first two
// items, above the file formats, so the More panel shows ONE Export entry. Each runs exactly what its button ran,
// and a finished PNG hands focus back to the Export button (the menu closed when it was picked).
//
// Seam S8-3 moved PNG / Print / Markdown here out of NoteEditorPage.jsx unchanged; lane 8C
// (C4, ruling D-C4) turns the Markdown button into an EXPORT menu — Markdown · Web page ·
// JSON · Word — then beside PNG and Print, now below them in the same menu. The editor still
// owns the `columnRef` (the note column PNG rasterizes) and the chrome message line (`onMessage` is its `setChromeMsg`), so every
// sentence lands where it always did, and ONE `exportBusy` guards all five doors.
//
// ⛔ Every format goes through the format route (`noteExportUrl`), Markdown included: the
// SAME builder as the old `/api/j2/notes/{id}/export` (byte-identical content, railed in
// tests/test_notebook_export_router.py), with a file name a non-Latin-1 title survives.
//
// ⛔ A real menu button: `aria-haspopup="menu"` + `aria-expanded`, arrow keys walk the items,
// Home/End jump, Escape closes and hands focus BACK to the button. Items are 44px on the touch
// tier.
//
// ⛔ Wave 10 lane K2 (walk row S2-26): TAB STAYS INSIDE the open menu. It used to close the menu
// and let focus walk on into the note's title; the walk then pressed Escape out there and nothing
// handed focus back. The editor's disclosures now share ONE contract (`lib/useDisclosureFocus.js`,
// the pattern of AskPanel and ContextPopover): focus in on open, Tab kept inside while focus is
// inside, Escape back to the button. So the items are ordinary Tab stops inside the menu (Tab and
// the arrows both walk them) and the ONE trap wraps them.
//
// ⚠️ The buttons borrow NoteEditorPage.module.css's `.chromeBtn` so they render exactly as the
// rest of the toolbar. A rename of that class in the editor's stylesheet reaches them too.
//
// ⛔ Final review M-9: every format is built from the SERVER's copy of the note, so words still
// inside the editor's autosave window (or queued offline) would be missing from the file while
// JSON promises "every note exactly as stored, with nothing left out". The editor's pending
// edits are sent FIRST (`onBeforeExport`, the editor's `sendPendingEdits` -- wave 7's
// Save-as-template precedent), and when words are still unsent nothing is downloaded.
// PNG and Print read the note on screen, so they already carry every word.
//
// ⛔ Final review M-1: the Export button is DISABLED while a file (or a PNG) is made, and a
// disabled button loses focus (the browser moves it to <body>). When the work ends, the
// Export button takes focus back -- unless the member has moved on meanwhile.
//
// Simplify pass 2 (C3): inside the note's More panel (every real mount) the formats are the panel's SECOND VIEW, not a
// popup under the button: "Export" swaps the panel's content for "Back" and the six formats (NoteMoreMenu.jsx `slot`),
// the same behaviour as the menu engine's `children` rows (NewNoteMenu.jsx), held to the same contract by the same
// test kit (lib/testing/menuSecondView.testkit.js). Back, Escape or Left return to the panel with focus on Export; a
// second Escape closes the panel. Alone (no panel around it) the menu still drops down under the button.
// The menu itself (its rows, keys and outside press) is export/NoteExportMenu.jsx, a chunk of its own: it is drawn only
// after a press, so it is fetched once the editor is idle (or at the press) into a module slot (lib/heldModule.js)
// and drawn directly once there. This file keeps the button, the open state and what each item does.
import { useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MORE_NOTE_ACTIONS, MoreMenuOpenContext } from './NoteMoreMenu'
import { NOTEBOOK_DOORS, onNotebookDoor } from '../../lib/notebookDoors'
import UIcon from '../../../../components/ui/UIcon'
import { importWithOneRetry } from '../../lib/lazyChunk'
import { heldModule, pageReload, useHeldModule } from '../../lib/heldModule'
import whenIdle from '../../lib/whenIdle'
// Tier 1a bytes (perf-budgets.md): the PNG and print doors' module is fetched when one is pressed, never on the
// Notebook's first open (the same on-use import exportNote.js already does for modern-screenshot).
const loadExport = () => importWithOneRetry(() => import('../../lib/exportNote'), undefined,
  (m) => typeof m?.exportNoteAsPng === 'function' && typeof m?.printNote === 'function')
import { noteExportUrl, saveResponse } from './export/exportFormats'
import { NOTEBOOK_EVENTS, trackNotebookEvent } from '../../lib/notebookTelemetry'
import editorStyles from './NoteEditorPage.module.css'
import styles from './NoteExportControls.module.css'

async function failureSentence(res) {
  try {
    const body = await res.json()
    if (body?.detail && typeof body.detail === 'string') return body.detail
  } catch {
    // not JSON
  }
  return 'export failed'
}

/** The Export menu's chunk, held once fetched (a rail warms it, or holds it back, through this slot). The loader is a
 *  property, so a rail can fail the fetch (jsdom cannot fail a real chunk), like `editorToolLoaders`. */
export const exportMenuLoader = { load: () => import('./export/NoteExportMenu') }
export const exportMenuModule = heldModule(() => exportMenuLoader.load())

/** Final fix M8: what Export says when its menu's chunk could not be fetched (a stale tab after a deploy, most likely),
 *  beside a Reload the MEMBER presses (never an automatic reload: the pattern of Find and Ask, lib/heldModule.js). */
export const EXPORT_UNAVAILABLE = 'Export could not be loaded. Reload the page to get it back.'
/** Final fix M8: the Export row while a cold press waits for the menu's chunk. */
export const EXPORT_WAITING = 'Export…'

/** M-9: the sentence when the editor still holds words the server has not taken. */
export const UNSENT_BEFORE_EXPORT = "Your latest edits haven't reached the server yet, so the file would miss them. Nothing was downloaded — try again in a moment."

export default function NoteExportControls({ noteId, title, columnRef, onMessage, onBeforeExport = null }) {
  const [exportBusy, setExportBusy] = useState(false)
  // In a More panel the open state is the panel's second view (C3); alone, it is this button's own.
  const more = useContext(MoreMenuOpenContext)
  const [ownOpen, setOwnOpen] = useState(false)
  const menuOpen = more ? more.sub === 'export' : ownOpen
  const setMenuOpen = useCallback((v) => (more ? more.setSub(v ? 'export' : null) : setOwnOpen(v)), [more])
  const menuId = useId()
  const triggerRef = useRef(null)
  const { Component: ExportMenu } = useHeldModule(exportMenuModule)
  // The menu's chunk is asked for once the editor is idle (as the find bar's is), on a hover or focus of Export, and at
  // the press itself; it opens once it is in hand (a fetch that fails says so on the chrome line).
  useEffect(() => whenIdle(exportMenuModule.warm), [])
  const shown = useRef(true)
  shown.current = more ? more.shown : true
  // Final fix M8: a cold press shows at once that it was heard (`waiting`: "Export…", aria-busy) and opens the formats
  // when the chunk lands ONLY if the member is still on the Export row or inside its panel (`force`: the palette's door,
  // an explicit ask from elsewhere). A fetch that failed says so beside Export, with a Reload the member presses.
  const [waiting, setWaiting] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const stillHere = useCallback(() => {
    const active = document.activeElement
    const button = triggerRef.current
    if (!button) return false
    // Focus on nothing (<body>: a click that focuses no button, as Safari's does) is not "moved on", the M-1 rule below.
    if (!active || active === document.body || active === button) return true
    const panel = more ? button.closest(`[role="group"][aria-label="${MORE_NOTE_ACTIONS}"]`) : null
    return Boolean(panel?.contains(active))
  }, [more])
  const openMenu = useCallback(({ force = false } = {}) => {
    setLoadFailed(false)
    if (exportMenuModule.get().Component) return setMenuOpen(true)
    setWaiting(true)
    return exportMenuModule.warm().then((C) => {
      setWaiting(false)
      if (!C) { setLoadFailed(true); return }
      // the panel was closed meanwhile, or the member moved on: nothing opens under them
      if (shown.current && (force || stillHere())) setMenuOpen(true)
    })
  }, [setMenuOpen, stillHere])
  // M-1: the button to hand focus back to once the busy state clears.
  const refocusRef = useRef(null)
  useEffect(() => {
    if (exportBusy || !refocusRef.current) return
    const el = refocusRef.current
    refocusRef.current = null
    const active = document.activeElement
    // only when focus was LOST with the disabled button -- never taken from where the member went
    if (!active || active === document.body || active === el) el.focus()
  }, [exportBusy])

  // Focus goes back to Export once it is on screen again, after the render that closes the menu: in a panel Export is
  // hidden while the formats show, and a hidden button cannot take focus.
  const focusBack = useRef(false)
  const closeMenu = useCallback((returnFocus) => {
    setMenuOpen(false)
    focusBack.current = Boolean(returnFocus)
  }, [setMenuOpen])
  useEffect(() => {
    if (menuOpen || !focusBack.current) return
    focusBack.current = false
    triggerRef.current?.focus()
  }, [menuOpen])

  const savePng = async () => {
    closeMenu(true)
    if (exportBusy) return
    refocusRef.current = triggerRef.current
    setExportBusy(true)
    onMessage('rendering…')
    try {
      // exportNoteAsPng returns { ok, reason? } -- `reason`, when present, is
      // the member-facing sentence for a refused/failed render (too long for
      // one image, or a blob too small to be real content); its absence
      // means an ordinary failure, where this door's own generic message
      // still applies. Read defensively: a mock or a future caller that
      // resolves nothing must not throw on destructuring.
      const { exportNoteAsPng } = await loadExport()
      const result = await exportNoteAsPng(columnRef.current, title)
      const ok = !!result?.ok
      onMessage(ok ? 'PNG saved' : (result?.reason || 'export failed'))
      // Wave 10 (10D, R-16): a note left as a file. The FORMAT only — never its title.
      if (ok) trackNotebookEvent(NOTEBOOK_EVENTS.EXPORT_USED, { format: 'png', scope: 'note', count: 1 })
    } catch {
      onMessage('export failed')
    } finally {
      setExportBusy(false)
    }
  }

  const print = () => {
    closeMenu(true)
    loadExport().then(({ printNote }) => {
      printNote()
      // Print opens the browser's dialog; whether a PDF was saved is not ours to know.
      trackNotebookEvent(NOTEBOOK_EVENTS.EXPORT_USED, { format: 'print', scope: 'note', count: 1 })
    }, () => onMessage('export failed'))
  }

  // Wave C's portable single-note export, now in four formats: a bare fetch + blob
  // download (one note is bounded in size — no multi-minute wait to progress-bar).
  const download = async (format) => {
    closeMenu(true)
    if (exportBusy) return
    refocusRef.current = triggerRef.current
    setExportBusy(true)
    onMessage('preparing…')
    try {
      // M-9: the server builds the file from ITS copy -- send what this editor still holds first.
      if (onBeforeExport && !(await onBeforeExport())) {
        onMessage(UNSENT_BEFORE_EXPORT)
        return
      }
      const res = await fetch(noteExportUrl(noteId, format), { credentials: 'include' })
      if (!res.ok) {
        onMessage(await failureSentence(res))
        return
      }
      await saveResponse(res, 'note')
      onMessage('downloaded')
      trackNotebookEvent(NOTEBOOK_EVENTS.EXPORT_USED, { format, scope: 'note', count: 1 })
    } catch {
      onMessage('export failed')
    } finally {
      setExportBusy(false)
    }
  }

  // Lane KEYS3 (Q12): the command palette's "Export this note". The panel these controls live
  // in opens (it is hidden while closed), then this menu (as soon as its chunk is in hand), and
  // the menu puts focus on the first format. Nothing is exported until the member picks one.
  useEffect(() => onNotebookDoor(NOTEBOOK_DOORS.EXPORT, () => {
    if (exportBusy) return false
    more?.open()
    openMenu({ force: true })
    return true
  }), [more, exportBusy, openMenu])

  const pick = (id) => (id === 'png' ? savePng() : id === 'print' ? print() : download(id))
  const menu = menuOpen && ExportMenu && (
    <ExportMenu id={menuId} inPanel={Boolean(more)} triggerRef={triggerRef} onPick={pick} onClose={closeMenu} />
  )

  return (
    <span className={styles.menuWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={`${editorStyles.chromeBtn} ${styles.trigger}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        aria-busy={waiting || undefined}
        disabled={exportBusy}
        onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
        onPointerEnter={exportMenuModule.warm}
        onFocus={exportMenuModule.warm}
        onKeyDown={(e) => {
          // ArrowDown opens it (the menu button's key); in the More panel the row shows a chevron and opens on Right too,
          // as the menu engine's second-view rows do (final fix M8).
          if (!menuOpen && (e.key === 'ArrowDown' || (more && e.key === 'ArrowRight'))) {
            e.preventDefault()
            e.stopPropagation()
            openMenu()
          }
        }}
        title="Save this note as a PNG image, print it, or download it as Markdown, a web page, JSON or Word"
      >
        {waiting ? EXPORT_WAITING : 'Export'}
        <UIcon name={more ? 'chevronRight' : 'chevronDown'} size={12} gold={false} />
      </button>
      {loadFailed && (
        <span className={styles.loadFailed} role="alert" data-export-load-failed="">
          {EXPORT_UNAVAILABLE}
          <button type="button" className={editorStyles.chromeBtn} onClick={pageReload.run}>Reload</button>
        </span>
      )}
      {/* In a More panel the formats replace the panel's content (its `slot`); alone they drop down here. */}
      {more ? menu && more.slot && createPortal(menu, more.slot) : menu}
    </span>
  )
}

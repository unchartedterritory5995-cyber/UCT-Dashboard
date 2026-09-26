// The editor's per-note export group: PNG, Print, and the Export menu (wave 8).
//
// Seam S8-3 moved PNG / Print / Markdown here out of NoteEditorPage.jsx unchanged; lane 8C
// (C4, ruling D-C4) turns the Markdown button into an EXPORT menu — Markdown · Web page ·
// JSON · Word — beside PNG and Print. The editor still owns the `columnRef` (the note column
// PNG rasterizes) and the chrome message line (`onMessage` is its `setChromeMsg`), so every
// sentence lands where it always did, and ONE `exportBusy` guards all five doors.
//
// ⛔ Every format goes through the format route (`noteExportUrl`), Markdown included: the
// SAME builder as the old `/api/j2/notes/{id}/export` (byte-identical content, railed in
// tests/test_notebook_export_router.py), with a file name a non-Latin-1 title survives.
//
// ⛔ A real menu button: `aria-haspopup="menu"` + `aria-expanded`, arrow keys walk the items,
// Home/End jump, Escape closes and hands focus BACK to the button, Tab closes. Items are 44px
// on the touch tier.
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
// ⛔ Final review M-1: PNG and the Export button are DISABLED while a file is made, and a
// disabled button loses focus (the browser moves it to <body>). When the work ends, the
// button that started it takes focus back -- unless the member has moved on meanwhile.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { exportNoteAsPng, printNote } from '../../lib/exportNote'
import { EXPORT_FORMATS, noteExportUrl, saveResponse } from './export/exportFormats'
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

/** M-9: the sentence when the editor still holds words the server has not taken. */
export const UNSENT_BEFORE_EXPORT = "Your latest edits haven't reached the server yet, so the file would miss them. Nothing was downloaded — try again in a moment."

export default function NoteExportControls({ noteId, title, columnRef, onMessage, onBeforeExport = null }) {
  const [exportBusy, setExportBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()
  const triggerRef = useRef(null)
  const pngRef = useRef(null)
  const menuRef = useRef(null)
  const itemRefs = useRef([])
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

  const savePng = async () => {
    if (exportBusy) return
    refocusRef.current = pngRef.current
    setExportBusy(true)
    onMessage('rendering…')
    try {
      const ok = await exportNoteAsPng(columnRef.current, title)
      onMessage(ok ? 'PNG saved' : 'export failed')
    } catch {
      onMessage('export failed')
    } finally {
      setExportBusy(false)
    }
  }

  const closeMenu = useCallback((returnFocus) => {
    setMenuOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

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
    } catch {
      onMessage('export failed')
    } finally {
      setExportBusy(false)
    }
  }

  // Focus the first item when the menu opens.
  useEffect(() => {
    if (menuOpen) itemRefs.current[0]?.focus()
  }, [menuOpen])

  // A press outside the menu closes it (the trigger toggles on its own).
  useEffect(() => {
    if (!menuOpen) return undefined
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [menuOpen])

  const onMenuKeyDown = (e) => {
    const items = itemRefs.current.filter(Boolean)
    const at = items.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[(at + 1) % items.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      items[(at - 1 + items.length) % items.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      items[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      items[items.length - 1]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeMenu(true)
    } else if (e.key === 'Tab') {
      setMenuOpen(false)
    }
  }

  return (
    <>
      {/* Export: PNG rasterizes the note column (charts included); Print
          rides the browser's Save-as-PDF via the print stylesheet. */}
      <button type="button" ref={pngRef} className={editorStyles.chromeBtn} onClick={savePng} disabled={exportBusy}
        title="Download this note as a PNG image">
        PNG
      </button>
      <button type="button" className={editorStyles.chromeBtn} onClick={printNote}
        title="Print — or Save as PDF from the print dialog">
        Print
      </button>
      <span className={styles.menuWrap}>
        <button
          ref={triggerRef}
          type="button"
          className={`${editorStyles.chromeBtn} ${styles.trigger}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          disabled={exportBusy}
          onClick={() => setMenuOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !menuOpen) {
              e.preventDefault()
              setMenuOpen(true)
            }
          }}
          title="Download this note as Markdown, a web page, JSON or Word"
        >
          Export
          <UIcon name="chevronDown" size={12} gold={false} />
        </button>
        {menuOpen && (
          <div ref={menuRef} id={menuId} role="menu" aria-label="Export this note as"
            className={styles.menu} onKeyDown={onMenuKeyDown}>
            {EXPORT_FORMATS.map((f, i) => (
              <button
                key={f.id}
                ref={(el) => { itemRefs.current[i] = el }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={styles.item}
                aria-label={f.menuLabel}
                aria-describedby={`${menuId}-${f.id}`}
                onClick={() => download(f.id)}
              >
                <span className={styles.itemLabel}>{f.menuLabel}</span>
                <span id={`${menuId}-${f.id}`} className={styles.itemKeeps}>{f.keeps}</span>
              </button>
            ))}
          </div>
        )}
      </span>
    </>
  )
}

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

export default function NoteExportControls({ noteId, title, columnRef, onMessage }) {
  const [exportBusy, setExportBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const itemRefs = useRef([])

  const savePng = async () => {
    if (exportBusy) return
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
    setExportBusy(true)
    onMessage('preparing…')
    try {
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
      <button type="button" className={editorStyles.chromeBtn} onClick={savePng} disabled={exportBusy}
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

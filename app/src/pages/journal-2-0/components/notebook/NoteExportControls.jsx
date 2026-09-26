// The editor's per-note export group: PNG, Print and Markdown (wave 8 seam S8-3).
//
// ⛔ MOVED, NOT CHANGED. Everything below stood inside NoteEditorPage.jsx — the three
// buttons, their titles, the `exportBusy` guard and every `onMessage` sentence — and
// was lifted out so lane 8C can grow this group (HTML / JSON / Word, ruling D-C4)
// without editing the editor, which is lane 8A's file this wave. The editor still owns
// the `columnRef` (the note column PNG rasterizes) and the chrome message line
// (`onMessage` is its `setChromeMsg`), so the sentences land where they always did.
//
// ⚠️ It borrows NoteEditorPage.module.css's `.chromeBtn` so the buttons render exactly as
// before. A rename of that class in the editor's stylesheet reaches these buttons too.
import { useState } from 'react'
import { exportNoteAsPng, printNote } from '../../lib/exportNote'
import styles from './NoteEditorPage.module.css'

export default function NoteExportControls({ noteId, title, columnRef, onMessage }) {
  const [exportBusy, setExportBusy] = useState(false)
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
  // Wave C: portable single-note export (directive §46-58) -- unlike PNG/
  // Print above, this is a round-trippable .md/.zip a member can bring to
  // another app, matching the full-notebook export's own format
  // (build_single_note_export reuses that exact markdown+front-matter code
  // path). A bare fetch+blob download, not the ExportDialog machinery: one
  // note is bounded in size, so there's no multi-minute wait to progress-bar.
  const downloadMarkdown = async () => {
    if (exportBusy) return
    setExportBusy(true)
    onMessage('preparing…')
    try {
      const res = await fetch(`/api/j2/notes/${noteId}/export`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const cd = res.headers.get('content-disposition') || ''
      const m = /filename="([^"]+)"/.exec(cd)
      const filename = m ? m[1] : 'note.md'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      onMessage('downloaded')
    } catch {
      onMessage('export failed')
    } finally {
      setExportBusy(false)
    }
  }
  return (
    <>
      {/* Export: PNG rasterizes the note column (charts included); Print
          rides the browser's Save-as-PDF via the print stylesheet. */}
      <button type="button" className={styles.chromeBtn} onClick={savePng} disabled={exportBusy}
        title="Download this note as a PNG image">
        PNG
      </button>
      <button type="button" className={styles.chromeBtn} onClick={printNote}
        title="Print — or Save as PDF from the print dialog">
        Print
      </button>
      {/* Wave C: portable markdown export -- unlike PNG/Print, this
          round-trips back into this product (or Obsidian/any
          markdown-aware app), matching the full-notebook export's
          own format. */}
      <button type="button" className={styles.chromeBtn} onClick={downloadMarkdown} disabled={exportBusy}
        title="Download this note as portable Markdown — the same format the full notebook export uses">
        Markdown
      </button>
    </>
  )
}

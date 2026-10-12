// Notebook P1: the in-note style surfaces behind ONE lazy import (NoteEditorPage mounts this module while
// journal styles are on). The offer under the title, the previewed sheet, the /style chooser and the
// "updated" confirmation all live here, and so do their state and the finishing of an Apply. The editor
// keeps only what only it can do, handed over as `api`:
//   editor   the editor's ref: /style fires STYLE_EVENT on the editor's own DOM, which bubbles to `document`;
//            only the host whose editor holds the event's target answers (two panes can be open)
//   last     lastSavedRef: the revision the editor is looking at (the base an Apply sends, read AFTER its save)
//   send     sendPendingEdits: flush the member's words and say whether the server holds them all
//   reread   the editor's clean re-read ref (it refuses while the editor holds unsent words)
//   dirty    words typed, or a save pending, since the last landed save
//   adopt    take a server copy of the note into the editor (what a version restore does)
import { useEffect, useRef, useState } from 'react'
import { mutate } from 'swr'
import { invalidateNoteLinkTarget } from '../../../lib/noteLinkTargetsBatch'
import { isNoteListKey } from '../../../hooks/useJ2NoteVersions'
import { STYLE_EVENT } from '../../../lib/journalStylesFlag'
import StyleUpdateBanner from './StyleUpdateBanner'
import StyleUpdateSheet, { StyleChooser } from './StyleUpdateSheet'
import styles from './StyleHost.module.css'

const NOTICE_MS = 8000

/**
 * @param note  the note as the editor holds it (styleId / styleVersion)
 * @param locked  a locked note is never offered an update
 */
export default function StyleHost({ note, noteId, locked, api }) {
  const apiRef = useRef(api)
  useEffect(() => { apiRef.current = api })       // the listener below reads the latest, never a stale, editor
  const [chooser, setChooser] = useState(false)  // /style was pressed in THIS note's editor
  const [sheet, setSheet] = useState(null)       // null, or { styleId } (null styleId = this note's own style's latest)
  const [notice, setNotice] = useState('')       // said politely after an Apply

  useEffect(() => {
    const on = (e) => {
      const ed = apiRef.current.editor.current
      if (ed && !ed.isDestroyed && ed.view.dom.contains(e.target)) setChooser(true)
    }
    document.addEventListener(STYLE_EVENT, on)
    return () => document.removeEventListener(STYLE_EVENT, on)
  }, [])

  useEffect(() => {
    if (!notice) return undefined
    const t = setTimeout(() => setNotice(''), NOTICE_MS)
    return () => clearTimeout(t)
  }, [notice])

  // The write landed (lane B settled its revision inside the sheet). The editor takes the server's copy only
  // if it is still clean: words typed while the write was on the wire stay, and the next save reconciles the
  // added block. Then everything a version restore refreshes is refreshed.
  const finish = (applied, plan) => {
    if (api.dirty()) return false
    api.adopt(applied)
    setSheet(null)
    mutate(`/api/j2/notes/${applied.id}`, { note: applied }, false)
    mutate(`/api/j2/notes/${applied.id}/versions`)
    mutate(isNoteListKey)
    invalidateNoteLinkTarget(applied.id)
    setNotice(plan?.switching
      ? `Switched to ${plan.styleName}.`
      : `Updated to the latest version of ${plan?.styleName || 'your style'}.`)
    return true
  }

  return (
    <>
      <div role="status" className={notice ? styles.notice : styles.none} data-export-exclude>{notice}</div>
      {note?.styleId && !locked && !sheet && (
        <StyleUpdateBanner note={note} onOpen={() => setSheet({ styleId: null })} />
      )}
      {chooser && (
        <StyleChooser open onClose={() => setChooser(false)} onPick={(styleId) => { setChooser(false); setSheet({ styleId }) }} />
      )}
      {sheet && (
        <StyleUpdateSheet
          open
          onClose={() => setSheet(null)}
          noteId={noteId}
          styleId={sheet.styleId}
          baseUpdatedAt={() => api.last.current?.updatedAt}
          waitForSave={api.send}
          refreshBase={async () => (await api.reread.current?.()) !== false}
          onApplied={finish}
        />
      )}
    </>
  )
}

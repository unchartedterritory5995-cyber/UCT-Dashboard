// Notebook P1: the in-note style surfaces behind ONE lazy import (NoteEditorPage fetches this module on demand:
// for a styled note, or once /style was pressed in that editor). The offer under the title, the previewed
// sheet, the /style chooser and the "updated" confirmation all live here, and so do their state and the
// finishing of an Apply. The editor keeps only what only it can do, handed over as `api`:
//   last     lastSavedRef: the revision the editor is looking at (the base an Apply sends, read AFTER its save)
//   send     sendPendingEdits: flush the member's words and say whether the server holds them all
//   reread   the editor's clean re-read ref (it refuses while the editor holds unsent words)
//   dirty    unsentInEditor: what the editor holds that the server does not (an array; empty = clean)
//   adopt    take a server copy of the note into the editor (what a version restore does)
// and `ask`, how many times /style was pressed in THIS editor (the editor listens on its own DOM, so two
// panes never answer each other's /style; the host that was fetched for it opens the chooser).
import { useEffect, useRef, useState } from 'react'
import { mutate } from 'swr'
import { invalidateNoteLinkTarget } from '../../../lib/noteLinkTargetsBatch'
import { isNoteListKey } from '../../../hooks/useJ2NoteVersions'
import { noteIsLocked } from '../../../lib/lockedNote'
import StyleUpdateBanner from './StyleUpdateBanner'
import StyleUpdateSheet, { StyleChooser } from './StyleUpdateSheet'
import styles from './StyleHost.module.css'

const NOTICE_MS = 8000
const SETTLE_POLL_MS = 500
const SETTLE_GIVE_UP_MS = 120000
export const APPLIED_WHILE_TYPING = 'The update was applied. Your newest words are still saving; the note will refresh when they land.'

/**
 * @param note  the note as the editor holds it (styleId / styleVersion); a locked one is never offered an update
 */
export default function StyleHost({ note, ask, api }) {
  const apiRef = useRef(api)
  useEffect(() => { apiRef.current = api })       // timers below read the latest, never a stale, editor
  const [seenAsk, setSeenAsk] = useState(ask)
  const [chooser, setChooser] = useState(ask > 0)  // /style was pressed in THIS note's editor
  if (ask !== seenAsk) { setSeenAsk(ask); setChooser(true) }
  const [sheet, setSheet] = useState(null)       // null, or { styleId } (null styleId = this note's own style's latest)
  const [notice, setNotice] = useState('')       // said politely after an Apply
  const [landed, setLanded] = useState(0)        // an update to this version landed but the editor could not take it yet
  const [settling, setSettling] = useState(false)

  useEffect(() => {
    if (!notice) return undefined
    const t = setTimeout(() => setNotice(''), NOTICE_MS)
    return () => clearTimeout(t)
  }, [notice])

  // The update landed while the editor held newer words: the words stay, and once they have been saved the
  // editor re-reads the note, so a clean editor takes the server copy (a re-read refuses over unsent words).
  useEffect(() => {
    if (!settling) return undefined
    const started = Date.now()
    const t = setInterval(async () => {
      if (apiRef.current.dirty().length && Date.now() - started < SETTLE_GIVE_UP_MS) return
      clearInterval(t)
      setSettling(false)
      try { await apiRef.current.reread.current?.() } catch { /* the next save reconciles as it always did */ }
    }, SETTLE_POLL_MS)
    return () => clearInterval(t)
  }, [settling])

  // The write landed (lane B settled its revision inside the sheet). The editor takes the server's copy only
  // if it is still clean. If it is not, nothing is swapped in over the member's words: the update is said to
  // be applied (it is), it is not offered again, and the re-read waits for the words to land.
  const finish = (applied, plan) => {
    if (api.dirty().length) {
      setSheet(null)
      setLanded(Number(plan?.toVersion) || Number.MAX_SAFE_INTEGER)
      setNotice(APPLIED_WHILE_TYPING)
      setSettling(true)
      return true
    }
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
      {note?.styleId && !noteIsLocked(note) && !sheet && (
        <StyleUpdateBanner note={note} hideUpTo={landed} onOpen={() => setSheet({ styleId: null })} />
      )}
      {chooser && (
        <StyleChooser open onClose={() => setChooser(false)} onPick={(styleId) => { setChooser(false); setSheet({ styleId }) }} />
      )}
      {sheet && (
        <StyleUpdateSheet
          open
          onClose={() => setSheet(null)}
          noteId={note.id}
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

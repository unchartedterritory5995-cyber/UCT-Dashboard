import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFS_URL, getJson } from '../../../lib/builtWidgets'
import PanelHead from './PanelHead'
import {
  COPY, LIST_RENDER_MAX, editedText, noteHref, openNoteInPlace, readFailure, usedInHeading,
} from './myToolsLib'
import styles from './myTools.module.css'

/**
 * "Used in N notes" (spec 5.8): the member's notes that hold this widget, newest first, from
 * `GET /api/j2/widget-definitions/{id}/used-in` (the `j2_tool_uses` projection: live notes only, never another
 * member's). Each is a real link to its note: a plain click opens the note in place and closes My tools; a modified
 * click (a new tab) is the browser's.
 */
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export default function UsedInList({ d, onBack, onNavigate }) {
  const [state, setState] = useState({ status: 'loading' })
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const read = useCallback(async () => {
    const got = await getJson(`${DEFS_URL}/${encodeURIComponent(String(d.id))}/used-in`)
    const notes = got.ok && Array.isArray(got.data.notes) ? got.data.notes.filter((n) => isRecord(n) && n.noteId) : null
    return notes ? { status: 'ok', notes } : { status: 'error', code: got.code }
  }, [d.id])
  useEffect(() => {
    let alive = true
    read().then((next) => { if (alive) setState(next) })
    return () => { alive = false }
  }, [read])
  const retry = async () => {
    setState({ status: 'loading' })
    const next = await read()
    if (mounted.current) setState(next)
  }

  const notes = state.status === 'ok' ? state.notes : []
  const count = state.status === 'ok' ? notes.length : (Number.isInteger(d.usedIn) ? d.usedIn : 0)
  const shown = notes.slice(0, LIST_RENDER_MAX)
  return (
    <div className={styles.panel} data-testid="my-tools-used-in">
      <PanelHead title={usedInHeading(d.name, count)} onBack={onBack} />
      {state.status === 'loading' && <p className={styles.hint} role="status">{COPY.usedInLoading}</p>}
      {state.status === 'error' && (
        <div className={styles.stateBox}>
          <p className={styles.sentence} role="alert">{readFailure(state.code, COPY.usedInFailed)}</p>
          {state.code !== 'unavailable' && <button type="button" className={styles.btn} onClick={retry}>Try again</button>}
        </div>
      )}
      {state.status === 'ok' && notes.length === 0 && <p className={styles.sentence}>{COPY.usedInEmpty}</p>}
      {shown.length > 0 && (
        <ul className={styles.noteList}>
          {shown.map((n) => (
            <li key={n.noteId}>
              <a className={styles.noteLink} href={noteHref(n.noteId)}
                onClick={(e) => { if (openNoteInPlace(e, n.noteId)) onNavigate?.() }}>
                <span className={styles.noteTitle}>{typeof n.title === 'string' && n.title.trim() ? n.title : 'Untitled note'}</span>
                <span className={styles.noteMeta}>{editedText(n.updatedAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {notes.length > shown.length && (
        <p className={styles.hint}>{`And ${notes.length - shown.length} more notes.`}</p>
      )}
    </div>
  )
}

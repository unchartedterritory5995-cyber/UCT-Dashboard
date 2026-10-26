import { useCallback, useEffect, useRef, useState } from 'react'
import PanelHead from './PanelHead'
import { DEFS_URL, getJson } from '../../../lib/builtWidgets'
import { usedIn as toolUsedIn } from '../../../lib/toolsCrud'
import { templateUsedIn } from '../../../lib/templateLibrary'
import { COPY as TOOL_COPY } from '../routines/toolEditorLib'
import {
  COPY, LIST_RENDER_MAX, NO_RETRY, TEMPLATE_COPY, editedText, noteHref, openNoteInPlace, readFailure, usedInHeading,
} from './myToolsLib'
import styles from './myTools.module.css'

/**
 * "Used in N notes" (spec 5.8): the member's notes that hold this widget, routine or tracker (`kind`: 'widget', the
 * default, 'routine' or 'tracker'), newest first. A widget's from `GET /api/j2/widget-definitions/{id}/used-in`; a
 * routine's or tracker's through lib/toolsCrud's `usedIn` (Task 9.18), never a second fetch. Both read the
 * `j2_tool_uses` projection: live notes only, never another member's. A template's (`kind: 'template'`, wave 11 Task
 * 11.19) from `GET /api/j2/journal-styles/{id}/used-in` through lib/templateLibrary (the member's live notes made with
 * that template, `{notes: [{id, title, updatedAt}]}`). Each is a real link to its note. A plain click opens the note in place and closes My tools: through the
 * app router's `navigate` when the door that opened My tools passed one, else through the router's own history move
 * (`openNoteInPlace`). A modified click (a new tab) is the browser's.
 */
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const plainClick = (e) => !(e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)

const isTool = (kind) => kind === 'routine' || kind === 'tracker'
/** A routine, tracker or template list answers with its own sentence (the server's when it sent one). */
const ownSentence = (kind) => isTool(kind) || kind === 'template'
/** A template's notes name their id `id` (journal_styles.style_used_in); the list reads `noteId`. */
const asNote = (n) => (isRecord(n) && !n.noteId && n.id ? { ...n, noteId: n.id } : n)

export default function UsedInList({ d, kind = 'widget', onBack, onNavigate, navigate = null, backLabel }) {
  const [state, setState] = useState({ status: 'loading' })
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const read = useCallback(async () => {
    if (kind === 'template') {
      const got = await templateUsedIn(d.id)
      const raw = got.ok ? (Array.isArray(got.data.notes) ? got.data.notes : null) : null
      const notes = raw ? raw.map(asNote).filter((n) => isRecord(n) && n.noteId) : null
      return notes ? { status: 'ok', notes } : { status: 'error', code: got.code, message: got.ok ? '' : got.message }
    }
    if (isTool(kind)) {
      const got = await toolUsedIn(kind, d.id)
      const notes = got.ok && Array.isArray(got.data) ? got.data.filter((n) => isRecord(n) && n.noteId) : null
      return notes ? { status: 'ok', notes } : { status: 'error', code: got.code, message: got.message }
    }
    const got = await getJson(`${DEFS_URL}/${encodeURIComponent(String(d.id))}/used-in`)
    const notes = got.ok && Array.isArray(got.data.notes) ? got.data.notes.filter((n) => isRecord(n) && n.noteId) : null
    return notes ? { status: 'ok', notes } : { status: 'error', code: got.code }
  }, [d.id, kind])
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
  const retryRef = useRef(retry)
  useEffect(() => { retryRef.current = retry })
  // Offline: the list reads itself again when the connection is back.
  useEffect(() => {
    if (state.status !== 'error' || state.code !== 'offline') return undefined
    const back = () => retryRef.current()
    window.addEventListener('online', back)
    return () => window.removeEventListener('online', back)
  }, [state])

  const open = (e, id) => {
    if (typeof navigate === 'function') {
      if (!plainClick(e)) return
      e.preventDefault()
      navigate(noteHref(id))
      onNavigate?.()
      return
    }
    if (openNoteInPlace(e, id)) onNavigate?.()
  }

  const notes = state.status === 'ok' ? state.notes : []
  const count = state.status === 'ok' ? notes.length : (Number.isInteger(d.usedIn) ? d.usedIn : 0)
  const shown = notes.slice(0, LIST_RENDER_MAX)
  return (
    <div className={styles.pushPanel} data-testid="my-tools-used-in">
      <PanelHead title={usedInHeading(d.name, count)} onBack={onBack} {...(backLabel ? { backLabel } : {})} />
      {state.status === 'loading' && <p className={styles.hint}>{COPY.usedInLoading}</p>}
      {state.status === 'error' && (
        <div className={styles.stateBox}>
          <p className={styles.sentence} data-testid="used-in-failed">
            {/* A tool's: the editor's own sentence for a failed read (`network`); the server's for anything it said. */}
            {ownSentence(kind) ? (state.code === 'network' || !state.message ? TOOL_COPY.usedInFailed : state.message)
              : readFailure(state.code, COPY.usedInFailed)}
          </p>
          {!NO_RETRY.has(state.code) && <button type="button" className={styles.btn} onClick={retry}>Try again</button>}
        </div>
      )}
      {state.status === 'ok' && notes.length === 0 && (
        <p className={styles.sentence}>{kind === 'template' ? TEMPLATE_COPY.usedInEmpty : isTool(kind) ? TOOL_COPY.usedInEmpty : COPY.usedInEmpty}</p>
      )}
      {shown.length > 0 && (
        <ul className={styles.noteList}>
          {shown.map((n) => {
            const title = typeof n.title === 'string' && n.title.trim() ? n.title : 'Untitled note'
            return (
              <li key={n.noteId}>
                <a className={styles.noteLink} href={noteHref(n.noteId)} onClick={(e) => open(e, n.noteId)}>
                  <span className={styles.noteTitle} title={title}>{title}</span>
                  <span className={styles.noteMeta}>{editedText(n.updatedAt)}</span>
                </a>
              </li>
            )
          })}
        </ul>
      )}
      {notes.length > shown.length && (
        <p className={styles.hint}>{`And ${notes.length - shown.length} more notes.`}</p>
      )}
    </div>
  )
}

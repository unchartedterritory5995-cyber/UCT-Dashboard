import { useCallback, useEffect, useId, useRef, useState } from 'react'
import UIcon from '../../../../../components/ui/UIcon'
import { usedIn as readUsedIn } from '../../../lib/toolsCrud'
import {
  COPY, editedText, noteHref, openNoteInPlace, RECENTLY_DELETED_DAYS, archiveSentence, deletedSentence, notesWord, usedInHeading, usedInText,
} from './toolEditorLib'
import styles from './routines.module.css'

/**
 * A routine's or tracker's own management inside its editor (spec 5.8, the My tools actions, Task 9.16): Used in,
 * Duplicate and Archive while it is live; Restore and Delete permanently once archived; Undo after a delete. The
 * frame (ToolEditor) owns every request and every move between panels; these draw the panels and say what each does.
 *
 * Duplicate, Archive and Used in act on what is SAVED, so they wait for a clean form ("Save or discard your changes
 * first."): aria-disabled with that reason, never `disabled`, and a press does nothing (ONE guard, in the frame's
 * `manage` actions, so it is proved once).
 */
const noun = (kind) => (kind === 'tracker' ? 'tracker' : 'routine')

function PanelHead({ id, title, onBack, kind, focus = true }) {
  const ref = useRef(null)
  useEffect(() => { if (focus) ref.current?.focus() }, [focus])
  return (
    <div className={styles.panelHead}>
      {onBack && (
        <button type="button" className={styles.backBtn} onClick={onBack} aria-label={`Back to the ${noun(kind)}`}>
          <UIcon name="chevronLeft" size={16} gold={false} />
          <span>Back</span>
        </button>
      )}
      <h3 ref={ref} id={id} className={styles.panelTitle} tabIndex={-1} data-panel-heading="">{title}</h3>
    </div>
  )
}

export function ManageSection({ kind, tool, dirty, busy, manage, archivedText }) {
  const id = useId()
  const used = Number.isInteger(tool.usedIn) ? tool.usedIn : 0
  const held = dirty ? { 'aria-disabled': true, 'aria-describedby': `${id}-held` } : {}
  return (
    <section className={styles.manage} aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className={styles.sectionTitle}>Manage</h3>
      {used > 0 ? (
        <button type="button" className={styles.linkBtn} {...held}
          onClick={(e) => manage.usedIn(e.currentTarget)}>{usedInText(used)}</button>
      ) : (
        <p className={styles.hint}>{COPY.notInNote}</p>
      )}
      {tool.archived ? (
        <>
          <p className={styles.sentence}>{archivedText}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.btn} data-manage="restore" aria-disabled={busy || undefined}
              onClick={() => { if (!busy) manage.restore() }}>Restore</button>
            <button type="button" className={styles.btnDanger} aria-disabled={busy || undefined}
              onClick={(e) => { if (!busy) manage.remove(e.currentTarget) }}>Delete permanently</button>
          </div>
        </>
      ) : (
        <div className={styles.actions}>
          <button type="button" className={styles.btn} {...held} aria-disabled={dirty || busy || undefined}
            onClick={() => { if (!busy) manage.duplicate() }}>Duplicate</button>
          <button type="button" className={styles.btn} {...held} aria-disabled={dirty || busy || undefined}
            onClick={(e) => { if (!busy) manage.archive(e.currentTarget) }}>Archive</button>
        </div>
      )}
      {dirty && !tool.archived && <p className={styles.hint} id={`${id}-held`}>{COPY.cleanFirst}</p>}
    </section>
  )
}

export function ArchivePanel({ kind, tool, busy, onBack, onConfirm }) {
  const id = useId()
  const used = Number.isInteger(tool.usedIn) ? tool.usedIn : 0
  return (
    <section className={styles.panel} aria-labelledby={`${id}-h`}>
      <PanelHead id={`${id}-h`} kind={kind} title={`Archive “${tool.name}”?`} onBack={onBack} />
      <p className={styles.sentence} id={`${id}-what`}>{archiveSentence(used)}</p>
      <p className={styles.hint}>{`An archived ${noun(kind)} leaves the / menu. Restore brings it back.`}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={onBack}>Cancel</button>
        <button type="button" className={styles.btnPrimary} aria-describedby={`${id}-what`} aria-disabled={busy || undefined}
          aria-busy={busy || undefined} onClick={() => { if (!busy) onConfirm() }}>
          {`Archive ${noun(kind)}`}
        </button>
      </div>
    </section>
  )
}

/**
 * "Delete permanently", the My tools DeleteConfirm pattern: offered only for an archived item, and it needs the name
 * typed exactly. The server checks both again, and its sentence is the one shown. The field is labelled by what to
 * type; the field AND the button are described by what deleting does and by why the button is off; Enter in the field
 * deletes once the name matches.
 */
export function DeletePanel({ kind, tool, busy, onBack, onConfirm }) {
  const id = useId()
  const [typed, setTyped] = useState('')
  const input = useRef(null)
  useEffect(() => { input.current?.focus() }, [])
  const name = String(tool.name || '')
  const matches = typed === name && name !== ''
  const used = Number.isInteger(tool.usedIn) ? tool.usedIn : 0
  const described = `${id}-what ${id}-gate`
  const submit = (e) => {
    e.preventDefault()
    if (!matches || busy) return
    onConfirm(typed)
  }
  return (
    <section className={styles.panel} aria-labelledby={`${id}-h`}>
      <PanelHead id={`${id}-h`} kind={kind} title={`Delete “${name}” permanently?`} onBack={onBack} focus={false} />
      <form className={styles.form} onSubmit={submit}>
        <p className={styles.sentence} id={`${id}-what`}>
          {`It moves to Recently deleted for ${RECENTLY_DELETED_DAYS} days, then it is gone for good, with its history.`}
          {used > 0 ? ` Your ${notesWord(used)} will show it as not available.` : ''}
        </p>
        <label className={styles.fieldLabel} htmlFor={id}>
          {'Type '}<strong className={styles.typeName}>{name}</strong>{' to confirm'}
        </label>
        <input ref={input} id={id} className={styles.input} value={typed} autoComplete="off" spellCheck={false}
          aria-describedby={described} onChange={(e) => setTyped(e.target.value)} data-testid="delete-typed-name" />
        <p className={styles.hint} id={`${id}-gate`}>
          {matches ? 'The name matches.' : 'Delete turns on when the name matches exactly.'}
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onBack}>Cancel</button>
          <button type="submit" className={styles.btnDanger} aria-disabled={!matches || busy || undefined}
            aria-busy={busy || undefined} aria-describedby={described}>
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </form>
    </section>
  )
}

export function DeletedPanel({ tool, busy, onUndo, onClose }) {
  const id = useId()
  const undo = useRef(null)
  useEffect(() => { undo.current?.focus() }, [])
  return (
    <section className={styles.panel} aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className={styles.panelTitle}>Moved to Recently deleted</h3>
      <p className={styles.sentence} id={`${id}-what`}>{deletedSentence(tool.name)}</p>
      <div className={styles.actions}>
        <button ref={undo} type="button" className={styles.btn} aria-describedby={`${id}-what`}
          aria-disabled={busy || undefined} onClick={() => { if (!busy) onUndo() }}>Undo</button>
        <button type="button" className={styles.btnPrimary} onClick={onClose}>Close</button>
      </div>
    </section>
  )
}

const plainClick = (e) => !(e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)

/** "Used in N notes": the member's notes that place this routine or tracker, each a real link to its note. */
export function UsedInPanel({ kind, tool, onBack, navigate = null, onNavigate }) {
  const [state, setState] = useState({ status: 'loading' })
  const read = useCallback(async () => {
    const got = await readUsedIn(kind, tool.id)
    return got.ok ? { status: 'ok', notes: got.data.filter((n) => n && n.noteId) } : { status: 'error', text: got.message, code: got.code }
  }, [kind, tool.id])
  useEffect(() => {
    let alive = true
    read().then((next) => { if (alive) setState(next) })
    return () => { alive = false }
  }, [read])
  const retry = async () => {
    setState({ status: 'loading' })
    setState(await read())
  }
  const open = (e, noteId) => {
    if (typeof navigate === 'function') {
      if (!plainClick(e)) return
      e.preventDefault()
      navigate(noteHref(noteId))
      onNavigate?.()
      return
    }
    if (openNoteInPlace(e, noteId)) onNavigate?.()
  }
  const hid = useId()
  const notes = state.status === 'ok' ? state.notes : []
  const count = state.status === 'ok' ? notes.length : (Number.isInteger(tool.usedIn) ? tool.usedIn : 0)
  return (
    <section className={styles.panel} aria-labelledby={hid}>
      <PanelHead id={hid} kind={kind} title={usedInHeading(tool.name, count)} onBack={onBack} />
      {state.status === 'loading' && <p className={styles.hint}>{COPY.usedInLoading}</p>}
      {state.status === 'error' && (
        <div className={styles.stateBox}>
          <p className={styles.sentence}>{state.text || COPY.usedInFailed}</p>
          {state.code !== 'unavailable' && state.code !== 'paid' && (
            <button type="button" className={styles.btn} onClick={retry}>Try again</button>
          )}
        </div>
      )}
      {state.status === 'ok' && notes.length === 0 && <p className={styles.sentence}>{COPY.usedInEmpty}</p>}
      {notes.length > 0 && (
        <ul className={styles.noteList}>
          {notes.map((n) => {
            const title = typeof n.title === 'string' && n.title.trim() ? n.title : 'Untitled note'
            return (
              <li key={n.noteId}>
                <a className={styles.noteLink} href={noteHref(n.noteId)} onClick={(e) => open(e, n.noteId)}>
                  <span className={styles.noteTitle}>{title}</span>
                  <span className={styles.noteMeta}>{editedText(n.updatedAt)}</span>
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

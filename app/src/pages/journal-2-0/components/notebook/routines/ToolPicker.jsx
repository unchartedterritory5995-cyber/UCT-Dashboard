import { useCallback, useEffect, useRef, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import { listTools } from '../../../lib/toolsCrud'
import { COPY } from './toolEditorLib'
import styles from './routines.module.css'

/**
 * The tool picker (Task 9.19): what the / menu's "Routine (remembered daily)" and "Tracker (one value a day)" open.
 * The member's routines (or trackers) that are not archived, read through lib/toolsCrud (the one client), each a
 * button that places it in the note, plus "New routine" ("New tracker"), which hands over to the editor.
 *
 * `onPick(tool)` places the tool; `onNew()` opens the editor; `onClose()` closes. Opened by `openToolPicker` on its
 * own root. The rules it keeps, as the editors do: ONE always-mounted live region for a list that cannot be read (with
 * Try again), never `disabled`, and member words only.
 */
export const PICKER_COPY = Object.freeze({
  routine: {
    title: 'Add a routine', list: 'Your routines', new: COPY.newRoutine,
    loading: 'Loading your routines…', empty: "You don't have a routine yet. Make one, and it goes in this note.",
  },
  tracker: {
    title: 'Add a tracker', list: 'Your trackers', new: COPY.newTracker,
    loading: 'Loading your trackers…', empty: "You don't have a tracker yet. Make one, and it goes in this note.",
  },
})

const live = (t) => t && typeof t === 'object' && typeof t.id === 'string' && t.id && !t.archived && !t.deleted
const nameOf = (t, kind) => (typeof t.name === 'string' && t.name.trim() ? t.name.trim() : kind === 'routine' ? 'Routine' : 'Tracker')

export default function ToolPicker({ kind, onPick, onNew, onClose }) {
  const copy = PICKER_COPY[kind] || PICKER_COPY.routine
  const [state, setState] = useState({ phase: 'loading', list: [], message: '' })
  const [round, setRound] = useState(0)
  const [said, setSaid] = useState({ n: 0, text: '' })
  const picked = useRef(false)

  useEffect(() => {
    let alive = true
    listTools(kind).then((got) => {
      if (!alive) return
      if (got.ok) {
        setState({ phase: 'ready', list: got.data.filter(live), message: '' })
        setSaid((s) => (s.text ? { n: s.n + 1, text: '' } : s))
      } else {
        setState({ phase: 'failed', list: [], message: got.message })
        setSaid((s) => ({ n: s.n + 1, text: got.message }))
      }
    })
    return () => { alive = false }
  }, [kind, round])

  const retry = useCallback(() => {
    setState((s) => ({ ...s, phase: 'loading' }))
    setRound((n) => n + 1)
  }, [])

  const pick = (tool) => {
    if (picked.current) return
    picked.current = true
    onPick?.(tool)
  }

  return (
    <Sheet open onClose={onClose} title={<h2 className={styles.dialogTitle}>{copy.title}</h2>} labelledByTitle
      maxWidth={480} className={styles.sheetPanel}>
      <div className={styles.root} data-testid={`${kind}-picker`}>
        {/* The ONE live region: always mounted, visible while it says something. */}
        <div className={said.text ? styles.notice : styles.liveIdle} role="status">
          <span key={said.n}>{said.text}</span>
        </div>
        {state.phase === 'failed' && (
          <div className={styles.noticeActions}>
            <button type="button" className={styles.btn} onClick={retry}>Try again</button>
          </div>
        )}
        {state.phase === 'loading' && <p className={styles.hint}>{copy.loading}</p>}
        {state.phase === 'ready' && !state.list.length && <p className={styles.hint}>{copy.empty}</p>}
        {state.phase === 'ready' && state.list.length > 0 && (
          // ⛔ role="list" spelled out: `list-style: none` drops the list role in Safari.
          <ul className={styles.pickList} role="list" aria-label={copy.list}>
            {state.list.map((t) => (
              <li key={t.id}>
                <button type="button" className={styles.btn} onClick={() => pick(t)}>{nameOf(t, kind)}</button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.btnPrimary} onClick={() => { if (!picked.current) onNew?.() }}>{copy.new}</button>
        </div>
      </div>
    </Sheet>
  )
}

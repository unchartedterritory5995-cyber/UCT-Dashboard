import { useId, useState } from 'react'
import useSWR from 'swr'
import { useNavigate } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import { TASK_GROUPS, dueLabel, groupTasks, noteTaskPath } from '../../lib/noteTasks'
import styles from './NoteTasksView.module.css'

/**
 * Tasks across notes (wave 6, Phase 2) — every checklist item in the member's
 * notes, in one list: Overdue / Today / Upcoming / No date. A row opens its
 * note at that task (`?task=<index>`, see `lib/noteTasks.js`).
 *
 * ⛔ READ-ONLY IN V1, BY DECISION. There is no checkbox to tick here. Ticking a
 * task from this list would write into a note from outside that note's
 * editor — a second writer, which the offline layer resolves by FORKING the
 * note. The member ticks the task inside the note, where the editor owns the
 * write; the row says so.
 *
 * A due date comes from a `dateMention` inside the task (editor lane contract:
 * attr `date` = `YYYY-MM-DD`). Server: GET /api/j2/notes/tasks
 * (api/services/journal_two/note_tasks.py).
 */
async function fetcher(url) {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) throw new Error(`tasks ${r.status}`)
  return r.json()
}

const STATUSES = [
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
]

export default function NoteTasksView({ onOpenTask }) {
  const [status, setStatus] = useState('open')
  const { data, error, isLoading, mutate } = useSWR(
    `/api/j2/notes/tasks?status=${status}`, fetcher, { revalidateOnFocus: false },
  )
  const navigate = useNavigate()
  const headingId = useId()

  const open = (t) => {
    if (onOpenTask) onOpenTask(t.noteId, t.index)
    else navigate(noteTaskPath(t.noteId, t.index))
  }

  const tasks = data?.tasks ?? []
  const today = data?.today ?? ''

  let body
  if (isLoading && !data) {
    body = <p className={styles.state} role="status">Loading your tasks…</p>
  } else if (error) {
    body = (
      <div className={styles.state} role="alert">
        <p>Couldn’t load your tasks.</p>
        <button type="button" className={styles.retry} onClick={() => mutate()}>Try again</button>
      </div>
    )
  } else if (tasks.length === 0) {
    body = (
      <p className={styles.state} role="status">
        {status === 'open'
          ? 'No open tasks. Add a checklist to any note and its items show up here.'
          : 'No finished tasks yet.'}
      </p>
    )
  } else if (status === 'done') {
    body = <TaskGroup label="Done" tasks={tasks} today={today} onOpen={open} />
  } else {
    const groups = groupTasks(tasks, today)
    body = TASK_GROUPS.filter((g) => groups[g.key].length > 0).map((g) => (
      <TaskGroup key={g.key} label={g.label} tasks={groups[g.key]} today={today} onOpen={open} tone={g.key} />
    ))
  }

  return (
    <section className={styles.wrap} aria-labelledby={headingId}>
      <header className={styles.header}>
        <h2 id={headingId} className={styles.title}>
          <UIcon name="check" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          Tasks
        </h2>
        <div className={styles.segmented} role="group" aria-label="Show tasks">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`${styles.segment} ${status === s.key ? styles.segmentActive : ''}`}
              aria-pressed={status === s.key}
              onClick={() => setStatus(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>
      <p className={styles.note}>To tick a task off, open its note.</p>
      {body}
      {data?.truncated && (
        <p className={styles.note}>Showing the first {tasks.length.toLocaleString()} tasks.</p>
      )}
    </section>
  )
}

function TaskGroup({ label, tasks, today, onOpen, tone }) {
  const id = useId()
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h3 id={id} className={`${styles.groupTitle} ${tone === 'overdue' ? styles.groupOverdue : ''}`}>
        {label} <span className={styles.count}>({tasks.length})</span>
      </h3>
      <ul className={styles.list}>
        {tasks.map((t) => {
          const text = t.text || 'Untitled task'
          const due = dueLabel(t.due, today)
          return (
            <li key={`${t.noteId}:${t.index}`}>
              <button
                type="button"
                className={styles.row}
                onClick={() => onOpen(t)}
                aria-label={`${text}${due ? `, ${due.toLowerCase()}` : ''}. Open “${t.noteTitle}”`}
              >
                <span className={`${styles.box} ${t.checked ? styles.boxDone : ''}`} aria-hidden="true">
                  {t.checked && <UIcon name="check" size={11} gold={false} />}
                </span>
                <span className={styles.rowMain}>
                  <span className={`${styles.text} ${t.checked ? styles.textDone : ''}`}>{text}</span>
                  <span className={styles.meta}>
                    <UIcon name="document" size={11} gold={false} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                    {t.noteTitle}
                    {due && <span className={styles.due}> · {due}</span>}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

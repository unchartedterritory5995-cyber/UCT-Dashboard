import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import UIcon from '../../../../components/ui/UIcon'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import {
  AI_ACTIONS_EXAMPLES, applyApproved, describeApply, describeUndo, groupChangesByNote,
  planAiChanges, undoAiChangeSet,
} from '../../lib/aiActions'
import { isNotebookKey } from './onboarding/sampleNotebook'
import styles from './AiActionsPanel.module.css'

/**
 * Wave 11 lane 11C — "Ask Notebook to do something".
 *
 * request → PLAN (nothing written) → REVIEW (every change, grouped by note,
 * before → after, a checkbox each, all checked) → APPLY N (note by note, with
 * progress; failures listed) → UNDO the whole change set in one click.
 *
 * ⛔ Hidden entirely while `notebook_ai_actions_enabled` is off.
 * ⛔ Keyboard: every step is a native control in tab order — the toggle, the
 *    request (Ctrl/⌘+Enter plans), each checkbox (Space), Apply, Undo; focus
 *    moves to each new step's heading so a screen reader hears where it is.
 */
export default function AiActionsBox(props) {
  if (notebookFlag('notebook_ai_actions_enabled') !== true) return null
  return <AiActionsPanel {...props} />
}

const STATUS_WORDS = {
  conflict: 'Not applied',
  failed: 'Not applied',
  held: 'Held back',
  skipped: 'Not applied',
  unchanged: 'Already that way',
  undo_refused: 'Left as it is',
  undo_failed: 'Left as it is',
}

export function AiActionsPanel({ blockedNoteIds = null, onOpenNote, defaultOpen = false }) {
  const { mutate } = useSWRConfig()
  const ids = useId()
  const [open, setOpen] = useState(defaultOpen)
  const [request, setRequest] = useState('')
  const [phase, setPhase] = useState('idle') // idle | planning | review | applying | done | undoing | undone
  const [error, setError] = useState('')
  const [changeSet, setChangeSet] = useState(null)
  const [checked, setChecked] = useState(() => new Set())
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [applyResults, setApplyResults] = useState([])
  const [undoBody, setUndoBody] = useState(null)
  const headingRef = useRef(null)
  const requestRef = useRef(null)

  const groups = useMemo(() => groupChangesByNote(changeSet?.changes || []), [changeSet])
  const byId = useMemo(() => new Map((changeSet?.changes || []).map((c) => [c.id, c])), [changeSet])

  useEffect(() => {
    if (['review', 'done', 'undone'].includes(phase)) headingRef.current?.focus()
  }, [phase])
  useEffect(() => { if (open && phase === 'idle') requestRef.current?.focus() }, [open, phase])

  const reset = () => {
    setPhase('idle'); setChangeSet(null); setChecked(new Set()); setError('')
    setApplyResults([]); setUndoBody(null); setProgress({ done: 0, total: 0 })
  }

  const plan = async (e) => {
    e?.preventDefault?.()
    if (phase === 'planning' || !request.trim()) {
      if (!request.trim()) setError('Type what you’d like Notebook to do first.')
      return
    }
    setError('')
    setPhase('planning')
    try {
      const cs = await planAiChanges(request.trim())
      setChangeSet(cs)
      setChecked(new Set((cs.changes || []).map((c) => c.id)))
      setPhase('review')
    } catch (err) {
      setError(err.message)
      setPhase('idle')
    }
  }

  const toggle = (id) => setChecked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const apply = async () => {
    if (!changeSet || !checked.size) return
    setPhase('applying')
    setError('')
    const out = await applyApproved({
      changeSet, approvedIds: [...checked], blockedNoteIds, onProgress: setProgress,
    })
    setChangeSet(out.changeSet || changeSet)
    setApplyResults(out.results)
    setPhase('done')
    mutate(isNotebookKey)
  }

  const undo = async () => {
    if (!changeSet) return
    setPhase('undoing')
    setError('')
    try {
      const body = await undoAiChangeSet(changeSet.id)
      setUndoBody(body)
      if (body.changeSet) setChangeSet(body.changeSet)
      setPhase('undone')
      mutate(isNotebookKey)
    } catch (err) {
      setError(err.message)
      setPhase('done')
    }
  }

  const onRequestKey = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) plan(e)
    if (e.key === 'Escape') setOpen(false)
  }

  // Fin-ai K4: a plan with NO changes is not a review. It used to read "Review 0 proposed
  // changes" over "Uncheck anything you don't want" and an "Apply 0 changes" button. Now it
  // is a plain message: the model's own explanation (or the product's sentence when it gave
  // none), whatever the plan skipped, and the way back to the request, which is kept.
  const emptyPlan = Boolean(changeSet) && (changeSet.changes || []).length === 0
  const skippedList = changeSet?.skipped?.length > 0 ? (
    <details className={styles.skipped}>
      <summary>Skipped ({changeSet.skippedCount || changeSet.skipped.length}) — not changed</summary>
      <ul aria-label="Skipped changes">
        {changeSet.skipped.map((s, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <li key={i}>{s.noteTitle ? <strong>{s.noteTitle}: </strong> : null}{s.reason}</li>
        ))}
      </ul>
    </details>
  ) : null

  const appliedCount = applyResults.filter((r) => r.status === 'applied').length
  const notApplied = applyResults.filter((r) => r.status !== 'applied')
  const undoLeft = (undoBody?.results || []).filter((r) => r.status !== 'undone')

  return (
    <section className={styles.wrap} aria-label="Ask Notebook to do something">
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={`${ids}-panel`}
        onClick={() => setOpen((o) => !o)}
      >
        <UIcon name="sparkle" size={13} gold={false} /> Ask Notebook to do something
      </button>
      {open && (
        <div id={`${ids}-panel`} className={styles.panel}>
          {(phase === 'idle' || phase === 'planning') && (
            <form onSubmit={plan} className={styles.form}>
              <label htmlFor={`${ids}-request`} className={styles.label}>What should Notebook do?</label>
              <textarea
                id={`${ids}-request`}
                ref={requestRef}
                className={styles.request}
                rows={3}
                maxLength={1000}
                value={request}
                placeholder={AI_ACTIONS_EXAMPLES[0]}
                aria-describedby={`${ids}-hint`}
                onChange={(e) => setRequest(e.target.value)}
                onKeyDown={onRequestKey}
                disabled={phase === 'planning'}
              />
              <p id={`${ids}-hint`} className={styles.hint}>
                Notebook plans the changes first and writes nothing until you approve them. It can tag,
                set a property, move to a folder, add a block at the end of a note, or create a note —
                never delete or rewrite. Ctrl+Enter plans.
              </p>
              <div className={styles.row}>
                <button type="submit" className="btn btn-primary" disabled={phase === 'planning'}>
                  {phase === 'planning' ? 'Planning…' : 'Plan changes'}
                </button>
              </div>
              {phase === 'planning' && (
                <p role="status" className={styles.status}>Planning… nothing is changed until you approve.</p>
              )}
            </form>
          )}

          {error && <p role="alert" className={styles.error}>{error}</p>}

          {phase === 'review' && changeSet && emptyPlan && (
            <div className={styles.review}>
              <h3 ref={headingRef} tabIndex={-1} className={styles.heading}>Nothing to change</h3>
              <p className={styles.asked}>You asked: “{changeSet.request}”</p>
              <p role="status" className={styles.summary}>
                {changeSet.summary || 'Notebook found nothing to change for that request.'}
              </p>
              <p className={styles.hint}>Nothing was written.</p>
              {skippedList}
              <div className={styles.row}>
                <button type="button" className="btn btn-primary" onClick={reset}>Change the request</button>
              </div>
            </div>
          )}

          {(phase === 'review' || phase === 'applying') && changeSet && !emptyPlan && (
            <div className={styles.review}>
              <h3 ref={headingRef} tabIndex={-1} className={styles.heading}>
                Review {changeSet.changes.length} proposed {changeSet.changes.length === 1 ? 'change' : 'changes'}
              </h3>
              <p className={styles.asked}>You asked: “{changeSet.request}”</p>
              <p className={styles.hint}>Nothing has been written yet. Uncheck anything you don’t want.</p>
              {changeSet.summary && <p className={styles.summary}>{changeSet.summary}</p>}
              {changeSet.capped && (
                <p className={styles.capped} role="note">
                  The plan was capped at {changeSet.capped.limit} changes; {changeSet.capped.dropped} more
                  {changeSet.capped.dropped === 1 ? ' was' : ' were'} not included.
                </p>
              )}
              {groups.map((g) => (
                <fieldset key={g.key} className={styles.group} disabled={phase === 'applying'}>
                  <legend className={styles.legend}>
                    {g.noteTitle}{g.isNew ? ' (new note)' : ''}
                  </legend>
                  <ul className={styles.changes}>
                    {g.changes.map((c) => (
                      <li key={c.id} className={styles.change}>
                        <input
                          type="checkbox"
                          id={`${ids}-c-${c.id}`}
                          checked={checked.has(c.id)}
                          onChange={() => toggle(c.id)}
                          aria-describedby={`${ids}-d-${c.id}`}
                        />
                        <div className={styles.changeBody}>
                          <label htmlFor={`${ids}-c-${c.id}`} className={styles.changeLabel}>
                            {c.label}
                          </label>
                          <span className={styles.aiBadge} title="Proposed by Notebook AI">AI</span>
                          <div id={`${ids}-d-${c.id}`} className={styles.diff}>
                            {c.before ? (
                              <span className={styles.before}><span className={styles.diffKey}>Before:</span> {c.before}</span>
                            ) : null}
                            {/* a real space, so a screen reader hears "…print. After:" not "printAfter:" */}
                            {' '}
                            <span className={styles.after}><span className={styles.diffKey}>After:</span> {c.after}</span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              ))}
              {skippedList}
              {phase === 'applying' ? (
                <div className={styles.progressRow}>
                  <progress max={progress.total || 1} value={progress.done} aria-label="Applying changes" />
                  <span role="status">Applying… {progress.done} of {progress.total} {progress.total === 1 ? 'note' : 'notes'}</span>
                </div>
              ) : (
                <div className={styles.row}>
                  <button type="button" className="btn btn-primary" onClick={apply} disabled={!checked.size}>
                    Apply {checked.size} {checked.size === 1 ? 'change' : 'changes'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={reset}>Discard plan</button>
                </div>
              )}
            </div>
          )}

          {(phase === 'done' || phase === 'undoing') && changeSet && (
            <div className={styles.review}>
              <h3 ref={headingRef} tabIndex={-1} className={styles.heading}>AI change set applied</h3>
              <p role="status" className={styles.status}>{describeApply(applyResults)}</p>
              <p className={styles.asked}>You asked: “{changeSet.request}” · change set {changeSet.id.slice(0, 8)}</p>
              {notApplied.length > 0 && (
                <ul className={styles.failures} aria-label="Changes that were not applied">
                  {notApplied.map((r) => {
                    const c = byId.get(r.id)
                    return (
                      <li key={r.id}>
                        <strong>{c?.noteTitle || 'A note'}</strong> — {c?.label || 'a change'}:{' '}
                        {STATUS_WORDS[r.status] || 'Not applied'}. {r.message}
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className={styles.row}>
                {appliedCount > 0 && (
                  <button type="button" className="btn btn-ghost" onClick={undo} disabled={phase === 'undoing'}>
                    <UIcon name="clock" size={14} gold={false} />
                    {phase === 'undoing' ? 'Undoing…' : 'Undo this change set'}
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => { reset(); setRequest('') }}>
                  Ask for something else
                </button>
              </div>
            </div>
          )}

          {phase === 'undone' && (
            <div className={styles.review}>
              <h3 ref={headingRef} tabIndex={-1} className={styles.heading}>AI change set undone</h3>
              <p role="status" className={styles.status}>{describeUndo(undoBody)}</p>
              {undoLeft.length > 0 && (
                <ul className={styles.failures} aria-label="Changes that were left as they are">
                  {undoLeft.map((r) => {
                    const c = byId.get(r.id)
                    return (
                      <li key={r.id}>
                        <strong>{c?.noteTitle || 'A note'}</strong> — {c?.label || 'a change'}: {r.message}
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className={styles.row}>
                <button type="button" className="btn btn-ghost" onClick={() => { reset(); setRequest('') }}>
                  Ask for something else
                </button>
                {onOpenNote && null}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

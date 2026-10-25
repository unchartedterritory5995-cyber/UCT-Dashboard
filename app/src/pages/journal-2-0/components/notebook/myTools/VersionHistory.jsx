import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { UPDATE_ALL, SAVE_NEW, preselectAnswer } from '../widgetBuilder/SaveQuestion'
import PanelHead from './PanelHead'
import RestoreQuestion from './RestoreQuestion'
import { COPY, NO_RETRY, actionFailure, diffWords, readFailure, request, versionDate } from './myToolsLib'
import styles from './myTools.module.css'

/**
 * Version history (spec 5.8): every kept version of one widget, newest first (`GET /{id}/revs`), each with its date,
 * its name if the member named it, and its summary sentence with the words that differ from the CURRENT version
 * highlighted (a <mark>, underlined as well as tinted, so the difference is never colour alone).
 *
 *  * "Name this version" keeps it for good (`POST /{id}/revs/{rev}/name`); an empty name unnames it.
 *  * Restore asks first (focus on the confirm's first button), then saves the old version as a NEW version
 *    (`POST /{id}/revs/{rev}/restore`, If-Match: the widget's etag, ruling R-15). Placements stay where they are.
 *    When the widget is in more than one note, RestoreQuestion follows:
 *      - Update all N notes: `PUT {apply: 'update_all'}`;
 *      - Save as a new widget: `PUT {apply: 'save_new'}` makes the restored version a widget of its own, then this
 *        widget goes back to the version it had before. If that second step fails, the member is told exactly what
 *        state the widget is in (COPY.revertFailed) and offered "Go back to the version before" again;
 *      - Back (or Escape): the restored version stays this widget's newest; the notes keep what they show.
 *
 * Every message goes to My tools' ONE live region (`announce(text, tone)`), never a region of its own.
 * `subBackRef` is WidgetsTab's ref for Escape: it backs out of naming, a confirm or the question before the panel.
 */
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const enc = (id) => encodeURIComponent(String(id))
export const QUESTION_BACK = 'Restored. Your notes keep what they show until you choose the newer version in each note.'

function Summary({ text, base, isCurrent }) {
  if (isCurrent || typeof base !== 'string' || !base) return <span>{text}</span>
  const runs = diffWords(base, text)
  return (
    <span>
      {runs.map((r, i) => (r.changed
        ? <mark key={i} className={styles.diff}>{r.text}</mark>
        : <Fragment key={i}>{r.text}</Fragment>))}
    </span>
  )
}

function NameForm({ defId, rev, onCancel, onSaved, onFailed }) {
  const id = useId()
  const [name, setName] = useState(typeof rev.named === 'string' ? rev.named : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)
  useEffect(() => { input.current?.focus() }, [])
  const send = async (value) => {
    if (busy) return
    setBusy(true)
    setError('')
    const got = await request('POST', `/${enc(defId)}/revs/${rev.rev}/name`, { body: { name: value } })
    setBusy(false)
    if (got.ok) onSaved(got.data?.named ?? null)
    else if (got.code === 'unavailable') onFailed(got)
    else setError(actionFailure(got))
  }
  return (
    <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); if (name.trim()) send(name.trim()) }}>
      <label className={styles.fieldLabel} htmlFor={id}>Name for this version</label>
      <input ref={input} id={id} className={styles.input} value={name} maxLength={200}
        onChange={(e) => setName(e.target.value)} aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined} />
      {error && <p className={styles.error} role="alert" id={`${id}-err`}>{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={onCancel}>Cancel</button>
        {rev.named && <button type="button" className={styles.btn} aria-disabled={busy || undefined} onClick={() => send('')}>Remove the name</button>}
        <button type="submit" className={styles.btnPrimary} aria-disabled={busy || !name.trim() || undefined}
          aria-busy={busy || undefined}>Save name</button>
      </div>
    </form>
  )
}

function RestoreConfirm({ label, used, busy, error, onCancel, onRestore, onReload }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.querySelector('button')?.focus() }, [])
  return (
    <div ref={ref} className={styles.confirm} role="group" aria-label={`Restore the version from ${label}`}
      data-testid="restore-confirm">
      <p className={styles.sentence}>
        {`Restore the version from ${label}? It is saved as a new version, so nothing is lost.`}
        {used > 0 ? ' Your notes keep what they show.' : ''}
      </p>
      {error && <p className={styles.inlineError}>{error.text}</p>}
      <div className={styles.actions}>
        {error?.conflict && <button type="button" className={styles.btn} onClick={onReload}>Reload</button>}
        <button type="button" className={styles.btn} onClick={onCancel}>Cancel</button>
        <button type="button" className={styles.btnPrimary} aria-disabled={busy || undefined} aria-busy={busy || undefined}
          data-confirm-restore="" onClick={() => { if (!busy) onRestore() }}>{busy ? 'Restoring…' : 'Restore'}</button>
      </div>
    </div>
  )
}

export default function VersionHistory({ d, onBack, subBackRef, announce, onChanged, onGone }) {
  const [revs, setRevs] = useState({ status: 'loading' })
  const [def, setDef] = useState(d)                 // the widget as it now stands: etag, usedIn, lastAnswer, rev
  const [mode, setMode] = useState({ kind: 'list' }) // list | naming | confirm | question
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)          // {rev?, text, conflict?} shown beside its control
  const [answer, setAnswer] = useState(null)
  const [revert, setRevert] = useState(null)        // {before}: the second step of "save as new" did not land
  const mounted = useRef(true)
  const listRef = useRef(null)
  const returnRev = useRef(null)
  useEffect(() => () => { mounted.current = false }, [])
  const say = useCallback((text, tone = 'ok') => announce?.(text, tone), [announce])

  const read = useCallback(async () => {
    const got = await request('GET', `/${enc(d.id)}/revs`)
    const items = got.ok && Array.isArray(got.data.revs) ? got.data.revs.filter((r) => isRecord(r) && Number.isInteger(r.rev)) : null
    return items ? { status: 'ok', items } : { status: 'error', code: got.code }
  }, [d.id])
  useEffect(() => {
    let alive = true
    read().then((next) => { if (alive) setRevs(next) })
    return () => { alive = false }
  }, [read])
  /** Read the versions again (after a change, or Try again); the list on screen stays until the answer lands. */
  const load = async () => {
    const next = await read()
    if (mounted.current) setRevs(next)
  }
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load })
  // Offline: the list reads itself again when the connection is back.
  useEffect(() => {
    if (revs.status !== 'error' || revs.code !== 'offline') return undefined
    const back = () => loadRef.current()
    window.addEventListener('online', back)
    return () => window.removeEventListener('online', back)
  }, [revs])

  // Focus goes back to the version a step came from (or, after a restore, to the new newest version), once that row
  // is drawn: a restore reloads the list, so the row may arrive a render later.
  const pendingFocus = useRef(null)
  const tryFocus = useCallback(() => {
    const want = pendingFocus.current
    if (!want) return
    const row = listRef.current?.querySelector(`[data-rev="${want.rev}"]`)
    // Only the named control: while a confirm or a name form is still drawn, the row's other buttons are not it.
    const target = want.which === 'revert'
      // the revert box: its Reload first when a stale tab blocks the retry
      ? (listRef.current?.parentElement?.querySelector('[data-rev-action="revert-reload"]')
        || listRef.current?.parentElement?.querySelector('[data-rev-action="revert"]'))
      : row?.querySelector(`[data-rev-action="${want.which}"]`)
    if (!target) return
    pendingFocus.current = null
    target.focus()
  }, [])
  const focusRev = useCallback((rev, which = 'restore') => {
    pendingFocus.current = { rev, which }
    requestAnimationFrame(tryFocus)
  }, [tryFocus])
  useEffect(() => { if (mode.kind === 'list') tryFocus() })
  const toList = useCallback(() => {
    setMode({ kind: 'list' })
    setError(null)
    if (returnRev.current != null) focusRev(returnRev.current.rev, returnRev.current.which)
  }, [focusRev])

  /** Leaving the question without answering, by Back or by Escape: the same words either way. */
  const leaveQuestion = useCallback(() => {
    setMode({ kind: 'list' })
    setError(null)
    say(QUESTION_BACK)
    focusRev(def.rev, 'name')
  }, [say, focusRev, def.rev])

  // A layout effect: the Escape handler must know the level on screen before the next key can arrive (a passive
  // effect left a key pressed right after the question appeared running the confirm's Back instead).
  useLayoutEffect(() => {
    if (!subBackRef) return undefined
    subBackRef.current = () => {
      if (mode.kind === 'list') return false
      if (mode.kind === 'question') { leaveQuestion(); return true }
      toList()
      return true
    }
    return () => { subBackRef.current = null }
  }, [mode, subBackRef, toList, leaveQuestion])

  /** A refusal: a widget gone in another tab leaves the panel; anything else is said and kept beside its control. */
  const refused = (got, where = {}) => {
    if (got.code === 'unavailable') { onGone?.(actionFailure(got)); return }
    const text = actionFailure(got)
    say(text, 'error')
    setError({ ...where, text, conflict: got.code === 'conflict' })
  }

  const restore = async (rev) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const before = def.rev
    const got = await request('POST', `/${enc(d.id)}/revs/${rev.rev}/restore`, { etag: def.etag })
    if (!mounted.current) return
    setBusy(false)
    if (!got.ok) { refused(got, { rev: rev.rev }); return }
    const now = got.data
    setDef(now)
    setRevert(null)
    onChanged?.()
    load()
    const used = Number.isInteger(now.usedIn) ? now.usedIn : 0
    if (used > 1) {
      setAnswer(preselectAnswer({ lastAnswer: now.lastAnswer, kind: 'plan' }))
      setMode({ kind: 'question', before })
      return
    }
    setMode({ kind: 'list' })
    say(`Restored the version from ${versionDate(rev.savedAt)}. It's now the newest version.`)
    returnRev.current = { rev: now.rev, which: 'name' }
    focusRev(now.rev, 'name')
  }

  /** "Save as a new widget"'s second step: this widget back to the version it had before the restore. */
  const revertTo = async (before, etag, copyName) => {
    const back = await request('POST', `/${enc(d.id)}/revs/${before}/restore`, { etag })
    if (!mounted.current) return null
    if (back.ok) {
      setDef(back.data)
      setRevert(null)
      say(copyName
        ? `Saved the restored version as a new widget, “${copyName}”. This widget and its notes are as they were.`
        : 'This widget is back to the version before. Its notes are as they were.')
      return back.data
    }
    if (back.code === 'unavailable') { onGone?.(actionFailure(back)); return null }
    // Still the restored version as the newest. A stale tab needs a fresh etag first (Reload); offline needs the
    // connection; anything else can simply be tried again.
    setRevert({ before, conflict: back.code === 'conflict' })
    say(back.code === 'offline' ? `${COPY.revertFailed} ${COPY.offlineAction}`
      : back.code === 'conflict' ? `${COPY.revertFailed} ${actionFailure(back)}` : COPY.revertFailed, 'error')
    return null
  }

  const settle = async (choice) => {
    if (busy || mode.kind !== 'question') return
    setBusy(true)
    setError(null)
    const got = await request('PUT', `/${enc(d.id)}`, { body: { apply: choice === UPDATE_ALL ? UPDATE_ALL : SAVE_NEW }, etag: def.etag })
    if (!mounted.current) return
    if (!got.ok) { setBusy(false); refused(got); return }
    const used = Number.isInteger(def.usedIn) ? def.usedIn : 0
    let newest = def.rev
    let landed = true
    if (choice === UPDATE_ALL) {
      setDef(got.data)
      newest = got.data?.rev ?? newest
      say(`Restored. All ${used} notes take this version the next time you press See it now.`)
    } else {
      // The copy holds the restored version; save_new does not move this widget's etag.
      const now = await revertTo(mode.before, def.etag, got.data?.name || 'copy')
      if (!mounted.current) return
      if (now) newest = now.rev ?? newest
      else landed = false
    }
    setBusy(false)
    onChanged?.()
    load()
    setMode({ kind: 'list' })
    focusRev(newest, landed ? 'name' : 'revert')
  }

  /** The revert met a stale tab: read the widget again for its etag; the retry then sends that one. */
  const reloadForRevert = async () => {
    if (busy || !revert) return
    setBusy(true)
    const got = await request('GET', `/${enc(d.id)}`)
    if (!mounted.current) return
    setBusy(false)
    if (!got.ok || !isRecord(got.data)) { refused(got); return }
    setDef(got.data)
    setRevert({ before: revert.before, conflict: false })
    say('Loaded the latest version of this widget. You can go back to the version before now.')
    focusRev(null, 'revert')
  }

  const retryRevert = async () => {
    if (busy || !revert || revert.conflict) return
    setBusy(true)
    const now = await revertTo(revert.before, def.etag, null)
    if (!mounted.current) return
    setBusy(false)
    if (now) { onChanged?.(); load(); focusRev(now.rev, 'name') }
  }

  /** After "Changed in another tab": read the widget again (a fresh etag) and its versions. */
  const reload = async () => {
    setError(null)
    const got = await request('GET', `/${enc(d.id)}`)
    if (!mounted.current) return
    if (got.ok && isRecord(got.data)) setDef(got.data)
    else { refused(got); return }
    setMode({ kind: 'list' })
    load()
  }

  const items = revs.status === 'ok' ? revs.items : []
  const current = items.find((r) => r.current) || null
  const base = current?.summary ?? d.summary
  const anyChanged = items.some((r) => !r.current && r.summary !== base)
  const used = Number.isInteger(def.usedIn) ? def.usedIn : 0

  if (mode.kind === 'question') {
    return (
      <RestoreQuestion usedIn={used} answer={answer} onAnswer={setAnswer} busy={busy} onConfirm={settle}
        onBack={leaveQuestion} error={error} onReload={reload} />
    )
  }

  return (
    <div className={styles.pushPanel} data-testid="my-tools-history">
      <PanelHead title={`Version history: ${d.name}`} onBack={onBack} />
      {revs.status === 'loading' && <p className={styles.hint}>{COPY.revsLoading}</p>}
      {revs.status === 'error' && (
        <div className={styles.stateBox}>
          <p className={styles.sentence}>{readFailure(revs.code, COPY.revsFailed)}</p>
          {!NO_RETRY.has(revs.code) && (
            <button type="button" className={styles.btn} onClick={() => { setRevs({ status: 'loading' }); load() }}>Try again</button>
          )}
        </div>
      )}
      {revert && (
        <div className={styles.stateBox} data-testid="revert-retry">
          <p className={styles.inlineError}>{COPY.revertFailed}</p>
          {revert.conflict && (
            <button type="button" className={styles.btn} aria-disabled={busy || undefined} data-rev-action="revert-reload"
              onClick={reloadForRevert}>Reload</button>
          )}
          <button type="button" className={styles.btn} aria-disabled={busy || revert.conflict || undefined} aria-busy={busy || undefined}
            data-rev-action="revert" onClick={retryRevert}>{COPY.revertRetry}</button>
        </div>
      )}
      {revs.status === 'ok' && items.length === 0 && <p className={styles.sentence}>{COPY.revsEmpty}</p>}
      {anyChanged && <p className={styles.hint}>Highlighted words differ from the current version.</p>}
      {error && !error.rev && (
        <div className={styles.stateBox}>
          <p className={styles.inlineError}>{error.text}</p>
          {error.conflict && <button type="button" className={styles.btn} onClick={reload}>Reload</button>}
        </div>
      )}
      <ol ref={listRef} className={styles.revList}>
        {items.map((r) => {
          const naming = mode.kind === 'naming' && mode.rev === r.rev
          const confirming = mode.kind === 'confirm' && mode.rev === r.rev
          const label = versionDate(r.savedAt)
          return (
            <li key={r.rev} className={styles.rev} data-rev={r.rev} data-testid="my-tools-rev">
              <div className={styles.revHead}>
                <span className={styles.revDate}>{label}</span>
                {r.named && <span className={styles.badge} data-testid="rev-name">{r.named}</span>}
                {r.current && <span className={styles.badgeOn}>Current version</span>}
                {r.placed && !r.current && <span className={styles.badge}>In your notes</span>}
              </div>
              <p className={styles.revSummary}>
                {r.tooNew ? COPY.tooNew : <Summary text={r.summary || ''} base={base} isCurrent={r.current} />}
              </p>
              {naming && (
                <NameForm defId={d.id} rev={r} onCancel={toList} onFailed={refused}
                  onSaved={(named) => {
                    returnRev.current = { rev: r.rev, which: 'name' }
                    say(named ? `Named the version from ${label} “${named}”.` : `Removed the name from the version from ${label}.`)
                    load()
                    toList()
                  }} />
              )}
              {confirming && (
                <RestoreConfirm label={label} used={used} busy={busy} error={error?.rev === r.rev ? error : null}
                  onCancel={toList} onRestore={() => restore(r)} onReload={reload} />
              )}
              {!naming && !confirming && (
                <div className={styles.revActions}>
                  <button type="button" className={styles.btn} data-rev-action="name"
                    aria-label={`${r.named ? 'Rename this version' : 'Name this version'}, from ${label}`}
                    onClick={() => { returnRev.current = { rev: r.rev, which: 'name' }; setError(null); setMode({ kind: 'naming', rev: r.rev }) }}>
                    {r.named ? 'Rename this version' : 'Name this version'}
                  </button>
                  {!r.current && (
                    <button type="button" className={styles.btn} data-rev-action="restore" disabled={r.tooNew === true || def.tooNew === true}
                      aria-label={`Restore the version from ${label}`}
                      onClick={() => { returnRev.current = { rev: r.rev, which: 'restore' }; setError(null); setMode({ kind: 'confirm', rev: r.rev }) }}>
                      Restore
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

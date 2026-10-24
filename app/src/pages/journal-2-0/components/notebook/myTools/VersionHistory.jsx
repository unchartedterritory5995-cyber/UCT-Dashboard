import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react'
import { DEFS_URL, getJson, postJson, putJson } from '../../../lib/builtWidgets'
import SaveQuestion, { UPDATE_ALL, SAVE_NEW, preselectAnswer } from '../widgetBuilder/SaveQuestion'
import PanelHead from './PanelHead'
import { COPY, actionFailure, diffWords, postWithIfMatch, readFailure, versionDate } from './myToolsLib'
import styles from './myTools.module.css'

/**
 * Version history (spec 5.8): every kept version of one widget, newest first (`GET /{id}/revs`), each with its date,
 * its name if the member named it, and its summary sentence with the words that differ from the CURRENT version
 * highlighted (a <mark>, underlined as well as tinted, so the difference is never colour alone).
 *
 *  * "Name this version" keeps it for good (`POST /{id}/revs/{rev}/name`); an empty name unnames it.
 *  * Restore asks first, then saves the old version as a NEW version (`POST /{id}/revs/{rev}/restore`, If-Match: the
 *    widget's etag, ruling R-15). Placements stay where they are. When the widget is in more than one note, the
 *    builder's own question follows (SaveQuestion, spec 5.2 step 4):
 *      - Update all N notes: `PUT {apply: 'update_all'}` -- every note takes the restored version on its next
 *        See it now;
 *      - Save as a new widget: `PUT {apply: 'save_new'}` makes the restored version a widget of its own, then this
 *        widget goes back to the version it had before the restore, so "the notes keep the widget as it was" holds
 *        for the widget itself too;
 *      - Back: the restored version stays this widget's newest, and the notes keep what they show.
 *
 * `subBackRef` is WidgetsTab's ref for Escape: it backs out of naming, a confirm or the question before the panel.
 */
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

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

function NameForm({ rev, onCancel, onSaved }) {
  const id = useId()
  const [name, setName] = useState(typeof rev.named === 'string' ? rev.named : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)
  useEffect(() => { input.current?.focus() }, [])
  const send = async (value) => {
    setBusy(true)
    setError('')
    const got = await postJson(`/${encodeURIComponent(String(rev.defId))}/revs/${rev.rev}/name`, { name: value })
    setBusy(false)
    if (got.ok) onSaved(got.data?.named ?? null)
    else setError(actionFailure(got))
  }
  return (
    <form className={styles.inlineForm} onSubmit={(e) => { e.preventDefault(); if (name.trim()) send(name.trim()) }}>
      <label className={styles.fieldLabel} htmlFor={id}>Name for this version</label>
      <input ref={input} id={id} className={styles.input} value={name} maxLength={200}
        onChange={(e) => setName(e.target.value)} aria-invalid={error ? true : undefined} />
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={onCancel}>Cancel</button>
        {rev.named && <button type="button" className={styles.btn} disabled={busy} onClick={() => send('')}>Remove the name</button>}
        <button type="submit" className={styles.btnPrimary} disabled={busy || !name.trim()}
          aria-busy={busy || undefined}>Save name</button>
      </div>
    </form>
  )
}

export default function VersionHistory({ d, onBack, subBackRef, announce, onChanged }) {
  const [revs, setRevs] = useState({ status: 'loading' })
  const [def, setDef] = useState(d)                 // the widget as it now stands: etag, usedIn, lastAnswer, rev
  const [mode, setMode] = useState({ kind: 'list' }) // list | naming | confirm | question
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)          // {rev?, text, conflict?}
  const [answer, setAnswer] = useState(null)
  const mounted = useRef(true)
  const listRef = useRef(null)
  const returnRev = useRef(null)
  useEffect(() => () => { mounted.current = false }, [])

  const read = useCallback(async () => {
    const got = await getJson(`${DEFS_URL}/${encodeURIComponent(String(d.id))}/revs`)
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

  // Focus goes back to the version a step came from (or, after a restore, to the new newest version), once that row
  // is drawn: a restore reloads the list, so the row may arrive a render later.
  const pendingFocus = useRef(null)
  const tryFocus = useCallback(() => {
    const want = pendingFocus.current
    if (!want) return
    const row = listRef.current?.querySelector(`[data-rev="${want.rev}"]`)
    // Only the named control: while a confirm or a name form is still drawn, the row's other buttons are not it.
    const target = row?.querySelector(`[data-rev-action="${want.which}"]`)
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

  // Escape inside the panel backs out of naming, a confirm or the question first.
  useEffect(() => {
    if (!subBackRef) return undefined
    subBackRef.current = () => {
      if (mode.kind === 'list') return false
      if (mode.kind === 'question') { setMode({ kind: 'list' }); return true }
      toList()
      return true
    }
    return () => { subBackRef.current = null }
  }, [mode, subBackRef, toList])

  const restore = async (rev) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const before = def.rev
    const got = await postWithIfMatch(`/${encodeURIComponent(String(d.id))}/revs/${rev.rev}/restore`, {}, def.etag)
    if (!mounted.current) return
    setBusy(false)
    if (!got.ok) {
      setError({ rev: rev.rev, text: actionFailure(got), conflict: got.code === 'conflict' })
      return
    }
    const now = got.data
    setDef(now)
    onChanged?.()
    load()
    const when = versionDate(rev.savedAt)
    const used = Number.isInteger(now.usedIn) ? now.usedIn : 0
    if (used > 1) {
      setAnswer(preselectAnswer({ lastAnswer: now.lastAnswer, kind: 'plan' }))
      setMode({ kind: 'question', restoredFrom: rev, before })
      return
    }
    setMode({ kind: 'list' })
    announce?.(`Restored the version from ${when}. It's now the newest version.`)
    returnRev.current = { rev: now.rev, which: 'name' }
    focusRev(now.rev, 'name')
  }

  const settle = async (choice) => {
    if (busy || mode.kind !== 'question') return
    setBusy(true)
    setError(null)
    const id = encodeURIComponent(String(d.id))
    const got = await putJson(`/${id}`, { apply: choice === UPDATE_ALL ? UPDATE_ALL : SAVE_NEW }, def.etag)
    if (!mounted.current) return
    if (!got.ok) {
      setBusy(false)
      setError({ text: actionFailure(got), conflict: got.code === 'conflict' })
      return
    }
    const used = Number.isInteger(def.usedIn) ? def.usedIn : 0
    let newest = def.rev
    if (choice === UPDATE_ALL) {
      setBusy(false)
      setDef(got.data)
      newest = got.data?.rev ?? newest
      announce?.(`Restored. All ${used} notes take this version the next time you press See it now.`)
    } else {
      // The copy holds the restored version; this widget goes back to what it was before the restore.
      const copy = got.data
      const back = await postWithIfMatch(`/${id}/revs/${mode.before}/restore`, {}, def.etag)
      if (!mounted.current) return
      setBusy(false)
      if (back.ok) { setDef(back.data); newest = back.data?.rev ?? newest }
      announce?.(back.ok
        ? `Saved the restored version as a new widget, “${copy?.name || 'copy'}”. This widget and its notes are as they were.`
        : `Saved the restored version as a new widget, “${copy?.name || 'copy'}”. ${actionFailure(back)}`)
    }
    onChanged?.()
    load()
    setMode({ kind: 'list' })
    focusRev(newest, 'name')
  }

  /** After "Changed in another tab": read the widget again (a fresh etag) and its versions. */
  const reload = async () => {
    setError(null)
    const got = await getJson(`${DEFS_URL}/${encodeURIComponent(String(d.id))}`)
    if (!mounted.current) return
    if (got.ok && isRecord(got.data)) setDef(got.data)
    else setError({ text: actionFailure(got) })
    setMode({ kind: 'list' })
    load()
  }

  const items = revs.status === 'ok' ? revs.items : []
  const current = items.find((r) => r.current) || null
  const base = current?.summary ?? d.summary
  const anyChanged = items.some((r) => !r.current && r.summary !== base)

  if (mode.kind === 'question') {
    return (
      <div className={styles.panel} data-testid="my-tools-history-question">
        <SaveQuestion usedIn={Number.isInteger(def.usedIn) ? def.usedIn : 0} answer={answer} onAnswer={setAnswer}
          fromNote={false} busy={busy} onConfirm={settle}
          onBack={() => {
            setMode({ kind: 'list' })
            announce?.('Restored. Your notes keep what they show until you choose the newer version in each note.')
            focusRev(def.rev, 'name')
          }} />
        {error && <p className={styles.error} role="alert">{error.text}</p>}
      </div>
    )
  }

  return (
    <div className={styles.panel} data-testid="my-tools-history">
      <PanelHead title={`Version history: ${d.name}`} onBack={onBack} />
      {revs.status === 'loading' && <p className={styles.hint} role="status">{COPY.revsLoading}</p>}
      {revs.status === 'error' && (
        <div className={styles.stateBox}>
          <p className={styles.sentence} role="alert">{readFailure(revs.code, COPY.revsFailed)}</p>
          {revs.code !== 'unavailable' && (
            <button type="button" className={styles.btn} onClick={() => { setRevs({ status: 'loading' }); load() }}>Try again</button>
          )}
        </div>
      )}
      {revs.status === 'ok' && items.length === 0 && <p className={styles.sentence}>{COPY.revsEmpty}</p>}
      {anyChanged && <p className={styles.hint}>Highlighted words differ from the current version.</p>}
      {error && !error.rev && (
        <div className={styles.stateBox}>
          <p className={styles.error} role="alert">{error.text}</p>
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
                <NameForm rev={{ ...r, defId: d.id }} onCancel={toList}
                  onSaved={(named) => {
                    returnRev.current = { rev: r.rev, which: 'name' }
                    announce?.(named ? `Named the version from ${label} “${named}”.` : `Removed the name from the version from ${label}.`)
                    load()
                    toList()
                  }} />
              )}
              {confirming && (
                <div className={styles.confirm} role="group" aria-label={`Restore the version from ${label}`}>
                  <p className={styles.sentence}>
                    {`Restore the version from ${label}? It is saved as a new version, so nothing is lost. Your notes keep what they show.`}
                  </p>
                  {error?.rev === r.rev && <p className={styles.error} role="alert">{error.text}</p>}
                  <div className={styles.actions}>
                    {error?.conflict && <button type="button" className={styles.btn} onClick={reload}>Reload</button>}
                    <button type="button" className={styles.btn} onClick={toList}>Cancel</button>
                    <button type="button" className={styles.btnPrimary} disabled={busy} aria-busy={busy || undefined}
                      data-confirm-restore="" onClick={() => restore(r)}>{busy ? 'Restoring…' : 'Restore'}</button>
                  </div>
                </div>
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

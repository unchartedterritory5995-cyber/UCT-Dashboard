import { useCallback, useEffect, useId, useRef, useState } from 'react'
import ContextPopover from '../../../../../components/mobile/ContextPopover'
import UIcon from '../../../../../components/ui/UIcon'
import { useIsTouch } from '../../../../../hooks/useBreakpoint'
import { VIEW_LABELS } from '../widgetBuilder/builderCatalog'
import ViewThumb from './ViewThumb'
import UsedInList from './UsedInList'
import VersionHistory from './VersionHistory'
import DeleteConfirm from './DeleteConfirm'
import PanelHead from './PanelHead'
import {
  FILTERS, LIST_RENDER_MAX, NO_RETRY, RECENTLY_DELETED_DAYS, COPY, usedInText, archiveSentence, editedText, dayText,
  keptUntilText, readFailure, actionFailure, namedPlan, copiedPlan, copyName, request,
} from './myToolsLib'
import styles from './myTools.module.css'

/**
 * My tools, Widgets tab (spec 5.8): the member's saved widgets in three lists, Active · Archived · Recently deleted.
 *
 *  * Each row: the name, a static drawing of its view, "Used in N notes" (which lists those notes, each opening its
 *    note), when it was last edited, and for an adopted widget "Based on X's Y" (no adopted widget exists before
 *    wave 11; the row reads `basedOn: {author, name}` when one does, `author` null for a former member).
 *  * Active: Open (the builder), Rename, Duplicate, Version history, Archive. Archived: Restore, Delete permanently
 *    (the name typed). Recently deleted: Restore, for RECENTLY_DELETED_DAYS. "Share to library" is wave 11.
 *  * Every action is a ContextPopover on the row (a bottom sheet on touch, an anchored menu on desktop); on desktop
 *    the row's main action is also a button of its own.
 *  * A panel (the notes, the versions, rename, archive, delete) pushes in place of the list inside the one sheet;
 *    the list stays mounted, hidden, so Back (or Escape) returns focus to the very row it came from. A row an action
 *    takes away (restore, delete) hands focus to the next row once the list has been read again, or to the heading.
 *  * Rename and every restore send If-Match with the widget's etag (ruling R-15); a stale tab gets the server's own
 *    sentence and a Reload button. A widget gone in another tab (a 404) says so and the list is read again.
 *  * ONE live region for the tab's whole life (`data-testid="my-tools-message"`): only its text changes, so a screen
 *    reader hears every message (a region inserted with its text is often not announced).
 */
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const VIEW_NAME = new Map(VIEW_LABELS)
const enc = (id) => encodeURIComponent(String(id))
/** The row control for widget `id`, by attribute (ids are the server's; quoted, never trusted as a selector). */
const actionsFor = (id) => `[data-actions-for="${String(id).replace(/["\\]/g, '\\$&')}"]`

/** "Based on Sam's Morning edge", or "Based on a former member's …" (spec 5.8, 9). Wave 11 fills `basedOn`. */
function basedOnText(d) {
  const b = isRecord(d?.basedOn) ? d.basedOn : null
  if (!b || typeof b.name !== 'string' || !b.name) return ''
  const who = typeof b.author === 'string' && b.author ? `${b.author}'s` : "a former member's"
  return `Based on ${who} ${b.name}`
}

const listHeading = (filter, n) => {
  if (filter === 'archived') return `${n} archived`
  if (filter === 'deleted') return `${n} recently deleted`
  return `${n} widget${n === 1 ? '' : 's'}`
}

/** A newer version this widget's notes have not taken yet (saved "only here", or restored). */
const pendingVersion = (d) => Number.isInteger(d?.rev) && Number.isInteger(d?.placedRev) && d.rev !== d.placedRev

function Row({ d, filter, phone, touch, highlight, busy, menuOpen, onMenu, onPrimary, onUsedIn }) {
  const view = isRecord(d.plan?.view) ? d.plan.view.type : null
  const viewName = VIEW_NAME.get(view)
  const used = Number.isInteger(d.usedIn) ? d.usedIn : 0
  const based = basedOnText(d)
  const primary = filter === 'live' ? 'Open' : 'Restore'
  const primaryOff = busy || (filter === 'live' && d.tooNew === true)
  return (
    <li className={`${styles.row} ${highlight ? styles.rowHighlight : ''}`} data-def-id={d.id}
      data-highlight={highlight ? '' : undefined} data-testid="my-tools-row">
      <span className={styles.thumb}><ViewThumb view={view} /></span>
      <div className={styles.rowMain}>
        <span className={styles.rowName} title={d.name}>
          {d.name}
          {viewName && <span className={styles.srOnly}>{`, ${viewName}`}</span>}
        </span>
        {!phone && d.summary && <span className={styles.rowSummary} title={d.summary}>{d.summary}</span>}
        <span className={styles.rowMeta}>
          {filter === 'deleted' ? (
            <>
              <span>{`Deleted ${dayText(d.deletedAt)}`}</span>
              <span aria-hidden="true">·</span>
              <span>{keptUntilText(d.deletedAt)}</span>
            </>
          ) : (
            <>
              {!phone && used > 0 ? (
                <button type="button" className={styles.linkBtn} onClick={() => onUsedIn(d)}
                  aria-label={`${usedInText(used)}: list the notes with ${d.name}`}>{usedInText(used)}</button>
              ) : <span>{usedInText(used)}</span>}
              <span aria-hidden="true">·</span>
              <span>{editedText(d.updatedAt)}</span>
            </>
          )}
          {based && <><span aria-hidden="true">·</span><span>{based}</span></>}
        </span>
        {d.tooNew && <span className={styles.rowWarn}>{COPY.tooNew}</span>}
      </div>
      {!phone && (
        <button type="button" className={styles.btn} aria-disabled={primaryOff || undefined}
          aria-busy={busy || undefined} onClick={() => { if (!primaryOff) onPrimary(d) }}
          aria-label={`${primary} ${d.name}`}>{primary}</button>
      )}
      {/* Never disabled while busy: a menu that closes onto a disabled trigger drops focus to the page. The action
          guards itself instead (`act` ignores a second action while one is in flight). */}
      <button type="button" className={styles.moreBtn} aria-label={`Actions for ${d.name}`}
        aria-haspopup={touch ? 'dialog' : 'menu'} aria-expanded={menuOpen} aria-busy={busy || undefined}
        data-actions-for={d.id} onClick={(e) => onMenu(d, e.currentTarget)}>
        <UIcon name="more" size={18} gold={false} />
      </button>
    </li>
  )
}

function RenamePanel({ d: initial, onBack, onDone, onGone, onReloaded, say }) {
  const id = useId()
  const [d, setD] = useState(initial)                // a Reload reads the widget again (a fresh etag), name kept
  const [name, setName] = useState(initial.name || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const input = useRef(null)
  useEffect(() => { input.current?.focus(); input.current?.select?.() }, [])
  const clean = name.trim()
  const used = Number.isInteger(d.usedIn) ? d.usedIn : 0
  // A name is a title-only change, which every note takes (spec 5.2 step 4) -- unless a newer version is waiting
  // that the notes have not taken: then "update all" would push THAT version into every note behind a rename, so
  // the rename stays on this widget ("only") and the notes keep what they show.
  const apply = pendingVersion(d) ? 'only' : 'update_all'
  const fail = (got) => {
    if (got.code === 'unavailable') { onGone(actionFailure(got)); return }
    const text = actionFailure(got)
    say(text, 'error')
    setError({ text, conflict: got.code === 'conflict' })
  }
  const save = async (e) => {
    e.preventDefault()
    if (!clean || clean === d.name || busy) return
    setBusy(true)
    setError(null)
    const got = await request('PUT', `/${enc(d.id)}`, { body: { name: clean, plan: namedPlan(d.plan, clean), apply }, etag: d.etag })
    setBusy(false)
    if (got.ok) onDone(got.data, `Renamed to “${got.data.name || clean}”.`)
    else fail(got)
  }
  const reload = async () => {
    if (busy) return
    setBusy(true)
    const got = await request('GET', `/${enc(d.id)}`)
    setBusy(false)
    if (!got.ok || !isRecord(got.data)) { fail(got); return }
    setD(got.data)
    setError(null)
    onReloaded?.()
    say(`Loaded the latest “${got.data.name}”. Your new name is still here; save it when you're ready.`)
    input.current?.focus()
  }
  const hintText = used > 0 && (apply === 'only'
    ? `This widget has a newer version your ${used === 1 ? 'note has' : `${used} notes have`} not taken yet, so ${used === 1 ? 'it keeps' : 'they keep'} the old name until you update ${used === 1 ? 'it' : 'them'}.`
    : `Your ${used === 1 ? 'note shows' : `${used} notes show`} the new name the next time you press See it now.`)
  const described = [hintText ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className={styles.pushPanel} data-testid="my-tools-rename">
      <PanelHead title={`Rename “${d.name}”`} onBack={onBack} focusHeading={false} />
      <form className={styles.form} onSubmit={save}>
        <label className={styles.fieldLabel} htmlFor={id}>Name</label>
        <input ref={input} id={id} className={styles.input} value={name} maxLength={200}
          aria-describedby={described} aria-invalid={error ? true : undefined}
          onChange={(e) => setName(e.target.value)} />
        {hintText && <p className={styles.hint} id={`${id}-hint`}>{hintText}</p>}
        {error && <p className={styles.inlineError} id={`${id}-err`}>{error.text}</p>}
        <div className={styles.actions}>
          {error?.conflict && <button type="button" className={styles.btn} aria-disabled={busy || undefined} onClick={reload}>Reload</button>}
          <button type="button" className={styles.btn} onClick={onBack}>Cancel</button>
          <button type="submit" className={styles.btnPrimary} aria-disabled={!clean || clean === d.name || busy || undefined}
            aria-busy={busy || undefined}>{busy ? 'Saving…' : 'Save name'}</button>
        </div>
      </form>
    </div>
  )
}

function ArchivePanel({ d, onBack, onArchive, busy, error }) {
  const used = Number.isInteger(d.usedIn) ? d.usedIn : 0
  return (
    <div className={styles.pushPanel} data-testid="my-tools-archive">
      <PanelHead title={`Archive “${d.name}”?`} onBack={onBack} />
      <p className={styles.sentence} data-testid="archive-sentence">{archiveSentence(used)}</p>
      <p className={styles.hint}>It leaves your widget list; you can restore it from Archived.</p>
      {error && <p className={styles.inlineError}>{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={onBack}>Cancel</button>
        <button type="button" className={styles.btnPrimary} aria-disabled={busy || undefined} aria-busy={busy || undefined}
          onClick={() => onArchive(d)}>{busy ? 'Archiving…' : 'Archive'}</button>
      </div>
    </div>
  )
}

const EMPTY = { live: COPY.emptyLive, archived: COPY.emptyArchived, deleted: COPY.emptyDeleted }

export default function WidgetsTab({ phone, defId = null, seek = 0, editor = null, uid = null, navigate = null, onCloseAll }) {
  const touch = useIsTouch()
  const [filter, setFilter] = useState('live')
  const [lists, setLists] = useState({})            // filter -> {status, items?, code?, stale?}
  const [view, setView] = useState({ kind: 'list' })
  const [menu, setMenu] = useState(null)            // {d, anchor}
  const [message, setMessage] = useState(null)      // {text, tone: 'ok' | 'error' | 'quiet'}
  const [busyId, setBusyId] = useState(null)
  const [panelError, setPanelError] = useState(null)
  const [highlight, setHighlight] = useState(defId)
  const rootRef = useRef(null)
  const returnTo = useRef(null)                     // the widget id whose row a panel was opened from
  const focusAfter = useRef(null)                   // {id?, heading?, fallback?, wait?}: where focus goes next
  const [, setTick] = useState(0)
  const subBack = useRef(null)                      // a panel's own inner Back (VersionHistory's naming, its question)
  const mounted = useRef(true)
  const watchers = useRef(new Set())
  const filterId = useId()

  useEffect(() => () => {
    mounted.current = false
    for (const w of watchers.current) w.disconnect()
  }, [])

  // Every message is numbered: the region's child is keyed on the number, so the SAME sentence twice in a row (two
  // identical refusals) is a new node, which a screen reader announces again; replacing equal text is a no-op.
  const say = useCallback((text, tone = 'ok') => setMessage((m) => (text ? { text, tone, n: (m?.n || 0) + 1 } : (m ? { ...m, text: '' } : null))), [])

  const load = useCallback(async (key) => {
    setLists((all) => (all[key]?.status === 'ok' ? all : { ...all, [key]: { status: 'loading' } }))
    const got = await request('GET', `?view=${key}`)
    if (!mounted.current) return null
    const items = got.ok && Array.isArray(got.data.widgets) ? got.data.widgets.filter((w) => isRecord(w) && w.id) : null
    setLists((all) => ({ ...all, [key]: items ? { status: 'ok', items } : { status: 'error', code: got.code } }))
    return items
  }, [])

  /** Read a list again; the others load again when visited (an action moves widgets between lists). Until the new
   *  answer lands, the list on screen stays and is marked `stale`, so focus waits for the truth. */
  const refresh = useCallback((key) => {
    setLists((all) => (all[key] ? { [key]: { ...all[key], stale: true } } : {}))
    return load(key)
  }, [load])

  useEffect(() => { if (!lists[filter]) load(filter) }, [filter, lists, load])

  // A failed read says so in the live region too (quietly: the box on screen already shows it).
  const failedCode = lists[filter]?.status === 'error' ? lists[filter].code : null
  useEffect(() => {
    if (failedCode) say(readFailure(failedCode, COPY.loadFailed), 'quiet')
  }, [failedCode, say])
  // Offline: the list reads itself again when the connection is back.
  useEffect(() => {
    if (failedCode !== 'offline') return undefined
    const back = () => { say(null); refresh(filter) }
    window.addEventListener('online', back)
    return () => window.removeEventListener('online', back)
  }, [failedCode, filter, refresh, say])

  // Opened from a placed widget ("Manage…"), or asked again for another widget while open: show that widget's row
  // and put focus on it. It may be archived.
  // Each ask is its own key (widget + ask number), so the SAME widget asked for again is sought again.
  const seekKey = defId ? `${defId}|${seek}` : null
  const sought = useRef(null)                       // the ask already answered
  const resetting = useRef(false)
  useEffect(() => {
    if (!seekKey || sought.current === seekKey) return
    if (sought.current !== null) {                    // a later "Manage…" while My tools is open
      setHighlight(defId)                             // always the newest ask, even one arriving mid-reset
      if (!resetting.current) {
        resetting.current = true
        setView({ kind: 'list' })
        setMenu(null)
        if (filter !== 'live') { setFilter('live'); return }
      }
    }
    const live = lists.live
    if (live?.status !== 'ok') return
    sought.current = seekKey
    resetting.current = false
    if (live.items.some((w) => w.id === defId)) { focusAfter.current = { id: defId }; setTick((t) => t + 1); return }
    load('archived').then((items) => {
      if (!mounted.current || !items?.some((w) => w.id === defId)) return
      focusAfter.current = { id: defId }
      setFilter('archived')
    })
  }, [seekKey, defId, lists.live, load, filter])

  // ── panels ──────────────────────────────────────────────────────────────────────────────────────
  const push = (kind, d) => {
    returnTo.current = d?.id ?? null
    setPanelError(null)
    setMessage(null)
    setView({ kind, d })
  }
  const back = useCallback(() => {
    setPanelError(null)
    setView({ kind: 'list' })
  }, [])
  useEffect(() => {
    if (view.kind !== 'list' || !returnTo.current) return
    if (!focusAfter.current) focusAfter.current = { id: returnTo.current, fallback: true }
    returnTo.current = null
  }, [view])
  // Focus lands once the element it is for is drawn, and (`wait`) once the list it is in has been read again. A row
  // that is gone hands focus to the list's heading.
  useEffect(() => {
    const want = focusAfter.current
    if (!want || view.kind !== 'list') return
    const root = rootRef.current
    const waited = want.wait ? lists[want.wait] : null
    if (want.wait && (filter !== want.wait || !waited || waited.stale || waited.status === 'loading')) return
    if (want.wait && waited.status === 'error') {
      // The re-read failed: focus goes to the failure's own Try again (or its sentence), now, never later.
      focusAfter.current = null
      const failBox = root?.querySelector('[data-load-failed-box]')
      ;(failBox?.querySelector('button') || failBox?.querySelector('[data-testid="my-tools-load-failed"]'))?.focus()
      return
    }
    const el = want.id && !want.heading ? root?.querySelector(actionsFor(want.id)) : null
    if (el) { focusAfter.current = null; el.focus(); return }
    const heading = root?.querySelector('[data-list-heading]')
    if ((want.fallback || want.heading) && heading) { focusAfter.current = null; heading.focus() }
  })

  /** Where focus goes when `id` leaves list `key`: the next row, else the one before, else the heading. */
  const focusPast = (key, id) => {
    const xs = lists[key]?.items || []
    const i = xs.findIndex((w) => w.id === id)
    const next = i >= 0 ? (xs[i + 1] || xs[i - 1]) : null
    focusAfter.current = next ? { id: next.id, fallback: true, wait: key } : { heading: true, wait: key }
  }

  // Escape: a desktop menu closes first; then a panel goes back one level (its own inner level first); at the list
  // the Sheet's own Escape closes My tools. Only while this sheet is the topmost one: a touch menu is a sheet of its
  // own, above this one, and answers its own Escape.
  const keys = useRef(null)
  keys.current = { menu, view, back }
  useEffect(() => {
    const isTop = () => {
      const panel = rootRef.current?.closest('[data-sheet-panel]')
      const panels = document.querySelectorAll('[data-sheet-panel]')
      return !!panel && panels[panels.length - 1] === panel
    }
    const onKey = (e) => {
      if (e.key !== 'Escape' || !isTop()) return
      const k = keys.current
      if (k.menu) { e.preventDefault(); e.stopPropagation(); setMenu(null); return }
      if (k.view.kind === 'list') return
      e.preventDefault()
      e.stopPropagation()
      if (subBack.current?.()) return
      k.back()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  /** A widget gone in another tab: say so, leave any panel, read the list again. */
  const gone = (text = COPY.gone) => {
    returnTo.current = null
    focusAfter.current = { heading: true, wait: filter }
    setView({ kind: 'list' })
    setPanelError(null)
    say(text, 'error')
    refresh(filter)
  }

  // ── the builder (a separate sheet on its own root) ──────────────────────────────────────────────
  const watchBuilder = () => {
    const host = document.querySelector('[data-widget-builder-root]')
    if (!host || typeof MutationObserver === 'undefined') return
    const obs = new MutationObserver(() => {
      if (host.isConnected) return
      obs.disconnect()
      watchers.current.delete(obs)
      if (mounted.current) refresh('live')       // the builder saved, or not: the list reads the truth again
    })
    obs.observe(document.body, { childList: true })
    watchers.current.add(obs)
  }
  const openBuilder = async (from) => {
    setMenu(null)
    try {
      const mod = await import('../widgetBuilder/openWidgetBuilder.js')
      // Never this sheet's editor: a widget opened from My tools is edited, never inserted into a note. A new one
      // starts from the examples (Task 8.16 fix 1, R-44); a link out of the builder closes My tools too (R-45).
      mod.openWidgetBuilder({
        editor: null, from, uid, ...(from ? {} : { start: 'examples' }),
        ...(typeof navigate === 'function' ? { navigate: (to) => { navigate(to); onCloseAll?.() } } : {}),
      })
      watchBuilder()
    } catch {
      if (mounted.current) say(COPY.builderFailed, 'error')
    }
  }
  const openSets = async () => {
    try {
      const mod = await import('../widgets/SetsDialog')
      mod.openSetsDialog({ editor: editor || (uid ? { storage: { uctJournalWidgets: { uid } } } : null) })
    } catch {
      if (mounted.current) say(COPY.setsFailed, 'error')
    }
  }

  // ── actions ─────────────────────────────────────────────────────────────────────────────────────
  const act = async (d, run, done) => {
    if (busyId) return
    setBusyId(d.id)
    setMessage(null)
    const got = await run()
    if (!mounted.current) return
    setBusyId(null)
    if (got.ok) { done(got.data); return }
    if (got.code === 'unavailable') { gone(actionFailure(got)); return }
    say(actionFailure(got), 'error')
  }
  const duplicate = (d) => {
    const name = copyName(d.name)
    act(d, () => request('POST', '', { body: { name, plan: copiedPlan(d.plan, name) } }), (w) => {
      say(`Made “${w?.name || name}”.`)
      if (w?.id) focusAfter.current = { id: w.id, wait: 'live' }
      refresh('live')
    })
  }
  const doArchive = async (d) => {
    if (busyId) return
    setBusyId(d.id)
    setPanelError(null)
    const got = await request('POST', `/${enc(d.id)}/archive`)
    if (!mounted.current) return
    setBusyId(null)
    if (!got.ok) {
      if (got.code === 'unavailable') { gone(actionFailure(got)); return }
      say(actionFailure(got), 'error')
      if (view.kind === 'archive') setPanelError(actionFailure(got))
      return
    }
    returnTo.current = null
    focusPast('live', d.id)
    setView({ kind: 'list' })
    say(`Archived “${d.name}”. Restore it from Archived.`)
    refresh('live')
  }
  const archive = (d) => {
    if ((d.usedIn || 0) > 0) push('archive', d)
    else doArchive(d)
  }
  const unarchive = (d) => act(d, () => request('POST', `/${enc(d.id)}/unarchive`), () => {
    focusPast('archived', d.id)
    say(`Restored “${d.name}” to your widgets.`)
    refresh('archived')
  })
  const undelete = (d) => act(d, () => request('POST', `/${enc(d.id)}/undelete`), () => {
    focusPast('deleted', d.id)
    say(`Restored “${d.name}”. It's in Archived.`)
    refresh('deleted')
  })

  const primary = (d) => {
    if (filter === 'live') openBuilder({ defId: d.id })
    else if (filter === 'archived') unarchive(d)
    else undelete(d)
  }

  const menuItems = (d) => {
    const used = Number.isInteger(d.usedIn) ? d.usedIn : 0
    const tooNew = d.tooNew === true
    const usedIn = used > 0 ? [{ key: 'used', label: usedInText(used), onClick: () => push('usedIn', d) }] : []
    if (filter === 'deleted') return [{ key: 'restore', label: 'Restore', onClick: () => undelete(d) }]
    if (filter === 'archived') {
      return [
        { key: 'restore', label: 'Restore', onClick: () => unarchive(d) },
        ...usedIn,
        { separator: true },
        { key: 'delete', label: 'Delete permanently', danger: true, onClick: () => push('delete', d),
          hint: `Needs the name typed. Kept in Recently deleted for ${RECENTLY_DELETED_DAYS} days.` },
      ]
    }
    return [
      { key: 'open', label: 'Open', disabled: tooNew, onClick: () => openBuilder({ defId: d.id }) },
      { key: 'rename', label: 'Rename', disabled: tooNew, onClick: () => push('rename', d) },
      { key: 'duplicate', label: 'Duplicate', disabled: tooNew, onClick: () => duplicate(d) },
      { key: 'history', label: 'Version history', onClick: () => push('history', d) },
      ...usedIn,
      { separator: true },
      { key: 'archive', label: 'Archive', onClick: () => archive(d),
        hint: used > 0 ? archiveSentence(used) : 'It leaves your widget list; restore it from Archived.' },
    ]
  }
  const openMenu = (d, el) => {
    if (busyId === d.id) return
    const r = el.getBoundingClientRect()
    setMenu({ d, anchor: { x: Math.max(8, r.right - 220), y: r.bottom + 4 } })
  }

  // ── render ──────────────────────────────────────────────────────────────────────────────────────
  const state = lists[filter]
  const items = state?.status === 'ok' ? state.items : []
  const shown = items.slice(0, LIST_RENDER_MAX)
  const panelDone = (key, after) => (w, text) => {
    after?.()
    if (text) say(text)
    back()
    refresh(key)
  }

  let panel = null
  if (view.kind === 'usedIn') {
    panel = <UsedInList d={view.d} onBack={back} onNavigate={onCloseAll} navigate={navigate} />
  } else if (view.kind === 'history') {
    panel = <VersionHistory d={view.d} onBack={back} subBackRef={subBack} announce={say} onGone={gone}
      onChanged={() => refresh('live')} />
  } else if (view.kind === 'delete') {
    const id = view.d.id
    panel = <DeleteConfirm d={view.d} onBack={back} onGone={gone}
      onDeleted={panelDone('archived', () => { returnTo.current = null; focusPast('archived', id) })} />
  } else if (view.kind === 'rename') {
    panel = <RenamePanel d={view.d} onBack={back} onDone={panelDone('live')} onGone={gone} say={say}
      onReloaded={() => refresh('live')} />
  } else if (view.kind === 'archive') {
    panel = <ArchivePanel d={view.d} onBack={back} onArchive={doArchive} busy={busyId === view.d.id} error={panelError} />
  }

  const tone = message?.tone
  return (
    <div ref={rootRef} className={styles.widgets} data-testid="my-tools-widgets">
      <p className={!message?.text ? styles.liveIdle : tone === 'error' ? styles.error : tone === 'quiet' ? styles.srOnly : styles.status}
        role="status" aria-live="polite" aria-atomic="true" data-tone={tone || undefined}
        data-testid="my-tools-message">{message?.text ? <span key={message.n}>{message.text}</span> : null}</p>
      {panel}
      <div hidden={view.kind !== 'list'} className={styles.listWrap}>
        <div className={styles.toolbar}>
          <div role="group" aria-label="Show" className={styles.filters} id={filterId}>
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" className={`${styles.filter} ${filter === key ? styles.filterOn : ''}`}
                aria-pressed={filter === key} onClick={() => { setFilter(key); setMessage(null); setHighlight(null) }}>
                {label}
              </button>
            ))}
          </div>
          {filter === 'live' && (
            <button type="button" className={styles.btnPrimary} onClick={() => openBuilder(null)}>
              <UIcon name="plus" size={14} gold={false} /> Build a widget
            </button>
          )}
        </div>

        {(!state || state.status === 'loading') && <p className={styles.hint}>{COPY.loading}</p>}
        {state?.status === 'error' && (
          <div className={styles.stateBox} data-load-failed-box="">
            <p className={styles.sentence} tabIndex={-1} data-testid="my-tools-load-failed">{readFailure(state.code, COPY.loadFailed)}</p>
            {!NO_RETRY.has(state.code) && (
              <button type="button" className={styles.btn} onClick={() => { say(null); refresh(filter) }}>Try again</button>
            )}
          </div>
        )}
        {state?.status === 'ok' && (
          <>
            <h3 className={styles.listHeading} tabIndex={-1} data-list-heading="">{listHeading(filter, items.length)}</h3>
            {items.length === 0 ? (
              <div className={styles.stateBox}>
                <p className={styles.sentence} data-testid="my-tools-empty">{EMPTY[filter]}</p>
                {filter === 'live' && (
                  <button type="button" className={styles.btn} onClick={() => openBuilder(null)}>Build a widget</button>
                )}
              </div>
            ) : (
              <ul className={styles.list}>
                {shown.map((d) => (
                  <Row key={d.id} d={d} filter={filter} phone={phone} touch={touch} highlight={highlight === d.id}
                    busy={busyId === d.id} menuOpen={menu?.d.id === d.id} onMenu={openMenu} onPrimary={primary}
                    onUsedIn={(x) => push('usedIn', x)} />
                ))}
              </ul>
            )}
            {items.length > shown.length && (
              <p className={styles.hint}>{`Showing the ${shown.length} most recently changed. ${items.length - shown.length} more are not shown.`}</p>
            )}
          </>
        )}

        {filter === 'live' && (
          <div className={styles.setsRow}>
            <span className={styles.hint}>{COPY.setsHint}</span>
            <button type="button" className={styles.btn} onClick={openSets}>
              <UIcon name="library" size={14} gold={false} /> Manage chart sets
            </button>
          </div>
        )}
      </div>

      {menu && (
        <ContextPopover open onClose={() => setMenu(null)} anchor={menu.anchor} title={menu.d.name}
          items={menuItems(menu.d)} width={240} />
      )}
    </div>
  )
}

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import ContextPopover from '../../../../../components/mobile/ContextPopover'
import UIcon from '../../../../../components/ui/UIcon'
import { useIsTouch } from '../../../../../hooks/useBreakpoint'
import {
  CRUD_COPY, archiveTool, deleteTool, duplicateTool, getTool, listTools, saveTool, undeleteTool, unarchiveTool,
} from '../../../lib/toolsCrud'
import {
  BACK_LABEL, CHECK, COPY as TOOL_COPY, NAME_MAX, RECENTLY_DELETED_DAYS, archiveSentence, charCount, deletedSentence,
  editedText, kindWords, restoredSentence, scheduleWords, usedCount, usedInText,
} from '../routines/toolEditorLib'
import { ArchivePanel, DeletePanel } from '../routines/ToolManage'
import UsedInList from './UsedInList'
import PanelHead from './PanelHead'
import {
  LIBRARY_ACTIONS, LIST_RENDER_MAX, TOOL_FILTERS, TOOL_LIST_COPY, creditText, dayText, fromTemplateText, isLibraryCopy,
  keptUntilText,
} from './myToolsLib'
import { libraryOn, openShare, takeUpdate } from './libraryActions'
import styles from './myTools.module.css'

/**
 * My tools, the Routines and Trackers tabs (spec 5.8, Task 9.18): one component, `kind` 'routine' or 'tracker'. The
 * member's routines (or trackers) in three lists, Active · Archived · Recently deleted, the Widgets tab's pattern.
 *
 *  * Each row: the name, a static glyph (`check` for a routine, `graph` for a tracker), what it is (a routine's
 *    schedule in words, a tracker's kind and unit), "Used in N notes" (which lists those notes), when it was last
 *    edited, "From template: X" when a template made it (wave 11, `settings.fromTemplate`), and the library's credit
 *    line for a copy ("Based on Sam's Morning routine", the server's words).
 *  * The two check-in trackers come FIRST on Trackers, read-only: "From your check-ins", and Open only.
 *  * Active: Open (the editor), Rename, Duplicate, Archive. Archived: Restore, Delete permanently (the name typed).
 *    Recently deleted: Restore, kept RECENTLY_DELETED_DAYS days. While wave 11 and the library are on (Task 11.19):
 *    "Share to library" on the member's own work (never a copy, never a check-in tracker), and "Update from the
 *    library" on a copy the server marks `updateAvailable`.
 *  * Every action is a ContextPopover on the row (a bottom sheet on touch); on desktop the row's main action is also a
 *    button of its own. A panel (the notes, rename, archive, delete) pushes in place of the list; the list stays
 *    mounted, hidden, so Back (or Escape) returns focus to the row it came from.
 *
 * ⛔ ONE authority per behaviour: every read and write is lib/toolsCrud's (which re-reads this tool's placed blocks
 * after a landed write, so nothing here refreshes a block); Restore from Archived is toolsCrud's `unarchiveTool`, the
 * block layer's one restore write (W9-R42); the archive and delete panels, and their sentences, are the editor's own
 * (routines/ToolManage). The server's sentences (the conflict, the count cap, the typed name) are shown as they came.
 * ⛔ Duplicate is keyed in lib/toolsCrud (Task 9.6c, W9-R48): a retry after a lost answer replays the copy, as it reads
 *   NOW. A replayed copy that another tab archived meanwhile is shown in Archived, its row focused (9.6b m-3).
 * ⛔ ONE live region for the tab's whole life (`data-testid="my-tools-message"`), its child keyed per message.
 */
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const FROM_CHECKINS = 'From your check-ins'
/** The row control for tool `id`, by attribute (ids are the server's; quoted, never trusted as a selector). */
const actionsFor = (id) => `[data-actions-for="${String(id).replace(/["\\]/g, '\\$&')}"]`
const failText = (got) => (isRecord(got) && typeof got.message === 'string' && got.message ? got.message : CRUD_COPY.network)

/** What the tool is: a routine's schedule in words, a tracker's kind (and a number's unit). */
function whatText(kind, d) {
  if (kind === 'routine') return scheduleWords(d)
  const unit = d.kind === 'number' && typeof d.unit === 'string' && d.unit.trim() ? d.unit.trim() : ''
  return unit ? `${kindWords(d.kind)} · ${unit}` : kindWords(d.kind)
}

/** "From template: Pre-market prep" when a template made the tool (W11-R13: the title is `settings.fromTemplate`); a
 *  wave 9 template's tool (its key only, no title) reads "From a template", never the key. '' otherwise. */
function templateText(d) {
  const named = fromTemplateText(d)
  if (named) return named
  return typeof d.sourceTemplateKey === 'string' && d.sourceTemplateKey ? 'From a template' : ''
}

/** The check-in trackers first (the server sends them first; this keeps it so whatever order arrives). */
const builtinsFirst = (xs) => [...xs.filter((t) => t.readOnly === true), ...xs.filter((t) => t.readOnly !== true)]

function Row({ kind, d, filter, phone, touch, busy, menuOpen, onMenu, onPrimary, onUsedIn }) {
  const used = usedCount(d)
  const builtin = d.readOnly === true
  const primary = filter === 'active' ? 'Open' : 'Restore'
  const template = templateText(d)
  const credit = creditText(d)
  return (
    <li className={`${styles.row}`} data-tool-id={d.id}
      data-testid="my-tools-tool-row">
      <span className={styles.thumb} aria-hidden="true">
        <UIcon name={kind === 'routine' ? 'check' : 'graph'} size={20} gold={false} />
      </span>
      <div className={styles.rowMain}>
        <span className={styles.rowName} title={d.name}><span data-tool-name="">{d.name}</span></span>
        <span className={styles.rowMeta}>
          {filter === 'deleted' ? (
            <>
              <span>{`Deleted ${dayText(d.deletedAt)}`}</span>
              <span aria-hidden="true">·</span>
              <span>{keptUntilText(d.deletedAt, new Date(), RECENTLY_DELETED_DAYS)}</span>
            </>
          ) : builtin ? (
            <>
              <span>{FROM_CHECKINS}</span>
              <span aria-hidden="true">·</span>
              <span>{whatText(kind, d)}</span>
            </>
          ) : (
            <>
              <span>{whatText(kind, d)}</span>
              <span aria-hidden="true">·</span>
              {!phone && used > 0 ? (
                <button type="button" className={styles.linkBtn} onClick={() => onUsedIn(d)}
                  aria-label={`${usedInText(used)}: list the notes with ${d.name}`}>{usedInText(used)}</button>
              ) : <span>{used > 0 ? usedInText(used) : TOOL_COPY.notInNote}</span>}
              {editedText(d.updatedAt) && <><span aria-hidden="true">·</span><span>{editedText(d.updatedAt)}</span></>}
            </>
          )}
          {template && <><span aria-hidden="true">·</span><span>{template}</span></>}
          {credit && <><span aria-hidden="true">·</span><span data-credit="">{credit}</span></>}
        </span>
      </div>
      {!phone && (
        <button type="button" className={styles.btn} aria-disabled={busy || undefined} aria-busy={busy || undefined}
          onClick={(e) => onPrimary(d, e.currentTarget)} aria-label={`${primary} ${d.name}`}>{primary}</button>
      )}
      {/* Neither button is ever `disabled` while busy (a control that loses focus drops it to the page): the Restore
          above is aria-disabled, and ONE guard, in `act`, ignores a second action while one is in flight. */}
      <button type="button" className={styles.moreBtn} aria-label={`Actions for ${d.name}`}
        aria-haspopup={touch ? 'dialog' : 'menu'} aria-expanded={menuOpen} aria-busy={busy || undefined}
        data-actions-for={d.id} onClick={(e) => onMenu(d, e.currentTarget)}>
        <UIcon name="more" size={18} gold={false} />
      </button>
    </li>
  )
}

/** Rename: the name only, `saveTool` with If-Match (the tool's etag). A stale tab gets the server's own sentence and
 *  Reload, which reads the tool again (a fresh etag) and keeps the name the member typed. */
function RenamePanel({ kind, d: initial, onBack, onDone, onGone, onConflict, say, backLabel }) {
  const id = useId()
  const [d, setD] = useState(initial)
  const [name, setName] = useState(initial.name || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const input = useRef(null)
  useEffect(() => { input.current?.focus(); input.current?.select?.() }, [])
  const clean = name.trim()
  const fail = (got) => {
    if (got.code === 'missing') { onGone(failText(got)); return }
    const text = failText(got)
    say(text, 'error')
    setError({ text, conflict: got.code === 'conflict' })
    if (got.code === 'conflict') onConflict?.()
  }
  const save = async (e) => {
    e.preventDefault()
    if (busy || clean === d.name) return
    // The client's own check, in the SERVER'S words for the same rule: a refusal costs no request.
    const check = !clean ? (kind === 'routine' ? CHECK.routineName : CHECK.trackerName)
      : charCount(clean) > NAME_MAX ? CHECK.nameLong : ''
    if (check) {
      say(check, 'error')
      setError({ text: check, conflict: false })
      input.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    const got = await saveTool(kind, d.id, d.etag, { name: clean })
    setBusy(false)
    if (got.ok) onDone(got.data, `Renamed to “${(isRecord(got.data) && got.data.name) || clean}”.`)
    else fail(got)
  }
  const reload = async () => {
    if (busy) return
    setBusy(true)
    const got = await getTool(kind, d.id)
    setBusy(false)
    if (!got.ok || !isRecord(got.data)) { fail(got); return }
    setD(got.data)
    setError(null)
    say(`Loaded the latest “${got.data.name}”. Your new name is still here; save it when you're ready.`)
    input.current?.focus()
  }
  return (
    <div className={styles.pushPanel} data-testid="my-tools-rename">
      <PanelHead title={`Rename “${d.name}”`} onBack={onBack} focusHeading={false} backLabel={backLabel} />
      <form className={styles.form} onSubmit={save}>
        <label className={styles.fieldLabel} htmlFor={id}>Name</label>
        <input ref={input} id={id} className={styles.input} value={name}
          aria-describedby={error ? `${id}-err` : undefined} aria-invalid={error ? true : undefined}
          onChange={(e) => setName(e.target.value)} />
        {error && <p className={styles.inlineError} id={`${id}-err`}>{error.text}</p>}
        <div className={styles.actions}>
          {error?.conflict && <button type="button" className={styles.btn} aria-disabled={busy || undefined} onClick={reload}>Reload</button>}
          <button type="button" className={styles.btn} onClick={onBack}>Cancel</button>
          <button type="submit" className={styles.btnPrimary} aria-disabled={clean === d.name || busy || undefined}
            aria-busy={busy || undefined}>{busy ? 'Saving…' : 'Save name'}</button>
        </div>
      </form>
    </div>
  )
}

export default function ToolsTab({ kind, phone, navigate = null, onCloseAll }) {
  const L = TOOL_LIST_COPY[kind]
  const touch = useIsTouch()
  const [filter, setFilter] = useState('active')
  const [lists, setLists] = useState({})            // filter -> {status, items?, code?, message?, stale?}
  const [view, setView] = useState({ kind: 'list' })
  const [menu, setMenu] = useState(null)            // {d, anchor}
  const [message, setMessage] = useState(null)      // {text, tone: 'ok' | 'error' | 'quiet', n}
  const [busyId, setBusyId] = useState(null)
  const [panelError, setPanelError] = useState(null)
  const rootRef = useRef(null)
  const returnTo = useRef(null)                     // the tool id whose row a panel was opened from
  const focusAfter = useRef(null)                   // {id?, heading?, fallback?, wait?}: where focus goes next
  const mounted = useRef(true)
  const watchers = useRef(new Set())
  const filterRef = useRef(filter)
  filterRef.current = filter
  const backLabel = BACK_LABEL.list(kind)

  useEffect(() => () => {
    mounted.current = false
    for (const w of watchers.current) w.disconnect()
  }, [])

  // Every message is numbered: the region's child is keyed on the number, so the SAME sentence twice in a row is a new
  // node, which a screen reader announces again.
  const say = useCallback((text, tone = 'ok') => setMessage((m) => (text ? { text, tone, n: (m?.n || 0) + 1 } : (m ? { ...m, text: '' } : null))), [])

  const load = useCallback(async (key) => {
    setLists((all) => (all[key]?.status === 'ok' ? all : { ...all, [key]: { status: 'loading' } }))
    const got = await listTools(kind, key)
    if (!mounted.current) return null
    const raw = got.ok && Array.isArray(got.data) ? got.data.filter((t) => isRecord(t) && t.id) : null
    const items = raw && key === 'active' ? builtinsFirst(raw) : raw
    setLists((all) => ({ ...all, [key]: items ? { status: 'ok', items } : { status: 'error', code: got.code, message: got.message } }))
    return items
  }, [kind])

  /** Read a list again; the others load again when visited (an action moves tools between lists). Until the new
   *  answer lands, the list on screen stays and is marked `stale`, so focus waits for the truth. */
  const refresh = useCallback((key) => {
    setLists((all) => (all[key] ? { [key]: { ...all[key], stale: true } } : {}))
    return load(key)
  }, [load])

  useEffect(() => { if (!lists[filter]) load(filter) }, [filter, lists, load])

  const readText = (s) => (s.code === 'offline' ? L.offlineList : s.code === 'network' || !s.message ? L.loadFailed : s.message)
  const failed = lists[filter]?.status === 'error' ? lists[filter] : null
  const failedCode = failed?.code || null
  // A failed read says so in the live region too (quietly: the box on screen already shows it).
  useEffect(() => {
    if (failed) say(readText(failed), 'quiet')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedCode, say])
  // Offline: the list reads itself again when the connection is back.
  useEffect(() => {
    if (failedCode !== 'offline') return undefined
    const back = () => { say(null); refresh(filter) }
    window.addEventListener('online', back)
    return () => window.removeEventListener('online', back)
  }, [failedCode, filter, refresh, say])

  // ── panels ──────────────────────────────────────────────────────────────────────────────────────
  const push = (k, d) => {
    returnTo.current = d?.id ?? null
    setPanelError(null)
    setMessage(null)
    setMenu(null)
    setView({ kind: k, d })
  }
  // A panel that ended on a stale tab (a rename conflict) leaves a stale row: leaving it reads the list again, so the
  // next Rename starts from the newer version (its etag) rather than conflicting a second time.
  const staleOnLeave = useRef(false)
  const back = useCallback(() => {
    setPanelError(null)
    setView({ kind: 'list' })
    if (staleOnLeave.current) {
      staleOnLeave.current = false
      refresh(filterRef.current)
    }
  }, [refresh])
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
    const i = xs.findIndex((t) => t.id === id)
    const next = i >= 0 ? (xs[i + 1] || xs[i - 1]) : null
    focusAfter.current = next ? { id: next.id, fallback: true, wait: key } : { heading: true, wait: key }
  }

  // Escape: a desktop menu closes first; then a panel goes back one level; at the list the Sheet's own Escape closes
  // My tools. Only while this sheet is the topmost one (an editor or a touch menu is a sheet of its own, above it).
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
      k.back()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  /** A tool gone in another tab: say so, leave any panel, read the list again. */
  const gone = (text) => {
    returnTo.current = null
    focusAfter.current = { heading: true, wait: filter }
    setView({ kind: 'list' })
    setPanelError(null)
    say(text, 'error')
    refresh(filter)
  }

  // ── the editor (a separate sheet on its own root, routines/mountEditor) ─────────────────────────
  const watchEditor = () => {
    const host = document.querySelector(`[data-${kind}-editor-root]`)
    if (!host || typeof MutationObserver === 'undefined') return
    const obs = new MutationObserver(() => {
      if (host.isConnected) return
      obs.disconnect()
      watchers.current.delete(obs)
      // The editor saved, archived, duplicated or did nothing: the list reads the truth again.
      if (mounted.current) refresh(filterRef.current)
    })
    obs.observe(document.body, { childList: true })
    watchers.current.add(obs)
  }
  const openEditor = async (d, from) => {
    setMenu(null)
    const opts = {
      returnFocus: from && from.isConnected ? from : null,
      announce: (text) => { if (mounted.current) say(text, 'error') },
      // A note link out of the editor closes My tools too (the Widgets tab's rule, R-45).
      ...(typeof navigate === 'function' ? { navigate: (to) => { navigate(to); onCloseAll?.() } } : {}),
    }
    try {
      if (kind === 'routine') {
        const mod = await import('../routines/openRoutineEditor.js')
        mod.openRoutineEditor({ ...opts, routineId: d?.id ?? null })
      } else {
        const mod = await import('../routines/openTrackerEditor.js')
        mod.openTrackerEditor({ ...opts, trackerId: d?.id ?? null })
      }
      watchEditor()
    } catch {
      if (mounted.current) say(L.editorFailed, 'error')
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
    if (got.code === 'missing') { gone(failText(got)); return }
    say(failText(got), 'error')
  }
  const duplicate = (d) => act(d, () => duplicateTool(kind, d.id), (t) => {
    if (isRecord(t) && t.archived === true) {
      // 9.6b m-3: a replayed copy that was archived in another tab is in Archived (Restore is its row's action).
      say(CRUD_COPY.copyArchived)
      if (t.id) focusAfter.current = { id: t.id, wait: 'archived' }
      setFilter('archived')
      refresh('archived')
      return
    }
    say(`Made “${(isRecord(t) && t.name) || `${d.name} copy`}”.`)
    if (isRecord(t) && t.id) focusAfter.current = { id: t.id, wait: 'active' }
    refresh('active')
  })
  const doArchive = async (d) => {
    if (busyId) return
    setBusyId(d.id)
    setPanelError(null)
    const got = await archiveTool(kind, d.id)
    if (!mounted.current) return
    setBusyId(null)
    if (!got.ok) {
      if (got.code === 'missing') { gone(failText(got)); return }
      say(failText(got), 'error')
      if (view.kind === 'archive') setPanelError(failText(got))
      return
    }
    returnTo.current = null
    focusPast('active', d.id)
    setView({ kind: 'list' })
    say(`Archived “${d.name}”. Restore it from Archived.`)
    refresh('active')
  }
  const archive = (d) => {
    if (usedCount(d) > 0) push('archive', d)
    else { setMenu(null); doArchive(d) }
  }
  const remove = async (d, typedName) => {
    if (busyId) return
    setBusyId(d.id)
    setPanelError(null)
    const got = await deleteTool(kind, d.id, typedName)
    if (!mounted.current) return
    setBusyId(null)
    if (!got.ok) {
      if (got.code === 'missing') { gone(failText(got)); return }
      say(failText(got), 'error')
      setPanelError(failText(got))
      return
    }
    returnTo.current = null
    focusPast('archived', d.id)
    setView({ kind: 'list' })
    say(deletedSentence(d.name))
    refresh('archived')
  }
  const unarchive = (d) => act(d, () => unarchiveTool(kind, d.id), () => {
    focusPast('archived', d.id)
    say(restoredSentence(d.name))
    refresh('archived')
  })
  const undelete = (d) => act(d, () => undeleteTool(kind, d.id), () => {
    focusPast('deleted', d.id)
    say(`Restored “${d.name}”. It's in Archived.`)
    refresh('deleted')
  })

  // ── the library (wave 11, Task 11.19) ───────────────────────────────────────────────────────────
  const share = async (d) => {
    setMenu(null)
    const got = await openShare({ kind, id: d.id, onDone: (text) => { if (mounted.current) say(text) } })
    if (!got.ok && mounted.current) say(got.text, 'error')
  }
  const update = (d) => act(d, async () => {
    const got = await takeUpdate({ kind, d, onSheetDone: () => { if (mounted.current) refresh(filterRef.current) } })
    return got.ok ? { ok: true, data: got } : { ok: false, code: got.code, message: got.text }
  }, (out) => {
    if (out?.opened) return
    say(out?.text || LIBRARY_ACTIONS.updated(d.name))
    refresh('active')
  })

  const rowControl = (d) => rootRef.current?.querySelector(actionsFor(d.id)) || null
  const primary = (d, from) => {
    if (filter === 'active') openEditor(d, from)
    else if (filter === 'archived') unarchive(d)
    else undelete(d)
  }

  const menuItems = (d) => {
    const used = usedCount(d)
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
    const open = { key: 'open', label: 'Open', onClick: () => openEditor(d, rowControl(d)) }
    if (d.readOnly === true) return [open]                // a check-in tracker: read-only, Open only
    const copy = isLibraryCopy(d)
    const library = !libraryOn() ? []
      : copy ? (d.updateAvailable === true ? [{ key: 'update', label: LIBRARY_ACTIONS.update, onClick: () => { setMenu(null); update(d) } }] : [])
        : [{ key: 'share', label: LIBRARY_ACTIONS.share, onClick: () => share(d) }]
    return [
      open,
      { key: 'rename', label: 'Rename', onClick: () => push('rename', d) },
      { key: 'duplicate', label: 'Duplicate', onClick: () => { setMenu(null); duplicate(d) } },
      ...library,
      ...usedIn,
      { separator: true },
      { key: 'archive', label: 'Archive', onClick: () => archive(d), hint: archiveSentence(used) },
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
  const heading = filter === 'archived' ? `${items.length} archived`
    : filter === 'deleted' ? `${items.length} recently deleted` : L.heading(items.length)
  const empty = { active: L.emptyActive, archived: L.emptyArchived, deleted: L.emptyDeleted }[filter]

  let panel = null
  if (view.kind === 'usedIn') {
    panel = <UsedInList d={view.d} kind={kind} onBack={back} onNavigate={onCloseAll} navigate={navigate} backLabel={backLabel} />
  } else if (view.kind === 'rename') {
    panel = <RenamePanel kind={kind} d={view.d} onBack={back} onGone={gone} say={say} backLabel={backLabel}
      onConflict={() => { staleOnLeave.current = true }}
      onDone={(t, text) => { staleOnLeave.current = false; say(text); back(); refresh('active') }} />
  } else if (view.kind === 'archive' || view.kind === 'delete') {
    const Panel = view.kind === 'archive' ? ArchivePanel : DeletePanel
    panel = (
      <div className={styles.pushPanel} data-testid={`my-tools-${view.kind}`}>
        <Panel kind={kind} tool={view.d} busy={busyId === view.d.id} onBack={back} backLabel={backLabel}
          error={panelError || ''}
          onConfirm={view.kind === 'archive' ? () => doArchive(view.d) : (typed) => remove(view.d, typed)} />
      </div>
    )
  }

  const tone = message?.tone
  return (
    <div ref={rootRef} className={styles.widgets} data-testid={`my-tools-${kind}s`}>
      <p className={!message?.text ? styles.liveIdle : tone === 'error' ? styles.error : tone === 'quiet' ? styles.srOnly : styles.status}
        role="status" aria-live="polite" aria-atomic="true" data-tone={tone || undefined}
        data-testid="my-tools-message">{message?.text ? <span key={message.n}>{message.text}</span> : null}</p>
      {panel}
      <div hidden={view.kind !== 'list'} className={styles.listWrap}>
        <div className={styles.toolbar}>
          <div role="group" aria-label="Show" className={styles.filters}>
            {TOOL_FILTERS.map(([key, label]) => (
              <button key={key} type="button" className={`${styles.filter} ${filter === key ? styles.filterOn : ''}`}
                aria-pressed={filter === key} onClick={() => { setFilter(key); setMessage(null) }}>
                {label}
              </button>
            ))}
          </div>
          {filter === 'active' && (
            <button type="button" className={styles.btnPrimary} onClick={(e) => openEditor(null, e.currentTarget)}>
              <UIcon name="plus" size={14} gold={false} /> {L.make}
            </button>
          )}
        </div>

        {(!state || state.status === 'loading') && <p className={styles.hint}>{L.loading}</p>}
        {state?.status === 'error' && (
          <div className={styles.stateBox} data-load-failed-box="">
            <p className={styles.sentence} tabIndex={-1} data-testid="my-tools-load-failed">{readText(state)}</p>
            {state.code !== 'unavailable' && state.code !== 'paid' && (
              <button type="button" className={styles.btn} onClick={() => { say(null); refresh(filter) }}>Try again</button>
            )}
          </div>
        )}
        {state?.status === 'ok' && (
          <>
            <h3 className={styles.listHeading} tabIndex={-1} data-list-heading="">{heading}</h3>
            {items.length === 0 ? (
              <div className={styles.stateBox}>
                <p className={styles.sentence} data-testid="my-tools-empty">{empty}</p>
              </div>
            ) : (
              <ul className={styles.list}>
                {shown.map((d) => (
                  <Row key={d.id} kind={kind} d={d} filter={filter} phone={phone} touch={touch}
                    busy={busyId === d.id} menuOpen={menu?.d.id === d.id}
                    onMenu={openMenu} onPrimary={primary} onUsedIn={(x) => push('usedIn', x)} />
                ))}
              </ul>
            )}
            {items.length > shown.length && (
              <p className={styles.hint}>{`Showing the ${shown.length} most recently changed. ${items.length - shown.length} more are not shown.`}</p>
            )}
          </>
        )}
      </div>

      {menu && (
        <ContextPopover open onClose={() => setMenu(null)} anchor={menu.anchor} title={menu.d.name}
          items={menuItems(menu.d)} width={240} />
      )}
    </div>
  )
}

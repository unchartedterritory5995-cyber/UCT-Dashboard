import { useCallback, useEffect, useId, useRef, useState } from 'react'
import ContextPopover from '../../../../../components/mobile/ContextPopover'
import UIcon from '../../../../../components/ui/UIcon'
import { DEFS_URL, getJson, postJson, putJson } from '../../../lib/builtWidgets'
import { VIEW_LABELS } from '../widgetBuilder/builderCatalog'
import ViewThumb from './ViewThumb'
import UsedInList from './UsedInList'
import VersionHistory from './VersionHistory'
import DeleteConfirm from './DeleteConfirm'
import PanelHead from './PanelHead'
import {
  FILTERS, LIST_RENDER_MAX, RECENTLY_DELETED_DAYS, COPY, usedInText, archiveSentence, editedText, dayText,
  keptUntilText, readFailure, actionFailure, namedPlan, copiedPlan, copyName,
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
 *    the list stays mounted, hidden, so Back (or Escape) returns focus to the very row it came from.
 *  * Rename and every restore send If-Match with the widget's etag (ruling R-15); a stale tab gets the server's
 *    "Changed in another tab. Reload to see the newer version." and a Reload button. Every refusal shows the server's
 *    own sentence (`actionFailure`).
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

function Row({ d, filter, phone, highlight, busy, onMenu, onPrimary, onUsedIn }) {
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
        <span className={styles.rowName}>
          {d.name}
          {viewName && <span className={styles.srOnly}>{`, ${viewName}`}</span>}
        </span>
        {!phone && d.summary && <span className={styles.rowSummary}>{d.summary}</span>}
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
        <button type="button" className={styles.btn} disabled={primaryOff} onClick={() => onPrimary(d)}
          aria-label={`${primary} ${d.name}`}>{primary}</button>
      )}
      <button type="button" className={styles.moreBtn} aria-label={`Actions for ${d.name}`} aria-haspopup="menu"
        data-actions-for={d.id} disabled={busy} onClick={(e) => onMenu(d, e.currentTarget)}>
        <UIcon name="more" size={18} gold={false} />
      </button>
    </li>
  )
}

function RenamePanel({ d, onBack, onDone }) {
  const id = useId()
  const [name, setName] = useState(d.name || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const input = useRef(null)
  useEffect(() => { input.current?.focus(); input.current?.select?.() }, [])
  const clean = name.trim()
  const used = Number.isInteger(d.usedIn) ? d.usedIn : 0
  const save = async (e) => {
    e.preventDefault()
    if (!clean || clean === d.name || busy) return
    setBusy(true)
    setError(null)
    // A name is a title-only change, which every note takes (spec 5.2 step 4: a title-only change is "Update all"),
    // so a rename never leaves the notes with an "Updated version available" that changes nothing they show.
    const got = await putJson(`/${enc(d.id)}`, { name: clean, plan: namedPlan(d.plan, clean), apply: 'update_all' }, d.etag)
    setBusy(false)
    if (got.ok) onDone(got.data, `Renamed to “${got.data.name || clean}”.`)
    else setError({ text: actionFailure(got), conflict: got.code === 'conflict' })
  }
  return (
    <div className={styles.panel} data-testid="my-tools-rename">
      <PanelHead title={`Rename “${d.name}”`} onBack={onBack} focusHeading={false} />
      <form className={styles.form} onSubmit={save}>
        <label className={styles.fieldLabel} htmlFor={id}>Name</label>
        <input ref={input} id={id} className={styles.input} value={name} maxLength={200}
          aria-describedby={used > 0 ? `${id}-hint` : undefined} aria-invalid={error ? true : undefined}
          onChange={(e) => setName(e.target.value)} />
        {used > 0 && (
          <p className={styles.hint} id={`${id}-hint`}>
            {`Your ${used === 1 ? 'note shows' : `${used} notes show`} the new name the next time you press See it now.`}
          </p>
        )}
        {error && <p className={styles.error} role="alert">{error.text}</p>}
        <div className={styles.actions}>
          {error?.conflict && <button type="button" className={styles.btn} onClick={() => onDone(null, '')}>Reload</button>}
          <button type="button" className={styles.btn} onClick={onBack}>Cancel</button>
          <button type="submit" className={styles.btnPrimary} disabled={!clean || clean === d.name || busy}
            aria-busy={busy || undefined}>{busy ? 'Saving…' : 'Save name'}</button>
        </div>
      </form>
    </div>
  )
}

function ArchivePanel({ d, onBack, onArchive, busy, error }) {
  const used = Number.isInteger(d.usedIn) ? d.usedIn : 0
  return (
    <div className={styles.panel} data-testid="my-tools-archive">
      <PanelHead title={`Archive “${d.name}”?`} onBack={onBack} />
      <p className={styles.sentence} data-testid="archive-sentence">{archiveSentence(used)}</p>
      <p className={styles.hint}>It leaves your widget list; you can restore it from Archived.</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={onBack}>Cancel</button>
        <button type="button" className={styles.btnPrimary} disabled={busy} aria-busy={busy || undefined}
          onClick={() => onArchive(d)}>{busy ? 'Archiving…' : 'Archive'}</button>
      </div>
    </div>
  )
}

const EMPTY = { live: COPY.emptyLive, archived: COPY.emptyArchived, deleted: COPY.emptyDeleted }

export default function WidgetsTab({ phone, defId = null, editor = null, uid = null, onCloseAll }) {
  const [filter, setFilter] = useState('live')
  const [lists, setLists] = useState({})            // filter -> {status: 'loading'|'ok'|'error', items?, code?}
  const [view, setView] = useState({ kind: 'list' })
  const [menu, setMenu] = useState(null)            // {d, anchor}
  const [message, setMessage] = useState(null)      // {text, tone}
  const [busyId, setBusyId] = useState(null)
  const [panelError, setPanelError] = useState(null)
  const [highlight, setHighlight] = useState(defId)
  const rootRef = useRef(null)
  const returnTo = useRef(null)                     // the widget id whose row a panel was opened from
  const focusAfter = useRef(null)                   // {id} | {id, fallback} | {heading}: where focus goes next
  const [, setTick] = useState(0)
  const subBack = useRef(null)                      // a panel's own inner Back (VersionHistory's naming, its question)
  const mounted = useRef(true)
  const watchers = useRef(new Set())
  const filterId = useId()

  useEffect(() => () => {
    mounted.current = false
    for (const w of watchers.current) w.disconnect()
  }, [])

  const load = useCallback(async (key) => {
    setLists((all) => (all[key]?.status === 'ok' ? all : { ...all, [key]: { status: 'loading' } }))
    const got = await getJson(`${DEFS_URL}?view=${key}`)
    if (!mounted.current) return null
    const items = got.ok && Array.isArray(got.data.widgets) ? got.data.widgets.filter((w) => isRecord(w) && w.id) : null
    setLists((all) => ({ ...all, [key]: items ? { status: 'ok', items } : { status: 'error', code: got.code } }))
    return items
  }, [])

  /** Reload the list on screen; the others load again when visited (an action moves widgets between lists). */
  const refresh = useCallback((key) => {
    setLists((all) => ({ [key]: all[key] }))
    return load(key)
  }, [load])

  useEffect(() => { if (!lists[filter]) load(filter) }, [filter, lists, load])

  // Opened from a placed widget ("Manage…"): show that widget's row and put focus on it. It may be archived.
  const sought = useRef(false)
  useEffect(() => {
    if (!defId || sought.current) return
    const live = lists.live
    if (live?.status !== 'ok') return
    sought.current = true
    if (live.items.some((w) => w.id === defId)) { focusAfter.current = { id: defId }; setTick((t) => t + 1); return }
    load('archived').then((items) => {
      if (!mounted.current || !items?.some((w) => w.id === defId)) return
      focusAfter.current = { id: defId }
      setFilter('archived')
    })
  }, [defId, lists.live, load])

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
    focusAfter.current = { id: returnTo.current, fallback: true }
    returnTo.current = null
  }, [view])
  // Focus lands once the element it is for is drawn (a list may arrive a render or a request later). A row that is
  // gone (archived, deleted) hands focus to the list's heading.
  useEffect(() => {
    const want = focusAfter.current
    if (!want || view.kind !== 'list') return
    const root = rootRef.current
    const el = want.heading ? null : root?.querySelector(actionsFor(want.id))
    if (el && !el.disabled) { focusAfter.current = null; el.focus(); return }
    const heading = root?.querySelector('[data-list-heading]')
    if ((want.fallback || want.heading) && heading) { focusAfter.current = null; heading.focus() }
  })

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

  const say = (text, tone = 'ok') => setMessage(text ? { text, tone } : null)

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
      // Never this sheet's editor: a widget opened from My tools is edited, never inserted into a note.
      mod.openWidgetBuilder({ editor: null, from, uid })
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
    say(actionFailure(got), 'error')
  }
  const duplicate = (d) => {
    const name = copyName(d.name)
    act(d, () => postJson('', { name, plan: copiedPlan(d.plan, name) }), (w) => {
      say(`Made “${w?.name || name}”.`)
      refresh('live')
    })
  }
  const doArchive = async (d) => {
    if (busyId) return
    setBusyId(d.id)
    setPanelError(null)
    const got = await postJson(`/${enc(d.id)}/archive`, {})
    if (!mounted.current) return
    setBusyId(null)
    if (!got.ok) {
      if (view.kind === 'archive') setPanelError(actionFailure(got))
      else say(actionFailure(got), 'error')
      return
    }
    returnTo.current = null
    setView({ kind: 'list' })
    say(`Archived “${d.name}”. Restore it from Archived.`)
    focusAfter.current = { heading: true }
    refresh('live')
  }
  const archive = (d) => {
    if ((d.usedIn || 0) > 0) push('archive', d)
    else doArchive(d)
  }
  const unarchive = (d) => act(d, () => postJson(`/${enc(d.id)}/unarchive`, {}), () => {
    say(`Restored “${d.name}” to your widgets.`)
    refresh('archived')
  })
  const undelete = (d) => act(d, () => postJson(`/${enc(d.id)}/undelete`, {}), () => {
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
    const r = el.getBoundingClientRect()
    setMenu({ d, anchor: { x: Math.max(8, r.right - 220), y: r.bottom + 4 } })
  }

  // ── render ──────────────────────────────────────────────────────────────────────────────────────
  const state = lists[filter]
  const items = state?.status === 'ok' ? state.items : []
  const shown = items.slice(0, LIST_RENDER_MAX)
  const panelDone = (key) => (w, text) => {
    if (text) say(text)
    back()
    refresh(key)
  }

  let panel = null
  if (view.kind === 'usedIn') {
    panel = <UsedInList d={view.d} onBack={back} onNavigate={onCloseAll} />
  } else if (view.kind === 'history') {
    panel = <VersionHistory d={view.d} onBack={back} subBackRef={subBack} announce={(t) => say(t)}
      onChanged={() => refresh('live')} />
  } else if (view.kind === 'delete') {
    panel = <DeleteConfirm d={view.d} onBack={back} onDeleted={panelDone('archived')} />
  } else if (view.kind === 'rename') {
    panel = <RenamePanel d={view.d} onBack={back} onDone={panelDone('live')} />
  } else if (view.kind === 'archive') {
    panel = <ArchivePanel d={view.d} onBack={back} onArchive={doArchive} busy={busyId === view.d.id} error={panelError} />
  }

  return (
    <div ref={rootRef} className={styles.widgets} data-testid="my-tools-widgets">
      {message && (
        <p className={message.tone === 'error' ? styles.error : styles.status} role={message.tone === 'error' ? 'alert' : 'status'}
          data-testid="my-tools-message">{message.text}</p>
      )}
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

        {(!state || state.status === 'loading') && <p className={styles.hint} role="status">{COPY.loading}</p>}
        {state?.status === 'error' && (
          <div className={styles.stateBox}>
            <p className={styles.sentence} role="alert">{readFailure(state.code, COPY.loadFailed)}</p>
            {state.code !== 'unavailable' && (
              <button type="button" className={styles.btn} onClick={() => refresh(filter)}>Try again</button>
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
                  <Row key={d.id} d={d} filter={filter} phone={phone} highlight={highlight === d.id}
                    busy={busyId === d.id} onMenu={openMenu} onPrimary={primary} onUsedIn={(x) => push('usedIn', x)} />
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

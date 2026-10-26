import { useCallback, useEffect, useId, useRef, useState } from 'react'
import ContextPopover from '../../../../../components/mobile/ContextPopover'
import UIcon from '../../../../../components/ui/UIcon'
import { useIsTouch } from '../../../../../hooks/useBreakpoint'
import { BUILTIN_NOTE_KINDS } from '../../../lib/noteKinds'
import { MAX_STYLE_NAME_CHARS } from '../../../lib/journalStyles'
import {
  archiveTemplate, deleteTemplate, duplicateTemplate, getTemplate, listTemplates, renameTemplate, restoreTemplate,
  unarchiveTemplate,
} from '../../../lib/templateLibrary'
import { loadStyle } from '../styles/lazyStyles'
import UsedInList from './UsedInList'
import DeleteConfirm from './DeleteConfirm'
import PanelHead from './PanelHead'
import {
  FILTERS, LIBRARY_ACTIONS, LIST_RENDER_MAX, TEMPLATE_COPY, TEMPLATE_DELETED_DAYS, creditText, dayText, editedText,
  isLibraryCopy, keptUntilText, notesWord, templateArchiveSentence, usedInText,
} from './myToolsLib'
import { libraryOn, openShare } from './libraryActions'
import styles from './myTools.module.css'

/**
 * My tools, the Templates tab (spec 5.8, wave 11 Task 11.19, ruling W11-R10): the member's OWN templates (their journal
 * styles; the built-in starter templates are not the member's and are not listed) in three lists, Active · Archived ·
 * Recently deleted, the Widgets tab's pattern.
 *
 *  * Each row: the name, the kind of note it makes, "Used in N notes" (which lists those notes; "Not in any note" with
 *    none), when it was last edited, and for a copy from the library the server's credit line ("Based on Sam's
 *    Pre-market prep", or "Based on a former member's …").
 *  * Active: Open (the template editor, loaded through styles/lazyStyles), Rename, Duplicate, Share to library (the
 *    member's own work only, while the library is on: never a copy), Archive ("It stays in your N notes. New notes
 *    can't use it until you restore it."). Archived: Restore, Delete permanently (the name typed, DeleteConfirm).
 *    Recently deleted: Restore, "Kept until <Mon D>" (TEMPLATE_DELETED_DAYS).
 *  * Every action is a ContextPopover on the row (a bottom sheet on touch); on desktop the row's main action is also a
 *    button of its own. A panel pushes in place of the list; the list stays mounted, hidden, so Back (or Escape)
 *    returns focus to the row it came from. Rows are My tools' own `.row` (56 px on phone).
 *  * Every read and write is lib/templateLibrary's; the server's sentences (a refused name, "Archive this template
 *    before deleting it.", the 30-day restore limit) are shown as they came.
 *  * ONE live region for the tab's whole life (`data-testid="my-tools-message"`), its child keyed per message.
 *
 * ⛔ LAZY: mounted only by MyToolsSheet, and only while `widgetsWaveOn(11)` (the sheet says "coming soon" otherwise).
 */
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const VIEW_OF = { live: 'live', archived: 'archived', deleted: 'deleted' }
const actionsFor = (id) => `[data-actions-for="${String(id).replace(/["\\]/g, '\\$&')}"]`
const usedOf = (d) => (Number.isInteger(d?.usedIn) && d.usedIn > 0 ? d.usedIn : 0)
const BACK_LABEL = 'Back to your templates'
const BUILTIN_KIND_NAME = new Map(BUILTIN_NOTE_KINDS.map((k) => [k.id, k.name]))

/** The kind of note a template makes, by name: the list's own kinds (the member's too), else the built-in names. */
const kindName = (kinds, id) => kinds.get(id) || BUILTIN_KIND_NAME.get(id) || ''

function Row({ d, kinds, filter, phone, touch, busy, menuOpen, onMenu, onPrimary, onUsedIn }) {
  const used = usedOf(d)
  const credit = creditText(d)
  const kind = kindName(kinds, d.kindId)
  const primary = filter === 'live' ? 'Open' : 'Restore'
  return (
    <li className={`${styles.row}`} data-style-id={d.id} data-testid="my-tools-template-row">
      <span className={styles.thumb} aria-hidden="true">
        <UIcon name="document" size={20} gold={false} />
      </span>
      <div className={styles.rowMain}>
        <span className={styles.rowName} title={d.name}><span data-template-name="">{d.name}</span></span>
        <span className={styles.rowMeta}>
          {filter === 'deleted' ? (
            <>
              {dayText(d.deletedAt) && (
                <>
                  <span>{`Deleted ${dayText(d.deletedAt)}`}</span>
                  <span aria-hidden="true">·</span>
                  <span>{keptUntilText(d.deletedAt, new Date(), TEMPLATE_DELETED_DAYS)}</span>
                </>
              )}
            </>
          ) : (
            <>
              {kind && <><span>{kind}</span><span aria-hidden="true">·</span></>}
              {!phone && used > 0 ? (
                <button type="button" className={styles.linkBtn} onClick={() => onUsedIn(d)}
                  aria-label={`${usedInText(used)}: list the notes made with ${d.name}`}>{usedInText(used)}</button>
              ) : <span>{usedInText(used)}</span>}
              {editedText(d.updatedAt) && <><span aria-hidden="true">·</span><span>{editedText(d.updatedAt)}</span></>}
            </>
          )}
          {credit && <><span aria-hidden="true">·</span><span data-credit="">{credit}</span></>}
        </span>
      </div>
      {!phone && (
        <button type="button" className={styles.btn} aria-disabled={busy || undefined} aria-busy={busy || undefined}
          onClick={(e) => { if (!busy) onPrimary(d, e.currentTarget) }} aria-label={`${primary} ${d.name}`}>{primary}</button>
      )}
      <button type="button" className={styles.moreBtn} aria-label={`Actions for ${d.name}`}
        aria-haspopup={touch ? 'dialog' : 'menu'} aria-expanded={menuOpen} aria-busy={busy || undefined}
        data-actions-for={d.id} onClick={(e) => onMenu(d, e.currentTarget)}>
        <UIcon name="more" size={18} gold={false} />
      </button>
    </li>
  )
}

/** Rename: the name only (a patch). A refused name gets the server's own sentence. */
function RenamePanel({ d, onBack, onDone, onGone, say }) {
  const id = useId()
  const [name, setName] = useState(d.name || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)
  useEffect(() => { input.current?.focus(); input.current?.select?.() }, [])
  const clean = name.trim()
  const save = async (e) => {
    e.preventDefault()
    if (busy || !clean || clean === d.name) return
    setBusy(true)
    setError('')
    const got = await renameTemplate(d.id, clean)
    setBusy(false)
    if (got.ok) { onDone(`Renamed to “${(isRecord(got.data.style) && got.data.style.name) || clean}”.`); return }
    if (got.code === 'unavailable') { onGone(TEMPLATE_COPY.gone); return }
    say(got.message, 'error')
    setError(got.message)
  }
  return (
    <div className={styles.pushPanel} data-testid="my-tools-rename">
      <PanelHead title={`Rename “${d.name}”`} onBack={onBack} focusHeading={false} backLabel={BACK_LABEL} />
      <form className={styles.form} onSubmit={save}>
        <label className={styles.fieldLabel} htmlFor={id}>Name</label>
        <input ref={input} id={id} className={styles.input} value={name} maxLength={MAX_STYLE_NAME_CHARS}
          aria-describedby={error ? `${id}-err` : undefined} aria-invalid={error ? true : undefined}
          onChange={(e) => setName(e.target.value)} />
        {error && <p className={styles.inlineError} id={`${id}-err`}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onBack}>Cancel</button>
          <button type="submit" className={styles.btnPrimary} aria-disabled={!clean || clean === d.name || busy || undefined}
            aria-busy={busy || undefined}>{busy ? 'Saving…' : 'Save name'}</button>
        </div>
      </form>
    </div>
  )
}

function ArchivePanel({ d, onBack, onArchive, busy, error }) {
  return (
    <div className={styles.pushPanel} data-testid="my-tools-archive">
      <PanelHead title={`Archive “${d.name}”?`} onBack={onBack} backLabel={BACK_LABEL} />
      <p className={styles.sentence} data-testid="archive-sentence">{templateArchiveSentence(usedOf(d))}</p>
      <p className={styles.hint}>It leaves your template list; you can restore it from Archived.</p>
      {error && <p className={styles.inlineError}>{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={onBack}>Cancel</button>
        <button type="button" className={styles.btnPrimary} aria-disabled={busy || undefined} aria-busy={busy || undefined}
          onClick={() => { if (!busy) onArchive(d) }}>{busy ? 'Archiving…' : 'Archive'}</button>
      </div>
    </div>
  )
}

/** The template editor, in place: the style editor (loaded through styles/lazyStyles) over the whole template. */
function EditorPanel({ d, kinds, onBack, onSaved, onGone, say }) {
  const [state, setState] = useState({ status: 'loading' })
  useEffect(() => {
    let alive = true
    Promise.all([
      loadStyle('default', () => import('../styles/StyleEditor')).then((m) => m.default).catch(() => null),
      getTemplate(d.id),
    ]).then(([Editor, got]) => {
      if (!alive) return
      if (!Editor) { setState({ status: 'error', text: TEMPLATE_COPY.editorFailed }); return }
      if (!got.ok || !isRecord(got.data.style)) {
        if (got.code === 'unavailable') { onGone(TEMPLATE_COPY.gone); return }
        setState({ status: 'error', text: got.message || TEMPLATE_COPY.editorFailed })
        return
      }
      setState({ status: 'ok', Editor, style: got.data.style })
    })
    return () => { alive = false }
  }, [d.id, onGone])
  useEffect(() => { if (state.status === 'error') say(state.text, 'error') }, [state, say])
  const Editor = state.Editor
  return (
    <div className={styles.pushPanel} data-testid="my-tools-template-editor">
      <PanelHead title={`Edit “${d.name}”`} onBack={onBack} backLabel={BACK_LABEL} />
      {state.status === 'loading' && <p className={styles.hint}>Opening the template…</p>}
      {state.status === 'error' && <p className={styles.sentence}>{state.text}</p>}
      {state.status === 'ok' && (
        <Editor style={state.style} kinds={kinds}
          onSaved={(saved) => onSaved(`Saved “${(isRecord(saved) && saved.name) || d.name}”.`)} onCancel={onBack} />
      )}
    </div>
  )
}

export default function TemplatesTab({ phone, navigate = null, onCloseAll }) {
  const touch = useIsTouch()
  const [filter, setFilter] = useState('live')
  const [lists, setLists] = useState({})            // filter -> {status, items?, kinds?, code?, message?, stale?}
  const [view, setView] = useState({ kind: 'list' })
  const [menu, setMenu] = useState(null)
  const [message, setMessage] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [panelError, setPanelError] = useState(null)
  const rootRef = useRef(null)
  const returnTo = useRef(null)
  const focusAfter = useRef(null)
  const mounted = useRef(true)
  const filterRef = useRef(filter)
  filterRef.current = filter

  useEffect(() => () => { mounted.current = false }, [])
  const say = useCallback((text, tone = 'ok') => setMessage((m) => (text ? { text, tone, n: (m?.n || 0) + 1 } : (m ? { ...m, text: '' } : null))), [])

  const load = useCallback(async (key) => {
    setLists((all) => (all[key]?.status === 'ok' ? all : { ...all, [key]: { status: 'loading' } }))
    const got = await listTemplates(VIEW_OF[key])
    if (!mounted.current) return null
    const raw = got.ok && Array.isArray(got.data.styles) ? got.data.styles : null
    // Built-in templates are not the member's (W11-R10): never listed, whatever a view answers.
    const items = raw ? raw.filter((s) => isRecord(s) && s.id && s.builtin !== true) : null
    const kinds = got.ok && Array.isArray(got.data.kinds) ? got.data.kinds.filter((k) => isRecord(k) && k.id) : []
    setLists((all) => ({ ...all, [key]: items ? { status: 'ok', items, kinds } : { status: 'error', code: got.code, message: got.message } }))
    return items
  }, [])
  const refresh = useCallback((key) => {
    setLists((all) => (all[key] ? { [key]: { ...all[key], stale: true } } : {}))
    return load(key)
  }, [load])
  useEffect(() => { if (!lists[filter]) load(filter) }, [filter, lists, load])

  const readText = (s) => (s.code === 'offline' ? TEMPLATE_COPY.offlineList
    : s.code === 'network' || !s.message ? TEMPLATE_COPY.loadFailed : s.message)
  const failed = lists[filter]?.status === 'error' ? lists[filter] : null
  const failedCode = failed?.code || null
  useEffect(() => {
    if (failed) say(readText(failed), 'quiet')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedCode, say])
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
  const back = useCallback(() => {
    setPanelError(null)
    setView({ kind: 'list' })
  }, [])
  useEffect(() => {
    if (view.kind !== 'list' || !returnTo.current) return
    if (!focusAfter.current) focusAfter.current = { id: returnTo.current, fallback: true }
    returnTo.current = null
  }, [view])
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
  const focusPast = (key, id) => {
    const xs = lists[key]?.items || []
    const i = xs.findIndex((t) => t.id === id)
    const next = i >= 0 ? (xs[i + 1] || xs[i - 1]) : null
    focusAfter.current = next ? { id: next.id, fallback: true, wait: key } : { heading: true, wait: key }
  }

  // Escape: a desktop menu closes first; then a panel goes back one level; at the list the Sheet's own Escape closes
  // My tools. Only while this sheet is the topmost one (a touch menu or the share preview is a sheet of its own).
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

  const gone = useCallback((text = TEMPLATE_COPY.gone) => {
    returnTo.current = null
    focusAfter.current = { heading: true, wait: filterRef.current }
    setView({ kind: 'list' })
    setPanelError(null)
    say(text, 'error')
    refresh(filterRef.current)
  }, [refresh, say])

  // ── actions ─────────────────────────────────────────────────────────────────────────────────────
  const act = async (d, run, done) => {
    if (busyId) return
    setBusyId(d.id)
    setMessage(null)
    const got = await run()
    if (!mounted.current) return
    setBusyId(null)
    if (got.ok) { done(got.data); return }
    if (got.code === 'unavailable') { gone(); return }
    say(got.message, 'error')
  }
  const duplicate = (d) => act(d, () => duplicateTemplate(d.id), (data) => {
    const t = isRecord(data?.style) ? data.style : null
    say(`Made “${t?.name || `${d.name} copy`}”.`)
    if (t?.id) focusAfter.current = { id: t.id, wait: 'live' }
    refresh('live')
  })
  const doArchive = async (d) => {
    if (busyId) return
    setBusyId(d.id)
    setPanelError(null)
    const got = await archiveTemplate(d.id)
    if (!mounted.current) return
    setBusyId(null)
    if (!got.ok) {
      if (got.code === 'unavailable') { gone(); return }
      say(got.message, 'error')
      if (view.kind === 'archive') setPanelError(got.message)
      return
    }
    returnTo.current = null
    focusPast('live', d.id)
    setView({ kind: 'list' })
    say(`Archived “${d.name}”. Restore it from Archived.`)
    refresh('live')
  }
  const archive = (d) => {
    if (usedOf(d) > 0) push('archive', d)
    else { setMenu(null); doArchive(d) }
  }
  const unarchive = (d) => act(d, () => unarchiveTemplate(d.id), () => {
    focusPast('archived', d.id)
    say(`Restored “${d.name}” to your templates.`)
    refresh('archived')
  })
  const undelete = (d) => act(d, () => restoreTemplate(d.id), () => {
    focusPast('deleted', d.id)
    say(`Restored “${d.name}”. It's in Archived.`)
    refresh('deleted')
  })
  const share = async (d) => {
    setMenu(null)
    const got = await openShare({ kind: 'template', id: d.id, onDone: (text) => { if (mounted.current) say(text) } })
    if (!got.ok && mounted.current) say(got.text, 'error')
  }

  const primary = (d) => {
    if (filter === 'live') push('editor', d)
    else if (filter === 'archived') unarchive(d)
    else undelete(d)
  }

  const menuItems = (d) => {
    const used = usedOf(d)
    const usedIn = used > 0 ? [{ key: 'used', label: usedInText(used), onClick: () => push('usedIn', d) }] : []
    if (filter === 'deleted') return [{ key: 'restore', label: 'Restore', onClick: () => undelete(d) }]
    if (filter === 'archived') {
      return [
        { key: 'restore', label: 'Restore', onClick: () => unarchive(d) },
        ...usedIn,
        { separator: true },
        { key: 'delete', label: 'Delete permanently', danger: true, onClick: () => push('delete', d),
          hint: `Needs the name typed. Kept in Recently deleted for ${TEMPLATE_DELETED_DAYS} days.` },
      ]
    }
    // Share is the member's own work only: a copy from the library (or anything made from one) is never shared again.
    const shareItem = libraryOn() && !isLibraryCopy(d)
      ? [{ key: 'share', label: LIBRARY_ACTIONS.share, onClick: () => share(d) }] : []
    return [
      { key: 'open', label: 'Open', onClick: () => push('editor', d) },
      { key: 'rename', label: 'Rename', onClick: () => push('rename', d) },
      { key: 'duplicate', label: 'Duplicate', onClick: () => { setMenu(null); duplicate(d) } },
      ...shareItem,
      ...usedIn,
      { separator: true },
      { key: 'archive', label: 'Archive', onClick: () => archive(d), hint: templateArchiveSentence(used) },
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
  const kindsList = lists.live?.kinds || state?.kinds || []
  const kinds = new Map(kindsList.map((k) => [k.id, typeof k.name === 'string' ? k.name : '']))
  const shown = items.slice(0, LIST_RENDER_MAX)
  // No zeros (m-2): an empty list's heading names the list.
  const heading = filter === 'live' ? TEMPLATE_COPY.heading(items.length)
    : items.length === 0 ? TEMPLATE_COPY.emptyHeading[filter]
      : filter === 'archived' ? `${items.length} archived` : `${items.length} recently deleted`
  const empty = { live: TEMPLATE_COPY.emptyActive, archived: TEMPLATE_COPY.emptyArchived, deleted: TEMPLATE_COPY.emptyDeleted }[filter]

  let panel = null
  if (view.kind === 'usedIn') {
    panel = <UsedInList d={view.d} kind="template" onBack={back} onNavigate={onCloseAll} navigate={navigate} backLabel={BACK_LABEL} />
  } else if (view.kind === 'rename') {
    panel = <RenamePanel d={view.d} onBack={back} onGone={gone} say={say}
      onDone={(text) => { say(text); back(); refresh('live') }} />
  } else if (view.kind === 'archive') {
    panel = <ArchivePanel d={view.d} onBack={back} onArchive={doArchive} busy={busyId === view.d.id} error={panelError} />
  } else if (view.kind === 'delete') {
    const d = view.d
    const used = usedOf(d)
    panel = <DeleteConfirm d={d} onBack={back} onGone={gone} backLabel={BACK_LABEL}
      remove={(typed) => deleteTemplate(d.id, typed)}
      what={`It moves to Recently deleted for ${TEMPLATE_DELETED_DAYS} days, then it is gone for good.${used > 0 ? ` Your ${notesWord(used)} stay${used === 1 ? 's' : ''} as ${used === 1 ? 'it is' : 'they are'}.` : ''}`}
      deletedText={`“${d.name}” moved to Recently deleted. It's kept for ${TEMPLATE_DELETED_DAYS} days.`}
      onDeleted={(_data, text) => {
        returnTo.current = null
        focusPast('archived', d.id)
        say(text)
        back()
        refresh('archived')
      }} />
  } else if (view.kind === 'editor') {
    panel = <EditorPanel d={view.d} kinds={kindsList} onBack={back} onGone={gone} say={say}
      onSaved={(text) => { say(text); back(); refresh('live') }} />
  }

  const tone = message?.tone
  return (
    <div ref={rootRef} className={styles.widgets} data-testid="my-tools-templates">
      <p className={!message?.text ? styles.liveIdle : tone === 'error' ? styles.error : tone === 'quiet' ? styles.srOnly : styles.status}
        role="status" aria-live="polite" aria-atomic="true" data-tone={tone || undefined}
        data-testid="my-tools-message">{message?.text ? <span key={message.n}>{message.text}</span> : null}</p>
      {panel}
      <div hidden={view.kind !== 'list'} className={styles.listWrap}>
        <div className={styles.toolbar}>
          <div role="group" aria-label="Show" className={styles.filters}>
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" className={`${styles.filter} ${filter === key ? styles.filterOn : ''}`}
                aria-pressed={filter === key} onClick={() => { setFilter(key); setMessage(null) }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {(!state || state.status === 'loading') && <p className={styles.hint}>{TEMPLATE_COPY.loading}</p>}
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
                  <Row key={d.id} d={d} kinds={kinds} filter={filter} phone={phone} touch={touch}
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

/**
 * Research Library — the member's saved UCT News headlines (Charts widget).
 *
 * Lists what the member saved from News (☆ on a headline), newest first, with search
 * (headline text and the member's notes), filters (collection, ticker, ET date range),
 * personal collections (one headline may sit in several), personal notes, the AI
 * Explanation (the News panel, asked for only on a click — never generated or stored
 * by saving), and the canonical chart action on every ticker (setGroupSym on the
 * widget's colour group, exactly as News).
 *
 * ⛔ The archive is never changed from here. Remove, Delete collection and Clear note
 * act on the member's own library rows only (api/services/trade_exchange_news/library.py);
 * every headline and delivery stays in UCT News permanently.
 *
 * State: the page's one library store (lib/tradeExchangeNewsLibrary.js) — so a save in
 * any News widget appears here at once — plus this widget's own filters in `opts`.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useWorkspace } from '../WorkspaceContext'
import usePreferences from '../../../hooks/usePreferences'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import { menuThemeVars } from '../../../utils/dividerColor'
import UIcon from '../../../components/ui/UIcon'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import * as library from '../../../lib/tradeExchangeNewsLibrary'
import { ExplainPanel } from './TradeExchangeNewsParts'
import { txnSettingsFor, txnWidgetStyleVars } from './tradeExchangeNewsSettings'
import { explainable, fmtReceivedFull, tickerTitle, tokenize } from './tradeExchangeNewsModel'
import news from './TradeExchangeNewsWidget.module.css'
import styles from './ResearchLibraryWidget.module.css'

const SEARCH_DEBOUNCE_MS = 200
const PAGE = 60

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** The headline's text with its tickers as canonical chart links. */
function Headline({ item, onSym, linkedSym }) {
  const parts = tokenize(item.content, item.tickers, item.mentions)
  return (
    <span className={`${news.headline} ${styles.headline}`}>
      {parts.map((p, i) => (p.sym ? (
        <button key={i} type="button" className={`${news.sym}${p.sym === linkedSym ? ' ' + news.symLinked : ''}`}
          onClick={() => onSym(p.sym)} title={tickerTitle(p.sym, null, false, { named: p.named })}>{p.text}</button>
      ) : <span key={i}>{p.text}</span>))}
    </span>
  )
}

function NoteEditor({ item, onDone }) {
  const [text, setText] = useState(item.bookmark.note || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  const limit = library.getSnapshot().limits?.note || 4000
  const saveNote = async (value) => {
    setBusy(true)
    const r = await library.setNote(item.id, value)
    setBusy(false)
    if (r.ok) onDone(true)
    else setError(r.error)
  }
  return (
    <div className={styles.noteEdit} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onDone(false) } }}>
      <textarea ref={ref} className={styles.noteInput} value={text} maxLength={limit} rows={3}
        onChange={(e) => setText(e.target.value)} aria-label="Your research note" placeholder="Your research note…" />
      <div className={styles.noteBar}>
        {error && <span className={styles.err}>{error}</span>}
        <span className={styles.noteCount}>{text.length.toLocaleString()} / {limit.toLocaleString()}</span>
        {item.bookmark.note && (
          <button type="button" className={styles.linkBtn} disabled={busy} onClick={() => saveNote('')}>Delete note</button>
        )}
        <button type="button" className={styles.linkBtn} disabled={busy} onClick={() => onDone(false)}>Cancel</button>
        <button type="button" className={styles.primaryBtn} disabled={busy} onClick={() => saveNote(text)}>Save note</button>
      </div>
    </div>
  )
}

/** Which of the member's collections hold this headline (checkboxes) + a new one. */
/** Under its anchor, kept inside the widget (News's placeUnder). */
function placeUnder(anchorEl, hostEl, width) {
  if (!anchorEl || !hostEl) return { top: 36, right: 6 }
  const a = anchorEl.getBoundingClientRect()
  const h = hostEl.getBoundingClientRect()
  return { top: Math.max(4, Math.min(a.bottom - h.top + 2, h.height - 80)),
    left: Math.max(4, Math.min(a.right - h.left - width, h.width - width - 4)) }
}

function CollectionsMenu({ item, collections, onClose, themeVars, anchorEl, hostEl }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const boxRef = useRef(null)
  useEffect(() => {
    boxRef.current?.querySelector('input')?.focus()
    const onDown = (e) => { if (!boxRef.current?.contains(e.target) && !anchorEl?.contains?.(e.target)) onClose() }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [onClose, anchorEl])
  const inSet = new Set(item.bookmark.collection_ids || [])
  const toggle = async (c) => {
    setBusy(true)
    const r = await library.setMembership(c.id, item.id, !inSet.has(c.id))
    setBusy(false)
    if (!r.ok) setError(r.error)
  }
  const create = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const r = await library.createCollection(name)
    if (r.ok) {
      setName('')
      const m = await library.setMembership(r.body.id, item.id, true)
      if (!m.ok) setError(m.error)
    } else setError(r.error)
    setBusy(false)
  }
  return (
    <div ref={boxRef} className={`${news.menuPop} ${styles.colMenu}`} style={{ ...themeVars, ...placeUnder(anchorEl, hostEl, 210) }}
      role="dialog" aria-label="Collections"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); anchorEl?.focus?.() } }}>
      <div className={news.menuHead}>Collections</div>
      {!collections.length && <div className={news.menuNote}>No collections yet — name one below.</div>}
      {collections.map((c) => (
        <label key={c.id} className={styles.colCheck}>
          <input type="checkbox" checked={inSet.has(c.id)} disabled={busy} onChange={() => toggle(c)} />
          <span>{c.name}</span>
        </label>
      ))}
      <form className={styles.colNew} onSubmit={create}>
        <Input className={styles.colInput} value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
          placeholder="New collection" aria-label="New collection name" />
        <button type="submit" className={styles.primaryBtn} disabled={busy || !name.trim()}>Add</button>
      </form>
      {error && <div className={`${news.menuNote} ${styles.err}`}>{error}</div>}
    </div>
  )
}

/** Create, rename and delete the member's collections (delete keeps its headlines saved). */
function ManageCollections({ collections, onClose, themeVars, anchorRef }) {
  const [editing, setEditing] = useState(null)        // { id, name }
  const [confirm, setConfirm] = useState(null)        // id awaiting a second click
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const boxRef = useRef(null)
  useEffect(() => {
    const onDown = (e) => { if (!boxRef.current?.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [onClose, anchorRef])
  const run = async (p) => {
    const r = await p
    setError(r.ok ? null : r.error)
    return r.ok
  }
  return (
    <div ref={boxRef} className={`${news.menuPop} ${styles.manage}`} style={themeVars} role="dialog" aria-label="Manage collections"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className={news.menuHead}>Your collections</div>
      {!collections.length && <div className={news.menuNote}>Group saved headlines into collections, e.g. “Earnings” or “Fed”.</div>}
      {collections.map((c) => (
        <div key={c.id} className={styles.manageRow}>
          {editing?.id === c.id ? (
            <form className={styles.colNew} onSubmit={async (e) => { e.preventDefault(); if (await run(library.renameCollection(c.id, editing.name))) setEditing(null) }}>
              <Input className={styles.colInput} value={editing.name} maxLength={60} autoFocus aria-label={`Rename ${c.name}`}
                onChange={(e) => setEditing({ id: c.id, name: e.target.value })} />
              <button type="submit" className={styles.primaryBtn}>Save</button>
              <button type="button" className={styles.linkBtn} onClick={() => setEditing(null)}>Cancel</button>
            </form>
          ) : (
            <>
              <span className={styles.manageName}>{c.name}</span>
              <span className={styles.manageCount}>{c.count}</span>
              <button type="button" className={`${news.rowBtn} ${styles.menuIcon}`} style={{ opacity: 1 }} onClick={() => { setConfirm(null); setEditing({ id: c.id, name: c.name }) }}
                aria-label={`Rename ${c.name}`} title="Rename"><UIcon name="edit" size={11} gold={false} /></button>
              <button type="button" className={`${news.rowBtn} ${styles.menuIcon}${confirm === c.id ? ' ' + styles.danger : ''}`} style={{ opacity: 1 }}
                onClick={async () => { if (confirm !== c.id) { setConfirm(c.id); return } await run(library.deleteCollection(c.id)); setConfirm(null) }}
                aria-label={confirm === c.id ? `Confirm: delete ${c.name}` : `Delete ${c.name}`}
                title={confirm === c.id ? 'Click again to delete. Its headlines stay saved.' : 'Delete collection'}>
                {confirm === c.id ? 'Delete?' : <UIcon name="trash" size={11} gold={false} />}
              </button>
            </>
          )}
        </div>
      ))}
      <form className={styles.colNew} onSubmit={async (e) => { e.preventDefault(); if (name.trim() && await run(library.createCollection(name))) setName('') }}>
        <Input className={styles.colInput} value={name} maxLength={60} onChange={(e) => setName(e.target.value)}
          placeholder="New collection" aria-label="New collection name" />
        <button type="submit" className={styles.primaryBtn} disabled={!name.trim()}>Create</button>
      </form>
      {error && <div className={`${news.menuNote} ${styles.err}`}>{error}</div>}
      <div className={news.menuNote}>Deleting a collection keeps its headlines saved. Headlines are never deleted from UCT News.</div>
    </div>
  )
}

const LibraryRow = memo(function LibraryRow({ item, collections, linkedSym, onSym, onExplain, explainOpen, onRemoved,
  noteOpen, onNote, colsOpen, onCols }) {
  const [copied, setCopied] = useState(false)
  const names = (item.bookmark.collection_ids || []).map((id) => collections.find((c) => c.id === id)?.name).filter(Boolean)
  if (item.restoring) {
    return (
      <div className={`${news.row} ${styles.row}`} data-id={item.id}>
        <span className={styles.restoring}>This saved headline is being restored from the permanent UCT News archive.</span>
      </div>
    )
  }
  return (
    <div className={`${news.row} ${styles.row}`} data-id={item.id}>
      <span className={news.when}>
        <span className={news.time} title={`Received by UCT ${fmtReceivedFull(item.received_at_ms)}`}>{fmtReceivedFull(item.received_at_ms)}</span>
        <span className={news.rowActions}>
          {explainable(item) && (
            <button type="button" className={`${news.rowBtn}${explainOpen ? ' ' + news.rowBtnOn : ''}`} onClick={() => onExplain(item)}
              aria-label="Explain this headline" aria-expanded={!!explainOpen} title="Explain (AI)"><UIcon name="sparkle" size={11} gold={false} /></button>
          )}
          <button type="button" className={`${news.rowBtn}${noteOpen ? ' ' + news.rowBtnOn : ''}`} onClick={() => onNote(item)}
            aria-label={item.bookmark.note ? 'Edit your note' : 'Add a note'} title={item.bookmark.note ? 'Edit note' : 'Add note'}>
            <UIcon name="edit" size={11} gold={false} /></button>
          <button type="button" className={`${news.rowBtn}${colsOpen ? ' ' + news.rowBtnOn : ''}`} onClick={(e) => onCols(item, e.currentTarget)}
            aria-label="Collections for this headline" aria-expanded={!!colsOpen} aria-haspopup="dialog" title="Collections">
            <UIcon name="library" size={11} gold={false} /></button>
          <button type="button" className={`${news.rowBtn}${copied ? ' ' + news.rowBtnOn + ' ' + news.rowBtnOk : ''}`}
            onClick={async () => { setCopied(await copy(item.content || '')); setTimeout(() => setCopied(false), 1400) }}
            aria-label={copied ? 'Headline copied' : 'Copy headline'} title="Copy headline">
            <UIcon name={copied ? 'check' : 'copy'} size={11} gold={false} /></button>
          <button type="button" className={`${news.rowBtn} ${news.rowBtnSaved}`} onClick={() => onRemoved(item)}
            aria-label="Remove from Research Library" aria-pressed="true" title="Saved — click to remove from your library">
            <UIcon name="star-fill" size={11} gold={false} /></button>
        </span>
      </span>
      <Headline item={item} onSym={onSym} linkedSym={linkedSym} />
      {(names.length > 0 || item.bookmark.note) && !noteOpen && (
        <div className={styles.meta}>
          {names.map((n) => <span key={n} className={styles.chip}>{n}</span>)}
          {item.bookmark.note && <span className={styles.note} title={item.bookmark.note}>{item.bookmark.note}</span>}
        </div>
      )}
      {noteOpen && <NoteEditor item={item} onDone={() => onNote(null)} />}
    </div>
  )
})

export default function ResearchLibraryWidget({ color, opts, onOptsChange }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  const linkedSym = groupSyms?.[color] || null
  const onSym = useCallback((sym) => setGroupSym(color, sym), [setGroupSym, color])
  const lib = useSyncExternalStore(library.subscribe, library.getSnapshot)

  const { prefs } = usePreferences()
  const placedTheme = usePlacedTheme()
  const settings = useMemo(() => txnSettingsFor(opts?.settings, placedTheme),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts?.settings, prefs.theme])
  const rootStyle = useMemo(() => txnWidgetStyleVars(settings), [settings])
  const menuVars = useMemo(() => menuThemeVars(settings.bg) || {}, [settings])
  const patchOpts = useCallback((patch) => onOptsChange?.({ ...(opts || {}), ...patch }), [opts, onOptsChange])

  // Filters: collection / ticker / dates / sort persist with the widget; search is per visit.
  const collection = typeof opts?.collection === 'string' ? opts.collection : ''
  const ticker = typeof opts?.ticker === 'string' ? opts.ticker : ''
  const from = typeof opts?.from === 'string' ? opts.from : ''
  const to = typeof opts?.to === 'string' ? opts.to : ''
  const sort = opts?.sort === 'received' ? 'received' : 'saved'
  const [queryRaw, setQueryRaw] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryRaw.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [queryRaw])
  const [filtersOpen, setFiltersOpen] = useState(!!(ticker || from || to))

  // A collection that no longer exists (deleted here or on another device) is no filter.
  const activeCollection = collection && lib.collections.some((c) => c.id === collection) ? collection : ''

  const [page, setPage] = useState({ items: [], total: 0, loading: true, error: null, limit: PAGE })
  const reqRef = useRef(0)
  const fetchPage = useCallback(async (limit) => {
    const n = ++reqRef.current
    setPage((p) => ({ ...p, loading: true }))
    const r = await library.fetchItems({ q: query, ticker, collection: activeCollection, from, to, sort, offset: 0, limit })
    if (n !== reqRef.current) return
    setPage(r.ok ? { items: r.items, total: r.total, loading: false, error: null, limit }
      : { items: [], total: 0, loading: false, error: r.error || 'Your library could not be loaded.', limit })
  }, [query, ticker, activeCollection, from, to, sort])
  // Refetch on any filter change and whenever the library changes (a save anywhere on the page).
  useEffect(() => { if (lib.status === 'ready') fetchPage(PAGE) }, [fetchPage, lib.status, lib.ids, lib.collections])

  const [explain, setExplain] = useState(null)
  const [noteFor, setNoteFor] = useState(null)
  const [colsFor, setColsFor] = useState(null)        // { id, anchor }
  const rootRef = useRef(null)
  const [manageOpen, setManageOpen] = useState(false)
  const manageRef = useRef(null)
  const [toast, setToast] = useState(null)
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [toast])
  const onExplain = useCallback((item) => setExplain((x) => (x?.id === item.id ? null : item)), [])
  const onNote = useCallback((item) => setNoteFor(item ? item.id : null), [])
  const onCols = useCallback((item, anchor) => setColsFor((x) => (!item || x?.id === item.id ? null : { id: item.id, anchor })), [])
  const closeCols = useCallback(() => setColsFor(null), [])
  const colsItem = colsFor ? page.items.find((i) => i.id === colsFor.id) : null
  const onRemoved = useCallback(async (item) => {
    const r = await library.remove(item.id)
    setToast(r.ok ? { text: 'Removed from your library', undo: r.removed } : { text: r.error, tone: 'err' })
  }, [])
  const undo = useCallback(async () => {
    const removed = toast?.undo
    setToast(null)
    const r = await library.undoRemove(removed)
    if (!r.ok) setToast({ text: r.error || 'Could not restore it. Save it again from News.', tone: 'err' })
  }, [toast])

  const filtered = !!(query || ticker || activeCollection || from || to)
  const clearFilters = () => { setQueryRaw(''); patchOpts({ collection: null, ticker: null, from: null, to: null }) }
  const colOptions = [{ value: '', label: `All saved (${lib.ids.size.toLocaleString()})` },
    ...lib.collections.map((c) => ({ value: c.id, label: `${c.name} (${c.count})` }))]

  return (
    <div ref={rootRef} className={`${news.root} ${settings.density === 'compact' ? news.compact : news.comfortable} ${styles.root}`} style={rootStyle}>
      {colsItem && (
        <CollectionsMenu key={colsItem.id} item={colsItem} collections={lib.collections} onClose={closeCols} themeVars={menuVars}
          anchorEl={colsFor.anchor} hostEl={rootRef.current} />
      )}
      {toast && (
        <div className={`${news.toast}${toast.tone === 'err' ? ' ' + news.toastErr : ''}`} role="status" style={menuVars}>
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className={news.toastBtn} onClick={undo}>Undo</button>}
        </div>
      )}
      {explain && (
        <ExplainPanel key={explain.id} item={explain} themeVars={menuVars} onClose={() => setExplain(null)} />
      )}
      {manageOpen && <ManageCollections collections={lib.collections} themeVars={menuVars} anchorRef={manageRef}
        onClose={() => setManageOpen(false)} />}

      <div className={news.bar}>
        <span className={news.brand}>
          <span className={news.brandTitle}>Research Library</span>
          <span className={news.brandSub}>Saved from UCT News · kept permanently</span>
        </span>
        <span className={news.spacer} />
        <button ref={manageRef} type="button" className={`${news.iconBtn}${manageOpen ? ' ' + news.iconBtnOn : ''}`}
          onClick={() => setManageOpen((o) => !o)} title="Manage collections" aria-label="Manage collections"
          aria-expanded={manageOpen}><UIcon name="library" size={14} /></button>
      </div>

      <div className={news.searchBar}>
        <span className={news.searchWrap}>
          <Input className={news.searchInput} value={queryRaw} onChange={(e) => setQueryRaw(e.target.value)}
            placeholder="Search saved headlines & notes" aria-label="Search saved headlines and notes" maxLength={120} />
          {queryRaw && <button type="button" className={news.searchClear} onClick={() => setQueryRaw('')} aria-label="Clear search" title="Clear">×</button>}
        </span>
        <button type="button" className={`${news.filterBtn}${(ticker || from || to) ? ' ' + news.filterBtnOn : ''}`}
          onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} aria-label="Ticker and date filters" title="Ticker and date filters">
          <UIcon name="sliders" size={11} /><span className={news.filterLabel}>Filters</span>
        </button>
        <Select className={news.listSelect} value={activeCollection} aria-label="Filter by collection"
          onChange={(e) => patchOpts({ collection: e.target.value || null })} options={colOptions} />
      </div>
      {filtersOpen && (
        <div className={styles.filters}>
          <Input className={styles.tickerInput} value={ticker} maxLength={12} placeholder="Ticker" aria-label="Filter by ticker"
            onChange={(e) => patchOpts({ ticker: e.target.value.toUpperCase().replace(/[^A-Z0-9.$-]/g, '') || null })} />
          <label className={styles.dateLabel}>From
            <input type="date" className={styles.dateInput} value={from} max={to || undefined} aria-label="Received from (ET)"
              onChange={(e) => patchOpts({ from: e.target.value || null })} /></label>
          <label className={styles.dateLabel}>To
            <input type="date" className={styles.dateInput} value={to} min={from || undefined} aria-label="Received to (ET)"
              onChange={(e) => patchOpts({ to: e.target.value || null })} /></label>
          <Select className={styles.sortSelect} value={sort} aria-label="Sort"
            onChange={(e) => patchOpts({ sort: e.target.value === 'received' ? 'received' : null })}
            options={[{ value: 'saved', label: 'Newest saved' }, { value: 'received', label: 'Newest headline' }]} />
        </div>
      )}

      <div className={news.list} aria-busy={page.loading || undefined} aria-label="Saved headlines">
        {lib.status === 'error' && (
          <div className={news.empty}>{lib.error || 'Your library could not be loaded.'}
            <button type="button" className={news.emptyBtn} onClick={() => library.load({ force: true })}>Retry</button></div>
        )}
        {page.error && lib.status !== 'error' && (
          <div className={news.empty}>{page.error}
            <button type="button" className={news.emptyBtn} onClick={() => fetchPage(page.limit)}>Retry</button></div>
        )}
        {!page.error && lib.status !== 'error' && page.loading && !page.items.length && <div className={news.empty}>Loading your library…</div>}
        {!page.error && !page.loading && !page.items.length && lib.status === 'ready' && (
          <div className={news.empty}>
            {filtered ? 'No saved headlines match these filters.'
              : 'Your library is empty. Click ☆ on any UCT News headline to save it here.'}
            {filtered && <button type="button" className={news.emptyBtn} onClick={clearFilters}>Clear filters</button>}
          </div>
        )}
        {page.items.map((it) => (
          <LibraryRow key={it.id} item={it} collections={lib.collections} linkedSym={linkedSym} onSym={onSym}
            onExplain={onExplain} explainOpen={explain?.id === it.id} onRemoved={onRemoved}
            noteOpen={noteFor === it.id} onNote={onNote} colsOpen={colsFor?.id === it.id} onCols={onCols} />
        ))}
        {page.total > page.items.length && (
          <button type="button" className={`${news.emptyBtn} ${styles.more}`} disabled={page.loading}
            onClick={() => fetchPage(page.limit + PAGE)}>Show more ({(page.total - page.items.length).toLocaleString()} left)</button>
        )}
      </div>
    </div>
  )
}

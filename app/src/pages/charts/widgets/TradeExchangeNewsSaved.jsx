/**
 * UCT News -- the Saved Headlines view, INSIDE the News widget (the toolbar's bookmark
 * button switches to it; the feed stays mounted and live behind it).
 *
 * The member's bookmarked headlines, most recently saved first, with search (headline
 * text and notes), a ticker filter and a collection filter, the collections each one is
 * in, its note (a short annotation; deeper research belongs in Notebook), and the same
 * row actions as the feed: Explain (inline), Note, Bookmark (remove, with Undo in the
 * widget's toast), Copy and ⋯ (Watchlist, Notebook, Collections, Copy). Ticker links are
 * the canonical chart action (setGroupSym on the widget's colour group).
 *
 * ⛔ The archive is never changed from here: remove, delete collection and clear note act
 * on the member's own library rows only (api/services/trade_exchange_news/library.py).
 *
 * Requests: the list is read when the view is first shown, and again only when the
 * member's library or a filter changes -- switching back and forth asks for nothing.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import UIcon from '../../../components/ui/UIcon'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import * as library from '../../../lib/tradeExchangeNewsLibrary'
import { Hl, InlineExplanation, withOffsets } from './TradeExchangeNewsParts'
import { ManageCollections, NoteEditor } from './TradeExchangeNewsCollections'
import { explainable, fmtReceivedFull, fmtStamp, hitRanges, searchNeedles, tickerTitle, tokenize } from './tradeExchangeNewsModel'
import news from './TradeExchangeNewsWidget.module.css'
import styles from './TradeExchangeNewsSaved.module.css'

const SEARCH_DEBOUNCE_MS = 200
const PAGE = 60
const COPY_FEEDBACK_MS = 1400

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

//: A saved headline longer than this shows 3 lines and "Show more" (the feed's default clamp).
const LONG_CHARS = 200

/** The headline's text with its tickers as canonical chart links. */
function Headline({ item, onSym, linkedSym, clamped, needles }) {
  const parts = withOffsets(tokenize(item.content, item.tickers, item.mentions))
  const ranges = needles ? hitRanges(item.content, needles) : null
  return (
    <span className={`${news.headline} ${styles.headline}${clamped ? ' ' + styles.clamp : ''}`}
      style={clamped ? { WebkitLineClamp: 3 } : undefined}>
      {parts.map((p, i) => (p.sym ? (
        <button key={i} type="button" className={`${news.sym}${p.sym === linkedSym ? ' ' + news.symLinked : ''}`}
          onClick={() => onSym(p.sym)} title={tickerTitle(p.sym, null, false, { named: p.named })}><Hl text={p.text} ranges={ranges} offset={p.offset} /></button>
      ) : <span key={i}><Hl text={p.text} ranges={ranges} offset={p.offset} /></span>))}
    </span>
  )
}

const SavedRow = memo(function SavedRow({ item, collections, linkedSym, onSym, onExplain, explainOpen, onCloseExplain,
  onRemove, noteOpen, onNote, onActions, actionsOpen, needles }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const explainRef = useRef(null)
  const long = (item.content || '').length > LONG_CHARS
  useEffect(() => {
    if (!copied) return undefined
    const t = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
    return () => clearTimeout(t)
  }, [copied])
  const names = (item.bookmark.collection_ids || []).map((id) => collections.find((c) => c.id === id)?.name).filter(Boolean)
  if (item.restoring) {
    return (
      <div className={`${news.row} ${styles.row}`} data-id={item.id}>
        <span className={styles.restoring}>This saved headline is being restored from the permanent UCT News archive.</span>
      </div>
    )
  }
  const note = item.bookmark.note
  return (
    <div className={`${news.row} ${styles.row}${explainOpen ? ' ' + news.rowExplaining : ''}`} data-id={item.id}>
      <span className={news.when}>
        <span className={news.time} title={`Received by UCT ${fmtReceivedFull(item.received_at_ms)} · Trade Exchange does not send a publication time`}>
          {fmtStamp(item.received_at_ms)}</span>
        <span className={news.rowActions}>
          {explainable(item) && (
            <button ref={explainRef} type="button" className={`${news.rowBtn}${explainOpen ? ' ' + news.rowBtnOn : ''}`}
              onClick={(e) => onExplain(item, e.currentTarget)}
              aria-label="Explain this headline" aria-expanded={!!explainOpen} title="Explain">
              <UIcon name="sparkle" size={11} gold={false} /></button>
          )}
          <button type="button" className={`${news.rowBtn}${noteOpen || note ? ' ' + news.rowBtnOn : ''}`} onClick={() => onNote(item)}
            aria-label={note ? 'Edit your note' : 'Add a note'} aria-expanded={!!noteOpen} title={note ? 'Edit note' : 'Add note'}>
            <UIcon name="edit" size={11} gold={false} /></button>
          <button type="button" className={`${news.rowBtn} ${news.rowBtnOn} ${news.rowBtnSaved}`} onClick={() => onRemove(item)}
            aria-label="Remove bookmark" aria-pressed="true" title="Remove bookmark">
            <UIcon name="bookmark-fill" size={11} gold={false} /></button>
          <button type="button" className={`${news.rowBtn}${copied ? ' ' + news.rowBtnOn + ' ' + news.rowBtnOk : ''}`}
            onClick={async () => setCopied(await copy(item.content || ''))}
            aria-label={copied ? 'Headline copied' : 'Copy headline'} title="Copy headline">
            <UIcon name={copied ? 'check' : 'copy'} size={11} gold={false} /></button>
          <button type="button" className={`${news.rowBtn} ${news.rowMenuBtn}${actionsOpen ? ' ' + news.rowBtnOn : ''}`}
            onClick={(e) => onActions(item, e.currentTarget)} aria-label="More actions for this headline"
            aria-haspopup="menu" aria-expanded={!!actionsOpen} title="More: watchlist, Notebook, collections, copy">⋯</button>
        </span>
      </span>
      <Headline item={item} onSym={onSym} linkedSym={linkedSym} clamped={long && !open} needles={needles} />
      {long && (
        <button type="button" className={news.moreText} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
      {(names.length > 0 || note) && !noteOpen && (
        <div className={styles.meta}>
          {names.map((n) => <span key={n} className={styles.chip}>{n}</span>)}
          {note && (
            <span className={styles.note} title={note}>
              <UIcon name="edit" size={9} gold={false} /> <Hl text={note} needles={needles} />
            </span>
          )}
        </div>
      )}
      {noteOpen && <NoteEditor item={item} onDone={() => onNote(null)} />}
      {explainOpen && <InlineExplanation key={item.id} item={item} onClose={onCloseExplain} openerRef={explainRef} />}
    </div>
  )
})

export default function SavedHeadlines({ active, opts, patchOpts, linkedSym, onSym, menuVars, onRemove, onBack,
  explainId, onExplain, onCloseExplain, actionsId, onActions }) {
  const lib = useSyncExternalStore(library.subscribe, library.getSnapshot)
  // Filters persist with the widget (the keys the Research Library widget used, so a
  // migrated one keeps them); search is per visit.
  const collection = typeof opts?.collection === 'string' ? opts.collection : ''
  const ticker = typeof opts?.ticker === 'string' ? opts.ticker : ''
  const sort = opts?.sort === 'received' ? 'received' : 'saved'
  const [queryRaw, setQueryRaw] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryRaw.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [queryRaw])
  // A collection that no longer exists (deleted here or on another device) is no filter.
  const activeCollection = collection && lib.collections.some((c) => c.id === collection) ? collection : ''

  const [page, setPage] = useState({ items: [], total: 0, loading: true, error: null, limit: PAGE })
  const reqRef = useRef(0)
  const lastKey = useRef(null)
  const fetchPage = useCallback(async (limit) => {
    const n = ++reqRef.current
    setPage((p) => ({ ...p, loading: true }))
    const r = await library.fetchItems({ q: query, ticker, collection: activeCollection, sort, offset: 0, limit })
    if (n !== reqRef.current) return
    setPage(r.ok ? { items: r.items, total: r.total, loading: false, error: null, limit }
      : { items: [], total: 0, loading: false, error: r.error || 'Your saved headlines could not be loaded.', limit })
  }, [query, ticker, activeCollection, sort])
  // Read when shown, and again only when the library or a filter changed since the last read.
  useEffect(() => {
    if (!active || lib.status !== 'ready') return
    const key = `${query}|${ticker}|${activeCollection}|${sort}|${lib.version}`
    if (key === lastKey.current) return
    lastKey.current = key
    fetchPage(Math.max(PAGE, page.limit))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- page.limit is read, not watched
  }, [active, fetchPage, lib.status, lib.version])

  const [noteFor, setNoteFor] = useState(null)
  const onNote = useCallback((item) => setNoteFor((x) => (item && x !== item.id ? item.id : null)), [])
  const [manageOpen, setManageOpen] = useState(false)
  const manageRef = useRef(null)

  const needles = useMemo(() => { const n = searchNeedles(query); return n.length ? n : null }, [query])
  const filtered = !!(query || ticker || activeCollection)
  const clearFilters = () => { setQueryRaw(''); patchOpts({ collection: null, ticker: null }) }
  const colOptions = [{ value: '', label: `All saved (${lib.ids.size.toLocaleString()})` },
    ...lib.collections.map((c) => ({ value: c.id, label: `${c.name} (${c.count})` }))]
  const count = page.total

  return (
    <>
      {manageOpen && <ManageCollections themeVars={menuVars} anchorRef={manageRef} onClose={() => setManageOpen(false)} />}
      <div className={styles.savedHead}>
        <button type="button" className={styles.backBtn} onClick={onBack} title="Back to the live News feed">
          <UIcon name="chevronLeft" size={11} gold={false} /> News feed
        </button>
        <span className={styles.savedTitle}>Saved{!page.loading || page.items.length ? ` · ${count.toLocaleString()}` : ''}</span>
        <button ref={manageRef} type="button" className={`${news.iconBtn}${manageOpen ? ' ' + news.iconBtnOn : ''}`}
          onClick={() => setManageOpen((o) => !o)} title="Manage collections" aria-label="Manage collections"
          aria-expanded={manageOpen} aria-haspopup="dialog"><UIcon name="library" size={13} /></button>
      </div>
      <div className={news.searchBar}>
        <span className={news.searchWrap}>
          <Input className={news.searchInput} value={queryRaw} onChange={(e) => setQueryRaw(e.target.value)}
            placeholder="Search..." aria-label="Search saved headlines and notes" maxLength={120} />
          {queryRaw && <button type="button" className={news.searchClear} onClick={() => setQueryRaw('')} aria-label="Clear search" title="Clear">×</button>}
        </span>
        <Input className={`${news.searchInput} ${styles.tickerInput}`} value={ticker} maxLength={12} placeholder="Ticker" aria-label="Filter by ticker"
          onChange={(e) => patchOpts({ ticker: e.target.value.toUpperCase().replace(/[^A-Z0-9.$-]/g, '') || null })} />
        <Select className={news.listSelect} value={activeCollection} aria-label="Filter by collection"
          onChange={(e) => patchOpts({ collection: e.target.value || null })} options={colOptions} />
      </div>
      <div className={news.list} aria-busy={page.loading || undefined} aria-label="Saved headlines">
        {lib.status === 'error' && (
          <div className={news.empty}>{lib.error || 'Your saved headlines could not be loaded.'}
            <button type="button" className={news.emptyBtn} onClick={() => library.load({ force: true })}>Retry</button></div>
        )}
        {page.error && lib.status !== 'error' && (
          <div className={news.empty}>{page.error}
            <button type="button" className={news.emptyBtn} onClick={() => fetchPage(page.limit)}>Retry</button></div>
        )}
        {!page.error && lib.status !== 'error' && page.loading && !page.items.length && <div className={news.empty}>Loading your saved headlines…</div>}
        {!page.error && !page.loading && !page.items.length && lib.status === 'ready' && (
          <div className={news.empty}>
            {filtered ? 'No saved headlines match these filters.'
              : 'Nothing saved yet. Click the bookmark on any headline to keep it here.'}
            {filtered && <button type="button" className={news.emptyBtn} onClick={clearFilters}>Clear filters</button>}
          </div>
        )}
        {page.items.map((it) => (
          <SavedRow key={it.id} item={it} collections={lib.collections} linkedSym={linkedSym} onSym={onSym}
            onExplain={onExplain} explainOpen={explainId === it.id} onCloseExplain={onCloseExplain} onRemove={onRemove}
            noteOpen={noteFor === it.id} onNote={onNote} onActions={onActions} actionsOpen={actionsId === it.id}
            needles={needles} />
        ))}
        {page.total > page.items.length && (
          <button type="button" className={`${news.emptyBtn} ${styles.more}`} disabled={page.loading}
            onClick={() => fetchPage(page.limit + PAGE)}>Show more ({(page.total - page.items.length).toLocaleString()} left)</button>
        )}
      </div>
    </>
  )
}

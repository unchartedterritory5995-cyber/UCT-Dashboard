/**
 * DockNews — the Company Panel's news wire.
 *
 * Reads ONE UCT endpoint (`/api/company-news/{sym}`) which serves our own
 * store. Opening a company's News tab contacts no provider, and search and
 * pagination are server-side reads of the same store — so user count never
 * moves provider request volume.
 *
 * Deliberately NOT another financial table. Financials, Earnings and
 * Ownership are grids of numbers; news is a chronological wire, so the row is
 * source·time / headline / description with an optional thumbnail, and the
 * shared vocabulary with the other tabs comes from the section heads, the
 * segmented filter and the inline accordion rather than from columns.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import styles from './dockPanels.module.css'
import {
  categoryLabel, descLines, emptyHint, emptyMessage, exactTime,
  feedQuery, groupByDay, isBreaking, mediaKind, mergePage, rowTime, sourceLabel,
} from './newsFeedModel'

const PAGE = 25
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'bullish', label: 'Bullish' },
  { key: 'bearish', label: 'Bearish' },
]

/* Skeleton rows while the first page loads. Restrained, panel-shaped, and
   sized like real rows so nothing jumps when content lands (§36). */
function Skeleton() {
  return (
    <div className={styles.nwSkel} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div key={i} className={styles.nwSkelRow}>
          <div className={styles.nwSkelMeta} />
          <div className={styles.nwSkelHead} />
          <div className={styles.nwSkelHead} style={{ width: '62%' }} />
        </div>
      ))}
    </div>
  )
}

function Story({ item, open, onToggle, lines, now }) {
  const media = mediaKind(item)
  const when = rowTime(item.published_at, now)
  const breaking = isBreaking(item, now)
  const cat = categoryLabel(item.category)
  const sent = item.sentiment === 'bullish' ? 'up'
    : item.sentiment === 'bearish' ? 'down' : ''
  const [related, setRelated] = useState(null)

  // Related coverage is only fetched when a row is actually opened.
  useEffect(() => {
    if (!open || related !== null || !item.event_key) return
    let alive = true
    fetch(`/api/company-news/${encodeURIComponent(item._sym)}/related/${item.id}`)
      .then(r => (r.ok ? r.json() : { items: [] }))
      .then(d => { if (alive) setRelated(d.items || []) })
      .catch(() => { if (alive) setRelated([]) })
    return () => { alive = false }
  }, [open, related, item.event_key, item.id, item._sym])

  return (
    <div className={`${styles.nwItem}${open ? ' ' + styles.nwItemOpen : ''}`}>
      <button
        type="button"
        className={styles.nwRow}
        aria-expanded={open}
        onClick={onToggle}
      >
        <div className={styles.nwMain}>
          <div className={styles.nwMeta}>
            <span className={`${styles.nwSrc} ${styles['nwSrc_' + (item.source_class || 'journalism')] || ''}`}>
              {sourceLabel(item)}
            </span>
            {when && <span className={styles.nwDot}>·</span>}
            {when && <span className={styles.nwTime}>{when}</span>}
            {breaking && <span className={styles.nwBreaking}>Breaking</span>}
            {sent && (
              <span
                className={`${styles.nwSent} ${styles[sent]}`}
                title={item.sentiment_reason || item.sentiment}
              >{item.sentiment === 'bullish' ? '▲' : '▼'}</span>
            )}
          </div>
          <div className={styles.nwHead}>{item.headline}</div>
          {/* The expansion prints the description in full, so the clamped
              copy would show the same sentence twice, stacked. */}
          {item.description && lines > 0 && !open && (
            <div className={styles.nwDesc} style={{ WebkitLineClamp: lines }}>
              {item.description}
            </div>
          )}
        </div>
        {media === 'image' && (
          <img
            className={styles.nwThumb}
            src={item.image_url}
            alt=""
            loading="lazy"
            decoding="async"
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
        )}
        {media === 'video' && (
          <span className={styles.nwPlay} aria-hidden="true">
            <UIcon name="play" size={13} gold={false} />
          </span>
        )}
      </button>

      {open && (
        <div className={styles.nwExp}>
          {item.description && <div className={styles.nwExpText}>{item.description}</div>}

          {/* Video loads ONLY on expand, and only via X's own embed — nothing
              is downloaded or rehosted. */}
          {mediaKind(item) === 'video' && (
            <a className={styles.nwEmbed} href={item.embed_url}
               target="_blank" rel="noreferrer">
              <UIcon name="play" size={14} gold={false} />
              <span>Play post on X</span>
            </a>
          )}

          <div className={styles.nwFacts}>
            <span className={styles.nwFactK}>Source</span>
            <span className={styles.nwFactV}>{item.source || '—'}</span>
            <span className={styles.nwFactK}>Published</span>
            <span className={styles.nwFactV}>{exactTime(item.published_at)}</span>
            {cat && <><span className={styles.nwFactK}>Category</span>
              <span className={styles.nwFactV}>{cat}</span></>}
            {item.form_type && <><span className={styles.nwFactK}>Form</span>
              <span className={styles.nwFactV}>{item.form_type}</span></>}
            {item.sentiment_reason && <><span className={styles.nwFactK}>Signal</span>
              <span className={`${styles.nwFactV} ${styles[sent] || ''}`}>
                {item.sentiment_reason}</span></>}
            {item.author && <><span className={styles.nwFactK}>Author</span>
              <span className={styles.nwFactV}>{item.author}</span></>}
          </div>

          {related && related.length > 0 && (
            <div className={styles.nwRelated}>
              <div className={styles.nwRelHead}>Also covered by</div>
              {related.map((r, i) => (
                <a key={i} className={styles.nwRelItem} href={r.url}
                   target="_blank" rel="noreferrer">
                  <span className={styles.nwRelSrc}>{r.source_display}</span>
                  <span className={styles.nwRelTitle}>{r.headline}</span>
                </a>
              ))}
            </div>
          )}

          {item.url && (
            <a className={styles.nwOpen} href={item.url} target="_blank" rel="noreferrer">
              {item.source_class === 'primary' ? 'View filing'
                : item.source_class === 'social' ? 'View post' : 'Read source'}
              <UIcon name="link" size={11} gold={false} />
            </a>
          )}
        </div>
      )}
    </div>
  )
}

export default function DockNews({ sym, sentiment: sentimentProp, onSentiment }) {
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [state, setState] = useState('idle')   // idle|loading|paging|ready|error|gated
  // The filter is persisted with the rest of the dock state, so it survives a
  // tab switch. Falls back to local state when rendered standalone (tests).
  const [localSentiment, setLocalSentiment] = useState('all')
  const sentiment = sentimentProp ?? localSentiment
  const setSentiment = useCallback((v) => {
    setLocalSentiment(v)
    if (onSentiment) onSentiment(v)
  }, [onSentiment])
  const [rawQuery, setRawQuery] = useState('')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState(null)
  const [width, setWidth] = useState(360)
  const [now, setNow] = useState(() => Date.now())

  const scrollRef = useRef(null)
  const wrapRef = useRef(null)
  const reqId = useRef(0)

  // Debounce typing so search feels live without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery.trim()), 220)
    return () => clearTimeout(t)
  }, [rawQuery])

  // Relative times drift; refresh the clock rather than the data.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  // Panel width drives description clamping. Container queries own the layout;
  // this only decides how many lines of prose survive.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const load = useCallback(async (opts = {}) => {
    if (!sym) return
    const paging = !!opts.cursor
    const id = ++reqId.current
    setState(paging ? 'paging' : 'loading')
    try {
      const qs = feedQuery({
        limit: PAGE, cursor: opts.cursor || '', sentiment, q: query,
      })
      const r = await fetch(`/api/company-news/${encodeURIComponent(sym)}?${qs}`)
      // 402 is the membership gate, not an outage — say so plainly rather
      // than showing "temporarily unavailable" and a Retry that cannot work.
      if (r.status === 402 || r.status === 401 || r.status === 403) {
        if (id !== reqId.current) return
        setItems([])
        setCursor(null)
        setHasMore(false)
        setState('gated')
        return
      }
      if (!r.ok) throw new Error(`http ${r.status}`)
      const d = await r.json()
      if (id !== reqId.current) return       // a newer request already won
      setItems(prev => (paging ? mergePage(prev, d.items) : (d.items || [])))
      setCursor(d.next_cursor || null)
      setHasMore(!!d.has_more)
      setState('ready')
    } catch {
      if (id !== reqId.current) return
      if (!paging) setItems([])
      setState('error')
    }
  }, [sym, sentiment, query])

  // Reset the feed whenever the symbol, filter or search changes.
  useEffect(() => {
    setItems([])
    setCursor(null)
    setOpenId(null)
    if (sym) load()
  }, [sym, sentiment, query, load])

  const loadMore = useCallback(() => {
    if (!cursor || state === 'paging') return
    // Anchor on the control so the list does not jump under the reader.
    const el = scrollRef.current
    const before = el ? el.scrollTop : 0
    load({ cursor }).then(() => {
      if (el) el.scrollTop = before
    })
  }, [cursor, state, load])

  const groups = useMemo(() => groupByDay(items, now), [items, now])
  const lines = descLines(width)
  const decorated = useMemo(
    () => items.map(i => ({ ...i, _sym: sym })), [items, sym])
  const bySym = useMemo(() => {
    const m = new Map()
    for (const d of decorated) m.set(d.id, d)
    return m
  }, [decorated])

  if (!sym) return <div className={styles.emptyState}>No symbol.</div>

  const searching = !!query
  const firstLoad = state === 'loading' && items.length === 0

  return (
    <div className={styles.nw} ref={wrapRef}>
      <div className={styles.nwBar}>
        <div className={styles.nwSearchWrap}>
          <UIcon name="search" size={12} gold={false} />
          <input
            className={styles.nwSearch}
            type="search"
            value={rawQuery}
            placeholder={`Search ${sym} news…`}
            aria-label={`Search ${sym} news`}
            onChange={e => setRawQuery(e.target.value)}
          />
          {rawQuery && (
            <button type="button" className={styles.nwClear}
                    onClick={() => setRawQuery('')} aria-label="Clear search">
              <UIcon name="x" size={11} gold={false} />
            </button>
          )}
        </div>
      </div>

      <div className={styles.nwSeg}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            className={`${styles.finSegBtn}${sentiment === f.key ? ' ' + styles.finSegOn : ''}`}
            aria-pressed={sentiment === f.key}
            onClick={() => setSentiment(f.key)}
          >{f.label}</button>
        ))}
      </div>

      {searching && state === 'ready' && (
        <div className={styles.nwSearchNote}>
          {items.length > 0
            ? `${items.length}${hasMore ? '+' : ''} result${items.length === 1 ? '' : 's'} for “${query}”`
            : `No results for “${query}”`}
          <button type="button" className={styles.nwClearLink}
                  onClick={() => setRawQuery('')}>Clear</button>
        </div>
      )}

      <div className={styles.nwFeed} ref={scrollRef}>
        {firstLoad && <Skeleton />}

        {state === 'gated' && (
          <div className={styles.nwEmpty}>
            <div className={styles.nwEmptyTitle}>
              Company news is part of a UCT membership.
            </div>
            <div className={styles.nwEmptyHint}>
              Sign in with an active plan to see {sym} filings, company
              releases and coverage.
            </div>
          </div>
        )}

        {state === 'error' && items.length === 0 && (
          <div className={styles.emptyState}>
            News is temporarily unavailable.
            <button type="button" className={styles.nwRetry}
                    onClick={() => load()}>Retry</button>
          </div>
        )}

        {state === 'ready' && items.length === 0 && (
          <div className={styles.nwEmpty}>
            <div className={styles.nwEmptyTitle}>
              {emptyMessage({ sym, sentiment, query })}
            </div>
            <div className={styles.nwEmptyHint}>
              {emptyHint({ sentiment, query })}
            </div>
          </div>
        )}

        {groups.map(g => (
          <div key={g.key} className={styles.nwGroup}>
            <div className={styles.nwDate}>{g.label}</div>
            {g.items.map(it => (
              <Story
                key={it.id}
                item={bySym.get(it.id) || it}
                open={openId === it.id}
                onToggle={() => setOpenId(openId === it.id ? null : it.id)}
                lines={lines}
                now={now}
              />
            ))}
          </div>
        ))}

        {hasMore && items.length > 0 && (
          <button type="button" className={styles.etMore} onClick={loadMore}
                  disabled={state === 'paging'}>
            {state === 'paging' ? 'Loading…' : 'Load older stories'}
          </button>
        )}
        {!hasMore && items.length > 0 && (
          <div className={styles.nwEnd}>End of stored history</div>
        )}
      </div>
    </div>
  )
}

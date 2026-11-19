// UNEWS: UCT News, the live news wire, as a Terminal panel (2026-11-19).
//
//   UNEWS         the whole wire, newest first, live; step back a day at a time
//   NVDA UCN      every archived headline that names NVDA, newest first, live
//
// ⭐ NO NEW ROUTE AND NO NEW STREAM. This is the same feed the /charts "UCT News" widget shows:
//   * the live rows come from the ONE pool lib/tradeExchangeNewsStreamManager.js holds for the
//     whole browser tab. The panel never opens a transport; it declares a need
//     (lib/panelContract.js) and holds a handle. The server allows a member 6 streams, and every
//     UNEWS panel plus every open widget in the tab share one. The pool closes it when the last
//     of them leaves, so unmounting this panel releases its hold and nothing else.
//   * a day, and the one-stock search, are the widget's own by-day hook
//     (pages/charts/widgets/useTradeExchangeNewsDay.js) over POST /api/trade-exchange-news/day.
//   * every rule about a headline is the widget's model, imported in uctNewsModel.js.
// The widget's own row (TradeExchangeNewsParts `Row`) is NOT embedded: it is styled by the
// widget's theme variables, links a ticker to a chart colour group, and carries the widget's
// menus. A Terminal row is the kit's: a ticker is a `PanelSymbol`, so it loads into the linked
// panels (or opens DES beside the list) like every other market list.
//
// ⛔ A NEW HEADLINE NEVER MOVES THE ROW BEING READ. Once the member has scrolled down, headlines
// that arrive are held back and counted on a "N new headlines" control that takes no room in the
// list; pressing it (or scrolling back to the top) shows them.
// ⛔ A SWITCHED-OFF WIRE IS ONE SENTENCE, NEVER AN EMPTY LIST, and a failed read is an error with
// Retry. A quiet wire, a filter that matches nothing and a day before the archive each say which.
// ⛔ THE TIME ON A ROW IS WHEN UCT RECEIVED IT. The provider sends no publication time.
// ⛔ TICKERS ARE WORKED OUT BY UCT FROM THE WORDS (the server marks them provisional). The panel
// says so, and the one-stock view says how far back it has searched.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import Input from '../../../components/ui/Input'
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'
import { declareNeed, DELIVERY } from '../../../lib/panelContract'
import useTradeExchangeNewsDay from '../../charts/widgets/useTradeExchangeNewsDay'
import {
  CATEGORY_FILTERS, addDays, coverageNotice, dayLabel, dayRequest, visibleItems,
} from '../../charts/widgets/tradeExchangeNewsModel'
import { canRetry, failureKind, failureText } from './marketRead'
import {
  FILTER_DEBOUNCE_MS, FILTER_MAX, SCROLL_HOLD_PX, UCT_NEWS_CODE, UCT_NEWS_NAME, UCT_NEWS_SOURCE, canStep, cleanFilter,
  connectionWords, emptyWords, feedOff, heldLabel, matchingSentence, newsView, offState, reachSentence, rowPieces, rowTime,
  splitHeld, toggleType, topSeq,
} from './uctNewsModel'
import market from './marketPanels.module.css'
import form from './panelForm.module.css'
import css from './uctNewsPanel.module.css'

export {
  FILTER_DEBOUNCE_MS, FILTER_MAX, SCROLL_HOLD_PX, UCT_NEWS_CODE, UCT_NEWS_NAME, UCT_NEWS_SOURCE, canStep, cleanFilter,
  connectionWords, emptyWords, feedOff, heldLabel, matchingSentence, newsView, offState, reachSentence, rowPieces, rowTime,
  splitHeld, toggleType, topSeq,
} from './uctNewsModel'

// A handle on the shared pool, never a URL (TERM-024). Every headline matters: the pool merges
// each one by sequence number and replays a missed one.
const NEWS = declareNeed({ kind: 'trade-exchange-news', delivery: DELIVERY.EVERY_MESSAGE_MATTERS })

const count = (n) => formatNumber(n, { decimals: 0 })
const plural = (n, one, many) => (n === 1 ? one : many)

/** The element that scrolls this panel: the shell's panel body, else the page. */
export function scrollParentOf(el) {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const oy = typeof getComputedStyle === 'function' ? getComputedStyle(p).overflowY : ''
    if (oy === 'auto' || oy === 'scroll') return p
  }
  return typeof document === 'undefined' ? null : (document.scrollingElement || document.documentElement)
}

function Headline({ item, mode, query }) {
  const pieces = useMemo(() => rowPieces(item, query), [item, query])
  return (
    <li className={market.newsItem} data-testid="terminal-unews-row" data-seq={item.seq}>
      <span className={css.text}>
        {pieces.map((p) => (p.sym
          ? <PanelSymbol key={p.key} sym={p.sym} className={market.sym}>{p.text}</PanelSymbol>
          : p.hit ? <mark key={p.key} className={css.hit}>{p.text}</mark> : <span key={p.key}>{p.text}</span>))}
      </span>
      <span className={market.newsMeta}>
        <span className={css.time} data-testid="terminal-unews-time" title="When UCT received it. The provider sends no publication time.">{rowTime(item.received_at_ms, mode)}</span>
        <span>{item.category || 'Other'}</span>
        {item.repeat_count > 0 ? <span>received {count(item.repeat_count + 1)} times</span> : null}
        {item.delayed ? <span>reached UCT late</span> : null}
      </span>
    </li>
  )
}

export default function UctNewsPanel({ sym = null }) {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || UCT_NEWS_CODE
  const ids = useId()
  const view = useMemo(() => newsView(sym), [sym])
  const stock = view.mode === 'stock'

  // ── the shared pool: one subscription, released on unmount ──
  const feed = useSyncExternalStore(NEWS.subscribe, NEWS.read)
  const off = feedOff(feed)

  // ── filters: a typed word (sent after a pause) and the type chips ──
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQuery(cleanFilter(draft)), FILTER_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [draft])
  const [types, setTypes] = useState([])
  const filtered = !!query || types.length > 0
  const clearFilters = () => { setDraft(''); setQuery(''); setTypes([]) }

  // ── the day (or, for one stock, every archived day), filtered by the server ──
  const rule = useMemo(() => ({ query, linkedSym: view.sym, categories: types, hidePlaceholders: true }), [query, view.sym, types])
  const matches = useMemo(() => visibleItems(feed.items || [], rule), [feed.items, rule])
  const request = useMemo(() => dayRequest(rule), [rule])
  const day = useTradeExchangeNewsDay({ feed, matches, request, enabled: !off, history: stock })
  const rows = day.rows

  // ── new rows are held back while the member reads further down ──
  const [root, setRoot] = useState(null)
  const [heldSeq, setHeldSeq] = useState(null)
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const scrollerRef = useRef(null)
  useEffect(() => {
    const el = scrollParentOf(root)
    scrollerRef.current = el
    if (!el) return undefined
    const page = typeof document !== 'undefined' && (el === document.scrollingElement || el === document.documentElement)
    const target = page ? window : el
    const onScroll = () => {
      const atTop = el.scrollTop < SCROLL_HOLD_PX
      setHeldSeq((cur) => (atTop ? null : (cur ?? topSeq(rowsRef.current))))
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => target.removeEventListener('scroll', onScroll)
  }, [root])
  // A new day or filter starts at its top, with nothing held.
  const viewKey = `${view.mode}|${view.sym || ''}|${day.dateKey || 'all'}|${JSON.stringify(request)}`
  useLayoutEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
    setHeldSeq(null)
  }, [viewKey])
  const { shown, held } = useMemo(() => splitHeld(rows, heldSeq), [rows, heldSeq])
  const showHeld = () => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
    setHeldSeq(null)
  }

  const newestMs = rows.length ? rows[0].received_at_ms : null
  // The header's source line is dated by the newest headline on screen. With no headline there is
  // nothing to date, so nothing is reported (never a stand-in "now", never a source for a wire that is off).
  usePanelFreshness(!off && newestMs ? panelAsOf(UCT_NEWS_SOURCE, new Date(newestMs).toISOString()) : null)

  if (off) {
    const st = offState(feed.reason)
    return (
      <PanelState kind={st.kind} role="status" testId="terminal-unews-off" title={st.title}
        action={st.retry ? <button type="button" className={market.chip} onClick={() => NEWS.retry()}>Retry</button> : null} />
    )
  }

  const dayText = stock ? '' : dayLabel(day.dateKey, day.todayKey)
  const conn = connectionWords(feed, { live: day.live, mode: view.mode, dayText })
  const gap = coverageNotice(feed.coverage)
  const oldestMs = rows.length ? rows[rows.length - 1].received_at_ms : null
  const reach = stock
    ? reachSentence({ hasOlder: day.hasOlder, searchedTo: day.searchedTo, oldestMs, meta: day.meta, todayKey: day.todayKey })
    : ''
  const firstLoad = day.loading && !rows.length
  const failed = day.error && !rows.length
  const locked = failed && !canRetry(day.error)
  const prevKey = !stock && day.dateKey ? addDays(day.dateKey, -1) : null
  const listLabel = stock
    ? `${UCT_NEWS_NAME} headlines naming ${view.sym}, newest first`
    : `${UCT_NEWS_NAME} headlines for ${dayText}, newest first`

  return (
    <div ref={setRoot} className={`${market.wrap} ${inPanel ? market.inPanel : ''}`} data-testid="terminal-unews"
      data-mode={view.mode} data-sym={view.sym || undefined} data-day={day.dateKey || 'all'}>
      <form className={form.form} role="search" aria-label={`Filter ${UCT_NEWS_NAME}`} noValidate onSubmit={(e) => e.preventDefault()}
        data-testid="terminal-unews-form">
        <label className={form.field} htmlFor={`${ids}-q`}>Filter</label>
        <Input id={`${ids}-q`} type="search" className={`${form.input} ${form.grow}`} value={draft} maxLength={FILTER_MAX}
          placeholder="A word, a phrase or a ticker" autoComplete="off" spellCheck={false}
          onChange={(e) => setDraft(e.target.value)} data-testid="terminal-unews-filter" />
      </form>
      <div className={market.toolbar} role="toolbar" aria-label={`${UCT_NEWS_NAME} controls`}>
        <div className={market.group} role="group" aria-label="Headline type">
          <button type="button" className={market.chip} aria-pressed={types.length === 0} onClick={() => setTypes([])}
            data-testid="terminal-unews-type-all">All types</button>
          {CATEGORY_FILTERS.map((c) => (
            <button key={c} type="button" className={market.chip} aria-pressed={types.includes(c)}
              onClick={() => setTypes((cur) => toggleType(cur, c))} data-testid={`terminal-unews-type-${c}`}>{c}</button>
          ))}
        </div>
        {stock ? null : (
          <div className={market.group} role="group" aria-label="Day">
            <button type="button" className={market.chip} onClick={day.prevDay} disabled={!canStep(prevKey, day.meta, day.todayKey)}
              data-testid="terminal-unews-prev">Earlier day</button>
            <span className={css.day} data-testid="terminal-unews-day">{dayText}{day.isToday ? ' (today)' : ''}</span>
            <button type="button" className={market.chip} onClick={day.nextDay} disabled={day.isToday}
              data-testid="terminal-unews-next">Later day</button>
            {day.isToday ? null : (
              <button type="button" className={market.chip} onClick={day.toLatest} data-testid="terminal-unews-latest">Back to today</button>
            )}
          </div>
        )}
      </div>
      <p className={css.status} role="status" data-testid="terminal-unews-status" data-tone={conn.tone}>
        <span className={css.dot} data-tone={conn.tone} aria-hidden="true" />
        <span>{conn.words}</span>
      </p>
      {feed.status === 'failed' ? (
        <p className={market.note} data-testid="terminal-unews-stream-failed">
          The live stream could not be opened, so nothing new is added here.{' '}
          <button type="button" className={market.chip} onClick={() => NEWS.retry()}>Retry</button>
        </p>
      ) : null}
      {gap ? <p className={market.note} role="status" data-testid="terminal-unews-gap">{gap.text}. {gap.title}</p> : null}
      {day.error && rows.length ? (
        <p className={market.note} role="status" data-testid="terminal-unews-stale-read">
          {failureText(day.error, UCT_NEWS_NAME)} Showing what was already loaded.{' '}
          <button type="button" className={market.chip} onClick={day.retry}>Retry</button>
        </p>
      ) : null}
      {stock ? <p className={market.muted} data-testid="terminal-unews-reach">{reach} {matchingSentence(view.sym)}</p> : null}
      {firstLoad ? (
        <PanelSkeleton label={stock ? `Searching ${UCT_NEWS_NAME} for ${view.sym}` : `Loading ${UCT_NEWS_NAME}`} testId="terminal-unews-loading" />
      ) : failed ? (
        <PanelState kind={failureKind(day.error)} testId="terminal-unews-error" title={failureText(day.error, UCT_NEWS_NAME)}
          action={locked ? null : <button type="button" className={market.chip} onClick={day.retry}>Retry</button>}>
          {locked ? null : `That is not the same as a quiet wire. Retry, or run ${code} again.`}
        </PanelState>
      ) : !rows.length ? (
        (() => {
          const e = emptyWords({ mode: view.mode, sym: view.sym, filtered, isToday: day.isToday, dateKey: day.dateKey,
            todayKey: day.todayKey, meta: day.meta, searching: stock && day.hasOlder, reach })
          return (
            <PanelState kind="empty" compact role="status" testId="terminal-unews-empty" title={e.title}
              action={filtered ? <button type="button" className={market.chip} onClick={clearFilters}>Clear the filters</button> : null}>
              {stock ? null : e.hint}
            </PanelState>
          )
        })()
      ) : (
        <>
          <p className={market.lede} data-testid="terminal-unews-count">
            {stock
              ? `${count(rows.length)} ${plural(rows.length, 'headline', 'headlines')} naming ${view.sym} found${day.hasOlder ? ' so far' : ''}${filtered ? ', with the filters above' : ''}.`
              : day.total == null
                ? `${count(rows.length)} ${plural(rows.length, 'headline', 'headlines')} loaded for ${dayText}.`
                : filtered && day.dayTotal != null
                  ? `${count(day.total)} of ${count(day.dayTotal)} ${plural(day.dayTotal, 'headline', 'headlines')} on ${dayText} ${plural(day.total, 'matches', 'match')} the filters above.`
                  : `${count(day.total)} ${plural(day.total, 'headline', 'headlines')} on ${dayText}.`}
            {!stock && day.total != null && rows.length < day.total ? ` The newest ${count(rows.length)} are loaded.` : ''}
          </p>
          <div className={css.newAnchor}>
            {held > 0 ? (
              <button type="button" className={css.newBtn} onClick={showHeld} data-testid="terminal-unews-new"
                title="Headlines that arrived while you were reading. They are held back so the list does not move.">
                Show {heldLabel(held)}
              </button>
            ) : null}
          </div>
          <span className="sr-only" role="status" data-testid="terminal-unews-held">
            {held > 0 ? `${heldLabel(held)} held back while you read.` : ''}
          </span>
          <ol className={`${market.newsList} ${day.loading ? css.listBusy : ''}`} aria-label={listLabel} aria-busy={day.loading || day.loadingMore || undefined}
            data-testid="terminal-unews-list">
            {shown.map((it) => <Headline key={it.seq} item={it} mode={view.mode} query={query} />)}
          </ol>
          {day.hasOlder ? (
            <div className={market.toolbar}>
              <button type="button" className={market.chip} onClick={day.loadOlder} disabled={day.loadingMore} data-testid="terminal-unews-older">
                {day.loadingMore ? 'Loading' : stock ? 'Search earlier days' : 'Show earlier headlines'}
              </button>
              <span className={market.muted} data-testid="terminal-unews-cut">
                {stock
                  ? 'The archive is searched a few days at a time, so a step can find nothing and still have further to go.'
                  : `Earlier headlines of ${dayText} are not loaded yet.`}
              </span>
            </div>
          ) : (
            <p className={css.end} data-testid="terminal-unews-end">
              {stock ? `That is every archived headline naming ${view.sym}${filtered ? ' that matches the filters above' : ''}.`
                : `Start of ${dayText}${day.meta?.first_day === day.dateKey && day.meta?.first_day_partial ? `. The ${UCT_NEWS_NAME} archive began partway through this day` : ''}.`}
            </p>
          )}
        </>
      )}
      <p className={market.muted} data-testid="terminal-unews-method">
        {UCT_NEWS_NAME}, powered by Trade Exchange. The time on a headline is when UCT received it, in New York time; the provider sends no
        publication time.{' '}
        {stock ? '' : `${matchingSentence(null)} `}
        Click a ticker to load it into the linked panels, or to open its DES beside this one.
        {day.hidden > 0 ? ` ${count(day.hidden)} ${plural(day.hidden, 'post that was', 'posts that were')} only a picture, with no headline text, ${plural(day.hidden, 'is', 'are')} left out.` : ''}
        {' '}Headlines that arrive while you read further down are held back until you ask for them.
      </p>
    </div>
  )
}

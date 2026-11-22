import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { setupLine } from './setupLine'
import { livePriceOf } from './livePrice'
import Sparkline from '../../../components/Sparkline'
import useSparks from './useSparks'
import RsResultRow from './RsResultRow'
import { rowDisplay, leadOf, setupWords } from './rsRows'
import BoardRow, { BoardCols } from './board/BoardRow'
import boardStyles from './board/Board.module.css'
import { fmtPrice, fmtChg } from './rowNumbers'
import { MQ } from '../../../styles/breakpoints'
import styles from './FocusScreener.module.css'

// One row, memoised. Live prices arrive as a fresh object per ticker on every stream message,
// so the list hands each row PRIMITIVES (its live price and change) plus stable references (the
// row object, `onSelect`, the hub cursor's constant prop objects). A tick for one ticker then
// re-renders that ticker's row only, not every loaded row.
const ResultRow = memo(function ResultRow({ r, i, sel, price, chg, onRadar, onSelect, hubProps, showCompany, structures, spark, isNew = false }) {
  const s = setupLine({ ...r, price }, structures)
  return (
    <div id={`focus-opt-${r.ticker}`} role="option" aria-selected={sel}
      data-index={i} data-testid={`focus-row-${r.ticker}`}
      className={`${styles.row} ${sel ? styles.rowSel : ''} ${s.quiet ? styles.rowQuiet : ''}`}
      onClick={() => onSelect(i)} {...(hubProps || {})}>
      <span className={onRadar ? styles.dotOn : styles.dotOff}
        {...(onRadar ? { 'aria-label': 'On your radar', role: 'img' } : { 'aria-hidden': true })} />
      <span className={styles.rowMain}>
        {/* New today (spec 2026-10-16 s1): in the screen now, not at the previous nightly build. */}
        <span className={styles.ticker}>{r.ticker}{isNew && <span className={styles.newPill}><span className="sr-only">, </span>New</span>}</span>
        {showCompany && r.company && <span className={styles.rowCompany}>{r.company}</span>}
        <span className={styles.setup} title={s.title || undefined}>{s.text}{s.detail ? ` · ${s.detail}` : ''}</span>
      </span>
      {/* ~3 months of daily closes; the cache hands the same array each render, so the memo holds. */}
      <span className={styles.rowSpark} title="Last 3 months, daily closes">
        {spark && spark.length > 1 && <Sparkline values={spark} width={56} height={20} fill={false} />}
      </span>
      <span className={styles.rowNums}>
        <span>{fmtPrice(price)}</span>
        <span className={chg > 0 ? styles.up : chg < 0 ? styles.down : styles.flat}>{fmtChg(chg)}</span>
      </span>
    </div>
  )
})

// The screen's structure library and the structures it was screened for (setupLine reads both).
const NO_STRUCTURES = {}
// Rows kept visible beyond the selection when it moves, so the next stock is always in view.
export const LOOKAHEAD_ROWS = 2
// Phones, RS screens: the page is the scroller, not the list (`data-phone-scroll`,
// FocusScreener.module.css). The floating buttons cover this much of its foot (the same 152px the
// list's bottom padding clears).
export const PHONE_FLOOR_PX = 152
const phonePage = list => {
  if (!list || typeof window === 'undefined' || window.matchMedia?.(MQ.phone)?.matches !== true) return null
  return list.closest('[data-phone-scroll]')
}

const ResultList = forwardRef(function ResultList(
  { rows, index, onSelect, onKeyDown, livePrices = {}, radar = new Set(), sortLabel, onSort, total, hasMore, onLoadMore, isLoading, itemProps, showCompany = false, sortMenu, pending = false, structures = NO_STRUCTURES, headExtra = null, newSet = null, rsRow = null, themes = null, headBelow = null, board = null, title = null },
  ref,
) {
  const listRef = useRef(null)
  // The scan board (board/boardModel.js): `board` is this Results widget's settings ({ rows, logos,
  // spark, group, seen, hints, roomy }), null everywhere else, and every branch below that reads it
  // then renders the list as it always was.
  const labMode = board ? board.rows : null
  const custom = !!labMode && labMode !== 'two'
  const [seen, setSeen] = useState(() => new Set())
  const curTicker = rows[index]?.ticker
  const seenOn = !!board?.seen
  useEffect(() => { if (seenOn && curTicker) setSeen(prev => (prev.has(curTicker) ? prev : new Set(prev).add(curTicker))) }, [curTicker, seenOn])
  const groupOn = !!board?.group && labMode !== 'chips'
  const labels = useMemo(() => (groupOn ? rows.map(r => (rsRow ? setupWords(r) : setupLine(r, NO_STRUCTURES).text) || 'Other') : null), [groupOn, rows, rsRow])
  const groupCounts = useMemo(() => { const m = {}; (labels || []).forEach(l => { m[l] = (m[l] || 0) + 1 }); return m }, [labels])
  // RS screens (unit U5): `rsRow` is the open starter's row description (rsRows.rowConfigOf), null
  // on every other screen. With it, each row's place, caption and tag are worked out ONCE per
  // result set (never per price tick) and handed to the row as primitives.
  const rsView = useMemo(() => (rsRow
    ? rows.map((r, i) => rowDisplay(r, rsRow, { index: i, theme: themes ? themes[r.ticker] : null, isNew: !!newSet && newSet.has(r.ticker) }))
    : null), [rows, rsRow, themes, newSet])
  const sparkTickers = useMemo(() => rows.map(r => r.ticker), [rows])
  const sparks = useSparks(sparkTickers)
  // Scroll only the list's own container, never an ancestor or the window. The selection
  // keeps LOOKAHEAD_ROWS rows in view on either side (fewer at the ends of the list); when
  // the list is too short for that, the selected row itself always stays in view.
  const lastIndexRef = useRef(null)
  const scrollToIndex = useCallback(i => {
    const list = listRef.current
    const el = list?.querySelector(`[data-index="${i}"]`)
    const last = lastIndexRef.current
    lastIndexRef.current = i
    if (!list || !el) return
    if (list.dataset.dir === 'x') {
      // the board's chip strip scrolls sideways
      const lr = list.getBoundingClientRect(), r = el.getBoundingClientRect()
      if (r.left < lr.left + 60) list.scrollLeft -= lr.left + 60 - r.left
      else if (r.right > lr.right - 60) list.scrollLeft += r.right - (lr.right - 60)
      return
    }
    const page = phonePage(list)
    if (page) {
      // The page scrolls here. Only a STEP to the next or previous stock moves it (the chart
      // sheet's arrows, the joystick): a new list, or a tap on a row that is in view, must not
      // pull the page down from the screen's own header.
      if (last === null || Math.abs(i - last) !== 1) return
      const pr = page.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const head = list.parentElement?.firstElementChild
      const top = pr.top + (head && head !== list ? head.getBoundingClientRect().height || 0 : 0)
      const bottom = Math.min(pr.bottom, window.innerHeight || pr.bottom) - PHONE_FLOOR_PX
      if (r.top < top) page.scrollTop -= top - r.top
      else if (r.bottom > bottom) page.scrollTop += r.bottom - bottom
      return
    }
    const rowAt = k => list.querySelector(`[data-index="${k}"]`)
    let above = el
    for (let k = Math.max(0, i - LOOKAHEAD_ROWS); k < i; k++) { const r = rowAt(k); if (r) { above = r; break } }
    let below = el
    for (let k = i + LOOKAHEAD_ROWS; k > i; k--) { const r = rowAt(k); if (r) { below = r; break } }
    const lr = list.getBoundingClientRect()
    const off = node => {
      const r = node.getBoundingClientRect()
      return { top: r.top - lr.top + list.scrollTop, bottom: r.bottom - lr.top + list.scrollTop }
    }
    const sel = off(el)
    const want = { top: off(above).top, bottom: off(below).bottom }
    let next = list.scrollTop
    if (want.top < next) next = want.top
    else if (want.bottom > next + list.clientHeight) next = want.bottom - list.clientHeight
    // Never let the lookahead push the selected row itself out of view.
    next = Math.min(Math.max(next, sel.bottom - list.clientHeight), sel.top)
    if (next !== list.scrollTop) list.scrollTop = next
  }, [])
  useImperativeHandle(ref, () => ({ scrollToIndex }), [scrollToIndex])
  useEffect(() => { scrollToIndex(index) }, [index, scrollToIndex])

  // Auto-load when the last row nears the edge. Callbacks live in refs so the
  // observer is rebuilt only when the result set changes. The latch allows one
  // load per rows.length; it re-arms when a load settles (isLoading true to
  // false) without the list growing, because an observer does not re-report a
  // sentinel that never left the viewport.
  const endRef = useRef(null)
  const onLoadMoreRef = useRef(onLoadMore)
  const isLoadingRef = useRef(isLoading)
  const intersectingRef = useRef(false)
  const firedAtRef = useRef(null)
  const prevLoadingRef = useRef(!!isLoading)
  onLoadMoreRef.current = onLoadMore
  isLoadingRef.current = isLoading
  const rowCount = rows.length
  useEffect(() => {
    firedAtRef.current = null
    intersectingRef.current = false
    if (!hasMore || typeof IntersectionObserver === 'undefined' || !endRef.current) return undefined
    const io = new IntersectionObserver(es => {
      if (es.length) intersectingRef.current = es[es.length - 1].isIntersecting
      if (firedAtRef.current !== null || isLoadingRef.current) return
      if (es.some(e => e.isIntersecting)) {
        firedAtRef.current = rowCount
        onLoadMoreRef.current?.()
      }
    }, { rootMargin: '200px' })
    io.observe(endRef.current)
    return () => io.disconnect()
  }, [hasMore, rowCount])
  useEffect(() => {
    const was = prevLoadingRef.current
    prevLoadingRef.current = !!isLoading
    if (!was || isLoading) return
    // A load just settled. If the list did not grow and the sentinel is still
    // in view, nothing will report it again: ask once more.
    if (hasMore && firedAtRef.current === rowCount && intersectingRef.current) {
      onLoadMoreRef.current?.()
    }
  }, [isLoading, hasMore, rowCount])

  return (
    // `pending`: these rows answer the previous screen while the new one is on its way.
    <div className={`${styles.listWrap} ${board ? `${boardStyles.widget} ` : ''}${pending ? styles.listPending : ''}`} data-pending={pending ? '' : undefined}
      data-board-rows={labMode || undefined} data-roomy={board?.roomy ? '' : undefined}>
      {board ? (
        <div className={boardStyles.wHead}>
          <span className={boardStyles.wTitle}>{title || 'Results'}</span>
          <span className={boardStyles.wCount}>{rows.length ? `${(total ?? rows.length).toLocaleString('en-US')} stocks` : ''}</span>
          <span className={boardStyles.wSpacer} />
          {sortMenu || <button type="button" className={styles.linkBtn} onClick={onSort}>Sort: <span className={styles.listHeadValue}>{sortLabel}</span></button>}
          {headExtra}
        </div>
      ) : (
      <div className={styles.listHead}>
        {sortMenu || <button type="button" className={styles.linkBtn} onClick={onSort}>Sort: <span className={styles.listHeadValue}>{sortLabel}</span></button>}
        {/* B13: the flagged actions live here, in a row that is always this tall, so the first
            flag adds nothing above the list and nothing below it moves. */}
        <span className={styles.listHeadEnd}>
          {headExtra}
          <span>{rows.length ? `${index + 1} of ${total ?? rows.length}` : ''}</span>
        </span>
      </div>
      )}
      {/* RS screens (unit U8): "Why isn't a stock here?", under the list head and outside the listbox,
          so the list's own keys are not heard while a ticker is typed. Nothing on any other screen. */}
      {!board && headBelow}
      {custom && <BoardCols mode={labMode} hasPlace={!!rsRow?.place} logos={!!board.logos} spark={!!board.spark} />}
      <div ref={listRef} id="focus-results" role="listbox" aria-label="Screen results" tabIndex={0} aria-busy={pending}
        aria-activedescendant={rows[index] ? `focus-opt-${rows[index].ticker}` : undefined}
        className={labMode === 'chips' ? `${styles.list} ${boardStyles.chipsList}` : styles.list} data-focus-list="" data-dir={labMode === 'chips' ? 'x' : undefined}
        // Keyboard mode: while the member steps with the keys, hover paints nothing, so the
        // row under a resting pointer never looks more selected than the selection. Set on
        // the DOM directly: a state change here would re-render every row.
        onKeyDown={e => {
          e.currentTarget.setAttribute('data-kbd', '')
          // the board's chip strip: left / right step the list as up / down do
          if (labMode === 'chips' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { onKeyDown?.(Object.assign(Object.create(e), { key: e.key === 'ArrowRight' ? 'ArrowDown' : 'ArrowUp' })); return }
          onKeyDown?.(e)
        }}
        onPointerMove={e => { if (e.currentTarget.hasAttribute('data-kbd')) e.currentTarget.removeAttribute('data-kbd') }}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.removeAttribute('data-kbd') }}>
        {rows.map((r, i) => {
          const { price, chg } = livePriceOf(r, livePrices[r.ticker])
          const spark = sparks.get(r.ticker)
          // itemProps(i) returns one of two constant objects, so the row's prop stays stable.
          if (custom) {
            const d = rsView ? rsView[i] : null
            let caption = d ? d.caption : null
            const tag = d ? d.tag : (newSet && newSet.has(r.ticker) ? 'New' : null)
            if (!d) { const sl = setupLine({ ...r, price }, structures); caption = `${sl.text}${sl.detail ? ` · ${sl.detail}` : ''}` }
            const lead = leadOf(r)
            const gh = labels && (i === 0 || labels[i] !== labels[i - 1])
              ? <div key={`g-${i}`} className={boardStyles.groupHead} role="presentation">{labels[i]}<span className={boardStyles.groupN}>{groupCounts[labels[i]]}</span></div> : null
            const rowEl = (
              <BoardRow key={r.ticker} r={r} i={i} sel={i === index} price={price} chg={chg} mode={labMode}
                onRadar={radar.has(r.ticker)} onSelect={onSelect} hubProps={itemProps ? itemProps(i) : undefined}
                caption={caption} tag={tag} place={d ? d.place : null} hasPlace={!!rsRow?.place} leadValue={lead ? lead.value : null} leadTop={!!lead?.top}
                spark={spark} logos={!!board.logos} showSpark={!!board.spark} seen={seenOn && seen.has(r.ticker)} />
            )
            return gh ? [gh, rowEl] : rowEl
          }
          if (rsView) {
            const d = rsView[i]
            return (
              <RsResultRow key={r.ticker} r={r} i={i} sel={i === index} price={price} chg={chg}
                onRadar={radar.has(r.ticker)} onSelect={onSelect} hubProps={itemProps ? itemProps(i) : undefined}
                showCompany={showCompany} spark={spark} hasPlace={!!rsRow.place} place={d.place} caption={d.caption} tag={d.tag} />
            )
          }
          return (
            <ResultRow key={r.ticker} r={r} i={i} sel={i === index} price={price} chg={chg}
              onRadar={radar.has(r.ticker)} onSelect={onSelect} hubProps={itemProps ? itemProps(i) : undefined}
              showCompany={showCompany} structures={structures} spark={spark} isNew={!!newSet && newSet.has(r.ticker)} />
          )
        })}
        {hasMore && <div ref={endRef} className={styles.moreSentinel} aria-hidden="true" />}
      </div>
      {board ? (
        <div className={boardStyles.wFoot}>
          <span>{rows.length ? `${index + 1} of ${total ?? rows.length}` : ''}</span>
          {headBelow}
          {board.hints && <span className={boardStyles.wHints}><span><b>↑↓</b> move</span><span><b>⇧F</b> flag</span><span><b>W</b> watchlist</span><span><b>↵</b> full chart</span></span>}
        </div>
      ) : (
      <div className={styles.keyHints}>
        <span><b>↑↓</b> move</span><span><b>⇧F</b> flag</span><span><b>W</b> watchlist</span><span><b>↵</b> full chart</span>
      </div>
      )}
    </div>
  )
})
export default ResultList

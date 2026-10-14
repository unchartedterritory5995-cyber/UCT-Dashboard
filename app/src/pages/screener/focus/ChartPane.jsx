import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { SWRConfig, useSWRConfig } from 'swr'
import StockChart from '../../../components/StockChart'
import { hasFinalTickerIpo } from '../../../hooks/useTickerIpo'
import WhyStrip from './WhyStrip'
import { setupLine } from './setupLine'
import { plainFact } from './plainWords'
import { livePriceOf } from './livePrice'
import { earningsText } from './dates'
import { useThemeInk } from '../../../lib/theme'
import styles from './FocusScreener.module.css'

// The chart draws on canvas, where CSS variables do not reach: the pivot line reads --ut-gold through the theme.
const PIVOT_INK = { pivot: ['--ut-gold', '#dcbb5e'] }

// B4: how long a chart may stay without candles before the pane says it is unavailable.
export const CHART_TIMEOUT_MS = 12000
// Perf 2: a walk through the list changes the ticker every ~100ms. The live stream and the side
// fetches open only once the ticker has stayed put this long; cached bars paint at once.
export const SETTLE_MS = 80
// Side fetches a stepping chart does not need for its first paint: held while the ticker is
// unsettled. The bars themselves are never held.
const SIDE_FETCH = ['/api/ticker-ipo/', '/api/chart/markers/', '/api/chart-news/', '/api/education/tickers/']
const IPO = '/api/ticker-ipo/'

const fmt = v => (Number.isFinite(v) ? v.toFixed(2) : '—')
const pct = v => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%` : '—')

// Plain words (owner decision 5): the wording lives in plainWords.js, shared with the sort menu.
// Earnings is its own span (P8), so it can turn amber when it is near.
const facts = row => ['vol_ratio', 'adr_pct'].map(k => plainFact(k, row[k])).filter(Boolean).join(' · ')

const isSide = key => typeof key === 'string' && SIDE_FETCH.some(p => key.startsWith(p))
// Scoped to this pane's chart only (an SWRConfig around it), so every other chart is untouched:
//  · while the ticker is unsettled a side fetch makes no request. A value already in the SWR
//    cache for that key is still served (markers stay on a stock walked back to); a key with
//    nothing cached is asked with no key, so the hook shows its own fallback;
//  · a listing date is static: one the browser already holds as FINAL is never asked again.
// ⚠️ A cached value served while unsettled is not revalidated on settle (the key does not change);
// its own deduping window already covers these (12h markers, 30m news and mentions).
const QUIET = { revalidateOnMount: false, revalidateIfStale: false, revalidateOnFocus: false, revalidateOnReconnect: false }
function sideFetchGate(settled) {
  return useSWRNext => (key, fetcher, config) => {
    const { cache } = useSWRConfig()
    if (!isSide(key)) return useSWRNext(key, fetcher, config)
    if (!settled) {
      const held = cache.get(key)
      return held && held.data !== undefined ? useSWRNext(key, fetcher, { ...config, ...QUIET }) : useSWRNext(null, fetcher, config)
    }
    if (key.startsWith(IPO) && hasFinalTickerIpo(decodeURIComponent(key.slice(IPO.length)))) {
      return useSWRNext(key, fetcher, { ...config, ...QUIET })
    }
    return useSWRNext(key, fetcher, config)
  }
}

// S5: the chart itself, memoised on what it draws. A live price tick re-renders the pane's header,
// never StockChart. Every prop here is a primitive or an identity-stable value.
const PaneChart = memo(function PaneChart({ sym, tf, priceLines, settled, onDrawnBarCount, retry }) {
  const swr = useMemo(() => ({ use: [sideFetchGate(settled)] }), [settled])
  return (
    <SWRConfig value={swr}>
      <StockChart key={retry} sym={sym} tf={tf}
        showDrawingTools={false} showSavedDrawings
        hideReplay hidePatterns hideCompare hideCountdown disablePatterns
        backgroundWarm={false} liveUpdates={settled} hotkeysActive={false}
        boldCandles userCandleColors colorByNetChange candlesOnTop
        markVolumeExtremes hideWatermark hideJournalOverlay
        rightPadBars={4} dailyDefaultBars={126}
        volumeSeparatePane volumePaneHeightPct={9}
        priceScaleTopMargin={0.12} priceScaleBottomMargin={0.10}
        priceLines={priceLines} onDrawnBarCount={onDrawnBarCount} />
    </SWRConfig>
  )
})

const isEditable = t => /^(input|textarea|select)$/i.test(t?.tagName || '') || !!t?.isContentEditable

// `livePx` / `liveChg`: the selected stock's live price and change, as primitives (S5), so a tick
// for any other ticker never re-renders the pane. `onNavKey`: ↑/↓ pressed anywhere in the pane
// step the list (B7) — the pane is focusable, so a click on the chart keeps the keys working.
function ChartPane({ row, livePx, liveChg, why, now, onOpenFilters, onFlag, isFlagged, onWatch, onNavKey, structures }) {
  const [tf, setTf] = useState('D')
  const ink = useThemeInk(PIVOT_INK)
  const pivot = row?.base_pivot_px
  const priceLines = useMemo(() => (Number.isFinite(pivot)
    ? [{ price: pivot, color: ink.pivot, title: 'pivot' }] : []), [pivot, ink.pivot])
  const sym = row?.ticker || null

  // Perf 2: the ticker has stayed put SETTLE_MS.
  const [settledSym, setSettledSym] = useState(null)
  useEffect(() => {
    if (!sym) return undefined
    const t = setTimeout(() => setSettledSym(sym), SETTLE_MS)
    return () => clearTimeout(t)
  }, [sym])
  const settled = !!sym && settledSym === sym

  // B4: loading / ready / unavailable, per stock + timeframe (+ retry). Candles drawn means
  // ready; none within CHART_TIMEOUT_MS means unavailable. Reset during render on a new key.
  const [retry, setRetry] = useState(0)
  const chartKey = `${sym}|${tf}|${retry}`
  const [chart, setChart] = useState({ key: chartKey, state: 'loading' })
  let chartState = chart.state
  if (chart.key !== chartKey) {
    chartState = 'loading'
    setChart({ key: chartKey, state: 'loading' })
  }
  const onDrawnBarCount = useCallback(n => {
    if (n > 0) setChart(c => (c.key === chartKey && c.state !== 'ready' ? { key: chartKey, state: 'ready' } : c))
  }, [chartKey])
  useEffect(() => {
    if (!sym || chartState !== 'loading') return undefined
    const t = setTimeout(() => setChart(c => (c.key === chartKey && c.state === 'loading' ? { key: chartKey, state: 'error' } : c)), CHART_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [sym, chartKey, chartState])

  const onKeyDown = e => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isEditable(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) onNavKey?.(e)
  }

  if (!row) {
    return <section className={styles.pane} data-testid="focus-chart-pane"><p className={styles.stateBody}>Pick a stock from the list</p></section>
  }
  // B5/N4: the same price and change the row shows (livePrice.js).
  const live = Number.isFinite(livePx) ? { price: livePx, change_pct: liveChg } : null
  const { price, chg } = livePriceOf(row, live)
  const s = setupLine({ ...row, price }, structures)
  const factText = facts(row)
  const earn = earningsText(row.next_earnings_date, now)
  const industry = row.industry || row.sector
  return (
    <section className={styles.pane} data-testid="focus-chart-pane" aria-label={`${row.ticker} chart`} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className={styles.paneHead}>
        <h2 className={styles.paneTicker}>{row.ticker}</h2>
        {(row.company || industry) && (
          <span className={styles.paneSub}>
            {row.company && <span data-testid="pane-company">{row.company}</span>}
            {industry && <span className={styles.paneIndustry} data-testid="pane-industry">{row.company ? ' · ' : ''}{industry}</span>}
          </span>
        )}
        <span className={styles.spacer} />
        <span className={styles.panePrice}>{fmt(price)}</span>
        <span className={chg > 0 ? styles.up : chg < 0 ? styles.down : styles.flat}>{pct(chg)}</span>
      </div>
      <div className={styles.paneMeta}>
        <span className={styles.setupTag} title={s.title || undefined} data-testid="pane-setup">{s.text}</span>
        {s.detail && <span className={styles.setupTag}>{s.detail}</span>}
        {/* The pivot is the head structure's, so when another structure leads it is named. */}
        {s.alsoDetail && <span className={styles.setupTag}>{`${s.also}: ${s.alsoDetail}`}</span>}
        {factText && <span className={styles.paneFacts}>{factText}</span>}
        {factText && earn && <span className={styles.paneFacts} aria-hidden="true">·</span>}
        {earn && (
          <span className={earn.soon ? styles.paneEarnSoon : styles.paneFacts} data-testid="pane-earnings" data-soon={earn.soon ? '' : undefined}>
            {earn.text}
          </span>
        )}
        <span className={styles.spacer} />
        <div role="group" aria-label="Timeframe" className={styles.seg}>
          {['D', 'W'].map(t => (
            <button key={t} type="button" aria-pressed={tf === t} className={tf === t ? styles.segOn : styles.segOff} onClick={() => setTf(t)}>{t}</button>
          ))}
        </div>
      </div>
      <div className={styles.chartBox} data-chart-state={chartState}>
        <PaneChart sym={row.ticker} tf={tf} priceLines={priceLines} settled={settled} onDrawnBarCount={onDrawnBarCount} retry={retry} />
        {chartState === 'loading' && <div className={styles.chartLoading} role="status">Loading chart…</div>}
        {chartState === 'error' && (
          <div className={styles.chartError} role="alert">
            <span>Chart unavailable</span>
            <span aria-hidden="true">·</span>
            <button type="button" className={styles.linkBtn} onClick={() => setRetry(n => n + 1)}>Retry</button>
          </div>
        )}
      </div>
      <div className={styles.paneFoot}>
        <WhyStrip items={why.items} more={why.more} onMore={onOpenFilters} />
        <span className={styles.spacer} />
        <div className={styles.paneActions}>
          <button type="button" className={isFlagged ? styles.btnOn : styles.btn} aria-pressed={!!isFlagged} onClick={() => onFlag(row)}>Flag</button>
          <button type="button" className={styles.btnPrimary} onClick={() => onWatch(row)}>Add to watchlist</button>
        </div>
      </div>
    </section>
  )
}
export default memo(ChartPane)

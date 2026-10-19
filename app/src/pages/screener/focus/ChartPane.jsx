import { memo, useMemo } from 'react'
import WhyStrip from './WhyStrip'
import { setupLine, pivotLine } from './setupLine'
import { plainFact, volumeFact } from './plainWords'
import { livePriceOf } from './livePrice'
import { earningsText } from './dates'
import { useThemeInk } from '../../../lib/theme'
import ScreenerChartWidget from './ScreenerChartWidget'
import styles from './FocusScreener.module.css'

// The chart draws on canvas, where CSS variables do not reach: the pivot line reads --ut-gold through the theme.
const PIVOT_INK = { pivot: ['--ut-gold', '#dcbb5e'] }

const BUSY_TITLE = 'Waiting for the new screen to load'

const fmt = v => (Number.isFinite(v) ? v.toFixed(2) : '—')
const pct = v => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%` : '—')

// Plain words (owner decision 5): the wording lives in plainWords.js, shared with the sort menu.
// Earnings is its own span (P8), so it can turn amber when it is near.
// Volume prefers the live "by now" reading (rvol_live) over the completed-session ratio.
const facts = row => [volumeFact(row), plainFact('adr_pct', row.adr_pct)].filter(Boolean).join(' · ')

// ⭐ THE CHART IS THE /charts CHART WIDGET (2026-10-18), see ScreenerChartWidget.jsx. This pane
// keeps what is the screener's own: the row's identity, setup, facts, earnings, why-strip and
// actions. The chart below them (timeframes, drawings, indicators, tabs, hotkeys, settings,
// loading and error states) is the widget's, so it is the same chart as on /charts; so is the
// News & Catalysts widget under it on desktop.
//
// S5: the chart is memoised on what it draws (a symbol, an identity-stable pivot line, the phone
// flag), so a live price tick re-renders this pane's header and never the chart.
const PaneChart = memo(ScreenerChartWidget)
const isEditable = t => /^(input|textarea|select)$/i.test(t?.tagName || '') || !!t?.isContentEditable

// `livePx` / `liveChg`: the selected stock's live price and change, as primitives (S5), so a tick
// for any other ticker never re-renders the pane. `onNavKey`: ↑/↓ pressed anywhere in the pane
// step the list (B7) — the pane is focusable, so a click on the chart keeps the keys working.
// `busy`: the list answers the previous screen; the row actions say so (and the page ignores them).
function ChartPane({ row, livePx, liveChg, why, now, onOpenFilters, onFlag, isFlagged, onWatch, onNavKey, structures, theme = null, busy = false, phone = false }) {
  const ink = useThemeInk(PIVOT_INK)
  // The head structure's pivot, titled for it ("Flat base pivot"), and hidden once the row's bars
  // are stale (setupLine.pivotLine). Primitives into the memo, so a tick never rebuilds the lines.
  const line = row ? pivotLine(row, structures, now ?? Date.now()) : null
  const linePx = line?.price
  const lineTitle = line?.title
  const priceLines = useMemo(() => (Number.isFinite(linePx)
    ? [{ price: linePx, color: ink.pivot, title: lineTitle }] : []), [linePx, lineTitle, ink.pivot])
  const onKeyDown = e => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isEditable(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) onNavKey?.(e)
  }

  if (!row) {
    return <section className={styles.pane} data-testid="focus-chart-pane"><p className={styles.stateBody}>Pick a stock from the list</p></section>
  }
  // B5/N4: the same price and change the row shows (livePrice.js).
  const live = Number.isFinite(livePx) ? { price: livePx, change_pct: liveChg } : null
  const { price, chg } = livePriceOf(row, live)
  const s = setupLine({ ...row, price }, structures, { now: now ?? Date.now() })
  const factText = facts(row)
  const earn = earningsText(row.next_earnings_date, now)
  const industry = row.industry || row.sector
  return (
    <section className={`${styles.pane} ${busy ? styles.paneBusy : ''}`} data-testid="focus-chart-pane" aria-label={`${row.ticker} chart`} aria-busy={busy || undefined} tabIndex={-1} onKeyDown={onKeyDown}>
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
        {/* The theme the stock trades with (the Watchlist's Theme column, one batched read per list). */}
        {theme && <span className={styles.setupTag} title={`Theme: ${theme}`} data-testid="pane-theme">{theme}</span>}
        {factText && <span className={styles.paneFacts}>{factText}</span>}
        {factText && earn && <span className={styles.paneFacts} aria-hidden="true">·</span>}
        {earn && (
          <span className={earn.soon ? styles.paneEarnSoon : styles.paneFacts} data-testid="pane-earnings" data-soon={earn.soon ? '' : undefined}>
            {earn.text}
          </span>
        )}
      </div>
      <div className={styles.chartBox} data-testid="pane-chart-layer">
        <PaneChart sym={row.ticker} priceLines={priceLines} phone={phone} />
      </div>
      <div className={styles.paneFoot}>
        <WhyStrip items={why.items} more={why.more} onMore={onOpenFilters} />
        <span className={styles.spacer} />
        <div className={styles.paneActions}>
          {/* aria-disabled, never `disabled`: the buttons keep focus and their reason. */}
          <button type="button" className={`${isFlagged ? styles.btnOn : styles.btn} ${busy ? styles.btnBusy : ''}`} aria-pressed={!!isFlagged}
            aria-disabled={busy ? 'true' : undefined} title={busy ? BUSY_TITLE : undefined} onClick={() => onFlag(row)}>Flag</button>
          <button type="button" className={`${styles.btnPrimary} ${busy ? styles.btnBusy : ''}`}
            aria-disabled={busy ? 'true' : undefined} title={busy ? BUSY_TITLE : undefined} onClick={() => onWatch(row)}>Add to watchlist</button>
        </div>
      </div>
    </section>
  )
}
export default memo(ChartPane)

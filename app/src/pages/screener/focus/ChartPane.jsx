import { useMemo, useState } from 'react'
import StockChart from '../../../components/StockChart'
import WhyStrip from './WhyStrip'
import { setupLine } from './setupLine'
import { plainFact } from './plainWords'
import { livePriceOf } from './livePrice'
import { earningsText } from './dates'
import { useThemeInk } from '../../../lib/theme'
import styles from './FocusScreener.module.css'

// The chart draws on canvas, where CSS variables do not reach: the pivot line reads --ut-gold through the theme.
const PIVOT_INK = { pivot: ['--ut-gold', '#dcbb5e'] }

const fmt = v => (Number.isFinite(v) ? v.toFixed(2) : '—')
const pct = v => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%` : '—')

// Plain words (owner decision 5): the wording lives in plainWords.js, shared with the sort menu.
// Earnings is its own span (P8), so it can turn amber when it is near.
const facts = row => ['vol_ratio', 'adr_pct'].map(k => plainFact(k, row[k])).filter(Boolean).join(' · ')

export default function ChartPane({ row, livePrice, why, now, onOpenFilters, onFlag, isFlagged, onWatch, structures }) {
  const [tf, setTf] = useState('D')
  const ink = useThemeInk(PIVOT_INK)
  const pivot = row?.base_pivot_px
  const priceLines = useMemo(() => (Number.isFinite(pivot)
    ? [{ price: pivot, color: ink.pivot, title: 'pivot' }] : []), [pivot, ink.pivot])
  if (!row) {
    return <section className={styles.pane} data-testid="focus-chart-pane"><p className={styles.stateBody}>Pick a stock from the list</p></section>
  }
  // B5/N4: the same price and change the row shows (livePrice.js).
  const { price, chg } = livePriceOf(row, livePrice)
  const s = setupLine({ ...row, price }, structures)
  const factText = facts(row)
  const earn = earningsText(row.next_earnings_date, now)
  const industry = row.industry || row.sector
  return (
    <section className={styles.pane} data-testid="focus-chart-pane" aria-label={`${row.ticker} chart`}>
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
      <div className={styles.chartBox}>
        <StockChart sym={row.ticker} tf={tf}
          showDrawingTools={false} showSavedDrawings
          hideReplay hidePatterns hideCompare hideCountdown disablePatterns
          backgroundWarm={false} liveUpdates hotkeysActive={false}
          boldCandles userCandleColors colorByNetChange candlesOnTop
          markVolumeExtremes hideWatermark hideJournalOverlay
          rightPadBars={4} dailyDefaultBars={126}
          volumeSeparatePane volumePaneHeightPct={9}
          priceScaleTopMargin={0.12} priceScaleBottomMargin={0.10}
          priceLines={priceLines} />
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

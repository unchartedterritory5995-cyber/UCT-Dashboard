import { memo, useMemo } from 'react'
import { Link } from 'react-router-dom'
import StockChart from '../../../../components/StockChart'
import { notePath } from '../../../../hooks/useNoteBacklinks'
import styles from './SetupsBoard.module.css'

/**
 * Wave 13 lane 13J -- one card of the active setups board: a live mini-chart of the symbol
 * with the member's own lines (read-only), the distance to the entry in % and in R, and the
 * days in setup. Every number comes from the server (`setups_board.py`, which reads the
 * levels through `plan_extract`); this file only renders them.
 *
 * ⛔ THE MULTI-CHART GRID'S RECIPE, AND ITS HERD-SAFETY INVARIANTS (CLAUDE.md, Multi-Chart
 * Grid Mode). The chart mounts only when the board's mount queue admits it (`mounted`), and
 * it hands its slot back through `onBarsReady`. It is StockChart in the grid cell's lite
 * profile with `backgroundWarm={false}` (no per-chart all-timeframe warm chain, which does
 * DIRECT fetches) and no deep warm. Streams ride the shared pools (`liveUpdates` default):
 * never a per-card stream. Warming is the board's job, through the prefetch module.
 */

const NEVER = () => false
const LINE_COLORS = { entry: '#dcbb5e', stop: '#f87171', target: '#4ade80' }
const ROLE_LABEL = { entry: 'Entry', stop: 'Stop', target: 'Target' }

export const money = (v) => (typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(2)}` : '—')
const pct = (v) => `${Math.abs(v).toFixed(2)}%`
const r = (v) => `${Math.abs(v).toFixed(2)}R`

/** The member's lines as StockChart price lines. Pure. */
export function planPriceLines(card) {
  return ['entry', 'stop', 'target']
    .filter((role) => typeof card?.[role] === 'number')
    .map((role) => ({ price: card[role], color: LINE_COLORS[role], lineWidth: 1, lineStyle: 2, title: ROLE_LABEL[role] }))
}

/** One sentence for where price stands against the trigger. Pure. */
export function distanceText(card) {
  const { state, distancePct, distanceR } = card || {}
  if (state === 'no_price' || distancePct == null) return 'No price yet'
  const rPart = distanceR == null ? '' : ` · ${r(distanceR)}`
  if (state === 'triggered') return `Triggered · ${pct(distancePct)} through the entry${rPart}`
  if (state === 'invalidated') return `Through the stop · ${pct(distancePct)} from the entry${rPart}`
  return `${pct(distancePct)} to the entry${rPart}`
}

/** Calendar days since the plan's note was created (the server counts them, ET). */
export function daysText(days) {
  if (days === 0) return 'New today'
  return days === 1 ? '1 day in setup' : `${days} days in setup`
}

export const STATE_LABEL = {
  waiting: 'Waiting', watching: 'Watching', triggered: 'Triggered', invalidated: 'Invalidated', no_price: 'No price',
}

function priceSourceText(card) {
  if (card.price == null) return null
  if (card.priceSource === 'live') return `${money(card.price)} live`
  return `${money(card.price)} close${card.priceAsOf ? ` ${card.priceAsOf.slice(5).replace('-', '/')}` : ''}`
}

function BoardCard({ card, mounted, onBarsReady, onFindSimilar }) {
  const priceLines = useMemo(() => planPriceLines(card), [card])
  const days = card.daysInSetup
  return (
    <li className={styles.card} data-board-card={card.symbol} data-state={card.state} data-tour="setups-card">
      <div className={styles.cardHead}>
        <span className={styles.symbol}>{card.symbol}</span>
        <span className={styles.stateChip} data-state={card.state}>{STATE_LABEL[card.state] || card.state}</span>
        {days != null && <span className={styles.days}>{daysText(days)}</span>}
      </div>
      <p className={styles.distance} data-distance="" data-tour="setups-distance">{distanceText(card)}</p>
      <div className={styles.levels}>
        {['entry', 'stop', 'target'].map((role) => (
          <span key={role} className={styles.level} data-role={role}>
            <span className={styles.levelLabel}>{ROLE_LABEL[role]}</span> {money(card[role])}
          </span>
        ))}
        {priceSourceText(card) && <span className={styles.last}>{priceSourceText(card)}</span>}
      </div>
      <div className={styles.chart} data-chart-mounted={mounted ? 'yes' : 'no'}>
        {mounted ? (
          <StockChart
            sym={card.symbol}
            tf="D"
            height="100%"
            priceLines={priceLines}
            showDrawingTools={false}
            showSavedDrawings={false}
            hideReplay
            hidePatterns
            hideCompare
            hideCountdown
            disablePatterns
            backgroundWarm={false}
            deepWarm={false}
            onBarsReady={onBarsReady}
            hotkeysActive={NEVER}
            hideWatermark
            hideJournalOverlay
            carryDragPlacement={false}
            rightPadBars={6}
            dailyDefaultBars={90}
            volumeSeparatePane
            volumePaneHeightPct={12}
            hideExtHoursToolbarToggle
            // Found by the wave-13 integration walk (13X) at 390px: the shared A/L/%
            // scale-toggle (StockChart.jsx's `hideScaleToggle` veto) renders at 11px
            // tall in this card's lite profile, under the --tap-min touch floor. Same
            // host-chrome-veto shape as `TradeBeforeAfter.jsx`'s identical fix -- a
            // read-only mini-chart this small never needs an A/L/% picker.
            hideScaleToggle
          />
        ) : (
          <span className={styles.chartWait}>Chart waiting its turn…</span>
        )}
      </div>
      <div className={styles.cardFoot}>
        <Link className={styles.noteLink} to={notePath(card.noteId)} data-tour="setups-note">
          {card.noteTitle || 'Untitled note'}
        </Link>
        {onFindSimilar && card.similarEmbedKey && (
          <button type="button" className={styles.action}
            aria-label={`Find more like ${card.symbol}`} data-tour="setups-similar"
            onClick={() => onFindSimilar({ noteId: card.noteId, embedKey: card.similarEmbedKey, symbol: card.symbol })}>
            Find more like this
          </button>
        )}
      </div>
    </li>
  )
}

export default memo(BoardCard)

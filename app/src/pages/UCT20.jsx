// app/src/pages/UCT20.jsx
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import TileCard from '../components/TileCard'
import TickerPopup from '../components/TickerPopup'
import UCT20Performance from '../components/tiles/UCT20Performance'
import UCT20Backtest from '../components/tiles/UCT20Backtest'
import styles from './UCT20.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function SetupBadge({ type }) {
  if (!type) return null
  return <span className={styles.setupBadge}>{type}</span>
}

function fmtPct(v) {
  if (v == null) return null
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

function TradeBar({ entry, stop, target1, target2 }) {
  if (!entry && !stop && !target1) return null
  return (
    <div className={styles.tradeBar}>
      {entry   && <div className={styles.tradeItem}><span className={styles.tradeLabel}>ENTRY</span><span className={styles.tradeVal}>{entry}</span></div>}
      {stop    && <div className={styles.tradeItem}><span className={styles.tradeLabel}>STOP</span><span className={`${styles.tradeVal} ${styles.tradeStop}`}>{stop}</span></div>}
      {(target1 || target2) && (
        <div className={styles.tradeItem}>
          <span className={styles.tradeLabel}>TARGET</span>
          <span className={`${styles.tradeVal} ${styles.tradeTarget}`}>
            {[target1, target2].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}
    </div>
  )
}

function StockCard({ item, rank, expanded, onToggle, posData, isNew }) {
  const sym           = item.ticker ?? item.sym ?? item.symbol ?? '—'
  const score         = item.score ?? item.rs_score ?? null
  const company       = item.company ?? ''
  const setupType     = item.setup_type ?? ''
  const hasStructured = !!(item.company_desc || item.catalyst_text || item.price_action)
  const legacyThesis  = item.thesis ?? ''

  const pctStr  = fmtPct(posData?.pct_return ?? null)
  const daysStr = posData?.days_held != null ? `${posData.days_held}d` : null

  // Build chart markers from portfolio data
  const chartMarkers = useMemo(() => {
    const m = []
    if (posData?.entry_date) {
      m.push({
        time: posData.entry_date,
        position: 'belowBar',
        color: '#3cb868',
        shape: 'arrowUp',
        text: 'BUY',
      })
    }
    return m
  }, [posData])

  // Build price lines from portfolio data
  const chartPriceLines = useMemo(() => {
    const lines = []
    if (posData?.entry_price) {
      lines.push({
        price: posData.entry_price,
        color: '#3cb868',
        lineStyle: 2,
        title: `Entry $${posData.entry_price.toFixed(2)}`,
      })
    }
    if (posData?.stop_price) {
      lines.push({
        price: posData.stop_price,
        color: '#e74c3c',
        lineStyle: 2,
        title: `Stop $${posData.stop_price.toFixed(2)}`,
      })
    }
    return lines
  }, [posData])

  return (
    <div className={styles.card}>
      {/* Collapsed row — always visible */}
      <div className={styles.cardRow} onClick={onToggle}>
        <span className={styles.rank}>#{rank}</span>
        <SetupBadge type={setupType} />
        <TickerPopup sym={sym} markers={chartMarkers} priceLines={chartPriceLines}>
          <span className={styles.sym}>{sym}</span>
        </TickerPopup>
        {company && <span className={styles.companyName}>{company}</span>}
        <div className={styles.cardRowRight}>
          <span className={styles.newSlot}>{isNew && <span className={styles.newBadge}>NEW</span>}</span>
          <span className={styles.daysOnList}>{daysStr ?? ''}</span>
          <span className={`${styles.posReturn} ${(posData?.pct_return ?? 0) >= 0 ? styles.gain : styles.loss}`}>
            {pctStr ?? ''}
          </span>
          <span className={styles.score}>
            {score != null ? (
              <>
                <span className={styles.mobileLabel}></span>
                {score.toFixed ? score.toFixed(1) : score}
              </>
            ) : ''}
          </span>
          <span className={styles.caret}>{expanded ? '▾' : '▸'}</span>
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className={styles.expanded}>
          {hasStructured ? (
            <>
              {item.company_desc && (
                <p className={styles.companyDesc}>{item.company_desc}</p>
              )}
              {item.catalyst_text && (
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>CATALYST</span>
                  <p className={styles.sectionText}>{item.catalyst_text}</p>
                </div>
              )}
              {item.price_action && (
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>PRICE ACTION</span>
                  <p className={styles.sectionText}>{item.price_action}</p>
                </div>
              )}
              <TradeBar
                entry={item.entry}
                stop={item.stop}
                target1={item.target_1}
                target2={item.target_2}
              />
            </>
          ) : legacyThesis ? (
            <p className={styles.legacyThesis}>{legacyThesis}</p>
          ) : null}
        </div>
      )}
    </div>
  )
}

export default function UCT20() {
  const { data: rows }    = useSWR('/api/leadership',      fetcher, { refreshInterval: 3600000 })
  const { data: portData } = useSWR('/api/uct20/portfolio', fetcher, { refreshInterval: 3600000 })
  const [expandedIdx, setExpandedIdx] = useState(null)

  const stocks = Array.isArray(rows) ? rows.slice(0, 20) : []

  // Build symbol → position data map from portfolio open positions
  const posMap = useMemo(() => {
    const map = {}
    for (const pos of portData?.open_positions ?? []) {
      map[pos.symbol] = pos
    }
    return map
  }, [portData])

  // Most recent entry date = "new" threshold
  const latestEntry = useMemo(() => {
    const dates = Object.values(posMap).map(p => p.entry_date).filter(Boolean)
    return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null
  }, [posMap])

  function toggle(i) {
    setExpandedIdx(prev => prev === i ? null : i)
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>UCT 20</h1>
      </div>
      <TileCard
        title="UCT Leadership 20 — Current Top Stocks"
        actions={
          <div className={styles.colHeaders}>
            <span className={styles.newSlot} />
            <span className={styles.colDay}>DAYS SINCE ADDED</span>
            <span className={styles.colSince}>CHANGE SINCE ADDED</span>
            <span className={styles.colRating}>RATING</span>
            <span className={styles.caretSpacer} />
          </div>
        }
      >
        {!rows ? (
          <p className={styles.loading}>Loading…</p>
        ) : stocks.length === 0 ? (
          <p className={styles.loading}>No leadership data yet. Run the Morning Wire engine to populate.</p>
        ) : (
          <div className={styles.list}>
            {stocks.map((item, i) => {
              const sym = item.ticker ?? item.sym ?? item.symbol
              const posData = posMap[sym] ?? null
              const isNew = posData?.entry_date != null && posData.entry_date === latestEntry
              return (
                <StockCard
                  key={sym ?? i}
                  item={item}
                  rank={i + 1}
                  expanded={expandedIdx === i}
                  onToggle={() => toggle(i)}
                  posData={posData}
                  isNew={isNew}
                />
              )
            })}
          </div>
        )}
        <UCT20Performance />
        <UCT20Backtest />
      </TileCard>
    </div>
  )
}

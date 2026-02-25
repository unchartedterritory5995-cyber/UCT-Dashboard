// app/src/pages/UCT20.jsx
import { useState } from 'react'
import useSWR from 'swr'
import TileCard from '../components/TileCard'
import TickerPopup from '../components/TickerPopup'
import styles from './UCT20.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function SetupBadge({ type }) {
  if (!type) return null
  return <span className={styles.setupBadge}>{type}</span>
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

function StockCard({ item, rank, expanded, onToggle }) {
  const sym           = item.ticker ?? item.sym ?? item.symbol ?? '—'
  const score         = item.score ?? item.rs_score ?? null
  const company       = item.company ?? ''
  const setupType     = item.setup_type ?? ''
  const hasStructured = !!(item.company_desc || item.catalyst_text || item.price_action)
  const legacyThesis  = item.thesis ?? ''

  return (
    <div className={styles.card}>
      {/* Collapsed row — always visible */}
      <div className={styles.cardRow} onClick={onToggle}>
        <span className={styles.rank}>#{rank}</span>
        <SetupBadge type={setupType} />
        <TickerPopup sym={sym}>
          <span className={styles.sym}>{sym}</span>
        </TickerPopup>
        {company && <span className={styles.companyName}>{company}</span>}
        <div className={styles.cardRowRight}>
          {score != null && (
            <span className={styles.score}>UCT Rating {score.toFixed ? score.toFixed(1) : score}</span>
          )}
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
  const { data: rows, mutate } = useSWR('/api/leadership', fetcher, { refreshInterval: 3600000 })
  const [expandedIdx, setExpandedIdx] = useState(null)

  const stocks = Array.isArray(rows) ? rows.slice(0, 20) : []

  function toggle(i) {
    setExpandedIdx(prev => prev === i ? null : i)
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>UCT 20</h1>
        <button className={styles.refreshBtn} onClick={() => mutate()}>Refresh</button>
      </div>
      <TileCard title="Leadership 20 — Current Top Setups">
        {!rows ? (
          <p className={styles.loading}>Loading…</p>
        ) : stocks.length === 0 ? (
          <p className={styles.loading}>No leadership data yet. Run the Morning Wire engine to populate.</p>
        ) : (
          <div className={styles.list}>
            {stocks.map((item, i) => (
              <StockCard
                key={item.ticker ?? item.sym ?? i}
                item={item}
                rank={i + 1}
                expanded={expandedIdx === i}
                onToggle={() => toggle(i)}
              />
            ))}
          </div>
        )}
      </TileCard>
    </div>
  )
}

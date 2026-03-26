import { useState, useCallback } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import PullToRefresh from '../components/PullToRefresh'
import TileCard from '../components/TileCard'
import TickerPopup from '../components/TickerPopup'
import { useTileCapture } from '../hooks/useTileCapture'
import { SkeletonTileContent } from '../components/Skeleton'
import styles from './MorningWire.module.css'

const fetcher = url => fetch(url).then(r => r.json())

// Small stat pill used in the page header strip
function StatPill({ label, value, color }) {
  return (
    <div className={`${styles.statPill} ${styles[`pill_${color}`]}`}>
      <span className={styles.pillLabel}>{label}</span>
      <span className={styles.pillValue}>{value}</span>
    </div>
  )
}

// Verdict badge for earnings rows
function VerdictBadge({ verdict }) {
  if (!verdict) return null
  const isbeat = verdict.toUpperCase() === 'BEAT'
  return (
    <span className={isbeat ? styles.beat : styles.miss}>
      {verdict.toUpperCase()}
    </span>
  )
}

// One earnings row inside "By the Numbers"
function EarningsRow({ row }) {
  const sym = row.sym || row.ticker || row.symbol
  const surprise = row.surprise_pct
  const isPos = typeof surprise === 'number' ? surprise > 0
    : typeof surprise === 'string' ? surprise.startsWith('+') : false

  return (
    <div className={styles.earningsRow}>
      <TickerPopup sym={sym} className={styles.earningsTicker} />
      <VerdictBadge verdict={row.verdict} />
      <span className={`${styles.surprise} ${isPos ? styles.gainText : styles.lossText}`}>
        {surprise != null
          ? (typeof surprise === 'number'
              ? `${surprise > 0 ? '+' : ''}${surprise.toFixed(1)}%`
              : surprise)
          : '—'}
      </span>
    </div>
  )
}

// ── Analyst Activity ──────────────────────────────────────────────────────────

const ANALYST_TABS = [
  { key: 'upgrades',   label: 'Upgrades'   },
  { key: 'downgrades', label: 'Downgrades' },
  { key: 'pt_changes', label: 'PT Changes' },
]

function _badgeClass(action) {
  const a = (action || '').toLowerCase()
  if (a === 'upgrade' || a === 'upgraded')    return styles.aeBadgeUp
  if (a === 'downgrade' || a === 'downgraded') return styles.aeBadgeDown
  if (a === 'initiates' || a === 'initiated') return styles.aeBadgeInit
  if (a === 'raises pt')                      return styles.aeBadgePtUp
  if (a === 'lowers pt')                      return styles.aeBadgePtDn
  return styles.aeBadgeMuted
}

function _borderClass(action) {
  const a = (action || '').toLowerCase()
  if (a === 'upgrade' || a === 'upgraded' || a === 'initiates' || a === 'initiated') return styles.aeUp
  if (a === 'downgrade' || a === 'downgraded') return styles.aeDown
  if (a === 'raises pt') return styles.aePtUp
  if (a === 'lowers pt') return styles.aePtDn
  return ''
}

function AnalystEntry({ item }) {
  const { ticker, action, firm, from_rating, to_rating, price_target, implied_upside } = item
  const hasChange = from_rating && to_rating && from_rating !== to_rating
  const isPos = implied_upside ? implied_upside.startsWith('+') : null

  return (
    <div className={`${styles.aeEntry} ${_borderClass(action)}`}>
      <TickerPopup sym={ticker} className={styles.aeTicker} />
      <span className={`${styles.aeBadge} ${_badgeClass(action)}`}>{action}</span>
      <span className={styles.aeMid}>
        {firm && <span className={styles.aeFirm}>{firm}</span>}
        {hasChange
          ? <span className={styles.aeRating}>
              <span className={styles.aeRatingFrom}>{from_rating}</span>
              <span className={styles.aeRatingArrow}> → </span>
              <span className={styles.aeRatingTo}>{to_rating}</span>
            </span>
          : to_rating
            ? <span className={`${styles.aeRating} ${styles.aeRatingTo}`}>{to_rating}</span>
            : null
        }
      </span>
      <span className={styles.aePt}>
        {price_target ? (price_target.startsWith('$') ? price_target : `$${price_target}`) : ''}
      </span>
      {implied_upside
        ? <span className={`${styles.aeUpside} ${isPos ? styles.aeUpsidePos : styles.aeUpsideNeg}`}>
            {implied_upside}
          </span>
        : <span className={styles.aeUpside} />
      }
    </div>
  )
}

function AnalystActivity({ analysts }) {
  const [tab, setTab] = useState('upgrades')
  const summary = analysts?.summary || {}
  const entries = analysts?.[tab] || []

  return (
    <div className={styles.analystBlock}>
      <div className={styles.analystHeader}>
        <div className={styles.analystTitleRow}>
          <span className={styles.analystTitle}>Analyst Activity</span>
          {summary.upgrades != null && (
            <span className={styles.analystSummary}>
              <span className={styles.aSumUp}>↑ {summary.upgrades}</span>
              <span className={styles.aSumDot}> · </span>
              <span className={styles.aSumDown}>↓ {summary.downgrades}</span>
              <span className={styles.aSumDot}> · </span>
              <span className={styles.aSumPt}>{summary.pt_changes} PT</span>
            </span>
          )}
        </div>
        <div className={styles.analystTabs}>
          {ANALYST_TABS.map(t => (
            <button
              key={t.key}
              className={`${styles.analystTab} ${tab === t.key ? styles.analystTabActive : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {summary[t.key] != null && summary[t.key] > 0 &&
                <span className={styles.analystTabCount}>{summary[t.key]}</span>
              }
            </button>
          ))}
        </div>
      </div>
      <div className={styles.analystBody}>
        {entries.length > 0
          ? <>
              <div className={styles.aeHeaderRow}>
                <span>Ticker</span>
                <span>Action</span>
                <span>Firm · Rating</span>
                <span style={{textAlign:'right'}}>Price Target</span>
                <span style={{textAlign:'right'}}>vs Current</span>
              </div>
              {entries.map((a, i) => <AnalystEntry key={i} item={a} />)}
            </>
          : <span className={styles.noData}>
              {analysts ? `No ${tab.replace('_', ' ')} today` : <SkeletonTileContent lines={3} />}
            </span>
        }
      </div>
    </div>
  )
}

export default function MorningWire() {
  const { mutate } = useSWRConfig()
  const { data: rundown }  = useSWR('/api/rundown',         fetcher, { refreshInterval: 300000 })
  const { data: analysts } = useSWR('/api/analyst-actions', fetcher, { refreshInterval: 300000 })
  const { tileRef, capturing, capture } = useTileCapture('morning-wire')

  const handleRefresh = useCallback(() => Promise.all([
    mutate('/api/rundown'),
    mutate('/api/analyst-actions'),
  ]), [mutate])

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className={styles.page}>

      {/* ── Page header ─────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.titleRow}>
          <span className={styles.wireName}>The Morning Wire</span>
          {rundown?.date && <span className={styles.wireDate}>{rundown.date}</span>}
          <button
            className={styles.captureBtn}
            onClick={capture}
            disabled={capturing || !rundown?.html}
            title="Export as PNG"
          >
            {capturing ? '…' : '📷'}
          </button>
        </div>
      </div>

      {/* ── The Rundown ──────────────────────────────────────────── */}
      <TileCard ref={tileRef}>
        {rundown?.html
          ? (
            <div
              className={styles.rundownWrap}
              dangerouslySetInnerHTML={{ __html: rundown.html }}
            />
          )
          : <p className={styles.loading}>Loading rundown…</p>
        }
      </TileCard>

      {/* ── Analyst Activity ─────────────────────────────────────── */}
      <AnalystActivity analysts={analysts} />

    </div>
    </PullToRefresh>
  )
}

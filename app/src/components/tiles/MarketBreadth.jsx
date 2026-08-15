// app/src/components/tiles/MarketBreadth.jsx
import useMobileSWR from '../../hooks/useMobileSWR'
import TileCard from '../TileCard'
import MARelationship from './MARelationship'
import { SkeletonTileContent } from '../Skeleton'
import UIcon from '../ui/UIcon'
import { useLiveBreadth } from '../../hooks/useLiveBreadth'
import DayPath from '../breadth/DayPath'
import styles from './MarketBreadth.module.css'

const fetcher = url => fetch(url).then(r => r.json())

// ─── Score color ────────────────────────────────────────────────────────────
function scoreColor(s) {
  if (s == null) return 'var(--text-muted)'
  if (s >= 81)  return 'var(--gain)'
  if (s >= 66)  return '#7dcea0'
  if (s >= 50)  return 'var(--warn)'
  if (s >= 31)  return '#e67e22'
  return 'var(--loss)'
}

// ─── Horizontal Exposure Bar ─────────────────────────────────────────────────
function ExposureBar({ value, label = 'UCT EXPOSURE RATING', delta = null, bonus = false }) {
  const isLeveraged = value != null && value > 100
  const barPct = value == null ? null : Math.min(100, Math.max(0, value))
  const color  = scoreColor(Math.min(value ?? 0, 100))

  return (
    <div className={styles.expWrap}>
      <div className={styles.expScoreRow}>
        <span className={styles.expScore} style={{ color: value == null ? 'var(--text-muted)' : color }}>
          {value == null ? '—' : Math.round(value)}
          {(bonus || isLeveraged) && value != null && <span className={styles.expBonus}><UIcon name="star-fill" size={12} /></span>}
        </span>
        {delta != null && (
          <span className={styles.expDelta} style={{ color: delta >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
            {delta >= 0 ? `↑${delta}` : `↓${Math.abs(delta)}`}
          </span>
        )}
      </div>
      <div className={styles.expLabel}>
        {isLeveraged ? 'UCT EXPOSURE — LEVERAGED' : label}
      </div>
      <div className={styles.expTrack} style={isLeveraged ? { boxShadow: '0 0 8px 2px gold' } : undefined}>
        {barPct != null && barPct > 0 && (
          <>
            <div className={styles.expGlow} style={{ width: `${barPct}%`, background: color }} />
            <div className={styles.expFill} style={{ width: `${barPct}%`, background: isLeveraged ? 'gold' : color }} />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function MarketBreadth({ data: propData }) {
  const { data: fetched } = useMobileSWR(propData !== undefined ? null : '/api/breadth', fetcher, { refreshInterval: 60000, marketHoursOnly: true })
  const data = propData !== undefined ? propData : fetched
  // The exposure rating this tile leads with is pushed by the morning wire and
  // is NOT derivable intraday — so nothing above becomes live. What IS live is
  // participation, and % above the 50-day is the reading that answers "is the
  // market still working right now". It reconciles to within a point, the
  // tightest grade the gate measures, which is why it is the one shown here.
  const live = useLiveBreadth()

  if (!data) {
    return <TileCard icon="breadth" title="UCT Exposure Rating"><SkeletonTileContent lines={3} /></TileCard>
  }

  const phase = data.webster_phase ?? data.market_phase ?? ''
  const maData = data.ma_data ?? null

  const expScore  = data.exposure?.score       ?? null
  const expDelta  = data.exposure?.score_delta ?? null
  const expNote   = data.exposure?.note        ?? ''
  const expGate   = data.exposure?.gate_active ?? false
  const expReason = data.exposure?.gate_reason ?? null
  const expBonus  = data.exposure?.bonus       ?? 0

  // 'unknown' is NOT rendered as stale — an absent date means we cannot tell,
  // and asserting staleness we can't support is the same error as asserting the
  // freshness we couldn't support before.
  const wireDate  = data.wire_date ?? null
  const wireStale = data.wire_status === 'stale'

  return (
    <TileCard icon="breadth" title="UCT Exposure Rating">
      <ExposureBar
        value={expScore}
        label="UCT EXPOSURE RATING"
        delta={expDelta}
        bonus={expBonus > 0}
      />

      {phase && (
        <div className={styles.phaseRow}>
          <span className={styles.phaseDot} />
          <span className={styles.phaseLabel}>{phase}</span>
        </div>
      )}

      {/* 🔴 THE STAMP THAT WAS MISSING. On 2026-08-14 the 06:35 wire crashed
          before pushing, the dashboard served the prior day's rating all day,
          and nothing on this tile — or in the payload behind it — could say so:
          a stale 55 was pixel-identical to a fresh 55, and the delta arrow
          showed yesterday's move as today's. `wire_status` is judged server-side
          against the trading calendar (the same rule /api/leadership uses) and
          re-judged on every read, so it can never itself go stale. */}
      {wireDate && (
        <p className={`${styles.wireStamp} ${wireStale ? styles.wireStampStale : ''}`}>
          {wireStale && <UIcon name="warning" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />}
          Wire {wireDate}{wireStale ? ' — no run since; this is not today\'s reading' : ''}
        </p>
      )}

      {expNote && <p className={styles.scoreNote}>{expNote}</p>}
      {expGate && expReason && <p className={styles.gateNote}><UIcon name="warning" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />{expReason}</p>}

      {live.row?.pct_above_50sma != null && (
        <div className={styles.liveRow} title={
          `Provisional — computed ${live.clock} ET across ${live.measured ?? '—'} names. `
          + `The 4:15 PM collector writes the day's authoritative reading.`
        }>
          <span className={styles.livePulse} aria-hidden="true" />
          <span className={styles.liveLabel}>ABOVE 50-DAY NOW</span>
          <strong className={styles.liveValue}>{live.row.pct_above_50sma.toFixed(1)}%</strong>
          <DayPath points={live.path?.pct_above_50sma} label="% above 50-day" />
          <span className={styles.liveStamp}>{live.clock} ET</span>
        </div>
      )}

      <MARelationship maData={maData} />
    </TileCard>
  )
}

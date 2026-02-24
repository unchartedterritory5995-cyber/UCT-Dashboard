// app/src/components/tiles/MarketBreadth.jsx
import { useState } from 'react'
import useSWR from 'swr'
import TileCard from '../TileCard'
import NHNLModal from './NHNLModal'
import MARelationship from './MARelationship'
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

// ─── Gauge ──────────────────────────────────────────────────────────────────
const R = 72, CX = 100, CY = 90
const ARC_LEN = Math.PI * R  // half-circle arc length

function describeArc(pct) {
  const angle = Math.PI * (1 - pct / 100)
  const x = CX + R * Math.cos(angle)
  const y = CY - R * Math.sin(angle)
  const large = pct > 50 ? 1 : 0
  return `M ${CX - R},${CY} A ${R},${R} 0 ${large},1 ${x.toFixed(2)},${y.toFixed(2)}`
}

const TICKS = [0, 25, 50, 75, 100]

function Gauge({ value, label = 'UCT EXPOSURE RATING', delta = null, bonus = false }) {
  const pct   = value == null ? null : Math.min(100, Math.max(0, value))
  const color = scoreColor(value)

  return (
    <div className={styles.gaugeWrap}>
      <svg viewBox="0 0 200 115" className={styles.gaugeSvg} aria-hidden="true">
        <defs>
          <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="var(--loss)" stopOpacity="0.9" />
            <stop offset="50%"  stopColor="var(--warn)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--gain)" stopOpacity="0.9" />
          </linearGradient>
          <clipPath id="gauge-clip">
            {pct != null && pct > 0 && (
              <path d={describeArc(pct)} strokeWidth="14" stroke="white" fill="none"
                strokeLinecap="round" />
            )}
          </clipPath>
        </defs>

        {/* Track */}
        <path
          d={`M ${CX - R},${CY} A ${R},${R} 0 0,1 ${CX + R},${CY}`}
          fill="none" stroke="var(--border)" strokeWidth="10" strokeLinecap="round"
        />

        {/* Gradient fill */}
        {pct != null && pct > 0 && (
          <>
            {/* Glow layer */}
            <path
              d={describeArc(pct)}
              fill="none" stroke={color} strokeWidth="14"
              strokeLinecap="round" opacity="0.15"
              style={{ filter: 'blur(4px)' }}
            />
            {/* Solid fill */}
            <path
              d={describeArc(pct)}
              fill="none" stroke={color} strokeWidth="10"
              strokeLinecap="round" opacity="0.9"
            />
          </>
        )}

        {/* Tick marks */}
        {TICKS.map(t => {
          const a = Math.PI * (1 - t / 100)
          const inner = R - 7, outer = R + 2
          const x1 = CX + inner * Math.cos(a), y1 = CY - inner * Math.sin(a)
          const x2 = CX + outer * Math.cos(a), y2 = CY - outer * Math.sin(a)
          return <line key={t} x1={x1.toFixed(1)} y1={y1.toFixed(1)}
                       x2={x2.toFixed(1)} y2={y2.toFixed(1)}
                       stroke="var(--border)" strokeWidth="1.5" />
        })}

        {/* Score number */}
        <text x={CX} y={CY - 8} textAnchor="middle" fontSize="26" fontWeight="800"
              fill={pct == null ? 'var(--text-muted)' : color}
              fontFamily="'IBM Plex Mono', monospace">
          {pct == null ? '—' : Math.round(pct)}
          {bonus && pct != null && (
            <tspan fontSize="12" dy="-8" fill="gold">★</tspan>
          )}
        </text>

        {/* Label */}
        <text x={CX} y={CY + 8} textAnchor="middle" fontSize="7"
              fill="var(--text-muted)" letterSpacing="2" fontFamily="'IBM Plex Mono', monospace">
          {label}
        </text>

        {/* Delta */}
        {delta != null && (
          <text x={CX} y={CY + 22} textAnchor="middle" fontSize="8" fontWeight="700"
                fill={delta >= 0 ? 'var(--gain)' : 'var(--loss)'}
                fontFamily="'IBM Plex Mono', monospace">
            {delta >= 0 ? `↑${delta}` : `↓${Math.abs(delta)}`}
          </text>
        )}
      </svg>
    </div>
  )
}

// ─── Progress bar ────────────────────────────────────────────────────────────
function ProgressBar({ value, color }) {
  const pct = value == null ? 0 : Math.min(100, Math.max(0, value))
  return (
    <div className={styles.barTrack}>
      <div className={styles.barFill} style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function MarketBreadth({ data: propData }) {
  const { data: fetched } = useSWR(propData !== undefined ? null : '/api/breadth', fetcher)
  const data = propData !== undefined ? propData : fetched
  const [nhnlModal, setNhnlModal] = useState(null) // 'highs' | 'lows' | null

  if (!data) {
    return <TileCard title="Market Breadth"><p className={styles.loading}>Loading…</p></TileCard>
  }

  const p5        = data.pct_above_5ma   ?? null
  const p50       = data.pct_above_50ma  ?? null
  const p200      = data.pct_above_200ma ?? null
  const distDays  = data.distribution_days ?? 0
  const phase     = data.market_phase ?? ''
  const advancing = data.advancing ?? null
  const declining = data.declining ?? null
  const newHighs     = data.new_highs      ?? null
  const newLows      = data.new_lows       ?? null
  const newHighsList = data.new_highs_list ?? []
  const newLowsList  = data.new_lows_list  ?? []

  // MA relationship data
  const maData = data.ma_data ?? null

  // Exposure rating
  const expScore  = data.exposure?.score       ?? null
  const expDelta  = data.exposure?.score_delta ?? null
  const expNote   = data.exposure?.note        ?? ''
  const expGate   = data.exposure?.gate_active ?? false
  const expReason = data.exposure?.gate_reason ?? null
  const expBonus  = data.exposure?.bonus       ?? 0

  const distColor = distDays >= 5 ? 'var(--loss)' : distDays >= 3 ? 'var(--warn)' : 'var(--gain)'

  const fmtPct = v => v == null ? '—' : `${v.toFixed(1)}%`
  const fmtNum = v => v == null ? '—' : v.toLocaleString()

  return (
  <>
    <TileCard title="Market Breadth">
      <Gauge
        value={expScore != null ? Math.min(expScore, 100) : null}
        label="UCT EXPOSURE RATING"
        delta={expDelta}
        bonus={expBonus > 0}
      />

      {/* Market phase */}
      {phase && (
        <div className={styles.phaseRow}>
          <span className={styles.phaseDot} />
          <span className={styles.phaseLabel}>{phase}</span>
        </div>
      )}

      {/* Exposure note + gate warning */}
      {expNote && <p className={styles.scoreNote}>{expNote}</p>}
      {expGate && expReason && <p className={styles.gateNote}>⚠ {expReason}</p>}

      {/* 5MA + 50MA + 200MA progress bars */}
      <div className={styles.maSection}>
        <div className={styles.maRow}>
          <span className={styles.maLabel}>% Above 5MA</span>
          <span className={styles.maVal} style={{ color: 'var(--warn)' }}>{fmtPct(p5)}</span>
        </div>
        <ProgressBar value={p5} color="var(--warn)" />

        <div className={styles.maRow} style={{ marginTop: 8 }}>
          <span className={styles.maLabel}>% Above 50MA</span>
          <span className={styles.maVal} style={{ color: 'var(--gain)' }}>{fmtPct(p50)}</span>
        </div>
        <ProgressBar value={p50} color="var(--gain)" />

        <div className={styles.maRow} style={{ marginTop: 8 }}>
          <span className={styles.maLabel}>% Above 200MA</span>
          <span className={styles.maVal} style={{ color: 'var(--info)' }}>{fmtPct(p200)}</span>
        </div>
        <ProgressBar value={p200} color="var(--info)" />
      </div>

      {/* Dist Days · A/D · NH/NL */}
      <div className={styles.statRow}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Dist. Days</span>
          <span className={styles.statVal} style={{ color: distColor }}>{distDays}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Adv</span>
          <span className={styles.statVal} style={{ color: 'var(--gain)' }}>{fmtNum(advancing)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Dec</span>
          <span className={styles.statVal} style={{ color: 'var(--loss)' }}>{fmtNum(declining)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>NH</span>
          <button className={styles.statBtn} style={{ color: 'var(--gain)' }}
            onClick={() => setNhnlModal('highs')} disabled={!newHighsList.length}>
            {fmtNum(newHighs)}
          </button>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>NL</span>
          <button className={styles.statBtn} style={{ color: 'var(--loss)' }}
            onClick={() => setNhnlModal('lows')} disabled={!newLowsList.length}>
            {fmtNum(newLows)}
          </button>
        </div>
      </div>

      <MARelationship maData={maData} />
    </TileCard>

    {nhnlModal && (
      <NHNLModal
        type={nhnlModal}
        tickers={nhnlModal === 'highs' ? newHighsList : newLowsList}
        onClose={() => setNhnlModal(null)}
      />
    )}
  </>
  )
}

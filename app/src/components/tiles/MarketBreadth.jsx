// app/src/components/tiles/MarketBreadth.jsx
import useSWR from 'swr'
import TileCard from '../TileCard'
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

// ─── Horizontal Exposure Bar ─────────────────────────────────────────────────
function ExposureBar({ value, label = 'UCT EXPOSURE RATING', delta = null, bonus = false }) {
  const pct   = value == null ? null : Math.min(100, Math.max(0, value))
  const color = scoreColor(value)

  return (
    <div className={styles.expWrap}>
      <div className={styles.expScoreRow}>
        <span className={styles.expScore} style={{ color: pct == null ? 'var(--text-muted)' : color }}>
          {pct == null ? '—' : Math.round(pct)}
          {bonus && pct != null && <span className={styles.expBonus}>★</span>}
        </span>
        {delta != null && (
          <span className={styles.expDelta} style={{ color: delta >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
            {delta >= 0 ? `↑${delta}` : `↓${Math.abs(delta)}`}
          </span>
        )}
      </div>
      <div className={styles.expLabel}>{label}</div>
      <div className={styles.expTrack}>
        {pct != null && pct > 0 && (
          <>
            <div className={styles.expGlow} style={{ width: `${pct}%`, background: color }} />
            <div className={styles.expFill} style={{ width: `${pct}%`, background: color }} />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function MarketBreadth({ data: propData }) {
  const { data: fetched } = useSWR(propData !== undefined ? null : '/api/breadth', fetcher)
  const data = propData !== undefined ? propData : fetched

  if (!data) {
    return <TileCard title="UCT Exposure Rating"><p className={styles.loading}>Loading…</p></TileCard>
  }

  const phase = data.market_phase ?? ''
  const maData = data.ma_data ?? null

  const expScore  = data.exposure?.score       ?? null
  const expDelta  = data.exposure?.score_delta ?? null
  const expNote   = data.exposure?.note        ?? ''
  const expGate   = data.exposure?.gate_active ?? false
  const expReason = data.exposure?.gate_reason ?? null
  const expBonus  = data.exposure?.bonus       ?? 0

  return (
    <TileCard title="UCT Exposure Rating">
      <ExposureBar
        value={expScore != null ? Math.min(expScore, 100) : null}
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

      {expNote && <p className={styles.scoreNote}>{expNote}</p>}
      {expGate && expReason && <p className={styles.gateNote}>⚠ {expReason}</p>}

      <MARelationship maData={maData} />
    </TileCard>
  )
}

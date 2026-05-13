/**
 * RegimeTile — live market regime classification on the Dashboard.
 *
 * Shows the current regime label + confidence + top reasons, color-
 * coded by regime. Polls /api/regime every 30s (server-cached for 15min).
 */
import useSWR from 'swr'
import TileCard from '../TileCard'
import styles from './RegimeTile.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))


const REGIME_COLORS = {
  bull_trend:      { bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.5)',  text: '#22c55e' },
  bull_correction: { bg: 'rgba(132,204,22,0.10)', border: 'rgba(132,204,22,0.5)', text: '#84cc16' },
  chop:            { bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.5)', text: '#fbbf24' },
  distribution:    { bg: 'rgba(251,146,60,0.10)', border: 'rgba(251,146,60,0.5)', text: '#fb923c' },
  bear_trend:      { bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.5)',  text: '#ef4444' },
  unknown:         { bg: 'rgba(128,128,128,0.06)', border: 'var(--border)',        text: 'var(--text-muted)' },
}


export default function RegimeTile() {
  const { data, isLoading } = useSWR('/api/regime', fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })

  return (
    <TileCard title="🌐 Regime">
      <RegimeBody data={data} isLoading={isLoading} />
    </TileCard>
  )
}


function RegimeBody({ data, isLoading }) {
  if (isLoading) {
    return <div className={styles.placeholder}>Classifying…</div>
  }
  if (!data || !data.regime) {
    return <div className={styles.placeholder}>Regime data unavailable.</div>
  }
  const colors = REGIME_COLORS[data.regime] || REGIME_COLORS.unknown
  const conf = data.confidence ?? 0
  const confLabel = conf >= 0.5 ? 'high' : conf >= 0.3 ? 'moderate' : 'low'
  const reasons = Array.isArray(data.reasons) ? data.reasons.slice(0, 3) : []

  return (
    <div className={styles.body}>
      <div
        className={styles.labelRow}
        style={{
          background: colors.bg,
          borderLeft: `4px solid ${colors.border}`,
        }}
      >
        <div className={styles.label} style={{ color: colors.text }}>
          {data.label || data.regime}
        </div>
        <div className={styles.confidence}>
          {confLabel} confidence
          {' · '}
          {(conf * 100).toFixed(0)}%
        </div>
      </div>

      {reasons.length > 0 && (
        <ul className={styles.reasons}>
          {reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}

      {data.signals && (
        <div className={styles.signals}>
          {data.signals.breadth_score != null && (
            <Signal label="Breadth" value={data.signals.breadth_score?.toFixed?.(0) ?? '—'} />
          )}
          {data.signals.exposure_score != null && (
            <Signal label="Exposure" value={data.signals.exposure_score?.toFixed?.(0) ?? '—'} />
          )}
          {data.signals.vix != null && (
            <Signal label="VIX" value={data.signals.vix?.toFixed?.(1) ?? '—'} />
          )}
          {data.signals.pct_above_50sma != null && (
            <Signal label=">50MA" value={`${data.signals.pct_above_50sma?.toFixed?.(0)}%`} />
          )}
        </div>
      )}
    </div>
  )
}


function Signal({ label, value }) {
  return (
    <div className={styles.signal}>
      <div className={styles.signalLabel}>{label}</div>
      <div className={styles.signalValue}>{value}</div>
    </div>
  )
}

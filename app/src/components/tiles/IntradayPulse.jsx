// app/src/components/tiles/IntradayPulse.jsx
import useSWR from 'swr'
import styles from './IntradayPulse.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const MODE_LABELS = {
  open: '9:45 AM',
  midday: '12:00 PM',
  preclose: '2:30 PM',
}

function phaseBg(phase) {
  const p = (phase || '').toLowerCase()
  if (p.includes('markup') || p.includes('accumulation')) return styles.phaseGreen
  if (p.includes('distribution') || p.includes('decline')) return styles.phaseRed
  return styles.phaseAmber
}

export default function IntradayPulse() {
  const { data } = useSWR('/api/intraday-update', fetcher, { refreshInterval: 120000 })

  if (!data || !data.mode) return null

  const regime = data.regime || {}
  const mode = data.mode
  const timeLabel = MODE_LABELS[mode] || mode
  const notes = data.session_notes || ''

  return (
    <div className={styles.bar}>
      <span className={styles.badge}>{mode.toUpperCase()}</span>
      <span className={styles.time}>{timeLabel} ET</span>
      <span className={styles.sep}>|</span>
      <span className={`${styles.phase} ${phaseBg(regime.phase)}`}>{regime.phase || '—'}</span>
      {regime.exposure_pct != null && (
        <>
          <span className={styles.sep}>|</span>
          <span className={styles.label}>Exposure</span>
          <span className={styles.val}>{regime.exposure_pct}%</span>
        </>
      )}
      {regime.distribution_days != null && (
        <>
          <span className={styles.sep}>|</span>
          <span className={styles.label}>Dist Days</span>
          <span className={styles.val}>{regime.distribution_days}</span>
        </>
      )}
      {data.ep_updates?.length > 0 && (
        <>
          <span className={styles.sep}>|</span>
          <span className={styles.label}>EPs</span>
          <span className={styles.val}>{data.ep_updates.length}</span>
        </>
      )}
      {notes && <span className={styles.notes}>{notes}</span>}
    </div>
  )
}

// app/src/components/chart/chartIq/ChartIqToolbarButton.jsx — the chart toolbar's Chart IQ switch (pattern recognition
// drawn on the chart). Same `.btn` / `.active` styling as its peers. The engine reads daily bars, so on another timeframe the
// button says so and switching it on waits for the daily chart.
import styles from '../ChartToolbar.module.css'
import UIcon from '../../ui/UIcon'

export default function ChartIqToolbarButton({ active, onToggle, daily = true }) {
  const title = !daily
    ? (active ? 'Chart IQ: ON (shows on the Daily timeframe)' : 'Chart IQ reads daily charts: switch to 1D to see it')
    : (active ? 'Chart IQ: ON (click to hide)' : 'Chart IQ: pattern recognition on this chart (click to show)')
  return (
    <button
      type="button"
      className={`${styles.btn} ${active ? styles.active : ''}`}
      onClick={() => onToggle?.(!active)}
      title={title}
      aria-label="Toggle Chart IQ pattern recognition"
      aria-pressed={active}
      data-testid="chart-iq-toggle"
      style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, padding: '2px 6px', opacity: daily ? 1 : 0.6 }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <span style={{ fontSize: 12, lineHeight: 1 }}><UIcon name="compass" size={12} /></span>
        <span>Chart IQ</span>
      </span>
    </button>
  )
}

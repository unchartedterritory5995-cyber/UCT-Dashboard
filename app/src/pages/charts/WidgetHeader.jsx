import UIcon from '../../components/ui/UIcon'
import styles from './ChartsWorkspace.module.css'

// 'N' = grey "not linked": the widget syncs its ticker with nothing.
const COLORS = ['A', 'B', 'C', 'D', 'N']

function nextColor(c) {
  const i = COLORS.indexOf(c)
  return COLORS[(i + 1) % COLORS.length]
}

export default function WidgetHeader({ label, color, onColorChange, onRemove, onPopOut, atBottom = false }) {
  const isNone = color === 'N'
  return (
    <div className={`${styles.widgetHeader}${atBottom ? ' ' + styles.widgetHeaderBottom : ''}`}>
      <span className={`${styles.dragGrip} charts-widget-drag-handle`} aria-hidden="true">⋮⋮</span>
      <button
        type="button"
        className={`${styles.colorDot} ${styles[`colorDot${color}`]}`}
        onClick={() => onColorChange(nextColor(color))}
        aria-label={isNone ? 'Not linked (grey) — click to link to a color group' : `Color group ${color} (click to cycle)`}
        title={isNone
          ? 'Not linked — this widget’s ticker syncs with nothing. Click to cycle to a color group.'
          : `Color group ${color} — click to cycle (grey = not linked)`}
      />
      <span className={styles.widgetLabel}>{label}</span>
      <span className={styles.headerSpacer} />
      {onPopOut && (
        <button
          type="button"
          className={styles.popOutBtn}
          onClick={onPopOut}
          aria-label="Pop out widget"
          title="Open this widget in its own window you can drag to another monitor"
        >⧉</button>
      )}
      <button
        type="button"
        className={styles.closeBtn}
        onClick={onRemove}
        aria-label="Close widget"
        title="Remove this widget"
      ><UIcon name="x" size={13} /></button>
    </div>
  )
}

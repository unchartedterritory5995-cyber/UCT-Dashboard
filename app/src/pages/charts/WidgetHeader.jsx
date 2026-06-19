import UIcon from '../../components/ui/UIcon'
import styles from './ChartsWorkspace.module.css'

const COLORS = ['A', 'B', 'C', 'D']

function nextColor(c) {
  const i = COLORS.indexOf(c)
  return COLORS[(i + 1) % COLORS.length]
}

export default function WidgetHeader({ label, color, onColorChange, onRemove }) {
  return (
    <div className={styles.widgetHeader}>
      <span className={`${styles.dragGrip} charts-widget-drag-handle`} aria-hidden="true">⋮⋮</span>
      <button
        type="button"
        className={`${styles.colorDot} ${styles[`colorDot${color}`]}`}
        onClick={() => onColorChange(nextColor(color))}
        aria-label={`Color group ${color} (click to cycle)`}
        title={`Color group ${color} — click to cycle to next group`}
      />
      <span className={styles.widgetLabel}>{label}</span>
      <span className={styles.headerSpacer} />
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

import styles from './Toggle.module.css'

/**
 * Canonical on/off switch.
 * Props: checked (bool), onChange(nextChecked), label, disabled
 */
export default function Toggle({ checked = false, onChange, label, disabled = false, className = '', ...props }) {
  const sw = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={[styles.track, checked ? styles.on : '', className].filter(Boolean).join(' ')}
      {...props}
    >
      <span className={styles.thumb} />
    </button>
  )
  if (label == null) return sw
  return (
    <label className={styles.wrap}>
      {sw}
      <span className={styles.label}>{label}</span>
    </label>
  )
}

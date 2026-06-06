import { forwardRef } from 'react'
import styles from './Checkbox.module.css'

/** Canonical checkbox + optional label. Gold accent. */
const Checkbox = forwardRef(function Checkbox({ label, className = '', ...props }, ref) {
  const box = <input ref={ref} type="checkbox" className={styles.box} {...props} />
  if (label == null) return box
  return (
    <label className={[styles.wrap, className].filter(Boolean).join(' ')}>
      {box}
      <span className={styles.label}>{label}</span>
    </label>
  )
})

export default Checkbox

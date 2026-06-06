import { forwardRef } from 'react'
import styles from './Select.module.css'

/** Canonical native <select> with a consistent chevron + control geometry. */
const Select = forwardRef(function Select({ className = '', children, ...props }, ref) {
  return (
    <select ref={ref} className={[styles.select, className].filter(Boolean).join(' ')} {...props}>
      {children}
    </select>
  )
})

export default Select

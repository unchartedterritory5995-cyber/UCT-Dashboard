import { forwardRef } from 'react'
import styles from './Button.module.css'

/**
 * Canonical button. Replaces the per-page button styles scattered across
 * Settings / AuthForm / ModalShell / tiles.
 *
 * Props:
 *   variant: 'primary' | 'ghost' | 'danger' | 'muted'  (default 'primary')
 *   size:    'sm' | 'md'                                 (default 'md')
 *   fullWidth: boolean
 */
const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', fullWidth = false, type = 'button', className = '', ...props },
  ref,
) {
  const cls = [
    styles.btn,
    styles[variant] || styles.primary,
    styles[size] || styles.md,
    fullWidth ? styles.fullWidth : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return <button ref={ref} type={type} className={cls} {...props} />
})

export default Button

import { forwardRef } from 'react'
import styles from './Input.module.css'

/** Canonical text/number input. Single control geometry via --control-* tokens. */
const Input = forwardRef(function Input({ className = '', ...props }, ref) {
  return <input ref={ref} className={[styles.input, className].filter(Boolean).join(' ')} {...props} />
})

export default Input

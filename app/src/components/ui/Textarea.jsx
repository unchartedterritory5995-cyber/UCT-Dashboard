import { forwardRef } from 'react'
import styles from './Textarea.module.css'

/** Canonical textarea. Matches Input geometry, vertically resizable. */
const Textarea = forwardRef(function Textarea({ className = '', ...props }, ref) {
  return <textarea ref={ref} className={[styles.textarea, className].filter(Boolean).join(' ')} {...props} />
})

export default Textarea

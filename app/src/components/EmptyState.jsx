// app/src/components/EmptyState.jsx
// Branded empty state — a centered gold UIcon + one-line message, optional hint
// and a single CTA (link or button). Mirrors ErrorState so tiles and pages share
// one visual language instead of scattered bare `<div>text</div>` empties.
import { Link } from 'react-router-dom'
import UIcon from './ui/UIcon'
import styles from './EmptyState.module.css'

export default function EmptyState({
  icon = 'search',
  title,
  message,
  hint,
  cta,
  ctaTo,
  onCta,
  compact = false,
}) {
  return (
    <div className={compact ? styles.wrapper : styles.wrapperFull}>
      <span className={styles.icon} aria-hidden="true"><UIcon name={icon} size={26} gold /></span>
      {title && <p className={styles.title}>{title}</p>}
      {message && <p className={styles.message}>{message}</p>}
      {hint && <p className={styles.hint}>{hint}</p>}
      {cta && ctaTo && <Link className={styles.cta} to={ctaTo}>{cta}</Link>}
      {cta && !ctaTo && onCta && (
        <button type="button" className={styles.cta} onClick={onCta}>{cta}</button>
      )}
    </div>
  )
}

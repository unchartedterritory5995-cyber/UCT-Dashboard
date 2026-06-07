import styles from './StickyActionBar.module.css'

/* StickyActionBar — pins primary form actions to the bottom of a scrolling
 * form/sheet, above the keyboard, with safe-area padding. Put the submit CTA
 * here so it stays visible while the form scrolls (mobile form pattern).
 */
export default function StickyActionBar({ children, className = '' }) {
  return <div className={`${styles.bar} ${className}`}>{children}</div>
}

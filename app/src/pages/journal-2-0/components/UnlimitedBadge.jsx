import styles from './UnlimitedBadge.module.css'

/**
 * UnlimitedBadge — a small gold-outline pill that advertises the one thing
 * competitors can't match: Compass AI coaching is unlimited, with no per-message
 * credits or daily caps. Rendered on the Compass surfaces (CompassTab header +
 * above the CompassChat composer). Text + CSS only — no icon asset.
 */
export default function UnlimitedBadge({ className }) {
  return (
    <span
      className={className ? `${styles.badge} ${className}` : styles.badge}
      title="Compass AI coaching is unlimited — no per-message credits, no daily caps."
    >
      Unlimited · no credits, ever
    </span>
  )
}

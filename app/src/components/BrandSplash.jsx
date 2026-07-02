/**
 * BrandSplash — full-screen branded loading state (auth check, route guards).
 * The compass mark breathing over the wordmark instead of a bare "Loading..."
 * — this is the literal first paint of every session. Reduced-motion: static.
 */
import compassLogo from './intro/assets/compass-mark.png'
import styles from './BrandSplash.module.css'

export default function BrandSplash({ label = 'Loading' }) {
  return (
    <div className={styles.splash} role="status" aria-live="polite" aria-busy="true">
      <img src={compassLogo} alt="" aria-hidden="true" className={styles.mark} />
      <div className={styles.wordmark}>UCT INTELLIGENCE</div>
      <span className={styles.srOnly}>{label}</span>
    </div>
  )
}

import { Link } from 'react-router-dom'
import styles from './Landing.module.css'

const FEATURES = [
  { icon: '📰', title: 'Morning Wire', desc: 'AI-powered pre-market intelligence delivered daily at 7:35 AM ET. Regime analysis, breadth, risk appetite, exposure model.' },
  { icon: '⭐', title: 'UCT 20', desc: 'The 20 highest-conviction leadership stocks — tracked with entry/exit signals, stop losses, and real-time P&L.' },
  { icon: '📶', title: 'Breadth Monitor', desc: '20+ market internals with 8-tier heatmap, historical overlays, COT data, and drilldown to individual stocks.' },
  { icon: '⚡', title: 'Scanner', desc: 'Pullback MA, Remount, and Gapper setups scored on 7 criteria — pattern detection, volume, EMA proximity, and more.' },
  { icon: '🎯', title: 'Theme Tracker', desc: '63 ETF themes with live intraday returns across 6 periods. See where institutional money is rotating.' },
  { icon: '📅', title: 'Calendar', desc: 'Earnings + macro events for the week. EarningsWhispers data with AI-generated pre-earnings previews.' },
]

export default function Landing() {
  return (
    <div className={styles.page}>
      {/* Hero */}
      <header className={styles.hero}>
        <div className={styles.brand}>UCT</div>
        <div className={styles.heroInner}>
          <h1 className={styles.headline}>
            Institutional-Grade<br />Market Intelligence
          </h1>
          <p className={styles.subtitle}>
            Built for swing traders who take the craft seriously.
            AI-powered regime analysis, leadership tracking, and setup scanning
            — distilled from the methodologies of the world's greatest traders.
          </p>
          <div className={styles.ctas}>
            <Link to="/signup" className={styles.ctaPrimary}>Get Started</Link>
            <Link to="/login" className={styles.ctaSecondary}>Log In</Link>
          </div>
        </div>
      </header>

      {/* Features */}
      <section className={styles.features}>
        <h2 className={styles.sectionTitle}>What You Get</h2>
        <div className={styles.featureGrid}>
          {FEATURES.map(f => (
            <div key={f.title} className={styles.featureCard}>
              <span className={styles.featureIcon}>{f.icon}</span>
              <h3 className={styles.featureTitle}>{f.title}</h3>
              <p className={styles.featureDesc}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className={styles.pricing}>
        <h2 className={styles.sectionTitle}>Simple Pricing</h2>
        <div className={styles.pricingGrid}>
          <div className={styles.pricingCard}>
            <h3 className={styles.planName}>Free</h3>
            <div className={styles.planPrice}>$0</div>
            <ul className={styles.planFeatures}>
              <li>Morning Wire (delayed)</li>
              <li>Breadth Monitor (daily snapshot)</li>
              <li>Theme Tracker (end of day)</li>
            </ul>
            <Link to="/signup" className={styles.planCta}>Sign Up Free</Link>
          </div>
          <div className={`${styles.pricingCard} ${styles.pricingCardPro}`}>
            <div className={styles.proBadge}>PRO</div>
            <h3 className={styles.planName}>Pro</h3>
            <div className={styles.planPrice}>$49<span className={styles.planPeriod}>/mo</span></div>
            <ul className={styles.planFeatures}>
              <li>Everything in Free</li>
              <li>Real-time data (15s refresh)</li>
              <li>UCT 20 Portfolio Tracker</li>
              <li>Scanner (Pullback MA, Remount, Gappers)</li>
              <li>Options Flow + Dark Pool</li>
              <li>AI-powered earnings previews</li>
              <li>Full historical breadth data</li>
            </ul>
            <Link to="/signup?plan=pro" className={styles.planCtaPro}>Start Pro</Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerBrand}>UCT Intelligence</div>
        <p className={styles.footerText}>
          Built by traders, for traders. Powered by the methodologies of
          Qullamaggie, Minervini, O'Neil, Kell, and Bonde.
        </p>
      </footer>
    </div>
  )
}

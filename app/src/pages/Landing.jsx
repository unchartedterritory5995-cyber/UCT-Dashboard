import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import useInView from '../hooks/useIntersectionObserver'
import styles from './Landing.module.css'

const FEATURES = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
    title: 'Morning Wire',
    desc: 'AI-powered pre-market intelligence delivered daily at 7:35 AM ET. Regime analysis, breadth, risk appetite, and exposure model.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
    title: 'UCT 20',
    desc: 'The 20 highest-conviction leadership stocks — tracked with entry/exit signals, stop losses, and real-time P&L.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    title: 'Breadth Monitor',
    desc: '20+ market internals with 8-tier heatmap, historical overlays, COT data, and drilldown to individual stocks.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    title: 'Scanner',
    desc: 'Pullback MA, Remount, and Gapper setups scored on 7 criteria — pattern detection, volume, EMA proximity, and more.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    title: 'Theme Tracker',
    desc: '63 ETF themes with live intraday returns across 6 periods. See where institutional money is rotating.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
    title: 'Calendar',
    desc: 'Earnings + macro events for the week. EarningsWhispers data with AI-generated pre-earnings previews.',
  },
]

const PLAN_FEATURES = [
  'AI Morning Wire (daily 7:35 AM ET)',
  'Real-time data (15s refresh)',
  'UCT 20 Portfolio Tracker + Backtest',
  'Scanner (Pullback MA, Remount, Gappers)',
  'Breadth Monitor + Heatmap + COT',
  '63 Theme Tracker with live returns',
  'Trade Journal + Watchlists',
  'Options Flow + Dark Pool',
  'AI earnings previews',
  'Intraday regime alerts',
]

const STEPS = [
  {
    num: '01',
    title: 'Subscribe',
    desc: 'Join for $20/month. Cancel anytime.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="8.5" cy="7" r="4" />
        <line x1="20" y1="8" x2="20" y2="14" />
        <line x1="23" y1="11" x2="17" y2="11" />
      </svg>
    ),
  },
  {
    num: '02',
    title: 'Get the Morning Wire',
    desc: 'AI-generated briefing at 7:35 AM ET every trading day.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    ),
  },
  {
    num: '03',
    title: 'Trade with an Edge',
    desc: 'Real-time data, scanner alerts, and portfolio tracking.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
]

const METRICS = [
  { value: '63', label: 'ETF Themes' },
  { value: '20+', label: 'Breadth Metrics' },
  { value: '7:35 AM', label: 'Daily AI Wire' },
  { value: '15s', label: 'Real-Time Refresh' },
]

function FadeInSection({ children, className = '', delay = 0 }) {
  const [ref, isInView] = useInView()
  return (
    <div
      ref={ref}
      className={`${styles.fadeInUp} ${isInView ? styles.visible : ''} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}

export default function Landing() {
  const [showNav, setShowNav] = useState(false)

  const handleScroll = useCallback(() => {
    setShowNav(window.scrollY > 500)
  }, [])

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  const scrollToFeatures = (e) => {
    e.preventDefault()
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className={styles.page}>
      {/* ── Sticky Nav ──────────────────────────────────── */}
      <nav className={`${styles.stickyNav} ${showNav ? styles.stickyNavVisible : ''}`}>
        <div className={styles.navInner}>
          <span className={styles.navBrand}>UCT</span>
          <div className={styles.navActions}>
            <Link to="/login" className={styles.navGhost}>Log In</Link>
            <Link to="/signup?plan=pro" className={styles.navCta}>Get Started</Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────── */}
      <header className={styles.hero}>
        <div className={styles.heroGradient} aria-hidden="true" />
        <div className={styles.heroContent}>
          <div className={styles.heroPill}>Institutional-Grade Intelligence</div>
          <h1 className={styles.heroHeadline}>
            <span className={styles.gradientText}>Your Edge in</span>
            <br />
            <span className={styles.gradientText}>Every Market</span>
          </h1>
          <p className={styles.heroSubtitle}>
            AI-powered morning wire, 20-stock leadership portfolio, real-time
            breadth monitoring, and 63 theme ETFs — delivered daily at 7:35 AM ET.
          </p>
          <div className={styles.heroCtas}>
            <Link to="/signup?plan=pro" className={styles.ctaGold}>
              Get Started — $20/mo
            </Link>
            <a href="#features" onClick={scrollToFeatures} className={styles.ctaGhost}>
              See Features
            </a>
          </div>
        </div>
        <div className={styles.heroArrow} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </header>

      {/* ── Metrics Bar ─────────────────────────────────── */}
      <FadeInSection>
        <section className={styles.metricsBar}>
          {METRICS.map((m, i) => (
            <div key={m.label} className={styles.metric}>
              {i > 0 && <div className={styles.metricDivider} />}
              <span className={styles.metricValue}>{m.value}</span>
              <span className={styles.metricLabel}>{m.label}</span>
            </div>
          ))}
        </section>
      </FadeInSection>

      {/* ── Product Showcase ────────────────────────────── */}
      <FadeInSection>
        <section className={styles.showcase}>
          <div className={styles.mockupFrame}>
            <div className={styles.mockupChrome}>
              <div className={styles.mockupDots}>
                <span /><span /><span />
              </div>
              <div className={styles.mockupUrl}>app.uctintelligence.com</div>
            </div>
            <div className={styles.mockupBody}>
              <div className={styles.mockupPlaceholder}>
                Dashboard Preview
              </div>
            </div>
          </div>
        </section>
      </FadeInSection>

      {/* ── Features ────────────────────────────────────── */}
      <section id="features" className={styles.features}>
        <FadeInSection>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Everything You Need</h2>
            <p className={styles.sectionSubtitle}>
              Six integrated tools built for swing traders who take the craft seriously.
            </p>
          </div>
        </FadeInSection>
        <div className={styles.featureGrid}>
          {FEATURES.map((f, i) => (
            <FadeInSection key={f.title} delay={i * 80}>
              <div className={styles.featureCard}>
                <div className={styles.featureIconWrap}>{f.icon}</div>
                <h3 className={styles.featureTitle}>{f.title}</h3>
                <p className={styles.featureDesc}>{f.desc}</p>
              </div>
            </FadeInSection>
          ))}
        </div>
      </section>

      {/* ── How It Works ────────────────────────────────── */}
      <section className={styles.howItWorks}>
        <FadeInSection>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>How It Works</h2>
            <p className={styles.sectionSubtitle}>
              Three steps to better trading decisions.
            </p>
          </div>
        </FadeInSection>
        <FadeInSection>
          <div className={styles.stepsRow}>
            {STEPS.map((s, i) => (
              <div key={s.num} className={styles.step}>
                <div className={styles.stepIconWrap}>{s.icon}</div>
                <div className={styles.stepNum}>{s.num}</div>
                <h3 className={styles.stepTitle}>{s.title}</h3>
                <p className={styles.stepDesc}>{s.desc}</p>
                {i < STEPS.length - 1 && (
                  <div className={styles.stepConnector} aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </FadeInSection>
      </section>

      {/* ── Pricing ─────────────────────────────────────── */}
      <section className={styles.pricing}>
        <FadeInSection>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Simple Pricing</h2>
            <p className={styles.sectionSubtitle}>
              One plan. Everything included.
            </p>
          </div>
        </FadeInSection>
        <FadeInSection>
          <div className={styles.pricingCenter}>
            <div className={styles.pricingCard}>
              <div className={styles.proBadge}>PRO</div>
              <div className={styles.priceRow}>
                <span className={styles.priceAmount}>$20</span>
                <span className={styles.pricePeriod}>/month</span>
              </div>
              <ul className={styles.planFeatures}>
                {PLAN_FEATURES.map((f) => (
                  <li key={f}>
                    <svg className={styles.checkIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <Link to="/signup?plan=pro" className={styles.pricingCta}>
                Get Started Now
              </Link>
              <p className={styles.pricingNote}>Cancel anytime. No contracts.</p>
            </div>
          </div>
        </FadeInSection>
      </section>

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>UCT Intelligence</div>
          <div className={styles.footerLinks}>
            <Link to="/terms">Terms</Link>
            <span className={styles.footerDot} aria-hidden="true" />
            <Link to="/privacy">Privacy</Link>
          </div>
          <p className={styles.footerAttribution}>
            Built on the methodologies of Qullamaggie, Minervini, O'Neil, Kell, and Bonde.
          </p>
          <p className={styles.footerCopy}>&copy; {new Date().getFullYear()} UCT Intelligence</p>
        </div>
      </footer>
    </div>
  )
}

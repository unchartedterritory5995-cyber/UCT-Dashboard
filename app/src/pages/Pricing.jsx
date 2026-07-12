/**
 * Public pricing page — /pricing.
 *
 * The owner-approved strategy, stated plainly and honestly (2026-07-11
 * premium reposition):
 *   • ONE plan — UCT Intelligence — $200/mo or $2,000/yr (two months free).
 *     Everything unmetered. No free tier on the marketing pages.
 *   • 7-day free trial, card required at checkout, not charged until it ends.
 *     One-click cancel. No refunds — the trial IS the evaluation window.
 *     Your data leaves with you — always.
 *
 * PUBLIC + brand-styled (dark/gold, no emoji — every mark is a <UIcon/>). It is
 * safe to serve logged-out; the CTA adapts to auth state:
 *   signed-out → signup · free/trial → existing Stripe checkout · paid → "You're in".
 *
 * Annual checkout uses STRIPE_PRICE_ID_ANNUAL when configured, else it gracefully
 * falls back to the monthly price (backend `create_checkout_session`) and the
 * page shows an honest "annual billing coming online" note.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import UIcon from '../components/ui/UIcon'
import { useAuth } from '../context/AuthContext'
import styles from './Pricing.module.css'

const PAID_FEATURES = [
  'The Morning Wire — the 7:35 AM brief, every trading day',
  'Stock Catalysts — 20 vetted picks from 8 sources',
  'Compass AI coaching — verdicts, post-mortems, weekly reviews. No credits. Ever.',
  'Voice Assistant — 88 tools, full conversations',
  'Broker auto-sync — link a brokerage, trades import themselves',
  'Journal 2.0 — MFE / MAE excursions, exit quality, regime analytics',
  'The Floor — the live members community',
  'The whole platform — live charts, LiveFlow, breadth, themes, calendar, The Desk',
  'Full exports (CSV / JSON), always',
]

const PROMISES = [
  { icon: 'clock', text: '7-day full-access trial — $0 today.' },
  { icon: 'check', text: 'Cancel in one click.' },
  { icon: 'shield', text: 'Not charged until the trial ends — cancel before day 7, pay nothing.' },
  { icon: 'equity', text: 'Your data exports completely, always — it leaves with you.' },
]

export default function Pricing() {
  const { user, plan, trial, subscription, annualAvailable, startCheckout } = useAuth()
  const [billing, setBilling] = useState('annual') // 'annual' (headline) | 'monthly'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const trulyPaid = useMemo(
    () => !!user && (user.role === 'admin' || ['pro', 'premium', 'lifetime'].includes(plan)),
    [user, plan],
  )
  const onTrial = !!(trial && trial.active)
  // Never completed a checkout → the backend grants the 7-day card-required
  // trial (trial_period_days), so the CTA leads with it. An ex-subscriber
  // (subscription row exists) pays from day one — plain Subscribe.
  const trialEligible = !subscription
  const annualFallback = billing === 'annual' && !annualAvailable

  async function handleCheckout() {
    setBusy(true)
    setError('')
    try {
      await startCheckout(billing)
    } catch (err) {
      setError(err?.message || 'Could not start checkout. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      {/* ── Nav ── */}
      <nav className={styles.nav}>
        <Link to="/landing" className={styles.navBrand}>
          <span className={styles.navMark} aria-hidden="true"><UIcon name="compass" size={16} /></span>
          UCT Intelligence
        </Link>
        <div className={styles.navCta}>
          {user ? (
            <Link to="/dashboard" className={styles.navLogin}>Dashboard</Link>
          ) : (
            <>
              <Link to="/login" className={styles.navLogin}>Log in</Link>
              <Link to="/signup" className={styles.navSignup}>Get started</Link>
            </>
          )}
        </div>
      </nav>

      <main>
        {/* ── Hero ── */}
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div className={styles.eyebrow}>
              <span className={styles.eyebrowIcon} aria-hidden="true"><UIcon name="compass" size={13} /></span>
              Simple, honest pricing
            </div>
            <h1 className={styles.heroH1}>One price. Everything unlocked.</h1>
            <p className={styles.heroSub}>
              One plan, nothing metered — the AI research desk, the coach, the journal,
              the community, the entire market platform. Start with a
              <em> 7-day full-access trial — $0 today</em>.
            </p>
            <p className={styles.tagline}>Navigate the market, effectively.</p>
          </div>
        </section>

        {/* ── Plans ── */}
        <section className={styles.plans} aria-labelledby="plans-heading">
          <h2 id="plans-heading" className={styles.srOnly}>Plans</h2>

          {/* UCT Intelligence — the one plan */}
          <div className={`${styles.card} ${styles.cardFeatured}`}>
            <div className={styles.featuredTag}>The complete desk</div>
            <div className={styles.cardHead}>
              <h3 className={styles.cardName}>UCT Intelligence</h3>

              <div className={styles.billingToggle} role="group" aria-label="Billing period">
                <button
                  type="button"
                  className={`${styles.billBtn} ${billing === 'annual' ? styles.billBtnActive : ''}`}
                  aria-pressed={billing === 'annual'}
                  onClick={() => setBilling('annual')}
                >
                  Annual <span className={styles.billSave}>2 months free</span>
                </button>
                <button
                  type="button"
                  className={`${styles.billBtn} ${billing === 'monthly' ? styles.billBtnActive : ''}`}
                  aria-pressed={billing === 'monthly'}
                  onClick={() => setBilling('monthly')}
                >
                  Monthly
                </button>
              </div>

              <div className={styles.priceRow}>
                <span className={styles.price}>{billing === 'annual' ? '$2,000' : '$200'}</span>
                <span className={styles.priceUnit}>{billing === 'annual' ? '/ yr' : '/ mo'}</span>
              </div>
              <p className={styles.priceNote}>
                {billing === 'annual'
                  ? 'two months free vs monthly'
                  : 'billed monthly — cancel anytime'}
              </p>
              <p className={styles.cardLede}>Everything, unmetered. The intelligence — and the market.</p>
            </div>

            <ul className={styles.featureList}>
              {PAID_FEATURES.map((f) => (
                <li key={f} className={styles.feature}>
                  <span className={styles.featIconGold} aria-hidden="true"><UIcon name="check" size={15} /></span>
                  {f === 'Broker auto-sync — link a brokerage, trades import themselves' ? (
                    <span>
                      Broker auto-sync — <Link to="/brokers" className={styles.inlineLink}>see verified brokers</Link>
                    </span>
                  ) : (
                    f
                  )}
                </li>
              ))}
            </ul>

            <p className={styles.compareLine}>
              TradeZella sells a journal for $399/yr. This includes the journal — <strong>and the market</strong>.
            </p>

            {error && <div className={styles.error} role="alert">{error}</div>}

            <div className={styles.cardCta}>
              {!user && (
                <Link to="/signup" className={styles.ctaGold}>Start your 7-day free trial</Link>
              )}
              {user && trulyPaid && (
                <div className={styles.paidState}>
                  <span className={styles.paidCheck} aria-hidden="true"><UIcon name="check" size={16} gold={false} /></span>
                  <div>
                    <div className={styles.paidTitle}>You&apos;re in.</div>
                    <Link to="/settings" className={styles.inlineLink}>Manage your subscription</Link>
                  </div>
                </div>
              )}
              {user && !trulyPaid && (
                <>
                  {onTrial && (
                    <p className={styles.trialLine}>
                      You&apos;re on your 7-day trial — {trial.days_left}{' '}
                      {trial.days_left === 1 ? 'day' : 'days'} left. Subscribe to keep everything.
                    </p>
                  )}
                  <button
                    type="button"
                    className={styles.ctaGold}
                    onClick={handleCheckout}
                    disabled={busy}
                  >
                    {/* Honest CTA: when the annual price isn't configured yet the
                        checkout charges monthly — the button must say what is
                        actually charged at click time (P0 whole-branch fix).
                        First-ever subscribers lead with the trial ($0 today);
                        returning ex-subscribers see the plain charge. */}
                    {busy
                      ? 'Redirecting to Stripe…'
                      : `${trialEligible ? 'Start free trial — then' : 'Subscribe —'} ${billing === 'annual' && !annualFallback ? '$2,000/yr billed annually' : '$200/mo'}`}
                  </button>
                </>
              )}
              {(!user || (!trulyPaid && trialEligible)) && (
                <p className={styles.ctaSub}>Card required — $0 today, nothing charged until the trial ends.</p>
              )}
              {annualFallback && (
                <p className={styles.ctaSub}>
                  Annual billing is coming online — you&apos;ll start on the monthly rate and
                  we&apos;ll move you to annual automatically.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── Promises ── */}
        <section className={styles.promiseSec} aria-labelledby="promise-heading">
          <div className={styles.sectionHead}>
            <h2 id="promise-heading" className={styles.sectionH2}>No traps. No lock-in.</h2>
            <p className={styles.sectionP}>The fine print, said out loud.</p>
          </div>
          <ul className={styles.promiseGrid}>
            {PROMISES.map((p) => (
              <li key={p.text} className={styles.promiseCard}>
                <span className={styles.promiseIcon} aria-hidden="true"><UIcon name={p.icon} size={18} /></span>
                <span className={styles.promiseText}>{p.text}</span>
              </li>
            ))}
          </ul>
          <p className={styles.scopeLine}>Built for US stock &amp; options traders.</p>
        </section>

        {/* ── Close ── */}
        <section className={styles.close}>
          <div className={styles.closeInner}>
            <h2 className={styles.closeH2}>Try everything for 7 days.</h2>
            <p className={styles.closeP}>
              Cancel in one click before the trial ends and you pay nothing. If it&apos;s
              not for you, your data exports completely and leaves with you.
            </p>
            <div className={styles.ctas}>
              {user ? (
                <Link to="/dashboard" className={styles.ctaGold}>Go to your dashboard</Link>
              ) : (
                <Link to="/signup" className={styles.ctaGold}>Start free</Link>
              )}
              <Link to="/compare" className={styles.ctaGhost}>Compare journals</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.foot}>
        <div className={styles.footBrand}>
          <span className={styles.navMark} aria-hidden="true"><UIcon name="compass" size={16} /></span>
          UCT Intelligence
        </div>
        <div className={styles.footLinks}>
          <Link to="/landing">Home</Link>
          <Link to="/brokers">Brokers</Link>
          <Link to="/compare">Compare</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
        </div>
      </footer>
    </div>
  )
}

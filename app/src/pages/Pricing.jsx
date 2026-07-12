/**
 * Public pricing page — /pricing.
 *
 * The owner-approved strategy, stated plainly and honestly:
 *   • Free forever core (manual + CSV journal, analytics, calendar, notebook,
 *     PNG share cards).
 *   • ONE paid tier — UCT Intelligence — $19/mo billed annually ($228/yr) or
 *     $29 monthly. Everything unmetered.
 *   • 14-day full-access trial, no credit card. One-click cancel. Published
 *     refunds. Your data leaves with you — always.
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

const FREE_FEATURES = [
  'Unlimited manual + CSV trade imports',
  'TradeZella, Tradervue & TraderSync import presets built in',
  'Core analytics — win rate, R, equity curve',
  'Earnings & economic calendar',
  'Notebook — long-form trade notes',
  'PNG share cards',
]

const PAID_FEATURES = [
  'Everything in Free, unmetered',
  'Broker auto-sync — link a brokerage, trades import themselves',
  'Full Compass AI coaching — No credits. Ever.',
  'MFE / MAE excursions + Exit Quality',
  'Regime analytics',
  'Full exports (CSV / JSON), always',
  'The Floor — the members community',
  'The whole platform — live charts, options flow, breadth, calendar, The Desk',
]

const PROMISES = [
  { icon: 'clock', text: '14-day full-access trial — no credit card.' },
  { icon: 'check', text: 'Cancel in one click.' },
  { icon: 'shield', text: 'Refunds within 7 days of any charge — no questions.' },
  { icon: 'equity', text: 'Your data exports completely, always — it leaves with you.' },
]

export default function Pricing() {
  const { user, plan, trial, annualAvailable, startCheckout } = useAuth()
  const [billing, setBilling] = useState('annual') // 'annual' (headline) | 'monthly'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const trulyPaid = useMemo(
    () => !!user && (user.role === 'admin' || ['pro', 'premium', 'lifetime'].includes(plan)),
    [user, plan],
  )
  const onTrial = !!(trial && trial.active)
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
              The core journal is <em>free forever</em>. One paid tier adds broker auto-sync,
              unmetered Compass AI, and the entire market platform. Start with a
              <em> 14-day full-access trial — no credit card</em>.
            </p>
            <p className={styles.tagline}>Navigate the market, effectively.</p>
          </div>
        </section>

        {/* ── Plans ── */}
        <section className={styles.plans} aria-labelledby="plans-heading">
          <h2 id="plans-heading" className={styles.srOnly}>Plans</h2>

          {/* Free forever */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h3 className={styles.cardName}>Free forever</h3>
              <div className={styles.priceRow}>
                <span className={styles.price}>$0</span>
                <span className={styles.priceUnit}>always</span>
              </div>
              <p className={styles.cardLede}>The trading journal, in full. No trial clock, no card.</p>
            </div>
            <ul className={styles.featureList}>
              {FREE_FEATURES.map((f) => (
                <li key={f} className={styles.feature}>
                  <span className={styles.featIcon} aria-hidden="true"><UIcon name="check" size={15} gold={false} /></span>
                  {f}
                </li>
              ))}
            </ul>
            <div className={styles.cardCta}>
              {user ? (
                <Link to="/journal" className={styles.ctaGhost}>Open your journal</Link>
              ) : (
                <Link to="/signup" className={styles.ctaGhost}>Start free</Link>
              )}
            </div>
          </div>

          {/* UCT Intelligence (paid) */}
          <div className={`${styles.card} ${styles.cardFeatured}`}>
            <div className={styles.featuredTag}>Most popular</div>
            <div className={styles.cardHead}>
              <h3 className={styles.cardName}>UCT Intelligence</h3>

              <div className={styles.billingToggle} role="group" aria-label="Billing period">
                <button
                  type="button"
                  className={`${styles.billBtn} ${billing === 'annual' ? styles.billBtnActive : ''}`}
                  aria-pressed={billing === 'annual'}
                  onClick={() => setBilling('annual')}
                >
                  Annual <span className={styles.billSave}>save 34%</span>
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
                <span className={styles.price}>{billing === 'annual' ? '$19' : '$29'}</span>
                <span className={styles.priceUnit}>/ mo</span>
              </div>
              <p className={styles.priceNote}>
                {billing === 'annual'
                  ? 'billed annually — $228/yr'
                  : 'billed monthly — cancel anytime'}
              </p>
              <p className={styles.cardLede}>Everything, unmetered. The journal — and the market.</p>
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
                <Link to="/signup" className={styles.ctaGold}>Start your 14-day free trial</Link>
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
                      You&apos;re on your 14-day trial — {trial.days_left}{' '}
                      {trial.days_left === 1 ? 'day' : 'days'} left. Subscribe to keep everything.
                    </p>
                  )}
                  <button
                    type="button"
                    className={styles.ctaGold}
                    onClick={handleCheckout}
                    disabled={busy}
                  >
                    {busy ? 'Redirecting to Stripe…' : `Subscribe — ${billing === 'annual' ? '$19/mo billed annually' : '$29/mo'}`}
                  </button>
                </>
              )}
              {!user && (
                <p className={styles.ctaSub}>No credit card required.</p>
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
            <h2 className={styles.closeH2}>Try everything for 14 days.</h2>
            <p className={styles.closeP}>
              No credit card. Cancel in one click. If it&apos;s not for you, your data
              exports completely and leaves with you.
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

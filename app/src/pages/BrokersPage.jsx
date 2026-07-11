/**
 * Public "Verified Sync" page — /brokers.
 *
 * The category's #1 complaint is broker sync that breaks or quietly lies. Our
 * whole angle is VERIFIED honesty: we list ONLY the brokers we've confirmed on
 * real accounts, with the date we did it. This page is the marketing surface
 * for that promise.
 *
 * PUBLIC + static: it renders NO user data and makes NO authed fetch, so it is
 * safe to serve logged-out (it lives outside AuthGuard). Content comes from the
 * code-config `verifiedBrokers.js` + hard-coded honest copy.
 *
 * No emoji anywhere — every mark is a branded <UIcon/>. Dark/gold brand,
 * matching the Compare / Landing visual language.
 */
import { Link } from 'react-router-dom'
import UIcon from '../components/ui/UIcon'
import { VERIFIED_BROKERS } from './journal-2-0/lib/verifiedBrokers'
import styles from './BrokersPage.module.css'

const SUPPORT_EMAIL = 'contact@uctintelligence.com'
const REQUEST_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
  'Broker verification request',
)}&body=${encodeURIComponent(
  "Broker I'd like verified:\nMy account type:\n\n(We verify within 48 hours and add it here once we've confirmed it on a real account.)",
)}`

// SnapTrade brokerages we can connect today (each earns a "Verified by us" badge
// only after a real-account check). Honest framing: "supported via SnapTrade",
// NOT "verified".
const SNAPTRADE_BROKERS = [
  'Schwab', 'Fidelity', 'E*TRADE', 'Webull', 'tastytrade',
  'Interactive Brokers', 'Robinhood', 'Vanguard', 'Tradier', 'Alpaca',
]

/** Render an ISO 'YYYY-MM-DD' as "Mon D, YYYY" without a UTC day-shift. */
function fmtVerifiedDate(iso) {
  if (!iso) return ''
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BrokersPage() {
  return (
    <div className={styles.page}>
      {/* ── Nav ── */}
      <nav className={styles.nav}>
        <Link to="/landing" className={styles.navBrand}>
          <span className={styles.navMark} aria-hidden="true"><UIcon name="compass" size={16} /></span>
          UCT Intelligence
        </Link>
        <div className={styles.navCta}>
          <Link to="/login" className={styles.navLogin}>Log in</Link>
          <Link to="/signup" className={styles.navSignup}>Get started</Link>
        </div>
      </nav>

      <main>
        {/* ── Hero ── */}
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div className={styles.eyebrow}>
              <span className={styles.eyebrowIcon} aria-hidden="true"><UIcon name="shield" size={13} /></span>
              Verified Sync
            </div>
            <h1 className={styles.heroH1}>Broker sync you can actually trust.</h1>
            <p className={styles.heroSub}>
              Every trading journal claims &ldquo;broker sync.&rdquo; Most of them break
              quietly, drop trades, or show you numbers that don&apos;t match your account.
              We do the opposite: we list <em>only</em> the brokers we&apos;ve verified on
              real, funded accounts — with the date we confirmed it. If a broker isn&apos;t
              on the verified list, we tell you plainly instead of pretending.
            </p>
            <p className={styles.tagline}>Navigate the market, effectively.</p>
          </div>
        </section>

        {/* ── Verified by us ── */}
        <section className={styles.section} aria-labelledby="verified-heading">
          <div className={styles.sectionHead}>
            <h2 id="verified-heading" className={styles.sectionH2}>Verified by us.</h2>
            <p className={styles.sectionP}>
              Confirmed end-to-end on a real account — trades, positions, balances, and
              options all reconcile against the broker&apos;s own holdings.
            </p>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col" className={styles.thBroker}>Broker</th>
                  <th scope="col" className={styles.th}>Verified</th>
                  <th scope="col" className={styles.th}>What we confirmed</th>
                </tr>
              </thead>
              <tbody>
                {VERIFIED_BROKERS.map((b) => (
                  <tr key={b.name}>
                    <th scope="row" className={styles.brokerCell}>
                      <span className={styles.brokerMark} aria-hidden="true">
                        <UIcon name="check" size={15} gold={false} />
                      </span>
                      {b.name}
                    </th>
                    <td className={styles.dateCell}>{fmtVerifiedDate(b.verifiedDate)}</td>
                    <td className={styles.notesCell}>{b.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Supported via SnapTrade ── */}
        <section className={styles.section} aria-labelledby="snaptrade-heading">
          <div className={styles.sectionHead}>
            <h2 id="snaptrade-heading" className={styles.sectionH2}>Supported via SnapTrade.</h2>
            <p className={styles.sectionP}>
              30+ brokerages connect through SnapTrade — Schwab, Fidelity, E*TRADE, Webull,
              tastytrade, and more. We verify each one on a real account before we badge it,
              so &ldquo;supported&rdquo; and &ldquo;verified&rdquo; never get blurred together.
            </p>
          </div>
          <ul className={styles.chips}>
            {SNAPTRADE_BROKERS.map((name) => (
              <li key={name} className={styles.chip}>{name}</li>
            ))}
            <li className={`${styles.chip} ${styles.chipMore}`}>and more</li>
          </ul>
        </section>

        {/* ── Request verification ── */}
        <section className={styles.requestSec} aria-labelledby="request-heading">
          <div className={styles.requestInner}>
            <h2 id="request-heading" className={styles.sectionH2}>Using a broker we haven&apos;t verified?</h2>
            <p className={styles.requestP}>
              Tell us which one. We verify on a real account within 48 hours and add it to
              the list above once it&apos;s confirmed — no guessing, no vaporware badges.
            </p>
            <div className={styles.ctas}>
              <a className={styles.ctaGold} href={REQUEST_MAILTO}>Request verification</a>
              <Link to="/support" className={styles.ctaGhost}>Contact support</Link>
            </div>
          </div>
        </section>

        {/* ── How our sync works ── */}
        <section className={styles.section} aria-labelledby="how-heading">
          <div className={styles.sectionHead}>
            <h2 id="how-heading" className={styles.sectionH2}>How our sync works.</h2>
            <p className={styles.sectionP}>
              The design principles behind the trust — so you know what the numbers mean.
            </p>
          </div>
          <div className={styles.trustGrid}>
            <TrustCard
              icon="shield"
              title="Holdings are the truth"
              body="We reconcile every import against your broker's current holdings. When our
                    trade reconstruction and the broker disagree, the broker wins — your
                    positions match what you actually hold."
            />
            <TrustCard
              icon="clock"
              title="Nightly reconcile at 2:30am"
              body="Beyond the every-20-minute sync, a nightly pass at 2:30am ET re-checks
                    balances and positions so drift never accumulates overnight."
            />
            <TrustCard
              icon="check"
              title="The Sync Trust Center"
              body="Inside your journal, the Sync Trust Center shows exactly how fresh the data
                    is, the broker-vs-imported counts, and a full sync activity log — receipts,
                    not a black box."
            />
            <TrustCard
              icon="equity"
              title="We never filter your imports"
              body="Broker-mirror law: we import your account exactly as it is. We never curate,
                    suppress, or 'clean up' trades. Your journal is a faithful mirror — the good
                    fills and the ugly ones."
            />
          </div>
        </section>

        {/* ── Close ── */}
        <section className={styles.close}>
          <div className={styles.closeInner}>
            <h2 className={styles.closeH2}>Connect once. Trust every number.</h2>
            <p className={styles.closeP}>
              Link your brokerage and your journal fills itself — verified, reconciled, and
              honest about anything it can&apos;t confirm.
            </p>
            <div className={styles.ctas}>
              <Link to="/signup" className={styles.ctaGold}>Start free</Link>
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
          <Link to="/compare">Compare</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
        </div>
      </footer>
    </div>
  )
}

function TrustCard({ icon, title, body }) {
  return (
    <div className={styles.trustCard}>
      <span className={styles.trustIcon} aria-hidden="true"><UIcon name={icon} size={18} /></span>
      <h3 className={styles.trustTitle}>{title}</h3>
      <p className={styles.trustBody}>{body}</p>
    </div>
  )
}

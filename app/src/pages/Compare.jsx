import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import UIcon from '../components/ui/UIcon'
import { track } from '../utils/landingTrack'
import styles from './Compare.module.css'

// Column order for the comparison grid. UCT is always the lead column.
const COLUMNS = ['UCT Intelligence', 'TradeZella', 'TraderSync', 'Tradervue']

// Each row is a feature. `cells` aligns 1:1 with COLUMNS.
// A cell may carry an `icon` ('check' | 'x') rendered via UIcon (never an emoji
// or a ✓/✗ literal), a `text`, and `lead` to accent the UCT column.
const ROWS = [
  {
    feature: 'AI coaching',
    cells: [
      { icon: 'check', text: 'Unlimited — no credits, ever', lead: true },
      { text: '500–1,000 credits/mo' },
      { text: '5–60 messages/day by tier' },
      { icon: 'x', text: 'None' },
    ],
  },
  {
    feature: 'Coaching before the trade',
    cells: [
      { icon: 'check', text: 'Pre-trade verdict — GO / HOLD / SKIP', lead: true },
      { icon: 'x', text: 'Replay after the fact' },
      { icon: 'x', text: 'Replay after the fact' },
      { icon: 'x', text: 'Replay after the fact' },
    ],
  },
  {
    feature: 'Broker data',
    cells: [
      { icon: 'check', text: 'Your journal is an exact mirror — we never curate', lead: true },
      { text: 'Broker sync' },
      { text: 'Broker sync' },
      { text: 'Broker sync' },
    ],
  },
  {
    feature: 'Honesty about data',
    cells: [
      { icon: 'check', text: 'We label approximations and tell you when data is insufficient', lead: true },
      { text: '—' },
      { text: '—' },
      { text: '—' },
    ],
  },
  {
    feature: 'Price',
    cells: [
      { text: '$20/mo', lead: true, price: true },
      { text: '$348/yr' },
      { text: '$588/yr' },
      { text: '$399/yr' },
    ],
  },
]

function Cell({ cell }) {
  const cls = [
    styles.cell,
    cell.lead ? styles.cellLead : '',
    cell.price ? styles.cellPrice : '',
  ].filter(Boolean).join(' ')
  return (
    <td className={cls}>
      <span className={styles.cellInner}>
        {cell.icon === 'check' && (
          <span className={`${styles.mark} ${styles.markYes}`} aria-hidden="true">
            <UIcon name="check" size={15} gold={false} />
          </span>
        )}
        {cell.icon === 'x' && (
          <span className={`${styles.mark} ${styles.markNo}`} aria-hidden="true">
            <UIcon name="x" size={15} gold={false} />
          </span>
        )}
        <span>{cell.text}</span>
      </span>
    </td>
  )
}

export default function Compare() {
  // One compare_view event per page mount (mirrors Landing's landing_view).
  useEffect(() => { track('compare_view') }, [])

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
          <Link
            to="/signup"
            className={styles.navSignup}
            onClick={() => track('compare_cta_signup_click', { location: 'nav' })}
          >
            Get started
          </Link>
        </div>
      </nav>

      <main>
        {/* ── Hero ── */}
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div className={styles.eyebrow}>
              <span className={styles.eyebrowDot} />
              UCT vs. the trade journals
            </div>
            <h1 className={styles.heroH1}>The journal that coaches before the trade.</h1>
            <p className={styles.heroSub}>
              TradeZella, TraderSync, and Tradervue log what already happened, then
              meter their AI behind credits and daily caps. UCT Intelligence gives you
              an unlimited coach that grades the setup <em>before</em> you click buy —
              and mirrors your broker exactly, without curating a thing.
            </p>
            <div className={styles.ctas}>
              <Link
                to="/signup"
                className={styles.ctaGold}
                onClick={() => track('compare_cta_signup_click', { location: 'hero' })}
              >
                Start free
              </Link>
              <a href="#table" className={styles.ctaGhost}>See the comparison</a>
            </div>
          </div>
        </section>

        {/* ── Comparison table ── */}
        <section id="table" className={styles.tableSec}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionH2}>How UCT compares.</h2>
            <p className={styles.sectionP}>
              The differences that actually change how you trade — not a checkbox arms race.
            </p>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thFeature} scope="col">Feature</th>
                  {COLUMNS.map((c, i) => (
                    <th
                      key={c}
                      scope="col"
                      className={i === 0 ? `${styles.th} ${styles.thLead}` : styles.th}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.feature}>
                    <th scope="row" className={styles.rowLabel}>{row.feature}</th>
                    {row.cells.map((cell, i) => (
                      <Cell key={`${row.feature}-${i}`} cell={cell} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.tableNote}>
            Competitor AI limits and pricing reflect public tiers and range roughly
            $288–$835/yr across plans. UCT Intelligence is $20/mo. Figures are
            approximate and change — check each vendor for current terms.
          </p>
        </section>

        {/* ── Why no tick replay? ── */}
        <section className={styles.replay}>
          <div className={styles.replayGrid}>
            <div className={styles.replayCopy}>
              <div className={styles.eyebrow}>
                <span className={styles.eyebrowDot} />
                Why no tick replay?
              </div>
              <h2 className={styles.sectionH2}>Coaching before the trade beats replaying after it.</h2>
              <p className={styles.replayP}>
                Tick-by-tick replay is a beautiful way to relive a loss you already took.
                It feels like work. It rarely changes the next click.
              </p>
              <p className={styles.replayP}>
                We put the intelligence where it moves the needle: at the moment of
                decision. Compass reads your setup, your rules, and the regime, then
                gives you a verdict — GO, HOLD, or SKIP — <em>before</em> the order goes
                in. The post-mortem still happens. But the edge is upstream.
              </p>
            </div>

            {/* Placeholder for a verdict screenshot — styled empty frame, no asset. */}
            <figure className={styles.shot}>
              <div className={styles.shotFrame} role="img" aria-label="Pre-trade verdict card preview">
                <div className={styles.shotHead}>
                  <span className={styles.shotMark} aria-hidden="true"><UIcon name="compass" size={14} /></span>
                  <span className={styles.shotTitle}>Compass</span>
                  <span className={styles.shotStatus}>Pre-trade</span>
                </div>
                <div className={styles.shotVerdict}>
                  <span className={styles.shotBadge}>SKIP</span>
                  <span className={styles.shotVerdictText}>
                    B+ at best — chasing the breakout with no clean base. You're 2 stops
                    into the session; wait for an A+ setup.
                  </span>
                </div>
                <div className={styles.shotSkeleton}>
                  <span style={{ width: '82%' }} />
                  <span style={{ width: '64%' }} />
                  <span style={{ width: '73%' }} />
                </div>
              </div>
              <figcaption className={styles.shotCaption}>
                The verdict lands before you click buy — not in a replay tomorrow.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className={styles.close}>
          <div className={styles.closeInner}>
            <h2 className={styles.closeH2}>Switch to a journal that coaches.</h2>
            <p className={styles.closeP}>
              Start free, keep your history, and let Compass grade your next setup before
              you take it.
            </p>
            <div className={styles.ctas}>
              <Link
                to="/signup"
                className={styles.ctaGold}
                onClick={() => track('compare_cta_signup_click', { location: 'close' })}
              >
                Start free
              </Link>
            </div>
            <Link
              to="/signup"
              className={styles.switchLine}
              onClick={() => track('compare_cta_switch_click')}
            >
              Switch in 30 minutes — import your TradeZella history →
            </Link>
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
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
        </div>
      </footer>
    </div>
  )
}

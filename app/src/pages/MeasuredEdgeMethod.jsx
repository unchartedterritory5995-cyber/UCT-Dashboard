// The "Measured edge" method page (owner decision 2, 2026-10-24): the static page the chart chip's "Method"
// link opens. It explains the outcome replay the badge stands on, so the chip can state history plainly and
// point here for how it was measured. Public, like /methodology. Content is the method section of the outcome
// replay report, public-safe (no internal paths, no tickers).
//
// ⛔ Words: history, never a forecast. Never "confidence" or "probability"; the lift is in percentage points.
// MeasuredEdgeMethod.test.jsx scans the rendered page for both rules.
import { NOT_ADVICE } from '../constants/disclaimer'
import styles from './Methodology.module.css'

export const MEASURED_EDGE_METHOD_PATH = '/methodology/measured-edge'

export default function MeasuredEdgeMethod() {
  return (
    <div className={styles.page} data-testid="measured-edge-method-page">
      <h1 className={styles.title}>How the measured edge is measured</h1>
      <p className={styles.lede}>
        A drawing on the chart describes structure. The small &ldquo;Measured edge&rdquo; chip is a separate,
        narrower statement: in a historical replay, setups of that type did better than a plain breakout in the
        same stock. This page is how that replay works.
      </p>

      <section className={styles.section} aria-labelledby="me-replay">
        <h2 className={styles.h2} id="me-replay">The replay</h2>
        <p className={styles.body}>
          We replayed the chart drawings exactly as a member is served them, point in time: on the last session
          of every week from October 2023 to August 2026, each stock was drawn from the bars available on that
          date and nothing later. The universe is liquid US stocks at each date (not funds), priced above $10,
          trading more than $20M a day on average over 50 days, with at least 120 sessions of history. Each drawn
          setup is entered at its own buy point when price trades through it.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="me-baseline">
        <h2 className={styles.h2} id="me-baseline">What it is compared against</h2>
        <p className={styles.body}>
          The baseline is the simplest breakout there is: any session where a liquid stock trades above its prior
          20-day high. Every setup is compared with those plain breakouts in the same stock, in the same market
          regime and at a similar distance from its moving averages, so the comparison isolates what the setup
          adds over just buying strength.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="me-outcome">
        <h2 className={styles.h2} id="me-outcome">What counts as a hit</h2>
        <p className={styles.body}>
          A hit is a trade that gains 20% from entry before it falls 8% from entry, within 60 sessions. The hit
          rate is the share of trades that are hits. The chip&rsquo;s figure is the difference, in percentage points,
          between a setup type&rsquo;s hit rate and the hit rate of the matched plain breakouts.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="me-holdout">
        <h2 className={styles.h2} id="me-holdout">The out-of-sample check</h2>
        <p className={styles.body}>
          The rules were fixed on the earlier part of the replay, through November 2025, and then run once on a
          later period that had been held back, February to August 2026. A type gets the chip only when its lift
          over the baseline holds on that held-out period too. The ranges quoted are 95% intervals from a
          bootstrap that resamples whole dates, so one unusual week cannot carry the result.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="me-limits">
        <h2 className={styles.h2} id="me-limits">Limits</h2>
        <p className={styles.body}>
          This is a hypothetical back-test, not a guarantee, and results vary. Most of the replay period was a
          rising market. The held-out period&rsquo;s matching is looser than the earlier period&rsquo;s. No slippage or
          commissions are included. Edges drift as markets change, so the replay is re-run on a schedule, and a
          type loses its chip if its held-out lift stops holding. A drawing without the chip simply has no measured
          edge over a plain breakout; it is still structure worth reading.
        </p>
      </section>

      <p className={styles.notAdvice} data-testid="measured-edge-not-advice">{NOT_ADVICE}</p>
    </div>
  )
}

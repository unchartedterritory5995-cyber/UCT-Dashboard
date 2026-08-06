// §12: "documented in code" is not a user-facing posture. This page publishes
// the Setup Grade arithmetic in full.
//
// NORMATIVE: the weights and thresholds below MUST equal
// api/services/setup_grade.py WEIGHTS / LETTER_THRESHOLDS verbatim.
// Methodology.test.jsx pins them; change one side and the test fails.
import { NOT_ADVICE } from '../constants/disclaimer'
import styles from './Methodology.module.css'

const WEIGHTS = [
  ['Beat streak', '30%', 'Share of the last reported quarters whose EPS beat consensus. Quarters with no consensus on file are excluded from both sides of the ratio.'],
  ['Estimate revisions (30d)', '30%', 'Analyst estimate revisions over the trailing 30 days: upward revisions as a share of all revisions. No revisions at all counts as no signal, not a neutral score.'],
  ['Relative strength rank', '25%', "The stock's 1–99 relative-strength percentile against the tracked universe — the same number the RS chip shows, read from the same source."],
  ['Options premium vs typical move', '15%', "Tonight's implied move against the average absolute move this stock has actually made on past reports. Cheaper than typical scores higher."],
]

const LADDER = [
  ['A+', '93+'], ['A', '85–92'], ['A-', '78–84'],
  ['B+', '71–77'], ['B', '64–70'], ['B-', '57–63'],
  ['C+', '50–56'], ['C', '43–49'], ['C-', '36–42'],
  ['D+', '29–35'], ['D', '22–28'], ['D-', '15–21'],
  ['F', 'under 15'],
]

export default function Methodology() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Methodology</h1>
      <p className={styles.lede}>
        Every grade and chip on this platform carries its denominator. This page is
        that denominator: the inputs, the weights, the thresholds and the update
        cadence behind the two scores we publish.
      </p>

      <section className={styles.section} aria-labelledby="m-grade">
        <h2 className={styles.h2} id="m-grade">Earnings Setup Grade</h2>
        <p className={styles.body} data-testid="methodology-scope">
          The Earnings Setup Grade scores <strong>this report</strong> — the event.
          The UCT Rating scores <strong>the stock</strong>. They are different
          instruments, they can disagree, and where they share an input (relative
          strength) they read the same source so the disagreement is explainable.
        </p>

        <table className={styles.table} data-testid="methodology-grade-weights">
          <thead>
            <tr><th scope="col">Input</th><th scope="col">Weight</th><th scope="col">Definition</th></tr>
          </thead>
          <tbody>
            {WEIGHTS.map(([label, weight, def]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="t-num">{weight}</td>
                <td>{def}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className={styles.body} data-testid="methodology-partial-basis">
          <strong>Partial inputs.</strong> When an input is unavailable — no options
          chain listed, a cold pre-market IV read, a name outside the ranked universe
          — the grade is computed from the inputs that are available, the remaining
          weights are renormalised, and the chip states the basis explicitly, e.g.
          "B+ · 3 of 4 inputs". Below two available inputs no grade is shown at all.
          Nothing is silently substituted.
        </p>

        <div className={styles.ladder} data-testid="methodology-grade-ladder">
          {LADDER.map(([letter, range]) => (
            <div key={letter} className={styles.ladderRow}>
              <span className={styles.ladderLetter}>{letter}</span>
              <span className={`${styles.ladderRange} t-num`}>{range}</span>
            </div>
          ))}
        </div>

        <p className={styles.body}>
          <strong>Cadence.</strong> The grade is recomputed on every view from live
          inputs, and one grade per upcoming reporter is persisted each weekday after
          the close — that stored record is what we are held to, not a number that can
          be quietly restated later. The letter is assigned from the displayed score
          (rounded to one decimal), so the grade you see always matches the number you see.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="m-rating">
        <h2 className={styles.h2} id="m-rating">UCT Rating</h2>
        <p className={styles.body}>
          A 0–99 composite of seven components — EPS, relative strength, growth, value,
          SMR, accumulation/distribution and sponsorship. Components are scored against
          fixed thresholds, so a score answers "does this stock clear our bar?", not
          "where does it rank today". The basis is stated on the rating itself and will
          change to a ranked percentile when that job lands; scores may shift at that
          cutover and the page will say so.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="m-move">
        <h2 className={styles.h2} id="m-move">Expected move and realized move</h2>
        <p className={styles.body}>
          The implied move is the at-the-money straddle on the first listed expiry on or
          after the report date, quoted with that horizon ("through Fri Aug 8"). The
          realized comparison is close-to-close over the same span — never a
          straddle-to-expiry number compared against a next-day one. Historical implied
          values are captured after the close on the day before each report, so they are
          pre-report reads, not post-print IV-crushed ones. Coverage is stated on the
          chart itself ("Implied tracking since 2026-08 · n/8 recorded"), and that count
          is stored snapshots only.
        </p>
      </section>

      <p className={styles.notAdvice} data-testid="methodology-not-advice">{NOT_ADVICE}</p>
    </div>
  )
}

import useRatings from '../hooks/useRatings'
import ResearchLoading from '../ResearchLoading'
import styles from '../ResearchPage.module.css'
import UIcon from '../../../components/ui/UIcon'
import { CoverageNote } from '../../../components/research-kit'
import { ABSENT } from '../../../lib/presentation/presentationPrimitives'

const NUM_COMPONENTS = [
  ['eps', 'EPS Strength'],
  ['rs', 'Relative Strength'],
  ['growth', 'Growth'],
  ['value', 'Value'],
]
const LETTER_COMPONENTS = [
  ['smr', 'SMR'],
  ['accdis', 'Acc / Dis'],
  ['sponsorship', 'Sponsorship'],
]

// Composite + sub-score inks come from the --score-* ladder in tokens.css (one
// ladder, one home), applied through ResearchPage.module.css's .score* / .fill*
// classes. Never a hex here: a hex cannot follow the member's app theme.
function scoreTier(v) {
  if (v == null) return 'None'
  if (v >= 80) return 'Elite'
  if (v >= 60) return 'Strong'
  if (v >= 40) return 'Neutral'
  if (v >= 20) return 'Weak'
  return 'Poor'
}
function letterTier(l) {
  if (!l) return 'None'
  if (l === 'A') return 'Elite'
  if (l === 'B') return 'Strong'
  if (l === 'C') return 'Neutral'
  if (l === 'D') return 'Weak'
  return 'Poor'
}
const ink = (tier) => styles[`score${tier}`]
const fill = (tier) => styles[`fill${tier}`]
function checkTier(s) {
  return s === 'pass' ? 'Elite' : s === 'fail' ? 'Poor' : 'None'
}

export default function RatingsTab({ sym }) {
  const { data, isLoading, error, mutate } = useRatings(sym)

  if (isLoading) {
    return <ResearchLoading label="Computing UCT ratings" />
  }

  // TERM-088 -- a failed read is not a genuinely empty rating. Render the
  // error distinctly so a backend hiccup never reads as "no ratings exist".
  if (error) {
    return (
      <div className={styles.fnote} data-testid="ratings-error">
        Couldn't load ratings for this ticker.
        {' '}
        <button type="button" className={styles.basisBtn} onClick={() => mutate()}>Retry</button>
      </div>
    )
  }

  const r = data || {}
  const comp = r.components || {}
  const checkup = r.checkup || []
  // tq-panels: a fund gets no UCT Composite (it has no earnings, margins or sponsorship).
  if (r.not_applicable) {
    return <div className={styles.fnote} data-testid="ratings-na">Not applicable to funds — {r.reason || `${sym} is a fund`}.</div>
  }
  // tq-panels: this branch used to test `!Object.keys(comp).length`, but the server
  // always sends all seven component keys (null when unmeasured), so it could never
  // fire and an all-blank rating rendered as a grid of dashes. Test the VALUES.
  const SYM = (sym || '').toUpperCase()
  if (r.composite == null && Object.values(comp).every((v) => v == null)) {
    if (r.complete === false) {
      return (
        <div className={styles.fnote} data-testid="ratings-error">
          Couldn't read the inputs for {SYM}'s rating — no component could be measured.
          {' '}
          <button type="button" className={styles.basisBtn} onClick={() => mutate()}>Retry</button>
        </div>
      )
    }
    return <div className={styles.fnote} data-testid="ratings-empty">No rating inputs on file for {SYM} — none of the seven components could be measured.</div>
  }

  return (
    <div className={styles.finWrap}>
      {r.entity && r.entity.status !== 'resolved' && (
        <div className={styles.entityNote} data-testid="entity-unresolved-note">
          This symbol is not yet linked to a company record, so some sources below may not match it.
        </div>
      )}

      <section className={styles.card}>
        <div className={styles.compHero}>
          <div className={`${styles.compNum} ${ink(scoreTier(r.composite))}`}>{r.composite ?? ABSENT}</div>
          <div>
            <div className={`${styles.ct} ${styles.compLabel}`}>UCT Composite Rating</div>
            <div className={styles.compSub}>0–99 · higher is stronger</div>
            <CoverageNote coverage={r.coverage} />
          </div>
        </div>

        <div className={styles.ratingGrid}>
          {NUM_COMPONENTS.map(([k, label]) => (
            <div key={k} className={styles.ratingCard}>
              <div className={styles.ratingLbl}>{label}</div>
              <div className={`${styles.ratingVal} ${ink(scoreTier(comp[k]))}`}>{comp[k] ?? ABSENT}</div>
              <div className={styles.meter}>
                <div className={`${styles.meterFill} ${fill(scoreTier(comp[k]))}`} style={{ width: `${comp[k] ?? 0}%` }} />
              </div>
            </div>
          ))}
          {LETTER_COMPONENTS.map(([k, label]) => (
            <div key={k} className={styles.ratingCard}>
              <div className={styles.ratingLbl}>{label}</div>
              <div className={`${styles.ratingVal} ${ink(letterTier(comp[k]))}`}>{comp[k] ?? ABSENT}</div>
            </div>
          ))}
        </div>
      </section>

      {!!checkup.length && (
        <section className={styles.card}>
          <div className={styles.ct}>Stock Checkup</div>
          {checkup.map((c, i) => (
            <div key={`${c.label}-${i}`} className={styles.checkRow}>
              <span className={`${styles.checkIcon} ${ink(checkTier(c.status))}`}>
                {c.status === 'pass' ? <UIcon name="check" size={13} gold={false} />
                  : c.status === 'fail' ? <UIcon name="x" size={13} gold={false} /> : ABSENT}
              </span>
              <span>{c.label}</span>
              <span className={styles.muted}>{c.value}</span>
            </div>
          ))}
        </section>
      )}

      {r.method && (
        <div className={styles.fnote}>
          {r.method}
          {/* UCT-derived, never a provider badge — this composite draws on
              fundamentals + ownership (periodic, filing-based) + price
              history (near-daily); the price leg's own last-bar date is the
              one concrete as-of currently available. */}
          {r.price_as_of && <span> · price data as of {r.price_as_of}</span>}
        </div>
      )}
    </div>
  )
}

import useRatings from '../hooks/useRatings'
import ResearchLoading from '../ResearchLoading'
import styles from '../ResearchPage.module.css'
import UIcon from '../../../components/ui/UIcon'
import { CoverageNote } from '../../../components/research-kit'
import { ABSENT } from '../../../lib/presentation/presentationPrimitives'
import { usePanelFreshness } from '../../../components/terminal/terminalPanel'

const NUM_COMPONENTS = [
  ['eps', 'EPS Strength'],
  ['rs', 'Relative Strength'],
  ['growth', 'Growth'],
  ['value', 'Value'],
]
// Audit 2026-10-08 (RTG #20): "SMR" and "Acc / Dis" were shown with no explanation. Each
// letter card now says in plain words what it grades (ratings.py `_smr`, `_accdis_ratio`).
const LETTER_COMPONENTS = [
  ['smr', 'SMR', 'Sales growth, profit margin and return on equity. A is best, E is weakest.'],
  ['accdis', 'Acc / Dis', 'Accumulation / distribution: volume on up days against down days over the last 13 weeks. A means heavy buying, E heavy selling.'],
  ['sponsorship', 'Sponsorship', 'How much of the stock institutions own. A is the most.'],
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
  const { data, isLoading, error, paywalled, mutate } = useRatings(sym)
  // TERM-019: name this panel's source (and its as-of) in the terminal panel header; a no-op elsewhere.
  // UCT computes the composite itself; its one concrete as-of is the price leg's last bar.
  usePanelFreshness(data && !error && !data.not_applicable
    ? { source: 'UCT ratings (computed from fundamentals, ownership and price)', age: { dataClass: 'end_of_day', asOfDate: data.price_as_of || null } }
    : null)

  if (isLoading) {
    return <ResearchLoading label="Computing UCT ratings" />
  }

  // TERM-088 -- a failed read is not a genuinely empty rating. Render the
  // error distinctly so a backend hiccup never reads as "no ratings exist".
  if (paywalled) {
    return <div className={styles.fnote} data-testid="ratings-paywalled">The UCT rating requires a paid plan.</div>
  }
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
    return <div className={styles.fnote} data-testid="ratings-na">Not applicable to funds: {r.reason || `${sym} is a fund`}.</div>
  }
  // tq-panels: this branch used to test `!Object.keys(comp).length`, but the server
  // always sends all seven component keys (null when unmeasured), so it could never
  // fire and an all-blank rating rendered as a grid of dashes. Test the VALUES.
  const SYM = (sym || '').toUpperCase()
  if (r.composite == null && Object.values(comp).every((v) => v == null)) {
    if (r.complete === false) {
      return (
        <div className={styles.fnote} data-testid="ratings-error">
          Couldn't read the inputs for {SYM}'s rating: no component could be measured.
          {' '}
          <button type="button" className={styles.basisBtn} onClick={() => mutate()}>Retry</button>
        </div>
      )
    }
    return <div className={styles.fnote} data-testid="ratings-empty">No rating inputs on file for {SYM}: none of the seven components could be measured.</div>
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

        <div className={styles.ratingGrid} data-panel-tiles>
          {NUM_COMPONENTS.map(([k, label]) => (
            <div key={k} className={styles.ratingCard} data-panel-tile>
              <div className={styles.ratingLbl}>{label}</div>
              <div className={`${styles.ratingVal} ${ink(scoreTier(comp[k]))}`}>{comp[k] ?? ABSENT}</div>
              {/* Audit 2026-10-08 (RTG #26): the bar is a meter to assistive tech too. */}
              <div className={styles.meter} role="meter" aria-label={`${label}, 0 to 99`}
                aria-valuemin={0} aria-valuemax={99} aria-valuenow={comp[k] ?? undefined}
                aria-valuetext={comp[k] == null ? 'not measured' : `${comp[k]} of 99`}>
                <div className={`${styles.meterFill} ${fill(scoreTier(comp[k]))}`} style={{ width: `${comp[k] ?? 0}%` }} />
              </div>
            </div>
          ))}
          {LETTER_COMPONENTS.map(([k, label, hint]) => (
            <div key={k} className={styles.ratingCard} data-panel-tile>
              <div className={styles.ratingLbl}>{label}</div>
              <div className={`${styles.ratingVal} ${ink(letterTier(comp[k]))}`}
                aria-describedby={`rating-hint-${k}`}>{comp[k] ?? ABSENT}</div>
              <div className={styles.ratingHint} id={`rating-hint-${k}`} data-testid={`rating-hint-${k}`}>{hint}</div>
            </div>
          ))}
        </div>
      </section>

      {!!checkup.length && (
        <section className={styles.card}>
          <div className={styles.ct}>Stock Checkup</div>
          {checkup.map((c, i) => (
            <div key={`${c.label}-${i}`} className={styles.checkRow} data-panel-row>
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

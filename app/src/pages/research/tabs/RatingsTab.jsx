import useRatings from '../hooks/useRatings'
import styles from '../ResearchPage.module.css'

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

function scoreColor(v) {
  if (v == null) return 'var(--text-muted)'
  if (v >= 80) return '#3cb868'
  if (v >= 60) return '#7fb84e'
  if (v >= 40) return '#c9a84c'
  if (v >= 20) return '#e08a3c'
  return '#e74c3c'
}
function letterColor(l) {
  if (!l) return 'var(--text-muted)'
  if (l === 'A') return '#3cb868'
  if (l === 'B') return '#7fb84e'
  if (l === 'C') return '#c9a84c'
  if (l === 'D') return '#e08a3c'
  return '#e74c3c'
}
function checkColor(s) {
  return s === 'pass' ? '#3cb868' : s === 'fail' ? '#e74c3c' : 'var(--text-muted)'
}

export default function RatingsTab({ sym }) {
  const { data, isLoading } = useRatings(sym)

  if (isLoading) {
    return <div className={styles.soon}><div className={styles.soonInner}><div className={styles.soonSub}>Computing UCT ratings…</div></div></div>
  }

  const r = data || {}
  const comp = r.components || {}
  const checkup = r.checkup || []
  if (r.composite == null && !Object.keys(comp).length) {
    return <div className={styles.fnote}>Ratings are unavailable for this ticker.</div>
  }

  return (
    <div className={styles.finWrap}>
      <section className={styles.card}>
        <div className={styles.compHero}>
          <div className={styles.compNum} style={{ color: scoreColor(r.composite) }}>{r.composite ?? '—'}</div>
          <div>
            <div className={styles.ct} style={{ marginBottom: 2 }}>UCT Composite Rating</div>
            <div className={styles.muted} style={{ fontSize: 12 }}>0–99 · higher is stronger</div>
          </div>
        </div>

        <div className={styles.ratingGrid}>
          {NUM_COMPONENTS.map(([k, label]) => (
            <div key={k} className={styles.ratingCard}>
              <div className={styles.ratingLbl}>{label}</div>
              <div className={styles.ratingVal} style={{ color: scoreColor(comp[k]) }}>{comp[k] ?? '—'}</div>
              <div className={styles.meter}>
                <div className={styles.meterFill} style={{ width: `${comp[k] ?? 0}%`, background: scoreColor(comp[k]) }} />
              </div>
            </div>
          ))}
          {LETTER_COMPONENTS.map(([k, label]) => (
            <div key={k} className={styles.ratingCard}>
              <div className={styles.ratingLbl}>{label}</div>
              <div className={styles.ratingVal} style={{ color: letterColor(comp[k]) }}>{comp[k] ?? '—'}</div>
            </div>
          ))}
        </div>
      </section>

      {!!checkup.length && (
        <section className={styles.card}>
          <div className={styles.ct}>Stock Checkup</div>
          {checkup.map((c, i) => (
            <div key={`${c.label}-${i}`} className={styles.checkRow}>
              <span className={styles.checkIcon} style={{ color: checkColor(c.status) }}>
                {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : '–'}
              </span>
              <span>{c.label}</span>
              <span className={styles.muted}>{c.value}</span>
            </div>
          ))}
        </section>
      )}

      {r.method && <div className={styles.fnote}>{r.method}</div>}
    </div>
  )
}

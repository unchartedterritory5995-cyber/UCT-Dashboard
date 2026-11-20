import { historyModel, fmtMove } from './readingModel'
import styles from './Reading.module.css'

const Info = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 7.2v4M8 4.8v.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const pctOf = (x) => (Number.isFinite(x) ? `${Math.round(x)}%` : '—')
const nOf = (x) => (Number.isFinite(x) ? x.toLocaleString('en-US') : '—')

// "What the S&P did next": the similar days' outcome ALWAYS beside the same numbers over every
// session (the baseline), so the reader can see whether this reading's outcome differs from an
// ordinary day's. A typical reading shows only the baseline, under one line that says so.
function NextTable({ m }) {
  const typical = m.state === 'typical'
  const head = (
    <>
      <span className={styles.fwdHead} />
      <span className={styles.fwdHead}>+5 sessions</span>
      <span className={styles.fwdHead}>+20</span>
      <span className={styles.fwdHead}>+60</span>
    </>
  )
  if (typical) {
    return (
      <div className={styles.fwd} data-testid="fwd-baseline">
        {head}
        <span>Median, all days</span>
        {m.baseline.map((b, i) => <span key={i} className={styles.fwdVal}>{fmtMove(b.median)}</span>)}
        <span>Higher, all days</span>
        {m.baseline.map((b, i) => <span key={i}>{pctOf(b.higher)}</span>)}
        <span>Days (n)</span>
        {m.baseline.map((b, i) => <span key={i} className={styles.fwdN}>{nOf(b.n)}</span>)}
      </div>
    )
  }
  return (
    <div className={styles.fwd} data-small={m.small || undefined} data-testid="fwd-similar">
      {head}
      <span>Median move</span>
      {m.similar.map((b, i) => <span key={i} className={styles.fwdVal}>{fmtMove(b.median)}</span>)}
      <span className={styles.fwdBase}>all days</span>
      {m.baseline.map((b, i) => <span key={i} className={styles.fwdBase}>{fmtMove(b.median)}</span>)}
      <span>Higher after</span>
      {m.similar.map((b, i) => <span key={i} className={styles.fwdVal}>{pctOf(b.higher)}</span>)}
      <span className={styles.fwdBase}>all days</span>
      {m.baseline.map((b, i) => <span key={i} className={styles.fwdBase}>{pctOf(b.higher)}</span>)}
      <span>Similar days (n)</span>
      {m.similar.map((b, i) => <span key={i} className={styles.fwdN}>{nOf(b.n)}</span>)}
    </div>
  )
}

/**
 * The History content: what the S&P did next, similar past days, context.
 * `layout` 'stack' (the drawer) or 'row' (the reading-only window's body).
 */
export default function HistoryPanel({ reading, loading = false, error = null, fmt = String, layout = 'stack', onPickDate = null }) {
  if (!reading) {
    return (
      <div className={styles.status} role="status">
        {loading ? 'Loading the history of this reading…'
          : error ? 'The history of this reading did not load.'
            : 'No history to rank this reading against yet.'}
      </div>
    )
  }
  const m = historyModel(reading, fmt)
  const typical = m.state === 'typical'
  return (
    <div className={styles.panel} data-layout={layout} data-state={m.state} data-testid="history-panel">
      <section className={styles.card} aria-label="What the S&P 500 did next">
        <div className={styles.cardHead}>
          <b>What the S&amp;P 500 did next</b>
          <span>{typical ? `Every session since ${m.year}` : m.basis}</span>
        </div>
        {typical && <span className={styles.typicalBanner} data-testid="typical-note">{m.typicalNote}</span>}
        <NextTable m={m} />
        {!typical && m.small && (
          <span className={styles.note} data-testid="small-n"><Info /><span>{m.smallNote}</span></span>
        )}
        <span className={styles.foot}>History, not a forecast. {m.seriesBasis}.</span>
      </section>

      {!typical && (
        <section className={styles.card} aria-label="Similar past days">
          <div className={styles.cardHead}>
            <b>Similar past days</b>
            <span>The 5 closest readings. Click one to open that day.</span>
          </div>
          <div className={styles.sim}>
            {m.closest.map(c => (
              <button key={c.date} type="button" className={styles.simRow} data-date={c.date}
                onClick={onPickDate ? () => onPickDate(c.date) : undefined} disabled={!onPickDate}>
                <b>{c.label}</b>
                <span className={styles.simVal}>{c.value}</span>
                <span className={styles.simNext}>S&amp;P +20: <em>{c.next}</em></span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className={styles.card} aria-label="Context">
        <div className={styles.cardHead}>
          <b>Context</b>
          <span>This column, around this day.</span>
        </div>
        <div className={styles.ctx}>
          {m.vsAvg && (
            <div className={styles.ctxRow}>
              <span>vs its 20-day average</span>
              <span><b>{m.vsAvg.head}</b> <small>{m.vsAvg.detail}</small></span>
            </div>
          )}
          {m.streak && (
            <div className={styles.ctxRow}><span>Streak</span><span><b>{m.streak}</b></span></div>
          )}
          {!typical && (
            <div className={styles.ctxRow}><span>Last this {reading.side === 'high' ? 'high' : 'low'}</span><span>{m.last}</span></div>
          )}
          <div className={styles.ctxRow}><span>Rank basis</span><span><small>{m.rankBasis}</small></span></div>
        </div>
      </section>
    </div>
  )
}

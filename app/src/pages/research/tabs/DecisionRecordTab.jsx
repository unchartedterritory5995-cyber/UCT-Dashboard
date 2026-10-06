import useDecisionRecord from '../hooks/useDecisionRecord'
import Provenance from '../../../components/provenance/Provenance'
import { PROVIDER_ERROR } from '../../../components/provenance/availabilityContract'
import styles from '../ResearchPage.module.css'
import { stageText, dropReasonText } from './decisionRecordCopy'

// TERM-088 (item 15 ACC-02) -- "the decision record gets a member surface".
//
// What UCT's Morning Wire CONSIDERED about this ticker, issue by issue, and
// where each rejection happened -- beside the issues it passed. The store is
// the engine's own `wire_universe` x `wire_issues`, read read-only by
// `api/services/decision_record.py`. Ships DARK (DECISION_RECORD_MEMBER_ENABLED).
//
// ⛔ FOUR ANSWERS, NEVER COLLAPSED: `considered` (rows), `not_considered` (the
// record holds issues and none of them named this ticker), `empty_record` (the
// record holds nothing yet), and UNAVAILABLE -- a failed request or a store the
// server could not read. An unavailable record is never rendered as "not
// considered": a layer that could not be read is not a layer that is empty.
//
// ⛔ EVERY FIGURE IS DERIVED by the server and wrapped in the S8 <Provenance>
// primitive. No count is typed here, and no rate is computed -- 60 issues is a
// young record and a percentage off it would imply a depth it does not have.
//
// ⛔ Never FreshnessBadge: each row is a historical record whose only honest
// "as of" is its own issue, not a live value going stale (same reasoning as
// CatalystsTab).

const SOURCE_NAME = 'UCT Morning Wire decision record'

function sourceLine(source, extra) {
  const pack = source && source.pack_installed_at ? ` · Brain Pack installed ${source.pack_installed_at}` : ''
  // the engine's table names are internal detail, not member copy
  return `${SOURCE_NAME}${extra ? ` · ${extra}` : ''}${pack}`
}

function Figure({ value, source, calc }) {
  return (
    <Provenance
      value={value}
      provenance={{ sourceActivity: sourceLine(source), timestamp: null, tieBreak: null }}
      calcVersion={calc}
      density="ondemand"
    />
  )
}

function depthText(months) {
  if (!Number.isFinite(months) || months < 1) return 'The depth is less than a month, not years.'
  const unit = months === 1 ? 'month' : 'months'
  return `The depth is ${months} ${unit}, not ${months} ${months === 1 ? 'year' : 'years'}.`
}

function CoverageCaveat({ coverage, source }) {
  if (!coverage || !coverage.issues_held) return null
  const { issues_held: held, first_issue: first, last_issue: last, weekdays_in_span: wd, span_months: months } = coverage
  return (
    <section className={styles.card} data-testid="decision-record-coverage">
      <div className={styles.ct}>How deep this record goes</div>
      <p className={styles.fnote}>
        <Figure
          value={`${held} issues spanning ${first} → ${last}`}
          source={source}
          calc="counted from the record at request time"
        />
        {' '}is a young record: that span holds roughly {wd} weekdays, so the archive is not every session.
        {' '}{depthText(months)}
      </p>
    </section>
  )
}

function SafetyNote() {
  return (
    <p className={styles.fnote} data-testid="decision-record-safety">
      This is UCT&rsquo;s own decision record &mdash; what the desk&rsquo;s Morning Wire looked at and
      passed on, not a member&rsquo;s trades and not a recommendation. A name dropped on a date says
      only that it did not clear that morning&rsquo;s process.
    </p>
  )
}

function Unavailable() {
  return (
    <div className={styles.finWrap}>
      <section className={styles.card} data-testid="decision-record-unavailable">
        <div className={styles.ct}>Decision record</div>
        <Provenance value="Decision record" availability={PROVIDER_ERROR} />
        <p className={styles.fnote}>
          The decision record could not be read right now. That is not
          the same as this name never having been considered &mdash; nothing is being said about it.
        </p>
      </section>
    </div>
  )
}

export default function DecisionRecordTab({ sym }) {
  const { result, isLoading } = useDecisionRecord(sym)

  if (isLoading) {
    return (
      <div className={styles.soon} data-testid="decision-record-loading">
        <div className={styles.soonInner}><div className={styles.soonSub}>Loading the decision record…</div></div>
      </div>
    )
  }

  // tq-panels: a 402 is the paid gate, not "unavailable".
  if (result && !result.ok && result.httpStatus === 402) {
    return <div className={styles.fnote} data-testid="decision-record-paywalled">The decision record requires a paid plan.</div>
  }
  if (!result || !result.ok || !result.body) return <Unavailable />
  const body = result.body
  if (body.status === 'unavailable') return <Unavailable />

  const { rows = [], counts, coverage, source, paging, entity } = body
  const ticker = body.ticker || (sym || '').toUpperCase()

  if (body.status === 'empty_record') {
    return (
      <div className={styles.finWrap}>
        <section className={styles.card} data-testid="decision-record-empty">
          <div className={styles.ct}>Decision record</div>
          <p className={styles.fnote}>The decision record holds no Morning Wire issues yet, so there is nothing to show for {ticker}.</p>
        </section>
        <SafetyNote />
      </div>
    )
  }

  if (body.status === 'not_considered') {
    return (
      <div className={styles.finWrap}>
        <section className={styles.card} data-testid="decision-record-not-considered">
          <div className={styles.ct}>Decision record</div>
          <p className={styles.fnote}>
            <strong>Not considered.</strong> {ticker} does not appear in any of the{' '}
            {coverage && coverage.issues_held} Morning Wire issues this record holds
            {coverage && coverage.first_issue ? ` (${coverage.first_issue} → ${coverage.last_issue})` : ''}.
            It was never looked at and passed on &mdash; it was not on the list at all.
          </p>
        </section>
        <CoverageCaveat coverage={coverage} source={source} />
        <SafetyNote />
      </div>
    )
  }

  const total = paging && Number.isFinite(paging.total_rows) ? paging.total_rows : rows.length

  return (
    <div className={styles.finWrap}>
      <section className={styles.card}>
        <div className={styles.ct}>What the Morning Wire looked at, and where {ticker} died</div>
        {counts && (
          <p className={styles.fnote} data-testid="decision-record-counts">
            Considered in{' '}
            <Figure value={`${counts.issues_considered} issues`} source={source} calc="counted from the record at request time" />
            ; passed every stage in{' '}
            <Figure value={`${counts.issues_passed}`} source={source} calc="counted from the record at request time" />
            ; dropped in{' '}
            <Figure value={`${counts.issues_dropped}`} source={source} calc="counted from the record at request time" />.
          </p>
        )}
        {entity && entity.enabled && entity.distinct_entities > 1 && (
          <p className={styles.fnote} data-testid="decision-record-entity-note">
            This ticker belonged to {entity.distinct_entities} different companies across these issues; each row
            refers to whichever company held it on that date.
          </p>
        )}
        <ul className={styles.newsList} data-testid="decision-record-list">
          {rows.map((r, i) => (
            <li key={`${r.issue_id}-${i}`} className={styles.newsItem} data-testid="decision-record-row">
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={r.outcome === 'passed' ? styles.up : styles.gold}>
                    <Provenance
                      value={stageText(r)}
                      provenance={{ sourceActivity: sourceLine(source, `issue ${r.issue_id}`), timestamp: null, tieBreak: null }}
                      calcVersion={r.sent_at ? `issue sent ${r.sent_at}` : null}
                      density="ondemand"
                    />
                  </span>
                  <span className={styles.muted}>Issue {r.issue_id}</span>
                  {r.is_exploration ? <span className={styles.muted}>exploration pick</span> : null}
                </div>
                {dropReasonText(r.drop_reason) ? <p className={styles.fnote} style={{ padding: '4px 0 0' }} data-testid="decision-record-reason">{dropReasonText(r.drop_reason)}</p> : null}
              </div>
            </li>
          ))}
        </ul>
        {total > rows.length && (
          <p className={styles.fnote} data-testid="decision-record-paging">
            Showing {rows.length} of {total} recorded rows, newest issue first.
          </p>
        )}
      </section>
      <CoverageCaveat coverage={coverage} source={source} />
      <SafetyNote />
    </div>
  )
}

export { stageText }

import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import styles from './ResearchCov.module.css'
import { formatCompact } from '../../../lib/presentation/presentationPrimitives'
import { memberText } from '../../../lib/presentation/memberCopy'
import { usePendingReask } from '../depth/depthFetch'
import PendingGaveUp from '../depth/PendingGaveUp'

// COV-05 (roadmap RM-L19) — who runs this company: officers and key executives,
// the proxy's compensation table, and the role each insider declares on Form 4.
// DARK behind RESEARCH_PEOPLE_ENABLED.
//
// ⛔ Every row names its source and date. A value the source did not give is the
//    word "unavailable" with the reason beside it, never an empty cell.
// ⛔ A section that could not be read says so; it is never an empty table that
//    reads as "this company has no officers".

const money = (v, cur) => {
  if (v == null) return null
  const s = formatCompact(Number(v), { tiers: [{ at: 1e6, suffix: 'M', decimals: 2 }, { at: 1e3, suffix: 'K', decimals: 0 }] })
  return `${cur && cur !== 'USD' ? `${cur} ` : '$'}${s}`
}

// Member copy for a section with no rows. `not_found` is the vendor holding nothing for the
// symbol (every fund/ETF reads this: no officer list, no proxy pay table), said plainly; a
// read that failed says so and is not a finding. Never the vendor endpoint path (live sweep
// 2026-10-05: "Unavailable: FMP returned no rows for this symbol. (FMP /stable/key-executives)").
function Gap({ part, testid, what, sym }) {
  const text = part?.state === 'not_found'
    ? `No ${what} for ${sym}.`
    : `${what[0].toUpperCase()}${what.slice(1)} could not be read right now. That is a gap in what we could read, not a finding about ${sym}.`
  return <div className={styles.gap} data-testid={testid}>{text}</div>
}

function Executives({ part, sym }) {
  if (!part?.rows) return <Gap part={part} testid="people-execs-unavailable" what="officer records" sym={sym} />
  return (
    <div className={styles.scroll}>
      <table className={styles.grid} data-testid="people-execs">
        <thead><tr>
          <th scope="col">Name</th><th scope="col">Title</th><th scope="col">Since</th>
          <th scope="col">Pay (FMP)</th><th scope="col">Proxy total</th><th scope="col">Form 4 role</th>
        </tr></thead>
        <tbody>
          {part.rows.map((e) => (
            <tr key={e.name} data-testid={`exec-${e.name}`}>
              <td>{e.name}</td>
              <td>{e.title || 'unavailable'}</td>
              <td>{e.since || <span className={styles.gap} title={e.unavailable?.since}>unavailable</span>}</td>
              <td className={styles.num}>
                {e.pay != null
                  ? <span title={e.pay_note}>{money(e.pay, e.pay_currency)}*</span>
                  : <span className={styles.gap} title={e.unavailable?.pay}>unavailable</span>}
              </td>
              <td className={styles.num}>
                {e.comp_total != null
                  ? `${money(e.comp_total)} (${e.comp_year})`
                  : <span className={styles.gap} title="no matching row in the proxy's compensation table">not in proxy table</span>}
              </td>
              <td>{e.insider_role || <span className={styles.gap}>no Form 4 match</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.muted} data-testid="people-execs-source">
        Source: {memberText(part.source)}, read {part.as_of}. "Since" is unavailable where FMP reports no start date.
        * FMP does not state which year a pay figure covers.
      </div>
    </div>
  )
}

function Compensation({ part, sym }) {
  if (!part?.rows) return <Gap part={part} testid="people-comp-unavailable" what="proxy compensation records" sym={sym} />
  return (
    <div className={styles.scroll}>
      <table className={styles.grid} data-testid="people-comp">
        <thead><tr>
          <th scope="col">Name and position</th><th scope="col" className={styles.num}>Salary</th>
          <th scope="col" className={styles.num}>Stock awards</th><th scope="col" className={styles.num}>Incentive</th>
          <th scope="col" className={styles.num}>Total</th><th scope="col">Filed</th>
        </tr></thead>
        <tbody>
          {part.rows.map((r, i) => (
            <tr key={`${r.name_and_position}-${i}`}>
              <td>{r.name_and_position}</td>
              <td className={styles.num}>{money(r.salary) ?? 'unavailable'}</td>
              <td className={styles.num}>{money(r.stock_award) ?? 'unavailable'}</td>
              <td className={styles.num}>{money(r.incentive) ?? 'unavailable'}</td>
              <td className={styles.num}>{money(r.total) ?? 'unavailable'}</td>
              <td>{r.url
                ? <a className={styles.link} href={r.url} target="_blank" rel="noopener noreferrer">{r.filing_date || 'filing'}</a>
                : (r.filing_date || 'unavailable')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.muted} data-testid="people-comp-source">
        Fiscal {part.year}. Source: {memberText(part.source)}, read {part.as_of}; each row links to its SEC filing.
      </div>
    </div>
  )
}

function InsiderRoles({ part, sym }) {
  if (!part?.rows || part.rows.length === 0) {
    let text
    if (part?.state === 'pending') text = 'Reading the Form 4 filings for this company now. This section updates by itself.'
    else if (part?.state === 'none_in_window') text = `No Form 4 filed for ${sym} in the last ${part.window_days} days (SEC EDGAR).`
    else if (part?.state === 'not_found') text = `No SEC filer could be matched to ${sym}.`
    else text = `Insider roles: unavailable right now (${memberText(part?.reason) || 'SEC EDGAR could not be read'}). That is a gap in what we could read, not a finding about ${sym}.`
    return <div className={styles.gap} data-testid="people-roles-gap">{text}</div>
  }
  return (
    <div className={styles.scroll}>
      <table className={styles.grid} data-testid="people-roles">
        <thead><tr><th scope="col">Reporting owner</th><th scope="col">Declared role</th><th scope="col">Latest Form 4</th></tr></thead>
        <tbody>
          {part.rows.map((r) => (
            <tr key={r.cik || r.name}>
              <td>{r.name}</td>
              <td>{r.role}</td>
              <td>{r.url
                ? <a className={styles.link} href={r.url} target="_blank" rel="noopener noreferrer">{r.filing_date} · {r.accession}</a>
                : `${r.filing_date} · ${r.accession}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.muted} data-testid="people-roles-source">
        Source: {memberText(part.source)}, filings since {part.since} ({part.window_days} days).{part.reason ? ` Partial: ${memberText(part.reason)}.` : ''}
      </div>
    </div>
  )
}

export default function PeopleTab({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const key = s ? `/api/research/people/${encodeURIComponent(s)}` : null
  const { data, error, mutate } = useSWR(key, sectionFetcher, { revalidateOnFocus: false })
  // The Form 4 half answers `pending` while its read is queued; ask again by itself.
  const reask = usePendingReask(data?.insider_roles?.state === 'pending', mutate, key)

  if (error) {
    return <div className={styles.note} data-testid="people-unavailable">
      People data is unavailable right now. That is a gap in what we could read, not a finding about {s}.
    </div>
  }
  if (!data) return <div className={styles.note}>Loading people…</div>
  if (data.paywalled) return <div className={styles.note}>People requires a paid plan.</div>

  return (
    <section className={styles.section} data-testid="people">
      <div className={styles.card}><h3 className={styles.title}>Officers and key executives</h3><Executives part={data.executives} sym={s} /></div>
      <div className={styles.card}><h3 className={styles.title}>Compensation (proxy summary table)</h3><Compensation part={data.compensation} sym={s} /></div>
      <div className={styles.card}><h3 className={styles.title}>Insider roles (SEC Form 4)</h3><InsiderRoles part={data.insider_roles} sym={s} />
        <PendingGaveUp exhausted={reask.exhausted} onRetry={reask.retry} what="The Form 4 read" /></div>
    </section>
  )
}

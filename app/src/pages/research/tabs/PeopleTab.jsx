import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import styles from './ResearchCov.module.css'

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
  const n = Number(v)
  const s = n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n)
  return `${cur && cur !== 'USD' ? `${cur} ` : '$'}${s}`
}

function Gap({ part, testid }) {
  return (
    <div className={styles.gap} data-testid={testid}>
      Unavailable: {part?.reason || 'the source could not be read'}. ({part?.source})
    </div>
  )
}

function Executives({ part }) {
  if (!part?.rows) return <Gap part={part} testid="people-execs-unavailable" />
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
        Source: {part.source}, read {part.as_of}. "Since" is unavailable where FMP reports no start date.
        * FMP does not state which year a pay figure covers.
      </div>
    </div>
  )
}

function Compensation({ part }) {
  if (!part?.rows) return <Gap part={part} testid="people-comp-unavailable" />
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
        Fiscal {part.year}. Source: {part.source}, read {part.as_of}; each row links to its SEC filing.
      </div>
    </div>
  )
}

function InsiderRoles({ part }) {
  if (!part?.rows || part.rows.length === 0) {
    return <div className={styles.gap} data-testid="people-roles-gap">
      {part?.state === 'none_in_window' ? 'None in window' : 'Unavailable'}: {part?.reason}. ({part?.source})
    </div>
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
        Source: {part.source}, filings since {part.since} ({part.window_days} days).{part.reason ? ` Partial: ${part.reason}.` : ''}
      </div>
    </div>
  )
}

export default function PeopleTab({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, error } = useSWR(s ? `/api/research/people/${encodeURIComponent(s)}` : null,
    sectionFetcher, { revalidateOnFocus: false })

  if (error) {
    return <div className={styles.note} data-testid="people-unavailable">
      People data is unavailable right now. That is a gap in what we could read, not a finding about {s}.
    </div>
  }
  if (!data) return <div className={styles.note}>Loading people…</div>
  if (data.paywalled) return <div className={styles.note}>People requires a paid plan.</div>

  return (
    <section className={styles.section} data-testid="people">
      <div className={styles.card}><h3 className={styles.title}>Officers and key executives</h3><Executives part={data.executives} /></div>
      <div className={styles.card}><h3 className={styles.title}>Compensation (proxy summary table)</h3><Compensation part={data.compensation} /></div>
      <div className={styles.card}><h3 className={styles.title}>Insider roles (SEC Form 4)</h3><InsiderRoles part={data.insider_roles} /></div>
    </section>
  )
}

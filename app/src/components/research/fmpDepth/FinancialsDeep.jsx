// app/src/components/research/fmpDepth/FinancialsDeep.jsx
//
// FA on FMP (terminal gap audit, gap 3). The terminal's FA panel, and the
// /research Financials tab when RESEARCH_FMP_DEPTH_ENABLED is on.
//
//   FMP has statements  → source line · statement tables (income / balance /
//                          cash flow / ratios, 24q / 12y, fiscal labels) · the
//                          six statement panels the ERN modal already shows.
//   FMP answered empty  → the yfinance grids (FinancialsTab), labelled as the
//                          FALLBACK with the reason. Never silently.
//   the request FAILED  → "Could not load" with a retry — never "unavailable",
//                          which would be a claim about the company.
//
// One request decides which: the quarterly history key, which StatementTables
// and StatementPanels read too, so the decision costs nothing extra.
import useSWR from 'swr'
import { EmptyState } from '../../research-kit'
import { FETCH_FAILED, sectionFetcher } from '../sections/sectionFetch'
import { WARMING_UP, useWarming } from '../../../utils/warmRetry'
import StatementPanels from '../sections/StatementPanels'
import FinancialsTab from '../../../pages/research/tabs/FinancialsTab'
import StatementTables, { historyKey } from './StatementTables'
import SourceLine from './SourceLine'
import styles from './FmpDepth.module.css'

export default function FinancialsDeep({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, error, mutate } = useSWR(s ? historyKey(s, 'quarter') : null, sectionFetcher,
    { revalidateOnFocus: false, keepPreviousData: true })
  const warming = useWarming(s ? historyKey(s, 'quarter') : null)

  if (!s) return null
  if (error) {
    return (
      <div className={styles.wrap} data-testid="fa-deep">
        <EmptyState {...FETCH_FAILED} compact onRetry={() => mutate()} />
      </div>
    )
  }
  if (data === undefined) {
    return (
      <div className={styles.wrap} data-testid="fa-deep">
        {warming
          ? <p className={styles.note} data-testid="fa-warming">{WARMING_UP}</p>
          : <p className={styles.note}>Loading financials…</p>}
      </div>
    )
  }
  if (data?.paywalled) {
    return <div className={styles.wrap} data-testid="fa-deep"><p className={styles.note}>Financial statement history requires a paid plan.</p></div>
  }
  const hasFmp = (data?.periods || []).length > 0
  // tq-panels: the route marks a fund (`not_applicable: 'fund'` + `reason`, e910f8ff6);
  // say that instead of a generic "unavailable" that reads like a gap.
  if (!hasFmp && data?.not_applicable) {
    return <div className={styles.wrap} data-testid="fa-deep"><p className={styles.note} data-testid="fa-na">Not applicable to funds — {data.reason || `${s} is a fund`}.</p></div>
  }
  if (!hasFmp) {
    return (
      <div className={styles.wrap} data-testid="fa-deep" data-source="yfinance">
        <SourceLine vendor="Yahoo Finance" fallback
                    activity="yfinance quarterly_income_stmt / income_stmt"
                    reason={data?.fmp_unavailable
                      ? 'FMP statement history could not be read right now; showing yfinance (about 5 years / 5 quarters, calendar-quarter labels).'
                      : 'FMP holds no statement history for this ticker; showing yfinance (about 5 years / 5 quarters, calendar-quarter labels).'} />
        <FinancialsTab sym={s} />
      </div>
    )
  }
  const src = data.source || {}
  return (
    <div className={styles.wrap} data-testid="fa-deep" data-source="fmp">
      <SourceLine vendor="FMP"
                  activity={(src.endpoints || []).join(' · ') || 'FMP statements'}
                  fetchedAt={src.fetched_at}
                  detail="Fiscal periods · ratios derived from these statements" />
      <StatementTables sym={s} />
      <StatementPanels sym={s} />
    </div>
  )
}

// EE — earnings estimates, with what BRKE had folded in (owner decision 2026-10-08).
//
// A thin adapter. The consensus itself is the research page's own `ConsensusEstimates`, embedded
// as-is. What BRKE (broker estimates) showed that EE did not is the list of FIRMS ACTING on the
// stock (named rating actions). Contributor-level estimates were never available on this plan, so
// there is nothing else of BRKE's to carry. The firms list appears only when the broker-estimates
// read is switched on for the member AND it holds real rows: a failed, pending or empty read adds
// nothing under the consensus, rather than a second "unavailable" box.
//
// `BRKE` is now an alias of `EE` (functions.js CODE_ALIASES), so a saved board naming it opens this.
import { useContext } from 'react'
import useSWR from 'swr'
import ConsensusEstimates from '../../../components/research/fmpDepth/ConsensusEstimates'
import { AuthContext } from '../../../context/AuthContext'
import { depthFetcher } from '../../research/depth/depthFetch'
import { memberText } from '../../../lib/presentation/memberCopy'
import { flagOn } from '../functions'
import styles from '../TerminalShell.module.css'

/** The auth flag that switches the broker-estimates read on (the Depth tab's own key). */
export const BROKER_ESTIMATES_FLAG = 'researchDepth.broker_estimates_enabled'

export const brokerEstimatesKey = (sym) => `/api/research/broker-estimates/${encodeURIComponent(sym)}`

/** Pure: the firm rating actions worth showing, or [] when the read holds nothing real. */
export function firmActions(data) {
  if (!data || data.paywalled || data.badRequest) return []
  const firms = data.firms
  if (!firms || firms.state !== 'ok' || !Array.isArray(firms.actions)) return []
  return firms.actions.filter((a) => a && a.firm && a.action)
}

function FirmsActing({ sym }) {
  const { data, error } = useSWR(brokerEstimatesKey(sym), depthFetcher, { revalidateOnFocus: false })
  const rows = error ? [] : firmActions(data)
  if (!rows.length) return null
  return (
    <section data-testid="ee-firms" aria-label={`Firms acting on ${sym}`}>
      <h3 className={styles.helpGroup}>Firms acting on {sym}</h3>
      <p className={styles.helpRule}>Rating actions by named firms. These are not the estimates above.</p>
      <ul className={styles.helpRule}>
        {rows.map((a, i) => (
          <li key={`${a.date}-${a.firm}-${i}`} data-testid="ee-firm-row">
            {a.date ? <span className={styles.helpScope}>{a.date} </span> : null}
            {a.firm}: {a.action}{a.to_grade ? ` to ${a.to_grade}` : ''}{a.from_grade ? ` (from ${a.from_grade})` : ''}
          </li>
        ))}
      </ul>
      {data?.firms?.source && <p className={styles.helpScope}>Source: {memberText(data.firms.source)}.</p>}
    </section>
  )
}

export default function EstimatesPanel({ sym, ...rest }) {
  const auth = useContext(AuthContext)
  const s = (sym || '').toUpperCase().trim()
  return (
    <>
      <ConsensusEstimates sym={sym} {...rest} />
      {s && flagOn(auth, BROKER_ESTIMATES_FLAG) && <FirmsActing sym={s} />}
    </>
  )
}

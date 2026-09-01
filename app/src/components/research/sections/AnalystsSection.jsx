// app/src/components/research/sections/AnalystsSection.jsx
//
// ONE place for "what the street thinks" — estimates and the consensus range,
// the firm's own rating grades, and who actually owns the shares. These were
// three rail entries asking one question three ways.
//
// Layout borrows from the chart pop-up's own "The Street" tab (owner ask,
// 2026-08-28): the UCT composite rating has no equivalent there, so it stays
// full-width and first; Estimates and Ownership then sit in two
// independently-scrollable columns, the way TheStreetPanel.jsx lays out
// Analyst + Ownership, instead of one long stack.
import EstimatesTab from '../../../pages/research/tabs/EstimatesTab'
import RatingsTab from '../../../pages/research/tabs/RatingsTab'
import OwnershipTab from '../../../pages/research/tabs/OwnershipTab'
import useRatings from '../../../pages/research/hooks/useRatings'
import SectionLead from '../SectionLead'
import { streetLead } from '../sectionLeads'
import styles from './AnalystsSection.module.css'

export default function AnalystsSection({ sym }) {
  // ⛔ THE SAME SWR KEY `RatingsTab` ALREADY USES, deliberately — `useRatings`
  // is a thin useMobileSWR wrapper, so reading it here costs no second request
  // and the lead can never describe a different payload than the panel under
  // it renders. Do not "optimise" this into a prop drilled through RatingsTab;
  // the shared cache IS the mechanism.
  const { data: ratings } = useRatings(sym)

  if (!sym) return null
  return (
    <div className={styles.streetSection}>
      <SectionLead testId="street-lead">{streetLead(sym, ratings)}</SectionLead>
      <RatingsTab sym={sym} />
      <div className={styles.grid}>
        <EstimatesTab sym={sym} />
        <OwnershipTab sym={sym} />
      </div>
    </div>
  )
}

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
import styles from './AnalystsSection.module.css'

export default function AnalystsSection({ sym }) {
  if (!sym) return null
  return (
    <div className={styles.streetSection}>
      <RatingsTab sym={sym} />
      <div className={styles.grid}>
        <EstimatesTab sym={sym} />
        <OwnershipTab sym={sym} />
      </div>
    </div>
  )
}

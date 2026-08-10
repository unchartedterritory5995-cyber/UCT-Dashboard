// app/src/components/research/sections/AnalystsSection.jsx
//
// ONE place for "what the street thinks" — estimates and the consensus range,
// the firm's own rating grades, and who actually owns the shares. These were
// three rail entries asking one question three ways.
import EstimatesTab from '../../../pages/research/tabs/EstimatesTab'
import RatingsTab from '../../../pages/research/tabs/RatingsTab'
import OwnershipTab from '../../../pages/research/tabs/OwnershipTab'
import styles from './StackedSection.module.css'

export default function AnalystsSection({ sym }) {
  if (!sym) return null
  return (
    <div className={styles.stack}>
      <EstimatesTab sym={sym} />
      <RatingsTab sym={sym} />
      <OwnershipTab sym={sym} />
    </div>
  )
}

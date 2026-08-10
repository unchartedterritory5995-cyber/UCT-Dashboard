// app/src/components/research/sections/FinancialsSection.jsx
//
// ONE place for "the numbers". These were three separate rail entries —
// Fundamentals (the snapshot), Statements (six panels) and Financials (the
// grids) — which split a single question across three clicks and pushed the
// rail to eleven items. Fewer, deeper sections beat many shallow ones.
//
// Ordered by how a reader actually works: the snapshot answers "what is this
// company" in one glance, the panels answer "what is the trajectory", and the
// grids carry the exact figures for anyone who wants them.
import FundamentalSnapshot from '../../FundamentalSnapshot'
import StatementPanels from './StatementPanels'
import FinancialsTab from '../../../pages/research/tabs/FinancialsTab'
import styles from './StackedSection.module.css'

export default function FinancialsSection({ sym }) {
  if (!sym) return null
  return (
    <div className={styles.stack}>
      {/* showResearchLink={false}: the snapshot ships its own "Full research →"
          link, which would re-open the divert this modal exists to remove. */}
      <FundamentalSnapshot sym={sym} showResearchLink={false} />
      <StatementPanels sym={sym} />
      <FinancialsTab sym={sym} />
    </div>
  )
}

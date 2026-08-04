// app/src/components/research/sections/EarningsHistorySection.jsx
//
// STUB — this task (P2 T6) only owns the modal shell. Task 8 fills this in
// with the beat-streak lollipop + reaction history. Until then it renders the
// kit's standard empty-state so the shell is independently testable and green
// (see EarningsResearchModal.jsx's GATE c).
import { EmptyState } from '../../research-kit'

export default function EarningsHistorySection() {
  return (
    <EmptyState
      icon="clock"
      title="Earnings history coming soon"
      hint="Beat streak and reaction history land in the next pass."
    />
  )
}

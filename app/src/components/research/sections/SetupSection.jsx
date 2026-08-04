// app/src/components/research/sections/SetupSection.jsx
//
// STUB — this task (P2 T6) only owns the modal shell. The real Setup hero
// (Task 7: expected-move hero + Setup Grade breakdown) fills this in. Until
// then it renders the kit's standard empty-state so the shell is
// independently testable and green (see EarningsResearchModal.jsx's GATE c).
import { EmptyState } from '../../research-kit'

export default function SetupSection() {
  return (
    <EmptyState
      icon="chart"
      title="Setup coming soon"
      hint="The expected-move hero and Setup Grade breakdown land in the next pass."
    />
  )
}

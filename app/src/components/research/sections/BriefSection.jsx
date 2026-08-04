// app/src/components/research/sections/BriefSection.jsx
//
// STUB — this task (P2 T6) only owns the modal shell. Task 9 fills this in
// with the cached-only preview/analysis brief (P2 T2's probe). Until then it
// renders the kit's standard empty-state so the shell is independently
// testable and green (see EarningsResearchModal.jsx's GATE c).
import { EmptyState } from '../../research-kit'

export default function BriefSection() {
  return (
    <EmptyState
      icon="document"
      title="Brief coming soon"
      hint="The AI preview/analysis brief lands in the next pass."
    />
  )
}

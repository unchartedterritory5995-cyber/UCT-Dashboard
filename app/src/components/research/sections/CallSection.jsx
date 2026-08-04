// app/src/components/research/sections/CallSection.jsx
//
// STUB — this task (P2 T6) only owns the modal shell. Task 10 fills this in
// with the live/recap call transcript + sentiment. Until then it renders the
// kit's standard empty-state so the shell is independently testable and green
// (see EarningsResearchModal.jsx's GATE c).
import { EmptyState } from '../../research-kit'

export default function CallSection() {
  return (
    <EmptyState
      icon="chat"
      title="Call coming soon"
      hint="Live audio and the call recap land in the next pass."
    />
  )
}

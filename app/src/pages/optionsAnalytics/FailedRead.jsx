import PanelState from '../../components/terminal/PanelState'

// A failed options-analytics read: the sentence the section already said, in the shared error
// block, with the one action a member needs — ask again. `retry` is `useDarkSection(...).retry`
// (SWR's mutate) or a section's own re-ask; without one the block still says the read failed,
// but every caller in this directory passes one (completeness audit 2026-10-07: these sections
// said "unavailable right now" with no way to try again).
export default function FailedRead({ title, retry, testId, children }) {
  return (
    <PanelState kind="error" compact role="status" title={title} testId={testId}
      action={retry ? <button type="button" onClick={() => retry()}>Retry</button> : null}>
      {children}
    </PanelState>
  )
}

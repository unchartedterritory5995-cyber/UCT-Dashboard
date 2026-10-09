// Wave 9 lane 9: a research panel whose route answered 404. These routes are dark-flagged: the
// server answers 404 while the switch is off, so the panel says that, in words, rather than
// "unavailable right now" with a Retry that can never succeed. (The options-analytics family's
// OffLine says the same; this is the one line the research tabs and depth panels share.)
export default function SwitchedOff({ what, className, testId }) {
  return (
    <div className={className} role="status" data-testid={testId}>
      {what} isn&apos;t switched on for this server yet. That is a setting on our side, not an empty result.
    </div>
  )
}

/** A failed read Retry cannot fix because the route is switched off. */
export const isSwitchedOff = (err) => err?.status === 404

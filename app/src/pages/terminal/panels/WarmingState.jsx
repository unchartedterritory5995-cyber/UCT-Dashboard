// Wave 9 lane 9: what a panel shows while its server answers "warming" (a cold cache building
// the answer). Never "no data" and never an error: the answer is on its way. After the brief
// re-poll runs out (useWarmingPoll), the same block says so and offers Retry.
// `what` is written as it reads mid-sentence: "theme returns", "RS rankings", "price history".
import { PanelState } from '../../../components/terminal'
import { WARMING_TITLE } from './marketRead'

export default function WarmingState({ what, gaveUp = false, onRetry, testId, compact = false }) {
  if (gaveUp) {
    return (
      <PanelState kind="empty" role="status" compact={compact} testId={testId} title={`The server is still preparing ${what}.`}
        action={onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}>
        It has not finished yet. Retry in a minute.
      </PanelState>
    )
  }
  return (
    <PanelState kind="empty" role="status" compact={compact} testId={testId} title={WARMING_TITLE}>
      The server is building {what} now. This panel checks again every few seconds and fills in on its own.
    </PanelState>
  )
}

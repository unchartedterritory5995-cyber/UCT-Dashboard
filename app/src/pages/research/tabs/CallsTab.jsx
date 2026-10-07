import SentimentGauge from '../../../components/calendar/SentimentGauge'
import CallRecapSection from '../../../components/calendar/CallRecapSection'
import TranscriptPanel from '../../../components/calendar/TranscriptPanel'
import useCallRecap from '../hooks/useCallRecap'
import useEarningsAudio from '../hooks/useEarningsAudio'
import { recapEmptyState } from '../../../components/research/callRecap'
import ResearchLoading from '../ResearchLoading'
import styles from '../ResearchPage.module.css'
import { usePendingReask } from '../depth/depthFetch'
import PendingGaveUp from '../depth/PendingGaveUp'
import PanelState from '../../../components/terminal/PanelState'

export default function CallsTab({ sym }) {
  const { data: recapData, isLoading, error, paywalled, mutate } = useCallRecap(sym)
  const { data: audioData } = useEarningsAudio(sym)
  const recap = recapData?.recap
  // "this panel updates on its own" (callRecap.js generating copy) was not true: nothing
  // re-asked. It does now, while the recap is being written.
  const reask = usePendingReask(!recap && recapData?.recap_status === 'generating', mutate, sym)

  return (
    <div className={styles.finWrap}>
      {recapData?.entity && recapData.entity.status !== 'resolved' && (
        <div className={styles.entityNote} data-testid="entity-unresolved-note">
          This symbol is not yet linked to a company record, so some sources below may not match it.
        </div>
      )}
      {/* TERM-088 -- a failed read is not a genuinely empty recap; the empty-state branch below
          is guarded with `&& !error`. Completeness audit 2026-10-07: the error rendered BELOW the
          transcript, under a long page a member had to scroll past to learn the recap failed. It
          is the first thing in the tab now, in the shared error block. */}
      {!isLoading && error && (
        <PanelState kind="error" compact testId="call-recap-error"
          title="Couldn't load the earnings call recap for this ticker."
          action={<button type="button" onClick={() => mutate()}>Retry</button>}>
          The transcript below is read separately.
        </PanelState>
      )}
      <SentimentGauge ticker={sym} />
      {isLoading && !recap && <ResearchLoading label="Loading earnings call recap" />}
      {/* The WHOLE payload, not `.recap`: webcast_url, rating_changes and
          review_status ride the outer object, and normalizeCallRecap (inside
          CallRecapSection) flat-merges them -- same as CallSection does. */}
      {recap && <CallRecapSection recap={recapData} audio={audioData} hideSentimentBadge />}
      {/* the recap's other states sit where the recap would, above the transcript */}
      {!isLoading && paywalled && (
        <div className={styles.fnote} data-testid="call-recap-paywalled">The earnings call recap requires a paid plan.</div>
      )}
      {!isLoading && !recap && !error && !paywalled && (() => {
        // Same shared copy as CallSection. This surface said "No earnings call
        // recap is available yet for this ticker" for the generating case too,
        // which is the common one — the request path never synthesises inline.
        const { title, hint } = recapEmptyState(recapData?.recap_status)
        return (
          <div className={styles.fnote} data-testid="call-recap-empty">
            <strong>{title}</strong> {hint}
          </div>
        )
      })()}
      <PendingGaveUp exhausted={reask.exhausted} onRetry={reask.retry} what="The recap" />
      <TranscriptPanel sym={sym} />
    </div>
  )
}

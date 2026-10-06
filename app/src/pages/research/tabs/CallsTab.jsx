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
      <SentimentGauge ticker={sym} />
      {isLoading && !recap && <ResearchLoading label="Loading earnings call recap" />}
      {/* The WHOLE payload, not `.recap`: webcast_url, rating_changes and
          review_status ride the outer object, and normalizeCallRecap (inside
          CallRecapSection) flat-merges them -- same as CallSection does. */}
      {recap && <CallRecapSection recap={recapData} audio={audioData} hideSentimentBadge />}
      <TranscriptPanel sym={sym} />
      {/* TERM-088 -- a failed read is not a genuinely empty recap. Rendered
          BEFORE the empty-state branch, which is guarded with `&& !error` so
          a backend hiccup never reads as "no recap available yet". */}
      {!isLoading && paywalled && (
        <div className={styles.fnote} data-testid="call-recap-paywalled">The earnings call recap requires a paid plan.</div>
      )}
      {!isLoading && error && (
        <div className={styles.fnote} data-testid="call-recap-error">
          Couldn't load the earnings call recap for this ticker.
          {' '}
          <button type="button" className={styles.basisBtn} onClick={() => mutate()}>Retry</button>
        </div>
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
    </div>
  )
}

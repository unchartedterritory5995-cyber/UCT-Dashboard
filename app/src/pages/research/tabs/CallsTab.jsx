import SentimentGauge from '../../../components/calendar/SentimentGauge'
import CallRecapSection from '../../../components/calendar/CallRecapSection'
import TranscriptPanel from '../../../components/calendar/TranscriptPanel'
import useCallRecap from '../hooks/useCallRecap'
import useEarningsAudio from '../hooks/useEarningsAudio'
import { recapEmptyState } from '../../../components/research/callRecap'
import styles from '../ResearchPage.module.css'

export default function CallsTab({ sym }) {
  const { data: recapData, isLoading } = useCallRecap(sym)
  const { data: audioData } = useEarningsAudio(sym)
  const recap = recapData?.recap

  return (
    <div className={styles.finWrap}>
      <SentimentGauge ticker={sym} />
      {isLoading && !recap && <div className={styles.fnote}>Loading earnings call recap…</div>}
      {recap && <CallRecapSection recap={recap} audio={audioData} hideSentimentBadge />}
      <TranscriptPanel sym={sym} />
      {!isLoading && !recap && (() => {
        // Same shared copy as CallSection. This surface said "No earnings call
        // recap is available yet for this ticker" for the generating case too,
        // which is the common one — the request path never synthesises inline.
        const { title, hint } = recapEmptyState(recapData?.recap_status)
        return (
          <div className={styles.fnote}>
            <strong>{title}</strong> {hint}
          </div>
        )
      })()}
    </div>
  )
}

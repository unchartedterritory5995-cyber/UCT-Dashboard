import SentimentGauge from '../../../components/calendar/SentimentGauge'
import CallRecapSection from '../../../components/calendar/CallRecapSection'
import useCallRecap from '../hooks/useCallRecap'
import useEarningsAudio from '../hooks/useEarningsAudio'
import styles from '../ResearchPage.module.css'

export default function CallsTab({ sym }) {
  const { data: recapData, isLoading } = useCallRecap(sym)
  const { data: audioData } = useEarningsAudio(sym)
  const recap = recapData?.recap

  return (
    <div className={styles.finWrap}>
      <SentimentGauge ticker={sym} />
      {isLoading && !recap && <div className={styles.fnote}>Loading earnings call recap…</div>}
      {recap && <CallRecapSection recap={recap} audio={audioData} ticker={sym} />}
      {!isLoading && !recap && (
        <div className={styles.fnote}>No earnings call recap is available yet for this ticker.</div>
      )}
    </div>
  )
}

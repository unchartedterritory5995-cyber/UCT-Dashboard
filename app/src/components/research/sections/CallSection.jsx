// app/src/components/research/sections/CallSection.jsx
//
// §4.3.4 — ONE merged call system. This replaces the old modal's TWO
// independent transcript UIs: CallRecapSection already owns the lazy verbatim
// transcript (useTranscript, quota-gated by `enabled`), so there is no second
// transcript block here.
//
// GATE e: SentimentGauge is REUSED (kit-restyled), not forked — it is its own
// self-fetching AI read (a distinct /api/earnings/sentiment/{ticker} score +
// rationale + drivers) rendered above the recap, which already carries its
// own simple bullish/bearish/neutral badge from the recap payload itself.
import CallRecapSection from '../../calendar/CallRecapSection'
import SentimentGauge from '../../calendar/SentimentGauge'
import { EmptyState } from '../../research-kit'
import useCallRecap from '../../../hooks/useCallRecap'
import useEarningsAudio from '../../../hooks/useEarningsAudio'
import { normalizeCallRecap } from '../callRecap'
import styles from './CallSection.module.css'

export default function CallSection({ sym, lifecycle }) {
  const { data: payload } = useCallRecap(sym)
  const { data: audio } = useEarningsAudio(sym)
  const recap = normalizeCallRecap(payload)

  if (!recap) {
    const webcast = payload?.webcast_url
    return (
      <div className={styles.wrap}>
        <SentimentGauge ticker={sym} />
        {lifecycle === 'CALL_LIVE' && webcast && (
          <a className={styles.listen} href={webcast} target="_blank" rel="noopener noreferrer">
            Listen live →
          </a>
        )}
        <EmptyState
          icon="chat"
          title="No call recap yet"
          hint="No transcript yet — typically posts within 2h of the call."
        />
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <SentimentGauge ticker={sym} />
      {/* §12: the recap body below is LLM-authored; visibly attribute it. No
          generation timestamp exists on this payload (unlike the brief's
          `cached` flag) so the line states WHAT it is, not a fabricated WHEN. */}
      <p className={styles.provenance} data-testid="call-provenance">AI · earnings call recap</p>
      <CallRecapSection recap={recap} audio={audio ?? null} ticker={sym} />
    </div>
  )
}

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
import TranscriptPanel from '../../calendar/TranscriptPanel'
import SentimentGauge from '../../calendar/SentimentGauge'
import { EmptyState } from '../../research-kit'
import useCallRecap from '../../../hooks/useCallRecap'
import useEarningsAudio from '../../../hooks/useEarningsAudio'
import { normalizeCallRecap } from '../callRecap'
import styles from './CallSection.module.css'

// §12 / review r1 I3: `SentimentGauge` (an AI score + rationale + drivers,
// api/routers/earnings_intel.py's "AI-derived earnings sentiment") is the
// FIRST AI content this section ever shows, in BOTH branches below — it self-
// fetches and renders unconditionally whenever CallSection mounts. A
// provenance line that only appears alongside the recap (as this used to)
// leaves the gauge, which renders first, completely unattributed, and — once
// a recap exists — sits BELOW an artifact it never actually named. One line,
// at the top, ahead of everything AI-derived this panel can show, covers
// both without duplicating or under/over-claiming: it states the panel's
// method, not a fact about content that may or may not have resolved yet.
const PROVENANCE = 'AI · sentiment score & call recap'

export default function CallSection({ sym, lifecycle }) {
  const { data: payload } = useCallRecap(sym)
  const { data: audio } = useEarningsAudio(sym)
  const recap = normalizeCallRecap(payload)

  if (!recap) {
    const webcast = payload?.webcast_url
    return (
      <div className={styles.wrap}>
        <p className={styles.provenance} data-testid="call-provenance">{PROVENANCE}</p>
        <SentimentGauge ticker={sym} />
        {lifecycle === 'CALL_LIVE' && webcast && (
          <a className={styles.listen} href={webcast} target="_blank" rel="noopener noreferrer">
            Listen live →
          </a>
        )}
        <EmptyState
          icon="chat"
          title="No call recap yet"
          hint="A recap is written once there is enough source material on this call."
        />
        {/* Independent of the recap above: FMP publishes the verbatim
            transcript with no LLM in the path, so it must stay reachable
            when synthesis has not run, has failed, or is capped. */}
        <TranscriptPanel sym={sym} />
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.provenance} data-testid="call-provenance">{PROVENANCE}</p>
      <SentimentGauge ticker={sym} />
      <CallRecapSection recap={recap} audio={audio ?? null} />
      <TranscriptPanel sym={sym} />
    </div>
  )
}

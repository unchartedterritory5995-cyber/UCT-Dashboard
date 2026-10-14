// The daily prep pack's morning wire and exposure block (Notebook P2b, Task 10; spec §P2 item 6): the
// wire's headline, "Exposure {score} ({regime word})" and the wire's date, frozen at capture. The
// regime's word is the ONE map (lib/blocks/regimeWords: amber is "Yellow"); an id the map does not own
// is not a word, and a missing score is never guessed.
import PrepCapture from './PrepCapture'
import { regimeWord } from '../../../lib/blocks/regimeWords'
import styles from './Blocks.module.css'

/** "2026-10-05" -> "Oct 5, 2026" (read as the calendar date it is, never shifted by a time zone). */
function wireDay(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || null
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
}

function exposureLine(s) {
  const word = regimeWord(s.regime)
  if (typeof s.exposure === 'number' && Number.isFinite(s.exposure)) {
    return `Exposure ${Math.round(s.exposure)}${word ? ` (${word})` : ''}`
  }
  return word ? `Regime: ${word}` : null
}

export default function PrepWireBlock(props) {
  return (
    <PrepCapture part="wire" {...props}>
      {(s) => {
        const exposure = exposureLine(s)
        const day = wireDay(s.wireDate)
        return (
          <>
            {s.headline && <p>{s.headline}</p>}
            {exposure && <p className={styles.muted}>{exposure}</p>}
            {day && <p className={styles.muted}>{`Wire of ${day}`}</p>}
          </>
        )
      }}
    </PrepCapture>
  )
}

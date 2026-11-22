// THE VERDICT STAMP (round 18; owner, batch 18: "average but closer"). A seal, not a badge: a double ring with a dashed
// inner line, the mark and a word, slammed onto the chart's corner once (scale and blur settle in one motion) and left
// tilted like a stamp lands. Green ink for a named chart, red for a miss. `pop` (round 21; the owner, batch 16: the answer
// "should take over the entire screen as like a pop up uncovered answer like a normal app or game"): the seal fills the
// screen's centre for a moment, then clears, leaving the inline seal beside the verdict.
import s from './study.module.css'

/** A word this short reads at a legible size on the small inline seal (study.module.css .stampWordShort). */
export const STAMP_SHORT_WORD = 5

export default function Stamp({ ok, word = null, inline = false, pop = false }) {
  const said = word || (ok ? 'Named it' : 'Miss')
  return (
    <div className={pop ? s.stampPop : inline ? s.stampInline : s.stampWrap} aria-hidden="true">
      <div className={`${s.stamp} ${ok ? '' : s.miss}`}>
        <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          {ok ? <path d="M4 12.5l5 5L20 7" /> : <path d="M6 6l12 12M18 6L6 18" />}
        </svg>
        <span className={`${s.stampWord} ${said.length <= STAMP_SHORT_WORD ? s.stampWordShort : ''}`} data-word={said}>{said}</span>
      </div>
    </div>
  )
}

// THE VERDICT STAMP (round 18; owner, batch 18: "average but closer"). A seal, not a badge: a double ring with a dashed
// inner line, the mark and a word, slammed onto the chart's corner once (scale and blur settle in one motion) and left
// tilted like a stamp lands. Green ink for a named chart, red for a miss.
import s from './study.module.css'

export default function Stamp({ ok, word = null, inline = false }) {
  return (
    <div className={inline ? s.stampInline : s.stampWrap} aria-hidden="true">
      <div className={`${s.stamp} ${ok ? '' : s.miss}`}>
        <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          {ok ? <path d="M4 12.5l5 5L20 7" /> : <path d="M6 6l12 12M18 6L6 18" />}
        </svg>
        <span className={s.stampWord}>{word || (ok ? 'Named it' : 'Miss')}</span>
      </div>
    </div>
  )
}

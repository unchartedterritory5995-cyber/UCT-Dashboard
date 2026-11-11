// THE PROMPT LINE (round 20): the question, and after Check the verdict, in display type beside the mark — no bubble, no
// box. The verdict carries the seal at its right. A status region, so a screen reader hears the verdict the moment it
// lands. The owner, before ranking round 19: "I can already tell it needs a revamp"; the references are lesson screens
// with nothing boxed around the question. The verdict (2026-11-08, batch 24: "Decent, Can be a bit cooler") lands on a
// band in its own colour, with a light that crosses it once; the question stays unboxed.
import StudyMark from '../../../components/study/StudyMark'
import s from './study.module.css'

export default function Prompt({ mood = 'idle', tone = 'ask', title, sub = null, seal = null, size = 48 }) {
  return (
    <div className={`${s.prompt} ${tone === 'ok' ? s.promptOk : tone === 'bad' ? s.promptBad : ''}`} role="status">
      <StudyMark mood={mood} size={size} />
      <div className={s.promptText}>
        <div className={`${s.promptTitle} ${tone === 'ok' ? s.ok : tone === 'bad' ? s.bad : ''}`}>{title}</div>
        {sub ? <div className={s.promptSub}>{sub}</div> : null}
      </div>
      {seal ? <div className={s.promptSeal}>{seal}</div> : null}
    </div>
  )
}

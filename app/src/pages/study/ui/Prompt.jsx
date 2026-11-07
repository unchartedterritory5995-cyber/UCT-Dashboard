// THE PROMPT LINE (round 20): the question, and after Check the verdict, in display type beside the mark — no bubble, no
// box. The verdict carries the seal at its right. A status region, so a screen reader hears the verdict the moment it
// lands. The owner, before ranking round 19: "I can already tell it needs a revamp"; the references are lesson screens
// with nothing boxed around the question.
import StudyMark from '../../../components/study/StudyMark'
import s from './study.module.css'

export default function Prompt({ mood = 'idle', tone = 'ask', title, sub = null, seal = null, size = 48 }) {
  return (
    <div className={s.prompt} role="status">
      <StudyMark mood={mood} size={size} />
      <div className={s.promptText}>
        <div className={`${s.promptTitle} ${tone === 'ok' ? s.ok : tone === 'bad' ? s.bad : ''}`}>{title}</div>
        {sub ? <div className={s.promptSub}>{sub}</div> : null}
      </div>
      {seal ? <div className={s.promptSeal}>{seal}</div> : null}
    </div>
  )
}

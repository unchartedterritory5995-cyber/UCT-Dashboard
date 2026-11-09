// THE ANSWER TAKES OVER THE SCREEN (the owner, 2026-11-04: "it should take over the entire screen as like a pop up
// uncovered answer like a normal app or game or test would have it"; 2026-11-08: "Yes", in every mode). When an answer is
// checked, the whole screen becomes the verdict: the page dims, a slow burst of light in the verdict's colour opens behind
// it, the stamp strikes, the verdict, the answer and the XP land, confetti on a right answer. One button opens the
// review: the chart plays out with the trade and its key, and the lesson. Blitz keeps its instant flash (a takeover on
// each of thirty answers a minute would stop the clock's game).
import { useEffect } from 'react'
import { Confetti } from '../../../lab/bits'
import StudyMark from '../../../components/study/StudyMark'
import UIcon from '../../../components/ui/UIcon'
import StudyButton from './StudyButton'
import UiStamp from './Stamp'
import v from './verdictTakeover.module.css'

export default function VerdictTakeover({ ok, title, sub = null, answer = null, xp = 0, stampWord = null, label = 'See why', onContinue, testId = 'verdict-takeover' }) {
  useEffect(() => {
    // the page under it stays still while the verdict holds the screen
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  return (
    <div className={`${v.wrap} ${ok ? v.ok : v.bad}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'The answer'} data-testid={testId} data-correct={ok ? '1' : '0'}>
      <i className={v.rays} aria-hidden="true" />
      <i className={v.glow} aria-hidden="true" />
      {ok ? <Confetti n={60} /> : null}
      <div className={v.panel}>
        <div className={v.art}>
          <StudyMark mood={ok ? 'happy' : 'oops'} size={120} />
          <div className={v.stamp}><UiStamp ok={ok} word={stampWord} inline /></div>
        </div>
        <h2 className={v.title} role="status" aria-live="polite">{title}</h2>
        {answer ? <p className={v.answer}><span>{ok ? 'You said' : 'The answer'}</span><b>{answer}</b></p> : null}
        {sub ? <p className={v.sub}>{sub}</p> : null}
        {xp > 0 ? <span className={v.xp}><UIcon name="star" size={16} gold={false} />+{xp} XP</span> : null}
        <div className={v.cta}>
          <StudyButton kind={ok ? 'good' : 'bad'} size="xl" arrow wide hotkey="Enter" onClick={onContinue} testId={`${testId}-go`}>{label}</StudyButton>
        </div>
      </div>
    </div>
  )
}

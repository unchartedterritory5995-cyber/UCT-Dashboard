/**
 * RevealTakeover — the verdict takes the WHOLE screen (owner, batch 16: "it should take over the entire screen as
 * like a pop up uncovered answer like a normal app or game or test would have it"). The mark reacts, the stamp slams
 * in, the hero word reads CORRECT or NOT QUITE, the answer is named, then the lesson (RevealCard's body) and one big
 * Continue. Confetti on a right answer. The chart beneath keeps the pointer and the forward bars for when it closes.
 */
import StudyMark from '../../components/study/StudyMark'
import { StartButton } from '../../lab/StartCard'
import { Confetti } from '../../lab/bits'
import RevealCard from './RevealCard'
import { answerWord } from './revealCardHelpers'
import { brandWords } from './drills/types'
import styles from './RevealTakeover.module.css'

export const CORRECT_WORD = 'Correct'
export const WRONG_WORD = 'Not quite'

export default function RevealTakeover({ correct, reveal, item, profile, attemptId = null, reviewer = false, onContinue, label = 'Continue' }) {
  const raw = brandWords(answerWord(reveal) || '')
  const key = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : ''
  return (
    <div className={`${styles.wrap} ${correct ? styles.good : styles.bad}`} role="dialog" aria-modal="true" aria-label={correct ? CORRECT_WORD : WRONG_WORD} data-testid="reveal-takeover" data-correct={correct ? '1' : '0'}>
      {correct && <Confetti n={90} />}
      <div className={styles.slam} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="120" height="120" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          {correct ? <path d="M4 12.5l5 5L20 7" /> : <path d="M6 6l12 12M18 6L6 18" />}
        </svg>
      </div>
      <div className={styles.panel}>
        <div className={styles.art}>
          <StudyMark mood={correct ? 'happy' : 'oops'} size={140} />
          <div className={styles.stamp} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
              {correct ? <path d="M4 12.5l5 5L20 7" /> : <path d="M6 6l12 12M18 6L6 18" />}
            </svg>
          </div>
        </div>
        <p className={styles.hero} role="status" aria-live="polite">{correct ? CORRECT_WORD : WRONG_WORD}</p>
        {key && <p className={styles.answer}><span className={styles.answerLabel}>{correct ? 'You said' : 'The answer'}</span><span className={styles.answerWord}>{key}</span></p>}
        <RevealCard correct={!!correct} reveal={reveal} item={item} profile={profile} attemptId={attemptId} reviewer={reviewer} className={styles.lesson} hideVerdict />
        <div className={styles.cta}>
          <StartButton icon={correct ? 'play' : 'check'} label={label} sub={correct ? 'keep it rolling' : 'learn it, then on'} tone={correct ? 'gold' : 'red'} onClick={onContinue} hotkey={false} ariaLabel={label} testId="primary-action" />
        </div>
      </div>
    </div>
  )
}

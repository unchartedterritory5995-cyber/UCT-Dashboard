// THE REPLAY STOPS AND ASKS (N033, 2026-11-08; the owner: pause in the replay "and ask about trimming, trailing, sell
// rules", and "no scrolling to reach the buttons"). When the run-on reaches 2R, and again at 3R, it holds and this card
// sits right under the chart with the plan's question (api/services/study_trade.replay_checks: the answers are the
// plan's own words). Pick one: the tiles show right and wrong, the why reads under them, and Keep playing runs the
// replay on. Not scored. The card brings itself into view when it appears.
import { useEffect, useRef, useState } from 'react'
import Tile from './Tile'
import StudyButton from './StudyButton'
import s from './study.module.css'

export default function ReplayPause({ check, onDone, testId = 'replay-pause' }) {
  const [pick, setPick] = useState(null)
  const box = useRef(null)
  useEffect(() => { try { box.current?.scrollIntoView?.({ block: 'nearest' }) } catch { /* an old engine */ } }, [])
  if (!check) return null
  const done = pick != null
  const right = done && pick === check.answer
  const stateOf = (i) => (!done ? 'idle' : i === check.answer ? 'right' : i === pick ? 'wrong' : 'quiet')
  return (
    <section ref={box} className={s.replayPause} data-testid={testId} data-at={check.at} aria-live="polite">
      <div className={s.replayPauseHead}>
        <span className={s.replayPauseTag}>The replay stops · {check.at === 't1' ? '2R' : '3R'}</span>
        <h3 className={s.replayPauseQ}>{check.q}</h3>
      </div>
      <div className={s.replayPauseTiles} role="radiogroup" aria-label={check.q}>
        {check.choices.map((c, i) => (
          <Tile key={c} n={i + 1} i={i} label={c} state={stateOf(i)} disabled={done} role="radio" checked={pick === i}
            onClick={() => !done && setPick(i)} testId={`${testId}-choice-${i}`} />
        ))}
      </div>
      {done ? (
        <div className={`${s.replayPauseWhy} ${right ? s.replayPauseOk : s.replayPauseBad}`}>
          <p><b>{right ? 'That is the plan.' : 'Not the plan.'}</b> {check.why}</p>
          <StudyButton kind={right ? 'good' : 'primary'} arrow hotkey="Enter" onClick={onDone} className={s.replayPauseGo} testId={`${testId}-go`}>Keep playing</StudyButton>
        </div>
      ) : null}
    </section>
  )
}

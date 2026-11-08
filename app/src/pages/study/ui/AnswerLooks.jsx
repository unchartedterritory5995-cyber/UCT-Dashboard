// THE ANSWER AREA, FOCUS ROUND 2 (2026-11-08): the question line, the four answers and Check, as one area. Batch 22 ranked
// all three Weak, with the owner's words on the question: "I would make the question a bit more detailed please." Three
// real versions, each built to a named reference, on the same inputs so the winner drops into HardChallenge:
//
//   A · Lesson app    Duolingo's lesson screen: a context line, the question, the detail; four tactile tiles; one wide
//                     Check bar across the foot that lights when an answer is picked
//   B · Quiz show     Kahoot: four big tiles, each with its own colour and shape; no separate Check, the picked tile
//                     carries its own "Lock it in" (Check is where the eye already is)
//   C · Order ticket  a trading platform's order ticket: the question and what to read on the candle on the left, the
//                     answers as rows on the right, a gold submit bar under them
//
// Inputs: choices (labels), pick (index or null), state ask | ok | bad, answer (the right label, known after Check),
// step/total, busy, onPick(i), onCheck(), onNext(). No market fact is written here: the detail line only says where to
// look on the chart.
import { useEffect } from 'react'
import UIcon from '../../../components/ui/UIcon'
import a from './answerLooks.module.css'

const Q = 'What fired on the last candle?'
const DETAIL = <>The ringed candle is the last day on this chart. Pick the setup that triggered on that candle, or <b>Nothing fired</b> if none did.</>

function tileState(i, label, { pick, state, answer }) {
  if (state === 'ask') return pick === i ? 'sel' : 'idle'
  if (label === answer) return 'right'
  if (pick === i) return 'wrong'
  return 'quiet'
}

function Mark({ st, n }) {
  if (st === 'right') return <UIcon name="check" size={15} gold={false} />
  if (st === 'wrong') return <UIcon name="x" size={15} gold={false} />
  return n
}

/** A · Lesson app. In the product (round 22): `head` replaces the question once the answer is checked (the verdict line,
 *  which the owner ranked Good, stays as it was), `hotkey` makes Enter press Check and then Next, and the test ids are the
 *  ones Hard mode always carried. */
export function AnswerLessonApp({ choices, pick = null, state = 'ask', answer = null, step = 0, total = 8, busy = false, onPick, onCheck, onNext, head = null, nextLabel = 'Next', hotkey = false, eyebrow = null, cardsTestId = null, checkTestId = null, nextTestId = null }) {
  const ctx = { pick, state, answer }
  useEffect(() => {
    if (!hotkey) return undefined
    const k = (e) => {
      if (e.key !== 'Enter' || e.repeat || (e.target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName))) return
      if (state === 'ask') { if (pick != null && !busy) onCheck?.() } else onNext?.()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [hotkey, state, pick, busy, onCheck, onNext])
  return (
    <div className={`${a.area} ${a.lesson}`}>
      {state !== 'ask' && head ? head : (
        <div className={a.lHead}>
          <span className={a.lEyebrow}>{eyebrow || <>Chart {step + 1} of {total} · Daily · ticker hidden</>}</span>
          <h2 className={a.lQ}>{Q}</h2>
          <p className={a.lDetail}>{DETAIL}</p>
        </div>
      )}
      <div className={a.lGrid} role="group" aria-label="Your answer" data-testid={cardsTestId || undefined}>
        {choices.map((c, i) => {
          const st = tileState(i, c, ctx)
          return (
            <button key={c} type="button" className={`${a.lTile} ${a[st] || ''}`} style={{ '--i': i }} disabled={state !== 'ask'} onClick={() => onPick?.(i)} data-state={st} aria-pressed={st === 'sel' || undefined}>
              <span className={a.lKey}><Mark st={st} n={i + 1} /></span>
              <span className={a.lLabel}>{c}</span>
            </button>
          )
        })}
      </div>
      <div className={`${a.lFoot} ${state === 'ok' ? a.footOk : state === 'bad' ? a.footBad : ''}`}>
        {state === 'ask'
          ? <button type="button" className={`${a.lCheck} ${pick != null ? a.ready : ''} ${busy ? a.busy : ''}`} disabled={pick == null || busy} onClick={onCheck} data-testid={checkTestId || undefined} aria-busy={busy || undefined}>{busy ? 'Checking' : 'Check'}</button>
          : <button type="button" className={`${a.lCheck} ${a.ready} ${state === 'ok' ? a.good : a.bad}`} onClick={onNext} data-testid={nextTestId || undefined}>{nextLabel}</button>}
      </div>
    </div>
  )
}

const SHAPES = [
  <path key="t" d="M12 4l9 16H3z" />,
  <path key="d" d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z" />,
  <circle key="c" cx="12" cy="12" r="9" />,
  <rect key="s" x="4" y="4" width="16" height="16" rx="2.5" />,
]

/** B · Quiz show */
export function AnswerQuizShow({ choices, pick = null, state = 'ask', answer = null, step = 0, busy = false, onPick, onCheck, onNext }) {
  const ctx = { pick, state, answer }
  return (
    <div className={`${a.area} ${a.quiz}`}>
      <div className={a.qBanner}>
        <span className={a.qNo}>{step + 1}</span>
        <div><h2 className={a.qQ}>{Q}</h2><p className={a.qDetail}>{DETAIL}</p></div>
      </div>
      <div className={a.qGrid} role="group" aria-label="Your answer">
        {choices.map((c, i) => {
          const st = tileState(i, c, ctx)
          return (
            <div key={c} className={`${a.qTile} ${a['tone' + (i % 4)]} ${a[st] || ''}`} style={{ '--i': i }} data-state={st}>
              <button type="button" className={a.qPick} disabled={state !== 'ask'} onClick={() => onPick?.(i)} aria-pressed={st === 'sel' || undefined}>
                <svg viewBox="0 0 24 24" className={a.qShape} aria-hidden="true" focusable="false">{SHAPES[i % 4]}</svg>
                <span className={a.qLabel}>{c}</span>
                <span className={a.qKey}><Mark st={st} n={i + 1} /></span>
              </button>
              {st === 'sel' ? <button type="button" className={a.qLock} disabled={busy} onClick={onCheck}>{busy ? 'Checking' : 'Lock it in'}<UIcon name="chevronRight" size={16} gold={false} /></button> : null}
            </div>
          )
        })}
      </div>
      {state !== 'ask' ? <div className={a.qNextRow}><button type="button" className={`${a.qNext} ${state === 'ok' ? a.good : a.bad}`} onClick={onNext}>Next<UIcon name="chevronRight" size={18} gold={false} /></button></div> : null}
    </div>
  )
}

/** C · Order ticket */
export function AnswerTicket({ choices, pick = null, state = 'ask', answer = null, step = 0, total = 8, busy = false, onPick, onCheck, onNext }) {
  const ctx = { pick, state, answer }
  return (
    <div className={`${a.area} ${a.ticket}`}>
      <div className={a.tLeft}>
        <span className={a.tEyebrow}>Name the setup · chart {step + 1} of {total}</span>
        <h2 className={a.tQ}>{Q}</h2>
        <p className={a.tDetail}>{DETAIL}</p>
        <div className={a.tRead}>
          <span className={a.tReadHead}>Read the candle for</span>
          <span><i>1</i>the gap from the day before</span>
          <span><i>2</i>where it closed in its own range</span>
          <span><i>3</i>its volume against its average</span>
        </div>
      </div>
      <div className={a.tRight}>
        <div className={a.tRows} role="radiogroup" aria-label="Your answer">
          {choices.map((c, i) => {
            const st = tileState(i, c, ctx)
            return (
              <button key={c} type="button" role="radio" aria-checked={st === 'sel'} className={`${a.tRow} ${a[st] || ''}`} style={{ '--i': i }} disabled={state !== 'ask'} onClick={() => onPick?.(i)} data-state={st}>
                <span className={a.tRadio}><Mark st={st} n="" /></span>
                <span className={a.tLabel}>{c}</span>
                <span className={a.tKey}>{i + 1}</span>
              </button>
            )
          })}
        </div>
        {state === 'ask'
          ? <button type="button" className={a.tSubmit} disabled={pick == null || busy} onClick={onCheck}>{busy ? 'Checking' : pick == null ? 'Pick an answer' : `Check: ${choices[pick]}`}</button>
          : <button type="button" className={`${a.tSubmit} ${state === 'ok' ? a.good : a.bad}`} onClick={onNext}>Next chart</button>}
      </div>
    </div>
  )
}


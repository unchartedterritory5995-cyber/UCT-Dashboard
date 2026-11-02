import { useMemo, useState } from 'react'
import StudyChart from '../StudyChart'
import { useSample } from '../Lab'
import s from '../lab.module.css'

const GOLD = '#d9b84a'
const pct = (a, b) => ((b - a) / a) * 100

/** Piece 2: the answer card. The same chart now shows what happened next (20 sessions), the candle stays pointed at,
 *  the card says right/wrong, the ticker and date, WHY in the owner's words, and three measured facts from the bars. */
export default function Piece2AnswerCard() {
  const d = useSample()
  const [right, setRight] = useState(true)
  const vis = d?.visible, fwd = d?.forward
  const all = useMemo(() => (vis && fwd ? [...vis, ...fwd] : vis), [vis, fwd])
  const bar = vis?.length ? vis[vis.length - 1] : null
  const prior = vis?.length > 1 ? vis[vis.length - 2] : null
  const facts = useMemo(() => {
    if (!bar || !fwd?.length) return null
    const hi20 = Math.max(...fwd.map((b) => b.h))
    const lo20 = Math.min(...fwd.map((b) => b.l))
    const last = fwd[fwd.length - 1]
    return { gain: pct(bar.c, last.c), best: pct(bar.c, hi20), worst: pct(bar.l, lo20), priorBody: prior ? pct(prior.o, prior.c) : null, held: lo20 >= bar.l }
  }, [bar, fwd, prior])
  const markers = useMemo(() => (bar ? [{ time: bar.t, position: 'aboveBar', color: GOLD, shape: 'arrowDown', text: 'the Kicker', id: 'lab-a' }] : null), [bar])
  const annotations = useMemo(() => (bar ? [{ id: 'lab-low', type: 'hray', points: [{ time: bar.t, price: bar.l }], color: GOLD, dashed: true, label: 'its low' }] : null), [bar])
  return (
    <div className={s.col}>
      <div className={s.top}>
        <span>Question 3 of 10</span>
        <span className={s.strip}>{[1, 1, 0, 0, 0, 0, 0, 0, 0, 0].map((x, i) => <i key={i} className={i < 2 ? s.ok : i === 2 ? (right ? s.ok : s.bad) : ''} />)}</span>
        <span>Setup · Kicker</span>
      </div>
      <h1 className={s.h1}>A red day, then this. Is the gold candle a Kicker?</h1>
      <div className={s.chartBox}>
        <span className={s.tag}>Daily · now with the next {fwd ? fwd.length : 20} sessions</span>
        <StudyChart bars={all} markers={markers} annotations={annotations} highlightBarTime={bar ? [bar.t] : null} highlightColor={GOLD} height={360} />
      </div>
      <div className={s.pills}>
        <button type="button" className={`${s.pill} ${right ? s.on : ''}`} onClick={() => setRight(true)}>Show it as a right answer</button>
        <button type="button" className={`${s.pill} ${!right ? s.on : ''}`} onClick={() => setRight(false)}>Show it as a wrong answer</button>
      </div>
      <div className={s.card}>
        <div className={`${s.verdict} ${right ? s.ok : s.bad}`}>{right ? '✓ Yes. That is a Kicker.' : '✗ Not this time. It is a Kicker.'}</div>
        <div className={s.meta}>{d?.sym} · {d?.asof} · the owner's model example</div>
        <p className={s.lesson}>
          The day before closed <b>weak and red</b>: real sellers, not a baby red candle. Then the stock opened above that red body and
          <b> never looked back</b>, closing near its high. The sellers from yesterday are trapped. That trap is the Kicker.
        </p>
        {facts ? (
          <div className={s.facts}>
            <div className={s.fact}><div className={s.k}>Red day body</div><div className={`${s.v} ${s.down}`}>{facts.priorBody.toFixed(1)}%</div></div>
            <div className={s.fact}><div className={s.k}>20 sessions later</div><div className={`${s.v} ${facts.gain >= 0 ? s.up : s.down}`}>{facts.gain >= 0 ? '+' : ''}{facts.gain.toFixed(1)}%</div></div>
            <div className={s.fact}><div className={s.k}>Low held?</div><div className={`${s.v} ${facts.held ? s.up : s.down}`}>{facts.held ? 'Yes' : 'No'}</div></div>
          </div>
        ) : null}
        <p className={s.hint}>The numbers are measured from the bars on the chart, never typed in.</p>
      </div>
      <div className={s.foot}><button type="button" className={s.cta}>Next question</button></div>
    </div>
  )
}

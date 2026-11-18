import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WidgetChart from '../WidgetChart'
import { useSample } from '../Lab'
import { arrowAt, rayAt, pct } from '../pointers'
import coach from '../../components/intro/assets/compass-mark.webp'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

const LEAD = 8
const SPEED = 1000

/** Round 5, piece 3: the replay as a STORY (owner: "way more of a production, interactive, educational; clunky").
 *  Four chapters on a rail: Setup, Red day, Kicker, Follow-through. The chart plays itself; at each chapter it
 *  stops and the coach asks one quick question before it goes on. Captions are big and change with the bar.
 *  One button: play. */
const CHAPTERS = ['Setup', 'Red day', 'Kicker', 'Follow-through']

export default function Piece23Story() {
  const d = useSample()
  const vis = d?.visible, fwd = d?.forward
  const n = vis?.length || 0
  const all = useMemo(() => (vis && fwd ? [...vis, ...fwd] : vis), [vis, fwd])
  const total = all?.length || 0
  const START = Math.max(2, n - 1 - LEAD)
  const [upto, setUpto] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ask, setAsk] = useState(null)       // {id, q, choices, answer, why}
  const [picked, setPicked] = useState(null)
  const [score, setScore] = useState(0)
  const timer = useRef(null)
  useEffect(() => { if (n && upto === 0) setUpto(START) }, [n, upto, START])
  const chapter = upto < n - 1 ? 0 : upto === n - 1 ? 1 : upto === n ? 2 : 3
  const redChg = all && n > 2 ? pct(all[n - 3].c, all[n - 2].c) : 0
  const lineHeld = upto > n && all ? all.slice(n, upto).every((b) => b.c >= all[n - 1].l) : null
  useEffect(() => {
    if (!playing) return undefined
    timer.current = setInterval(() => setUpto((u) => {
      const next = Math.min(total, u + 1)
      if (next === n - 1) { setPlaying(false); setAsk({ id: 'red', q: `This day closed ${redChg.toFixed(1)}%. Is that a real red day?`, choices: ['Yes, sellers finished in charge', 'No, too small to count'], answer: Math.abs(redChg) >= 1 ? 0 : 1, why: 'A real red day closes weak, roughly one to five percent down. A baby red candle is not a setup.' }) }
      if (next === n) { setPlaying(false); setAsk({ id: 'line', q: 'It opened above the red body and closed strong. Where is the line for this trade?', choices: ['The low of this candle', 'The high of this candle', 'The low of the red day'], answer: 0, why: 'Its low is the line. A close below it means the trap failed.' }) }
      if (next >= total) { setPlaying(false); setAsk({ id: 'held', q: 'Twenty sessions later. Did the line hold?', choices: ['Yes', 'No'], answer: lineHeld ? 0 : 1, why: lineHeld ? 'No close below the low of the Kicker. The trap held.' : 'A close below the low: the trap failed, and the trade is out.' }) }
      return next
    }), SPEED)
    return () => clearInterval(timer.current)
  }, [playing, n, total, redChg, lineHeld])
  const shown = useMemo(() => (all ? all.slice(0, upto) : null), [all, upto])
  const annotations = useMemo(() => {
    if (!shown?.length || !n) return null
    const a = []
    if (upto >= n - 1) a.push(...arrowAt(shown, n - 2, { label: 'red day', color: '#ff4b4b', id: 'r', gap: 5 }))
    if (upto >= n) { a.push(...arrowAt(shown, n - 1, { label: 'Kicker', id: 'k', gap: 5, color: '#58cc02' })); a.push(...rayAt(shown[n - 1], 'l', { id: 'l', label: 'the line' })) }
    return a.length ? a : null
  }, [shown, n, upto])
  const answer = useCallback((i) => { setPicked(i); if (i === ask.answer) setScore((v) => v + 1) }, [ask])
  const cont = () => { setAsk(null); setPicked(null); if (upto < total) setPlaying(true) }
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const b = shown?.[shown.length - 1], p = shown?.[shown.length - 2]
  const chg = b && p ? pct(p.c, b.c) : 0
  const headline = chapter === 0 ? 'Pulling back into its averages' : chapter === 1 ? 'A real red day' : chapter === 2 ? 'The Kicker' : upto >= total ? 'Twenty sessions on' : 'The line is watched'
  const sub = chapter === 0 ? 'Watch for one weak red day, then the candle that opens above it.' : chapter === 1 ? 'Sellers finished the day in charge. The setup needs this.' : chapter === 2 ? 'Opens above the red body, closes near its high. Its low is the line.' : `${pct(all[n - 1].c, b.c) >= 0 ? '+' : ''}${pct(all[n - 1].c, b.c).toFixed(1)}% from the Kicker's close.`
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><button type="button" className={d5.close} aria-label="Close">✕</button>
        <div className={d5.rail}>{CHAPTERS.map((c, i) => <span key={c} className={`${d5.chap} ${i < chapter ? d5.done : i === chapter ? d5.now : ''}`}>{c}</span>)}</div>
        <span className={d5.score}>{score}/3</span></div>
      <div className={d5.story} key={upto}>
        <div className={d5.storyDate}>{b?.t} · <b className={chg >= 0 ? s.green : s.red}>{chg >= 0 ? '+' : ''}{chg.toFixed(1)}%</b></div>
        <div className={d5.storyH}>{headline}</div>
        <div className={d5.storySub}>{sub}</div>
      </div>
      <div className={s.chartBox}><WidgetChart sym={d.sym} bars={shown} annotations={annotations} height={420} density="mini" defaultBars={40} /></div>
      {ask ? (
        <div className={d5.askCard}>
          <div className={d5.ask}><img src={coach} alt="" className={d5.coach} /><div className={d5.bubble}>{ask.q}</div></div>
          <div className={d5.cards}>{ask.choices.map((c, i) => <button key={c} type="button" className={`${d5.card} ${picked != null && i === ask.answer ? d5.right : ''} ${picked === i && i !== ask.answer ? d5.wrong : ''}`} disabled={picked != null} onClick={() => answer(i)}>{c}</button>)}</div>
          {picked != null ? <p className={d5.verdictWhy}>{ask.why}</p> : null}
        </div>
      ) : null}
      <div className={`${d5.footer} ${picked != null ? (picked === ask?.answer ? d5.good : d5.badF) : ''}`}><div className={d5.footIn}>
        {ask ? <button type="button" className={`${d5.btn} ${picked != null ? d5.live : ''}`} disabled={picked == null} onClick={cont}>{upto >= total ? 'Finish' : 'Keep watching'}</button>
          : <button type="button" className={`${d5.btn} ${d5.live}`} onClick={() => { if (upto >= total) { setUpto(START); setScore(0) } setPlaying((v) => !v) }}>{playing ? 'Pause' : upto >= total ? 'Watch again' : upto === START ? 'Play the story' : 'Keep watching'}</button>}
      </div></div>
    </div>
  )
}

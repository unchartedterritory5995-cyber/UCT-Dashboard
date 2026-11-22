import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WidgetChart from '../WidgetChart'
import { useSample } from '../Lab'
import { arrowAt, rayAt, pct } from '../pointers'
import { byDay, forming, etLabel } from '../intraday'
import coach from '../../components/intro/assets/compass-mark.webp'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

const LEAD = 8
const FAST = 110      // ms per intraday tick on an ordinary day
const SLOW = 420      // ms per tick on the red day and the Kicker
const CHAPTERS = ['Setup', 'Red day', 'Kicker', 'Follow-through']

function useJson(name) {
  const [d, setD] = useState(null)
  useEffect(() => { let on = true; fetch(`/labdata/${name}.json`).then((r) => r.json()).then((j) => on && setD(j)).catch(() => on && setD({ error: true })); return () => { on = false } }, [name])
  return d
}

/** Round 6, piece 3: the story, TICK BY TICK (owner: "very good so far. No flashing per day; faster between the main
 *  days; tick by tick so each day has multiple ticks using each hourly close; the text should not bounce").
 *  Every daily candle now FORMS from its hourly closes: open, then the high and low stretch and the close moves
 *  seven times before the day is done. Ordinary days run fast; the red day and the Kicker run slow. Captions sit
 *  still. The chapter questions stay. */
export default function Piece28StoryV2() {
  const d = useSample()
  const h60 = useJson('JBI_60m')
  const vis = d?.visible, fwd = d?.forward
  const n = vis?.length || 0
  const all = useMemo(() => (vis && fwd ? [...vis, ...fwd] : vis), [vis, fwd])
  const total = all?.length || 0
  const days = useMemo(() => (h60?.bars ? byDay(h60.bars) : null), [h60])
  const START = Math.max(2, n - 1 - LEAD)
  // position = { i: index of the day forming, k: ticks shown of that day }
  const [pos0, setPos] = useState(null)
  const pos = useMemo(() => pos0 || (n ? { i: START, k: 0 } : null), [pos0, n, START])
  const [playing, setPlaying] = useState(false)
  const [ask, setAsk] = useState(null)
  const [picked, setPicked] = useState(null)
  const [score, setScore] = useState(0)
  const timer = useRef(null)
  const ticksOf = useCallback((i) => (all && days ? days[all[i].t] || null : null), [all, days])
  const redChg = all && n > 2 ? pct(all[n - 3].c, all[n - 2].c) : 0
  const shown = useMemo(() => {
    if (!all || !pos) return null
    const base = all.slice(0, pos.i)
    const ticks = ticksOf(pos.i)
    // the day forms from its hourly closes; its LAST tick is the real daily bar (the official open/high/low/close)
    const cur = ticks && ticks.length && pos.k < ticks.length - 1 ? forming(all[pos.i].t, ticks, pos.k) : all[pos.i]
    return [...base, cur]
  }, [all, pos, ticksOf])
  const lineHeld = all && pos && pos.i > n - 1 ? all.slice(n, pos.i + 1).every((b) => b.c >= all[n - 1].l) : null
  const askFor = useCallback((i) => {
    if (i === n - 2) return { q: `This day closed ${redChg.toFixed(1)}%. Is that a real red day?`, choices: ['Yes, sellers finished in charge', 'No, too small to count'], answer: Math.abs(redChg) >= 1 ? 0 : 1, why: 'A real red day closes weak, roughly one to five percent down. A baby red candle is not a setup.' }
    if (i === n - 1) return { q: 'It opened above the red body and closed strong. Where is the line for this trade?', choices: ['The low of this candle', 'The high of this candle', 'The low of the red day'], answer: 0, why: 'Its low is the line. A close below it means the trap failed.' }
    if (i === total - 1) return { q: 'Twenty sessions later. Did the line hold?', choices: ['Yes', 'No'], answer: lineHeld ? 0 : 1, why: lineHeld ? 'No close below the low of the Kicker. The trap held.' : 'A close below the low: the trap failed, and the trade is out.' }
    return null
  }, [n, total, redChg, lineHeld])
  useEffect(() => {
    if (!playing || !pos || !all) return undefined
    const slow = pos.i === n - 2 || pos.i === n - 1
    timer.current = setTimeout(() => {
      const ticks = ticksOf(pos.i)
      const last = !ticks || pos.k >= ticks.length - 1
      if (!last) { setPos({ i: pos.i, k: pos.k + 1 }); return }
      const q = askFor(pos.i)
      if (q) { setPlaying(false); setAsk(q); return }
      if (pos.i + 1 >= total) { setPlaying(false); return }
      setPos({ i: pos.i + 1, k: 0 })
    }, slow ? SLOW : FAST)
    return () => clearTimeout(timer.current)
  }, [playing, pos, all, n, total, ticksOf, askFor])
  const annotations = useMemo(() => {
    if (!shown?.length || !pos) return null
    const a = []
    if (pos.i >= n - 1) a.push(...arrowAt(shown, n - 2, { label: 'red day', color: '#df4646', id: 'r', gap: 5 }))
    if (pos.i >= n && pos.i > n - 1) { a.push(...arrowAt(shown, n - 1, { label: 'Kicker', id: 'k', gap: 5 })); a.push(...rayAt(shown[n - 1], 'l', { id: 'l', label: 'the line' })) }
    else if (pos.i === n - 1 && ask) { a.push(...arrowAt(shown, n - 1, { label: 'Kicker', id: 'k', gap: 5 })); a.push(...rayAt(shown[n - 1], 'l', { id: 'l', label: 'the line' })) }
    return a.length ? a : null
  }, [shown, pos, n, ask])
  const cont = () => { setAsk(null); setPicked(null); if (pos.i + 1 < total) { setPos({ i: pos.i + 1, k: 0 }); setPlaying(true) } }
  if (!d || !pos) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const chapter = pos.i < n - 2 || (pos.i === n - 2 && !ask) ? 0 : pos.i === n - 2 ? 1 : pos.i === n - 1 ? 2 : 3
  const b = shown[shown.length - 1], p = shown[shown.length - 2]
  const chg = pct(p.c, b.c)
  const ticks = ticksOf(pos.i)
  const tickLabel = ticks && ticks.length ? etLabel(ticks[Math.min(pos.k, ticks.length - 1)].t) + ' ET' : ''
  const atEnd = pos.i >= total - 1 && (!ticks || pos.k >= ticks.length - 1)
  const headline = chapter === 0 ? 'Pulling back into its averages' : chapter === 1 ? 'A real red day' : chapter === 2 ? 'The Kicker' : atEnd ? 'Twenty sessions on' : 'The line is watched'
  const sub = chapter === 0 ? 'Watch for one weak red day, then the candle that opens above it.' : chapter === 1 ? 'Sellers finished the day in charge. The setup needs this.' : chapter === 2 ? 'Opens above the red body, closes near its high. Its low is the line.' : `${pct(all[n - 1].c, b.c) >= 0 ? '+' : ''}${pct(all[n - 1].c, b.c).toFixed(1)}% from the Kicker's close.`
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><button type="button" className={d5.close} aria-label="Close">✕</button>
        <div className={d5.rail}>{CHAPTERS.map((c, i) => <span key={c} className={`${d5.chap} ${i < chapter ? d5.done : i === chapter ? d5.now : ''}`}>{c}</span>)}</div>
        <span className={d5.score}>{score}/3</span></div>
      <div className={d5.story}>
        <div className={d5.storyDate}>{b.t} <span className={d5.tick}>{tickLabel}</span> <b className={chg >= 0 ? s.green : s.red}>{chg >= 0 ? '+' : ''}{chg.toFixed(1)}%</b></div>
        <div className={d5.storyH}>{headline}</div>
        <div className={d5.storySub}>{sub}</div>
      </div>
      <div className={s.chartBox}><WidgetChart sym={d.sym} bars={shown} annotations={annotations} height={440} density="mini" defaultBars={40} /></div>
      {ask ? (
        <div className={d5.askCard}>
          <div className={d5.ask}><img src={coach} alt="" className={d5.coach} /><div className={d5.bubble}>{ask.q}</div></div>
          <div className={d5.cards}>{ask.choices.map((c, i) => <button key={c} type="button" className={`${d5.card} ${picked != null && i === ask.answer ? d5.right : ''} ${picked === i && i !== ask.answer ? d5.wrong : ''}`} disabled={picked != null} onClick={() => { setPicked(i); if (i === ask.answer) setScore((v) => v + 1) }}>{c}</button>)}</div>
          {picked != null ? <p className={d5.verdictWhy}>{ask.why}</p> : null}
        </div>
      ) : null}
      <div className={`${d5.footer} ${picked != null ? (picked === ask?.answer ? d5.good : d5.badF) : ''}`}><div className={d5.footIn}>
        {ask ? <button type="button" className={`${d5.btn} ${picked != null ? d5.live : ''}`} disabled={picked == null} onClick={cont}>{pos.i + 1 >= total ? 'Finish' : 'Keep watching'}</button>
          : <button type="button" className={`${d5.btn} ${d5.live}`} onClick={() => { if (atEnd) { setPos({ i: START, k: 0 }); setScore(0) } setPlaying((v) => !v) }}>{playing ? 'Pause' : atEnd ? 'Watch again' : pos.i === START && pos.k === 0 ? 'Play the story' : 'Keep watching'}</button>}
      </div></div>
    </div>
  )
}

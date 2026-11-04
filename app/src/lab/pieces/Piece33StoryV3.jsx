import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WidgetChart from '../WidgetChart'
import { useSample } from '../Lab'
import { spot, rayAt, pct } from '../pointers'
import { byDay, forming, etLabel } from '../intraday'
import coach from '../../components/intro/assets/compass-mark.png'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

const LEAD = 8
const FORWARD = 8          // owner: "don't need to go 20 sessions out"
const MANAGE_AFTER = 3     // the Manage stop, sessions after the Kicker
const FAST = 110, SLOW = 420
const CHAPTERS = ['Setup', 'Red day', 'Kicker', 'Manage', 'Follow-through']

function useJson(name) {
  const [d, setD] = useState(null)
  useEffect(() => { let on = true; fetch(`/labdata/${name}.json`).then((r) => r.json()).then((j) => on && setD(j)).catch(() => on && setD({ error: true })); return () => { on = false } }, [name])
  return d
}

/** Round 7, piece 3: the story, compact and with a MANAGE stop (owner: "can pause here and ask about trimming and
 *  trailing and some sell rules ... work on those later"; "don't need 20 sessions out"; "use the space better so I
 *  don't have to scroll to click buttons"). Two columns on a desktop: the chart left, the caption, the question and
 *  the button right, all on one screen. Eight sessions after the Kicker. Three sessions in, the coach asks where you
 *  would take some off: you tap a candle, nothing is graded, and the card says the sell rules get written next. */
export default function Piece33StoryV3() {
  const d = useSample()
  const h60 = useJson('JBI_60m')
  const vis = d?.visible, fwd = d?.forward
  const n = vis?.length || 0
  const all = useMemo(() => (vis && fwd ? [...vis, ...fwd.slice(0, FORWARD)] : vis), [vis, fwd])
  const total = all?.length || 0
  const days = useMemo(() => (h60?.bars ? byDay(h60.bars) : null), [h60])
  const START = Math.max(2, n - 1 - LEAD)
  const [pos0, setPos] = useState(null)
  const pos = useMemo(() => pos0 || (n ? { i: START, k: 0 } : null), [pos0, n, START])
  const [playing, setPlaying] = useState(false)
  const [ask, setAsk] = useState(null)
  const [picked, setPicked] = useState(null)
  const [trim, setTrim] = useState(null)
  const [score, setScore] = useState(0)
  const timer = useRef(null)
  const ticksOf = useCallback((i) => (all && days ? days[all[i].t] || null : null), [all, days])
  const redChg = all && n > 2 ? pct(all[n - 3].c, all[n - 2].c) : 0
  const shown = useMemo(() => {
    if (!all || !pos) return null
    const ticks = ticksOf(pos.i)
    const cur = ticks && ticks.length && pos.k < ticks.length - 1 ? forming(all[pos.i].t, ticks, pos.k) : all[pos.i]
    return [...all.slice(0, pos.i), cur]
  }, [all, pos, ticksOf])
  const lineHeld = all && pos && pos.i > n - 1 ? all.slice(n, pos.i + 1).every((b) => b.c >= all[n - 1].l) : null
  const askFor = useCallback((i) => {
    if (i === n - 2) return { kind: 'q', q: `This day closed ${redChg.toFixed(1)}%. Is that a real red day?`, choices: ['Yes, sellers finished in charge', 'No, too small to count'], answer: Math.abs(redChg) >= 1 ? 0 : 1, why: 'A real red day closes weak, roughly one to five percent down. A baby red candle is not a setup.' }
    if (i === n - 1) return { kind: 'q', q: 'It opened above the red body and closed strong. Where is the line for this trade?', choices: ['The low of this candle', 'The high of this candle', 'The low of the red day'], answer: 0, why: 'Its low is the line. A close below it means the trap failed.' }
    if (i === n - 1 + MANAGE_AFTER) return { kind: 'tap', q: 'Three sessions in and the trade is working. Where would you take some off? Tap a candle.', why: 'Noted. Trimming, trailing and the sell rules are the next lesson, written with the owner. For now: know your line, and know where you would pay yourself.' }
    if (i === total - 1) return { kind: 'q', q: `${FORWARD} sessions later. Did the line hold?`, choices: ['Yes', 'No'], answer: lineHeld ? 0 : 1, why: lineHeld ? 'No close below the low of the Kicker. The trap held.' : 'A close below the low: the trap failed, and the trade is out.' }
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
    if (pos.i >= n - 1) a.push(...spot(shown, n - 2, { label: 'red day', color: '#df4646', id: 'r', gap: 5, halo: false }))
    if (pos.i >= n || (pos.i === n - 1 && ask)) { a.push(...spot(shown, n - 1, { label: 'Kicker', id: 'k', gap: 5 })); a.push(...rayAt(shown[n - 1], 'l', { id: 'l', label: 'the line' })) }
    if (trim) a.push(...spot(shown, trim.index, { label: 'take some off here', id: 't', gap: 4, color: '#2faf68', halo: false }))
    return a.length ? a : null
  }, [shown, pos, n, ask, trim])
  const cont = () => { setAsk(null); setPicked(null); if (pos.i + 1 < total) { setPos({ i: pos.i + 1, k: 0 }); setPlaying(true) } }
  if (!d || !pos) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const chapter = pos.i < n - 2 || (pos.i === n - 2 && !ask) ? 0 : pos.i === n - 2 ? 1 : pos.i === n - 1 ? 2 : pos.i < n - 1 + MANAGE_AFTER || (pos.i === n - 1 + MANAGE_AFTER && ask) ? 3 : 4
  const b = shown[shown.length - 1], p = shown[shown.length - 2]
  const chg = pct(p.c, b.c)
  const ticks = ticksOf(pos.i)
  const tickLabel = ticks && ticks.length ? etLabel(ticks[Math.min(pos.k, ticks.length - 1)].t) + ' ET' : ''
  const atEnd = pos.i >= total - 1 && (!ticks || pos.k >= ticks.length - 1)
  const headline = chapter === 0 ? 'Pulling back into its averages' : chapter === 1 ? 'A real red day' : chapter === 2 ? 'The Kicker' : chapter === 3 ? 'Managing the trade' : atEnd ? `${FORWARD} sessions on` : 'The line is watched'
  const sub = chapter === 0 ? 'Watch for one weak red day, then the candle that opens above it.' : chapter === 1 ? 'Sellers finished the day in charge. The setup needs this.' : chapter === 2 ? 'Opens above the red body, closes near its high. Its low is the line.' : `${pct(all[n - 1].c, b.c) >= 0 ? '+' : ''}${pct(all[n - 1].c, b.c).toFixed(1)}% from the Kicker's close.`
  const canTap = ask?.kind === 'tap' && !trim
  const answered = ask ? (ask.kind === 'tap' ? !!trim : picked != null) : false
  return (
    <div className={`${d5.lesson} ${d5.wide}`}>
      <div className={d5.topbar}><button type="button" className={d5.close} aria-label="Close">✕</button>
        <div className={d5.rail}>{CHAPTERS.map((c, i) => <span key={c} className={`${d5.chap} ${i < chapter ? d5.done : i === chapter ? d5.now : ''}`}>{c}</span>)}</div>
        <span className={d5.score}>{score}/3</span></div>
      <div className={d5.split}>
        <div className={`${s.chartBox} ${canTap ? s.pulse : ''}`}>
          {canTap ? <span className={s.tapHint}>tap a candle</span> : null}
          <WidgetChart sym={d.sym} bars={shown} annotations={annotations} height={520} phoneHeight={320} density="mini" defaultBars={36} onBarTap={canTap ? ({ index }) => { if (index >= 0) setTrim({ index }) } : null} />
        </div>
        <div className={d5.side}>
          <div className={d5.story}>
            <div className={d5.storyDate}>{b.t} <span className={d5.tick}>{tickLabel}</span> <b className={chg >= 0 ? s.green : s.red}>{chg >= 0 ? '+' : ''}{chg.toFixed(1)}%</b></div>
            <div className={d5.storyH}>{headline}</div>
            <div className={d5.storySub}>{sub}</div>
          </div>
          {ask ? (
            <div className={d5.askCard}>
              <div className={d5.ask}><img src={coach} alt="" className={d5.coach} /><div className={d5.bubble}>{ask.q}</div></div>
              {ask.kind === 'q' ? <div className={`${d5.cards} ${d5.one}`}>{ask.choices.map((c, i) => <button key={c} type="button" className={`${d5.card} ${picked != null && i === ask.answer ? d5.right : ''} ${picked === i && i !== ask.answer ? d5.wrong : ''}`} disabled={picked != null} onClick={() => { setPicked(i); if (i === ask.answer) setScore((v) => v + 1) }}>{c}</button>)}</div> : null}
              {answered ? <p className={d5.verdictWhy}>{ask.why}</p> : null}
            </div>
          ) : null}
          <div className={d5.sideBtn}>
            {ask ? <button type="button" className={`${d5.btn} ${answered ? d5.live : ''}`} disabled={!answered} onClick={cont}>{pos.i + 1 >= total ? 'Finish' : 'Keep watching'}</button>
              : <button type="button" className={`${d5.btn} ${d5.live}`} onClick={() => { if (atEnd) { setPos({ i: START, k: 0 }); setScore(0); setTrim(null) } setPlaying((v) => !v) }}>{playing ? 'Pause' : atEnd ? 'Watch again' : pos.i === START && pos.k === 0 ? 'Play the story' : 'Keep watching'}</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

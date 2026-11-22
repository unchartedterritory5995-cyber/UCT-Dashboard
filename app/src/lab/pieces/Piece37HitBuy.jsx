import { useEffect, useMemo, useRef, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import { useSample } from '../Lab'
import { spot } from '../pointers'
import { XP } from '../rewards'
import { regularSession, etLabel } from '../intraday'
import { sfx, voice } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

const TICK_MS = 900

function useJson(name) {
  const [d, setD] = useState(null)
  useEffect(() => { let on = true; fetch(`/labdata/${name}.json`).then((r) => r.json()).then((j) => on && setD(j)).catch(() => on && setD({ error: true })); return () => { on = false } }, [name])
  return d
}

/** Round 8, piece 2: LIVE REVEAL, hit BUY. The Kicker day plays tick by tick on the 30-minute chart; the red day's
 *  high is the line; the member must press BUY the moment a bar trades over it. Early = wrong (nothing has
 *  triggered). On the trigger bar = perfect. One bar late = good. Later = late. Reaction time is shown. The
 *  trigger is measured from the bars, never asserted. */
export default function Piece37HitBuy() {
  const d = useSample()
  const m30 = useJson('JBI_2023-12-14_30m')
  const vis = d?.visible
  const n = vis?.length || 0
  const red = n > 1 ? vis[n - 2] : null
  const bars30 = useMemo(() => (m30?.bars ? regularSession(m30.bars) : null), [m30])
  const day1Start = useMemo(() => (bars30 && m30?.session_open ? bars30.findIndex((b) => b.t >= m30.session_open) : -1), [bars30, m30])
  const level = red ? Math.round((red.h + 0.01) * 100) / 100 : null
  const trigIdx = useMemo(() => (bars30 && level != null && day1Start >= 0 ? bars30.findIndex((b, i) => i >= day1Start && b.h >= level) : -1), [bars30, level, day1Start])
  const [upto, setUpto] = useState(-1)        // bars shown; -1 until day 1 is located
  const [playing, setPlaying] = useState(false)
  const [result, setResult] = useState(null) // {kind, at, ms}
  const shownAt = useRef(0)
  const timer = useRef(null)
  const effUpto = upto < 0 ? day1Start : upto
  useEffect(() => {
    if (!playing || !bars30) return undefined
    timer.current = setTimeout(() => {
      if (effUpto >= bars30.length) { setPlaying(false); if (!result) setResult({ kind: 'missed' }); return }
      setUpto(effUpto + 1); shownAt.current = performance.now(); sfx('tick')
    }, TICK_MS)
    return () => clearTimeout(timer.current)
  }, [playing, effUpto, bars30, result])
  const shown = useMemo(() => (bars30 && effUpto >= 0 ? bars30.slice(0, effUpto) : null), [bars30, effUpto])
  const annotations = useMemo(() => {
    if (!shown?.length || level == null) return null
    const a = [{ id: 'lvl', type: 'hray', points: [{ time: shown[0].t, price: level }], color: '#dcbb5e', lineWidth: 1.5, lineStyle: 'dashed', label: `previous day's high · ${level.toFixed(2)}` }]
    if (result?.at != null) a.push(...spot(shown, result.at, { label: result.kind === 'perfect' ? 'buy · on the trigger' : result.kind === 'good' ? 'buy · one bar late' : result.kind === 'early' ? 'buy · too early' : 'buy · late', id: 'b', gap: 3, halo: false, color: result.kind === 'early' || result.kind === 'late' ? '#df4646' : '#2faf68' }))
    if (trigIdx >= 0 && effUpto > trigIdx && result && result.kind !== 'perfect') a.push(...spot(shown, trigIdx, { label: 'the trigger', id: 't', gap: 3, halo: false }))
    return a
  }, [shown, level, result, trigIdx, effUpto])
  const buy = () => {
    if (!playing || result) return
    const at = effUpto - 1
    const ms = Math.round(performance.now() - shownAt.current)
    let kind = 'late'
    if (at < trigIdx) kind = 'early'; else if (at === trigIdx) kind = 'perfect'; else if (at === trigIdx + 1) kind = 'good'
    setResult({ kind, at, ms }); setPlaying(false)
    sfx(kind === 'perfect' || kind === 'good' ? 'buy' : 'wrong'); voice(kind === 'perfect' ? 'buy_perfect' : kind === 'early' ? 'buy_early' : 'buy_late')
  }
  useEffect(() => { const k = (e) => { if (e.code === 'Space') { e.preventDefault(); if (!playing && !result) setPlaying(true); else buy() } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) })
  const restart = () => { setResult(null); setUpto(day1Start); setPlaying(true) }
  if (!d || !bars30 || day1Start < 0) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const last = shown[shown.length - 1]
  const xp = result ? ({ perfect: XP.BUY_PERFECT, good: XP.BUY_GOOD, early: 0, late: XP.BUY_LATE, missed: 0 })[result.kind] : 0
  const mood = result ? (result.kind === 'perfect' ? 'fire' : result.kind === 'good' ? 'happy' : 'oops') : playing ? 'think' : 'idle'
  return (
    <div className={`${d5.lesson} ${d5.wide}`}>
      <div className={d5.topbar}><button type="button" className={d5.close} aria-label="Close">✕</button><div className={d5.prog}>{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < 4 ? d5.on : ''} />)}</div><span className={d5.score}>{xp ? `+${xp} XP` : ''}</span></div>
      <div className={d5.split}>
        <div className={s.chartBox}><WidgetChart sym={d.sym} tf="30" bars={shown} annotations={annotations} height={520} phoneHeight={320} density="mini" /></div>
        <div className={d5.side}>
          <div className={d5.ask}><Logo mood={mood} size={84} /><div className={d5.bubble}>{!result ? (playing ? 'Day 1. Hit BUY the moment a bar trades over the line.' : 'Yesterday was a real red day. Its high is the line. Press play, then hit BUY on the trigger.') : result.kind === 'perfect' ? 'Right on the trigger.' : result.kind === 'good' ? 'One bar late. Fine.' : result.kind === 'early' ? 'Too early. Nothing had triggered.' : result.kind === 'late' ? 'Late. The move was already on.' : 'The day ended. You never bought.'}</div></div>
          <div className={d5.live}>
            <div><small>Bar</small><b>{last ? etLabel(last.t) : ''} ET</b></div>
            <div><small>Last</small><b>${last ? last.c.toFixed(2) : ''}</b></div>
            <div><small>Line</small><b>${level.toFixed(2)}</b></div>
            {result?.ms != null ? <div><small>Reaction</small><b>{result.ms} ms</b></div> : null}
            {result?.at != null && trigIdx >= 0 ? <div><small>Trigger bar</small><b>{etLabel(bars30[trigIdx].t)} ET</b></div> : null}
          </div>
          {result ? <div className={d5.gems}><div className={`${d5.gem} ${xp >= 15 ? d5.green : xp ? '' : d5.dim}`}><div className={d5.gemIn}><span className={d5.gemIcon}>{xp >= 15 ? '★' : '◆'}</span><small>{result.kind}</small><b>+{xp} XP</b></div></div></div> : null}
          <div className={d5.sideBtn}>
            {!playing && !result ? <button type="button" className={`${d5.btn} ${d5.live}`} onClick={() => { setPlaying(true); voice('welcome') }}>Play · space</button>
              : result ? <button type="button" className={`${d5.btn} ${d5.live}`} onClick={restart}>Try again</button>
              : <button type="button" className={`${d5.btn} ${d5.buyBtn}`} onClick={buy}>BUY · space</button>}
          </div>
          <p className={s.hint}>Scoring: on the trigger bar +{XP.BUY_PERFECT}, one bar late +{XP.BUY_GOOD}, later +{XP.BUY_LATE}, early 0. The trigger is the first 30-minute bar that trades over the previous day's high; it is measured from the bars.</p>
        </div>
      </div>
    </div>
  )
}

// THE START SCREEN, FOCUS ROUND 4 (2026-11-08). Batch 22: the start screen Okay with a pin ("Looks better but I think
// it can still be improved on the graphics and production. I give it a 68/100"), the title Okay, the medal, the rule
// tiles and Start Weak. Three versions on the intro's own inputs (total, ready, onStart), each built to a reference:
//
//   A · Arena       a game's level intro: the task drawn as art (a chart that draws itself, the last candle ringed with a
//                   question mark), the stakes in one line, the reward shown, one big tactile Start (Brawl Stars, Clash)
//   B · Legendary   Duolingo's Legendary challenge: the medal is the hero, one sentence of stakes, the rules as one
//                   quiet row, a wide Start across the foot and a way out
//   C · Briefing    a mission briefing: the rules as a numbered brief on the left, the run as a fanned deck of eight
//                   face-down charts on the right, "Deal the charts"
//
// The chart in A is a drawing, not a stock: fixed shapes, no prices, no ticker.
import { useEffect } from 'react'
import { Medal } from './Medal'
import UIcon from '../../../components/ui/UIcon'
import st from './startLooks.module.css'

// a fixed, made-up run of candles for the drawing in A: [open, close, high, low] on a 0..100 scale
const ART = [[40, 46, 49, 37], [46, 43, 48, 40], [43, 50, 53, 41], [50, 55, 58, 48], [55, 52, 57, 49], [52, 58, 61, 50], [58, 54, 60, 51], [54, 60, 63, 53], [60, 57, 62, 55], [57, 64, 66, 56], [64, 61, 66, 58], [61, 67, 70, 60], [67, 63, 69, 61], [63, 70, 73, 62], [70, 68, 72, 65], [66, 78, 80, 65]]

function ChartArt() {
  const W = 420, H = 210, n = ART.length, cw = W / (n + 2)
  const y = (v) => H - 16 - ((v - 34) / (82 - 34)) * (H - 56)          // the drawing's own range fills the frame
  // a smooth average through the closes, so it reads as a chart and not a row of dots
  const avg = ART.map((_, i) => { const w = ART.slice(Math.max(0, i - 3), i + 1); return w.reduce((t, c) => t + c[1], 0) / w.length })
  const avgPath = avg.map((v, i) => `${i ? 'L' : 'M'} ${cw * (i + 1)} ${y(v)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={st.art} aria-hidden="true" focusable="false">
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className={st.artGrid} />)}
      <path d={avgPath} className={st.artAvg} />
      {ART.map(([o, c, hi, lo], i) => {
        const x = cw * (i + 1), up = c >= o, last = i === n - 1
        return (
          <g key={i} className={`${st.artCandle} ${up ? st.artUp : st.artDn} ${last ? st.artLast : ''}`} style={{ '--i': i }}>
            <line x1={x} x2={x} y1={y(hi)} y2={y(lo)} />
            <rect x={x - cw * 0.3} y={y(Math.max(o, c))} width={cw * 0.6} height={Math.max(2, y(Math.min(o, c)) - y(Math.max(o, c)))} rx="1.5" />
          </g>
        )
      })}
      <g className={st.artRing} style={{ '--i': n }}>
        <rect x={cw * n - cw * 0.62} y={y(80) - 10} width={cw * 1.24} height={y(65) - y(80) + 20} rx="8" />
        <text x={cw * n} y={y(80) - 22}>?</text>
      </g>
    </svg>
  )
}

/** A · Arena. In the product (round 22): `label` says what the button can do while the bank loads, Enter starts, and the
 *  test ids are the ones Hard mode's intro always carried. */
export function StartArena({ total = 8, ready = true, onStart, label = null, testId = null, startTestId = null, hotkey = false }) {
  useEffect(() => {
    if (!hotkey || !ready) return undefined
    const k = (e) => { if (e.key === 'Enter' && !e.repeat && !(e.target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName))) onStart?.() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [hotkey, ready, onStart])
  return (
    <div className={`${st.start} ${st.arena}`} data-testid={testId || undefined}>
      <div className={st.aCard}>
        <span className={st.aPlate}>Hard</span>
        <ChartArt />
        <span className={st.aCaption}>What fired on the last candle?</span>
      </div>
      <div className={st.aTitle}>Hard mode</div>
      <div className={st.aStakes}><b>{total} charts</b><i /> no ticker<i /> one try each</div>
      <div className={st.aReward}><Medal size={40} testId={null} /><span><b>{total} for {total}</b> lights the Legendary medal</span></div>
      <button type="button" className={st.go} disabled={!ready} onClick={onStart} data-testid={startTestId || undefined}>{label || (ready ? 'Start' : 'Loading the charts')}<UIcon name="chevronRight" size={20} gold={false} /></button>
    </div>
  )
}

/** B · Legendary */
export function StartLegendary({ total = 8, ready = true, onStart, onBack }) {
  return (
    <div className={`${st.start} ${st.legend}`}>
      <div className={st.lHero}><i className={st.lGlow} aria-hidden="true" /><Medal size={150} testId={null} /></div>
      <span className={st.lEyebrow}>Hard mode · {total} charts</span>
      <div className={st.lTitle}>Go Legendary</div>
      <p className={st.lStakes}>Name {total} charts without their tickers. Miss one and the medal stays dark for this run.</p>
      <div className={st.lRules}>
        <span><UIcon name="lock" size={15} gold={false} />No ticker</span>
        <span><UIcon name="chart" size={15} gold={false} />Your own chart</span>
        <span><UIcon name="flag" size={15} gold={false} />Name it, or say nothing fired</span>
      </div>
      <div className={st.lFoot}>
        <button type="button" className={`${st.go} ${st.wide}`} disabled={!ready} onClick={onStart}>{ready ? 'Start' : 'Loading the charts'}</button>
        <button type="button" className={st.later} onClick={onBack}>Not now</button>
      </div>
    </div>
  )
}

/** C · Briefing */
export function StartBriefing({ total = 8, ready = true, onStart }) {
  return (
    <div className={`${st.start} ${st.brief}`}>
      <div className={st.bLeft}>
        <span className={st.bEyebrow}>Mission · Hard mode</span>
        <div className={st.bTitle}>Name {total} charts blind</div>
        <ol className={st.bList}>
          <li><b>The ticker is hidden.</b> You see your own chart, with your own averages and volume.</li>
          <li><b>Read the last candle.</b> Name the setup that fired on it, or say nothing did.</li>
          <li><b>One try each.</b> The ticker and the move after it show once you answer.</li>
        </ol>
        <div className={st.bReward}><Medal size={34} testId={null} /><span><b>{total} for {total}</b> lights the Legendary medal</span></div>
        <button type="button" className={st.go} disabled={!ready} onClick={onStart}>{ready ? 'Deal the charts' : 'Loading the charts'}<UIcon name="chevronRight" size={20} gold={false} /></button>
      </div>
      <div className={st.bDeck} aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={st.bCard} style={{ '--i': i, '--n': total }}>
            <i className={st.bCardLock}><UIcon name="lock" size={14} gold={false} /></i>
            <svg viewBox="0 0 60 30" className={st.bSpark}><polyline points="2,24 10,20 16,22 24,14 30,17 38,10 46,12 58,4" /></svg>
            <em>{i + 1}</em>
          </span>
        ))}
        <b className={st.bCount}>{total}</b>
      </div>
    </div>
  )
}


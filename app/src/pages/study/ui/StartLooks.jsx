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
import { Fragment, useEffect } from 'react'
import { Medal } from './Medal'
import UIcon from '../../../components/ui/UIcon'
import StudyButton from './StudyButton'
import brandMark from '../../../components/intro/assets/compass-mark.png'
import st from './startLooks.module.css'

// a fixed, made-up run of candles for the drawing in A: [open, close, high, low] on a 0..100 scale
const ART = [[40, 46, 49, 37], [46, 43, 48, 40], [43, 50, 53, 41], [50, 55, 58, 48], [55, 52, 57, 49], [52, 58, 61, 50], [58, 54, 60, 51], [54, 60, 63, 53], [60, 57, 62, 55], [57, 64, 66, 56], [64, 61, 66, 58], [61, 67, 70, 60], [67, 63, 69, 61], [63, 70, 73, 62], [70, 68, 72, 65], [66, 78, 80, 65]]

/** The drawing in A (rebuilt 2026-11-08 on the owner's batch-24 "Weak"): the member's own chart widget in miniature (the
 *  three averages in the widget's colours, volume underneath with the last bar in gold, our mark at the corner) and the
 *  game's own pointer, a pill in open space with a leader to the ringed last candle, carrying the mode's question. */
function ChartArt({ caption = '' }) {
  const W = 420, H = 236, n = ART.length, cw = W / (n + 2)
  const y = (v) => 176 - ((v - 34) / (82 - 34)) * 118          // price area 58..176; volume below
  const avg = (len) => ART.map((_, i) => { const w = ART.slice(Math.max(0, i - len + 1), i + 1); return w.reduce((t, c) => t + c[1], 0) / w.length })
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'} ${(cw * (i + 1)).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const vol = ART.map(([, , hi, lo], i) => (i === n - 1 ? 30 : 6 + ((hi - lo) * 2.2 + (i % 3) * 2)))
  const text = String(caption || '').toUpperCase()
  const pw = Math.min(W - 40, text.length * 8.6 + 34), px0 = Math.max(12, cw * n - 40 - pw), ring = { x: cw * n, top: y(80) - 10 }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={st.art} aria-hidden="true" focusable="false">
      {[78, 118, 158].map((g) => <line key={g} x1="0" x2={W} y1={g} y2={g} className={st.artGrid} />)}
      <path d={path(avg(9))} className={`${st.artAvg} ${st.ma50}`} />
      <path d={path(avg(5))} className={`${st.artAvg} ${st.ma20}`} />
      <path d={path(avg(3))} className={`${st.artAvg} ${st.ma9}`} />
      {ART.map(([o, c, hi, lo], i) => {
        const x = cw * (i + 1), up = c >= o, last = i === n - 1
        return (
          <g key={i} className={`${st.artCandle} ${up ? st.artUp : st.artDn} ${last ? st.artLast : ''}`} style={{ '--i': i }}>
            <line x1={x} x2={x} y1={y(hi)} y2={y(lo)} />
            <rect x={x - cw * 0.3} y={y(Math.max(o, c))} width={cw * 0.6} height={Math.max(2, y(Math.min(o, c)) - y(Math.max(o, c)))} rx="1.5" />
            <rect className={st.artVol} x={x - cw * 0.3} y={H - 6 - vol[i]} width={cw * 0.6} height={vol[i]} rx="1" />
          </g>
        )
      })}
      <defs>
        <linearGradient id="artSpot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2c4" stopOpacity=".02" />
          <stop offset="1" stopColor="#f6e2a0" stopOpacity=".34" />
        </linearGradient>
      </defs>
      <polygon className={st.artSpot} points={`${ring.x - 4},0 ${ring.x + 4},0 ${ring.x + cw * 1.5},${ring.top + 46} ${ring.x - cw * 1.5},${ring.top + 46}`} fill="url(#artSpot)" />
      <g className={st.artRing} style={{ '--i': n }}>
        <rect x={ring.x - cw * 0.62} y={ring.top} width={cw * 1.24} height={y(65) - y(80) + 20} rx="8" />
      </g>
      {text ? (
        <g className={st.artPill} style={{ '--i': n + 2 }}>
          <path d={`M ${px0 + pw} 30 L ${ring.x - cw * 0.7} ${ring.top - 2}`} className={st.artLeader} />
          <rect x={px0} y={14} width={pw} height={30} rx={15} />
          <text x={px0 + pw / 2} y={33.5}>{text}</text>
        </g>
      ) : null}
      <image href={brandMark} x="10" y={H - 30} width="22" height="22" opacity=".8" />
    </svg>
  )
}

const asChip = (x) => (x && typeof x === 'object' ? x : { v: x, l: '' })

/** A · Arena. In the product (round 22): `label` says what the button can do while the bank loads, Enter starts, and the
 *  test ids are the ones Hard mode's intro always carried. Since 2026-11-08 every mode opens on it (the owner: "Need all
 *  the design templates and graphics to be uniform throughout each section!"): the plate, the title, the caption under
 *  the drawing, the stakes, one lead line and the reward are the mode's own; the defaults are Hard mode's. */
export function StartArena({ total = 8, ready = true, onStart, label = null, testId = null, startTestId = null, hotkey = false,
  plate = 'Hard', title = 'Hard mode', caption = 'What fired on the last candle?', stakes = null, lead = null, reward = undefined, howTo = null, children = null }) {
  useEffect(() => {
    if (!hotkey || !ready) return undefined
    const k = (e) => { if (e.key === 'Enter' && !e.repeat && !(e.target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName))) onStart?.() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [hotkey, ready, onStart])
  const chips = (stakes || [{ v: total, l: 'charts', icon: 'play' }, { v: 'No', l: 'ticker', icon: 'lock' }, { v: 1, l: 'try each', icon: 'check' }]).map(asChip)
  const prize = reward === undefined ? <><Medal size={40} testId={null} /><span><b>{total} for {total}</b> lights the Legendary medal</span></> : reward
  return (
    <div className={`${st.start} ${st.arena}`} data-testid={testId || undefined}>
      <div className={st.aCard}>
        <span className={st.aPlate}>{plate}</span>
        <ChartArt caption={caption} />
      </div>
      <span className={st.aEyebrow}><i />UCT Study · Challenge<i /></span>
      <div className={st.aTitle} data-text={title}>{title}</div>
      <div className={st.aChips}>
        {chips.map((c, i) => <span key={i} className={st.aChip} style={{ '--i': i }}>{c.icon ? <i className={st.aChipIcon}><UIcon name={c.icon} size={15} gold={false} /></i> : null}<b>{c.v}</b><small>{c.l}</small></span>)}
      </div>
      {lead ? <p className={st.aLead}>{lead}</p> : null}
      {prize ? <div className={st.aReward}>{prize}</div> : null}
      {howTo}
      <div className={st.aGo}>
        <StudyButton kind="primary" size="xl" arrow wide disabled={!ready} onClick={onStart} testId={startTestId}>{label || (ready ? 'Start' : 'Loading the charts')}</StudyButton>
      </div>
      {children ? <div className={st.aMore}>{children}</div> : null}
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


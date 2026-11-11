import { useEffect, useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import StartCard, { StartButton } from '../StartCard'
import { BossBar, Chest, Confetti, Heart, Medal, Stamp } from '../bits'
import { useCountUp, useRunOn } from '../fx'
import { useSample } from '../Lab'
import { spot, rayAt } from '../pointers'
import { sfx, voice } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'
import { XP } from '../rewards'

const POOL = [
  { sample: 'JBI_2023-12-14', answer: 'Kicker' }, { sample: 'HAS_2023-02-02', answer: 'Slingshot' }, { sample: 'MSTR_2023-10-23', answer: 'Launchpad' },
]
const NAMES = ['Kicker', 'Slingshot', 'Launchpad', 'None of these']
const TOTAL = 10

/** Round 10, piece 3: BOSS V2 (owner, batch 9: "the animations and graphics can be improved significantly").
 *  The boss has a bar that loses a segment on every right answer; the one heart beats, faster as you go; each
 *  question slides in with its cards cascading; on Check the verdict stamps the chart and the chart runs on bar
 *  by bar; a miss shakes the screen, cracks the heart and drops it, and the red closes in. Win: the medallion
 *  flips in, the chest opens, the XP counts up. */
function Q({ idx, onDone }) {
  const q = POOL[idx % POOL.length]
  const d = useSample(q.sample)
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')
  const bars = d?.visible
  const n = bars?.length || 0
  const all = useRunOn(bars, d?.forward, state === 'ok')
  const order = useMemo(() => { const r = (idx * 5) % 4; return [...NAMES.slice(r), ...NAMES.slice(0, r)] }, [idx])
  const ann = useMemo(() => (!n || !all ? null : state === 'ask' ? spot(all, n - 1, { label: 'this candle', id: `b${idx}` }) : [...spot(all, n - 1, { label: 'the trigger', id: `b${idx}`, color: state === 'ok' ? '#2faf68' : '#df4646' }), ...rayAt(bars[n - 1], 'l', { id: `b${idx}l`, label: 'the line' })]), [all, bars, n, state, idx])
  const check = () => { const ok = order[pick] === q.answer; setState(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong') }
  useEffect(() => {
    const k = (e) => { if (state !== 'ask') { if (e.key === 'Enter') onDone(state === 'ok', q.answer); return } if (/^[1-4]$/.test(e.key)) setPick(+e.key - 1); if (e.key === 'Enter' && pick != null) check() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const gone = idx + (state === 'ok' ? 1 : 0)
  return (
    <div className={`${d5.lesson} ${d5.slideIn} ${state === 'bad' ? d5.shakeHard : ''}`}>
      {state === 'bad' ? <div className={d5.vignetteRed} /> : null}
      <div className={d5.bossTop}><span className={d5.bossLabel}>Boss · {idx + 1} of {TOTAL}</span><BossBar total={TOTAL} gone={gone} /><Heart size={30} bpm={56 + idx * 9} cracked={state === 'bad'} /></div>
      <div className={d5.ask}><Logo mood={state === 'ask' ? (pick != null ? 'think' : 'idle') : state === 'ok' ? 'happy' : 'oops'} size={64} /><div className={d5.bubble}>{state === 'ask' ? 'One heart. What setup, if any, just fired on this candle?' : state === 'ok' ? 'Still standing. Watch it run.' : 'That was the heart.'}</div></div>
      <div className={s.chartBox}>{state !== 'ask' ? <Stamp ok={state === 'ok'} /> : null}<WidgetChart sym={d.sym} bars={all} annotations={ann} height={420} density="compact" defaultBars={90} /></div>
      <div className={`${d5.cards} ${d5.cascade}`}>{order.map((c, k) => { let cls = d5.card; if (state === 'ask' && pick === k) cls += ` ${d5.sel}`; if (state !== 'ask' && c === q.answer) cls += ` ${d5.right}`; if (state === 'bad' && pick === k) cls += ` ${d5.wrong}`; return <button key={c} type="button" className={cls} style={{ '--i': k }} disabled={state !== 'ask'} onClick={() => setPick(k)}><span className={d5.key}>{k + 1}</span>{c}</button> })}</div>
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${pick != null ? d5.live : ''}`} disabled={pick == null} onClick={check}>Check</button>
          : <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => onDone(state === 'ok', q.answer)}>{state === 'ok' ? (idx + 1 < TOTAL ? 'Next' : 'Claim the trophy') : 'See what to review'}</button>}
      </div></div>
    </div>
  )
}

function Win({ onBack }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { const t = setTimeout(() => { setOpen(true); sfx('chest') }, 900); return () => clearTimeout(t) }, [])
  const xp = useCountUp(XP.BOSS, true, 28)
  return (
    <div className={d5.lesson}><Confetti />
      <StartCard eyebrow="Unit 2 · Candles that trap" title="Unit cleared" art={<div className={d5.winRow}><Medal size={130} won label="2" /><Chest size={120} open={open} /></div>}
        lead="Ten for ten with one heart. That is a trader."
        button={<StartButton icon="play" label="Back to the path" sub="the next unit is open" onClick={onBack} />}>
        <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>Boss bonus</small><b>+{xp}</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}>▣</span><small>Chest</small><b>{open ? 'Open' : 'Opening'}</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}>♛</span><small>Unit 2</small><b>Trophy</b></div></div></div>
      </StartCard>
    </div>
  )
}

export default function Piece48BossV2() {
  const [phase, setPhase] = useState('intro')
  const [i, setI] = useState(0)
  const [missed, setMissed] = useState(null)
  const start = () => { setPhase('play'); setI(0); setMissed(null) }
  if (phase === 'intro') {
    return (
      <div className={d5.lesson}><div className={`${d5.vignetteRed} ${d5.soft}`} />
        <StartCard tone="red" eyebrow="Unit 2 · Candles that trap" title="Boss lesson" art={<div className={d5.winRow}><Medal size={110} label="2" /><div className={d5.heartBig}><Heart size={64} bpm={64} /></div></div>}
          lead="Ten charts. One heart. Miss once and it ends. Pass and the unit trophy and a chest are yours."
          button={<StartButton tone="red" icon="medal" label="Face the boss" sub="ten charts · one heart · +150 XP" onClick={start} />}>
          <div className={d5.gems}><div className={`${d5.gem} ${d5.dim}`}><div className={d5.gemIn}><span className={d5.gemIcon} style={{ color: '#ff6b6b' }}>♥</span><small>Hearts</small><b>1</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>On a pass</small><b>+{XP.BOSS} XP</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}>▣</span><small>Plus</small><b>a chest</b></div></div></div>
        </StartCard>
      </div>
    )
  }
  if (phase === 'win') return <Win onBack={() => setPhase('intro')} />
  if (phase === 'fail') {
    return (
      <div className={d5.lesson}><div className={`${d5.vignetteRed} ${d5.soft}`} />
        <StartCard tone="red" eyebrow={`Fell on chart ${i + 1} of ${TOTAL}`} title="Not yet" art={<div className={d5.heartBig}><Heart size={84} broken /></div>}
          lead={`The one you missed was a ${missed}. A boss needs every rule cold: the real red day, the open above the body, the strong close, the line.`}
          button={<StartButton tone="red" icon="medal" label="Try the boss again" sub="ten charts · one heart" onClick={start} />}>
          <div className={d5.nextCard} style={{ maxWidth: 'none', width: '100%' }}><small>REVIEW FIRST</small><b>{missed} · Practice</b><span>five charts, hearts on, about three minutes</span></div>
        </StartCard>
      </div>
    )
  }
  return <Q key={i} idx={i} onDone={(ok, ans) => { if (!ok) { setMissed(ans); setPhase('fail'); voice('boss_fail'); return } if (i + 1 >= TOTAL) { setPhase('win'); sfx('levelup'); voice('boss_win') } else setI(i + 1) }} />
}

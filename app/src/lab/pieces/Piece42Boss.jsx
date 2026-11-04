import { useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
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

/** Round 9, piece 2: THE BOSS LESSON at the end of a unit. Ten charts, ONE heart: a single miss ends it and the
 *  failure screen names what to review. Pass all ten and the unit trophy opens with a chest. */
function Q({ idx, onDone }) {
  const q = POOL[idx % POOL.length]
  const d = useSample(q.sample)
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')
  const bars = d?.visible
  const n = bars?.length || 0
  const all = useMemo(() => (bars && state !== 'ask' && d?.forward ? [...bars, ...d.forward] : bars), [bars, d, state])
  const order = useMemo(() => { const r = (idx * 5) % 4; return [...NAMES.slice(r), ...NAMES.slice(0, r)] }, [idx])
  const ann = useMemo(() => (!n || !all ? null : state === 'ask' ? spot(all, n - 1, { label: 'this candle', id: `b${idx}` }) : [...spot(all, n - 1, { label: 'the trigger', id: `b${idx}`, color: '#2faf68' }), ...rayAt(bars[n - 1], 'l', { id: `b${idx}l`, label: 'the line' })]), [all, bars, n, state, idx])
  const check = () => { const ok = order[pick] === q.answer; setState(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong') }
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  return (
    <div className={`${d5.lesson} ${d5.slideIn}`}>
      <div className={d5.topbar}><span className={d5.eyebrowG}>Boss · {idx + 1} of {TOTAL}</span><div className={d5.prog}>{Array.from({ length: TOTAL }, (_, k) => <i key={k} className={k < idx || (k === idx && state === 'ok') ? d5.on : k === idx ? d5.cur : ''} />)}</div><div className={d5.hearts}><span>♥</span><span className={d5.lost}>♥</span><span className={d5.lost}>♥</span></div></div>
      <div className={d5.ask}><Logo mood={state === 'ask' ? (pick != null ? 'think' : 'idle') : state === 'ok' ? 'happy' : 'oops'} size={72} /><div className={d5.bubble}>{state === 'ask' ? 'One heart. What setup, if any, just fired on this candle?' : state === 'ok' ? 'Still standing.' : 'That was the heart.'}</div></div>
      <div className={s.chartBox}><WidgetChart sym={d.sym} bars={all} annotations={ann} height={420} density="compact" defaultBars={90} /></div>
      <div className={d5.cards}>{order.map((c, k) => { let cls = d5.card; if (state === 'ask' && pick === k) cls += ` ${d5.sel}`; if (state !== 'ask' && c === q.answer) cls += ` ${d5.right}`; if (state === 'bad' && pick === k) cls += ` ${d5.wrong}`; return <button key={c} type="button" className={cls} disabled={state !== 'ask'} onClick={() => setPick(k)}><span className={d5.key}>{k + 1}</span>{c}</button> })}</div>
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${pick != null ? d5.live : ''}`} disabled={pick == null} onClick={check}>Check</button>
          : <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => onDone(state === 'ok', q.answer)}>{state === 'ok' ? (idx + 1 < TOTAL ? 'Next' : 'Claim the trophy') : 'See what to review'}</button>}
      </div></div>
    </div>
  )
}

export default function Piece42Boss() {
  const [phase, setPhase] = useState('intro')
  const [i, setI] = useState(0)
  const [missed, setMissed] = useState(null)
  const start = () => { setPhase('play'); setI(0); setMissed(null) }
  if (phase === 'intro') {
    return (
      <div className={d5.lesson}><div className={d5.intro}><div className={d5.bossBadge}>🏆</div><div className={d5.eyebrowG}>Unit 2 · Candles that trap</div><div className={d5.heroWord}>Boss lesson</div>
        <p className={d5.screenSub}>Ten charts. One heart. Miss once and it ends. Pass and the unit trophy and a chest are yours.</p>
        <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>♥</span><small>Hearts</small><b>1</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>On a pass</small><b>+{XP.BOSS} XP</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}>🎁</span><small>Plus</small><b>a chest</b></div></div></div></div>
        <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={start}>I'm ready</button></div></div></div>
    )
  }
  if (phase === 'win') {
    return (
      <div className={`${d5.lesson} ${d5.slideIn}`}><div className={d5.screen}><div className={`${d5.bossBadge} ${d5.won}`}>🏆</div><div className={d5.heroWord}>Unit cleared</div>
        <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>Boss bonus</small><b>+{XP.BOSS}</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}>🎁</span><small>Chest</small><b>Open</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}>♛</span><small>Unit 2</small><b>Trophy</b></div></div></div>
        <p className={d5.screenSub}>Ten for ten with one heart. That's a trader.</p></div>
        <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={() => setPhase('intro')}>Back to the path</button></div></div></div>
    )
  }
  if (phase === 'fail') {
    return (
      <div className={`${d5.lesson} ${d5.slideIn}`}><div className={d5.screen}><Logo mood="oops" size={110} /><div className={d5.heroWord} style={{ background: 'none', color: '#ff9d9d' }}>Not yet</div>
        <p className={d5.screenSub}>You fell on chart {i + 1} of {TOTAL}. The one you missed was a {missed}.</p>
        <div className={d5.fixCard}><b>Review before you retry</b><span>{missed} · Learn 2 and Practice. A boss needs every rule cold: the real red day, the open above the body, the strong close, the line.</span></div>
        <div className={d5.nextCard}><small>REVIEW</small><b>{missed} · Practice</b><span>five charts, hearts on, about three minutes</span></div></div>
        <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={start}>Try the boss again</button></div></div></div>
    )
  }
  return <Q key={i} idx={i} onDone={(ok, ans) => { if (!ok) { setMissed(ans); setPhase('fail'); voice('boss_fail'); return } if (i + 1 >= TOTAL) { setPhase('win'); sfx('levelup'); voice('boss_win') } else setI(i + 1) }} />
}

import { useEffect, useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import { useSample } from '../Lab'
import { spot, rayAt } from '../pointers'
import { sfx } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'
import { XP } from '../rewards'

/** Round 8, piece 3: THE DAILY SET. Five charts, the same for every member today, a clock per question, and the
 *  day's leaderboard with your rank when you finish. The five here reuse the three stored charts (the real
 *  daily set draws five fresh approved items from the bank). Names on the board are placeholders. */
const SET = [
  { sample: 'JBI_2023-12-14', choices: ['Launchpad', 'Kicker', 'Slingshot', 'None of these'], answer: 1 },
  { sample: 'HAS_2023-02-02', choices: ['Slingshot', 'None of these', 'Kicker', 'Launchpad'], answer: 0 },
  { sample: 'MSTR_2023-10-23', choices: ['None of these', 'Kicker', 'Launchpad', 'Slingshot'], answer: 2 },
  { sample: 'HAS_2023-02-02', choices: ['Kicker', 'Slingshot', 'Launchpad', 'None of these'], answer: 1 },
  { sample: 'JBI_2023-12-14', choices: ['Slingshot', 'Launchpad', 'None of these', 'Kicker'], answer: 3 },
]
const BOARD = [['Trader 0412', 148], ['Trader 0077', 141], ['Trader 1193', 133], ['Trader 0890', 120], ['Trader 0301', 112], ['Trader 0655', 98], ['Trader 0218', 90]]
const CLOCK = 20

function Q({ i, onDone }) {
  const d = useSample(SET[i].sample)
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')
  const [left, setLeft] = useState(CLOCK)
  const bars = d?.visible
  const n = bars?.length || 0
  const all = useMemo(() => (bars && state !== 'ask' && d?.forward ? [...bars, ...d.forward] : bars), [bars, d, state])
  const annotations = useMemo(() => (!n || !all ? null : state === 'ask' ? spot(all, n - 1, { label: 'this candle', id: `d${i}` }) : [...spot(all, n - 1, { label: 'the trigger', id: `d${i}`, color: '#2faf68' }), ...rayAt(bars[n - 1], 'l', { id: `d${i}l`, label: 'the line' })]), [all, bars, n, state, i])
  useEffect(() => {
    if (state !== 'ask' || !d) return undefined
    const t = setInterval(() => setLeft((v) => { if (v <= 1) { clearInterval(t); setState('bad'); sfx('wrong'); return 0 } return v - 1 }), 1000)
    return () => clearInterval(t)
  }, [state, d])
  const check = () => { const ok = pick === SET[i].answer; setState(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong') }
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const pts = state === 'ok' ? XP.RIGHT + Math.round(left / 2) * XP.DAILY_SPEED_PER_2S : 0
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><span className={d5.eyebrowG}>Daily set · {i + 1} of 5</span><div className={d5.prog}>{Array.from({ length: 5 }, (_, k) => <i key={k} className={k < i || (k === i && state !== 'ask') ? d5.on : k === i ? d5.cur : ''} />)}</div><span className={`${d5.clock} ${left <= 5 ? d5.hot : ''}`}>⏱ {left}s</span></div>
      <div className={d5.ask}><Logo mood={state === 'ask' ? (pick != null ? 'think' : 'idle') : state === 'ok' ? 'happy' : 'oops'} size={72} /><div className={d5.bubble}>{state === 'ask' ? 'What setup, if any, just fired on this candle?' : state === 'ok' ? `Right. +${pts} XP, ${left}s to spare.` : left === 0 ? 'Time. The clock beat you.' : 'Not that one.'}</div></div>
      <div className={s.chartBox}><WidgetChart sym={d.sym} bars={all} annotations={annotations} height={440} density="compact" defaultBars={90} /></div>
      <div className={d5.cards}>{SET[i].choices.map((c, k) => { let cls = d5.card; if (state === 'ask' && pick === k) cls += ` ${d5.sel}`; if (state !== 'ask' && k === SET[i].answer) cls += ` ${d5.right}`; if (state === 'bad' && pick === k) cls += ` ${d5.wrong}`; return <button key={c} type="button" className={cls} disabled={state !== 'ask'} onClick={() => setPick(k)}><span className={d5.key}>{k + 1}</span>{c}</button> })}</div>
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${pick != null ? d5.live : ''}`} disabled={pick == null} onClick={check}>Check</button>
          : <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => onDone(pts)}>{i < 4 ? 'Next' : 'See the board'}</button>}
      </div></div>
    </div>
  )
}

export default function Piece38DailySet() {
  const [i, setI] = useState(-1)
  const [score, setScore] = useState(0)
  const [run, setRun] = useState(0)
  if (i === -1) {
    return (
      <div className={d5.lesson}>
        <div className={d5.intro}>
          <Logo mood="idle" size={110} />
          <div className={d5.eyebrowG}>Daily set · Monday</div>
          <div className={d5.heroWord}>Five charts, one shot</div>
          <p className={d5.screenSub}>The same five for every member today. Twenty seconds a chart. Points for right and for fast. The board resets at midnight ET.</p>
          <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>👥</span><small>Played today</small><b>{BOARD.length + 12}</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}>🏆</span><small>Top score</small><b>{BOARD[0][1]}</b></div></div></div>
        </div>
        <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={() => { setI(0); setScore(0); setRun((r) => r + 1) }}>Start today's set</button></div></div>
      </div>
    )
  }
  if (i >= 5) {
    const rows = [...BOARD, ['You', score]].sort((a, b) => b[1] - a[1])
    const rank = rows.findIndex((r) => r[0] === 'You') + 1
    return (
      <div className={d5.lesson}>
        <div className={d5.screen}><Logo mood={rank <= 3 ? 'fire' : 'happy'} size={100} /><div className={d5.heroWord}>#{rank} today</div>
          <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>Your score</small><b>{score}</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}>🏆</span><small>Rank</small><b>{rank} / {rows.length}</b></div></div></div>
          <div className={d5.league} style={{ width: '100%', maxWidth: 460 }}>{rows.map(([nme, x], k) => <div key={nme} className={`${d5.lrow} ${nme === 'You' ? d5.me : ''}`}><span>{k + 1}</span><b>{nme}</b><em>{x}</em></div>)}</div>
          <p className={d5.screenSub}>Names are placeholders until the board is live.</p></div>
        <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={() => setI(-1)}>Done</button></div></div>
      </div>
    )
  }
  return <Q key={`${run}-${i}`} i={i} onDone={(pts) => { setScore((v) => v + pts); setI((v) => v + 1) }} />
}

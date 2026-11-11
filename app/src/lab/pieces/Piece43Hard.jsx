import { useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import { useSample } from '../Lab'
import { spot, rayAt } from '../pointers'
import { studySettingsOverride } from '../../pages/study/studyChartLook'
import { sfx } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'
import { XP } from '../rewards'

// Hard mode strips the chart to candles: no averages, no volume, no watermark, no identity row. One stable object.
const HARD = { settingsOverride: studySettingsOverride({ overlays: false, volume: false }), hideWatermark: true, hideLegend: true }
const QUESTIONS = [
  { sample: 'JBI_2023-12-14', choices: ['Launchpad', 'Kicker', 'Slingshot', 'None of these'], answer: 1 },
  { sample: 'HAS_2023-02-02', choices: ['Slingshot', 'None of these', 'Kicker', 'Launchpad'], answer: 0 },
  { sample: 'MSTR_2023-10-23', choices: ['None of these', 'Kicker', 'Launchpad', 'Slingshot'], answer: 2 },
]

/** Round 9, piece 3: HARD MODE. Ticker hidden, averages hidden, volume hidden, candles only, and a legendary
 *  fourth crown for a perfect run. The chart is still the real widget, stripped by a settings override. */
function Q({ idx, onDone }) {
  const q = QUESTIONS[idx]
  const d = useSample(q.sample)
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')
  const bars = d?.visible
  const n = bars?.length || 0
  const all = useMemo(() => (bars && state !== 'ask' && d?.forward ? [...bars, ...d.forward] : bars), [bars, d, state])
  const ann = useMemo(() => (!n || !all ? null : state === 'ask' ? spot(all, n - 1, { label: 'this candle', id: `h${idx}` }) : [...spot(all, n - 1, { label: 'the trigger', id: `h${idx}`, color: '#2faf68' }), ...rayAt(bars[n - 1], 'l', { id: `h${idx}l`, label: 'the line' })]), [all, bars, n, state, idx])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  return (
    <div className={`${d5.lesson} ${d5.slideIn}`}>
      <div className={d5.topbar}><span className={d5.hardTag}>HARD</span><div className={d5.prog}>{QUESTIONS.map((_, k) => <i key={k} className={k < idx || (k === idx && state !== 'ask') ? d5.on : k === idx ? d5.cur : ''} />)}</div><span className={d5.legend}>♛♛♛<b>♛</b></span></div>
      <div className={d5.ask}><Logo mood={state === 'ask' ? (pick != null ? 'think' : 'idle') : state === 'ok' ? 'happy' : 'oops'} size={72} /><div className={d5.bubble}>{state === 'ask' ? 'Candles only. What setup, if any, just fired?' : state === 'ok' ? 'You read the candles.' : 'Not that one.'}</div></div>
      <div className={s.chartBox}><WidgetChart sym={d.sym} bars={all} annotations={ann} height={440} density="mini" defaultBars={90} hideTicker extra={HARD} /></div>
      <div className={d5.cards}>{q.choices.map((c, k) => { let cls = d5.card; if (state === 'ask' && pick === k) cls += ` ${d5.sel}`; if (state !== 'ask' && k === q.answer) cls += ` ${d5.right}`; if (state === 'bad' && pick === k) cls += ` ${d5.wrong}`; return <button key={c} type="button" className={cls} disabled={state !== 'ask'} onClick={() => setPick(k)}><span className={d5.key}>{k + 1}</span>{c}</button> })}</div>
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${pick != null ? d5.live : ''}`} disabled={pick == null} onClick={() => { const ok = pick === q.answer; setState(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong') }}>Check</button>
          : <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => onDone(state === 'ok')}>{idx + 1 < QUESTIONS.length ? 'Next' : 'Finish'}</button>}
      </div></div>
    </div>
  )
}

export default function Piece43Hard() {
  const [phase, setPhase] = useState('intro')
  const [i, setI] = useState(0)
  const [right, setRight] = useState(0)
  const start = () => { setPhase('play'); setI(0); setRight(0) }
  if (phase === 'intro') {
    return (
      <div className={d5.lesson}><div className={d5.intro}><div className={d5.legendBig}>♛</div><div className={d5.eyebrowG}>Kicker · Learn 2</div><div className={d5.heroWord}>Hard mode</div>
        <p className={d5.screenSub}>No ticker. No averages. No volume. Just the candles. A perfect run earns the legendary fourth crown.</p>
        <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>♛</span><small>On a perfect run</small><b>Legendary</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>XP</small><b>x{XP.HARD_MULT}</b></div></div></div></div>
        <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={start}>Start hard mode</button></div></div></div>
    )
  }
  if (phase === 'done') {
    const perfect = right === QUESTIONS.length
    return (
      <div className={`${d5.lesson} ${d5.slideIn}`}><div className={d5.screen}><div className={`${d5.legendBig} ${perfect ? d5.won : ''}`}>♛</div><div className={d5.heroWord}>{perfect ? 'Legendary' : `${right} of ${QUESTIONS.length}`}</div>
        <p className={d5.screenSub}>{perfect ? 'Every candle read right with nothing to lean on. The fourth crown is yours.' : 'A perfect run is needed for the fourth crown. Try again.'}</p>
        <div className={d5.gems}><div className={`${d5.gem} ${perfect ? '' : d5.dim}`}><div className={d5.gemIn}><span className={d5.gemIcon}>♛</span><small>Kicker · Learn 2</small><b>{perfect ? '4 crowns' : '3 crowns'}</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>XP</small><b>+{right * XP.RIGHT * XP.HARD_MULT}</b></div></div></div></div>
        <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={start}>Again</button></div></div></div>
    )
  }
  return <Q key={i} idx={i} onDone={(ok) => { if (ok) setRight((v) => v + 1); if (i + 1 < QUESTIONS.length) setI(i + 1); else { setPhase('done'); sfx(right + (ok ? 1 : 0) === QUESTIONS.length ? 'levelup' : 'streak') } }} />
}

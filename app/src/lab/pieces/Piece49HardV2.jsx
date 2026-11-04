import { useEffect, useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import StartCard, { StartButton } from '../StartCard'
import { Confetti, Stamp } from '../bits'
import { useRunOn } from '../fx'
import { useSample } from '../Lab'
import { spot, rayAt } from '../pointers'
import { studySettingsOverride } from '../../pages/study/studyChartLook'
import { sfx } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'
import { XP } from '../rewards'

// Hard mode strips the chart to candles: no averages, no volume pane, no watermark, no identity row. One stable object.
const HARD = { settingsOverride: studySettingsOverride({ overlays: false, volume: false }), hideWatermark: true, hideLegend: true, showVolume: false }
const QUESTIONS = [
  { sample: 'JBI_2023-12-14', choices: ['Launchpad', 'Kicker', 'Slingshot', 'None of these'], answer: 1 },
  { sample: 'HAS_2023-02-02', choices: ['Slingshot', 'None of these', 'Kicker', 'Launchpad'], answer: 0 },
  { sample: 'MSTR_2023-10-23', choices: ['None of these', 'Kicker', 'Launchpad', 'Slingshot'], answer: 2 },
]

/** Round 10, piece 4: HARD MODE V2 (owner, batch 9: "same graphics complaint", "the START BUTTON can be
 *  significantly better and cleaner"). Lights out: a dark start card with three lit crowns and a dim fourth that
 *  ignites on a perfect run; the HARD tag pulses. On the first chart the full look is shown for a beat, then a
 *  veil passes and the averages and volume are gone: candles only, and you saw them go. Questions share the Boss
 *  polish: slide, cascade, stamp, run-on. */
function Crowns({ lit = false }) {
  return <div className={d5.crownRow}><span>♛</span><span>♛</span><span>♛</span><span className={`${d5.dimC} ${lit ? d5.lit : ''}`}>♛</span></div>
}

function Q({ idx, onDone }) {
  const q = QUESTIONS[idx]
  const d = useSample(q.sample)
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')
  const [stripped, setStripped] = useState(idx > 0)
  const [veil, setVeil] = useState(false)
  const bars = d?.visible
  const n = bars?.length || 0
  const all = useRunOn(bars, d?.forward, state === 'ok')
  const ann = useMemo(() => (!n || !all ? null : state === 'ask' ? spot(all, n - 1, { label: 'this candle', id: `h${idx}` }) : [...spot(all, n - 1, { label: 'the trigger', id: `h${idx}`, color: state === 'ok' ? '#2faf68' : '#df4646' }), ...rayAt(bars[n - 1], 'l', { id: `h${idx}l`, label: 'the line' })]), [all, bars, n, state, idx])
  useEffect(() => {
    if (idx > 0 || !d) return undefined
    const a = setTimeout(() => setVeil(true), 900)
    const b = setTimeout(() => setStripped(true), 1350)
    const c = setTimeout(() => setVeil(false), 2000)
    return () => { clearTimeout(a); clearTimeout(b); clearTimeout(c) }
  }, [idx, d])
  const check = () => { const ok = pick === q.answer; setState(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong') }
  useEffect(() => {
    const k = (e) => { if (state !== 'ask') { if (e.key === 'Enter') onDone(state === 'ok'); return } if (/^[1-4]$/.test(e.key)) setPick(+e.key - 1); if (e.key === 'Enter' && pick != null) check() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  return (
    <div className={`${d5.lesson} ${d5.slideIn} ${state === 'bad' ? d5.shakeHard : ''}`}>
      <div className={d5.topbar}><span className={`${d5.hardTag} ${d5.pulse}`}>HARD</span><div className={d5.prog}>{QUESTIONS.map((_, k) => <i key={k} className={k < idx || (k === idx && state !== 'ask') ? d5.on : k === idx ? d5.cur : ''} />)}</div><span className={d5.legend}>♛♛♛<b>♛</b></span></div>
      <div className={d5.ask}><Logo mood={state === 'ask' ? (pick != null ? 'think' : 'idle') : state === 'ok' ? 'happy' : 'oops'} size={64} /><div className={d5.bubble}>{state === 'ask' ? (stripped ? 'Candles only. What setup, if any, just fired?' : 'Watch: the averages and the volume are about to go.') : state === 'ok' ? 'You read the candles.' : 'Not that one.'}</div></div>
      <div className={s.chartBox}>
        {veil ? <><div className={d5.veil} /><div className={d5.stripNote}>candles only</div></> : null}
        {state !== 'ask' ? <Stamp ok={state === 'ok'} /> : null}
        <WidgetChart sym={d.sym} bars={all} annotations={ann} height={440} density="mini" defaultBars={90} hideTicker extra={stripped ? HARD : null} />
      </div>
      <div className={`${d5.cards} ${d5.cascade}`}>{q.choices.map((c, k) => { let cls = d5.card; if (state === 'ask' && pick === k) cls += ` ${d5.sel}`; if (state !== 'ask' && k === q.answer) cls += ` ${d5.right}`; if (state === 'bad' && pick === k) cls += ` ${d5.wrong}`; return <button key={c} type="button" className={cls} style={{ '--i': k }} disabled={state !== 'ask'} onClick={() => setPick(k)}><span className={d5.key}>{k + 1}</span>{c}</button> })}</div>
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${pick != null ? d5.live : ''}`} disabled={pick == null} onClick={check}>Check</button>
          : <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => onDone(state === 'ok')}>{idx + 1 < QUESTIONS.length ? 'Next' : 'Finish'}</button>}
      </div></div>
    </div>
  )
}

export default function Piece49HardV2() {
  const [phase, setPhase] = useState('intro')
  const [i, setI] = useState(0)
  const [right, setRight] = useState(0)
  const start = () => { setPhase('play'); setI(0); setRight(0) }
  if (phase === 'intro') {
    return (
      <div className={d5.lesson}>
        <StartCard tone="dark" eyebrow="Kicker · Learn 2" title="Hard mode" art={<Crowns />}
          lead="No ticker. No averages. No volume. Just the candles. A perfect run earns the legendary fourth crown."
          button={<StartButton icon="crown" label="Start hard mode" sub="candles only · every answer x2 XP" onClick={start} />}>
          <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>♛</span><small>On a perfect run</small><b>Legendary</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>XP</small><b>x{XP.HARD_MULT}</b></div></div></div>
        </StartCard>
      </div>
    )
  }
  if (phase === 'done') {
    const perfect = right === QUESTIONS.length
    return (
      <div className={d5.lesson}>{perfect ? <Confetti /> : null}
        <StartCard tone="dark" eyebrow="Kicker · Learn 2" title={perfect ? 'Legendary' : `${right} of ${QUESTIONS.length}`} art={<Crowns lit={perfect} />}
          lead={perfect ? 'Every candle read right with nothing to lean on. The fourth crown is yours.' : 'A perfect run is needed for the fourth crown. Try again.'}
          button={<StartButton icon="crown" label="Again" sub="candles only" onClick={start} />}>
          <div className={d5.gems}><div className={`${d5.gem} ${perfect ? '' : d5.dim}`}><div className={d5.gemIn}><span className={d5.gemIcon}>♛</span><small>Kicker · Learn 2</small><b>{perfect ? '4 crowns' : '3 crowns'}</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>XP</small><b>+{right * XP.RIGHT * XP.HARD_MULT}</b></div></div></div>
        </StartCard>
      </div>
    )
  }
  return <Q key={i} idx={i} onDone={(ok) => { if (ok) setRight((v) => v + 1); if (i + 1 < QUESTIONS.length) setI(i + 1); else { setPhase('done'); sfx(right + (ok ? 1 : 0) === QUESTIONS.length ? 'levelup' : 'streak') } }} />
}

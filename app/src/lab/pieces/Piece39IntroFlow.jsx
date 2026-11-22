import { useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import StudyChart from '../StudyChart'
import Logo from '../Logo'
import { SetupGlyph } from '../../pages/modelbook/SetupsView'
import { SETUP_CATALOG } from '../../pages/modelbook/setupCatalog'
import { useSample } from '../Lab'
import { spot, rayAt } from '../pointers'
import { sfx, voice } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

/** Round 8, piece 4: the LESSON INTRO, one TRANSITION everywhere, and the WRONG-ANSWER SIDE BY SIDE. The intro
 *  shows the setup's glyph art, the lesson's length and a Start. Every screen change slides in from the right.
 *  On a miss, the candle you picked and the right one sit on two small charts with the difference in one line. */
const QUESTIONS = [
  { kind: 'tap', sample: 'HAS_2023-02-02', q: 'Tap the candle that triggered the trade.', why: 'The first decisive close back above the 4-day average of the highs.', miss: 'The one you tapped closed under the 4-day average of the highs. The trigger is the first close back above it.' },
  { kind: 'name', sample: 'JBI_2023-12-14', q: 'What setup, if any, just fired on this candle?', choices: ['Launchpad', 'Kicker', 'Slingshot', 'None of these'], answer: 1, why: 'Kicker: a weak red day, then a candle that opens above the red body and closes near its high.' },
]

function Question({ idx, onDone }) {
  const Q = QUESTIONS[idx]
  const d = useSample(Q.sample)
  const [pick, setPick] = useState(null)
  const [tap, setTap] = useState(null)
  const [state, setState] = useState('ask')
  const bars = d?.visible
  const n = bars?.length || 0
  const isTap = Q.kind === 'tap'
  const all = useMemo(() => (!bars ? null : (isTap || state !== 'ask') && d?.forward ? [...bars, ...d.forward] : bars), [bars, d, state, isTap])
  const annotations = useMemo(() => {
    if (!n || !all) return null
    const a = []
    if (!isTap && state === 'ask') a.push(...spot(all, n - 1, { label: 'this candle', id: `q${idx}p` }))
    if (state !== 'ask') { a.push(...spot(all, n - 1, { label: 'the trigger', id: `q${idx}`, color: '#2faf68' })); a.push(...rayAt(bars[n - 1], 'l', { id: `q${idx}l`, label: 'the line' })) }
    if (isTap && tap && tap.index !== n - 1) a.push(...spot(all, tap.index, { label: 'your tap', id: `q${idx}t`, color: '#df4646', halo: false }))
    return a.length ? a : null
  }, [all, bars, n, state, tap, isTap, idx])
  const check = () => { const ok = isTap ? tap?.index === n - 1 : pick === Q.answer; setState(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong'); voice(ok ? 'right' : 'wrong') }
  const ready = isTap ? !!tap : pick != null
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  // the side-by-side on a miss: the candle you picked, the right one, each centred on its own small chart
  const missPick = state === 'bad' && isTap && tap ? all.slice(Math.max(0, tap.index - 30), tap.index + 6) : null
  const missRight = state === 'bad' && isTap ? all.slice(Math.max(0, n - 31), n + 5) : null
  return (
    <div className={`${d5.lesson} ${d5.slideIn}`} key={idx}>
      <div className={d5.topbar}><button type="button" className={d5.close} aria-label="Close">✕</button><div className={d5.prog}>{QUESTIONS.map((_, i) => <i key={i} className={i < idx || (i === idx && state !== 'ask') ? d5.on : i === idx ? d5.cur : ''} />)}</div><div className={d5.hearts}><span>♥</span><span>♥</span><span>♥</span></div></div>
      <div className={d5.ask}><Logo mood={state === 'ask' ? (ready ? 'think' : 'idle') : state === 'ok' ? 'happy' : 'oops'} size={72} /><div className={d5.bubble}>{Q.q}</div></div>
      {state === 'bad' && missPick ? (
        <div className={d5.sideBy}>
          <div><div className={d5.sbLabel} style={{ color: '#ff9d9d' }}>You picked</div><div className={s.chartBox}><StudyChart bars={missPick} annotations={spot(missPick, Math.min(30, tap.index), { label: 'yours', color: '#df4646', id: 'm1', halo: false, gap: 5 })} height={230} /></div></div>
          <div><div className={d5.sbLabel} style={{ color: '#8fe3b1' }}>The trigger</div><div className={s.chartBox}><StudyChart bars={missRight} annotations={spot(missRight, Math.min(30, n - 1), { label: 'trigger', color: '#2faf68', id: 'm2', gap: 5 })} height={230} /></div></div>
        </div>
      ) : (
        <div className={`${s.chartBox} `}>
          {isTap && !tap && state === 'ask' ? <span className={s.tapHint}>tap a candle</span> : null}
          <WidgetChart sym={d.sym} bars={all} annotations={annotations} height={440} density="compact" defaultBars={90} onBarTap={isTap && state === 'ask' ? ({ index }) => { if (index >= 0) setTap({ index }) } : null} />
        </div>
      )}
      {isTap ? <p className={s.hint}>{tap ? `You picked ${all?.[tap.index]?.t || ''}.` : 'The chart ran on past the trigger. Find it.'}</p> : (
        <div className={d5.cards}>{Q.choices.map((c, i) => { let cls = d5.card; if (state === 'ask' && pick === i) cls += ` ${d5.sel}`; if (state !== 'ask' && i === Q.answer) cls += ` ${d5.right}`; if (state === 'bad' && pick === i) cls += ` ${d5.wrong}`; return <button key={c} type="button" className={cls} disabled={state !== 'ask'} onClick={() => setPick(i)}><span className={d5.key}>{i + 1}</span>{c}</button> })}</div>
      )}
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${ready ? d5.live : ''}`} disabled={!ready} onClick={check}>Check</button> : (
          <><div className={d5.verdictRow}><Logo mood={state === 'ok' ? 'happy' : 'oops'} size={44} /><div><div className={d5.verdictBig}>{state === 'ok' ? 'Nicely done!' : 'Not quite.'}</div><div className={d5.verdictWhy}>{state === 'ok' ? Q.why : (Q.miss || Q.why)}</div></div></div>
            <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => onDone(state === 'ok')}>Continue</button></>
        )}
      </div></div>
    </div>
  )
}

export default function Piece39IntroFlow() {
  const [screen, setScreen] = useState('intro')
  const [i, setI] = useState(0)
  const glyph = useMemo(() => SETUP_CATALOG.find((x) => x.name.toLowerCase().includes('slingshot')) || null, [])
  if (screen === 'intro') {
    return (
      <div className={`${d5.lesson} ${d5.slideIn}`}>
        <div className={d5.intro}>
          {glyph ? <div className={d5.artBig}><SetupGlyph setup={glyph} /></div> : null}
          <div className={d5.eyebrowG}>Setup · unit 5 · lesson 1 of 4</div>
          <div className={d5.heroWord}>Slingshot</div>
          <p className={d5.screenSub}>A drive, a tight pullback, then the first close back above the 4-day average of the highs. Two questions, about two minutes. One heart per miss.</p>
          <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>Up to</small><b>+45 XP</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}>♛</span><small>Crown</small><b>1 → 2</b></div></div></div>
        </div>
        <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={() => { setScreen('q'); setI(0); voice('welcome') }}>Start</button></div></div>
      </div>
    )
  }
  if (screen === 'done') {
    return (
      <div className={`${d5.lesson} ${d5.slideIn}`}><div className={d5.screen}><Logo mood="happy" size={110} /><div className={d5.heroWord}>Lesson done</div><p className={d5.screenSub}>Every screen in this flow slid in from the right at one speed. That is the only transition the app uses.</p></div>
        <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={() => setScreen('intro')}>Back to the intro</button></div></div></div>
    )
  }
  return <Question key={i} idx={i} onDone={() => { if (i + 1 < QUESTIONS.length) setI(i + 1); else setScreen('done') }} />
}

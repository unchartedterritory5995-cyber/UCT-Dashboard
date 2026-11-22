import { useEffect, useMemo, useRef, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import UIcon from '../../components/ui/UIcon'
import StartCard, { StartButton } from '../StartCard'
import SandboxSignIn from '../SandboxSignIn'
import { BossBar, Chest, Confetti, Heart, Medal, Stamp } from '../bits'
import { useCountUp, useRunOn } from '../fx'
import { fetchSpotPool, scoreAttempt } from '../bank'
import { spot, rayAt } from '../pointers'
import { sfx, voice } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'
import { XP } from '../rewards'

const TOTAL = 10

/** Round 11, piece 3: BOSS V3 (owner, batch 10: "essentially the same thing but I like it. Needs some enhancements
 *  on the graphics"). Now fed by the bank (ten different approved charts, never the same three), scored on the
 *  server, the follow-through drawn from the item's own forward bars. The arc stays: the bar, the beating heart,
 *  the stamp, the slow run-on, the crack, the medallion and the chest. */
function Q({ idx, item, onDone }) {
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')
  const [fwd, setFwd] = useState(null)
  const [why, setWhy] = useState('')
  const shownAt = useRef(0)
  useEffect(() => { shownAt.current = performance.now() }, [])
  const bars = item.bars
  const n = bars.length
  const all = useRunOn(bars, fwd, state !== 'ask', 160)
  const ann = useMemo(() => (!n || !all ? null : state === 'ask' ? spot(all, n - 1, { label: 'this candle', id: `b${idx}` }) : [...spot(all, n - 1, { label: state === 'ok' ? 'you were right' : 'the answer', id: `b${idx}`, color: state === 'ok' ? '#2faf68' : '#df4646' }), ...rayAt(bars[n - 1], 'l', { id: `b${idx}l`, label: '' })]), [all, bars, n, state, idx])
  const check = async () => {
    if (pick == null) return
    const choice = item.choices[pick]
    let ok = false
    try { const a = await scoreAttempt(item, choice, performance.now() - shownAt.current); ok = !!a.correct; setFwd(a.forward); setWhy(a.reveal?.lesson || a.reveal?.detail || a.reveal?.why || '') } catch { ok = false }
    setState(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong')
  }
  useEffect(() => {
    const k = (e) => { if (state !== 'ask') { if (e.key === 'Enter') onDone(state === 'ok', item); return } const i = +e.key - 1; if (i >= 0 && i < item.choices.length) setPick(i); if (e.key === 'Enter' && pick != null) check() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })
  const gone = idx + (state === 'ok' ? 1 : 0)
  return (
    <div className={`${d5.lesson} ${d5.slideIn} ${state === 'bad' ? d5.shakeHard : ''}`}>
      {state === 'bad' ? <div className={d5.vignetteRed} /> : null}
      <div className={d5.bossTop}><span className={d5.bossLabel}>Boss · {idx + 1} of {TOTAL}</span><BossBar total={TOTAL} gone={gone} /><Heart size={30} bpm={56 + idx * 9} cracked={state === 'bad'} /></div>
      <div className={d5.ask}><Logo mood={state === 'ask' ? (pick != null ? 'think' : 'idle') : state === 'ok' ? 'happy' : 'oops'} size={60} /><div className={d5.bubble}>{state === 'ask' ? 'One heart. Read the last candle.' : state === 'ok' ? 'Still standing. Watch it run.' : 'That was the heart.'}</div></div>
      <div className={d5.qLine}><span className={d5.qSetup}>{item.name}</span><span className={d5.qText}>{item.q}</span></div>
      <div className={s.chartBox}>{state !== 'ask' ? <Stamp ok={state === 'ok'} /> : null}<WidgetChart sym={item.id} bars={all} annotations={ann} height={420} density="mini" defaultBars={90} hideTicker /></div>
      <div className={`${d5.cards} ${d5.cascade}`}>{item.choices.map((c, k) => { let cls = d5.card; if (state === 'ask' && pick === k) cls += ` ${d5.sel}`; if (state !== 'ask' && pick === k) cls += state === 'ok' ? ` ${d5.right}` : ` ${d5.wrong}`; return <button key={c} type="button" className={cls} style={{ '--i': k }} disabled={state !== 'ask'} onClick={() => setPick(k)}><span className={d5.key}>{k + 1}</span>{c}</button> })}</div>
      {state !== 'ask' && why ? <details className={d5.whyCard} open><summary>The lesson</summary><p>{why}</p></details> : null}
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${pick != null ? d5.live : ''}`} disabled={pick == null} onClick={check}>Check</button>
          : <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => onDone(state === 'ok', item)}>{state === 'ok' ? (idx + 1 < TOTAL ? 'Next' : 'Claim the trophy') : 'See what to review'}</button>}
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
        <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} /></span><small>Boss bonus</small><b>+{xp}</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="save" size={20} /></span><small>Chest</small><b>{open ? 'Open' : 'Opening'}</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} gold /></span><small>Unit 2</small><b>Trophy</b></div></div></div>
      </StartCard>
    </div>
  )
}

export default function Piece54BossV3() {
  const [phase, setPhase] = useState('intro')
  const [pool, setPool] = useState(null)
  const [signedOut, setSignedOut] = useState(false)
  const [reload, setReload] = useState(0)
  const [i, setI] = useState(0)
  const [missed, setMissed] = useState(null)
  const [run, setRun] = useState(0)
  useEffect(() => { let on = true; fetchSpotPool().then((p) => on && setPool(p)).catch((e) => { if (!on) return; if (e?.name === 'SignedOut') setSignedOut(true); setPool([]) }); return () => { on = false } }, [reload])
  const items = useMemo(() => (pool ? pool.slice(0, TOTAL) : []), [pool, run])   // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => { setPhase('play'); setI(0); setMissed(null); setRun((r) => r + 1); if (pool) setPool((p) => [...p.slice(TOTAL), ...p.slice(0, TOTAL)]) }
  if (signedOut) return <div className={d5.lesson}><SandboxSignIn onDone={() => { setPool(null); setSignedOut(false); setReload((r) => r + 1) }} /></div>
  if (phase === 'intro') {
    return (
      <div className={d5.lesson}><div className={`${d5.vignetteRed} ${d5.soft}`} />
        <StartCard tone="red" eyebrow="Unit 2 · Candles that trap" title="Boss lesson" art={<div className={d5.winRow}><Medal size={110} label="2" /><div className={d5.heartBig}><Heart size={64} bpm={64} /></div></div>}
          lead={`Ten charts from the bank. One heart. Miss once and it ends. Pass and the unit trophy and a chest are yours.${pool ? '' : ' Loading the bank.'}`}
          button={<StartButton tone="red" icon="medal" label={pool == null ? 'Loading the bank' : pool.length ? 'Face the boss' : 'No charts came back'} sub={pool == null ? 'a second or two' : pool.length ? 'ten charts · one heart · +150 XP' : 'reload the page; if it stays empty, sign in to the sandbox'} onClick={() => pool?.length && start()} />}>
          <div className={d5.gems}><div className={`${d5.gem} ${d5.dim}`}><div className={d5.gemIn}><span className={d5.gemIcon} style={{ color: '#ff6b6b' }}>♥</span><small>Hearts</small><b>1</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} /></span><small>On a pass</small><b>+{XP.BOSS} XP</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="save" size={20} /></span><small>Plus</small><b>a chest</b></div></div></div>
        </StartCard>
      </div>
    )
  }
  if (phase === 'win') return <Win onBack={() => setPhase('intro')} />
  if (phase === 'fail') {
    return (
      <div className={d5.lesson}><div className={`${d5.vignetteRed} ${d5.soft}`} />
        <StartCard tone="red" eyebrow={`Fell on chart ${i + 1} of ${TOTAL}`} title="Not yet" art={<div className={d5.heartBig}><Heart size={84} broken /></div>}
          lead={`The one you missed was a ${missed?.name || 'setup'} chart. A boss needs every rule cold.`}
          button={<StartButton tone="red" icon="medal" label="Try the boss again" sub="ten new charts · one heart" onClick={start} />}>
          <div className={d5.nextCard} style={{ maxWidth: 'none', width: '100%' }}><small>REVIEW FIRST</small><b>{missed?.name || 'The setup'} · Practice</b><span>five charts, hearts on, about three minutes</span></div>
        </StartCard>
      </div>
    )
  }
  const item = items[i]
  if (!item) return <div className={d5.lesson}><p className={s.hint}>The bank returned no chart items.</p></div>
  return <Q key={`${run}-${i}`} idx={i} item={item} onDone={(ok, it) => { if (!ok) { setMissed(it); setPhase('fail'); voice('boss_fail'); return } if (i + 1 >= TOTAL) { setPhase('win'); sfx('levelup'); voice('boss_win') } else setI(i + 1) }} />
}

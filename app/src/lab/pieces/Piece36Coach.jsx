import { useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import { useSample } from '../Lab'
import { spot, rayAt } from '../pointers'
import { sfx, voice, voiceCaption, isMuted, setMuted } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

/** Round 8, piece 1: THE COACH, the SOUND MAP and the VOICE LINES. Top: the coach's five moods and every sound,
 *  tap to hear. Below: one real question with the coach reacting (thinking while you pick, pleased or wincing on
 *  Check, on fire at a combo) and the voice caption for the owner's recorded line (silent until recorded). */
const MOODS = ['idle', 'think', 'happy', 'oops', 'fire']
const SOUNDS = ['right', 'wrong', 'combo', 'levelup', 'chest', 'streak', 'buy', 'tick']
const VOICES = ['welcome', 'right', 'wrong', 'kicker', 'line', 'entry', 'buy_perfect', 'lesson_done']

export default function Piece36Coach() {
  const d = useSample()
  const [moodPick, setMood] = useState(null)   // a mood tapped above, or the reaction to the question
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')
  const [cap, setCap] = useState(null)
  const [mute, setMute] = useState(isMuted())
  const [combo, setCombo] = useState(2)
  const bars = d?.visible
  const n = bars?.length || 0
  const all = useMemo(() => (bars && state !== 'ask' && d?.forward ? [...bars, ...d.forward] : bars), [bars, d, state])
  const annotations = useMemo(() => {
    if (!n || !all) return null
    const a = state === 'ask' ? spot(all, n - 1, { label: 'this candle', id: 'p' }) : [...spot(all, n - 1, { label: 'the trigger', id: 'p', color: '#2faf68' }), ...rayAt(bars[n - 1], 'l', { id: 'l', label: 'the line' })]
    return a
  }, [all, bars, n, state])
  const mood = moodPick || (state === 'ask' ? (pick != null ? 'think' : 'idle') : state === 'ok' ? 'happy' : 'oops')
  const say = async (key) => { const r = await voice(key); setCap({ key, text: r.caption, played: r.played }); setTimeout(() => setCap(null), 2600) }
  const check = () => {
    const ok = pick === 1
    setState(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong')
    if (ok && combo + 1 >= 3) { setMood('fire'); sfx('combo'); say('right_combo') } else { setMood(ok ? 'happy' : 'oops'); say(ok ? 'right' : 'wrong') }
    if (ok) setCombo((c) => c + 1); else setCombo(0)
  }
  const reset = () => { setPick(null); setState('ask'); setMood(null) }
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><span className={d5.eyebrowG}>The coach · moods</span><button type="button" className={d5.mini} onClick={() => { setMuted(!mute); setMute(!mute) }}>{mute ? '🔇 muted' : '🔊 sound on'}</button></div>
      <div className={d5.moodRow}>{MOODS.map((m) => <button key={m} type="button" className={`${d5.moodBtn} ${mood === m ? d5.on : ''}`} onClick={() => setMood(m)}><Logo mood={m} size={84} /><small>{m}</small></button>)}</div>
      <div className={d5.rowWrap}><span className={d5.eyebrowG}>Sounds</span>{SOUNDS.map((k) => <button key={k} type="button" className={s.pill} onClick={() => sfx(k)}>{k}</button>)}</div>
      <div className={d5.rowWrap}><span className={d5.eyebrowG}>Voice lines</span>{VOICES.map((k) => <button key={k} type="button" className={s.pill} onClick={() => say(k)} title={voiceCaption(k)}>{k}</button>)}</div>
      {cap ? <div className={`${d5.voiceCap} ${cap.played ? d5.played : ''}`}><Logo mood="happy" size={28} /><b>“{cap.text}”</b><small>{cap.played ? 'your recording' : 'not recorded yet · caption only'}</small></div> : null}
      <div className={d5.ask}><Logo mood={mood} size={84} /><div className={d5.bubble}>{state === 'ask' ? 'What setup, if any, just fired on this candle?' : state === 'ok' ? 'Nicely done.' : 'Not that one. Look again.'}</div></div>
      {d ? <div className={s.chartBox}><WidgetChart sym={d.sym} bars={all} annotations={annotations} height={420} density="compact" defaultBars={90} /></div> : null}
      <div className={d5.cards}>
        {['Launchpad', 'Kicker', 'Slingshot', 'None of these'].map((c, i) => {
          let cls = d5.card
          if (state === 'ask' && pick === i) cls += ` ${d5.sel}`
          if (state !== 'ask' && i === 1) cls += ` ${d5.right}`
          if (state === 'bad' && pick === i) cls += ` ${d5.wrong}`
          return <button key={c} type="button" className={cls} disabled={state !== 'ask'} onClick={() => setPick(i)}><span className={d5.key}>{i + 1}</span>{c}</button>
        })}
      </div>
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${pick != null ? d5.live : ''}`} disabled={pick == null} onClick={check}>Check</button>
          : <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={reset}>Again</button>}
      </div></div>
    </div>
  )
}

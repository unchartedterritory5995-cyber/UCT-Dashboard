import { useState } from 'react'
import Logo from '../Logo'
import { sfx } from '../sfx'
import d5 from '../duo.module.css'

/** Round 10, piece 1: THE LOGO replaces the character (owner: "I hate the logo character and think we should change
 *  it to just a throbbing and bouncing version of our logo that we had previously but a 3D version that slowly
 *  spins and rotates"). The compass mark as a 3D coin: it turns slowly, throbs and bounces on separate rhythms.
 *  The five moods only change tempo and glow. Below: the logo at every size it is used, and in the ask bubble and
 *  the verdict row exactly as the lessons show it. */
const MOODS = ['idle', 'think', 'happy', 'oops', 'fire']
const SIZES = [28, 44, 72, 110]

export default function Piece46LogoLab() {
  const [mood, setMood] = useState('idle')
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><span className={d5.eyebrowG}>The logo · 3D, slow spin, throb, bounce</span></div>
      <div className={d5.coinStage}><Logo mood={mood} size={210} /></div>
      <div className={d5.coinRow}>{MOODS.map((m) => <button key={m} type="button" className={`${d5.coinCell} ${mood === m ? d5.on : ''}`} onClick={() => { setMood(m); if (m === 'happy') sfx('right'); if (m === 'oops') sfx('wrong'); if (m === 'fire') sfx('combo') }}><Logo mood={m} size={64} /><span>{m}</span></button>)}</div>
      <p className={d5.startLead} style={{ textAlign: 'left', maxWidth: 'none' }}>Moods only change the tempo and the glow: idle turns slowly; think turns slower and tilts; happy hops with a gold glow; oops shakes once and dims; fire turns fast with an ember glow and sparks. No face.</p>
      <div className={d5.eyebrowG}>Every size it appears at</div>
      <div className={d5.coinRow}>{SIZES.map((sz) => <div key={sz} className={d5.coinCell} style={{ cursor: 'default' }}><Logo mood={mood} size={sz} /><span>{sz}px</span></div>)}</div>
      <div className={d5.eyebrowG}>In the lesson</div>
      <div className={d5.ask}><Logo mood={mood} size={72} /><div className={d5.bubble}>What setup, if any, just fired on this candle?</div></div>
      <div className={d5.verdictRow}><Logo mood="happy" size={44} /><div><div className={d5.verdictBig} style={{ color: '#8fe3b1' }}>Nicely done!</div><div className={d5.verdictWhy}>Kicker. The day before closed weak and red. This candle opened above that red body and closed near its high.</div></div></div>
    </div>
  )
}

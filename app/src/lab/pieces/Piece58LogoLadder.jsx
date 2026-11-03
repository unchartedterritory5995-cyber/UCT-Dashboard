import { useState } from 'react'
import Logo3D from '../Logo3D'
import LogoCanvas from '../LogoCanvas'
import d5 from '../duo.module.css'

/** Round 13, piece 7: THE LOGO LADDER (owner: "show me 12 different examples all that improve upon each other").
 *  Twelve renders of the mark in a real 3D engine; each keeps everything before it and adds one thing. Tap a step
 *  to see it large. Step 0 is the canvas renderer the owner scored, for the comparison. */
const STEPS = [
  'flat extrude, one light', '+ rounded bevel', '+ key light, upper left', '+ fill and rim lights', '+ metal materials',
  '+ contact shadow', '+ finer curves and bevel', '+ gold trim on the edges', '+ tone mapping, sRGB', '+ depth and tilt',
  '+ eased sway on the turn', '+ halo and sparks',
]

export default function Piece58LogoLadder() {
  const [pick, setPick] = useState(12)
  const [mood, setMood] = useState('idle')
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><span className={d5.eyebrowG}>The logo · twelve steps, each on top of the last</span><div className={d5.prog} /><div className={d5.coinRow} style={{ gap: 6 }}>{['idle', 'happy', 'fire'].map((m) => <button key={m} type="button" className={`${d5.wayBtn} ${mood === m ? d5.on : ''}`} onClick={() => setMood(m)}>{m}</button>)}</div></div>
      <div className={d5.coinStage} style={{ minHeight: 320 }}>
        {pick === 0 ? <LogoCanvas mood={mood} size={240} /> : <Logo3D mood={mood} size={260} variant={pick} />}
        <span className={d5.ladderCap}>{pick === 0 ? 'before · the canvas renderer' : `step ${pick} · ${STEPS[pick - 1]}`}</span>
      </div>
      <div className={d5.ladder}>
        <button type="button" className={`${d5.ladderCell} ${pick === 0 ? d5.on : ''}`} onClick={() => setPick(0)}><LogoCanvas mood="idle" size={92} /><b>0</b><span>before</span></button>
        {STEPS.map((label, i) => <button key={label} type="button" className={`${d5.ladderCell} ${pick === i + 1 ? d5.on : ''}`} onClick={() => setPick(i + 1)}><Logo3D mood="idle" size={92} variant={i + 1} /><b>{i + 1}</b><span>{label}</span></button>)}
      </div>
      <p className={d5.startLead} style={{ textAlign: 'left', maxWidth: 'none' }}>Every step is the same geometry, rendered by a real engine with anti-aliasing. Pick the step you want as the product logo, or say what the thirteenth step should be.</p>
    </div>
  )
}

// THE LOGO, not a character (owner, batch 9: "I hate the logo character ... change it to just a throbbing and
// bouncing version of our logo that we had previously but a 3D version that slowly spins and rotates").
// The compass mark (compass-mark.png, the previous logo) rendered as a 3D coin: a front face, a back face, and
// rim layers stacked in depth so it has thickness while it turns. It spins slowly on its vertical axis, throbs
// (scale) and bounces (translateY) on different periods so the motion never locks into a loop you can count.
// `mood` changes tempo and glow only: idle slow · think slower, tilted · happy a hop and a gold glow · oops a short
// shake, dimmer · fire faster with an ember glow. No eyes, no mouth, ever. Reduced motion: no spin, no bounce.
import mark from '../components/intro/assets/compass-mark.png'
import d5 from './duo.module.css'

const RIM = [-3, -2.4, -1.8, -1.2, -0.6, 0, 0.6, 1.2, 1.8, 2.4, 3]

export default function Logo({ mood = 'idle', size = 72, className = '' }) {
  const glow = mood === 'fire' ? d5.coinFire : mood === 'happy' ? d5.coinHappy : mood === 'oops' ? d5.coinOops : mood === 'think' ? d5.coinThink : ''
  return (
    <div key={mood} className={`${d5.coinWrap} ${glow} ${className}`} style={{ width: size, height: size, '--sz': `${size}px` }} aria-hidden="true">
      <div className={d5.coinBob}>
        <div className={d5.coinSpin}>
          {RIM.map((z) => <img key={z} src={mark} alt="" className={d5.coinRim} style={{ transform: `translateZ(${z * (size / 72)}px)` }} draggable={false} />)}
          <img src={mark} alt="" className={d5.coinFace} style={{ transform: `translateZ(${3.4 * (size / 72)}px)` }} draggable={false} />
          <img src={mark} alt="" className={d5.coinFace} style={{ transform: `rotateY(180deg) translateZ(${3.4 * (size / 72)}px)` }} draggable={false} />
        </div>
      </div>
      {mood === 'fire' ? <><i className={d5.spark} style={{ '--d': '0s', '--x': '18%' }} /><i className={d5.spark} style={{ '--d': '.5s', '--x': '70%' }} /><i className={d5.spark} style={{ '--d': '.9s', '--x': '44%' }} /></> : null}
    </div>
  )
}

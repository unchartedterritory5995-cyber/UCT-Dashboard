// THE COACH: a drawn character built from the brand's compass mark (a candle inside a compass ring) with moods.
// Pure SVG, no image file, so it scales and animates. Moods: idle, think, happy, oops, fire. The eyes and mouth sit
// on the candle body; the ring tilts with the mood; "fire" adds flames. Owner wanted "a real character"; a
// hand-drawn one from an illustrator can replace this later without touching the call sites.
import d5 from './duo.module.css'

const RING = { idle: 0, think: -8, happy: 6, oops: -14, fire: 0 }

export default function Coach({ mood = 'idle', size = 72, className = '' }) {
  const tilt = RING[mood] ?? 0
  const eye = mood === 'happy' ? 'M-9,-6 q4,-5 8,0' : mood === 'oops' ? 'M-9,-4 q4,3 8,0' : mood === 'think' ? 'M-9,-5 h8' : null
  const mouth = mood === 'happy' ? 'M-8,8 q8,9 16,0' : mood === 'oops' ? 'M-6,11 q6,-6 12,0' : mood === 'think' ? 'M-5,9 h8' : 'M-6,9 q6,3 12,0'
  return (
    <svg className={`${d5.coachSvg} ${d5[`mood_${mood}`] || ''} ${className}`} width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4ad98a" /><stop offset="1" stopColor="#2faf68" /></linearGradient>
        <linearGradient id="cr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff6b6b" /><stop offset="1" stopColor="#df4646" /></linearGradient>
        <radialGradient id="glow"><stop offset="0" stopColor="#dcbb5e" stopOpacity=".55" /><stop offset="1" stopColor="#dcbb5e" stopOpacity="0" /></radialGradient>
      </defs>
      {mood === 'fire' ? <circle r="48" fill="url(#glow)" className={d5.coachGlow} /> : null}
      <g transform={`rotate(${tilt})`}>
        <circle r="36" fill="none" stroke="url(#cg)" strokeWidth="9" strokeDasharray="110 60" strokeLinecap="round" transform="rotate(-120)" />
        <circle r="36" fill="none" stroke="url(#cr)" strokeWidth="9" strokeDasharray="60 110" strokeLinecap="round" transform="rotate(60)" />
        <path d="M0,-49 l6,8 h-12 z" fill="#2faf68" /><path d="M0,49 l6,-8 h-12 z" fill="#df4646" />
      </g>
      {/* the candle body = the face */}
      <rect x="-13" y="-22" width="26" height="44" rx="6" fill="#111" stroke="#dcbb5e" strokeWidth="2.5" />
      <rect x="-1.5" y="-34" width="3" height="12" fill="#dcbb5e" /><rect x="-1.5" y="22" width="3" height="10" fill="#dcbb5e" />
      {/* eyes */}
      {eye ? <><path d={eye} transform="translate(-1,0)" fill="none" stroke="#f2efe6" strokeWidth="2.4" strokeLinecap="round" /><path d={eye} transform="translate(11,0)" fill="none" stroke="#f2efe6" strokeWidth="2.4" strokeLinecap="round" /></>
        : <><circle cx="-5" cy="-5" r="2.6" fill="#f2efe6" className={d5.blink} /><circle cx="5" cy="-5" r="2.6" fill="#f2efe6" className={d5.blink} /></>}
      {/* mouth */}
      <path d={mouth} transform="translate(0,0)" fill="none" stroke="#f2efe6" strokeWidth="2.2" strokeLinecap="round" />
      {mood === 'think' ? <circle cx="22" cy="-28" r="3" fill="#dcbb5e" className={d5.thinkDot} /> : null}
      {mood === 'fire' ? <g className={d5.flames}><path d="M-24,-30 q6,-16 10,0 q2,-8 6,0 q2,10 -8,12 q-10,-2 -8,-12z" fill="#ff9600" /><path d="M14,-30 q6,-16 10,0 q2,-8 6,0 q2,10 -8,12 q-10,-2 -8,-12z" fill="#ffc266" /></g> : null}
    </svg>
  )
}

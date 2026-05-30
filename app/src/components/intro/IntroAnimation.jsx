import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { prefersReducedMotion } from './introStorage'
import compassMark from './assets/compass-mark.png'
import parchmentMark from './assets/parchment-mark.png'
import styles from './IntroAnimation.module.css'

const TOTAL_RUNTIME_MS = 9300
const REDUCED_MOTION_RUNTIME_MS = 1600

export default function IntroAnimation() {
  const { user, loading } = useAuth()
  const [phase, setPhase] = useState('idle')
  const stageRef = useRef(null)
  const timerRef = useRef(null)

  const greetingName = user?.display_name?.trim().split(' ')[0] || user?.email?.split('@')[0] || 'TRADER'
  const reducedMotion = prefersReducedMotion()

  const finish = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setPhase('done')
  }, [])

  // Plays every time the app mounts (full page load / refresh / fresh visit).
  // Internal route changes don't remount App, so it won't replay during in-app
  // navigation — only on actual page loads.
  useEffect(() => {
    if (phase !== 'idle') return
    if (loading) return
    setPhase('playing')
  }, [phase, loading])

  useEffect(() => {
    if (phase !== 'playing') return
    const runtime = reducedMotion ? REDUCED_MOTION_RUNTIME_MS : TOTAL_RUNTIME_MS
    timerRef.current = setTimeout(finish, runtime)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [phase, reducedMotion, finish])

  useEffect(() => {
    if (phase !== 'playing') return
    const handleKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault()
        finish()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [phase, finish])

  if (phase !== 'playing') return null

  if (reducedMotion) {
    return (
      <div className={`${styles.overlay} ${styles.reducedMotion}`} onClick={finish} role="dialog" aria-label="Welcome">
        <div className={styles.brandStack}>
          <img className={styles.compassMark} src={compassMark} alt="" aria-hidden="true" />
          <span className={styles.wordmarkProduct}>UCT Intelligence</span>
        </div>
        <div className={styles.welcomeReducedMotion}>
          <span className={styles.welcomeLineSmall}>
            Welcome, <span className={styles.welcomeName}>{greetingName}</span>.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`${styles.overlay} ${styles.playing}`}
      onClick={finish}
      ref={stageRef}
      role="dialog"
      aria-label="Welcome"
    >
      <button
        type="button"
        className={styles.skipBtn}
        onClick={(e) => { e.stopPropagation(); finish() }}
        aria-label="Skip intro"
      >
        Skip
      </button>

      {/* ── Act 1: Cartographer atmosphere ── */}
      <div className={styles.vignette}></div>
      <span className={`${styles.coord} ${styles.coordTl}`}>N 40°42&apos;46&quot;</span>
      <span className={`${styles.coord} ${styles.coordTr}`}>W 74°00&apos;21&quot;</span>
      <span className={`${styles.coord} ${styles.coordBl}`}>— UNCHARTED —</span>
      <span className={`${styles.coord} ${styles.coordBr}`}>— TERRITORY —</span>
      <div className={`${styles.ghost} ${styles.g1}`}></div>
      <div className={`${styles.ghost} ${styles.g2}`}></div>
      <div className={`${styles.ghost} ${styles.g3}`}></div>
      <div className={`${styles.ghost} ${styles.g4}`}></div>
      <div className={`${styles.ghost} ${styles.g5}`}></div>
      <div className={`${styles.ghost} ${styles.g6}`}></div>

      <div className={styles.parchmentStage}></div>

      <svg className={styles.roseBackdrop} viewBox="0 0 100 100" aria-hidden="true">
        <line className={styles.roseMajor} x1="50" y1="0" x2="50" y2="100" />
        <line className={styles.roseMajor} x1="0" y1="50" x2="100" y2="50" />
        <line className={styles.roseMajor} x1="14.6" y1="14.6" x2="85.4" y2="85.4" />
        <line className={styles.roseMajor} x1="14.6" y1="85.4" x2="85.4" y2="14.6" />
        <line x1="30.9" y1="0" x2="69.1" y2="100" />
        <line x1="69.1" y1="0" x2="30.9" y2="100" />
        <line x1="0" y1="30.9" x2="100" y2="69.1" />
        <line x1="0" y1="69.1" x2="100" y2="30.9" />
        <circle cx="50" cy="50" r="32" />
        <circle cx="50" cy="50" r="22" />
      </svg>

      <svg className={styles.bearingRing} viewBox="-15 -15 130 130" aria-hidden="true">
        <circle className={styles.outerRing} cx="50" cy="50" r="55" />
        <circle className={styles.innerRing} cx="50" cy="50" r="48" />
        <g>
          <line className={styles.bearingMajor} x1="50" y1="-5" x2="50" y2="4" />
          <line className={styles.bearingMajor} x1="105" y1="50" x2="96" y2="50" />
          <line className={styles.bearingMajor} x1="50" y1="105" x2="50" y2="96" />
          <line className={styles.bearingMajor} x1="-5" y1="50" x2="4" y2="50" />
          <line x1="88.9" y1="11.1" x2="84.4" y2="15.6" />
          <line x1="88.9" y1="88.9" x2="84.4" y2="84.4" />
          <line x1="11.1" y1="88.9" x2="15.6" y2="84.4" />
          <line x1="11.1" y1="11.1" x2="15.6" y2="15.6" />
          <line x1="71.5" y1="-2.4" x2="70" y2="3.5" />
          <line x1="102.4" y1="28.5" x2="96.5" y2="30" />
          <line x1="102.4" y1="71.5" x2="96.5" y2="70" />
          <line x1="71.5" y1="102.4" x2="70" y2="96.5" />
          <line x1="28.5" y1="102.4" x2="30" y2="96.5" />
          <line x1="-2.4" y1="71.5" x2="3.5" y2="70" />
          <line x1="-2.4" y1="28.5" x2="3.5" y2="30" />
          <line x1="28.5" y1="-2.4" x2="30" y2="3.5" />
        </g>
        <g transform="rotate(90 50 50)">
          <text className={styles.cardinal} x="50" y="-9" textAnchor="middle" transform="rotate(-90 50 -9)">N</text>
        </g>
        <g transform="rotate(90 50 50)">
          <text className={styles.cardinal} x="-9" y="50" textAnchor="middle" transform="rotate(-90 -9 50)" dy=".35em">E</text>
        </g>
        <g transform="rotate(90 50 50)">
          <text className={styles.cardinal} x="50" y="111" textAnchor="middle" transform="rotate(-90 50 111)" dy=".35em">S</text>
        </g>
        <g transform="rotate(90 50 50)">
          <text className={styles.cardinal} x="111" y="50" textAnchor="middle" transform="rotate(-90 111 50)" dy=".35em">W</text>
        </g>
        <g transform="rotate(90 50 50)">
          <text className={styles.degree} x="89" y="9" textAnchor="middle" transform="rotate(-90 89 9)" dy=".35em">045°</text>
          <text className={styles.degree} x="89" y="91" textAnchor="middle" transform="rotate(-90 89 91)" dy=".35em">135°</text>
          <text className={styles.degree} x="11" y="91" textAnchor="middle" transform="rotate(-90 11 91)" dy=".35em">225°</text>
          <text className={styles.degree} x="11" y="9" textAnchor="middle" transform="rotate(-90 11 9)" dy=".35em">315°</text>
        </g>
      </svg>

      <svg className={styles.journeyPath} viewBox="0 0 1000 562" preserveAspectRatio="none" aria-hidden="true">
        <path id="introRoute" className={styles.route} d="M 80 90 Q 280 50 500 280 T 920 480" />
        <circle className={styles.anchor} cx="80" cy="90" r="5" />
        <circle className={styles.anchor} cx="920" cy="480" r="5" />
        <circle className={styles.ship} r="5">
          <animateMotion dur="2.2s" begin="1.9s" fill="freeze" rotate="auto">
            <mpath href="#introRoute" />
          </animateMotion>
        </circle>
      </svg>

      <img className={styles.parchmentMark} src={parchmentMark} alt="" aria-hidden="true" />

      <div className={styles.paperCrease}></div>

      <div className={styles.waxSeal} aria-hidden="true">
        <svg viewBox="0 0 100 100">
          <defs>
            <radialGradient id="introWaxGrad" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#e8c66a" />
              <stop offset="55%" stopColor="#c9a84c" />
              <stop offset="100%" stopColor="#7a6224" />
            </radialGradient>
            <path id="introSealTop" d="M 14 50 A 36 36 0 0 1 86 50" fill="none" />
          </defs>
          <circle cx="50" cy="50" r="46" fill="url(#introWaxGrad)" stroke="#5a4818" strokeWidth="0.8" />
          <circle cx="50" cy="50" r="38" fill="none" stroke="#5a4818" strokeWidth="0.6" />
          <g fill="#5a4818">
            <circle cx="50" cy="14" r="0.9" />
            <circle cx="76" cy="24" r="0.9" />
            <circle cx="86" cy="50" r="0.9" />
            <circle cx="76" cy="76" r="0.9" />
            <circle cx="50" cy="86" r="0.9" />
            <circle cx="24" cy="76" r="0.9" />
            <circle cx="14" cy="50" r="0.9" />
            <circle cx="24" cy="24" r="0.9" />
          </g>
          <text x="50" y="62" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontWeight="700" fontSize="34" fontStyle="italic" fill="#3d2f0f">UT</text>
          <text fontFamily="Georgia, 'Times New Roman', serif" fontSize="6" fontStyle="italic" fill="#3d2f0f" letterSpacing="2">
            <textPath href="#introSealTop" startOffset="50%" textAnchor="middle">CHARTING THE MARKET</textPath>
          </text>
        </svg>
      </div>

      <span className={`${styles.mapLabel} ${styles.mapBearing}`}>UCT Intelligence</span>
      <span className={`${styles.mapLabel} ${styles.mapFrom}`}>From — Premarket</span>
      <span className={`${styles.mapLabel} ${styles.mapTo}`}>To — Closing Bell</span>
      <span className={`${styles.mapLabel} ${styles.mapVol}`}>
        Navigate the market, <span className={styles.mapVolEmph}>effectively.</span>
      </span>

      <div className={styles.ignition}></div>

      {/* ── Act 2: Welcome ── */}
      <div className={styles.welcomeVeil}></div>
      <div className={styles.welcome}>
        <img className={styles.compassMini} src={compassMark} alt="" aria-hidden="true" />
        <span className={styles.welcomeLine}>
          Welcome, <span className={styles.welcomeName}>{greetingName}</span>.
        </span>
        <span className={styles.welcomeRule}></span>
        <span className={styles.navigateTagline}>
          Navigate the market, <span className={styles.navigateEmph}>effectively.</span>
        </span>
      </div>

      {/* ── Act 3: Brand finale ── */}
      <div className={styles.revealScene}></div>
      <div className={styles.brandStack}>
        <img className={styles.compassMark} src={compassMark} alt="UCT Intelligence" />
        <span className={styles.wordmarkProduct}>UCT Intelligence</span>
      </div>

      <div className={styles.ecosystem}>
        <span className={styles.wordmarkParent}>Uncharted Territory</span>
        <div className={styles.pills}>
          <span className={styles.pill}>Morning Wire</span>
          <span className={styles.pill}>UCT 20</span>
          <span className={styles.pill}>AI Intelligence</span>
          <span className={styles.pill}>Live Breadth</span>
          <span className={styles.pill}>Theme Tracker</span>
          <span className={styles.pill}>Trade Journal</span>
          <span className={styles.pill}>Setup Library</span>
          <span className={styles.pill}>Real-Time Stream</span>
          <span className={styles.pill}>Watchlists</span>
          <span className={styles.pill}>Scanner</span>
          <span className={styles.pill}>Options Flow</span>
          <span className={styles.pill}>Calendar</span>
        </div>
      </div>
    </div>
  )
}

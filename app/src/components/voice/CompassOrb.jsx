import styles from './CompassOrb.module.css'

/**
 * Brand-mark compass orb used inside FloatingOrb.
 *
 * A glass sphere with the Uncharted Territory compass rose inside:
 *  - North arm = brand red (bullish-candle inverse)
 *  - South arm = brand green
 *  - E/W arms + center hub = gold #c9a84c
 *  - Bearing-tick ring rotates slowly on `thinking`
 *  - Compass-rose center shows a state glyph when in-session
 *    (◉ connected, ● user speaking, 🔊 assistant speaking)
 */
export default function CompassOrb({ state = 'idle' }) {
  const showGlyph = state === 'connected' || state === 'listening' || state === 'responding'
  let glyph = null
  if (state === 'connected') glyph = '◉'
  else if (state === 'listening') glyph = '●'
  else if (state === 'responding') glyph = '◆'

  return (
    <span className={styles.wrap} aria-hidden="true">
      <svg viewBox="0 0 100 100" className={styles.svg}>
        <defs>
          <radialGradient id="uctOrbBody" cx="36%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#2a2718" />
            <stop offset="55%" stopColor="#0f110e" />
            <stop offset="100%" stopColor="#050503" />
          </radialGradient>
          <radialGradient id="uctOrbSheen" cx="32%" cy="22%" r="38%">
            <stop offset="0%" stopColor="rgba(255, 232, 178, 0.55)" />
            <stop offset="100%" stopColor="rgba(255, 232, 178, 0)" />
          </radialGradient>
          <linearGradient id="uctOrbRim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e6c977" />
            <stop offset="50%" stopColor="#c9a84c" />
            <stop offset="100%" stopColor="#6e5722" />
          </linearGradient>
          <radialGradient id="uctOrbHub" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f3deA0" />
            <stop offset="100%" stopColor="#8e6f24" />
          </radialGradient>
        </defs>

        {/* Sphere body + gold rim */}
        <circle cx="50" cy="50" r="46" fill="url(#uctOrbBody)" stroke="url(#uctOrbRim)" strokeWidth="2" />

        {/* Bearing tick ring (rotates on `thinking`) */}
        <g className={`${styles.bearings} ${state === 'thinking' ? styles.bearingsSpin : ''}`}>
          {Array.from({ length: 24 }).map((_, i) => {
            const major = i % 6 === 0
            const a = (i * 15) * Math.PI / 180
            const r1 = 41
            const r2 = major ? 35 : 37.5
            const x1 = 50 + r1 * Math.sin(a)
            const y1 = 50 - r1 * Math.cos(a)
            const x2 = 50 + r2 * Math.sin(a)
            const y2 = 50 - r2 * Math.cos(a)
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#c9a84c"
                strokeWidth={major ? 1.1 : 0.6}
                opacity={major ? 0.85 : 0.45}
              />
            )
          })}
        </g>

        {/* Diagonal compass arms (muted gold, behind cardinal arms) */}
        <g className={styles.roseDiag} opacity="0.55">
          <polygon points="74,26 51,49 50,50 49,51" fill="#7a6428" />
          <polygon points="26,74 49,51 50,50 51,49" fill="#7a6428" />
          <polygon points="26,26 49,49 50,50 51,49" fill="#7a6428" />
          <polygon points="74,74 49,51 50,50 51,49" fill="#7a6428" />
        </g>

        {/* Cardinal compass arms */}
        <g className={styles.rose}>
          {/* North — brand red */}
          <polygon points="50,12 53.2,49 50,50 46.8,49" fill="#ef4444" />
          <polygon points="50,12 50,50 46.8,49" fill="#b91c1c" />
          {/* South — brand green */}
          <polygon points="50,88 53.2,51 50,50 46.8,51" fill="#4ade80" />
          <polygon points="50,88 50,50 53.2,51" fill="#15803d" />
          {/* East — gold */}
          <polygon points="88,50 51,53.2 50,50 51,46.8" fill="#e6c977" />
          <polygon points="88,50 51,46.8 50,50" fill="#8e6f24" />
          {/* West — gold */}
          <polygon points="12,50 49,53.2 50,50 49,46.8" fill="#e6c977" />
          <polygon points="12,50 50,50 49,53.2" fill="#8e6f24" />
        </g>

        {/* Center hub — switches to live glyph when in-session */}
        {showGlyph ? (
          <g>
            <circle cx="50" cy="50" r="11" fill="#0f110e" stroke="url(#uctOrbHub)" strokeWidth="1.2" />
            <text
              x="50"
              y={state === 'responding' ? 55.5 : 55}
              textAnchor="middle"
              fontSize={state === 'listening' ? 14 : 12}
              fill={state === 'listening' ? '#ef4444' : state === 'responding' ? '#4ade80' : '#c9a84c'}
              className={state === 'listening' ? styles.glyphPulse : ''}
            >
              {glyph}
            </text>
          </g>
        ) : (
          <circle cx="50" cy="50" r="4.5" fill="url(#uctOrbHub)" stroke="#3a2e10" strokeWidth="0.6" />
        )}

        {/* Glass sheen overlay (top-left highlight) */}
        <ellipse cx="38" cy="30" rx="22" ry="13" fill="url(#uctOrbSheen)" pointerEvents="none" />
      </svg>
    </span>
  )
}

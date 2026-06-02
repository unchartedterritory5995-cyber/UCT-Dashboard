import { Link } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import styles from './Landing.module.css'

const EQUITY_PATH_D =
  'M 90 580 C 150 575, 180 555, 210 540 S 270 510, 310 535 ' +
  'C 350 560, 390 565, 430 525 S 510 460, 560 475 ' +
  'C 610 490, 640 470, 680 430 S 760 370, 810 395 ' +
  'C 860 420, 890 380, 930 320 S 1010 230, 1060 200 ' +
  'C 1095 180, 1115 130, 1130 90'

const EQUITY_FILL_D = EQUITY_PATH_D + ' L 1130 640 L 90 640 Z'

const FEATURES = [
  { name: 'Morning Wire',     desc: 'Daily AI brief at 7:35 AM ET. Regime, exposure, top 5 picks with triggers, stops, and invalidation levels.' },
  { name: 'UCT 20',           desc: 'The 20 highest-conviction leadership stocks. Entry and exit signals, stop losses, live P&L.' },
  { name: 'AI Compass',       desc: 'A trading coach that learns your setups. Pre-trade verdicts, post-mortems, tilt detection, weekly reviews.', isNew: true },
  { name: 'Stock Catalysts',  desc: 'A pre-market intelligence desk. 20 vetted picks synthesized from 8 sources every refresh.', isNew: true },
  { name: 'Breadth Monitor',  desc: '20+ market internals, eight-tier heatmap, COT positioning, 500-day analogue matching.' },
  { name: 'Theme Tracker',    desc: '99 themes across 12 sectors. 1,928 stocks. Live intraday returns across six periods.' },
  { name: 'Charts Workspace', desc: 'TradingView-grade workspace. Drag-resize tiles, four color groups for linking, eight timeframes.' },
  { name: 'Voice Assistant',  desc: 'Ask Compass anything by voice. 88 tools, persistent memory, regime-aware risk engine.', isNew: true },
]

export default function Landing() {
  const pathRef          = useRef(null)
  const drawnRef         = useRef(null)
  const fillClipRectRef  = useRef(null)
  const markerGroupRef   = useRef(null)
  const counterValueRef  = useRef(null)
  const counterDeltaRef  = useRef(null)
  const counterBgRef     = useRef(null)
  const markerRectRef    = useRef(null)

  useEffect(() => {
    const path         = pathRef.current
    const drawn        = drawnRef.current
    const fillClipRect = fillClipRectRef.current
    const markerGroup  = markerGroupRef.current
    const counterVal   = counterValueRef.current
    const counterDel   = counterDeltaRef.current
    const counterBg    = counterBgRef.current
    const markerRect   = markerRectRef.current
    if (!path || !drawn || !markerGroup) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      fillClipRect.setAttribute('width', '1200')
      drawn.style.strokeDasharray = 'none'
      drawn.style.strokeDashoffset = '0'
      markerGroup.setAttribute('transform', 'translate(1130 90)')
      counterVal.textContent = '$36,000'
      counterDel.textContent = '+$28,000 · 350%'
      return
    }

    const START_VAL = 8000
    const END_VAL   = 36000
    const RUN_MS    = 18000
    const HOLD_MS   = 1500
    const RESET_MS  = 500
    const TOTAL_MS  = RUN_MS + HOLD_MS + RESET_MS

    const pathLen = path.getTotalLength()
    drawn.style.strokeDasharray  = `${pathLen} ${pathLen}`
    drawn.style.strokeDashoffset = String(pathLen)

    let startTime = null
    let lastY     = null
    let rafId     = null

    const fmt = (n) => `$${(Math.round(n / 10) * 10).toLocaleString('en-US')}`
    const fmtDelta = (delta) => {
      const rounded = Math.round(delta / 10) * 10
      const pct = Math.round((rounded / START_VAL) * 100)
      return `+$${rounded.toLocaleString('en-US')} · ${pct.toLocaleString('en-US')}%`
    }

    const tick = (ts) => {
      if (startTime === null) startTime = ts
      const elapsed = (ts - startTime) % TOTAL_MS

      let progress, opacity
      if (elapsed < RUN_MS) {
        progress = elapsed / RUN_MS
        opacity = 1
      } else if (elapsed < RUN_MS + HOLD_MS) {
        progress = 1
        opacity = 1
      } else {
        progress = 1
        opacity = 0
        drawn.style.strokeDashoffset = String(pathLen)
        fillClipRect.setAttribute('width', '0')
      }

      const drawnLen = pathLen * progress
      drawn.style.strokeDashoffset = String(pathLen - drawnLen)

      const pt = path.getPointAtLength(drawnLen)
      fillClipRect.setAttribute('width', String(Math.max(0, pt.x)))

      const isDrawdown = lastY !== null && pt.y > lastY + 0.4
      lastY = pt.y

      markerGroup.setAttribute('transform', `translate(${pt.x} ${pt.y})`)
      markerGroup.setAttribute('opacity', String(opacity))

      const val = START_VAL + (END_VAL - START_VAL) * progress
      counterVal.textContent = fmt(val)
      counterDel.textContent = fmtDelta(val - START_VAL)

      if (isDrawdown) {
        counterVal.setAttribute('fill', '#f87171')
        counterDel.setAttribute('fill', 'rgba(248,113,113,0.6)')
        counterBg.setAttribute('stroke', 'rgba(248,113,113,0.35)')
        markerRect.setAttribute('fill', '#f87171')
      } else {
        counterVal.setAttribute('fill', '#4ade80')
        counterDel.setAttribute('fill', 'rgba(74,222,128,0.6)')
        counterBg.setAttribute('stroke', 'rgba(74,222,128,0.3)')
        markerRect.setAttribute('fill', 'url(#markerGrad)')
      }

      rafId = requestAnimationFrame(tick)
    }

    const startTimeout = setTimeout(() => {
      rafId = requestAnimationFrame(tick)
    }, 200)

    return () => {
      clearTimeout(startTimeout)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])

  const scrollToFeatures = (e) => {
    e.preventDefault()
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className={styles.page}>
      {/* ── Nav ── */}
      <nav className={styles.nav}>
        <div className={styles.navBrand}>
          <span className={styles.navMark} aria-hidden="true">⊕</span>
          UCT Intelligence
        </div>
        <div className={styles.navCta}>
          <Link to="/login" className={styles.navLogin}>Log in</Link>
          <Link to="/signup?plan=pro" className={styles.navSignup}>Get started</Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className={styles.hero}>
        {/* Equity-curve background */}
        <div className={styles.equity} aria-hidden="true">
          <svg viewBox="0 0 1200 640" preserveAspectRatio="none">
            <defs>
              <linearGradient id="eqGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%"   stopColor="#9c7d2a" stopOpacity="0.4"  />
                <stop offset="40%"  stopColor="#c9a84c" stopOpacity="0.65" />
                <stop offset="100%" stopColor="#4ade80" stopOpacity="0.75" />
              </linearGradient>
              <linearGradient id="eqFillGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%"   stopColor="#c9a84c" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#c9a84c" stopOpacity="0"    />
              </linearGradient>
              <radialGradient id="markerGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stopColor="#fff4d6" />
                <stop offset="60%"  stopColor="#c9a84c" />
                <stop offset="100%" stopColor="#9c7d2a" />
              </radialGradient>
              <clipPath id="fillClip">
                <rect ref={fillClipRectRef} x="0" y="0" width="0" height="640" />
              </clipPath>
              <path ref={pathRef} id="equity-path" d={EQUITY_PATH_D} />
            </defs>

            <line className={styles.gridLine} x1="60" y1="500" x2="1170" y2="500" />
            <line className={styles.gridLine} x1="60" y1="360" x2="1170" y2="360" />
            <line className={styles.gridLine} x1="60" y1="220" x2="1170" y2="220" />

            <text className={styles.axisLabel} x="1148" y="586" textAnchor="end">$8K</text>
            <text className={styles.axisLabel} x="1148" y="364" textAnchor="end">$18K</text>
            <text className={styles.axisLabel} x="1148" y="224" textAnchor="end">$28K</text>
            <text className={styles.axisLabel} x="1148" y="94"  textAnchor="end">$36K</text>

            <use href="#equity-path" className={styles.equityGhost} />
            <g clipPath="url(#fillClip)">
              <path className={styles.equityFill} d={EQUITY_FILL_D} />
            </g>
            <use href="#equity-path" className={styles.equityCurve} ref={drawnRef} />

            <g ref={markerGroupRef} transform="translate(90 580)" opacity="1">
              <circle r="5" fill="none" stroke="#c9a84c" strokeWidth="1" opacity="0.5">
                <animate attributeName="r"       from="5"   to="13" dur="1.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.6" to="0"  dur="1.8s" repeatCount="indefinite" />
              </circle>
              <circle r="9" fill="#4ade80" opacity="0.1" />
              <circle r="6" fill="#c9a84c" opacity="0.28" />
              <rect
                ref={markerRectRef}
                x="-5.5" y="-5.5" width="11" height="11"
                fill="url(#markerGrad)"
                transform="rotate(45)"
                rx="1.5"
              />
              <g transform="translate(12 -44)">
                <rect
                  ref={counterBgRef}
                  x="0" y="0" width="130" height="46" rx="3"
                  fill="rgba(10,6,4,0.78)"
                  stroke="rgba(74,222,128,0.3)" strokeWidth="1"
                />
                <text
                  x="9" y="14"
                  fill="rgba(201,168,76,0.6)"
                  fontFamily="'IBM Plex Mono', Consolas, monospace"
                  fontSize="7.5" fontWeight="600" letterSpacing="2"
                >ACCOUNT P&amp;L</text>
                <text
                  ref={counterValueRef}
                  x="9" y="31"
                  fill="#4ade80"
                  fontFamily="'IBM Plex Mono', Consolas, monospace"
                  fontSize="17" fontWeight="700" letterSpacing="-0.3"
                  style={{ filter: 'drop-shadow(0 0 3px rgba(74,222,128,0.4))' }}
                >$8,000</text>
                <text
                  ref={counterDeltaRef}
                  x="9" y="42"
                  fill="rgba(74,222,128,0.6)"
                  fontFamily="'IBM Plex Mono', Consolas, monospace"
                  fontSize="9" letterSpacing="0.2"
                >+$0 · 0%</text>
              </g>
            </g>
          </svg>
        </div>

        <div className={styles.heroInner}>
          <div className={styles.compassWrap}>
            <div className={styles.compass}>
              <div className={styles.needle} />
            </div>
          </div>

          <div className={styles.heroBody}>
            <div className={styles.heroEyebrow}>
              <span className={styles.eyebrowDot} />
              Trading intelligence
            </div>
            <h1 className={styles.heroH1}>UCT Intelligence</h1>
            <p className={styles.heroTagline}>Navigate the market, effectively.</p>
            <p className={styles.heroSub}>
              A complete trading desk in one app — pre-market AI brief, 20-stock
              leadership portfolio, an AI coach that watches your trades, and a
              live catalyst engine that reads 8 sources every morning.
            </p>
            <div className={styles.ctas}>
              <Link to="/signup?plan=pro" className={styles.ctaGold}>
                Get started — $20/mo
              </Link>
              <a href="#features" onClick={scrollToFeatures} className={styles.ctaGhost}>
                See what's included
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Live engine strip ── */}
      <div className={styles.strip}>
        <span className={styles.stripPulse}>
          <span className={styles.stripDot} />
          Engine live
        </span>
        <span className={styles.stripDiv}>·</span>
        <span className={styles.stripStat}>20 catalysts</span>
        <span className={styles.stripDiv}>·</span>
        <span className={styles.stripStat}>347 patterns</span>
        <span className={styles.stripDiv}>·</span>
        <span className={styles.stripStat}>99 themes</span>
        <span className={styles.stripDiv}>·</span>
        <span className={styles.stripStat}>3,685 tickers</span>
        <span className={styles.stripDiv}>·</span>
        <span className={styles.stripStat}>SPY <span className={styles.stripUp}>+0.42%</span></span>
      </div>

      {/* ── Features ── */}
      <section id="features" className={styles.features}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionH2}>Everything you need to find an edge.</h2>
          <p className={styles.sectionP}>
            Eight integrated tools. Pre-market intelligence, live breadth, an AI
            coach, pattern detection, real-time streaming.
          </p>
        </div>
        <div className={styles.grid}>
          {FEATURES.map((f, i) => (
            <div key={f.name} className={styles.feat}>
              <div className={styles.featNum}>{String(i + 1).padStart(2, '0')}</div>
              <h3 className={styles.featH3}>
                {f.name}
                {f.isNew && <span className={styles.featNew}>New</span>}
              </h3>
              <p className={styles.featP}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className={styles.price}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionH2}>One plan. Everything included.</h2>
          <p className={styles.sectionP}>$20 a month. Cancel anytime.</p>
        </div>
        <div className={styles.priceCard}>
          <div className={styles.priceTop}>
            <div>
              <div className={styles.priceBadge}>Pro</div>
              <div className={styles.priceAmt}>
                $20<span className={styles.pricePer}>/month</span>
              </div>
            </div>
          </div>
          <ul className={styles.priceUl}>
            <li>Morning Wire — daily AI brief</li>
            <li>UCT 20 portfolio + live signals</li>
            <li>AI Compass coach</li>
            <li>Stock Catalysts (20 picks per refresh)</li>
            <li>85-detector pattern engine</li>
            <li>99-theme rotation tracker</li>
            <li>Charts Workspace + 8 timeframes</li>
            <li>Voice Assistant + real-time streaming</li>
          </ul>
          <Link to="/signup?plan=pro" className={styles.priceCta}>Get started</Link>
          <div className={styles.priceNote}>No contracts. Cancel in one click.</div>
        </div>
        <p className={styles.priceFree}>
          <strong>Free forever:</strong> Dashboard, Breadth Monitor, Charts Workspace,
          Journal, and Options Flow. No card required.
        </p>
      </section>

      {/* ── Footer ── */}
      <footer className={styles.foot}>
        <div className={styles.footTop}>
          <div className={styles.footBrand}>
            <span className={styles.footBrandMark} aria-hidden="true">⊕</span>
            UCT Intelligence
          </div>
          <div className={styles.footLinks}>
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/settings">Disclaimers</Link>
            <a href="mailto:contact@uctintelligence.com">Contact</a>
          </div>
        </div>
        <div className={styles.footAttr}>
          Built on the methodologies of Qullamaggie, Minervini, O'Neil, Kell, and Bonde.
          Not investment advice — trade at your own risk.
        </div>
        <div className={styles.footCopy}>
          &copy; {new Date().getFullYear()} Uncharted Territory
        </div>
      </footer>
    </div>
  )
}

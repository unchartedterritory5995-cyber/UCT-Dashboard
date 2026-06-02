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
  { icon: '❧', name: 'Morning Wire',     desc: 'Daily AI brief at 7:35 AM ET. Regime, exposure, top 5 picks with triggers.' },
  { icon: '★', name: 'UCT 20',           desc: 'The 20 highest-conviction leadership stocks with entry/exit signals and live P&L.' },
  { icon: '⊕', name: 'AI Compass',       desc: 'Your trading coach — pre-trade verdicts, post-mortems, tilt detection, weekly reviews.', isNew: true },
  { icon: '◎', name: 'Stock Catalysts',  desc: '20-row pre-market desk, 8 sources synthesized by Opus 4.7 every refresh.', isNew: true },
  { icon: '≣', name: 'Breadth Monitor',  desc: '20+ internals, 8-tier heatmap, COT data, 500-day analogue matching.' },
  { icon: '❋', name: 'Theme Tracker',    desc: '99 themes, 12 sectors, 1,928 stocks, live intraday returns across 6 periods.' },
  { icon: '⊞', name: 'Charts Workspace', desc: 'TradingView-grade drag-resize layout, 4 color groups, 8 timeframes.' },
  { icon: '♪', name: 'Voice Assistant',  desc: 'Ask Compass anything by voice. 88 tools, RAG memory, risk engine.', isNew: true },
]

const STARS = [
  { top: 80,  left: '14%', size: 3, delay: '0s',   bright: true  },
  { top: 110, left: '22%', size: 2, delay: '1.2s', bright: false },
  { top: 60,  left: '28%', size: 4, delay: '2.5s', bright: true  },
  { top: 130, left: '36%', size: 2, delay: '0.8s', bright: false },
  { top: 75,  left: '48%', size: 2, delay: '1.6s', bright: false },
  { top: 95,  left: '58%', size: 3, delay: '3.2s', bright: true  },
  { top: 145, left: '66%', size: 2, delay: '0.5s', bright: false },
  { top: 70,  left: '76%', size: 2, delay: '2.8s', bright: false },
  { top: 100, left: '86%', size: 3, delay: '1.9s', bright: true  },
  { top: 50,  left: '92%', size: 2, delay: '3.5s', bright: false },
]

function formatDateLine(d = new Date()) {
  // Format like "Mon 1 Jun 2026" in ET; this is decorative so a simple
  // toLocaleString is sufficient.
  const opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/New_York' }
  return d.toLocaleString('en-US', opts).replace(',', '')
}

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

  return (
    <div className={styles.page}>
      {/* ── Sticky Nav ── */}
      <nav className={styles.nav}>
        <div className={styles.navBrand}>
          <span className={styles.navMark}>⊕</span>
          UCT INTELLIGENCE
        </div>
        <div className={styles.navCta}>
          <Link to="/login" className={styles.navLogin}>Log In</Link>
          <Link to="/signup?plan=pro" className={styles.navSignup}>Begin</Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className={styles.hero}>
        <div className={styles.cartouche}>
          Day 1,247 of the voyage · {formatDateLine()}
        </div>

        {STARS.map((s, i) => (
          <div
            key={i}
            className={`${styles.star} ${s.bright ? styles.starBright : ''}`}
            style={{ top: s.top, left: s.left, width: s.size, height: s.size, animationDelay: s.delay }}
          />
        ))}

        {/* Equity-curve background */}
        <div className={styles.equity}>
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
          <div className={styles.chartLabel}>
            <span className={styles.chartLabelDot} />
            — Account · Year-to-Date —
          </div>
        </div>

        {/* Corner annotations */}
        <div className={`${styles.corner} ${styles.cornerTl}`}>
          <span className={styles.flourish}>❦</span> Uncharted Territory
          <small>EST. PREMARKET</small>
        </div>
        <div className={`${styles.corner} ${styles.cornerTr}`}>
          Charting the market <span className={styles.flourish}>❦</span>
          <small>SINCE THE OPENING BELL</small>
        </div>
        <div className={`${styles.corner} ${styles.cornerBl}`}>
          <span className={styles.flourish}>❀</span> From — Pre-Market
          <small>04 : 00 EDT</small>
        </div>
        <div className={`${styles.corner} ${styles.cornerBr}`}>
          To — Closing Bell <span className={styles.flourish}>❀</span>
          <small>16 : 00 EDT</small>
        </div>

        {/* Hero inner content */}
        <div className={styles.heroInner}>
          <div className={styles.compassWrap}>
            <div className={styles.compassShadow} />
            <div className={styles.compassRing} />
            <span className={`${styles.compassCard} ${styles.compassN}`}>N</span>
            <span className={`${styles.compassCard} ${styles.compassE}`}>E</span>
            <span className={`${styles.compassCard} ${styles.compassS}`}>S</span>
            <span className={`${styles.compassCard} ${styles.compassW}`}>W</span>
            <div className={styles.compass}>
              <div className={styles.needle} />
            </div>
          </div>

          <div className={styles.heroBody}>
            <div className={styles.heroGreeting}>
              <span className={styles.greetingDot} />
              Welcome, Trader.
            </div>
            <h1 className={styles.heroH1}>
              UCT Intelligence
              <span className={styles.heroH1Small}>— A product of Uncharted Territory —</span>
            </h1>
            <div className={styles.divider}>
              <span className={styles.dividerLine} />
              <span className={styles.dividerGem}>◆</span>
              <span className={styles.dividerTag}>Navigate the market, effectively.</span>
              <span className={styles.dividerGem}>◆</span>
              <span className={`${styles.dividerLine} ${styles.dividerLineRight}`} />
            </div>
            <div className={styles.pills}>
              <span className={styles.pill}>Morning Wire</span>
              <span className={styles.pill}>UCT 20</span>
              <span className={styles.pill}>AI Compass</span>
              <span className={styles.pill}>Stock Catalysts</span>
              <span className={styles.pill}>Live Breadth</span>
              <span className={styles.pill}>Pattern Engine</span>
              <span className={styles.pill}>Charts Workspace</span>
              <span className={styles.pill}>Voice Assistant</span>
            </div>
            <div className={styles.ctas}>
              <Link to="/signup?plan=pro" className={styles.ctaGold}>
                Step Aboard — $20/mo
              </Link>
              <a href="#intro" className={styles.ctaGhost}>Watch the Intro</a>
              <span className={styles.watch}>2 min</span>
            </div>
          </div>
        </div>

        <div className={styles.sealCurve}>— CHARTING THE MARKET —</div>
        <div className={styles.seal}>UT</div>
      </section>

      {/* ── Live engine strip ── */}
      <div className={styles.strip}>
        <span className={styles.stripPulse}>
          <span className={styles.stripDot} />
          ENGINE LIVE
        </span>
        <span className={styles.stripDiv}>|</span>
        <span className={styles.stripStat}>CATALYSTS <span className={styles.stripV}>20</span></span>
        <span className={styles.stripStat}>PATTERNS <span className={styles.stripV}>347</span></span>
        <span className={styles.stripStat}>THEMES <span className={styles.stripV}>99</span></span>
        <span className={styles.stripStat}>UNIVERSE <span className={styles.stripV}>3,685</span></span>
        <span className={styles.stripStat}>EXPOSURE <span className={styles.stripUp}>115</span></span>
        <span className={styles.stripStat}>SPY <span className={styles.stripUp}>+0.42%</span></span>
      </div>

      {/* ── Feature grid ── */}
      <section className={styles.features}>
        <div className={styles.sectionHead}>
          <div className={styles.eyebrow}>Everything aboard</div>
          <h2 className={styles.sectionH2}>One screen. Every signal that matters.</h2>
          <p className={styles.sectionP}>
            Pre-market intelligence, live breadth, an AI coach, pattern detection,
            real-time streaming — the depth of a trading desk without the Bloomberg bill.
          </p>
        </div>
        <div className={styles.grid}>
          {FEATURES.map((f) => (
            <div key={f.name} className={styles.feat}>
              <div className={styles.featIcon}>{f.icon}</div>
              <h3 className={styles.featH3}>
                {f.name}
                {f.isNew && <span className={styles.featNew}>NEW</span>}
              </h3>
              <p className={styles.featP}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className={styles.price}>
        <div className={styles.sectionHead}>
          <div className={styles.eyebrow}>One price. Everything aboard.</div>
          <h2 className={styles.sectionH2}>$20/month. Cancel anytime.</h2>
        </div>
        <div className={styles.priceCard}>
          <div className={styles.priceBadge}>PRO · ALL ACCESS</div>
          <div className={styles.priceAmt}>$20<span className={styles.pricePer}> /month</span></div>
          <div className={styles.priceTag}>— Less than one bad trade. —</div>
          <ul className={styles.priceUl}>
            <li>Morning Wire — daily AI brief</li>
            <li>UCT 20 portfolio + live signals</li>
            <li>AI Compass — pre-trade, post-trade, weekly</li>
            <li>Stock Catalysts — 20 rows / refresh</li>
            <li>85-detector pattern engine</li>
            <li>99-theme rotation tracker</li>
            <li>Charts Workspace + 8 timeframes</li>
            <li>Voice Assistant + real-time streaming</li>
          </ul>
          <Link to="/signup?plan=pro" className={styles.priceCta}>Begin the Voyage</Link>
          <div className={styles.priceNote}>No contracts. Cancel from your dashboard in 1 click.</div>
        </div>
        <div className={styles.priceFree}>
          <strong>Free forever:</strong> Dashboard, Breadth, Charts, Journal &amp; Options Flow — no card required.
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className={styles.foot}>
        <div className={styles.footSeal}>UT</div>
        <div className={styles.footBrand}>
          <span className={styles.footBrandMark}>⊕</span>
          UCT INTELLIGENCE
        </div>
        <div className={styles.footTag}>— A product of Uncharted Territory —</div>
        <div className={styles.footLinks}>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/settings">Disclaimers</Link>
          <a href="mailto:contact@uctintelligence.com">Contact</a>
        </div>
        <div className={styles.footAttr}>
          Built on the methodologies of Qullamaggie · Minervini · O'Neil · Kell · Bonde.
          <br />
          Not investment advice. Trade at your own risk.
        </div>
        <div className={styles.footCopy}>&copy; {new Date().getFullYear()} Uncharted Territory</div>
      </footer>
    </div>
  )
}

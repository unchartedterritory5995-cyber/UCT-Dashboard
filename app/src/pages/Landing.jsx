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

  const scrollTo = (id) => (e) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className={styles.page}>
      {/* ── Nav ── */}
      <nav className={styles.nav}>
        <div className={styles.navBrand}>
          <span className={styles.navMark} aria-hidden="true">⊕</span>
          UCT Intelligence
        </div>
        <div className={styles.navLinks}>
          <a href="#features" onClick={scrollTo('features')}>Features</a>
          <a href="#pricing"  onClick={scrollTo('pricing')}>Pricing</a>
          <a href="#faq"      onClick={scrollTo('faq')}>FAQ</a>
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
              <Link to="/signup?plan=free" className={styles.ctaGhost}>
                Try it free
              </Link>
            </div>
            <div className={styles.ctaSubnote}>
              Free forever for the core tools · No card required · Cancel Pro anytime
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

      {/* ── How it works ── */}
      <section className={styles.how}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionH2}>From signup to first trade in 10 minutes.</h2>
          <p className={styles.sectionP}>No setup, no broker connection, no learning curve.</p>
        </div>
        <div className={styles.howGrid}>
          <div className={styles.howStep}>
            <div className={styles.howNum}>1</div>
            <h3 className={styles.howH3}>Sign up free</h3>
            <p className={styles.howP}>60 seconds. Dashboard, Breadth, Charts, Journal, and Options Flow unlock immediately. No card required.</p>
          </div>
          <div className={styles.howStep}>
            <div className={styles.howNum}>2</div>
            <h3 className={styles.howH3}>Read the wire</h3>
            <p className={styles.howP}>Every weekday at 7:35 AM ET the AI brief lands on your dashboard with regime, exposure, and the top 5 picks with entry triggers.</p>
          </div>
          <div className={styles.howStep}>
            <div className={styles.howNum}>3</div>
            <h3 className={styles.howH3}>Trade with the coach</h3>
            <p className={styles.howP}>Compass watches every trade. Pre-trade verdicts, post-mortems, tilt detection, weekly reviews. You stay disciplined.</p>
          </div>
        </div>
      </section>

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

      {/* ── Sample preview ── */}
      <section className={styles.sample}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionH2}>See what lands on your dashboard.</h2>
          <p className={styles.sectionP}>An example of what the Morning Wire looks like on any given Tuesday.</p>
        </div>
        <div className={styles.sampleMock}>
          <div className={styles.sampleHead}>
            <span className={styles.sampleTitle}>Morning Wire</span>
            <span className={styles.sampleTime}>07:35 EDT</span>
          </div>
          <div className={styles.sampleRegime}>
            <span className={styles.sampleRegimeLabel}>Regime</span>
            <span className={styles.sampleRegimeVal}>Green · Uptrend confirmed</span>
          </div>
          <div className={styles.sampleStats}>
            <div className={styles.sampleStat}><div className={styles.sampleStatLbl}>Exposure</div><div className={styles.sampleStatVal}>115</div></div>
            <div className={styles.sampleStat}><div className={styles.sampleStatLbl}>Breadth</div><div className={styles.sampleStatVal}>68</div></div>
            <div className={styles.sampleStat}><div className={styles.sampleStatLbl}>Dist days</div><div className={styles.sampleStatVal}>2</div></div>
            <div className={styles.sampleStat}><div className={styles.sampleStatLbl}>VIX</div><div className={styles.sampleStatVal}>14.2</div></div>
          </div>
          <div className={styles.samplePicksHead}>Top 5 picks · entry / stop / setup</div>
          <div className={styles.samplePicks}>
            <div className={styles.samplePick}><span className={styles.samplePickSym}>NVDA</span><span className={styles.samplePickSetup}>Base breakout</span><span className={styles.samplePickNote}>above $1,142 on volume · stop $1,108</span></div>
            <div className={styles.samplePick}><span className={styles.samplePickSym}>PLTR</span><span className={styles.samplePickSetup}>Pullback MA</span><span className={styles.samplePickNote}>tag of 21EMA · entry $24.80 · stop $23.95</span></div>
            <div className={styles.samplePick}><span className={styles.samplePickSym}>CRWD</span><span className={styles.samplePickSetup}>Prev high break</span><span className={styles.samplePickNote}>above $338 · stop $329</span></div>
            <div className={styles.samplePick}><span className={styles.samplePickSym}>APP</span><span className={styles.samplePickSetup}>Red to green</span><span className={styles.samplePickNote}>reclaim $312 prev close · stop $304</span></div>
            <div className={styles.samplePick}><span className={styles.samplePickSym}>HOOD</span><span className={styles.samplePickSetup}>High tight flag</span><span className={styles.samplePickNote}>breakout $58.40 · stop $54.90</span></div>
          </div>
          <div className={styles.sampleFoot}>
            Every weekday · synthesized from 8 sources by Opus 4.7 · briefed by the Compass coach
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className={styles.price}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionH2}>One plan. Everything included.</h2>
          <p className={styles.sectionP}>$20 a month — less than $1/day. Cancel anytime.</p>
        </div>
        <div className={styles.priceCard}>
          <div className={styles.priceTop}>
            <div>
              <div className={styles.priceBadge}>Pro</div>
              <div className={styles.priceAmt}>
                $20<span className={styles.pricePer}>/month</span>
              </div>
              <div className={styles.priceValueLine}>Less than $1 a day.</div>
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
        <div className={styles.freeBlock}>
          <div className={styles.freeHead}>
            <span className={styles.freeBadge}>
              <span className={styles.freeBadgeDot} />
              Free forever
            </span>
            <h3 className={styles.freeH3}>Five tools, no card required.</h3>
            <p className={styles.freeSub}>
              Start with these — upgrade only when you want the Pro intelligence layer.
            </p>
          </div>
          <div className={styles.freeGrid}>
            <div className={styles.freeCard}>
              <div className={styles.freeName}>Dashboard</div>
              <div className={styles.freeDesc}>Bento layout for your daily intel.</div>
            </div>
            <div className={styles.freeCard}>
              <div className={styles.freeName}>Breadth Monitor</div>
              <div className={styles.freeDesc}>20+ internals with the 8-tier heatmap.</div>
            </div>
            <div className={styles.freeCard}>
              <div className={styles.freeName}>Charts Workspace</div>
              <div className={styles.freeDesc}>Drag-resize tiles, 8 timeframes.</div>
            </div>
            <div className={styles.freeCard}>
              <div className={styles.freeName}>Journal</div>
              <div className={styles.freeDesc}>Trade log with notes + screenshots.</div>
            </div>
            <div className={styles.freeCard}>
              <div className={styles.freeName}>Options Flow</div>
              <div className={styles.freeDesc}>Real-time options + dark pool.</div>
            </div>
          </div>
          <Link to="/signup?plan=free" className={styles.freeCta}>
            Create your free account
          </Link>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className={styles.faq}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionH2}>Common questions.</h2>
          <p className={styles.sectionP}>Most things people ask before they sign up.</p>
        </div>
        <div className={styles.faqList}>
          <details className={styles.faqItem}>
            <summary>Is this investment advice?</summary>
            <div>
              No — UCT Intelligence is research and pattern detection software.
              Every pick, signal, and chart is information to investigate, not a
              recommendation to trade. You make your own decisions; we provide
              the work product of a research desk.
            </div>
          </details>
          <details className={styles.faqItem}>
            <summary>Do I need to connect a broker?</summary>
            <div>
              No. The app runs entirely as research, journaling, and analytics.
              If you use Charles Schwab, the Journal can sync trades automatically,
              but it's optional — no broker connection is required to use any feature.
            </div>
          </details>
          <details className={styles.faqItem}>
            <summary>How is this different from a screener like Finviz?</summary>
            <div>
              Screeners give you 200 tickers and leave you to figure out which
              are real. We give you 5–20 vetted picks per day with the entry
              trigger, stop, target, invalidation, and the catalyst behind each —
              synthesized by an AI that read 8 sources overnight. Less searching,
              more deciding.
            </div>
          </details>
          <details className={styles.faqItem}>
            <summary>What's the difference between Free and Pro?</summary>
            <div>
              Free includes the Dashboard, Breadth Monitor, Charts Workspace,
              Journal, and Options Flow — forever, no card required. Pro adds
              the Morning Wire, UCT 20 portfolio, AI Compass coach, Stock
              Catalysts engine, 85-detector pattern engine, 99-theme tracker,
              Voice Assistant, and real-time streaming for $20/month.
            </div>
          </details>
          <details className={styles.faqItem}>
            <summary>What is the AI Compass coach?</summary>
            <div>
              A trading coach that learns your setups, sizing rules, and tilt
              patterns. Before you take a trade, it gives a GO / HOLD / SKIP
              verdict. After the trade, it writes a post-mortem with data
              citations. Every Sunday, it briefs you on the week. You can talk
              to it by text or voice.
            </div>
          </details>
          <details className={styles.faqItem}>
            <summary>Can I cancel anytime?</summary>
            <div>
              Yes — one click from your dashboard. No contracts, no retention
              calls, no friction. Your free-tier access stays active even after
              you cancel Pro.
            </div>
          </details>
        </div>
      </section>

      {/* ── Final close ── */}
      <section className={styles.close}>
        <div className={styles.closeInner}>
          <h2 className={styles.closeH2}>Ready to navigate the market effectively?</h2>
          <p className={styles.closeP}>
            Five tools free forever. Pro is $20/month — cancel anytime, no questions asked.
          </p>
          <div className={styles.ctas}>
            <Link to="/signup?plan=pro" className={styles.ctaGold}>
              Get started — $20/mo
            </Link>
            <Link to="/signup?plan=free" className={styles.ctaGhost}>
              Try it free
            </Link>
          </div>
          <div className={styles.ctaSubnote}>
            Free forever for the core tools · No card required · Cancel Pro anytime
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className={styles.foot}>
        <div className={styles.footTop}>
          <div className={styles.footBrand}>
            <span className={styles.footBrandMark} aria-hidden="true">⊕</span>
            UCT Intelligence
          </div>
          <div className={styles.footMid}>
            <Link to="/signup?plan=free" className={styles.footCta}>
              Start free →
            </Link>
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

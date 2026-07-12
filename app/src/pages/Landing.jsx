import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import useInView from '../hooks/useIntersectionObserver'
import UIcon from '../components/ui/UIcon'
import { track } from '../utils/landingTrack'
import styles from './Landing.module.css'

// ─────────────────────────────────────────────────────────────────────────────
// Time helpers — everything on this page that claims to be "live" is computed
// from the visitor's real clock projected into America/New_York. No fake data.
// ─────────────────────────────────────────────────────────────────────────────

function etParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  return fmt.formatToParts(now).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value
    return acc
  }, {})
}

// Current US-market session label for the hero eyebrow.
function getMarketStatus(now = new Date()) {
  const parts = etParts(now)
  const weekday = parts.weekday
  const mins = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10)

  const PREMARKET_OPEN = 4 * 60
  const REG_OPEN = 9 * 60 + 30
  const REG_CLOSE = 16 * 60
  const POSTMARKET_END = 20 * 60

  if (weekday === 'Sat' || weekday === 'Sun')
    return { label: 'Markets closed · Reopen Monday', tone: 'closed' }

  if (mins < PREMARKET_OPEN || mins >= POSTMARKET_END) {
    const tilOpen = mins < PREMARKET_OPEN
      ? PREMARKET_OPEN - mins
      : (24 * 60 - mins) + PREMARKET_OPEN
    return { label: `Markets closed · Pre-market in ${Math.floor(tilOpen / 60)}h ${tilOpen % 60}m`, tone: 'closed' }
  }
  if (mins < REG_OPEN) {
    const t = REG_OPEN - mins
    return { label: `Pre-market · Open in ${Math.floor(t / 60)}h ${t % 60}m`, tone: 'pre' }
  }
  if (mins < REG_CLOSE) {
    const t = REG_CLOSE - mins
    return { label: `Markets open · Close in ${Math.floor(t / 60)}h ${t % 60}m`, tone: 'open' }
  }
  return { label: 'Post-market · Closed at 4:00 PM ET', tone: 'post' }
}

// Minutes until the next weekday 7:35 AM ET brief. Honest countdown — the
// Morning Wire really does land at 7:35 every trading morning.
function minutesToNextBrief(now = new Date()) {
  const parts = etParts(now)
  const dayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  const mins = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10)
  const BRIEF = 7 * 60 + 35

  let addDays = 0
  if (dayIdx === 0) addDays = 1                       // Sun → Mon
  else if (dayIdx === 6) addDays = 2                  // Sat → Mon
  else if (mins >= BRIEF) addDays = dayIdx === 5 ? 3 : 1 // Fri → Mon, else tomorrow

  return addDays * 24 * 60 + BRIEF - mins
}

function formatCountdown(totalMins) {
  if (totalMins <= 0) return 'any minute now'
  const d = Math.floor(totalMins / (24 * 60))
  const h = Math.floor((totalMins % (24 * 60)) / 60)
  const m = totalMins % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function FadeIn({ children, delay = 0, className = '' }) {
  const [ref, isInView] = useInView()
  return (
    <div
      ref={ref}
      className={`${styles.fadeIn} ${isInView ? styles.fadeInVisible : ''} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Content
// ─────────────────────────────────────────────────────────────────────────────

// The trading-day spine. Times are the structure — each is a real moment in
// the product's actual daily rhythm.
const MOMENTS = [
  {
    time: '7:35 AM',
    day: 'Every trading morning',
    title: 'The brief lands.',
    body: 'Regime, exposure, and five setups worth your attention — entries, stops, invalidation levels. Ten minutes with your coffee and you have a plan for the day.',
    agent: 'Written overnight by the desk — 8 sources, cover to cover.',
    vignette: 'wire',
  },
  {
    time: '9:00 AM',
    day: 'Before the bell',
    title: 'Catalysts, already vetted.',
    body: 'Twenty names that actually matter this morning, each with the catalyst behind it and the level that proves it. Not two hundred tickers to sort — twenty reasons, ranked.',
    agent: 'Scored and re-scored all pre-market.',
    vignette: 'catalysts',
  },
  {
    time: '10:12 AM',
    day: 'Mid-session',
    title: 'A second opinion before the money moves.',
    body: 'Compass knows your setups, your sizing rules, your tilt. Ask about the trade you’re eyeing and get a straight verdict — GO, HOLD, or SKIP — with the reason.',
    agent: 'It remembers your last three trades. And your rules.',
    vignette: 'compass',
  },
  {
    time: '12:40 PM',
    day: 'All day',
    title: 'The Floor is live.',
    body: 'Real traders, real positions, all day. Share a chart, post the trade, ask the room. The tape keeps running — so does the conversation.',
    agent: 'UCT-Mentor sits in the room too.',
    vignette: 'floor',
  },
  {
    time: '4:05 PM',
    day: 'After the close',
    title: 'Your journal wrote itself.',
    body: 'Today’s trades synced straight from your broker — excursions, exit quality, R. The homework is done before dinner.',
    agent: 'Every fill, mirrored exactly.',
    vignette: 'journal',
  },
  {
    time: 'SUN 5:00 PM',
    day: 'Every week',
    title: 'Your week, reviewed.',
    body: 'What worked, what leaked, and the one thing to change on Monday. A coach’s letter, written from your own numbers.',
    agent: 'It read every trade you took this week.',
    vignette: 'review',
  },
]

// The agentic loop — what the intelligence layer does, in order.
const LOOP = [
  { verb: 'Reads',    detail: '8 sources, every night, cover to cover' },
  { verb: 'Briefs',   detail: 'the Morning Wire, 7:35 AM sharp' },
  { verb: 'Flags',    detail: 'catalysts as they form, pre-market' },
  { verb: 'Verdicts', detail: 'GO / HOLD / SKIP — before you click buy' },
  { verb: 'Learns',   detail: 'from every trade in your journal' },
  { verb: 'Coaches',  detail: 'your week, every Sunday evening' },
]

// The manual desk — the classical toolkit you drive yourself.
const MANUAL_TOOLS = [
  {
    icon: 'chart',
    name: 'Charts Workspace',
    desc: 'Drag-resize tiles, four link groups, eight timeframes, streaming bars. Drawings you grab and move like objects.',
  },
  {
    icon: 'breadth',
    name: 'Breadth Monitor',
    desc: '20+ market internals on an eight-tier heatmap. Industry groups, ATR extension, 500-day analogue matching.',
  },
  {
    icon: 'flow',
    name: 'LiveFlow',
    desc: 'The live options tape — sweeps, blocks, dark-pool prints, gamma exposure — streaming through the session.',
  },
  {
    icon: 'flame',
    name: 'Theme Tracker',
    desc: '99 themes across 12 sectors, 1,928 stocks. Watch rotation happen live across six timeframes.',
  },
  {
    icon: 'calendar',
    name: 'Calendar',
    desc: 'Earnings and economic events with analyst-rating percentiles — what’s reporting, what matters, what moved.',
  },
  {
    icon: 'desk',
    name: 'The Desk',
    desc: 'Daily live-session recordings with chapters and recaps, plus the education library and workshop.',
  },
]

// The complete inventory — every shipped feature, grouped. This is the menu
// at a place that's proud of its kitchen: everything named, nothing metered.
const INVENTORY = [
  {
    group: 'The Intelligence Layer',
    items: [
      'Morning Wire — the 7:35 AM brief: regime, exposure, top five with triggers, stops & invalidations',
      'Stock Catalysts — 20 vetted picks synthesized from 8 sources, every refresh',
      'Compass AI coach — pre-trade GO / HOLD / SKIP verdicts with reasons',
      'Post-mortems, tilt detection & Sunday weekly reviews',
      'Voice Assistant — 88 tools, full conversations, read-aloud',
      'Pattern Engine — 85 setup detectors running across the market',
      'The UCT Brain — 7,800+ curated knowledge entries, 48 setup templates',
      'UCT-Mentor — the AI trader in residence on The Floor',
    ],
  },
  {
    group: 'Market Intelligence',
    items: [
      'UCT 20 — the leadership portfolio with live signals and P&L',
      'Breadth Monitor — 20+ internals, eight-tier heatmap, industry groups',
      'ATR extension & 500-day analogue matching',
      'COT positioning, refreshed weekly',
      'Theme Tracker — 99 themes, 12 sectors, 1,928 stocks',
      'LiveFlow — options tape, dark-pool prints, gamma exposure',
      'Flow scoreboard — who’s winning the tape today',
      'Earnings & economic calendar with analyst-rating percentiles',
      'Fundamentals snapshots on every chart',
      'Real-time news wire + curated tweet tape',
      'Live streaming across a 3,685-ticker universe',
    ],
  },
  {
    group: 'Charts',
    items: [
      'The Workspace — drag-resize tiles, four link color groups',
      'Eight timeframes, streaming bars, deep history',
      'Direct-manipulation drawing tools',
      'Right-click menus & keyboard shortcuts throughout',
      'Fundamentals widget & pattern callouts on-chart',
      'Full mobile workspace',
    ],
  },
  {
    group: 'Journal 2.0',
    items: [
      'Broker auto-sync — link a brokerage, trades import themselves',
      'CSV presets for TradeZella, Tradervue & TraderSync',
      'Live position pricing',
      'MFE / MAE excursions & exit quality on every trade',
      'Regime analytics — your stats, split by market condition',
      'Risk block, equity curve & calendar heatmap',
      'Notebook — long-form notes with video timestamps',
      'PNG share cards',
    ],
  },
  {
    group: 'The Floor',
    items: [
      'The live trading-floor chat, open all session',
      'Trade, chart, flow, poll & idea cards',
      'Boards, The Tape & verified badges',
      'Mentions, inbox & email digests',
    ],
  },
  {
    group: 'The Desk',
    items: [
      'Daily live-session recordings with chapters & recaps',
      'The education library & workshop',
      'Mini-player — keep the session running while you work',
    ],
  },
  {
    group: 'The Platform',
    items: [
      'Command-center dashboard & watchlists',
      'Model Book — the setup and bottoms catalogs',
      '⌘K support & keyboard shortcuts everywhere',
      'Workspaces that compose — your layouts persist',
    ],
  },
]

// Real quotes only. This section renders ONLY when quotes exist — never
// invent testimonials. Shape: { quote, name, detail }
const TESTIMONIALS = []

const FAQS = [
  {
    q: 'Is this investment advice?',
    a: 'No — UCT Intelligence is research and analytics software. Every brief, pick, verdict, and chart is information to investigate, not a recommendation to trade. You make your own decisions; we provide the work product of a research desk.',
  },
  {
    q: 'What exactly is in the 14-day trial?',
    a: 'Everything. The trial is the full desk — the Morning Wire, Compass, Catalysts, LiveFlow, the Journal, The Floor, all of it, unmetered. No credit card to start, and nothing is charged unless you subscribe.',
  },
  {
    q: 'What happens after 14 days?',
    a: 'Nothing sneaky — there’s no card on file to charge. The desk simply asks whether you want to subscribe. If you do, it’s $200/month or $2,000/year. If not, your data exports completely and leaves with you.',
  },
  {
    q: 'Do I need to connect a broker?',
    a: 'No. Everything works without one. If you do link a brokerage, the Journal syncs your trades automatically — fills mirrored exactly — but it’s always optional.',
  },
  {
    q: 'How is this different from a screener, a Discord, or a journal app?',
    a: 'It replaces the stack. A screener hands you 200 tickers; the desk hands you twenty vetted reasons. A Discord gives you noise; The Floor gives you a room with the tape running. A journal app records your trades; this one reads them and coaches you back. One subscription, one desk.',
  },
  {
    q: 'Can I cancel? What about refunds?',
    a: 'Cancel in one click from Settings — no contracts, no retention calls. Any charge is refundable within 7 days, no questions asked.',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Product vignettes — small, faithful, clearly-labeled illustrations of what
// each surface looks like. Data is representative, marked "Illustrative".
// ─────────────────────────────────────────────────────────────────────────────

function Vignette({ kind }) {
  return (
    <div className={styles.vig} aria-hidden="true">
      {kind === 'wire' && (
        <>
          <div className={styles.vigHead}>
            <span className={styles.vigDot} />
            <span className={styles.vigTitle}>Morning Wire</span>
            <span className={styles.vigTime}>07:35 ET</span>
          </div>
          <div className={styles.vigRegime}>
            <span>Regime</span>
            <strong className={styles.vigGreen}>GREEN · Uptrend confirmed</strong>
          </div>
          <div className={styles.vigRow}><b>NVDA</b><span>Base breakout</span><em>above 184.20 · stop 178.40</em></div>
          <div className={styles.vigRow}><b>PLTR</b><span>Pullback MA</span><em>21EMA tag 152.60 · stop 148.10</em></div>
          <div className={styles.vigRow}><b>HOOD</b><span>Prev high break</span><em>above 118.35 · stop 113.90</em></div>
          <div className={styles.vigMore}>+ 2 more setups · exposure 115 · 2 distribution days</div>
        </>
      )}
      {kind === 'catalysts' && (
        <>
          <div className={styles.vigHead}>
            <span className={styles.vigDot} />
            <span className={styles.vigTitle}>Stock Catalysts</span>
            <span className={styles.vigTime}>PRE-MKT</span>
          </div>
          <div className={styles.vigRow}><b>AVGO</b><span>Raised guide + AI backlog</span><em>score 94</em></div>
          <div className={styles.vigRow}><b>CRWD</b><span>Upgrade, PT street-high</span><em>score 88</em></div>
          <div className={styles.vigRow}><b>VRT</b><span>Data-center capex read-through</span><em>score 85</em></div>
          <div className={styles.vigMore}>17 more, ranked · re-scored 6:52 AM</div>
        </>
      )}
      {kind === 'compass' && (
        <>
          <div className={styles.vigHead}>
            <span className={styles.vigDot} />
            <span className={styles.vigTitle}>Compass</span>
            <span className={styles.vigTime}>LIVE</span>
          </div>
          <div className={styles.vigMsgUser}>Adding to NVDA above 184.20 — 200 shares, stop 178.40?</div>
          <div className={styles.vigMsg}>
            Two stops already this morning. Your rule after two stops: A+ setups only. This add is B+ — extended from the pivot, no fresh base.
          </div>
          <div className={styles.vigVerdict}>
            <span className={styles.vigBadge}>SKIP</span>
            <span>Risk 1.4R against your daily limit. I’ll flag the next clean entry.</span>
          </div>
        </>
      )}
      {kind === 'floor' && (
        <>
          <div className={styles.vigHead}>
            <span className={styles.vigDot} />
            <span className={styles.vigTitle}>The Floor · #trading-floor</span>
            <span className={styles.vigTime}>142 here</span>
          </div>
          <div className={styles.vigChat}><b>mk_swing</b> that AVGO print on LiveFlow was a monster</div>
          <div className={styles.vigChat}><b>tape_reader</b> posted a trade card — <span className={styles.vigGold}>LONG VRT 96.40</span></div>
          <div className={styles.vigChat}><b>UCT-Mentor</b> Breadth just crossed tier 6 — leaders extending, keep stops honest.</div>
        </>
      )}
      {kind === 'journal' && (
        <>
          <div className={styles.vigHead}>
            <span className={styles.vigDot} />
            <span className={styles.vigTitle}>Journal · auto-synced</span>
            <span className={styles.vigTime}>16:05 ET</span>
          </div>
          <div className={styles.vigRow}><b>VRT</b><span>Long · 96.40 → 99.85</span><em className={styles.vigGreen}>+2.1R</em></div>
          <div className={styles.vigMeter}>
            <span>Exit quality</span>
            <span className={styles.vigMeterBar}><span style={{ width: '78%' }} /></span>
            <em>captured 78% of MFE</em>
          </div>
          <div className={styles.vigMore}>3 trades today · all synced from your broker</div>
        </>
      )}
      {kind === 'review' && (
        <>
          <div className={styles.vigHead}>
            <span className={styles.vigDot} />
            <span className={styles.vigTitle}>Weekly Review · from Compass</span>
            <span className={styles.vigTime}>SUN</span>
          </div>
          <div className={styles.vigLine}>Your breakout entries printed +4.2R this week — best in six weeks.</div>
          <div className={styles.vigLine}>The leak: two midday counter-trend trades, both against regime. −1.8R.</div>
          <div className={styles.vigLine}><span className={styles.vigGold}>Monday:</span> take the A+ list only until Wednesday.</div>
        </>
      )}
      <div className={styles.vigCaption}>Illustrative example</div>
    </div>
  )
}

// One moment on the trading-day spine.
function Moment({ moment }) {
  const [ref, isInView] = useInView({ threshold: 0.35 })
  return (
    <div ref={ref} className={`${styles.moment} ${isInView ? styles.momentLit : ''}`}>
      <div className={styles.momentRail}>
        <span className={styles.momentMarker} aria-hidden="true" />
        <span className={styles.momentTime}>{moment.time}</span>
        <span className={styles.momentDay}>{moment.day}</span>
      </div>
      <div className={styles.momentBody}>
        <h3 className={styles.momentH3}>{moment.title}</h3>
        <p className={styles.momentP}>{moment.body}</p>
        <div className={styles.momentAgent}>
          <span className={styles.momentAgentMark} aria-hidden="true"><UIcon name="compass" size={12} /></span>
          {moment.agent}
        </div>
        <Vignette kind={moment.vignette} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Landing() {
  const [billing, setBilling] = useState('annual') // 'annual' | 'monthly'
  const [marketStatus, setMarketStatus] = useState(() => getMarketStatus())
  const [briefMins, setBriefMins] = useState(() => minutesToNextBrief())

  useEffect(() => {
    const id = setInterval(() => {
      setMarketStatus(getMarketStatus())
      setBriefMins(minutesToNextBrief())
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => { track('landing_view') }, [])

  const handleFaqOpen = (e) => {
    if (!e.target.open) return
    const q = e.target.querySelector('summary')?.textContent?.trim()
    if (q) track('faq_open', { question: q })
  }

  // The signature: a gold thread that draws down the day-timeline as the
  // visitor scrolls through it. Scroll-linked, rAF-throttled, and fully
  // drawn from the start under prefers-reduced-motion.
  const daySectionRef = useRef(null)
  const threadFillRef = useRef(null)
  useEffect(() => {
    const section = daySectionRef.current
    const fill = threadFillRef.current
    if (!section || !fill) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      fill.style.height = '100%'
      return
    }

    let raf = null
    const update = () => {
      raf = null
      const rect = section.getBoundingClientRect()
      const viewAnchor = window.innerHeight * 0.62
      const progress = Math.min(1, Math.max(0, (viewAnchor - rect.top) / rect.height))
      fill.style.height = `${(progress * 100).toFixed(2)}%`
    }
    const onScroll = () => { if (raf === null) raf = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const scrollTo = (id) => (e) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const [footerRef, footerInView] = useInView({ threshold: 0.05 })

  const priceMain = billing === 'annual' ? '$2,000' : '$200'
  const priceUnit = billing === 'annual' ? '/year' : '/month'
  const priceNote = billing === 'annual'
    ? 'Two months free vs monthly.'
    : 'Billed monthly. Cancel anytime.'

  return (
    <div className={styles.page}>
      <a href="#main" className={styles.skipLink}>Skip to main content</a>

      {/* ── Nav ── */}
      <nav className={styles.nav}>
        <div className={styles.navBrand}>
          <span className={styles.navMark} aria-hidden="true"><UIcon name="compass" size={18} /></span>
          UCT Intelligence
        </div>
        <div className={styles.navLinks}>
          <a href="#day" onClick={scrollTo('day')}>Your day</a>
          <a href="#intelligence" onClick={scrollTo('intelligence')}>Intelligence</a>
          <a href="#desk" onClick={scrollTo('desk')}>The desk</a>
          <a href="#pricing" onClick={scrollTo('pricing')}>Pricing</a>
          <a href="#faq" onClick={scrollTo('faq')}>FAQ</a>
        </div>
        <div className={styles.navCta}>
          <Link to="/login" className={styles.navLogin}>Log in</Link>
          <Link
            to="/signup"
            className={styles.navSignup}
            onClick={() => track('nav_cta_click')}
          >
            Start free trial
          </Link>
        </div>
      </nav>

      <main id="main">

        {/* ── Hero ── */}
        <section className={styles.hero}>
          <div className={styles.heroRose} aria-hidden="true">
            <svg viewBox="0 0 600 600">
              <g className={styles.roseSpin}>
                <circle cx="300" cy="300" r="280" fill="none" stroke="currentColor" strokeWidth="1" />
                <circle cx="300" cy="300" r="210" fill="none" stroke="currentColor" strokeWidth="0.75" strokeDasharray="2 7" />
                <circle cx="300" cy="300" r="120" fill="none" stroke="currentColor" strokeWidth="0.75" />
                {Array.from({ length: 72 }, (_, i) => {
                  const a = (i * 5 * Math.PI) / 180
                  const major = i % 18 === 0
                  const r1 = major ? 252 : 268
                  return (
                    <line
                      key={i}
                      x1={300 + r1 * Math.sin(a)} y1={300 - r1 * Math.cos(a)}
                      x2={300 + 280 * Math.sin(a)} y2={300 - 280 * Math.cos(a)}
                      stroke="currentColor" strokeWidth={major ? 1.5 : 0.75}
                    />
                  )
                })}
                <path d="M 300 68 L 316 300 L 300 340 L 284 300 Z" fill="currentColor" opacity="0.55" />
                <path d="M 300 532 L 284 300 L 300 260 L 316 300 Z" fill="currentColor" opacity="0.2" />
              </g>
            </svg>
          </div>

          <div className={styles.heroInner}>
            <div className={`${styles.heroEyebrow} ${styles[`heroEyebrow_${marketStatus.tone}`]} ${styles.enter} ${styles.enter1}`}>
              <span className={styles.eyebrowDot} />
              {marketStatus.label}
            </div>
            <h1 className={`${styles.heroH1} ${styles.enter} ${styles.enter2}`}>
              Wake up to a desk that <em>already did the work.</em>
            </h1>
            <p className={`${styles.heroSub} ${styles.enter} ${styles.enter3}`}>
              UCT Intelligence is a complete trading desk run by an AI research team.
              It reads the market overnight — news, filings, flow, breadth — and hands
              you a plan at 7:35 AM. Then it stands beside every trade you take.
            </p>
            <div className={`${styles.ctas} ${styles.enter} ${styles.enter4}`}>
              <Link
                to="/signup"
                className={styles.ctaGold}
                onClick={() => track('hero_cta_pro_click')}
              >
                Start your 14-day free trial
              </Link>
              <a href="#day" className={styles.ctaGhost} onClick={scrollTo('day')}>
                See what lands tomorrow
              </a>
            </div>
            <div className={`${styles.ctaSubnote} ${styles.enter} ${styles.enter5}`}>
              No credit card · Full access from minute one · Cancel in one click
            </div>
            <div className={`${styles.heroCountdown} ${styles.enter} ${styles.enter6}`}>
              <span className={styles.heroCountdownDot} aria-hidden="true" />
              The desk reads tonight — the next brief lands in{' '}
              <strong>{formatCountdown(briefMins)}</strong>
            </div>
          </div>
        </section>

        {/* ── The shift ── */}
        <section className={styles.shift}>
          <FadeIn>
            <div className={styles.shiftEyebrow}>The problem isn&rsquo;t information</div>
            <h2 className={styles.shiftH2}>
              More information won&rsquo;t save you. <em>Better decisions will.</em>
            </h2>
            <p className={styles.shiftP}>
              You already have the firehose — screeners, feeds, Discords, twelve tabs
              of charts. What you don&rsquo;t have is a desk that reads all of it, filters it
              against a proven methodology, and stands next to you when it&rsquo;s time to
              decide. That&rsquo;s the difference between an app and a desk.
            </p>
          </FadeIn>
        </section>

        {/* ── A day at your desk ── */}
        <section id="day" ref={daySectionRef} className={styles.day}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionEyebrow}>A day at your desk</div>
            <h2 className={styles.sectionH2}>Six moments the desk gives back to you.</h2>
            <p className={styles.sectionP}>
              This is the rhythm of trading with a research team that never sleeps.
            </p>
          </div>
          <div className={styles.dayTimeline}>
            <div className={styles.thread} aria-hidden="true">
              <div ref={threadFillRef} className={styles.threadFill} />
            </div>
            {MOMENTS.map((m) => (
              <Moment key={m.time} moment={m} />
            ))}
          </div>
        </section>

        {/* ── The intelligence layer ── */}
        <section id="intelligence" className={styles.intel}>
          <div className={styles.intelInner}>
            <div className={styles.intelCopy}>
              <div className={styles.sectionEyebrow}>The intelligence layer</div>
              <h2 className={styles.sectionH2}>
                This isn&rsquo;t a stack of tools. <em>It&rsquo;s one intelligence.</em>
              </h2>
              <p className={styles.sectionP}>
                Every surface on the desk feeds the same brain. The wire it writes at
                dawn, the catalysts it flags before the bell, the verdict it gives your
                next trade, the review it writes on Sunday — one intelligence, carrying
                what it learns from each into all the others.
              </p>
              <p className={styles.intelP2}>
                The more you trade with it, the more precisely it knows <em>you</em> —
                your setups, your sizing, your tilt. Nobody else&rsquo;s desk looks like yours.
              </p>
              <p className={styles.intelVoice}>
                <span aria-hidden="true"><UIcon name="mic" size={14} /></span>
                And you can talk to it — literally. Ask by voice, hear the wire read back.
              </p>
            </div>
            <ol className={styles.loop}>
              {LOOP.map((step) => (
                <li key={step.verb} className={styles.loopStep}>
                  <span className={styles.loopVerb}>{step.verb}</span>
                  <span className={styles.loopDetail}>{step.detail}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── The manual desk ── */}
        <section id="desk" className={styles.manual}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionEyebrow}>The manual desk</div>
            <h2 className={styles.sectionH2}>And when you want your hands on the wheel.</h2>
            <p className={styles.sectionP}>
              The intelligence hands you decisions. Everything underneath is yours to
              drive — professional-grade, and fast.
            </p>
          </div>
          <div className={styles.manualGrid}>
            {MANUAL_TOOLS.map((t, i) => (
              <FadeIn key={t.name} delay={(i % 3) * 90}>
                <div className={styles.tool}>
                  <span className={styles.toolIcon} aria-hidden="true"><UIcon name={t.icon} size={20} /></span>
                  <h3 className={styles.toolH3}>{t.name}</h3>
                  <p className={styles.toolP}>{t.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn>
            <div className={styles.arrange}>
              <div className={styles.arrangeText}>
                <h3 className={styles.arrangeH3}>Arrange it your way.</h3>
                <p className={styles.arrangeP}>
                  Drag, resize, link, save. Workspaces compose like a physical desk —
                  your layouts persist, your views are yours. This isn&rsquo;t a dashboard
                  someone else designed; it&rsquo;s a desk you set up like your own.
                </p>
              </div>
              <div className={styles.arrangeTiles} aria-hidden="true">
                <span className={styles.arrangeTileA} />
                <span className={styles.arrangeTileB} />
                <span className={styles.arrangeTileC} />
                <span className={styles.arrangeTileD} />
              </div>
            </div>
          </FadeIn>
        </section>

        {/* ── Everything on the desk ── */}
        <section className={styles.inventory}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionEyebrow}>Everything on the desk</div>
            <h2 className={styles.sectionH2}>The complete inventory.</h2>
            <p className={styles.sectionP}>
              One subscription. Nothing metered, nothing held back.
            </p>
          </div>
          <div className={styles.invGrid}>
            {INVENTORY.map((g) => (
              <div key={g.group} className={styles.invGroup}>
                <h3 className={styles.invH3}>{g.group}</h3>
                <ul className={styles.invUl}>
                  {g.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* ── Testimonials — renders only with real quotes ── */}
        {TESTIMONIALS.length > 0 && (
          <section className={styles.quotes}>
            <div className={styles.sectionHead}>
              <div className={styles.sectionEyebrow}>From the floor</div>
              <h2 className={styles.sectionH2}>Traders on the desk.</h2>
            </div>
            <div className={styles.quoteGrid}>
              {TESTIMONIALS.map((t) => (
                <figure key={t.name} className={styles.quoteCard}>
                  <blockquote>{t.quote}</blockquote>
                  <figcaption>
                    <strong>{t.name}</strong>
                    <span>{t.detail}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* ── Pricing ── */}
        <section id="pricing" className={styles.price}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionEyebrow}>One plan</div>
            <h2 className={styles.sectionH2}>Everything above. One price.</h2>
            <p className={styles.sectionP}>One good decision a month covers it.</p>
          </div>

          <div className={styles.priceCard}>
            <div className={styles.billingToggle} role="tablist" aria-label="Billing period">
              <button
                role="tab"
                aria-selected={billing === 'annual'}
                className={`${styles.billingBtn} ${billing === 'annual' ? styles.billingBtnActive : ''}`}
                onClick={() => { setBilling('annual'); track('billing_toggle', { billing: 'annual' }) }}
              >
                Annual <span className={styles.billingSave}>2 months free</span>
              </button>
              <button
                role="tab"
                aria-selected={billing === 'monthly'}
                className={`${styles.billingBtn} ${billing === 'monthly' ? styles.billingBtnActive : ''}`}
                onClick={() => { setBilling('monthly'); track('billing_toggle', { billing: 'monthly' }) }}
              >
                Monthly
              </button>
            </div>

            <div className={styles.priceAmt}>
              {priceMain}
              <span className={styles.pricePer}>{priceUnit}</span>
            </div>
            <div className={styles.priceValueLine}>{priceNote}</div>

            <ul className={styles.priceUl}>
              <li>The full intelligence layer — Wire, Catalysts, Compass, Voice</li>
              <li>All market intelligence — UCT 20, Breadth, LiveFlow, Themes</li>
              <li>Charts Workspace, Journal 2.0 with broker auto-sync</li>
              <li>The Floor community &amp; The Desk sessions</li>
              <li>Everything in the inventory above. Unmetered.</li>
            </ul>

            <Link
              to="/signup"
              className={styles.priceCta}
              onClick={() => track('pricing_cta_pro_click', { billing })}
            >
              Start your 14-day free trial
            </Link>
            <div className={styles.priceCompare}>
              A journal alone sells for $399/yr elsewhere. This is the journal —
              <strong> and the desk around it.</strong>
            </div>
          </div>

          <ul className={styles.promises}>
            <li><span aria-hidden="true"><UIcon name="clock" size={15} /></span>14-day full-access trial — no credit card</li>
            <li><span aria-hidden="true"><UIcon name="check" size={15} /></span>Cancel in one click</li>
            <li><span aria-hidden="true"><UIcon name="shield" size={15} /></span>Refunds within 7 days of any charge</li>
            <li><span aria-hidden="true"><UIcon name="download" size={15} /></span>Your data exports completely, always</li>
          </ul>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className={styles.faq}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionEyebrow}>Questions</div>
            <h2 className={styles.sectionH2}>Asked before signing up.</h2>
          </div>
          <div className={styles.faqList}>
            {FAQS.map((f) => (
              <details key={f.q} className={styles.faqItem} onToggle={handleFaqOpen}>
                <summary>{f.q}</summary>
                <div>{f.a}</div>
              </details>
            ))}
          </div>
        </section>

        {/* ── Final close ── */}
        <section className={styles.close}>
          <div className={styles.closeInner}>
            <div className={styles.closeTime}>Tomorrow · 7:35 AM ET</div>
            <h2 className={styles.closeH2}>The first brief can be <em>yours.</em></h2>
            <p className={styles.closeP}>
              Fourteen days, the whole desk, no card. The research starts tonight.
            </p>
            <div className={styles.ctas}>
              <Link
                to="/signup"
                className={styles.ctaGold}
                onClick={() => track('close_cta_pro_click')}
              >
                Start your 14-day free trial
              </Link>
            </div>
            <div className={styles.ctaSubnote}>
              $200/month or $2,000/year after the trial · Cancel in one click
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ── */}
      <footer ref={footerRef} className={styles.foot}>
        <div className={styles.footTop}>
          <div className={styles.footBrand}>
            <span className={styles.footBrandMark} aria-hidden="true"><UIcon name="compass" size={18} /></span>
            <div>
              <div>UCT Intelligence</div>
              <div className={styles.footTagline}>Navigate the market, effectively.</div>
            </div>
          </div>
          <div className={styles.footMid}>
            <Link
              to="/signup"
              className={styles.footCta}
              onClick={() => track('footer_cta_click')}
            >
              Start your free trial →
            </Link>
          </div>
          <div className={styles.footLinks}>
            <Link to="/pricing">Pricing</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/settings?section=legal">Disclaimers</Link>
            <a href="mailto:contact@uctintelligence.com">Contact</a>
          </div>
        </div>
        <div className={styles.footAttr}>
          Built on the methodologies of Qullamaggie, Minervini, O&rsquo;Neil, Kell, and Bonde.
          Research software — not investment advice. Trade at your own risk.
        </div>
        <div className={styles.footMade}>
          Hand-built by a trader, for traders.
        </div>
        <div className={styles.footCopy}>
          &copy; {new Date().getFullYear()} Uncharted Territory
        </div>
      </footer>

      {/* ── Sticky mobile CTA ── */}
      <Link
        to="/signup"
        className={`${styles.stickyCta} ${footerInView ? styles.stickyCtaHidden : ''}`}
        aria-hidden={footerInView}
        onClick={() => track('sticky_cta_click')}
      >
        <span className={styles.stickyCtaText}>Start free trial</span>
        <span className={styles.stickyCtaSub}>14 days · no card</span>
        <span className={styles.stickyCtaArrow} aria-hidden="true">→</span>
      </Link>
    </div>
  )
}

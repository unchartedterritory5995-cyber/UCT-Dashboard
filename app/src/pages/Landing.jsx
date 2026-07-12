import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import useInView from '../hooks/useIntersectionObserver'
import UIcon from '../components/ui/UIcon'
import { track } from '../utils/landingTrack'
import styles from './Landing.module.css'

// Real product captures — actual surfaces from the live desk (July 2026).
import shotModelbook from '../assets/landing/modelbook.webp'
import shotWorkspace from '../assets/landing/workspace.webp'
import shotCatalysts from '../assets/landing/catalysts.webp'
import shotCalendar from '../assets/landing/calendar.webp'
import shotLiveflow from '../assets/landing/liveflow.webp'
import shotBreadthSm from '../assets/landing/breadth_sm.webp'
import shotWire from '../assets/landing/wire.webp'
import shotSetups from '../assets/landing/setups.webp'
import shotPlaybook from '../assets/landing/playbook.webp'

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

// Minutes until the next weekday 7:35 AM ET brief — surfaced inside the
// Intelligence pillar (the Wire really does land at 7:35 every trading day).
function minutesToNextBrief(now = new Date()) {
  const parts = etParts(now)
  const dayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  const mins = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10)
  const BRIEF = 7 * 60 + 35

  let addDays = 0
  if (dayIdx === 0) addDays = 1
  else if (dayIdx === 6) addDays = 2
  else if (mins >= BRIEF) addDays = dayIdx === 5 ? 3 : 1

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
// Product surfaces. `Shot` renders a REAL capture from the live desk;
// `Vignette` renders a crafted, clearly-labeled illustration (used only where
// a real capture would expose personal account data).
// ─────────────────────────────────────────────────────────────────────────────

function Shot({ src, title, time, alt, live = false, eager = false, onZoom }) {
  return (
    <figure className={styles.shot}>
      <button
        type="button"
        className={styles.shotZoom}
        onClick={() => onZoom && onZoom({ src, alt, title })}
        aria-label={`Enlarge: ${title}`}
      >
        {/* App-window chrome — this is the real application, framed as such */}
        <span className={styles.shotBar}>
          <span className={styles.shotDots} aria-hidden="true"><i /><i /><i /></span>
          <span className={styles.shotTitle}>
            {live && <span className={styles.shotLive} />}
            {title}
          </span>
          <span className={styles.shotTime}>{time}</span>
        </span>
        <img
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
        />
        <span className={styles.shotHint} aria-hidden="true">Click to enlarge</span>
      </button>
      <figcaption className={styles.shotCap}>Captured from the live desk · July 2026</figcaption>
    </figure>
  )
}

// Fullscreen lightbox for product captures — ESC or click anywhere to close.
function Lightbox({ item, onClose }) {
  useEffect(() => {
    if (!item) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [item, onClose])
  if (!item) return null
  return (
    <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label={item.title} onClick={onClose}>
      <img src={item.src} alt={item.alt} />
      <div className={styles.lightboxCaption}>{item.title} — captured from the live desk. Click anywhere to close.</div>
    </div>
  )
}

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
          <div className={styles.vigMore}>+ 3 more setups · exposure 115 · 2 distribution days</div>
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
          <div className={styles.vigMore}>17 more, ranked · synthesized from 8 sources</div>
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
            <span className={`${styles.vigDot} ${styles.vigDotLive}`} />
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
      {kind === 'desk' && (
        <>
          <div className={styles.vigHead}>
            <span className={styles.vigDot} />
            <span className={styles.vigTitle}>The Desk · Sessions</span>
            <span className={styles.vigTime}>DAILY</span>
          </div>
          <div className={styles.vigRow}><b aria-hidden="true"><UIcon name="play" size={12} /></b><span>Live Trading Session — Fri</span><em>1:24:06 · 9 chapters</em></div>
          <div className={styles.vigRow}><b aria-hidden="true"><UIcon name="play" size={12} /></b><span>Live Trading Session — Thu</span><em>1:31:40 · recap ready</em></div>
          <div className={styles.vigMore}>every session recorded · education library · workshop</div>
        </>
      )}
      <div className={styles.vigCaption}>Illustrative example</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Content
// ─────────────────────────────────────────────────────────────────────────────

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
      'Voice Assistant — ask anything by voice, hear the Wire read back',
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

// The ten subscriptions this desk replaces — the hero claim, itemized.
const THE_TEN = [
  { name: 'Charting platform', desc: 'drag-resize workspace, 8 timeframes, streaming' },
  { name: 'Options flow tool', desc: 'LiveFlow tape, dark pool, GEX' },
  { name: 'Breadth service', desc: '20+ internals, 8-tier heatmap' },
  { name: 'Pre-market scanner', desc: '20 vetted catalysts, every morning' },
  { name: 'News & squawk', desc: 'real-time wire + curated tweet tape' },
  { name: 'Trade journal', desc: 'broker-synced, excursion analytics' },
  { name: 'Trading community', desc: 'The Floor, live all session' },
  { name: 'Education library', desc: 'Model Book, 48 setup playbooks, daily sessions' },
  { name: 'Research brief', desc: 'the Morning Wire, 7:35 AM sharp' },
  { name: 'AI trading coach', desc: 'verdicts, post-mortems, weekly reviews' },
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
    q: 'Who is this for — and who is it not for?',
    a: 'Built for active US stock and options traders — swing, momentum, day. If you buy index funds once a month, this is more desk than you need. If you trade setups, manage risk by regime, and take your process seriously, this was built for you.',
  },
  {
    q: 'What exactly is in the 7-day trial?',
    a: 'Everything. The trial is the full platform — LiveFlow, the charts workspace, breadth, the Morning Wire, Compass, Catalysts, the Journal, The Floor, all of it, unmetered. A card is required to start, but nothing is charged until the trial ends — cancel before day 7 and you pay nothing.',
  },
  {
    q: 'Is the AI coach actually useful, or a chatbot with a finance skin?',
    a: 'Judge it in the trial. Compass reads your own journal — your setups, your stops, your rules — and cites that data back to you when it says GO, HOLD, or SKIP. It refuses trades that break your rules and tells you why. It gives information, not advice; every decision stays yours.',
  },
  {
    q: 'What happens after 7 days?',
    a: 'Your subscription starts on the card you provided — $200/month or $2,000/year, whichever you picked. Not for you? Cancel in one click any time before the trial ends and you pay nothing; your data exports completely and leaves with you.',
  },
  {
    q: 'Do I need to connect a broker?',
    a: 'No. Everything works without one. If you do link a brokerage, the Journal syncs your trades automatically — fills mirrored exactly — but it’s always optional.',
  },
  {
    q: 'Can I bring my trade history with me?',
    a: 'Yes. The Journal imports your full history via CSV presets built for TradeZella, Tradervue, and TraderSync — or link a brokerage and it backfills automatically. Ten minutes, not a weekend.',
  },
  {
    q: 'How is this different from a screener, a Discord, or a journal app?',
    a: 'It replaces the stack. A screener hands you 200 tickers; the desk hands you twenty vetted reasons. A flow tool shows you the tape; this one shows the tape next to breadth, themes, and your own positions. A Discord gives you noise; The Floor gives you a room with the tape running. A journal app records your trades; this one reads them and coaches you back. One subscription, one desk.',
  },
  {
    q: 'Can I see it before signing up?',
    a: 'You already are — every screenshot on this page is captured from the live product, not a mockup. Beyond that, we publish SUNDAY SCANS free every week, the daily live sessions are recorded on The Desk, and the 7-day trial is the full tour with nothing held back.',
  },
  {
    q: 'Can I cancel? What about refunds?',
    a: 'Cancel in one click from Settings — no contracts, no retention calls. Charges aren’t refundable, which is exactly what the trial is for: seven days with the whole desk to make the call before any charge happens.',
  },
]

// Chip strips under each pillar — compact feature naming.
const PILLAR_CHIPS = {
  market: ['LiveFlow tape', 'Dark-pool prints', 'GEX', 'Breadth Monitor', 'COT', '99 themes', 'Stock Catalysts', 'UCT 20', 'Calendar', 'News + tweet tape', '3,685 tickers streaming'],
  charts: ['Drag-resize tiles', '4 link groups', '8 timeframes', 'Streaming bars', 'Drawing tools', 'Pattern callouts', 'Deep history', 'Fundamentals widget', 'Mobile workspace'],
  ai: ['Morning Wire', 'Compass verdicts', 'Post-mortems', 'Tilt detection', 'Weekly reviews', 'Voice — full conversations', 'Pattern Engine — 85 detectors', 'UCT Brain', 'UCT-Mentor'],
  journal: ['Broker auto-sync', 'MFE / MAE excursions', 'Exit quality', 'Regime analytics', 'Risk block', 'Equity curve', 'Notebook', 'CSV presets', 'Share cards'],
  learn: ['Model Book — annotated legends', '48 setup playbooks', 'Compass post-mortems', 'Weekly reviews', 'UCT Brain — 7,800+ entries', 'Education library & workshop'],
  floor: ['Live floor chat', 'Trade & chart cards', 'The Tape', 'Boards', 'Verified badges', 'Daily session recordings', 'Chapters & recaps', 'Education library', 'Workshop'],
}

function ChipRow({ chips }) {
  return (
    <div className={styles.chips}>
      {chips.map((c) => <span key={c} className={styles.chip}>{c}</span>)}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Landing() {
  const [billing, setBilling] = useState('annual') // 'annual' | 'monthly'
  const [zoomed, setZoomed] = useState(null)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
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

  const scrollTo = (id) => (e) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const [footerRef, footerInView] = useInView({ threshold: 0.05 })

  // Annual leads with the effective monthly rate — never let $2,000 be the
  // headline figure (the billed total lives in the note line).
  const priceMain = billing === 'annual' ? '$167' : '$200'
  const priceUnit = '/month'
  const priceNote = billing === 'annual'
    ? 'Billed $2,000/year — two months free.'
    : 'Billed monthly. Cancel anytime.'

  return (
    <div className={styles.page}>
      <a href="#main" className={styles.skipLink}>Skip to main content</a>

      {/* ── Nav ── */}
      <nav className={`${styles.nav} ${scrolled ? styles.navScrolled : ''}`}>
        <div className={styles.navBrand}>
          <span className={styles.navMark} aria-hidden="true"><UIcon name="compass" size={18} /></span>
          UCT Intelligence
        </div>
        <div className={styles.navLinks}>
          <a href="#platform" onClick={scrollTo('platform')}>Platform</a>
          <a href="#intelligence" onClick={scrollTo('intelligence')}>Agentic AI</a>
          <a href="#everything" onClick={scrollTo('everything')}>What&rsquo;s inside</a>
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

        {/* ── Hero — the whole operation ── */}
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div className={styles.heroBody}>
              <div className={`${styles.heroEyebrow} ${styles[`heroEyebrow_${marketStatus.tone}`]} ${styles.enter} ${styles.enter1}`}>
                <span className={styles.eyebrowDot} />
                {marketStatus.label}
              </div>
              <h1 className={`${styles.heroH1} ${styles.enter} ${styles.enter2}`}>
                10 subscriptions in 1. <em>Everything you need.</em>
              </h1>
              <p className={`${styles.heroSub} ${styles.enter} ${styles.enter3}`}>
                Charts. The live options tape. Breadth, a pre-market scanner, the
                news, a broker-synced journal, a floor of real traders, a full
                education library — run by an agentic AI that reads the market while
                you sleep, briefs you at 7:35, and coaches every trade you take.
              </p>
              <div className={`${styles.ctas} ${styles.enter} ${styles.enter4}`}>
                <Link
                  to="/signup"
                  className={styles.ctaGold}
                  onClick={() => track('hero_cta_pro_click')}
                >
                  Start your 7-day free trial
                </Link>
                <a href="#platform" className={styles.ctaGhost} onClick={scrollTo('platform')}>
                  See the platform
                </a>
              </div>
              <div className={`${styles.ctaSubnote} ${styles.enter} ${styles.enter5}`}>
                $0 today · Full access from minute one · $200/mo after the trial
              </div>
            </div>

            {/* The hero artifact — one big, readable, real capture */}
            <div className={`${styles.heroMosaic} ${styles.enter} ${styles.enter4}`}>
              <Shot
                src={shotModelbook}
                title="Model Book · NVDA 2023"
                time="+234% · ANNOTATED"
                eager
                onZoom={setZoomed}
                alt="The Model Book — NVDA's 2023 run with every catalyst labeled on the chart: earnings blowouts, AI guidance, the trillion-dollar milestone"
              />
              <div className={styles.mosaicChatLine}>
                <span className={styles.vigBadgeGo}>COMPASS</span>
                <span>Two stops today — your rule says A+ setups only. This one’s a SKIP.</span>
              </div>
              <div className={styles.mosaicCaption}>Real product · captured July 2026</div>
            </div>
          </div>
        </section>

        {/* ── The stack it replaces ── */}
        <section className={styles.shift}>
          <FadeIn>
            <div className={styles.shiftEyebrow}>One subscription</div>
            <h2 className={styles.shiftH2}>
              The whole stack. <em>One login, one screen, one brain.</em>
            </h2>
            <p className={styles.shiftP}>
              Serious traders end up paying for a stack of subscriptions that never
              talk to each other. Here is that stack — every piece of it on this
              desk, sharing one intelligence.
            </p>
            <ol className={styles.ten}>
              {THE_TEN.map((t, i) => (
                <li key={t.name} className={styles.tenItem}>
                  <span className={styles.tenNum}>{String(i + 1).padStart(2, '0')}</span>
                  <span className={styles.tenName}>{t.name}</span>
                  <span className={styles.tenDesc}>{t.desc}</span>
                </li>
              ))}
            </ol>
            <div className={styles.tenTotal}>
              <span>Bought separately, traders commonly pay <strong>$250–$500 a month</strong> for this stack.</span>
              <span className={styles.tenTotalRight}>Here: <strong>$200/mo — sharing one brain.</strong></span>
            </div>
            <p className={styles.shiftQualifier}>
              Built for committed swing and momentum traders, on the methodologies of
              O&rsquo;Neil, Minervini, and Qullamaggie — the setups, the regime discipline,
              the exposure model.
            </p>
          </FadeIn>
        </section>

        {/* ── Founder note ── */}
        <section className={styles.founder}>
          <FadeIn>
            <div className={styles.founderCard}>
              <div className={styles.sectionEyebrow}>Why this exists</div>
              <p className={styles.founderP}>
                I built this because I was the customer. I trade every morning, and I
                was paying for six tools that didn&rsquo;t talk to each other — a journal
                here, a flow tool there, a chat room somewhere else, charts in a
                fourth tab. So I built the desk I wanted to sit at: one screen, one
                brain, everything talking.
              </p>
              <p className={styles.founderP}>
                Every feature on this page exists because I use it live, at the open,
                every session — the same Wire, the same verdicts, the same desk you
                get. No investors, no growth team. One trader.
              </p>
              <div className={styles.founderSig}>Hand-built by a trader, for traders.</div>
            </div>
          </FadeIn>
        </section>

        {/* ── Pillar · The intelligence layer (the moat leads) ── */}
        <section id="intelligence" className={`${styles.pillar} ${styles.pillarBand}`}>
          <div className={styles.pillarInner}>
            <div className={styles.pillarCopy}>
              <div className={styles.sectionEyebrow}>Agentic trading</div>
              <h2 className={styles.sectionH2}>
                Agents on your desk, <em>working while you sleep.</em>
              </h2>
              <p className={styles.sectionP}>
                Every surface feeds the same brain. It reads 8 sources overnight and
                writes your brief for 7:35 AM. It flags catalysts before the bell,
                gives your next trade a straight GO / HOLD / SKIP verdict, learns your
                setups and your tilt from the journal, and writes your weekly review
                on Sunday. The more you trade with it, the more precisely it knows
                <em> you</em>.
              </p>
              <p className={styles.intelP2}>
                The point isn&rsquo;t more information — it&rsquo;s <em>less work</em>. The desk
                does the reading, the screening, the journaling, and the reviewing;
                you make the decisions.
              </p>
              <p className={styles.intelLineage}>
                The brain is trained on the playbooks of Minervini, O&rsquo;Neil,
                Qullamaggie, Kell, and Bonde — 7,800+ curated knowledge entries,
                48 setup templates.
              </p>
              <p className={styles.intelVoice}>
                <span aria-hidden="true"><UIcon name="mic" size={14} /></span>
                Talk to it — literally. Ask by voice, hear the wire read back.
              </p>
              <div className={styles.briefCountdown}>
                <span className={styles.briefCountdownDot} aria-hidden="true" />
                The desk reads tonight — the next brief lands in{' '}
                <strong>{formatCountdown(briefMins)}</strong>
              </div>
              <ChipRow chips={PILLAR_CHIPS.ai} />
            </div>
            <div className={styles.pillarSide}>
              <Shot
                src={shotWire}
                title="The Morning Wire"
                time="FRI JUL 10 · 7:41 AM ET"
                onZoom={setZoomed}
                alt="A real Morning Wire brief — today's focus, the tape, and what's driving it"
              />
              <Shot
                src={shotCatalysts}
                title="Stock Catalysts"
                time="FRI JUL 10 · RANKED"
                onZoom={setZoomed}
                alt="Friday's Stock Catalysts — ranked tickers with the AI-written catalyst behind each move"
              />
            </div>
          </div>
        </section>

        {/* ── Pillar · Live market intelligence ── */}
        <section id="platform" className={styles.pillar}>
          <div className={`${styles.pillarInner} ${styles.pillarFlip}`}>
            <div className={styles.pillarCopy}>
              <div className={styles.sectionEyebrow}>Live market intelligence</div>
              <h2 className={styles.sectionH2}>See the whole market moving. <em>Live.</em></h2>
              <p className={styles.sectionP}>
                The options tape streaming sweeps, blocks, and dark-pool prints.
                Breadth on an eight-tier heatmap with 500 days of analogues. 99 themes
                across 1,928 stocks so you see rotation the moment it starts — and
                twenty vetted catalysts every morning, ranked with the reason attached.
              </p>
              <ChipRow chips={PILLAR_CHIPS.market} />
            </div>
            <div className={styles.pillarSide}>
              <Shot
                src={shotLiveflow}
                title="LiveFlow · market read"
                time="JUN 26 SESSION"
                live
                onZoom={setZoomed}
                alt="LiveFlow — bullish market read with bull/bear premium flow and the graded options tape"
              />
              <div className={styles.sideRow}>
                <Shot
                  src={shotBreadthSm}
                  title="Breadth"
                  time="8-TIER HEAT"
                  onZoom={setZoomed}
                  alt="The breadth monitor heatmap — moving-average breadth tiers"
                />
                <Shot
                  src={shotCalendar}
                  title="Calendar"
                  time="WEEK AHEAD"
                  onZoom={setZoomed}
                  alt="The earnings calendar — a logo-forward week of reporting companies"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── Pillar · Charts ── */}
        <section className={`${styles.pillar} ${styles.pillarBand}`}>
          <div className={styles.pillarInner}>
            <div className={styles.pillarCopy}>
              <div className={styles.sectionEyebrow}>The charts</div>
              <h2 className={styles.sectionH2}>Charts you arrange <em>like a physical desk.</em></h2>
              <p className={styles.sectionP}>
                Drag-resize chart tiles, link them in four color groups, run eight
                timeframes on streaming bars. Drawings you grab and move like objects,
                patterns called out on the chart, fundamentals one glance away. Your
                layouts persist — set the desk once, and it&rsquo;s there every morning.
              </p>
              <ChipRow chips={PILLAR_CHIPS.charts} />
            </div>
            <div className={styles.pillarSide}>
              <Shot
                src={shotWorkspace}
                title="Charts Workspace · DDOG 1D"
                time="8 TF · LINKED"
                onZoom={setZoomed}
                alt="A chart tile from the workspace — DDOG daily with four moving averages and volume, streaming"
              />
            </div>
          </div>
        </section>

        {/* ── Pillar · Journal 2.0 ── */}
        <section className={styles.pillar}>
          <div className={`${styles.pillarInner} ${styles.pillarFlip}`}>
            <div className={styles.pillarCopy}>
              <div className={styles.sectionEyebrow}>Journal 2.0</div>
              <h2 className={styles.sectionH2}>A journal that <em>does its own homework.</em></h2>
              <p className={styles.sectionP}>
                Link a brokerage and your trades import themselves — fills mirrored
                exactly. Every trade gets excursions, exit quality, and R. Your stats
                split by market regime, so you know what actually works in each tape.
                Then the coach reads it all and tells you what to change.
              </p>
              <ChipRow chips={PILLAR_CHIPS.journal} />
            </div>
            <div className={styles.pillarSide}>
              <Vignette kind="journal" />
              <Vignette kind="review" />
            </div>
          </div>
        </section>

        {/* ── Pillar · It teaches you — full-width showcase ── */}
        <section className={`${styles.pillar} ${styles.pillarBand}`}>
          <div className={styles.learnWide}>
            <div className={`${styles.sectionHead} ${styles.learnHead}`}>
              <div className={styles.sectionEyebrow}>It teaches you</div>
              <h2 className={styles.sectionH2}>A desk that makes you <em>a better trader.</em></h2>
              <p className={styles.sectionP}>
                Every legendary run in market history, annotated candle by candle in
                the Model Book. A 48-setup library with the playbook for each. Daily
                session recordings with chapters — and a coach that reviews your week
                from your own numbers, so the lessons come from your trading, not a course.
              </p>
            </div>
            <Shot
              src={shotSetups}
              title="Setup Library · SMCI 2024 Flat Base Breakout"
              time="+218% IN 20 DAYS · EVERY SIGNAL LABELED"
              onZoom={setZoomed}
              alt="A Setup Library example — SMCI's flat-base breakout annotated with the kicker candle, shakeout, and volume signature"
            />
            <div className={styles.learnRow}>
              <Shot
                src={shotPlaybook}
                title="The Playbook · Pocket Pivot"
                time="ENTRY · STOP · MISTAKES"
                onZoom={setZoomed}
                alt="A setup playbook — ideal regime, entry rules, stop placement, invalidation, and common mistakes"
              />
              <div className={styles.learnRowCopy}>
                <p className={styles.sectionP}>
                  Forty-eight setups, each with its dossier: the ideal regime, the
                  exact entry, where the stop lives, what invalidates it — and the
                  common mistakes that kill it, written out so you don&rsquo;t pay for
                  them twice.
                </p>
                <ChipRow chips={PILLAR_CHIPS.learn} />
              </div>
            </div>
          </div>
        </section>

        {/* ── Pillar · The Floor & The Desk ── */}
        <section className={styles.pillar}>
          <div className={`${styles.pillarInner} ${styles.pillarFlip}`}>
            <div className={styles.pillarCopy}>
              <div className={styles.sectionEyebrow}>The Floor &amp; The Desk</div>
              <h2 className={styles.sectionH2}>You&rsquo;re not trading <em>alone anymore.</em></h2>
              <p className={styles.sectionP}>
                The Floor is live all session — real traders, real positions, trade
                cards and charts flying, the tape running in the room. And every day
                on The Desk, the live trading session is recorded, chaptered, and
                recapped, next to a full education library.
              </p>
              <ChipRow chips={PILLAR_CHIPS.floor} />
            </div>
            <div className={styles.pillarSide}>
              <Vignette kind="floor" />
              <Vignette kind="desk" />
            </div>
          </div>
        </section>

        {/* ── Everything on the desk ── */}
        <section id="everything" className={styles.inventory}>
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

        {/* ── Your first 7 days ── */}
        <section className={styles.trial}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionEyebrow}>Your first 7 days</div>
            <h2 className={styles.sectionH2}>What the trial actually looks like.</h2>
            <p className={styles.sectionP}>
              Full access from minute one — and the desk starts working before you do.
            </p>
          </div>
          <ol className={styles.trialSteps}>
            <li className={styles.trialStep}>
              <span className={styles.trialWhen}>Tonight</span>
              <span className={styles.trialWhat}>The desk reads 8 sources while you sleep.</span>
            </li>
            <li className={styles.trialStep}>
              <span className={styles.trialWhen}>7:35 AM</span>
              <span className={styles.trialWhat}>Your first Morning Wire lands — regime, exposure, five setups.</span>
            </li>
            <li className={styles.trialStep}>
              <span className={styles.trialWhen}>Day 2</span>
              <span className={styles.trialWhat}>Link your broker — the journal fills itself, history included.</span>
            </li>
            <li className={styles.trialStep}>
              <span className={styles.trialWhen}>Sunday</span>
              <span className={styles.trialWhat}>Compass writes your first weekly review from your own trades.</span>
            </li>
            <li className={styles.trialStep}>
              <span className={styles.trialWhen}>Day 7</span>
              <span className={styles.trialWhat}>You decide. Cancel in one click before the trial ends and you pay nothing.</span>
            </li>
          </ol>
        </section>

        {/* ── Pricing ── */}
        <section id="pricing" className={styles.price}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionEyebrow}>One plan</div>
            <h2 className={styles.sectionH2}>The whole operation. One price.</h2>
            <p className={styles.sectionP}>
              About $8 a trading day on annual — less than the stack it replaces.
            </p>
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
              <li>Live market intelligence — LiveFlow, Breadth, Themes, Catalysts</li>
              <li>The full charts workspace, streaming</li>
              <li>The intelligence layer — Wire, Compass, Voice, Pattern Engine</li>
              <li>Journal 2.0 with broker auto-sync</li>
              <li>The Floor community &amp; The Desk sessions</li>
              <li>Everything in the inventory above. Unmetered.</li>
            </ul>

            <Link
              to="/signup"
              className={styles.priceCta}
              onClick={() => track('pricing_cta_pro_click', { billing })}
            >
              Start the 7-day free trial
            </Link>
            <div className={styles.priceCtaSub}>
              Card required · $0 today — nothing is charged until the trial ends. Cancel in one click.
            </div>
            <div className={styles.priceCompare}>
              Run the math on a typical stack — journal, flow tool, charting
              platform, screener, paid community. Traders commonly pay $250–$500 a
              month across five or six subscriptions that never talk to each other.
              <strong> This is all of them, sharing one brain.</strong>
            </div>
          </div>

          <ul className={styles.promises}>
            <li><span aria-hidden="true"><UIcon name="clock" size={15} /></span>7-day full-access trial — $0 today</li>
            <li><span aria-hidden="true"><UIcon name="check" size={15} /></span>Cancel in one click</li>
            <li><span aria-hidden="true"><UIcon name="shield" size={15} /></span>No charge until the trial ends</li>
            <li><span aria-hidden="true"><UIcon name="download" size={15} /></span>Your data exports completely, always</li>
          </ul>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className={styles.faq}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionEyebrow}>Questions</div>
            <h2 className={styles.sectionH2}>What traders ask before signing up.</h2>
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

        {/* ── Not ready yet? The Sunday letter ── */}
        <section className={styles.letter}>
          <div className={styles.letterInner}>
            <div>
              <div className={styles.sectionEyebrow}>Not ready yet?</div>
              <h2 className={styles.letterH2}>Read the free Sunday letter first.</h2>
              <p className={styles.letterP}>
                SUNDAY SCANS — the setups, charts, and market read we publish every
                Sunday. Free, no account needed. See how the desk thinks before you
                sit at it.
              </p>
            </div>
            <a
              className={styles.letterCta}
              href="https://unchartedterritoryy.substack.com/subscribe"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track('substack_cta_click')}
            >
              Get SUNDAY SCANS free →
            </a>
          </div>
        </section>

        {/* ── Final close ── */}
        <section className={styles.close}>
          <div className={styles.closeInner}>
            <div className={styles.closeTime}>7 days · full access · $0 today</div>
            <h2 className={styles.closeH2}>Take your seat <em>at the desk.</em></h2>
            <p className={styles.closeP}>
              Everything above unlocks in the next two minutes. Your first brief
              lands at 7:35 tomorrow morning.
            </p>
            <div className={styles.ctas}>
              <Link
                to="/signup"
                className={styles.ctaGold}
                onClick={() => track('close_cta_pro_click')}
              >
                Take your seat — start the trial
              </Link>
            </div>
            <div className={styles.ctaSubnote}>
              $200/month or $2,000/year after the trial · Cancel in one click
            </div>
            <div className={styles.closeCountdown}>
              <span className={styles.briefCountdownDot} aria-hidden="true" />
              The desk reads tonight — your first brief lands in{' '}
              <strong>{formatCountdown(briefMins)}</strong>
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

      <Lightbox item={zoomed} onClose={() => setZoomed(null)} />

      {/* ── Sticky mobile CTA ── */}
      <Link
        to="/signup"
        className={`${styles.stickyCta} ${footerInView ? styles.stickyCtaHidden : ''}`}
        aria-hidden={footerInView}
        onClick={() => track('sticky_cta_click')}
      >
        <span className={styles.stickyCtaText}>Start free trial</span>
        <span className={styles.stickyCtaSub}>7 days free · $0 today</span>
        <span className={styles.stickyCtaArrow} aria-hidden="true">→</span>
      </Link>
    </div>
  )
}

import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
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
// Illustrative product surfaces — small, faithful, clearly-labeled sketches of
// what each area of the platform looks like. Representative data only.
// ─────────────────────────────────────────────────────────────────────────────

// Hand-authored uptrend with a mid-base — [open, high, low, close] in 0–100.
const CANDLES = [
  [30, 33, 28, 32], [32, 35, 31, 34], [34, 36, 32, 33], [33, 34, 30, 31],
  [31, 33, 29, 32], [32, 37, 32, 36], [36, 40, 35, 39], [39, 42, 38, 41],
  [41, 43, 39, 40], [40, 41, 37, 38], [38, 40, 36, 39], [39, 44, 39, 43],
  [43, 47, 42, 46], [46, 50, 45, 49], [49, 51, 46, 47], [47, 49, 45, 48],
  [48, 53, 47, 52], [52, 57, 51, 56], [56, 60, 55, 59], [59, 61, 56, 57],
  [57, 60, 55, 59], [59, 64, 58, 63], [63, 68, 62, 67], [67, 71, 65, 70],
]

function MiniChart({ height = 150 }) {
  const W = 340
  const H = 110
  const n = CANDLES.length
  const bw = W / n
  const y = (v) => H - (v / 100) * H

  // Simple 5-bar MA of closes for the overlay line.
  const ma = CANDLES.map((_, i) => {
    const from = Math.max(0, i - 4)
    const slice = CANDLES.slice(from, i + 1)
    return slice.reduce((s, c) => s + c[3], 0) / slice.length
  })
  const maPath = ma.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i + 0.5) * bw} ${y(v)}`).join(' ')

  return (
    <svg
      className={styles.miniChart}
      viewBox={`0 0 ${W} ${H}`}
      style={{ height }}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {[25, 50, 75].map((g) => (
        <line key={g} x1="0" y1={y(g)} x2={W} y2={y(g)} className={styles.chartGrid} />
      ))}
      {/* trendline along the base lows — a nod to the drawing tools */}
      <line
        x1={3.5 * bw} y1={y(29)} x2={16.5 * bw} y2={y(45.5)}
        className={styles.chartTrendline}
      />
      {CANDLES.map(([o, h, l, c], i) => {
        const up = c >= o
        const cx = (i + 0.5) * bw
        return (
          <g key={i} className={up ? styles.candleUp : styles.candleDown}>
            <line x1={cx} y1={y(h)} x2={cx} y2={y(l)} />
            <rect
              x={cx - bw * 0.3}
              y={y(Math.max(o, c))}
              width={bw * 0.6}
              height={Math.max(1.5, Math.abs(y(o) - y(c)))}
            />
          </g>
        )
      })}
      <path d={maPath} className={styles.chartMa} />
    </svg>
  )
}

const TAPE_ROWS = [
  { sym: 'NVDA', det: '190C 07/25', prem: '$2.4M', kind: 'SWEEP', up: true },
  { sym: 'SPY',  det: '628P 07/14', prem: '$1.1M', kind: 'BLOCK', up: false },
  { sym: 'AVGO', det: '300C 08/15', prem: '$3.8M', kind: 'SWEEP', up: true },
  { sym: 'TSLA', det: 'DARK POOL',  prem: '$6.2M', kind: 'PRINT', up: true },
  { sym: 'PLTR', det: '160C 07/18', prem: '$890K', kind: 'SWEEP', up: true },
  { sym: 'QQQ',  det: '560P 07/21', prem: '$1.7M', kind: 'BLOCK', up: false },
]

function TapeCard({ compact = false }) {
  const rows = compact ? TAPE_ROWS.slice(0, 4) : TAPE_ROWS
  return (
    <div className={styles.vig} aria-hidden="true">
      <div className={styles.vigHead}>
        <span className={`${styles.vigDot} ${styles.vigDotLive}`} />
        <span className={styles.vigTitle}>LiveFlow</span>
        <span className={styles.vigTime}>STREAMING</span>
      </div>
      <div className={styles.tapeWindow}>
        <div className={styles.tapeScroll}>
          {[...rows, ...rows].map((r, i) => (
            <div key={i} className={styles.tapeRow}>
              <b>{r.sym}</b>
              <span>{r.det}</span>
              <em className={r.up ? styles.vigGreen : styles.vigRed}>{r.prem}</em>
              <i>{r.kind}</i>
            </div>
          ))}
        </div>
      </div>
      {!compact && <div className={styles.vigCaption}>Illustrative example</div>}
    </div>
  )
}

// Eight-tier breadth tints, sampled from the app's real heat palette.
const HEAT = [
  'rgba(10,50,22,0.97)', 'rgba(22,100,48,0.8)', 'rgba(74,222,128,0.16)',
  'rgba(180,130,20,0.32)', 'rgba(248,113,113,0.16)', 'rgba(22,100,48,0.8)',
]
const HEAT_CELLS = [0, 1, 1, 2, 1, 0, 2, 3, 1, 1, 5, 2, 0, 1, 4, 1, 2, 1]

function BreadthCard({ compact = false }) {
  return (
    <div className={styles.vig} aria-hidden="true">
      <div className={styles.vigHead}>
        <span className={styles.vigDot} />
        <span className={styles.vigTitle}>Breadth</span>
        <span className={styles.vigTime}>TIER 6 · RISK-ON</span>
      </div>
      <div className={styles.heatGrid}>
        {HEAT_CELLS.slice(0, compact ? 12 : 18).map((t, i) => (
          <span key={i} style={{ background: HEAT[t] }} />
        ))}
      </div>
      {!compact && (
        <div className={styles.vigMore}>20+ internals · 500-day analogue: 2020-06 rally</div>
      )}
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

// The agentic loop — what the intelligence layer does, in order.
const LOOP = [
  { verb: 'Reads',    detail: '8 sources, every night, cover to cover' },
  { verb: 'Briefs',   detail: 'the Morning Wire, 7:35 AM sharp' },
  { verb: 'Flags',    detail: 'catalysts as they form, pre-market' },
  { verb: 'Verdicts', detail: 'GO / HOLD / SKIP — before you click buy' },
  { verb: 'Learns',   detail: 'from every trade in your journal' },
  { verb: 'Coaches',  detail: 'your week, every Sunday evening' },
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
    a: 'Everything. The trial is the full platform — LiveFlow, the charts workspace, breadth, the Morning Wire, Compass, Catalysts, the Journal, The Floor, all of it, unmetered. No credit card to start, and nothing is charged unless you subscribe.',
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
    a: 'It replaces the stack. A screener hands you 200 tickers; the desk hands you twenty vetted reasons. A flow tool shows you the tape; this one shows the tape next to breadth, themes, and your own positions. A Discord gives you noise; The Floor gives you a room with the tape running. A journal app records your trades; this one reads them and coaches you back. One subscription, one desk.',
  },
  {
    q: 'Can I cancel? What about refunds?',
    a: 'Cancel in one click from Settings — no contracts, no retention calls. Any charge is refundable within 7 days, no questions asked.',
  },
]

// Chip strips under each pillar — compact feature naming.
const PILLAR_CHIPS = {
  market: ['LiveFlow tape', 'Dark-pool prints', 'GEX', 'Breadth Monitor', 'COT', '99 themes', 'Stock Catalysts', 'UCT 20', 'Calendar', 'News + tweet tape', '3,685 tickers streaming'],
  charts: ['Drag-resize tiles', '4 link groups', '8 timeframes', 'Streaming bars', 'Drawing tools', 'Pattern callouts', 'Deep history', 'Fundamentals widget', 'Mobile workspace'],
  ai: ['Morning Wire', 'Compass verdicts', 'Post-mortems', 'Tilt detection', 'Weekly reviews', 'Voice — 88 tools', 'Pattern Engine — 85 detectors', 'UCT Brain', 'UCT-Mentor'],
  journal: ['Broker auto-sync', 'MFE / MAE excursions', 'Exit quality', 'Regime analytics', 'Risk block', 'Equity curve', 'Notebook', 'CSV presets', 'Share cards'],
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
          <a href="#platform" onClick={scrollTo('platform')}>Platform</a>
          <a href="#intelligence" onClick={scrollTo('intelligence')}>Intelligence</a>
          <a href="#everything" onClick={scrollTo('everything')}>Everything</a>
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
                Your entire trading operation. <em>One desk.</em>
              </h1>
              <p className={`${styles.heroSub} ${styles.enter} ${styles.enter3}`}>
                Live charts. The options tape. Market breadth, 99 rotation themes,
                vetted catalysts. A journal that syncs itself from your broker, and a
                floor of real traders — with one AI woven through all of it, reading
                the market while you sleep and coaching every trade you take.
              </p>
              <div className={`${styles.ctas} ${styles.enter} ${styles.enter4}`}>
                <Link
                  to="/signup"
                  className={styles.ctaGold}
                  onClick={() => track('hero_cta_pro_click')}
                >
                  Start your 14-day free trial
                </Link>
                <a href="#platform" className={styles.ctaGhost} onClick={scrollTo('platform')}>
                  See the platform
                </a>
              </div>
              <div className={`${styles.ctaSubnote} ${styles.enter} ${styles.enter5}`}>
                No credit card · Full access from minute one · Cancel in one click
              </div>
            </div>

            {/* The operation, at a glance — live-feeling product surfaces */}
            <div className={`${styles.heroMosaic} ${styles.enter} ${styles.enter4}`} aria-hidden="true">
              <div className={styles.mosaicChart}>
                <div className={styles.vigHead}>
                  <span className={styles.vigDot} />
                  <span className={styles.vigTitle}>NVDA · 1D</span>
                  <span className={styles.vigTime}>WORKSPACE</span>
                </div>
                <MiniChart height={130} />
              </div>
              <div className={styles.mosaicCell}><TapeCard compact /></div>
              <div className={styles.mosaicCell}><BreadthCard compact /></div>
              <div className={styles.mosaicWide}>
                <div className={styles.mosaicChatLine}>
                  <span className={styles.vigBadgeGo}>COMPASS</span>
                  <span>Two stops today — your rule says A+ setups only. This one’s a SKIP.</span>
                </div>
              </div>
              <div className={styles.mosaicCaption}>Illustrative data</div>
            </div>
          </div>
        </section>

        {/* ── The stack it replaces ── */}
        <section className={styles.shift}>
          <FadeIn>
            <div className={styles.shiftEyebrow}>One subscription</div>
            <h2 className={styles.shiftH2}>
              A charting app. A flow tool. A screener. A journal. A chat room.
              A news feed. <em>This is all of them — on one screen.</em>
            </h2>
            <p className={styles.shiftP}>
              Serious traders end up paying five or six services that don&rsquo;t talk to
              each other. UCT Intelligence is the whole stack, built as one desk —
              where the tape, the charts, your journal, and the room all share the
              same brain.
            </p>
          </FadeIn>
        </section>

        {/* ── Pillar · Live market intelligence ── */}
        <section id="platform" className={`${styles.pillar} ${styles.pillarBand}`}>
          <div className={styles.pillarInner}>
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
              <TapeCard />
              <BreadthCard />
            </div>
          </div>
        </section>

        {/* ── Pillar · Charts ── */}
        <section className={styles.pillar}>
          <div className={`${styles.pillarInner} ${styles.pillarFlip}`}>
            <div className={styles.pillarCopy}>
              <div className={styles.sectionEyebrow}>The charts</div>
              <h2 className={styles.sectionH2}>A workspace you compose <em>like a physical desk.</em></h2>
              <p className={styles.sectionP}>
                Drag-resize chart tiles, link them in four color groups, run eight
                timeframes on streaming bars. Drawings you grab and move like objects,
                patterns called out on the chart, fundamentals one glance away. Your
                layouts persist — this is a desk you arrange like your own.
              </p>
              <ChipRow chips={PILLAR_CHIPS.charts} />
            </div>
            <div className={styles.pillarSide}>
              <div className={styles.vig} aria-hidden="true">
                <div className={styles.vigHead}>
                  <span className={styles.vigDot} />
                  <span className={styles.vigTitle}>Charts Workspace</span>
                  <span className={styles.vigTime}>8 TF · LINKED</span>
                </div>
                <MiniChart height={170} />
                <div className={styles.vigCaption}>Illustrative example</div>
              </div>
              <div className={styles.arrangeTiles} aria-hidden="true">
                <span className={styles.arrangeTileA} />
                <span className={styles.arrangeTileB} />
                <span className={styles.arrangeTileC} />
                <span className={styles.arrangeTileD} />
              </div>
            </div>
          </div>
        </section>

        {/* ── Pillar · The intelligence layer ── */}
        <section id="intelligence" className={`${styles.pillar} ${styles.pillarBand}`}>
          <div className={styles.pillarInner}>
            <div className={styles.pillarCopy}>
              <div className={styles.sectionEyebrow}>The intelligence layer</div>
              <h2 className={styles.sectionH2}>
                And one intelligence, <em>woven through all of it.</em>
              </h2>
              <p className={styles.sectionP}>
                Every surface feeds the same brain. It reads 8 sources overnight and
                writes your brief for 7:35 AM. It flags catalysts before the bell,
                gives your next trade a straight GO / HOLD / SKIP verdict, learns your
                setups and your tilt from the journal, and writes your weekly review
                on Sunday. The more you trade with it, the more precisely it knows
                <em> you</em>.
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
              <ol className={styles.loop}>
                {LOOP.map((step) => (
                  <li key={step.verb} className={styles.loopStep}>
                    <span className={styles.loopVerb}>{step.verb}</span>
                    <span className={styles.loopDetail}>{step.detail}</span>
                  </li>
                ))}
              </ol>
              <Vignette kind="compass" />
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

        {/* ── Pillar · The Floor & The Desk ── */}
        <section className={`${styles.pillar} ${styles.pillarBand}`}>
          <div className={styles.pillarInner}>
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

        {/* ── Pricing ── */}
        <section id="pricing" className={styles.price}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionEyebrow}>One plan</div>
            <h2 className={styles.sectionH2}>The whole operation. One price.</h2>
            <p className={styles.sectionP}>Less than the stack it replaces.</p>
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
            <div className={styles.closeTime}>14 days · full access · no card</div>
            <h2 className={styles.closeH2}>Take your seat <em>at the desk.</em></h2>
            <p className={styles.closeP}>
              Everything above unlocks in the next two minutes. The research starts tonight.
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

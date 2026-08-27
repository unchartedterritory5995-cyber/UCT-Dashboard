/**
 * JournalSnapshotTile — Robinhood-style portfolio snapshot on the Dashboard.
 *
 * Replaces the old Compass · Today tile. Shows the user's Journal 2.0 open
 * book at a glance and click-throughs into /journal?j2tab=positions.
 *
 * Two hero variants, picked by account type:
 *   - BROKER accounts → authoritative net-liq balance + Today/period P&L +
 *     an equity sparkline, all from the broker performance engine
 *     (account.brokerTotalEquity + /api/j2/broker/performance). This is the
 *     same source the Open Positions tab's BrokerAccountHero uses, so the
 *     number is always populated and never collapses to $0.00 when the live
 *     price feed lags or the market is closed.
 *   - MANUAL accounts → live mark-to-market of open equity positions
 *     (portfolioAggregates over useRealtimePrices) + Today + Open P&L.
 *
 * Plus a short open-positions list (equity + options) and an onboarding empty
 * state. Zero new backend — reuses existing J2 endpoints + helpers.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
// Tab-aware SWR: same API as `useSWR`, but pauses polling when the dashboard tab
// is hidden (and halves cadence on mobile) — this tile's 15s polls used to run
// forever in background tabs. Drop-in, so call sites are unchanged. (perf pass)
import useSWR from '../../hooks/useMobileSWR'
import TileCard from '../TileCard'
import useRealtimePrices from '../../hooks/useRealtimePrices'
import useJ2BrokerPerformance from '../../pages/journal-2-0/hooks/useJ2BrokerPerformance'
import {
  portfolioAggregates,
  positionPnlDollar,
  brokerLiveSummary,
  effectiveBrokerCash,
  money,
  moneySigned,
  percent,
} from '../../lib/journal-2-0'
import {
  buildStrategyLabel,
  computeDaysToExpiration,
  classifyDebitCredit,
} from '../../pages/journal-2-0/lib/optionCalcs'
import compassLogo from '../intro/assets/compass-mark.png'
import UIcon from '../ui/UIcon'
import Sparkline, { sparkPaths } from '../Sparkline'
import styles from './JournalSnapshotTile.module.css'

const JOURNAL_LINK = '/journal?j2tab=positions'
const MAX_ROWS = 6
const BROKER_PERIOD = '3M'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const SWR_OPTS = {
  refreshInterval: 15_000,
  revalidateOnFocus: false,
  shouldRetryOnError: false,
}

/**
 * Today's $ change for an equity position, derived from the live snapshot.
 * prevClose = price / (1 + change_pct/100); today = (price - prevClose) × shares,
 * sign-flipped for shorts. Returns null when the live snapshot is incomplete.
 */
export function positionTodayDollar(p, live) {
  if (!live || live.price == null || live.change_pct == null) return null
  const price = Number(live.price)
  const pct = Number(live.change_pct)
  if (!Number.isFinite(price) || !Number.isFinite(pct)) return null
  const prevClose = price / (1 + pct / 100)
  if (!Number.isFinite(prevClose)) return null
  const sgn = p.side === 'Short' ? -1 : 1
  return (price - prevClose) * p.shares * sgn
}

/**
 * Build a static sparkline path (viewBox 0..100) from a broker equity series.
 * Back-compat wrapper over the shared Sparkline's pure sparkPaths builder.
 */
export function buildSpark(series) {
  return sparkPaths((series || []).map((p) => p?.value))
}

const sign = (n) => (n > 0 ? styles.pos : n < 0 ? styles.neg : '')

export default function JournalSnapshotTile() {
  const { data: posData, isLoading: posLoading } = useSWR(
    '/api/j2/positions', fetcher, SWR_OPTS,
  )
  const { data: optData, isLoading: optLoading } = useSWR(
    '/api/j2/options?status=open', fetcher, SWR_OPTS,
  )
  const { data: acctData } = useSWR('/api/j2/accounts', fetcher, SWR_OPTS)
  // Live-ish option marks (Massive option aggs) — between-syncs freshness for
  // the headline + option rows. Portfolio-wide (no account scoping here).
  const { data: marksData } = useSWR(
    (optData?.strategies?.length ?? 0) > 0 ? '/api/j2/broker/option-marks' : null,
    fetcher, SWR_OPTS,
  )
  const optionMarks = marksData?.marks ?? null

  const positions = posData?.positions ?? []
  const strategies = optData?.strategies ?? []
  const accounts = acctData?.accounts ?? []

  // Broker portfolio performance (real net-liq + equity curve), aggregated
  // across all connected brokers. Empty/ignored for manual-only users.
  const { data: perf } = useJ2BrokerPerformance(null, BROKER_PERIOD, { portfolio: true })
  const brokerAccounts = accounts.filter(
    (a) => a.balanceSource === 'broker' && a.brokerTotalEquity != null,
  )
  const hasBroker = brokerAccounts.length > 0 || (perf?.brokerCount ?? 0) > 0

  // Broker status only matters for the empty state — fetch it only when the
  // book is empty so users with positions don't pay an extra request.
  const noOpenYet = positions.length === 0 && strategies.length === 0
  const { data: brokerData } = useSWR(
    noOpenYet ? '/api/j2/broker/status' : null, fetcher, SWR_OPTS,
  )
  const brokerConnected = !!brokerData?.connected || hasBroker

  const symbols = useMemo(() => positions.map((p) => p.symbol), [positions])
  const { prices, isStreaming } = useRealtimePrices(symbols)

  const priceMap = useMemo(
    () => Object.fromEntries(
      Object.entries(prices).map(([sym, v]) => [sym, v?.price]),
    ),
    [prices],
  )
  const agg = useMemo(
    () => portfolioAggregates(positions, priceMap, 0),
    [positions, priceMap],
  )

  // Fallback base (perf endEquity, else Σ broker total equity, else null so a
  // fresh broker renders the "—" placeholder rather than $0.00). The `|| null`
  // coercion matters: an empty reduce() yields 0, which would render $0.00.
  const brokerBase = perf?.endEquity
    ?? (brokerAccounts.reduce((s, a) => s + (a.brokerTotalEquity || 0), 0) || null)
  // Live net-liq the Robinhood way: portfolio cash + live market value of
  // holdings. Matches the broker's real number and reflects today's move
  // (the broker-reported total equity is stale for some brokers). Both this
  // tile and the Open Positions hero compute it identically from the shared
  // price feed, so they agree. Cash null (fresh broker) ⇒ netLiq null ⇒
  // headline falls back to brokerBase.
  const etToday = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    [],
  )
  // Per-account effective cash (fill-derived brokerCashLive when present) —
  // pairing LIVE position values with sync-stale cash double-counts every
  // intraday buy (the 2026-08-26 hero incident); the tile shares the fix.
  const brokerCashTotal = useMemo(() => {
    const withCash = brokerAccounts
      .map((a) => effectiveBrokerCash(a))
      .filter((c) => Number.isFinite(c))
    return withCash.length ? withCash.reduce((s, c) => s + c, 0) : null
  }, [brokerAccounts])
  const brokerLive = useMemo(
    () => brokerLiveSummary({ brokerCash: brokerCashTotal }, positions, strategies, prices, etToday, optionMarks),
    [brokerCashTotal, positions, strategies, prices, etToday, optionMarks],
  )
  const manualToday = useMemo(() => {
    let s = 0
    let any = false
    for (const p of positions) {
      const t = positionTodayDollar(p, prices[p.symbol])
      if (t == null) continue
      s += t
      any = true
    }
    return any ? s : null
  }, [positions, prices])

  // Equity rows, richest mover first.
  const equityRows = useMemo(() => {
    return positions
      .map((p) => {
        const live = prices[p.symbol]
        // Live tick price when available; else the broker's last-synced mark
        // (broker accounts only) so rows show a real price + P&L after hours.
        const price = live?.price ?? (Number.isFinite(p.brokerPrice) ? p.brokerPrice : null)
        const today = positionTodayDollar(p, live)
        const todayPct = live?.change_pct == null
          ? null
          : (p.side === 'Short' ? -1 : 1) * Number(live.change_pct)
        const open = price == null ? null : positionPnlDollar(p, price)
        return { kind: 'equity', key: `e-${p.id}`, p, price, today, todayPct, open }
      })
      .sort((a, b) => (Math.abs(b.today ?? -1) - Math.abs(a.today ?? -1)))
  }, [positions, prices])

  // Option rows, soonest expiry first.
  const optionRows = useMemo(() => {
    return strategies
      .map((s) => {
        const dte = computeDaysToExpiration(s.legs)
        // Serializer emits camelCase `brokerCurrentValue` (was read as snake
        // `broker_current_value` → always null → option value never showed).
        // Live mark preferred; sync-time broker mark is the fallback.
        const liveCur = optionMarks?.[s.id]?.currentValue
        const brokerVal = Number.isFinite(liveCur)
          ? liveCur
          : (Number.isFinite(s.brokerCurrentValue) ? s.brokerCurrentValue : null)
        return {
          kind: 'option',
          key: `o-${s.id}`,
          s,
          label: buildStrategyLabel(s),
          dte,
          isCredit: classifyDebitCredit(s.netEntry) === 'credit',
          brokerVal,
        }
      })
      .sort((a, b) => (a.dte ?? 1e9) - (b.dte ?? 1e9))
  }, [strategies, optionMarks])

  const allRows = [...equityRows, ...optionRows]
  const visibleRows = allRows.slice(0, MAX_ROWS)
  const moreCount = allRows.length - visibleRows.length

  const totalCount = positions.length + strategies.length
  const isLoading = (posLoading || optLoading) && totalCount === 0

  return (
    <TileCard
      title="Journal · Positions"
      icon="journal"
      className={styles.tileFit}
      badge={totalCount > 0 ? <span className={styles.openCue}>Open →</span> : null}
    >
      <div className={styles.body}>
        {isLoading ? (
          <div className={styles.loading}>Loading positions…</div>
        ) : totalCount === 0 ? (
          <EmptyState connected={brokerConnected} />
        ) : (
          <Link to={JOURNAL_LINK} className={styles.bodyLink} aria-label="Open your trading journal">
            {hasBroker
              ? <BrokerHero perf={perf} positions={positions} strategies={strategies} brokerBase={brokerBase} brokerLive={brokerLive} isLive={isStreaming && brokerLive?.netLiq != null} />
              : <ManualHero agg={agg} today={manualToday} positions={positions} strategies={strategies} />}

            <div className={styles.rows}>
              {visibleRows.map((row) =>
                row.kind === 'equity'
                  ? <EquityRow key={row.key} row={row} />
                  : <OptionRow key={row.key} row={row} />,
              )}
            </div>

            <div className={styles.footer}>
              {moreCount > 0
                ? <span className={styles.more}>+ {moreCount} more</span>
                : <span />}
              <span className={styles.openJournal}>Open Journal →</span>
            </div>
          </Link>
        )}
      </div>
    </TileCard>
  )
}

function CountLine({ positions, strategies, suffix }) {
  return (
    <div className={styles.countLine}>
      {positions.length} {positions.length === 1 ? 'position' : 'positions'}
      {strategies.length > 0 && (
        <> · {strategies.length} {strategies.length === 1 ? 'option' : 'options'}</>
      )}
      {suffix}
    </div>
  )
}

/** Broker hero — real net-liq balance + Today/period P&L + equity sparkline. */
function BrokerHero({ perf, positions, strategies, brokerBase, brokerLive, isLive }) {
  const series = perf?.equitySeries || []
  const value = brokerLive?.netLiq ?? brokerBase

  // Today = live Σ position move vs previous close (Robinhood-accurate); falls
  // back to the daily-snapshot delta when there's no live net-liq.
  let todayChange = null
  let todayPct = null
  if (brokerLive?.netLiq != null) {
    todayChange = brokerLive.today
    todayPct = brokerLive.todayPct
  } else {
    const real = series.filter((p) => !p.estimated)
    if (real.length >= 2) {
      const prev = real[real.length - 2].value
      todayChange = real[real.length - 1].value - prev
      todayPct = prev ? todayChange / Math.abs(prev) : null
    }
  }
  const periodPnl = perf?.dollarPnl
  const periodPct = perf?.timeWeighted

  return (
    <div className={styles.hero}>
      <div className={styles.heroValue}>
        {money(value)}
        {isLive && <span className={styles.liveBadge}> LIVE</span>}
      </div>
      <div className={styles.perfRow}>
        {todayChange != null && <PerfFigure label="Today" dollar={todayChange} pct={todayPct} />}
        {periodPnl != null && <PerfFigure label={BROKER_PERIOD} dollar={periodPnl} pct={periodPct} />}
      </div>
      <Sparkline
        className={styles.spark}
        values={series.map((p) => p?.value)}
      />
      <CountLine positions={positions} strategies={strategies} suffix={<> · synced</>} />
    </div>
  )
}

/** Manual hero — live mark-to-market of open equity positions. */
function ManualHero({ agg, today, positions, strategies }) {
  const prevValue = today == null ? null : agg.value - today
  const todayPct = prevValue ? today / prevValue : null
  const costBasis = agg.value - agg.unrealized
  const openPct = costBasis ? agg.unrealized / costBasis : null
  return (
    <div className={styles.hero}>
      <div className={styles.heroValue}>{money(agg.value)}</div>
      <div className={styles.perfRow}>
        <PerfFigure label="Today" dollar={today} pct={todayPct} />
        <PerfFigure label="Open P&L" dollar={agg.unrealized} pct={openPct} />
      </div>
      <CountLine positions={positions} strategies={strategies} />
    </div>
  )
}

function PerfFigure({ label, dollar, pct }) {
  return (
    <div className={styles.perf}>
      <span className={styles.perfLabel}>{label}</span>
      <span className={`${styles.perfValue} ${sign(dollar ?? 0)}`}>
        {moneySigned(dollar)}
        {pct != null && (
          <span className={styles.perfPct}>
            {' '}({percent(pct, { dp: 2, signed: true })})
          </span>
        )}
      </span>
    </div>
  )
}

function EquityRow({ row }) {
  const { p, price, today, todayPct, open } = row
  return (
    <div className={styles.row}>
      <div className={styles.rowLeft}>
        <span className={styles.sym}>{p.symbol}</span>
        <span className={`${styles.sideChip} ${p.side === 'Short' ? styles.sideShort : styles.sideLong}`}>
          {p.side === 'Short' ? 'S' : 'L'}
        </span>
        <span className={styles.rowMeta}>
          {p.shares} @ {price == null ? '—' : money(price)}
        </span>
      </div>
      <div className={styles.rowRight}>
        <span className={`${styles.rowToday} ${sign(today ?? 0)}`}>
          {moneySigned(today)}
          {todayPct != null && (
            <span className={styles.rowPct}> {percent(todayPct, { dp: 2, signed: true, isRatio: false })}</span>
          )}
        </span>
        <span className={`${styles.rowOpen} ${sign(open ?? 0)}`}>
          open {moneySigned(open)}
        </span>
      </div>
    </div>
  )
}

function OptionRow({ row }) {
  const { label, dte, isCredit, brokerVal } = row
  return (
    <div className={styles.row}>
      <div className={styles.rowLeft}>
        <span className={styles.optLabel}>{label}</span>
        <span className={styles.rowMeta}>
          {isCredit ? 'Credit' : 'Debit'}
          {dte != null && <> · {dte}d</>}
        </span>
      </div>
      <div className={styles.rowRight}>
        {brokerVal == null
          ? <span className={styles.rowMutedDash}>—</span>
          : <span className={styles.rowToday}>{money(brokerVal)}</span>}
      </div>
    </div>
  )
}

function EmptyState({ connected }) {
  // Broker connected but flat → simple synced message (their real account is
  // just empty right now).
  if (connected) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon} aria-hidden="true"><UIcon name="compass" size={32} /></div>
        <div className={styles.emptyTitle}>You&rsquo;re all synced</div>
        <div className={styles.emptySub}>
          No open positions right now. New trades import automatically and
          show up here.
        </div>
        <Link to={JOURNAL_LINK} className={styles.emptyPrimary}>
          Open the journal →
        </Link>
      </div>
    )
  }
  // Not connected → a UCT-Intelligence-branded call-to-action.
  return <ConnectCta />
}

/* ── Brand mark + custom UCT Intelligence iconography (no emoji) ─────────── */

/** The brand signature: the UCT Intelligence compass + candlestick logo. */
function CompassMark() {
  return (
    <span className={styles.markHalo}>
      <img src={compassLogo} className={styles.markImg} alt="" aria-hidden="true" />
    </span>
  )
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * One hidden defs block — a gold gradient with a bright band that slowly sweeps
 * across (the brand's gold-shimmer language), shared by every benefit glyph so
 * they shimmer in unison. Static for reduced-motion.
 */
function IconDefs() {
  const reduce = prefersReducedMotion()
  return (
    <svg width="0" height="0" className={styles.iconDefs} aria-hidden="true">
      <defs>
        <linearGradient id="ctaIcoGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9c7a2e" />
          <stop offset="42%" stopColor="#d6b85e" />
          <stop offset="52%" stopColor="#fbe7b0" />
          <stop offset="62%" stopColor="#d6b85e" />
          <stop offset="100%" stopColor="#9c7a2e" />
          {!reduce && (
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              from="-1 0"
              to="1 0"
              dur="3.4s"
              repeatCount="indefinite"
            />
          )}
        </linearGradient>
      </defs>
    </svg>
  )
}

const G = 'url(#ctaIcoGold)'

const IconSync = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke={G} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 9a8 8 0 0 1 13.4-3.4L20 8" />
    <path d="M20 3.5V8h-4.5" />
    <path d="M20 15a8 8 0 0 1-13.4 3.4L4 16" />
    <path d="M4 20.5V16h4.5" />
  </svg>
)

const IconEquity = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke={G} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 20.5h17" />
    <path d="M5 15l4-4 3.5 2.5L20 6" />
    <path d="M16 6h4v4" />
  </svg>
)

const IconCompass = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke={G} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M15.6 8.4l-2 5.2-5.2 2 2-5.2z" />
  </svg>
)

const IconLink = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.5 14.5l5-5" />
    <path d="M11.5 6.5l1-1a3.8 3.8 0 0 1 5.4 5.4l-1 1" />
    <path d="M12.5 17.5l-1 1a3.8 3.8 0 0 1-5.4-5.4l1-1" />
  </svg>
)

/**
 * UCT Intelligence connect CTA for users who haven't linked a broker yet.
 * Brand-forward sell point — compass mark + benefit rows + Connect button.
 * No fake portfolio data.
 */
function ConnectCta() {
  const points = [
    { Icon: IconSync, text: 'Auto-imports every trade and open position' },
    { Icon: IconEquity, text: 'Live balance, P&L, and equity curve' },
    { Icon: IconCompass, text: 'Compass AI coaches your real trades' },
  ]
  return (
    <div className={styles.cta}>
      <IconDefs />
      <div className={styles.ctaMark}><CompassMark /></div>
      <div className={styles.ctaEyebrow}>UCT Intelligence</div>
      <div className={styles.ctaTitle}>See your whole portfolio, live</div>
      <div className={styles.ctaSub}>
        Connect your brokerage and UCT Intelligence imports every trade,
        position, and balance — then Compass coaches you on your real performance.
      </div>
      <ul className={styles.ctaPoints}>
        {points.map(({ Icon, text }) => (
          <li key={text}>
            <span className={styles.ctaTick}><Icon /></span>
            {text}
          </li>
        ))}
      </ul>
      <Link to="/settings?section=connections" className={styles.ctaButton}>
        <span className={styles.ctaButtonIcon}><IconLink /></span>
        Connect your brokerage
      </Link>
      <div className={styles.ctaFoot}>
        Read-only and secure · <Link to={JOURNAL_LINK} className={styles.ctaInline}>or log trades manually</Link>
      </div>
      <div className={styles.ctaTagline}>Navigate the market, effectively.</div>
    </div>
  )
}

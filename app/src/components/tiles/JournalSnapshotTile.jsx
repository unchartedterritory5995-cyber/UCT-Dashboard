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
import { useMarkPreferenceContext } from '../../hooks/useBrokerMarkPreference'
import useJ2BrokerPerformance from '../../pages/journal-2-0/hooks/useJ2BrokerPerformance'
import {
  portfolioAggregates,
  positionPnlDollar,
  positionRiskDollar,
  activeStop,
  isBrokerPlaceholderStop,
  brokerLiveSummary,
  effectiveBrokerCash,
  preferBrokerMarks,
  money,
  moneySigned,
  percent,
} from '../../lib/journal-2-0'
// ⭐ The account's own risk settings — the ONLY place 1R is defined. Reused, not
// re-derived: `useJ2Settings` is context-free (localStorage + SWR) and its
// accounts fetch shares `/api/j2/accounts` with this tile, so it costs exactly
// one new request.
import useJ2Settings from '../../pages/journal-2-0/hooks/useJ2Settings'
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
/**
 * ⭐ REVERSIBLE BY DESIGN. The 3M equity curve was the first number the paid
 * home showed every morning (−46.85% at time of writing) and is not a decision
 * input, so Zone C renders it OFF by default. Both switches are PROPS, not
 * deletions: `<JournalSnapshotTile showEquityCurve period="3M" />` restores the
 * pre-cockpit tile byte-for-byte, and `JournalSnapshotTile.props.test.jsx`
 * asserts that rather than leaving it a claim.
 *
 * ⛔ THE DEFAULT PERIOD IS '1W', NOT '1D'. The task brief said `period = '1D'`;
 * `_period_start` in api/services/journal_two/broker/performance_service.py
 * knows only ALL / YTD / 1W / 1M / 3M / 1Y and returns `None` — i.e. ALL TIME —
 * for anything else. So `'1D'` would have silently rendered the all-time P&L
 * under a "1D" label: a wrong number with a confident caption, which is worse
 * than the 3M figure it replaced. '1W' is the shortest window the endpoint
 * actually knows. (The headline net-liq is unaffected either way — the service
 * appends a live right-edge to the series regardless of the window.)
 */
const DEFAULT_BROKER_PERIOD = '1W'

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

/**
 * The stop a position is ACTUALLY protected by, or `null` when it has none.
 * ⭐ ONE predicate, read by both the row and the aggregate — they disagreeing
 * about a single position is precisely the defect this exists to prevent.
 *
 * Three ways a stored `stopPrice` is not a stop:
 *   1. The BROKER PLACEHOLDER (`stop === entry` on a broker row) — the shared
 *      `isBrokerPlaceholderStop`, never a local copy.
 *   2. NOT FINITE — null/undefined/NaN.
 *   3. 🔴 ZERO OR NEGATIVE. `api/services/journal_two/positions.py` stores
 *      `stop_price = 0.0` when `stopPrice` is omitted at create (it is
 *      optional), and that is a MANUAL row, so the broker predicate never
 *      fires on it. Left through, a $0 stop rendered as real protection and
 *      booked the entire notional as risk: 100 shares at $100 read
 *      "stop $0.00" and "Open risk $10,000.00 / 10.00R".
 *      `api/services/portfolio_heat.py` has had `if stop <= 0: return True`
 *      all along — the server and the client were the two authorities, and
 *      only one of them knew.
 *
 * ⚠️ Deliberately NOT pushed down into `lib/journal-2-0/calculations.js`:
 * `isBrokerPlaceholderStop` has other consumers whose behaviour would change,
 * and unifying the client and server predicates at the root is a separate,
 * scoped piece of work.
 * @param {{stopPrice?: number, entryPrice?: number, source?: string}} p
 */
export function realStop(p) {
  if (isBrokerPlaceholderStop(p)) return null
  const s = activeStop(p)
  if (!Number.isFinite(s) || s <= 0) return null
  return s
}

export default function JournalSnapshotTile({ showEquityCurve = false, period = DEFAULT_BROKER_PERIOD }) {
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
  const { data: perf } = useJ2BrokerPerformance(null, period, { portfolio: true })
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
  // ALL-or-nothing across accounts: this tile sums every broker account into
  // one figure, and accounts sync on their own schedules. Mixing one broker's
  // marks with another's live prices inside a single total is a number from
  // neither vintage, so the preference must hold for every account or none.
  const { sessionClosed, lastClosedSessionET } = useMarkPreferenceContext()
  const preferBroker = useMemo(
    () => brokerAccounts.length > 0
      && brokerAccounts.every((a) => preferBrokerMarks(a, sessionClosed, lastClosedSessionET)),
    [brokerAccounts, sessionClosed, lastClosedSessionET],
  )
  const brokerLive = useMemo(
    () => brokerLiveSummary({ brokerCash: brokerCashTotal }, positions, strategies, prices,
                            etToday, optionMarks, preferBroker),
    [brokerCashTotal, positions, strategies, prices, etToday, optionMarks, preferBroker],
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

  // ── ZONE C · OPEN RISK ────────────────────────────────────────────────────
  //
  // 🔴 THE SINGLE MOST-QUOTED NEED FROM THE TRADER ANALYSIS was "where are my
  // stops". The spec's Zone C is "today's P&L, open positions WITH THEIR STOPS,
  // and open risk in dollars and R" — the rows below now carry the stop, and
  // this is the aggregate.
  //
  // ⛔ NOT `agg.risk`, and the reason is load-bearing: `portfolioAggregates`
  // skips any position with no live price (`if (current == null) continue`).
  // Risk does not depend on the current price at all, so after hours — or for
  // any symbol the live feed doesn't carry — that would silently UNDER-REPORT
  // open risk, which is the one direction a risk number must never fail in.
  // The per-position math and the placeholder predicate are still the shared
  // authority (`positionRiskDollar` + `isBrokerPlaceholderStop`); only the
  // summation loop is here.
  //
  // ⛔ SAFETY-CRITICAL — BROKER PLACEHOLDER STOPS. Broker imports store
  // `stop_price = entry_price` because the column is NOT NULL and the broker
  // reports no stop. Counting that as a real stop reads as ZERO risk, which
  // under-reports heat and would green-light an over-cap add; the same rule is
  // enforced server-side in `api/services/portfolio_heat.py`. Such positions are
  // EXCLUDED from the dollar figure and COUNTED separately, never silently
  // dropped — "3 with no stop" is the sentence a trader needs.
  const { settings } = useJ2Settings()
  const openRisk = useMemo(() => {
    let dollars = 0
    let withStop = 0
    let noStop = 0
    for (const p of positions) {
      if (realStop(p) == null) { noStop += 1; continue }
      // ⛔ A RISK-FREE STOP IS NOT A MISSING STOP. `positionRiskDollar` is
      // clampNonNegative, so a stop at or above entry (a raised breakeven, the
      // thing a disciplined trader DOES) yields 0 — and the first cut folded
      // that 0 into the no-stop warning count, so the row said "stop $100.00"
      // while the aggregate said "1 with no stop" about the same position.
      // Two answers, one fact. It counts as STOPPED and contributes $0.
      const r = positionRiskDollar(p)
      dollars += Number.isFinite(r) && r > 0 ? r : 0
      withStop += 1
    }
    return { dollars, withStop, noStop }
  }, [positions])

  // 1R = the book's per-trade risk budget. Every input must be real or R is NOT
  // derivable — and an undefined R is reported as such rather than rendered as
  // a confident 0.00R.
  //
  // 🔴 THE DENOMINATOR AND THE NUMERATOR MUST COVER THE SAME BOOK.
  // `/api/j2/positions` is fetched with NO account_id, and the router returns
  // EVERY account's positions when it is omitted — while `useJ2Settings`
  // resolves to the SELECTED account. So for a multi-account member the first
  // cut divided whole-book dollars by one account's 1R, which can err in either
  // direction and can UNDER-report.
  //
  // ⛔ NEITHER OF THE TWO OBVIOUS FIXES IS SAFE HERE, so R is gated instead —
  // see the report. Scoping the positions fetch to one account would change
  // what the whole tile SHOWS (headline net-liq included) and put it at odds
  // with `useJ2BrokerPerformance(..., { portfolio: true })` two lines up;
  // summing `accountSize` across accounts needs per-account settings and there
  // is no bulk endpoint, so it costs one request per account. With more than
  // one account the budget is genuinely unknown, and saying so is the only
  // answer that is not a guess.
  const oneR = useMemo(() => {
    if (accounts.length > 1) return null
    const acct = Number(settings?.accountSize)
    const pct = Number(settings?.maxRiskPerTradePct)
    if (!Number.isFinite(acct) || acct <= 0) return null
    if (!Number.isFinite(pct) || pct <= 0) return null
    return (acct * pct) / 100
  }, [settings, accounts.length])
  const openRiskR = oneR ? openRisk.dollars / oneR : null
  const rBlockedByAccounts = accounts.length > 1

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
        // ⭐ THE SAME PREDICATE THE AGGREGATE USES. The row and the total
        // disagreeing about one position is the defect this replaced.
        const stop = realStop(p)
        const risk = stop == null ? null : positionRiskDollar(p)
        return { kind: 'equity', key: `e-${p.id}`, p, price, today, todayPct, open, stop, risk }
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
              ? <BrokerHero perf={perf} positions={positions} strategies={strategies} brokerBase={brokerBase} brokerLive={brokerLive} isLive={isStreaming && brokerLive?.netLiq != null} showEquityCurve={showEquityCurve} period={period} openRisk={openRisk} openRiskR={openRiskR} rBlockedByAccounts={rBlockedByAccounts} />
              : <ManualHero agg={agg} today={manualToday} positions={positions} strategies={strategies} openRisk={openRisk} openRiskR={openRiskR} rBlockedByAccounts={rBlockedByAccounts} />}

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

/**
 * Zone C's risk line: open risk in DOLLARS and in R, plus an explicit count of
 * positions carrying no real stop.
 *
 * ⛔ "R n/a" IS A REPORTED FACT, NOT A BLANK. R needs the account's own budget
 * (accountSize × maxRiskPerTradePct); a member who has never set those has no
 * 1R, and inventing one — or quietly printing dollars only — would be a number
 * with no basis on the page whose whole job is risk. It says which setting is
 * missing and links to where it is set.
 *
 * ⛔ THE NO-STOP COUNT IS NEVER HIDDEN. A broker import stores
 * `stop_price = entry_price` as a placeholder; those positions are excluded
 * from the dollar figure precisely because counting them as 0 risk under-reports
 * heat — so the exclusion has to be VISIBLE or the total reads as complete when
 * it is not.
 */
function OpenRiskLine({ openRisk, openRiskR, rBlockedByAccounts }) {
  if (!openRisk || (openRisk.withStop === 0 && openRisk.noStop === 0)) return null
  return (
    <div className={styles.riskLine}>
      <span className={styles.riskLabel}>Open risk</span>
      {openRisk.withStop > 0 ? (
        <>
          <span className={styles.riskValue}>{money(openRisk.dollars)}</span>
          {openRiskR != null ? (
            <span className={styles.riskR}>{openRiskR.toFixed(2)}R</span>
          ) : (
            // ⛔ A <span>, NOT A <Link>. This whole hero already sits inside a
            // tile-wide <Link>, and React logs "<a> cannot be a descendant of
            // <a>" for a nested one. The first cut linked to
            // "/journal?j2tab=positions" — byte-identical to JOURNAL_LINK
            // above, i.e. the tile's own target — so the nesting and the
            // stopPropagation bought nothing at all, and the copy promised
            // "set account size" while landing on the Positions tab.
            <span
              className={styles.riskHint}
              title={rBlockedByAccounts
                ? 'Open risk spans every account; 1R is per-account, so it cannot be summed here'
                : 'R needs your account size and max risk per trade, in Portfolio settings'}
            >
              {rBlockedByAccounts
                ? 'R n/a across accounts'
                : 'R n/a — set account size & risk %'}
            </span>
          )}
        </>
      ) : (
        <span className={styles.riskHint}>no stops set</span>
      )}
      {openRisk.noStop > 0 && (
        <span className={styles.riskNoStop}>
          {/* ⛔ gold={false}. UIcon's `gold` prop DEFAULTS TO TRUE and overrides
              `stroke` with the metallic gradient, so this warning rendered as a
              decorative gold mark beside --warning-coloured text. A known trap
              in this repo, and this is one of the two most safety-relevant
              signals on the page. */}
          <UIcon name="warning" size={11} gold={false} style={{ verticalAlign: '-1px', marginRight: 3 }} />
          {openRisk.noStop} with no stop
        </span>
      )}
    </div>
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
function BrokerHero({ perf, positions, strategies, brokerBase, brokerLive, isLive, showEquityCurve, period, openRisk, openRiskR, rBlockedByAccounts }) {
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
        {periodPnl != null && <PerfFigure label={period} dollar={periodPnl} pct={periodPct} />}
      </div>
      {showEquityCurve && (
        <Sparkline
          className={styles.spark}
          values={series.map((p) => p?.value)}
        />
      )}
      <OpenRiskLine openRisk={openRisk} openRiskR={openRiskR} rBlockedByAccounts={rBlockedByAccounts} />
      <CountLine positions={positions} strategies={strategies} suffix={<> · synced</>} />
    </div>
  )
}

/** Manual hero — live mark-to-market of open equity positions. */
function ManualHero({ agg, today, positions, strategies, openRisk, openRiskR, rBlockedByAccounts }) {
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
      <OpenRiskLine openRisk={openRisk} openRiskR={openRiskR} rBlockedByAccounts={rBlockedByAccounts} />
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
  const { p, price, today, todayPct, open, stop } = row
  return (
    <div className={styles.row}>
      <div className={styles.rowLeft}>
        <span className={styles.sym}>{p.symbol}</span>
        <span className={`${styles.sideChip} ${p.side === 'Short' ? styles.sideShort : styles.sideLong}`}>
          {p.side === 'Short' ? 'S' : 'L'}
        </span>
        <span className={styles.rowMeta}>
          {p.shares} @ {price == null ? '—' : money(price)}
          {/* 🔴 "Where are my stops" — the single most-quoted need from the
              trader analysis. A broker placeholder (stop == entry) is NOT a
              stop and must never render as one; it reads "no stop". */}
          {stop == null
            ? <span className={styles.noStop}> · no stop</span>
            : <span className={styles.stop}> · stop {money(stop)}</span>}
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

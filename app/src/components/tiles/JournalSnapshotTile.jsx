/**
 * JournalSnapshotTile — Robinhood-style portfolio snapshot on the Dashboard.
 *
 * Replaces the old Compass · Today tile. Shows the user's Journal 2.0 open
 * book at a glance:
 *   - Hero: live portfolio value of open EQUITY positions (mark-to-market)
 *   - Today's $ / % change + Open P&L ($ / % vs cost basis)
 *   - A short list of open positions (equity live + options) with performance
 *   - Whole tile click-throughs into /journal?j2tab=positions
 *
 * Zero new backend — reuses the J2 positions/options endpoints, the shared
 * live-price store, and the journal-2-0 calc/format helpers. The two fetches
 * are intentionally UNSCOPED (all accounts) so the dashboard always shows the
 * whole book regardless of the Journal's selected account.
 *
 * Honesty rules (see spec 2026-06-18):
 *   - Equity drives the hero (true mark-to-market via live prices).
 *   - Options have no live option quotes in-app; broker-imported strategies may
 *     carry `broker_current_value` (shown), manual strategies show cost basis
 *     with a greyed P&L. A missing mark never fabricates a value.
 *   - A symbol missing a live price is skipped from sums and shown as "—".
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import TileCard from '../TileCard'
import useLivePrices from '../../hooks/useLivePrices'
import {
  portfolioAggregates,
  positionPnlDollar,
  money,
  moneySigned,
  percent,
} from '../../lib/journal-2-0'
import {
  buildStrategyLabel,
  computeDaysToExpiration,
  classifyDebitCredit,
} from '../../pages/journal-2-0/lib/optionCalcs'
import styles from './JournalSnapshotTile.module.css'

const JOURNAL_LINK = '/journal?j2tab=positions'
const MAX_ROWS = 6

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
  const sign = p.side === 'Short' ? -1 : 1
  return (price - prevClose) * p.shares * sign
}

const sign = (n) => (n > 0 ? styles.pos : n < 0 ? styles.neg : '')

export default function JournalSnapshotTile() {
  const { data: posData, isLoading: posLoading } = useSWR(
    '/api/j2/positions', fetcher, SWR_OPTS,
  )
  const { data: optData, isLoading: optLoading } = useSWR(
    '/api/j2/options?status=open', fetcher, SWR_OPTS,
  )

  const positions = posData?.positions ?? []
  const strategies = optData?.strategies ?? []

  // Broker status only matters for the empty state — fetch it only when the
  // book is empty so users with positions don't pay an extra request.
  const noOpenYet = positions.length === 0 && strategies.length === 0
  const { data: brokerData } = useSWR(
    noOpenYet ? '/api/j2/broker/status' : null, fetcher, SWR_OPTS,
  )
  const brokerConnected = !!brokerData?.connected

  const symbols = useMemo(() => positions.map((p) => p.symbol), [positions])
  const { prices } = useLivePrices(symbols)

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

  // Σ today's $ across positions that have a complete live snapshot.
  const todayDollar = useMemo(() => {
    let sum = 0
    let any = false
    for (const p of positions) {
      const t = positionTodayDollar(p, prices[p.symbol])
      if (t == null) continue
      sum += t
      any = true
    }
    return any ? sum : null
  }, [positions, prices])

  // Equity rows, richest mover first.
  const equityRows = useMemo(() => {
    return positions
      .map((p) => {
        const live = prices[p.symbol]
        const price = live?.price ?? null
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
        const brokerVal = Number.isFinite(s.broker_current_value)
          ? s.broker_current_value
          : null
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
  }, [strategies])

  const allRows = [...equityRows, ...optionRows]
  const visibleRows = allRows.slice(0, MAX_ROWS)
  const moreCount = allRows.length - visibleRows.length

  const totalCount = positions.length + strategies.length
  const isLoading = (posLoading || optLoading) && totalCount === 0

  // % bases: today vs prior-close value; open vs cost basis.
  const prevValue = todayDollar == null ? null : agg.value - todayDollar
  const todayPct = prevValue ? todayDollar / prevValue : null
  const costBasis = agg.value - agg.unrealized
  const openPct = costBasis ? agg.unrealized / costBasis : null

  return (
    <TileCard
      title="📓 Journal · Positions"
      badge={totalCount > 0 ? <span className={styles.openCue}>Open →</span> : null}
    >
      <div className={styles.body}>
        {isLoading ? (
          <div className={styles.loading}>Loading positions…</div>
        ) : totalCount === 0 ? (
          <EmptyState connected={brokerConnected} />
        ) : (
          <Link to={JOURNAL_LINK} className={styles.bodyLink} aria-label="Open your trading journal">
              {/* Hero — portfolio value + performance */}
              <div className={styles.hero}>
                <div className={styles.heroValue}>{money(agg.value)}</div>
                <div className={styles.perfRow}>
                  <PerfFigure
                    label="Today"
                    dollar={todayDollar}
                    pct={todayPct}
                  />
                  <PerfFigure
                    label="Open P&L"
                    dollar={agg.unrealized}
                    pct={openPct}
                  />
                </div>
                <div className={styles.countLine}>
                  {positions.length} {positions.length === 1 ? 'position' : 'positions'}
                  {strategies.length > 0 && (
                    <> · {strategies.length} {strategies.length === 1 ? 'option' : 'options'}</>
                  )}
                </div>
              </div>

              {/* Holdings */}
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

function EmptyState({ connected }) {
  if (connected) {
    // Broker linked but flat — don't tell them to connect again.
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon} aria-hidden="true">🧭</div>
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
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon} aria-hidden="true">📈</div>
      <div className={styles.emptyTitle}>See your whole portfolio here</div>
      <div className={styles.emptySub}>
        Connect your brokerage to auto-import every trade, position &amp;
        balance — or log trades yourself.
      </div>
      <div className={styles.emptyCtas}>
        <Link to="/settings" className={styles.emptyPrimary}>
          🔗 Connect a brokerage
        </Link>
        <Link to={JOURNAL_LINK} className={styles.emptySecondary}>
          Add manually →
        </Link>
      </div>
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

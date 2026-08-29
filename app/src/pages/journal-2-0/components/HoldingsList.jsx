/**
 * Robinhood-style holdings list (Phase 2 of the RH Journal initiative).
 * Minimal rows — logo · ticker + share count · 30-day sparkline · colored
 * price pill + today % — grouped into Stocks & ETFs / Options sections with
 * an RH-style sort control. Display-only: Edit/Close/Delete live in the
 * dense Table view; Phase 3 wires row click-through to the detail page.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import CompanyLogo from '../../../components/CompanyLogo'
import Sparkline from '../../../components/Sparkline'
import UIcon from '../../../components/ui/UIcon'
import useHoldingsSparklines from '../hooks/useHoldingsSparklines'
import OptionsBoard from './OptionsBoard'
import { buildEquityRows, sortRows, SORT_OPTIONS } from '../lib/holdingsRows'
import { money, percent } from '../../../lib/journal-2-0'
import styles from './HoldingsList.module.css'

const SORT_STORAGE_KEY = 'uct.j2.holdings.sort'
const DEFAULT_SORT = { key: 'marketValue', dir: 'desc' }

// Compact designed empty state — matches the J2 "No trades yet" pattern
// (TradeJournalTab) but tuned smaller since it renders inside the positions area.
const EMPTY_WRAP = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: '32px 20px',
  textAlign: 'center',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
}
const EMPTY_TITLE = { margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-bright)' }
const EMPTY_HINT = { margin: 0, maxWidth: 320, fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-muted)' }
const EMPTY_ACTION = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 4,
  padding: '7px 14px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--surface-2, #17171a)',
  color: 'var(--accent, #c9a84c)',
  fontSize: 12.5,
  fontWeight: 600,
  textDecoration: 'none',
}

function loadSort() {
  try {
    const raw = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY))
    if (raw && SORT_OPTIONS.some((o) => o.key === raw.key) && ['asc', 'desc'].includes(raw.dir)) {
      return raw
    }
  } catch { /* corrupt pref — fall through to default */ }
  return DEFAULT_SORT
}

export default function HoldingsList({ positions = [], optionStrategies = [], prices = {}, optionMarks = null, preferBrokerMarks = false }) {
  const [sort, setSort] = useState(loadSort)

  const todayIso = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    [],
  )
  const equityRows = useMemo(
    () => sortRows(buildEquityRows(positions, prices, todayIso, preferBrokerMarks), sort.key, sort.dir),
    [positions, prices, todayIso, sort, preferBrokerMarks],
  )
  const symbols = useMemo(() => positions.map((p) => p.symbol), [positions])
  const { closes } = useHoldingsSparklines(symbols)

  const hasOptions = (optionStrategies || []).length > 0
  if (!equityRows.length && !hasOptions) {
    return (
      <div className={styles.wrap}>
        <div style={EMPTY_WRAP} role="status" data-testid="holdings-empty">
          <UIcon name="equity" size={22} />
          <p style={EMPTY_TITLE}>No open positions</p>
          <p style={EMPTY_HINT}>
            Your open trades appear here. Log a position, or connect a broker to
            import your holdings automatically.
          </p>
          <Link to="/journal/accounts" style={EMPTY_ACTION}>
            <UIcon name="link" size={13} /> Connect a broker
          </Link>
        </div>
      </div>
    )
  }

  const saveSort = (next) => {
    setSort(next)
    try { localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  return (
    <div className={styles.wrap}>
      {equityRows.length > 0 && (
        <section aria-label="Stocks and ETFs">
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>Stocks &amp; ETFs</h3>
            <div className={styles.sortCtl}>
              <label className={styles.srOnly} htmlFor="holdings-sort">Sort holdings</label>
              <select
                id="holdings-sort"
                className={styles.sortSelect}
                value={sort.key}
                onChange={(e) => saveSort({ ...sort, key: e.target.value })}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
              <button
                type="button"
                className={styles.dirBtn}
                aria-label={`Sort direction: ${sort.dir === 'desc' ? 'descending' : 'ascending'}`}
                onClick={() => saveSort({ ...sort, dir: sort.dir === 'desc' ? 'asc' : 'desc' })}
              >
                <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                  {sort.dir === 'desc'
                    ? <path d="M2 4l4 5 4-5z" fill="currentColor" />
                    : <path d="M2 8l4-5 4 5z" fill="currentColor" />}
                </svg>
              </button>
            </div>
          </div>
          <ul className={styles.rows}>
            {equityRows.map((row) => (
              <EquityRow key={row.key} row={row} spark={closes[row.sparkKey]} />
            ))}
          </ul>
        </section>
      )}

      {hasOptions && <OptionsBoard strategies={optionStrategies} optionMarks={optionMarks} />}
    </div>
  )
}

/**
 * One-shot flash class when the live price ticks — brighter fill for ~600ms
 * in the direction of the move, then settles. No flash on first price.
 */
function useTickFlash(price) {
  const prevRef = useRef(price)
  const [flash, setFlash] = useState(null)   // 'up' | 'down' | null
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = price
    if (!Number.isFinite(prev) || !Number.isFinite(price) || prev === price) return undefined
    setFlash(price > prev ? 'up' : 'down')
    const t = setTimeout(() => setFlash(null), 650)
    return () => clearTimeout(t)
  }, [price])
  return flash
}

function EquityRow({ row, spark }) {
  const flash = useTickFlash(row.price)
  const pillTone = row.changePct == null
    ? styles.pillFlat
    : row.changePct >= 0 ? styles.pillUp : styles.pillDown
  const flashCls = flash === 'up' ? styles.flashUp : flash === 'down' ? styles.flashDown : ''
  return (
    <li>
      <Link
        className={`${styles.row} ${styles.rowLink}`}
        to={`/journal-2-0/position/${encodeURIComponent(row.symbol)}`}
        aria-label={`${row.symbol} position detail`}
      >
        <CompanyLogo sym={row.symbol} size={28} tile />
        <div className={styles.ident}>
          <span className={styles.sym} data-testid="holding-sym">{row.symbol}</span>
          <span className={styles.shares}>
            {row.side === 'Short' ? `Short ${row.shares}` : `${row.shares} shares`}
          </span>
        </div>
        <div className={styles.spark}>
          <Sparkline values={spark} width={96} height={30} />
        </div>
        <div className={styles.right}>
          <span className={`${styles.pill} ${pillTone} ${flashCls}`}>
            {row.price == null ? '—' : money(row.price)}
          </span>
          <span className={styles.today}>
            {row.changePct == null
              ? ' '
              : percent(row.changePct, { dp: 2, signed: true, isRatio: false })}
          </span>
        </div>
      </Link>
    </li>
  )
}


// app/src/pages/OpenFlow.jsx
//
// Packet L CP1 (signed 2026-09-22, fingerprint ddcad5b0c) -- the searchable
// "Open Flow" board. GET /api/live/massive/flow-board already computed this
// (same engine as the live Discord "Open Flow" card: every still-open
// directional name, not just a top-N split) -- it just had zero frontend
// callers anywhere in the app until this page. Modeled on FlowScoreboard.jsx's
// idiom (one useSWR call, TickerPopup on symbols, its own CSS module) so this
// never touches the partner-owned OptionsFlow.jsx.
//
// Deliberately NOT added to the NavBar yet -- reachable by direct URL only,
// same as /traders, /dark-pool, /post-market and /setup-library. The packet
// explicitly defers a permanent nav entry to the owner.
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import TickerPopup from '../components/TickerPopup'
import UIcon from '../components/ui/UIcon'
import styles from './OpenFlow.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const CAP_BANDS = [
  { value: 'all', label: 'All caps' },
  { value: 'mega', label: 'Mega cap' },
  { value: 'large', label: 'Large cap' },
  { value: 'mid_small', label: 'Mid/Small cap' },
]

function fmtMoney(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function fmtPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return `${Number(v).toFixed(0)}%`
}

function fmtPerf(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

function contractLine(r) {
  if (!r.strike || !r.cp) return '—'
  return `$${r.strike}${r.cp} ${r.exp || ''}`.trim()
}

export default function OpenFlow() {
  const [cap, setCap] = useState('all')
  const [days, setDays] = useState(60)
  const [query, setQuery] = useState('')

  const { data, isLoading } = useSWR(
    `/api/live/massive/flow-board?days=${days}&cap=${cap}&limit=300`,
    fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  )

  const rows = useMemo(() => {
    const all = data?.rows || []
    const q = query.trim().toUpperCase()
    return q ? all.filter((r) => r.sym.toUpperCase().includes(q)) : all
  }, [data, query])

  const ok = data?.ok !== false

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          <UIcon name="bolt" size={18} style={{ verticalAlign: '-3px', marginRight: 8 }} />
          Open Flow
        </h1>
        <p className={styles.sub}>
          Every name currently carrying open directional options positioning — not just the
          top movers. Same engine as the daily Open Flow card.
        </p>
      </div>

      <div className={styles.controls}>
        <input
          className={styles.search}
          type="text"
          placeholder="Search ticker…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className={styles.select} value={cap} onChange={(e) => setCap(e.target.value)}>
          {CAP_BANDS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <select className={styles.select} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
        </select>
        {data?.n_names != null && (
          <span className={styles.meta}>{data.n_names} names · {data.open_contracts} open contracts</span>
        )}
      </div>

      {isLoading && !data ? (
        <div className={styles.loading}>Loading the board…</div>
      ) : !ok ? (
        <div className={styles.empty} role="alert">
          Could not load the flow board right now — try again shortly.
        </div>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>No names match.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th className={styles.num}>Bull</th>
                <th className={styles.num}>Bear</th>
                <th className={styles.num}>Net</th>
                <th className={styles.num}>Bull %</th>
                <th>Top contract</th>
                <th>Since</th>
                <th className={styles.num}>Since-open perf</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sym}>
                  <td><TickerPopup sym={r.sym}><span className={styles.sym}>{r.sym}</span></TickerPopup></td>
                  <td className={styles.num}>{fmtMoney(r.bull)}</td>
                  <td className={styles.num}>{fmtMoney(r.bear)}</td>
                  <td className={`${styles.num} ${r.net >= 0 ? styles.up : styles.down}`}>{fmtMoney(r.net)}</td>
                  <td className={styles.num}>{fmtPct(r.bullPct * 100)}</td>
                  <td>{contractLine(r)}</td>
                  <td>{r.since || '—'}</td>
                  <td className={`${styles.num} ${(r.perf ?? 0) >= 0 ? styles.up : styles.down}`}>{fmtPerf(r.perf)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

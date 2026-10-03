import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import styles from './OptionsChainTab.module.css'
import PayoffPanel from './PayoffPanel'
import VolSurfacePanel from './VolSurfacePanel'
import IvHistoryPanel from './IvHistoryPanel'
import BacktestPanel from './BacktestPanel'
import PositioningPanel from '../../optionsAnalytics/PositioningPanel'
import { IvRankBadge, OptionMonitorStrip, VolStatsPanel } from '../../optionsAnalytics/VolPanels'
import OptionsHistoryPanel from '../../optionsAnalytics/OptionsHistoryPanel'
import { ProbabilityPanel, ContractDrill, ContractPicker, PositionBuilder, StancePanel } from '../../optionsAnalytics/ChainTools'

// BRK-01 increment 1 (roadmap §3.3) — the option chain: calls | strike | puts, with the full
// greek set, off the licensed Massive chain (api/routers/options_chain.py). DARK behind
// OPTIONS_CHAIN_ENABLED; the tab only exists while that flag rides the auth payload.
//
// ⛔ Read-only by charter: nothing here runs, sends or stages a trade. The one exception to "no
//    button" is increment 4's "Simulate", which starts a HISTORICAL study over past expirations
//    (BacktestPanel) -- it reads the past, it never places, stages or sends an order.
// ⛔ A failed request says so (sectionFetcher throws); it is never an empty chain presented as
//    "no options trade here".
// ⛔ IV RANK is not shown: it needs IV history, which is not licensed yet. The header shows the
//    current at-the-money IV and says why rank is absent.

const COLS = [
  ['bid', 'Bid', 2], ['ask', 'Ask', 2], ['last', 'Last', 2], ['iv', 'IV', 'pct'],
  ['delta', 'Δ', 3], ['gamma', 'Γ', 4], ['theta', 'Θ', 3], ['vega', 'Vega', 3],
  ['open_interest', 'OI', 'int'], ['day_volume', 'Vol', 'int'],
]

function fmt(v, how) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  if (how === 'pct') return `${(n * 100).toFixed(1)}%`
  if (how === 'int') return Math.round(n).toLocaleString()
  return n.toFixed(how)
}

export function atmStrike(rows, spot) {
  let best = null
  for (const r of rows) {
    if (r.strike == null) continue
    if (best == null || Math.abs(r.strike - spot) < Math.abs(best - spot)) best = r.strike
  }
  return best
}

// `volSurface`: BRK-01 increment 3's switch (options_vol_surface_enabled), passed by ResearchPage.
// `backtest`: BRK-01 increment 4's switch (options_backtest_enabled), passed by ResearchPage. Its
// one button is "Simulate" -- a historical simulation, never an order.
export default function OptionsChainTab({ sym, volSurface = false, backtest = false }) {
  const s = (sym || '').toUpperCase().trim()
  const [picked, setPicked] = useState('')
  // FT-016: a clicked quote opens the contract drill (renders nothing while OPTIONS_PRICER_ENABLED is off)
  const [drill, setDrill] = useState(null)
  const exps = useSWR(s ? `/api/research/options/${encodeURIComponent(s)}/expirations` : null, sectionFetcher,
    { revalidateOnFocus: false })
  const expiration = picked || ''
  const chain = useSWR(s ? `/api/research/options/${encodeURIComponent(s)}/chain?expiration=${expiration}&strikes=10` : null,
    sectionFetcher, { refreshInterval: 60_000, revalidateOnFocus: false })

  const rows = useMemo(() => {
    const d = chain.data
    if (!d || d.paywalled) return []
    const byStrike = new Map()
    for (const c of d.calls || []) byStrike.set(c.strike, { strike: c.strike, call: c })
    for (const p of d.puts || []) byStrike.set(p.strike, { ...(byStrike.get(p.strike) || { strike: p.strike }), put: p })
    return [...byStrike.values()].sort((a, b) => a.strike - b.strike)
  }, [chain.data])

  if (chain.error) {
    return <div className={styles.note} data-testid="chain-unavailable">
      The option chain is unavailable right now. That does not mean no options trade on {s}.
    </div>
  }
  if (!chain.data) return <div className={styles.note}>Loading the option chain…</div>
  if (chain.data.paywalled) return <div className={styles.note}>The option chain requires a paid plan.</div>

  const d = chain.data
  const atm = atmStrike(rows, d.spot)
  const atmIv = rows.find((r) => r.strike === atm)?.call?.iv ?? null
  const expList = exps.data?.expirations || []

  return (
    <section data-testid="options-chain">
      <div className={styles.head}>
        <label className={styles.expiry}>
          Expiration{' '}
          <select value={d.expiration || ''} onChange={(e) => setPicked(e.target.value)} aria-label="Expiration">
            {(expList.length ? expList : [d.expiration]).filter(Boolean).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <span>{s} <b>{fmt(d.spot, 2)}</b></span>
        <span data-testid="atm-iv">ATM IV <b>{fmt(atmIv, 'pct')}</b></span>
        <IvRankBadge sym={s} fallback={
          <span className={styles.muted} title="IV rank compares today's IV with its own history, which is not licensed yet.">
            IV rank: needs IV history
          </span>} />
      </div>
      <OptionMonitorStrip sym={s} />
      <div className={styles.scroll}>
        <table className={styles.grid}>
          <thead>
            <tr><th colSpan={COLS.length}>Calls</th><th /><th colSpan={COLS.length}>Puts</th></tr>
            <tr>
              {COLS.map(([k, l]) => <th key={`c-${k}`}>{l}</th>)}
              <th className={styles.strikeHead}>Strike</th>
              {COLS.map(([k, l]) => <th key={`p-${k}`}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.strike} className={r.strike === atm ? styles.atm : undefined}
                  data-testid={r.strike === atm ? 'atm-row' : undefined}>
                {COLS.map(([k, , how]) => <td key={`c-${k}`} onClick={() => r.call && setDrill(r.call)}>{fmt(r.call?.[k], how)}</td>)}
                <td className={styles.strike}>{fmt(r.strike, 2)}</td>
                {COLS.map(([k, , how]) => <td key={`p-${k}`} onClick={() => r.put && setDrill(r.put)}>{fmt(r.put?.[k], how)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ContractPicker sym={s} rows={rows} onPick={setDrill} />
      {drill && <ContractDrill key={drill.contract} sym={s} contract={drill} spot={Number(d.spot)} onClose={() => setDrill(null)} />}
      {drill && <StancePanel key={`stance-${drill.contract}`} sym={s} contract={drill} />}
      <PayoffPanel rows={rows} spot={Number(d.spot)} />
      <PositionBuilder sym={s} rows={rows} spot={Number(d.spot)} />
      <ProbabilityPanel sym={s} expiration={d.expiration || ''} />
      {volSurface && <VolSurfacePanel sym={s} expiration={d.expiration || ''} />}
      <IvHistoryPanel sym={s} />
      {backtest && <BacktestPanel sym={s} />}
      <OptionsHistoryPanel sym={s} />
      <VolStatsPanel sym={s} />
      <PositioningPanel sym={s} />
      <p className={styles.muted} data-testid="chain-source">
        Live chain from Massive (OPRA), greeks and IV exchange-derived · refreshed every {d.cache_seconds || 60}s
        {d.served_at ? ` · as of ${d.served_at.replace('T', ' ').replace('+00:00', ' UTC')}` : ''}
      </p>
    </section>
  )
}

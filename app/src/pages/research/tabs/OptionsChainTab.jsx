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
import { ProbabilityPanel, ContractDrill, ContractPicker, PositionBuilder, StancePanel, daysTo } from '../../optionsAnalytics/ChainTools'
import useDarkSection from '../../optionsAnalytics/useDarkSection'
import { extraGreeks } from '../../optionsAnalytics/chainModels'
import { EdgePanel, SpreadBookPanel, StrategyFinder } from '../../optionsAnalytics/ChainModelPanels'
import VolSkewPanels from '../../optionsAnalytics/VolSkewPanels'
import { mergeChain, atmIvOf, midOf, volOiOf, isItm, expectedMove } from './chainMath'

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

// [key, header, format, header tooltip]. Units are Massive's (vendor-computed, per share): theta is
// per CALENDAR day, vega per 1 vol point; OI is the OCC figure as of the prior close. Mid and Vol/OI are
// computed here from the same row (chainMath.js).
const COLS = [
  ['bid', 'Bid', 2], ['ask', 'Ask', 2], ['mid', 'Mid', 2, 'Midpoint of bid and ask (computed; blank without a two-sided quote)'],
  ['last', 'Last', 2], ['iv', 'IV', 'pct', 'Implied volatility, vendor-computed (Massive)'],
  ['delta', 'Δ', 3, 'Delta per share, vendor-computed'], ['gamma', 'Γ', 4, 'Gamma per share per $1 move, vendor-computed'],
  ['theta', 'Θ', 3, 'Theta: $ per share per calendar day, vendor-computed'], ['vega', 'Vega', 3, 'Vega: $ per share per 1 vol point, vendor-computed'],
  ['open_interest', 'OI', 'int', 'Open interest: the OCC figure as of the prior close (does not move intraday)'],
  ['day_volume', 'Vol', 'int', 'Contracts traded today'],
  ['vol_oi', 'V/OI', 'ratio', "Today's volume ÷ prior-close open interest (computed)"],
]
// FT-015 (lane/o-options-remainders), DARK behind OPTIONS_CHAIN_FULL_GREEKS_ENABLED: computed rho,
// lambda and epsilon (chainModels.extraGreeks) and a Calls / Puts / Both view. 404 = the chain above.
const FULL_COLS = [...COLS, ['rho', 'ρ', 3], ['lambda', 'λ', 2], ['epsilon', 'ε', 3]]
const MODES = [['both', 'Both'], ['calls', 'Calls'], ['puts', 'Puts']]

function fmt(v, how) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  if (how === 'pct') return `${(n * 100).toFixed(1)}%`
  if (how === 'int') return Math.round(n).toLocaleString()
  if (how === 'ratio') return `${n.toFixed(2)}×`
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

  const greeks = useDarkSection(s ? `/api/research/options/${encodeURIComponent(s)}/chain-greeks` : null)
  const full = greeks.data && greeks.data.rho ? greeks.data : null
  const [mode, setMode] = useState('both')

  // One row per strike. An adjusted contract sharing a strike with the standard one no longer
  // overwrites it: the standard (100-share, root = underlying) contract wins and the rest are counted.
  const { rows, dropped } = useMemo(() => {
    const d = chain.data
    if (!d || d.paywalled) return { rows: [], dropped: 0 }
    return mergeChain(d.calls, d.puts, d.ticker || s)
  }, [chain.data, s])

  if (chain.error) {
    return <div className={styles.note} data-testid="chain-unavailable">
      The option chain is unavailable right now. That does not mean no options trade on {s}.
    </div>
  }
  if (!chain.data) return <div className={styles.note}>Loading the option chain…</div>
  if (chain.data.paywalled) return <div className={styles.note}>The option chain requires a paid plan.</div>

  const d = chain.data
  const atm = atmStrike(rows, d.spot)
  // Mean of call and put IV at the strike nearest spot, as chain_tools.py computes it -- the same
  // number the payoff panel's PoP and the strategy finder consume below, and the probability panel's.
  const atmIv = atmIvOf(rows, d.spot)
  const move = expectedMove(rows, d.spot)
  const expList = exps.data?.expirations || []
  const cols = full ? FULL_COLS : COLS
  const showCalls = !full || mode !== 'puts'
  const showPuts = !full || mode !== 'calls'
  const days = daysTo(d.expiration)
  const derive = (q) => (q ? { ...q, mid: midOf(q), vol_oi: volOiOf(q) } : q)
  const aug = (q, type) => (q && full ? { ...q, ...extraGreeks({ ...q, type }, Number(d.spot), days) } : q)
  const shown = rows.map((r) => ({ ...r, call: derive(aug(r.call, 'call')), put: derive(aug(r.put, 'put')) }))

  return (
    <section data-testid="options-chain">
      <div className={styles.head}>
        <label className={styles.expiry}>
          Expiration{' '}
          <select value={d.expiration || ''} onChange={(e) => setPicked(e.target.value)} aria-label="Expiration">
            {(expList.length ? expList : [d.expiration]).filter(Boolean).map((x) => {
              const n = daysTo(x)
              return <option key={x} value={x}>{n == null ? x : `${x} (${n}d)`}</option>
            })}
          </select>
        </label>
        <span>{s} <b>{fmt(d.spot, 2)}</b></span>
        <span data-testid="atm-iv" title="Mean of the call and put implied volatility at the strike nearest spot (vendor IV)">ATM IV <b>{fmt(atmIv, 'pct')}</b></span>
        <span data-testid="expected-move" title="At-the-money straddle mid (call mid + put mid at the strike nearest spot) ÷ spot. A rule of thumb from today's quotes, not a forecast.">
          Expected move to {d.expiration || 'expiry'}{days != null ? ` (${days}d)` : ''}{' '}
          {move ? <b>±${move.dollars.toFixed(2)} (±{move.pct.toFixed(1)}%)</b> : <b>—</b>}
          <span className={styles.muted}> ATM straddle ÷ spot</span>
        </span>
        {full && (
          <span className={styles.mode} role="group" aria-label="Chain view" data-testid="chain-mode">
            {MODES.map(([k, l]) => <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>)}
          </span>
        )}
        <IvRankBadge sym={s} fallback={
          <span className={styles.muted} title="IV rank compares today's IV with its own history, which is not licensed yet.">
            IV rank: needs IV history
          </span>} />
      </div>
      <OptionMonitorStrip sym={s} />
      <div className={styles.scroll}>
        <table className={styles.grid}>
          <thead>
            <tr>{showCalls && <th colSpan={cols.length}>Calls</th>}<th />{showPuts && <th colSpan={cols.length}>Puts</th>}</tr>
            <tr>
              {showCalls && cols.map(([k, l, , t]) => <th key={`c-${k}`} title={t}>{l}</th>)}
              <th className={styles.strikeHead}>Strike</th>
              {showPuts && cols.map(([k, l, , t]) => <th key={`p-${k}`} title={t}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.strike} className={r.strike === atm ? styles.atm : undefined}
                  data-testid={r.strike === atm ? 'atm-row' : undefined}>
                {showCalls && cols.map(([k, , how]) => <td key={`c-${k}`} className={isItm('call', r.strike, d.spot) ? styles.itm : undefined} onClick={() => r.call && setDrill(r.call)}>{fmt(r.call?.[k], how)}</td>)}
                <td className={styles.strike}>{fmt(r.strike, 2)}</td>
                {showPuts && cols.map(([k, , how]) => <td key={`p-${k}`} className={isItm('put', r.strike, d.spot) ? styles.itm : undefined} onClick={() => r.put && setDrill(r.put)}>{fmt(r.put?.[k], how)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dropped > 0 && (
        <p className={styles.muted} data-testid="chain-merge-note">
          {dropped} adjusted or duplicate contract{dropped === 1 ? '' : 's'} sharing a strike {dropped === 1 ? 'was' : 'were'} left out;
          each row shows the standard 100-share contract.
        </p>
      )}
      {full && (
        <p className={styles.muted} data-testid="chain-greeks-basis">
          ρ, λ, ε computed: {full.rho} {full.lambda} {full.epsilon} {full.assumptions} {full.streaming}
        </p>
      )}
      <ContractPicker sym={s} rows={rows} onPick={setDrill} />
      {drill && <ContractDrill key={drill.contract} sym={s} contract={drill} spot={Number(d.spot)} onClose={() => setDrill(null)} />}
      {drill && <StancePanel key={`stance-${drill.contract}`} sym={s} contract={drill} />}
      <PayoffPanel rows={rows} spot={Number(d.spot)} sym={s} expiration={d.expiration || ''} atmIv={atmIv} />
      <StrategyFinder sym={s} rows={rows} spot={Number(d.spot)} expiration={d.expiration || ''} atmIv={atmIv} />
      <SpreadBookPanel />
      <EdgePanel sym={s} expiration={d.expiration || ''} />
      <PositionBuilder sym={s} rows={rows} spot={Number(d.spot)} />
      <ProbabilityPanel sym={s} expiration={d.expiration || ''} />
      {volSurface && <VolSurfacePanel sym={s} expiration={d.expiration || ''} />}
      <VolSkewPanels sym={s} />
      <IvHistoryPanel sym={s} />
      {backtest && <BacktestPanel sym={s} />}
      <OptionsHistoryPanel sym={s} />
      <VolStatsPanel sym={s} />
      <PositioningPanel sym={s} />
      <p className={styles.muted} data-testid="chain-source">
        Live chain from Massive (OPRA quotes) · IV and greeks are vendor-computed by Massive, per share
        (Θ per calendar day, vega per 1 vol point) · OI is the OCC prior-close figure · shaded cells are in the money
        · refreshed every {d.cache_seconds || 60}s
        {d.served_at ? ` · as of ${d.served_at.replace('T', ' ').replace('+00:00', ' UTC')}` : ''}
      </p>
    </section>
  )
}

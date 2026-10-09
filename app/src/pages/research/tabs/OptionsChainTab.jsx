import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import rp from '../ResearchPage.module.css'
import styles from './OptionsChainTab.module.css'
import PayoffPanel from './PayoffPanel'
import VolSurfacePanel from './VolSurfacePanel'
import { etStamp } from './volSurface'
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
import { useIsPhone } from '../../../hooks/useBreakpoint'
import Select from '../../../components/ui/Select'
import { formatCurrency, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { QuietPanelFreshness, usePanelFreshness } from '../../../components/terminal/terminalPanel'
import { num } from '../../optionsAnalytics/optionsFormat'

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
// Phone: one side at a time (a 12-column-a-side chain cannot fit 375px), Strike first.
const PHONE_SIDES = [['calls', 'Calls'], ['puts', 'Puts']]

function fmt(v, how) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  if (how === 'pct') return formatPercent(n * 100, { decimals: 1 })
  if (how === 'int') return formatNumber(Math.round(n))
  if (how === 'ratio') return `${num(n, 2)}×`
  return num(n, how)
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
  // TERM-019: the terminal panel header names the chain's source and the instant the server read it.
  const served = chain.data && !chain.data.paywalled && !chain.error ? chain.data.served_at || null : null
  usePanelFreshness(chain.data && !chain.data.paywalled && !chain.error
    ? { source: 'Massive (OPRA quotes)', observedAt: served, age: { asOfDate: etStamp(served) } }
    : null)

  const greeks = useDarkSection(s ? `/api/research/options/${encodeURIComponent(s)}/chain-greeks` : null)
  const full = greeks.data && greeks.data.rho ? greeks.data : null
  const [mode, setMode] = useState('both')
  const isPhone = useIsPhone()
  const [phoneSide, setPhoneSide] = useState('calls')

  // One row per strike. An adjusted contract sharing a strike with the standard one no longer
  // overwrites it: the standard (100-share, root = underlying) contract wins and the rest are counted.
  const { rows, dropped } = useMemo(() => {
    const d = chain.data
    if (!d || d.paywalled) return { rows: [], dropped: 0 }
    return mergeChain(d.calls, d.puts, d.ticker || s)
  }, [chain.data, s])
  // Audit 2026-10-08 (OMON P1): a quote cell opened the contract drill on a mouse click only. The
  // drill exists only while its contract route answers (the same probe ContractPicker makes, so SWR
  // shares the one read); while it does, each side's Mid cell is a keyboard stop (Enter / Space).
  const probe = useMemo(() => rows.flatMap((r) => [r.call, r.put]).find((c) => c?.contract)?.contract, [rows])
  const drillProbe = useDarkSection(probe ? `/api/research/options/${encodeURIComponent(s)}/contract/${encodeURIComponent(probe)}` : null)
  const drillable = Array.isArray(drillProbe.data?.bars)

  if (chain.error) {
    return <div className={styles.note} data-testid="chain-unavailable">
      The option chain is unavailable right now. That does not mean no options trade on {s}.{' '}<button type="button" className={rp.basisBtn} onClick={() => { chain.mutate(); exps.mutate() }}>Retry</button>
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
  const showCalls = isPhone ? phoneSide === 'calls' : (!full || mode !== 'puts')
  const showPuts = isPhone ? phoneSide === 'puts' : (!full || mode !== 'calls')
  const days = daysTo(d.expiration)
  const derive = (q) => (q ? { ...q, mid: midOf(q), vol_oi: volOiOf(q) } : q)
  const aug = (q, type) => (q && full ? { ...q, ...extraGreeks({ ...q, type }, Number(d.spot), days) } : q)
  const shown = rows.map((r) => ({ ...r, call: derive(aug(r.call, 'call')), put: derive(aug(r.put, 'put')) }))
  const quoteCell = (type, r, k, l, how) => {
    const q = r[type]
    const text = fmt(q?.[k], how)
    const cls = isItm(type, r.strike, d.spot) ? styles.itm : undefined
    const open = () => { if (q) setDrill(q) }
    if (drillable && q?.contract && k === 'mid') {
      return <td key={`${type[0]}-${k}`} className={cls} tabIndex={0} onClick={open}
        aria-label={`${l} ${text}: open the ${fmt(r.strike, 2)} ${type} contract`}
        data-testid={`drill-${type}-${r.strike}`}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}>{text}</td>
    }
    return <td key={`${type[0]}-${k}`} className={cls} onClick={drillable ? open : undefined}>{text}</td>
  }

  return (
    <section data-testid="options-chain">
      <div className={styles.head}>
        <label className={styles.expiry}>
          Expiration{' '}
          <Select value={d.expiration || ''} onChange={(e) => setPicked(e.target.value)} aria-label="Expiration">
            {(expList.length ? expList : [d.expiration]).filter(Boolean).map((x) => {
              const n = daysTo(x)
              return <option key={x} value={x}>{n == null ? x : `${x} (${n}d)`}</option>
            })}
          </Select>
        </label>
        <span>{s} <b>{fmt(d.spot, 2)}</b></span>
        <span data-testid="atm-iv" title="Mean of the call and put implied volatility at the strike nearest spot (vendor IV)">ATM IV <b>{fmt(atmIv, 'pct')}</b></span>
        <span data-testid="expected-move" title="At-the-money straddle mid (call mid + put mid at the strike nearest spot) ÷ spot. A rule of thumb from today's quotes, not a forecast.">
          Expected move to {d.expiration || 'expiry'}{days != null ? ` (${days}d)` : ''}{' '}
          {move ? <b>±{formatCurrency(move.dollars)} (±{formatPercent(move.pct, { decimals: 1 })})</b> : <b>—</b>}
          <span className={styles.muted}> ATM straddle ÷ spot</span>
        </span>
        {isPhone && (
          <span className={styles.mode} role="group" aria-label="Chain side" data-testid="chain-phone-side">
            {PHONE_SIDES.map(([k, l]) => <button key={k} type="button" aria-pressed={phoneSide === k} onClick={() => setPhoneSide(k)}>{l}</button>)}
          </span>
        )}
        {full && !isPhone && (
          <span className={styles.mode} role="group" aria-label="Chain view" data-testid="chain-mode">
            {MODES.map(([k, l]) => <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>)}
          </span>
        )}
        <IvRankBadge sym={s} fallback={
          <span className={styles.muted} title="IV rank compares today's IV with its own history, which is not licensed yet.">
            IV rank: needs IV history
          </span>} />
      </div>
      {/* Quality pass 2026-10-05: a failed expirations read was silently ignored -- the
          picker quietly held the one expiration the chain came back with. */}
      {exps.error && (
        <p className={styles.note} data-testid="chain-expirations-unavailable">
          The list of expirations couldn&apos;t be loaded, so only {d.expiration || 'this expiration'} can be picked right now.
        </p>
      )}
      <OptionMonitorStrip sym={s} />
      {/* An empty chain was a header row over nothing. Say it in words. */}
      {shown.length === 0 ? (
        <p className={styles.note} data-testid="chain-empty">
          {d.expiration
            ? `No option contracts came back for ${s} at the ${d.expiration} expiration.`
            : `No listed option expirations came back for ${s}.`}
        </p>
      ) : (
      <div className={styles.scroll}>
        <table className={styles.grid} aria-label={d.expiration ? `Option chain for ${s}, ${d.expiration} expiration` : `Option chain for ${s}`}>
          <thead>
            <tr>{isPhone && <td />}{showCalls && <th scope="colgroup" colSpan={cols.length}>Calls</th>}{!isPhone && <td />}{showPuts && <th scope="colgroup" colSpan={cols.length}>Puts</th>}</tr>
            <tr>
              {isPhone && <th scope="col" className={styles.strikeHead}>Strike</th>}
              {showCalls && cols.map(([k, l, , t]) => <th scope="col" key={`c-${k}`} title={t}>{l}</th>)}
              {!isPhone && <th scope="col" className={styles.strikeHead}>Strike</th>}
              {showPuts && cols.map(([k, l, , t]) => <th scope="col" key={`p-${k}`} title={t}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.strike} className={r.strike === atm ? styles.atm : undefined}
                  data-testid={r.strike === atm ? 'atm-row' : undefined}>
                {isPhone && <td className={styles.strike}>{fmt(r.strike, 2)}</td>}
                {showCalls && cols.map(([k, l, how]) => quoteCell('call', r, k, l, how))}
                {!isPhone && <td className={styles.strike}>{fmt(r.strike, 2)}</td>}
                {showPuts && cols.map(([k, l, how]) => quoteCell('put', r, k, l, how))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {/* The column definitions used to live only in header tooltips, which a finger cannot
          hover. The same text, tappable. */}
      <details className={styles.colKey} data-testid="chain-column-key">
        <summary>What the columns mean</summary>
        <dl>
          <dt>ATM IV</dt><dd>Mean of the call and put implied volatility at the strike nearest spot (vendor IV)</dd>
          {cols.filter((c) => c[3]).map(([k, l, , t]) => <div key={k}><dt>{l}</dt><dd>{t}</dd></div>)}
        </dl>
      </details>
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
      {/* TERM-019: these are panels of their own elsewhere; inside the chain they stay quiet so the
          terminal header names the chain's source, not whichever embedded panel reported last. */}
      <QuietPanelFreshness>
        <IvHistoryPanel sym={s} />
        {backtest && <BacktestPanel sym={s} />}
        <OptionsHistoryPanel sym={s} />
        <VolStatsPanel sym={s} />
        <PositioningPanel sym={s} />
      </QuietPanelFreshness>
      <p className={styles.muted} data-testid="chain-source">
        Live chain from Massive (OPRA quotes) · IV and greeks are vendor-computed by Massive, per share
        (Θ per calendar day, vega per 1 vol point) · OI is the OCC prior-close figure · shaded cells are in the money
        · refreshed every {d.cache_seconds || 60}s
        {etStamp(d.served_at) ? ` · as of ${etStamp(d.served_at)}` : ''}
      </p>
    </section>
  )
}

/**
 * MetricsDashboard — "My Metrics": the user-composable analytics dashboard.
 *
 * Cards come from GET /api/j2/metrics/registry (picker) and compute via ONE
 * batched GET /api/j2/metrics?keys=...&kpi=name:expr, scoped by the same
 * ScopeBar FilterSpec as every other surface — every number flows through the
 * audited pipeline, so customization can never fork the truth.
 *
 * Layout state ({cards: [key...], kpis: [{name, expr}...]}) persists via
 * usePreferences('j2_custom_dashboard'). v1 is an ordered card list
 * (add / remove / move up-down); the drag-grid is a recorded deferral in
 * docs/superpowers/plans/2026-08-21-custom-metrics-dashboard.md.
 */

import { useMemo, useState } from 'react'
import useMobileSWR from '../../../../hooks/useMobileSWR'
import usePreferences, { parsePref } from '../../../../hooks/usePreferences'
import styles from './MetricsDashboard.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

const DEFAULT_STATE = { cards: ['consistency', 'payoff_kelly', 'time_intel'], kpis: [] }

const pct = (v, dp = 1) => (v == null ? '—' : `${(v * 100).toFixed(dp)}%`)
const usd = (v) => (v == null ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
const num = (v, dp = 2) => (v == null ? '—' : Number(v).toFixed(dp))

export default function MetricsDashboard({ apiParams }) {
  const { prefs, setPref } = usePreferences()
  const state = parsePref(prefs.j2_custom_dashboard, DEFAULT_STATE)
  const cards = Array.isArray(state.cards) ? state.cards : DEFAULT_STATE.cards
  const kpis = Array.isArray(state.kpis) ? state.kpis : []

  const { data: registryRaw } = useMobileSWR('/api/j2/metrics/registry', fetcher, {
    revalidateOnFocus: false, refreshInterval: 0,
  })
  // Defensive: a bad/unexpected response shape must degrade to an empty
  // picker, never crash the whole Analytics tab.
  const registry = Array.isArray(registryRaw) ? registryRaw : []

  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (apiParams != null) {
      for (const [k, v] of Object.entries(apiParams)) {
        if (v == null || v === '') continue
        params.set(k, String(v))
      }
    }
    params.set('keys', cards.join(','))
    for (const k of kpis) params.append('kpi', `${k.name}:${k.expr}`)
    return `/api/j2/metrics?${params.toString()}`
  }, [apiParams, cards, kpis])

  const { data, error, isLoading } = useMobileSWR(
    (cards.length || kpis.length) ? url : null, fetcher,
    { revalidateOnFocus: false, refreshInterval: 0 },
  )

  const save = (next) => setPref('j2_custom_dashboard', { cards, kpis, ...next })

  const addCard = (key) => { if (key && !cards.includes(key)) save({ cards: [...cards, key] }) }
  const removeCard = (key) => save({ cards: cards.filter((c) => c !== key) })
  const moveCard = (key, dir) => {
    const i = cards.indexOf(key)
    const j = i + dir
    if (i < 0 || j < 0 || j >= cards.length) return
    const next = [...cards]
    ;[next[i], next[j]] = [next[j], next[i]]
    save({ cards: next })
  }

  const available = registry.filter((r) => r.key !== 'custom' && !cards.includes(r.key))
  const registryByKey = useMemo(
    () => Object.fromEntries(registry.map((r) => [r.key, r])), [registry],
  )
  const vocabulary = registryByKey.custom?.vocabulary || []

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <select
          className={styles.addSelect}
          value=""
          onChange={(e) => addCard(e.target.value)}
          aria-label="Add metric card"
        >
          <option value="">+ Add card…</option>
          {available.map((r) => (
            <option key={r.key} value={r.key} title={r.description}>{r.title}</option>
          ))}
        </select>
        {data?.tradeCount != null && (
          <span className={styles.scopeNote}>
            {data.tradeCount} trades in scope
            {data.rSources?.trueR > 0 && ` · True R feeds ${data.rSources.trueR}`}
          </span>
        )}
      </div>

      {error && <p className={styles.err} role="alert">Couldn't load metrics.</p>}
      {isLoading && !data && <p className={styles.hint}>Loading…</p>}

      <div className={styles.grid}>
        {cards.map((key) => (
          <MetricCard
            key={key}
            metaTitle={registryByKey[key]?.title || key}
            metricKey={key}
            payload={data?.metrics?.[key]}
            onRemove={() => removeCard(key)}
            onMove={(d) => moveCard(key, d)}
          />
        ))}
        <CustomKpiCard
          kpis={kpis}
          results={data?.custom || []}
          vocabulary={vocabulary}
          onChange={(next) => save({ kpis: next })}
        />
      </div>
    </div>
  )
}

function MetricCard({ metaTitle, metricKey, payload, onRemove, onMove }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h5 className={styles.cardTitle}>{metaTitle}</h5>
        <span className={styles.cardBtns}>
          <button type="button" className={styles.iconBtn} onClick={() => onMove(-1)} aria-label={`Move ${metaTitle} up`}>↑</button>
          <button type="button" className={styles.iconBtn} onClick={() => onMove(1)} aria-label={`Move ${metaTitle} down`}>↓</button>
          <button type="button" className={styles.iconBtn} onClick={onRemove} aria-label={`Remove ${metaTitle}`}>✕</button>
        </span>
      </div>
      {payload == null
        ? <p className={styles.hint}>—</p>
        : <CardBody metricKey={metricKey} p={payload} />}
    </div>
  )
}

function CardBody({ metricKey, p }) {
  switch (metricKey) {
    case 'consistency':
      return (
        <div className={styles.stats}>
          <Stat label="Profitable days" value={pct(p.profitableDayPct)} />
          <Stat label="Daily stdev" value={usd(p.dailyStdev)} />
          <Stat label="Best-day share" value={pct(p.largestDayShare)}
                title="Share of winning-day profit from your single best day" />
          <Stat label="Top-3-day share" value={pct(p.top3DayShare)} />
          <Stat label="Best day" value={p.bestDay ? `${usd(p.bestDay.pnl)} (${p.bestDay.date})` : '—'} />
          <Stat label="Worst day" value={p.worstDay ? `${usd(p.worstDay.pnl)} (${p.worstDay.date})` : '—'} neg />
        </div>
      )
    case 'risk_ratios':
      return (
        <div className={styles.stats}>
          <Stat label="Sharpe" value={num(p.sharpe)} />
          <Stat label="Sortino" value={num(p.sortino)} />
          <Stat label="Calmar" value={num(p.calmar)} />
          <Stat label="Annualized" value={pct(p.annualizedReturn)} />
          <Stat label="Max DD" value={pct(p.maxDrawdownPct)} neg />
          {p.sharpe == null && (
            <p className={styles.gateNote}>
              Needs {p.minTradingDays} trading days — {p.tradingDays} so far.
            </p>
          )}
        </div>
      )
    case 'payoff_kelly':
      return (
        <div className={styles.stats}>
          <Stat label="Win rate" value={pct(p.winRate)} />
          <Stat label="Avg win" value={usd(p.avgWin)} />
          <Stat label="Avg loss" value={usd(p.avgLoss)} neg />
          <Stat label="Payoff" value={num(p.payoff)} />
          <Stat label="Kelly" value={pct(p.kelly)} />
          <Stat label="Half-Kelly" value={pct(p.halfKelly)} title="The practical sizing number" />
          {p.kelly == null && p.decisive < p.minDecisive && (
            <p className={styles.gateNote}>
              Kelly needs {p.minDecisive} decisive trades — {p.decisive} so far.
            </p>
          )}
        </div>
      )
    case 'time_intel':
      return (
        <div className={styles.tables}>
          <MiniTable
            title="By hour (ET)"
            cols={['Hour', 'P&L', 'Trades', 'Win %']}
            rows={(p.byHour || []).map((b) => [`${b.hour}:00`, usd(b.pnl), b.trades, pct(b.winRate, 0)])}
            note={p.hourUnknown > 0 ? `${p.hourUnknown} trades without an hour stamp` : null}
          />
          <MiniTable
            title="By weekday"
            cols={['Day', 'P&L', 'Trades', 'Win %']}
            rows={(p.byWeekday || []).map((b) => [b.weekday, usd(b.pnl), b.trades, pct(b.winRate, 0)])}
          />
          <MiniTable
            title="By hold time"
            cols={['Hold', 'P&L', 'Trades', 'Avg R']}
            rows={(p.holdBuckets || []).filter((b) => b.trades > 0)
              .map((b) => [b.bucket, usd(b.pnl), b.trades, num(b.avgR)])}
          />
        </div>
      )
    case 'risk_per_trade':
      return (
        <div className={styles.stats}>
          <Stat label="Median risk" value={usd(p.median)} />
          <Stat label="Mean risk" value={usd(p.mean)} />
          <Stat label="90th pct" value={usd(p.p90)} />
          <Stat label="Max" value={usd(p.max)} />
          <p className={styles.gateNote}>
            Sources — stop: {p.sources?.stop ?? 0} · True R: {p.sources?.trueR ?? 0} · unknown: {p.sources?.unknown ?? 0}
          </p>
        </div>
      )
    case 'period_compare': {
      const pairs = [
        ['This month', 'thisMonth', 'lastMonth', 'Last month'],
        ['This quarter', 'thisQuarter', 'lastQuarter', 'Last quarter'],
        ['YTD', 'ytd', 'priorYtd', 'Prior YTD'],
      ]
      return (
        <div className={styles.tables}>
          {pairs.map(([labelA, a, b, labelB]) => (
            <MiniTable
              key={a}
              title={`${labelA} vs ${labelB}`}
              cols={['', 'Net P&L', 'Trades', 'Win %', 'Avg R']}
              rows={[
                [labelA, usd(p[a]?.netPnl), p[a]?.trades ?? '—', pct(p[a]?.winRate, 0), num(p[a]?.avgR)],
                [labelB, usd(p[b]?.netPnl), p[b]?.trades ?? '—', pct(p[b]?.winRate, 0), num(p[b]?.avgR)],
              ]}
            />
          ))}
        </div>
      )
    }
    case 'fees_drag':
      return (
        <div className={styles.stats}>
          <Stat label="Total fees" value={usd(p.totalFees)} neg />
          <Stat label="Per trade" value={usd(p.feesPerTrade)} />
          <Stat label="Of gross profit" value={pct(p.feesVsGrossProfit)}
                title="Fees as a share of what your winners produced" />
          <Stat label="Net P&L" value={usd(p.netPnl)} />
          <Stat label="Fee-free P&L" value={usd(p.feeFreePnl)}
                title="What the same trades would have made with zero costs" />
        </div>
      )
    case 'size_buckets':
      return p.buckets?.length ? (
        <MiniTable
          title="By entry notional (quartiles)"
          cols={['Size', 'P&L', 'Trades', 'Win %']}
          rows={p.buckets.map((b) => [b.label, usd(b.pnl), b.trades, pct(b.winRate, 0)])}
        />
      ) : (
        <p className={styles.gateNote}>Needs at least 4 sized trades.</p>
      )
    case 'monte_carlo':
      return p.terminal ? (
        <div className={styles.stats}>
          <Stat label="Next 100 trades (median)" value={usd(p.terminal.p50)} />
          <Stat label="5th–95th pct" value={`${usd(p.terminal.p5)} … ${usd(p.terminal.p95)}`} />
          <Stat label="Median max DD" value={usd(p.maxDrawdown?.p50)} neg />
          <Stat label="Worst-case DD (95th)" value={usd(p.maxDrawdown?.p95)} neg />
          <Stat label="P(−10% acct)" value={pct(p.probDown10)} />
          <Stat label="P(−20% acct)" value={pct(p.probDown20)} />
          <p className={styles.gateNote}>
            {p.paths.toLocaleString()} bootstrap paths from your own {p.trades}-trade P&L distribution.
          </p>
        </div>
      ) : (
        <p className={styles.gateNote}>
          Needs {p.minTrades} closed trades — {p.trades} so far.
        </p>
      )
    case 'dividends':
      return (
        <div className={styles.tables}>
          <div className={styles.stats}>
            <Stat label="Dividends" value={usd(p.dividendsTotal)} />
            <Stat label="Interest" value={usd(p.interestTotal)} />
          </div>
          {p.byMonth?.length > 0 && (
            <MiniTable
              title="By month (last 12)"
              cols={['Month', 'Amount']}
              rows={p.byMonth.map((m) => [m.month, usd(m.amount)])}
            />
          )}
          {p.topSymbols?.length > 0 && (
            <MiniTable
              title="Top payers"
              cols={['Symbol', 'Amount']}
              rows={p.topSymbols.map((t) => [t.symbol, usd(t.amount)])}
            />
          )}
          {p.count === 0 && (
            <p className={styles.gateNote}>No dividend or interest activity in the ledger yet.</p>
          )}
        </div>
      )
    default:
      return <p className={styles.hint}>Unknown card.</p>
  }
}

function CustomKpiCard({ kpis, results, vocabulary, onChange }) {
  const [name, setName] = useState('')
  const [expr, setExpr] = useState('')
  const byName = Object.fromEntries(results.map((r) => [r.name, r]))

  const add = () => {
    const n = name.trim()
    const e = expr.trim()
    if (!n || !e || kpis.some((k) => k.name === n)) return
    onChange([...kpis, { name: n, expr: e }])
    setName('')
    setExpr('')
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h5 className={styles.cardTitle}>Custom KPIs</h5>
      </div>
      {kpis.length > 0 && (
        <div className={styles.stats}>
          {kpis.map((k) => {
            const r = byName[k.name]
            return (
              <div key={k.name} className={styles.kpiRow}>
                <span className={styles.kpiName} title={k.expr}>{k.name}</span>
                <span className={styles.kpiValue}>
                  {r?.error
                    ? <span className={styles.err} title={r.error}>invalid</span>
                    : (r?.value ?? '—')}
                </span>
                <button
                  type="button" className={styles.iconBtn}
                  onClick={() => onChange(kpis.filter((x) => x.name !== k.name))}
                  aria-label={`Remove KPI ${k.name}`}
                >✕</button>
              </div>
            )
          })}
        </div>
      )}
      <div className={styles.kpiForm}>
        <input
          className={styles.kpiInput} placeholder="Name" value={name}
          maxLength={40} onChange={(e) => setName(e.target.value)}
        />
        <input
          className={`${styles.kpiInput} ${styles.kpiExpr}`} value={expr}
          placeholder="e.g. net_pnl / days_traded" maxLength={200}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        />
        <button type="button" className={styles.addBtn} onClick={add}>Add</button>
      </div>
      {vocabulary.length > 0 && (
        <p className={styles.vocab}>Variables: {vocabulary.join(' · ')}</p>
      )}
    </div>
  )
}

function Stat({ label, value, title, neg }) {
  return (
    <div className={styles.stat} title={title}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue} ${neg ? styles.neg : ''}`}>{value}</span>
    </div>
  )
}

function MiniTable({ title, cols, rows, note }) {
  return (
    <div className={styles.miniTableWrap}>
      <h6 className={styles.miniTitle}>{title}</h6>
      <table className={styles.miniTable}>
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {note && <p className={styles.gateNote}>{note}</p>}
    </div>
  )
}

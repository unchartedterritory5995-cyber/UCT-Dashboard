/**
 * Per-stock detail page at /journal-2-0/position/:sym — Phase 3 of the
 * Robinhood-style Journal. RH section order: Header → Chart(+ranges) →
 * Your Position → About → Stats → News → Analyst Ratings → Earnings →
 * History. Every section is null-safe: a missing feed hides the section.
 * Short Interest is intentionally omitted (no data source).
 */
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import useSWR from 'swr'
import StockChart from '../../../../components/StockChart'
import CompanyLogo from '../../../../components/CompanyLogo'
import useFundamentalSnapshot from '../../../../hooks/useFundamentalSnapshot'
import useRealtimePrices from '../../../../hooks/useRealtimePrices'
import useEarningsTable from '../../../../hooks/useEarningsTable'
import useJ2Positions from '../../hooks/useJ2Positions'
import useJ2Trades from '../../hooks/useJ2Trades'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import { yourPositionModel, statsModel, analystModel } from '../../lib/positionDetail'
import { money, moneySigned, percent } from '../../../../lib/journal-2-0'
import { SkeletonLine } from '../../../../components/Skeleton'
import AboutSection from './AboutSection'
import StatsSection from './StatsSection'
import NewsSection from './NewsSection'
import AnalystSection from './AnalystSection'
import EarningsSection from './EarningsSection'
import HistorySection from './HistorySection'
import styles from './PositionDetailPage.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

const TF_TABS = [
  { code: '5', label: '5m' },
  { code: '30', label: '30m' },
  { code: '60', label: '1h' },
  { code: 'D', label: 'D' },
  { code: 'W', label: 'W' },
]

/**
 * Combine multiple open J2 rows on the same symbol+side into one RH-style
 * position (total shares, weighted avg cost). Mixed long/short books render
 * one block per side. Earliest entryDate wins so the today-reference rule
 * stays conservative (prev close) unless every row opened today.
 */
export function combinePositions(rows) {
  const bySide = new Map()
  for (const p of rows || []) {
    const cur = bySide.get(p.side)
    if (!cur) {
      bySide.set(p.side, { ...p })
      continue
    }
    const shares = (cur.shares || 0) + (p.shares || 0)
    const cost = (cur.entryPrice || 0) * (cur.shares || 0) + (p.entryPrice || 0) * (p.shares || 0)
    bySide.set(p.side, {
      ...cur,
      shares,
      entryPrice: shares ? cost / shares : cur.entryPrice,
      entryDate: p.entryDate < cur.entryDate ? p.entryDate : cur.entryDate,
      brokerPrice: Number.isFinite(cur.brokerPrice) ? cur.brokerPrice : p.brokerPrice,
    })
  }
  return [...bySide.values()]
}

export default function PositionDetailPage() {
  const { sym: rawSym } = useParams()
  const sym = (rawSym || '').toUpperCase().trim()
  const [tf, setTf] = useState('D')

  const { data: snapshot } = useFundamentalSnapshot(sym)
  const { prices } = useRealtimePrices(sym ? [sym] : [])
  const live = prices?.[sym]

  const { data: barsData } = useSWR(
    sym ? `/api/bars/${encodeURIComponent(sym)}?tf=D&bars=30` : null, fetcher,
    { revalidateOnFocus: false },
  )
  const { data: newsData } = useSWR(
    sym ? `/api/chart-news/${encodeURIComponent(sym)}?days=30` : null, fetcher,
    { revalidateOnFocus: false },
  )
  const { data: grades } = useSWR(
    sym ? `/api/earnings/analyst-grades/${encodeURIComponent(sym)}` : null, fetcher,
    { revalidateOnFocus: false },
  )
  const { data: earningsTable } = useEarningsTable(sym)

  const { positions } = useJ2Positions()
  const { trades } = useJ2Trades()
  const { account: selectedAccount, accounts } = useJ2SelectedAccount()

  const todayIso = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    [],
  )
  const symPositions = useMemo(
    () => combinePositions(positions.filter((p) => p.symbol === sym)),
    [positions, sym],
  )
  const symTrades = useMemo(
    () => trades.filter((t) => t.symbol === sym),
    [trades, sym],
  )
  // Net-liq for the diversity % — the broker-reported figure is plenty for a
  // ratio (the live-MTM netLiq recipe needs the whole book's price feed).
  const netLiq = useMemo(() => {
    if (Number.isFinite(selectedAccount?.brokerTotalEquity)) return selectedAccount.brokerTotalEquity
    const sum = (accounts || [])
      .filter((a) => a?.balanceSource === 'broker' && Number.isFinite(a.brokerTotalEquity))
      .reduce((s, a) => s + a.brokerTotalEquity, 0)
    return sum || null
  }, [selectedAccount, accounts])

  const positionModels = useMemo(
    () => symPositions
      .map((p) => yourPositionModel(p, live, netLiq, todayIso))
      .filter(Boolean),
    [symPositions, live, netLiq, todayIso],
  )
  const stats = useMemo(
    () => statsModel(snapshot?.metrics, barsData?.bars),
    [snapshot, barsData],
  )
  const analyst = useMemo(() => analystModel(grades), [grades])

  const price = live?.price
  const changePct = live?.change_pct
  const changeDollar = Number.isFinite(price) && Number.isFinite(changePct)
    ? price - price / (1 + changePct / 100)
    : null
  const up = (changePct ?? 0) >= 0

  if (!sym) {
    return (
      <div className={styles.page}>
        <Link to="/journal?j2tab=positions" className={styles.back}>← Positions</Link>
        <p className={styles.missing}>No symbol.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <Link to="/journal?j2tab=positions" className={styles.back}>← Positions</Link>

      <header className={styles.header}>
        <CompanyLogo sym={sym} size={40} tile />
        <div className={styles.identity}>
          <h1 className={styles.sym}>{sym}</h1>
          {snapshot?.name
            ? <div className={styles.name}>{snapshot.name}</div>
            : <SkeletonLine width="140px" height={12} />}
        </div>
        <div className={styles.priceBlock}>
          {Number.isFinite(price)
            ? <div className={styles.price}>{money(price)}</div>
            : <SkeletonLine width="110px" height={28} />}
          {Number.isFinite(changePct) && (
            <div className={`${styles.change} ${up ? styles.pos : styles.neg}`}>
              <span aria-hidden="true">{up ? '▲' : '▼'}</span>
              {' '}{moneySigned(changeDollar)} ({percent(changePct, { dp: 2, signed: true, isRatio: false })})
              <span className={styles.changeLabel}> Today</span>
            </div>
          )}
        </div>
      </header>

      <div className={styles.chartCard}>
        <div className={styles.tfBar} role="tablist" aria-label="Chart timeframe">
          {TF_TABS.map((t) => (
            <button
              key={t.code}
              type="button"
              role="tab"
              aria-selected={tf === t.code}
              className={tf === t.code ? styles.tfBtnActive : styles.tfBtn}
              onClick={() => setTf(t.code)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className={styles.chartWrap}>
          <StockChart sym={sym} tf={tf} height="100%" showDrawingTools={false} />
        </div>
      </div>

      {positionModels.length > 0 && (
        <section className={styles.section} aria-label="Your position">
          <h2 className={styles.sectionTitle}>Your Position</h2>
          {positionModels.map((m) => (
            <YourPositionGrid key={m.side} model={m} />
          ))}
        </section>
      )}

      <AboutSection about={snapshot?.about} sector={snapshot?.sector} industry={snapshot?.industry} />
      <StatsSection rows={stats} />
      <NewsSection items={newsData?.news} />
      <AnalystSection model={analyst} priceTarget={grades?.price_target} composite={snapshot?.composite} />
      <EarningsSection quarterly={earningsTable?.quarterly} />
      <HistorySection trades={symTrades} positions={symPositions} />
    </div>
  )
}

function YourPositionGrid({ model }) {
  const sign = (n) => (n > 0 ? styles.pos : n < 0 ? styles.neg : '')
  const cells = [
    { label: model.side === 'Short' ? 'Shares (short)' : 'Shares', value: String(model.shares ?? '—') },
    { label: 'Market value', value: model.marketValue == null ? '—' : money(model.marketValue) },
    { label: 'Average cost', value: model.avgCost == null ? '—' : money(model.avgCost) },
    { label: 'Portfolio diversity', value: model.diversityPct == null ? '—' : percent(model.diversityPct, { dp: 2 }) },
    {
      label: "Today's return",
      value: model.todayDollar == null ? '—' : (
        <span className={sign(model.todayDollar)}>
          {moneySigned(model.todayDollar)}
          {model.todayPct != null && <> ({percent(model.todayPct, { dp: 2, signed: true })})</>}
        </span>
      ),
    },
    {
      label: 'Total return',
      value: model.totalReturnDollar == null ? '—' : (
        <span className={sign(model.totalReturnDollar)}>
          {moneySigned(model.totalReturnDollar)}
          {model.totalReturnPct != null && <> ({percent(model.totalReturnPct, { dp: 2, signed: true })})</>}
        </span>
      ),
    },
  ]
  return (
    <div className={styles.posGrid}>
      {cells.map((c) => (
        <div key={c.label} className={styles.posCell}>
          <div className={styles.posLabel}>{c.label}</div>
          <div className={styles.posValue}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}

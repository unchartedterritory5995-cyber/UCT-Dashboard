/* eslint-disable react-refresh/only-export-components */
/**
 * RiskDashboard — visualize the position-sizing engine + portfolio heat.
 *
 * Surfaces (all read-only, refreshes every 30s):
 *   - Headline portfolio heat % with cap line
 *   - Open positions count + total dollar risk
 *   - By-symbol concentration bars
 *   - By-sector concentration bars
 *   - Recent validate_trade refusals (with refusal_basis)
 *   - Account settings: account size, max risk per trade, heat cap,
 *     sector cap (mirrors validate_trade rules)
 *
 * Renders the same data Compass's Risk Officer mandate uses to refuse
 * trades. Gives the user institutional-grade visibility into their
 * exposure at a glance.
 */
import { useContext } from 'react'
import useSWR from 'swr'
import { VoiceContext, setVoicePageHint } from '../context/VoiceContext'
import useRealtimeSession from '../hooks/useRealtimeSession'
import styles from './RiskDashboard.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

function fmtMoney(n) {
  if (n == null) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function fmtPct(n) {
  if (n == null) return '—'
  return `${n.toFixed(2)}%`
}


export default function RiskDashboard() {
  const { data, isLoading } = useSWR('/api/voice/risk-dashboard', fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })

  if (isLoading) {
    return <div className={styles.loading}>Loading risk view…</div>
  }
  if (!data) {
    return (
      <div className={styles.empty}>
        Risk dashboard unavailable. Make sure Compass voice access is enabled.
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>🛡️ Risk Dashboard</h1>
        <div className={styles.subtitle}>
          Position-sizing engine state. Compass's Risk Officer mandate uses
          this exact view to approve or refuse trades.
        </div>
      </header>

      <HeatRow data={data} />
      <SettingsRow data={data} />

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Concentration by symbol</h2>
        <ConcentrationBars
          items={data.by_symbol}
          labelKey="symbol"
          capPct={data.max_risk_per_trade_pct}
          accountSize={data.account_size}
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Concentration by sector</h2>
        <ConcentrationBars
          items={data.by_sector}
          labelKey="sector"
          capPct={data.max_sector_concentration_pct}
          accountSize={data.account_size}
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent refusals</h2>
        <RefusalsList items={data.recent_refusals} />
      </section>
    </div>
  )
}


function HeatRow({ data }) {
  const heat = data.portfolio_heat_pct
  const cap = data.portfolio_heat_cap_pct
  const ratio = cap > 0 ? Math.min(heat / cap, 1.2) : 0
  const overCap = heat > cap
  // P5-F: any sector over its concentration cap?
  const sectorBreached = (data.by_sector || []).some(
    (s) => s.risk_pct > data.max_sector_concentration_pct,
  )
  const showAskCompass = overCap || sectorBreached

  return (
    <section className={styles.heatSection}>
      <div className={styles.heatLabel}>Portfolio heat</div>
      <div className={styles.heatRow}>
        <div className={styles.heatNumber}>
          <span className={overCap ? styles.heatRed : ''}>{fmtPct(heat)}</span>
          <span className={styles.heatCap}>/ {fmtPct(cap)} cap</span>
        </div>
        <div className={styles.heatBarOuter}>
          <div
            className={`${styles.heatBarInner} ${overCap ? styles.heatBarOver : ''}`}
            style={{ width: `${Math.min(ratio * 100, 100)}%` }}
          />
          <div className={styles.heatCapMark} style={{ left: '83.3%' }}
               title={`Cap at ${fmtPct(cap)}`} />
        </div>
      </div>
      <div className={styles.heatStats}>
        <span><strong>{data.open_position_count}</strong> open</span>
        <span><strong>{fmtMoney(data.total_risk_dollars)}</strong> at risk</span>
        <span>Account: <strong>{fmtMoney(data.account_size)}</strong></span>
      </div>
      {showAskCompass && (
        <AskCompassButton
          reason={overCap ? 'heat-over-cap' : 'sector-breach'}
          data={data}
        />
      )}
    </section>
  )
}


function AskCompassButton({ reason, data }) {
  const voice = useContext(VoiceContext)
  if (!voice) return null
  return <AskCompassButtonInner reason={reason} data={data} />
}


function AskCompassButtonInner({ reason, data }) {
  const { connect } = useRealtimeSession()
  const handleClick = () => {
    // Pre-load a page hint so Compass starts the session knowing the
    // risk state — heat % and the specific breach.
    const breach = reason === 'heat-over-cap'
      ? `portfolio heat ${data.portfolio_heat_pct.toFixed(1)}% is over the ${data.portfolio_heat_cap_pct.toFixed(0)}% cap`
      : `a sector concentration is over the ${data.max_sector_concentration_pct.toFixed(0)}% limit`
    setVoicePageHint(
      `Risk Dashboard — ${breach}. Open positions: ${data.open_position_count}. ` +
      `Total at risk: $${data.total_risk_dollars.toFixed(0)}.`
    )
    connect('compass')
  }
  const label = reason === 'heat-over-cap'
    ? '🧭 Ask Compass why you’re hot'
    : '🧭 Ask Compass about this sector concentration'
  return (
    <button
      type="button"
      onClick={handleClick}
      className={styles.askCompassBtn}
      aria-label={label}
    >
      {label}
    </button>
  )
}


function SettingsRow({ data }) {
  return (
    <section className={styles.settingsRow}>
      <SettingPill label="Max per trade" value={fmtPct(data.max_risk_per_trade_pct)} />
      <SettingPill label="Heat cap" value={fmtPct(data.portfolio_heat_cap_pct)} />
      <SettingPill label="Sector cap" value={fmtPct(data.max_sector_concentration_pct)} />
      <SettingPill label="Account" value={fmtMoney(data.account_size)} />
    </section>
  )
}


function SettingPill({ label, value }) {
  return (
    <div className={styles.pill}>
      <div className={styles.pillLabel}>{label}</div>
      <div className={styles.pillValue}>{value}</div>
    </div>
  )
}


function ConcentrationBars({ items, labelKey, capPct }) {
  if (!items || items.length === 0) {
    return <div className={styles.empty}>No open positions.</div>
  }
  const maxPct = Math.max(...items.map((i) => i.risk_pct), capPct, 1)
  return (
    <div className={styles.bars}>
      {items.map((item) => {
        const overCap = item.risk_pct > capPct
        const widthPct = (item.risk_pct / maxPct) * 100
        return (
          <div key={item[labelKey]} className={styles.barRow}>
            <div className={styles.barLabel}>{item[labelKey]}</div>
            <div className={styles.barOuter}>
              <div
                className={`${styles.barInner} ${overCap ? styles.barOver : ''}`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <div className={styles.barValue}>
              {fmtPct(item.risk_pct)} · {fmtMoney(item.risk_dollars)}
            </div>
          </div>
        )
      })}
    </div>
  )
}


function RefusalsList({ items }) {
  if (!items || items.length === 0) {
    return (
      <div className={styles.empty}>
        No refusals on record. Compass approved every trade you ran through
        the validator.
      </div>
    )
  }
  return (
    <div className={styles.refusals}>
      {items.map((r, i) => (
        <div key={i} className={styles.refusal}>
          <div className={styles.refusalHeader}>
            <strong>{r.symbol || '?'}</strong> ·{' '}
            {r.shares} sh @ ${r.entry} (stop ${r.stop})
            <span className={styles.refusalTime}>{r.created_at?.slice(0, 16)}</span>
          </div>
          {r.reason && (
            <div className={styles.refusalReason}>{r.reason}</div>
          )}
          {Array.isArray(r.refusal_basis) && r.refusal_basis.length > 0 && (
            <ul className={styles.refusalBasis}>
              {r.refusal_basis.map((b, j) => <li key={j}>{b}</li>)}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

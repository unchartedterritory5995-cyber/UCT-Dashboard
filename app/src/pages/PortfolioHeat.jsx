// A14 CP1 (GATE-A14-PORTFOLIO-HEAT-CP1, signed 2026-09-21, fingerprint
// 417b6b853) -- a plain renderer over GET /api/portfolio/heat's own fields.
// No new computation, no field invented -- everything below is a field the
// backend's portfolio_heat.py already returns to its four assistant-tool
// callers (Compass chat, voice, AI Search, grade_watchlist).
import useMobileSWR from '../hooks/useMobileSWR'
import styles from './PortfolioHeat.module.css'

// ⛔ NOT `fetch(url).then(r => r.json())` -- a 402 answers JSON too. See
// utils/jsonFetcher.js's own header comment (the Traders.jsx idiom).
import fetcher from '../utils/jsonFetcher'

function CapBar({ label, valuePct, capPct }) {
  const pct = capPct > 0 ? Math.min(100, (valuePct / capPct) * 100) : 0
  const over = valuePct > capPct
  return (
    <div className={styles.capRow}>
      <div className={styles.capLabel}>
        <span>{label}</span>
        <span className={over ? styles.capValueOver : styles.capValue}>
          {valuePct.toFixed(1)}% <span className={styles.capOf}>/ {capPct.toFixed(1)}% cap</span>
        </span>
      </div>
      <div className={styles.capTrack}>
        <div className={over ? styles.capFillOver : styles.capFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function PortfolioHeat() {
  const { data, error } = useMobileSWR('/api/portfolio/heat', fetcher, { refreshInterval: 60000 })

  // ⭐ THE REFUSAL IS SAID OUT LOUD, same reasoning as Traders.jsx: without
  // this branch a 402 leaves `data` undefined forever and the page reads
  // "Loading…" -- identical to a slow network, and neither is true.
  const refused = error?.status === 402 || error?.status === 403
  const failed = error && !refused

  if (error) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>Portfolio Risk</h1>
        <p className={styles.loading} role="status">
          {refused
            ? 'Portfolio risk is part of a paid plan.'
            : 'Portfolio risk could not be loaded. Retrying…'}
        </p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>Portfolio Risk</h1>
        <p className={styles.loading}>Loading portfolio risk…</p>
      </div>
    )
  }

  if (data.ok === false) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>Portfolio Risk</h1>
        <p className={styles.loading} role="status">
          {data.reason || 'Portfolio risk could not be computed right now.'}
        </p>
      </div>
    )
  }

  const {
    risk_heat_pct, notional_exposure_pct, per_position = [], by_sector = [],
    concentration_flags = [], caps = {}, room_to_add_pct, account_size_is_default,
    regime,
  } = data

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Portfolio Risk</h1>

      {account_size_is_default && (
        <p className={styles.notice} role="status">
          No account size on file — these numbers use a default account size, not your real one.
        </p>
      )}

      <div className={styles.capsSection}>
        <CapBar label="Risk heat" valuePct={risk_heat_pct} capPct={caps.aggregate_pct ?? 10} />
        <div className={styles.statRow}>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Notional exposure</div>
            <div className={styles.statValue}>{notional_exposure_pct?.toFixed(1)}%</div>
            {caps.regime_ceiling_pct != null && (
              <div className={styles.statSub}>regime ceiling {caps.regime_ceiling_pct}%</div>
            )}
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Room to add</div>
            <div className={styles.statValue}>{room_to_add_pct?.toFixed(1)}%</div>
          </div>
          {regime && (
            <div className={styles.stat}>
              <div className={styles.statLabel}>Regime</div>
              <div className={styles.statValue}>{regime}</div>
            </div>
          )}
        </div>
      </div>

      {concentration_flags.length > 0 && (
        <div className={styles.flagsSection}>
          {concentration_flags.map(f => (
            <div key={f.sector} className={styles.flag}>
              ⚠ {f.sector} is {f.risk_pct.toFixed(1)}% of your risk — over 40% concentration
            </div>
          ))}
        </div>
      )}

      <h2 className={styles.subheading}>Positions</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th>Dist. to stop</th>
              <th>Risk %</th>
              <th>Stop</th>
            </tr>
          </thead>
          <tbody>
            {per_position.map(p => (
              <tr key={p.symbol}>
                <td className={styles.sym}>{p.symbol}</td>
                <td>{p.side}</td>
                <td>{p.dist_to_stop_pct != null ? `${p.dist_to_stop_pct}%` : '—'}</td>
                <td>{p.risk_pct != null ? `${p.risk_pct}%` : '—'}</td>
                {/* placeholder_stop is SURFACED, never hidden -- dropping it
                    would under-report heat (portfolio_heat.py's own design). */}
                <td>
                  {p.placeholder_stop
                    ? <span className={styles.placeholderBadge} title="No real stop on file — a broker placeholder">no real stop</span>
                    : 'set'}
                </td>
              </tr>
            ))}
            {per_position.length === 0 && (
              <tr><td colSpan={5} className={styles.empty}>No open positions.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {by_sector.length > 0 && (
        <>
          <h2 className={styles.subheading}>By sector</h2>
          <div className={styles.sectorList}>
            {by_sector.map(s => (
              <div key={s.sector} className={styles.sectorRow}>
                <span>{s.sector}</span>
                <span>{s.risk_pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

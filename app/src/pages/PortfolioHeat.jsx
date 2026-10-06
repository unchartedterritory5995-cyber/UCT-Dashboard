// A14 CP1 (GATE-A14-PORTFOLIO-HEAT-CP1, signed 2026-09-21, fingerprint
// 417b6b853) -- a plain renderer over GET /api/portfolio/heat's own fields.
// No new computation, no field invented -- everything below is a field the
// backend's portfolio_heat.py already returns to its four assistant-tool
// callers (Compass chat, voice, AI Search, grade_watchlist).
import useMobileSWR from '../hooks/useMobileSWR'
import UIcon from '../components/ui/UIcon'
import { formatPercent } from '../lib/presentation/presentationPrimitives'
import styles from './PortfolioHeat.module.css'

// ⛔ NOT `fetch(url).then(r => r.json())` -- a 402 answers JSON too. See
// utils/jsonFetcher.js's own header comment (the Traders.jsx idiom).
import fetcher from '../utils/jsonFetcher'

// A null percentage renders "—", never a bare "%" (and never throws on .toFixed).
// The shared formatter owns the rounding and the missing-value glyph.
export const pctText = (v) => formatPercent(v, { decimals: 1 })

function CapBar({ label, valuePct, capPct }) {
  if (!Number.isFinite(valuePct)) {
    return <div className={styles.capRow}><div className={styles.capLabel}><span>{label}</span><span className={styles.capValue}>—</span></div></div>
  }
  const pct = capPct > 0 ? Math.min(100, (valuePct / capPct) * 100) : 0
  const over = valuePct > capPct
  return (
    <div className={styles.capRow}>
      <div className={styles.capLabel}>
        <span>{label}</span>
        <span className={over ? styles.capValueOver : styles.capValue}>
          {pctText(valuePct)} <span className={styles.capOf}>/ {pctText(capPct)} cap</span>
        </span>
      </div>
      <div className={styles.capTrack}>
        <div className={over ? styles.capFillOver : styles.capFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function PortfolioHeat() {
  const { data, error, mutate } = useMobileSWR('/api/portfolio/heat', fetcher, { refreshInterval: 60000 })

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
          {/* "Retrying…" was a promise SWR does not keep: it stops polling a key holding an
              error. A real Retry instead (quality pass 2026-10-05). */}
          {refused
            ? 'Portfolio risk is part of a paid plan.'
            : <>Portfolio risk could not be read right now.{' '}<button type="button" onClick={() => mutate()}>Retry</button></>}
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
          {data.reason ? `Portfolio risk could not be computed: ${data.reason}.` : 'Portfolio risk could not be computed right now.'}
        </p>
      </div>
    )
  }

  const {
    risk_heat_pct, notional_exposure_pct, per_position = [], by_sector = [],
    concentration_flags = [], caps = {}, room_to_add_pct, account_size_is_default,
    regime, regime_label,
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
            <div className={styles.statValue}>{pctText(notional_exposure_pct)}</div>
            {caps.regime_ceiling_pct != null && (
              <div className={styles.statSub}>regime ceiling {caps.regime_ceiling_pct}%</div>
            )}
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Room to add</div>
            <div className={styles.statValue}>{pctText(room_to_add_pct)}</div>
          </div>
          {regime && (
            <div className={styles.stat}>
              <div className={styles.statLabel}>Regime</div>
              {/* TERM-041: the published words for the regime, not the raw id;
                  the id is shown only by a server that predates regime_label. */}
              <div className={styles.statValue}>{regime_label ?? regime}</div>
            </div>
          )}
        </div>
      </div>

      {concentration_flags.length > 0 && (
        <div className={styles.flagsSection}>
          {concentration_flags.map(f => (
            <div key={f.sector} className={styles.flag}>
              <UIcon name="warning" size={14} gold={false} className={styles.flagIcon} />
              {f.sector} is {pctText(f.risk_pct)} of your risk — over 40% concentration
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
                <td>{p.side ? p.side[0].toUpperCase() + p.side.slice(1) : '—'}</td>
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
                <span>{pctText(s.risk_pct)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

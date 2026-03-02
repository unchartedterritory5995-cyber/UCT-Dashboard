import useSWR from 'swr'
import TileCard from '../components/TileCard'
import TickerPopup from '../components/TickerPopup'
import styles from './MorningWire.module.css'

const fetcher = url => fetch(url).then(r => r.json())

// Small stat pill used in the page header strip
function StatPill({ label, value, color }) {
  return (
    <div className={`${styles.statPill} ${styles[`pill_${color}`]}`}>
      <span className={styles.pillLabel}>{label}</span>
      <span className={styles.pillValue}>{value}</span>
    </div>
  )
}

// Verdict badge for earnings rows
function VerdictBadge({ verdict }) {
  if (!verdict) return null
  const isbeat = verdict.toUpperCase() === 'BEAT'
  return (
    <span className={isbeat ? styles.beat : styles.miss}>
      {verdict.toUpperCase()}
    </span>
  )
}

// One earnings row inside "By the Numbers"
function EarningsRow({ row }) {
  const sym = row.sym || row.ticker || row.symbol
  const surprise = row.surprise_pct
  const isPos = typeof surprise === 'number' ? surprise > 0
    : typeof surprise === 'string' ? surprise.startsWith('+') : false

  return (
    <div className={styles.earningsRow}>
      <TickerPopup sym={sym} className={styles.earningsTicker} />
      <VerdictBadge verdict={row.verdict} />
      <span className={`${styles.surprise} ${isPos ? styles.gainText : styles.lossText}`}>
        {surprise != null
          ? (typeof surprise === 'number'
              ? `${surprise > 0 ? '+' : ''}${surprise.toFixed(1)}%`
              : surprise)
          : '—'}
      </span>
    </div>
  )
}

export default function MorningWire() {
  const { data: rundown } = useSWR('/api/rundown', fetcher, { refreshInterval: 300000 })
  const { data: breadth }  = useSWR('/api/breadth',  fetcher, { refreshInterval: 300000 })
  const { data: earnings } = useSWR('/api/earnings', fetcher, { refreshInterval: 300000 })
  const { data: movers }   = useSWR('/api/movers',   fetcher, { refreshInterval: 30000  })

  const exposure = rundown?.exposure
  const distDays = breadth?.distribution_days ?? null
  const distColor = distDays == null ? 'info'
    : distDays >= 5 ? 'loss'
    : distDays >= 3 ? 'warn'
    : 'gain'

  const bmo = earnings?.bmo || []
  const amc = earnings?.amc || []
  const ripping  = movers?.ripping  || []
  const drilling = movers?.drilling || []
  const hasMovers = ripping.length > 0 || drilling.length > 0

  return (
    <div className={styles.page}>

      {/* ── Page header ─────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.titleRow}>
          <span className={styles.wireName}>The Morning Wire</span>
          {rundown?.date && <span className={styles.wireDate}>{rundown.date}</span>}
        </div>
        <div className={styles.statsStrip}>
          <StatPill
            label="Exposure"
            value={exposure?.exposure || '—'}
            color="warn"
          />
          <StatPill
            label="Phase"
            value={breadth?.market_phase || '—'}
            color="info"
          />
          <StatPill
            label="Dist"
            value={distDays ?? '—'}
            color={distColor}
          />
          {exposure?.note && (
            <span className={styles.exposureNote}>{exposure.note}</span>
          )}
        </div>
      </div>

      {/* ── The Rundown ──────────────────────────────────────────── */}
      <TileCard title="The Rundown">
        {rundown?.html
          ? (
            <div
              className={styles.rundownWrap}
              dangerouslySetInnerHTML={{ __html: rundown.html }}
            />
          )
          : <p className={styles.loading}>Loading rundown…</p>
        }
      </TileCard>

      {/* ── By the Numbers ───────────────────────────────────────── */}
      <TileCard title="By the Numbers">
        <div className={styles.numbers}>

          {/* Earnings */}
          <div className={styles.numbersSection}>
            <span className={styles.sectionLabel}>Earnings</span>
            <div className={styles.earningsBuckets}>
              {bmo.length > 0 && (
                <div className={styles.bucket}>
                  <span className={styles.bucketLabel}>▲ BMO</span>
                  {bmo.map((row, i) => (
                    <EarningsRow key={row.sym || row.ticker || i} row={row} />
                  ))}
                </div>
              )}
              {amc.length > 0 && (
                <div className={styles.bucket}>
                  <span className={styles.bucketLabel}>▼ AMC</span>
                  {amc.map((row, i) => (
                    <EarningsRow key={row.sym || row.ticker || i} row={row} />
                  ))}
                </div>
              )}
              {bmo.length === 0 && amc.length === 0 && (
                <span className={styles.noData}>No earnings today</span>
              )}
            </div>
          </div>

          {/* Movers */}
          {hasMovers && (
            <div className={styles.numbersSection}>
              <span className={styles.sectionLabel}>Movers</span>
              <div className={styles.moversRows}>
                {ripping.length > 0 && (
                  <div className={styles.moverRow}>
                    <span className={styles.moverDir}>↑</span>
                    <div className={styles.chips}>
                      {ripping.map((m, i) => (
                        <TickerPopup
                          key={m.sym || i}
                          sym={m.sym}
                          className={styles.chipGain}
                        >
                          {m.sym} <span className={styles.chipPct}>{m.pct}</span>
                        </TickerPopup>
                      ))}
                    </div>
                  </div>
                )}
                {drilling.length > 0 && (
                  <div className={styles.moverRow}>
                    <span className={styles.moverDir}>↓</span>
                    <div className={styles.chips}>
                      {drilling.map((m, i) => (
                        <TickerPopup
                          key={m.sym || i}
                          sym={m.sym}
                          className={styles.chipLoss}
                        >
                          {m.sym} <span className={styles.chipPct}>{m.pct}</span>
                        </TickerPopup>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </TileCard>

    </div>
  )
}

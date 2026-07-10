// app/src/pages/FlowScoreboard.jsx
//
// Public Flow Scoreboard — the verified hit-rate trust asset (roadmap T1-2).
// Every Top Flow pick is snapshotted daily; this page shows the aggregate
// outcomes with nothing hidden: win rates INCLUDE losers, the "honest tape"
// shows the last picks regardless of outcome, and the methodology is printed
// verbatim from the API so the numbers and the words can't drift apart.
//
// Data: GET /api/flow-scoreboard (public, read-only, 5-min server cache).
import useSWR from 'swr'
import TickerPopup from '../components/TickerPopup'
import UIcon from '../components/ui/UIcon'
import styles from './FlowScoreboard.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

/* ── Formatting helpers ──────────────────────────────────────────────────── */

export function fmtStrike(s) {
  const n = Number(s)
  if (!Number.isFinite(n)) return String(s ?? '')
  return n % 1 === 0 ? n.toFixed(0) : String(n)
}

export function contractLine(p) {
  const cp = p.cp === 'P' ? 'P' : 'C'
  return `$${fmtStrike(p.strike)}${cp} ${p.exp || ''}`.trim()
}

function fmtPct(v, { signed = true, dp = 1 } = {}) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  const sign = signed && n > 0 ? '+' : ''
  return `${sign}${n.toFixed(dp)}%`
}

function fmtPrice(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return `$${Number(v).toFixed(2)}`
}

const gainCls = (v) => (v > 0 ? styles.gain : v < 0 ? styles.loss : styles.flat)

function GradeChip({ grade }) {
  if (!grade) return <span className={styles.gradeChipMuted}>—</span>
  const cls = {
    'A+': styles.gradeAPlus,
    A: styles.gradeA,
    B: styles.gradeB,
    C: styles.gradeC,
    D: styles.gradeD,
  }[grade] || styles.gradeChipMuted
  return <span className={`${styles.gradeChip} ${cls}`}>{grade}</span>
}

function OiBadge({ confirmed }) {
  if (!confirmed) return null
  return (
    <span className={styles.oiBadge} title="Open interest rose >10% after the flag — the positioning was opened, not closed">
      <UIcon name="check" size={10} gold /> OI confirmed
    </span>
  )
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function FlowScoreboard({ embedded = false }) {
  const { data, isLoading } = useSWR('/api/flow-scoreboard', fetcher, {
    refreshInterval: 300_000,
    revalidateOnFocus: false,
  })

  const overall = data?.overall
  const hasData = (data?.picks_tracked ?? 0) > 0

  return (
    <div className={embedded ? `${styles.page} ${styles.embedded}` : styles.page}>
      {/* ── Hero band ──────────────────────────────────────────────────── */}
      <div className={styles.hero}>
        <div className={styles.heroEyebrow}>
          <UIcon name="check" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Flow Scoreboard · verified track record
        </div>
        <h1 className={styles.heroTitle}>Every pick, tracked. Every outcome, public.</h1>
        <p className={styles.heroSub}>
          Every Top Flow pick is saved the moment it&rsquo;s flagged and snapshotted daily
          until expiration — winners, losers, all of it. No cherry-picking, no deleted
          calls. This is the tape.
        </p>

        {isLoading && !data ? (
          <div className={styles.loading}>Loading the scoreboard…</div>
        ) : !hasData ? (
          <div className={styles.empty}>
            The tracker is warming up — picks need at least two daily snapshots before
            they&rsquo;re scored. Check back after the next market close.
            {data?.too_new > 0 && (
              <span className={styles.emptySub}> {data.too_new} picks are being tracked now.</span>
            )}
          </div>
        ) : (
          <div className={styles.statRow}>
            <div className={styles.statBlock}>
              <span className={styles.statValue}>{fmtPct(overall?.win_rate_25, { signed: false })}</span>
              <span className={styles.statLabel}>of picks hit +25% at peak</span>
            </div>
            <div className={styles.statBlock}>
              <span className={`${styles.statValue} ${gainCls(overall?.avg_max_gain ?? 0)}`}>
                {fmtPct(overall?.avg_max_gain)}
              </span>
              <span className={styles.statLabel}>average peak gain</span>
            </div>
            <div className={styles.statBlock}>
              <span className={styles.statValue}>{data.picks_tracked}</span>
              <span className={styles.statLabel}>
                picks scored{data.too_new > 0 ? ` · ${data.too_new} too new` : ''}
              </span>
            </div>
            <div className={styles.statBlock}>
              <span className={styles.statValue}>{fmtPct(overall?.oi_confirmed_rate, { signed: false })}</span>
              <span className={styles.statLabel}>OI-confirmed follow-through</span>
            </div>
          </div>
        )}
      </div>

      {hasData && (
        <>
          {/* ── Grade calibration ──────────────────────────────────────── */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>
                <UIcon name="patterns" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                Grade calibration — do A+ picks beat B?
              </span>
              <span className={styles.sectionMeta}>peak-gain outcomes by flag grade</span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Grade</th>
                    <th className={styles.num}>Picks</th>
                    <th className={styles.num}>Hit +25%</th>
                    <th className={styles.num}>Avg peak gain</th>
                    <th className={styles.num}>OI-confirmed</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.by_grade || []).map((row) => (
                    <tr key={row.grade} className={row.picks === 0 ? styles.rowDim : ''}>
                      <td><GradeChip grade={row.grade} /></td>
                      <td className={styles.num}>{row.picks}</td>
                      <td className={styles.num}>{fmtPct(row.win_rate_25, { signed: false })}</td>
                      <td className={`${styles.num} ${row.picks ? gainCls(row.avg_max_gain) : ''}`}>
                        {fmtPct(row.avg_max_gain)}
                      </td>
                      <td className={styles.num}>{fmtPct(row.oi_confirmed_rate, { signed: false })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Recent standouts ───────────────────────────────────────── */}
          {(data.recent_winners || []).length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>
                  <UIcon name="bolt" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                  Recent standouts
                </span>
                <span className={styles.sectionMeta}>best peak gains, picks from the last 45 days</span>
              </div>
              <div className={styles.cardGrid}>
                {data.recent_winners.map((w) => (
                  <div key={`${w.sym}-${w.strike}-${w.exp}-${w.dateSaved}`} className={styles.card}>
                    <div className={styles.cardTop}>
                      <TickerPopup sym={w.sym}>
                        <span className={styles.cardSym}>{w.sym}</span>
                      </TickerPopup>
                      <GradeChip grade={w.grade} />
                    </div>
                    <div className={styles.cardContract}>{contractLine(w)}</div>
                    <div className={`${styles.cardGain} ${gainCls(w.max_gain_pct)}`}>
                      {fmtPct(w.max_gain_pct)} <span className={styles.cardGainLabel}>peak</span>
                    </div>
                    <div className={styles.cardMeta}>
                      <span>flagged {w.dateSaved}</span>
                      <span>· {w.days_tracked}d tracked</span>
                    </div>
                    <OiBadge confirmed={w.oi_confirmed} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── The honest tape ────────────────────────────────────────── */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>
                <UIcon name="journal" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                Last {data.recent_picks?.length || 0} picks — the honest tape
              </span>
              <span className={styles.sectionMeta}>every recent pick, winners and losers alike</span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Pick</th>
                    <th>Grade</th>
                    <th className={styles.dateCol}>Flagged</th>
                    <th className={styles.num}>Entry</th>
                    <th className={styles.num}>Peak</th>
                    <th className={styles.num}>Now</th>
                    <th className={styles.num}>OI</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.recent_picks || []).map((p) => (
                    <tr key={`${p.sym}-${p.strike}-${p.exp}-${p.dateSaved}`}>
                      <td className={styles.pickCell}>
                        <TickerPopup sym={p.sym}>
                          <span className={styles.tapeSym}>{p.sym}</span>
                        </TickerPopup>
                        <span className={styles.tapeContract}> {contractLine(p)}</span>
                      </td>
                      <td><GradeChip grade={p.grade} /></td>
                      <td className={styles.dateCell}>{p.dateSaved}</td>
                      <td className={styles.num}>{fmtPrice(p.entry)}</td>
                      <td className={`${styles.num} ${gainCls(p.max_gain_pct)}`}>{fmtPct(p.max_gain_pct)}</td>
                      <td className={`${styles.num} ${styles.nowCell} ${gainCls(p.current_gain_pct)}`}>
                        {fmtPct(p.current_gain_pct)}
                      </td>
                      <td className={styles.num}>
                        {p.oi_confirmed
                          ? <span className={styles.oiTick} title="OI confirmed"><UIcon name="check" size={12} gold /></span>
                          : <span className={styles.oiDash}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ── Methodology footnote ─────────────────────────────────────────── */}
      {data?.methodology && (
        <div className={styles.methodology}>
          <div className={styles.methodTitle}>Methodology</div>
          <p className={styles.methodText}>{data.methodology}</p>
          {data.window && <p className={styles.windowNote}>{data.window}</p>}
          <p className={styles.disclaimer}>
            Informational only — not investment advice. Options involve substantial risk.
          </p>
        </div>
      )}
    </div>
  )
}

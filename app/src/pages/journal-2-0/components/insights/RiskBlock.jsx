/**
 * RiskBlock — the classical risk analytics (Journal P0, Task B1).
 *
 * The pro-sniff-test risk panel that mounts INSIDE the Risk & Exits section,
 * below the exit-quality content: an R-multiple distribution, peak-to-trough
 * drawdown, win/loss streaks, and one losing-streak-probability strip. Reads its
 * slice off `analytics.risk` (the backend `_risk_section`), no fetching.
 *
 * Design law — sentence → number → math: the block LEADS with the streak-odds
 * sentence, framed as reassurance ("that's variance, not failure"), THEN shows
 * the distribution, drawdown, and streaks with their numbers.
 *
 * Honest by construction:
 *   - Coverage-gated on decisive trades (its own gate) — under 10 decisive
 *     trades the backend returns Nones and this renders a designed "unlocks
 *     at N" state, never an empty chart.
 *   - null-R trades (no stop logged) are excluded from the histogram and
 *     surfaced as a footnote, never silently dropped.
 *   - The R histogram is plain CSS bars (the lightest existing idiom) — no
 *     ECharts, so the exit-quality section's chart count is untouched.
 *
 * NO emoji — every glyph is a <UIcon>.
 */

import UIcon from '../../../../components/ui/UIcon'
import ConfidenceStat from '../analytics/ConfidenceStat'
import { money, rMultiple } from '../../../../lib/journal-2-0'
import styles from './RiskBlock.module.css'

// Canonical confidence threshold = the backend's decisive-trade gate.
const CONF_MIN = 10

// Histogram bins whose R is >= 0 (green); everything else is a loss bin (red).
// Mirrors the backend `_R_HIST_BUCKETS` labels.
const POSITIVE_BINS = new Set(['0..1', '1..2', '2..3', '> 3'])

// Win rate as a whole percent for the ConfidenceStat cell.
const fmtPct0 = (v) => `${Math.round(v * 100)}%`

// A drawdown magnitude rendered as red-toned negative money ("$0.00" when flat).
const ddMoney = (v) => money(v > 0 ? -v : 0)

// "~9×/year" — whole number when >= 1, else 1 dp so a rare streak still reads.
const perYearText = (v) => {
  if (v == null || !Number.isFinite(v)) return '—'
  return v >= 1 ? String(Math.round(v)) : v.toFixed(1)
}

const currentStreakText = (cur) => {
  if (!cur || !cur.type || !cur.length) return '—'
  return `${cur.length} ${cur.type === 'win' ? 'W' : 'L'}`
}

export default function RiskBlock({ risk }) {
  const r = risk || {}
  const decisiveCount = r.decisiveCount || 0
  const noRCount = r.noRCount || 0

  // ── Gated: not enough decisive trades → honest "unlocks at N" state ─────────
  if (!r.coverageReady) {
    return (
      <div className={styles.block}>
        <Head />
        <div className={styles.empty}>
          <UIcon name="shield" size={24} className={styles.emptyGlyph} />
          <p className={styles.emptyText}>
            Risk analytics unlock at {CONF_MIN} decisive trades — enough of a sample
            for a drawdown, streak, and R distribution to mean something. So far{' '}
            <strong>{decisiveCount}</strong> logged.
          </p>
        </div>
      </div>
    )
  }

  const odds = r.lossStreakOdds || {}
  const streaks = r.streaks || {}
  const current = streaks.current || { type: null, length: 0 }
  const dd = r.drawdown || {}
  const hist = Array.isArray(r.rHistogram) ? r.rHistogram : []
  const maxCount = Math.max(1, ...hist.map((b) => b.count))
  const winPct = odds.winRate != null ? Math.round(odds.winRate * 100) : null

  return (
    <div className={styles.block}>
      <Head />

      {/* LAW: sentence → number → math. Reassurance, not alarm. */}
      <p className={styles.reassure}>
        At your <strong className={styles.pop}>{winPct}%</strong> win rate, a{' '}
        <strong className={styles.pop}>{odds.k}-loss streak</strong> is expected{' '}
        <strong className={styles.pop}>~{perYearText(odds.perYear)}×/year</strong> — that&rsquo;s
        variance, not failure.
      </p>

      {/* R-multiple distribution — plain CSS bars (lightest idiom, no ECharts) */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>R-multiple distribution</div>
        <div className={styles.hist} role="img" aria-label="R-multiple distribution">
          {hist.map((b) => {
            const isGain = POSITIVE_BINS.has(b.bin)
            return (
              <div key={b.bin} className={styles.histCol}>
                <span className={styles.histCount}>{b.count}</span>
                <div className={styles.histBarWrap}>
                  <div
                    className={`${styles.histBar} ${isGain ? styles.barGain : styles.barLoss}`}
                    style={{ height: `${(b.count / maxCount) * 100}%` }}
                  />
                </div>
                <span className={styles.histLabel}>{b.bin}</span>
              </div>
            )
          })}
        </div>
        <div className={styles.expectancy}>
          Expectancy <span className={styles.expNum}>{rMultiple(r.expectancyR)}</span> per trade
        </div>
      </div>

      {/* Drawdown pair — red-toned money */}
      <div className={styles.ddRow}>
        <div className={styles.ddBlock}>
          <span className={styles.ddValue}>{ddMoney(dd.maxDrawdownDollar)}</span>
          <span className={styles.statLabel}>Max drawdown · peak to trough</span>
        </div>
        <div className={styles.ddBlock}>
          <span className={styles.ddValueSecondary}>{ddMoney(dd.currentDrawdownDollar)}</span>
          <span className={styles.statLabel}>Current drawdown</span>
        </div>
      </div>

      {/* Streak stats — a rate goes through ConfidenceStat; runs are counts */}
      <div className={styles.streakRow}>
        <div className={styles.streakStat}>
          <ConfidenceStat
            value={odds.winRate}
            n={decisiveCount}
            min={CONF_MIN}
            format={fmtPct0}
            label="Win rate"
          />
        </div>
        <StatTile label="Longest win streak" value={String(streaks.longestWin ?? 0)} />
        <StatTile label="Longest loss streak" value={String(streaks.longestLoss ?? 0)} />
        <StatTile label="Current streak" value={currentStreakText(current)} />
      </div>

      {noRCount > 0 && (
        <p className={styles.footnote}>
          {noRCount} trade{noRCount === 1 ? '' : 's'} have no stop logged — no R computed
          (excluded from the distribution above).
        </p>
      )}
    </div>
  )
}

function Head() {
  return (
    <div className={styles.head}>
      <h4 className={styles.title}>Risk &amp; drawdown</h4>
      <span className={styles.sub}>R distribution · drawdown · streaks</span>
    </div>
  )
}

function StatTile({ label, value }) {
  return (
    <div className={styles.streakStat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  )
}

/**
 * VerdictScorecard — the Insights → Coach section (P6-3).
 *
 * "Did you listen to Compass?" Scores Compass's pre-trade GO / HOLD / SKIP
 * verdicts against how the trades actually played out, read from the P6-2
 * `/accounts/{id}/verdict-scorecard` aggregate (Scope-aware via
 * `useVerdictScorecard`). Three rows:
 *   - GO / HOLD  → the `taken` bucket (you took the trade Compass green/amber-lit)
 *   - SKIP       → the `overridden` bucket (you took it ANYWAY) + a muted
 *                  "obeyed N× (didn't take it)" note for the SKIPs you honored
 * Each row surfaces win rate through `<ConfidenceStat>` (grays any bucket on
 * fewer than 10 decisive trades — the canonical confidence threshold), plus n /
 * avg-R / net P&L.
 *
 * A red-toned HEADLINE leads when the trader overrode a SKIP and it cost them.
 * A coverage footnote states how many closed trades actually carry a verdict.
 * A fresh account (no verdicts yet) gets an honest pitch card — never a fake 0%.
 *
 * Reads its slice off the endpoint via the hook, no other fetching. NO emoji:
 * every glyph is a `<UIcon>`.
 */

import UIcon from '../../../../components/ui/UIcon'
import ConfidenceStat from '../analytics/ConfidenceStat'
import useVerdictScorecard from '../../hooks/useVerdictScorecard'
import styles from './VerdictScorecard.module.css'

const CONF_MIN = 10

// Closed vocabulary + color, matching the app's GO/HOLD/SKIP verdict semantics.
// green = Compass cleared it · amber = proceed with caution · red = it said no.
const VERDICT_META = {
  GO: { color: '#3cb868', note: 'Compass cleared it' },
  HOLD: { color: '#e0a83a', note: 'Compass said wait' },
  SKIP: { color: '#e74c3c', note: 'Compass said no — you took it anyway' },
}

// Match the sibling insights sections' formatters so units read consistently.
const fmtPct = (v) => `${(v * 100).toFixed(0)}%`
const fmtR = (v) => (v === 0 ? '0R' : `${v > 0 ? '+' : ''}${v.toFixed(2)}R`)
const fmtDollar = (v) => {
  if (v === 0) return '$0'
  return `${v > 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`
}

// GO/HOLD carry `taken`; SKIP carries `overridden` ("took it anyway").
function bucketFor(row) {
  return (row.label === 'SKIP' ? row.overridden : row.taken) || {}
}

export default function VerdictScorecard({ accountId, apiParams }) {
  const { data, isLoading, error, allAccounts } = useVerdictScorecard(accountId, apiParams)

  // ── Non-scorecard states — never a bare blank ─────────────────────────────
  if (allAccounts) {
    return (
      <Note
        icon="scale"
        text="Select a single account to see how Compass's verdicts played out. The scorecard is built per account so its win rates and P&L stay honest."
      />
    )
  }
  if (error) {
    return <Note icon="warning" text="Couldn't load your verdict scorecard right now. Refresh to try again." />
  }
  if (isLoading && !data) {
    return <Note icon="chart" text="Loading your verdict scorecard…" />
  }
  if (!data) {
    return <Note icon="scale" text="No verdict data yet." />
  }

  const byVerdict = Array.isArray(data.byVerdict) ? data.byVerdict : []
  const coverage = data.coverage || {}
  const tradesWithVerdict = coverage.tradesWithVerdict || 0
  const tradesTotal = coverage.tradesTotal || 0
  const headline = data.skipOverrideHeadline || null

  // Fresh account — no trade was ever entered after a Compass verdict. Pitch the
  // feature, NEVER a fake 0% scorecard.
  if (tradesWithVerdict === 0) {
    return (
      <div className={styles.pitch}>
        <UIcon name="scale" size={26} className={styles.pitchGlyph} />
        <h4 className={styles.pitchTitle}>See if you listen to Compass</h4>
        <p className={styles.pitchText}>
          Run a pre-trade verdict on Add Position and this scorecard comes alive —
          it tracks how your GO, HOLD, and SKIP calls actually played out, and
          catches the SKIPs you overrode and lost on.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h4 className={styles.title}>Did you listen to Compass?</h4>
        <p className={styles.sub}>
          How Compass's pre-trade GO / HOLD / SKIP verdicts actually played out.
          Buckets on fewer than {CONF_MIN} decisive trades are grayed — they're
          estimates, not a verdict on the verdict yet.
        </p>
      </div>

      {headline && (
        <div className={styles.headline} role="note">
          <UIcon name="warning" size={16} className={styles.headlineGlyph} />
          <span className={styles.headlineText}>
            You overrode Compass's SKIP {headline.n} time{headline.n === 1 ? '' : 's'} — and
            lost {headline.losses || 0} of the {headline.decisive || 0} you took to a decision ({fmtDollar(headline.netPnl || 0)}).
          </span>
        </div>
      )}

      <div className={styles.rows}>
        {byVerdict.map((row) => (
          <VerdictRow key={row.label} row={row} />
        ))}
      </div>

      <p className={styles.footnote}>
        Scored from {tradesWithVerdict} of {tradesTotal} closed trade
        {tradesTotal === 1 ? '' : 's'} — only trades entered after checking with
        Compass carry a verdict.
      </p>
    </div>
  )
}

function VerdictRow({ row }) {
  const meta = VERDICT_META[row.label] || { color: 'var(--text-muted)', note: '' }
  const b = bucketFor(row)
  const n = b.n || 0
  const confident = n >= CONF_MIN
  const wr = typeof b.winRate === 'number' ? b.winRate : null
  // Bar length tracks win rate (0..1). A null win rate (no decided trades) →
  // empty bar; ConfidenceStat renders the honest "—" beside it.
  const pct = wr === null ? 0 : Math.max(0, Math.min(1, wr))
  const isSkip = row.label === 'SKIP'

  return (
    <div className={styles.row}>
      <div className={styles.rowTop}>
        <div className={styles.rowLabel}>
          <span className={styles.dot} style={{ background: meta.color }} />
          <span className={styles.name}>{row.label}</span>
        </div>

        <div className={styles.barTrack}>
          <div
            className={`${styles.barFill} ${confident ? '' : styles.barDim}`}
            style={{ width: `${pct * 100}%`, background: meta.color }}
          />
        </div>

        <div className={styles.rowStat}>
          <ConfidenceStat value={wr} n={n} min={CONF_MIN} format={fmtPct} label="Win Rate" />
        </div>
      </div>

      <div className={styles.rowSecondary}>
        <span className={styles.count}>
          {n} trade{n === 1 ? '' : 's'}
        </span>
        <span className={styles.secStat}>Avg R {b.avgR != null ? fmtR(b.avgR) : '—'}</span>
        <span className={styles.secStat}>
          Net P&amp;L {b.netPnl != null ? fmtDollar(b.netPnl) : '—'}
        </span>
        {isSkip && (row.obeyed || 0) > 0 && (
          <span className={styles.obeyed}>
            obeyed {row.obeyed}× (didn't take it)
          </span>
        )}
      </div>
    </div>
  )
}

function Note({ icon, text }) {
  return (
    <div className={styles.note}>
      <UIcon name={icon} size={24} className={styles.noteGlyph} />
      <p className={styles.noteText}>{text}</p>
    </div>
  )
}

import useOwnership from '../../hooks/useOwnership'
import styles from './OwnershipPanel.module.css'
import { formatCompact } from '../../lib/presentation/presentationPrimitives'

// TERM-066: the K/M/B/T decision lives in lib/presentation (formatCompact), on the ladders
// these columns already used. Values no row carries differ: shares under 1M print rounded,
// a holding under $1M prints whole dollars instead of "$0M", a non-number is an em dash.
const SHARES_TIERS = [{ at: 1e9, suffix: 'B', decimals: 2 }, { at: 1e6, suffix: 'M', decimals: 1 }]
const VALUE_TIERS = [
  { at: 1e12, suffix: 'T', decimals: 1 },
  { at: 1e9, suffix: 'B', decimals: 1 },
  { at: 1e6, suffix: 'M', decimals: 0 },
]
const fmtShares = v => v == null ? '—' : formatCompact(v, { tiers: SHARES_TIERS })
const fmtVal = v => v == null ? '—' : formatCompact(v, { tiers: VALUE_TIERS, prefix: '$' })
const CHIP = { new: 'NEW', added: '+ADD', reduced: '−CUT', sold_out: 'SOLD' }
const chipClass = c => (c === 'new' || c === 'added') ? styles.chipUp : (c === 'reduced' || c === 'sold_out') ? styles.chipDown : styles.chipFlat

function DeltaChip({ change }) {
  if (!change || change === 'flat') return null
  return <span className={`${styles.chip} ${chipClass(change)}`}>{CHIP[change]}</span>
}

// Raw machine output must not leak to users:
// - Reported institutional % can exceed 100 (derivatives/short double-counting)
//   → clamp the display and say why.
// - as_of arrives as "2026-03-31 00:00:00" → render "Mar 31, 2026".
function fmtInstPct(v) {
  if (v == null) return null
  return v > 100 ? '>100% (incl. derivatives)' : `${v}%`
}

function fmtAsOf(s) {
  if (!s) return null
  const d = new Date(String(s).slice(0, 10) + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return String(s)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function OwnershipPanel({ sym }) {
  const { data, error, mutate } = useOwnership(sym)
  if (!sym) return <div className={styles.hint}>Pick a ticker.</div>
  // A refusal is not a slow load — see the note in `hooks/useOwnership.js`.
  // Without this branch a free member on Morning Wire sees "Loading NVDA…" forever.
  if (data?.locked) {
    return <div className={styles.hint}>Institutional ownership is part of a paid plan.</div>
  }
  // TERM-033: a failed read with no earlier answer. Not "Loading" forever, and not "no
  // ownership data" (that is a claim about the company).
  if (!data && error) {
    return (
      <div className={styles.hint} role="alert">
        Could not load ownership for {sym}.{' '}
        <button type="button" className={styles.retry} onClick={() => mutate()}>Retry</button>
      </div>
    )
  }
  if (!data) return <div className={styles.hint}>Loading {sym}…</div>
  if (!data.top_holders?.length && data.inst_pct == null) return <div className={styles.hint}>No ownership data for {sym}.</div>
  const hasFlow = data.biggest_buyers?.length || data.biggest_sellers?.length
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        {data.inst_pct != null && <span><b>{fmtInstPct(data.inst_pct)}</b> <span className={styles.muted}>institutional</span></span>}
        {data.as_of && <span className={styles.muted}>as of {fmtAsOf(data.as_of)}</span>}
      </div>
      <div className={styles.sectionLabel}>Top holders</div>
      <table className={styles.tbl} aria-label={`Top holders of ${sym}`}><tbody>
        {data.top_holders.map((h, i) => (
          <tr key={i}>
            <td className={styles.holder}>{h.holder}</td>
            <td>{fmtShares(h.shares)}</td>
            <td className={styles.muted}>{h.pct_out != null ? `${h.pct_out}%` : ''}</td>
            <td className={styles.muted}>{fmtVal(h.value)}</td>
            <td><DeltaChip change={h.change} /></td>
          </tr>
        ))}
      </tbody></table>
      {hasFlow ? (
        <div className={styles.flow}>
          {data.biggest_buyers?.length > 0 && (
            <div className={styles.flowCol}>
              <div className={styles.sectionLabel}>Biggest buyers</div>
              {data.biggest_buyers.map((b, i) => (
                <div key={i} className={styles.flowRow}><span className={styles.holder}>{b.holder}</span><span className={styles.pos}>+{fmtShares(b.change_shares)}</span></div>
              ))}
            </div>
          )}
          {data.biggest_sellers?.length > 0 && (
            <div className={styles.flowCol}>
              <div className={styles.sectionLabel}>Biggest sellers</div>
              {data.biggest_sellers.map((s, i) => (
                <div key={i} className={styles.flowRow}><span className={styles.holder}>{s.holder}</span><span className={styles.neg}>{fmtShares(s.change_shares)}</span></div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

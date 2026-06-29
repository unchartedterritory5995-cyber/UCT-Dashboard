import useOwnership from '../../hooks/useOwnership'
import styles from './OwnershipPanel.module.css'

const fmtShares = v => v == null ? '—' : Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${v}`
const fmtVal = v => v == null ? '—' : v >= 1e12 ? `$${(v / 1e12).toFixed(1)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`
const CHIP = { new: 'NEW', added: '+ADD', reduced: '−CUT', sold_out: 'SOLD' }
const chipClass = c => (c === 'new' || c === 'added') ? styles.chipUp : (c === 'reduced' || c === 'sold_out') ? styles.chipDown : styles.chipFlat

function DeltaChip({ change }) {
  if (!change || change === 'flat') return null
  return <span className={`${styles.chip} ${chipClass(change)}`}>{CHIP[change]}</span>
}

export default function OwnershipPanel({ sym }) {
  const { data } = useOwnership(sym)
  if (!sym) return <div className={styles.hint}>Pick a ticker.</div>
  if (!data) return <div className={styles.hint}>Loading {sym}…</div>
  if (!data.top_holders?.length && data.inst_pct == null) return <div className={styles.hint}>No ownership data for {sym}.</div>
  const hasFlow = data.biggest_buyers?.length || data.biggest_sellers?.length
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        {data.inst_pct != null && <span><b>{data.inst_pct}%</b> <span className={styles.muted}>institutional</span></span>}
        {data.as_of && <span className={styles.muted}>as of {data.as_of}</span>}
      </div>
      <div className={styles.sectionLabel}>Top holders</div>
      <table className={styles.tbl}><tbody>
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

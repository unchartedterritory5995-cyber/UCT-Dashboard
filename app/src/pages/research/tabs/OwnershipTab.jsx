import useOwnership from '../hooks/useOwnership'
import styles from '../ResearchPage.module.css'

function fmtShares(v) {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return `${v}`
}
function fmtMoney(v) {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${v.toFixed(0)}`
}
function fmtPct(v) { return v == null ? '—' : `${v}%` }

export default function OwnershipTab({ sym }) {
  const { data, isLoading } = useOwnership(sym)

  if (isLoading) {
    return <div className={styles.soon}><div className={styles.soonInner}><div className={styles.soonSub}>Loading ownership…</div></div></div>
  }

  const o = data || {}
  const inst = o.institutional || {}
  const sh = o.short || {}
  const insider = o.insider || []
  const empty = !(inst.holders?.length) && !insider.length && sh.shares_short == null && inst.pct_held == null

  return (
    <div className={styles.finWrap}>
      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.ct}>Institutional ownership</div>
          <div className={styles.kv}><span>% held by institutions</span><b>{fmtPct(inst.pct_held)}</b></div>
          {!!inst.holders?.length && (
            <div className={`${styles.gridScroll} ${styles.ownHolders}`}>
              <table className={styles.fgrid}>
                <thead><tr><th>Holder</th><th>Shares</th><th>% Out</th><th>Value</th></tr></thead>
                <tbody>
                  {inst.holders.map((h, i) => (
                    <tr key={`${h.holder}-${i}`}>
                      <td className={`${styles.fperiod} ${styles.holderName}`}>{h.holder}</td>
                      <td>{fmtShares(h.shares)}</td>
                      <td>{fmtPct(h.pct_out)}</td>
                      <td>{fmtMoney(h.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.card}>
          <div className={styles.ct}>Short interest</div>
          <div className={styles.kv}><span>Short % of float</span><b>{fmtPct(sh.short_pct_float)}</b></div>
          <div className={styles.kv}><span>Days to cover</span><b>{sh.days_to_cover ?? '—'}</b></div>
          <div className={styles.kv}><span>Shares short</span><b>{fmtShares(sh.shares_short)}</b></div>
          <div className={styles.kv}><span>Float</span><b>{fmtShares(sh.float_shares)}</b></div>
          <div className={styles.kv}><span>Shares outstanding</span><b>{fmtShares(sh.shares_outstanding)}</b></div>
        </section>
      </div>

      {!!insider.length && (
        <section className={styles.card}>
          <div className={styles.ct}>Insider activity (recent)</div>
          <div className={styles.rclist}>
            {insider.map((t, i) => (
              <div key={`${t.date}-${t.name}-${i}`} className={styles.insrow}>
                <span className={styles.rcdate}>{t.date}</span>
                <span className={styles.rcfirm}>{t.name}{t.title ? ` · ${t.title}` : ''}</span>
                <span className={t.type === 'buy' ? styles.up : styles.down}>{t.type}</span>
                <span>{fmtShares(t.shares)}</span>
                <span className={styles.muted}>{fmtMoney(t.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {empty && <div className={styles.fnote}>Ownership data is unavailable for this ticker.</div>}
    </div>
  )
}

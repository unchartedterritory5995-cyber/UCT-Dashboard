import useFilings from '../../../hooks/useFilings'
import styles from '../ResearchPage.module.css'

export default function FilingsTab({ sym }) {
  const { data, isLoading } = useFilings(sym)
  const filings = data?.filings || []

  return (
    <div className={styles.finWrap}>
      <section className={styles.card}>
        <div className={styles.ct}>SEC filings (EDGAR)</div>
        {isLoading && !filings.length && <div className={styles.fnote}>Loading filings…</div>}
        {!!filings.length && (
          <div className={styles.rclist}>
            {filings.map((f, i) => (
              <div key={`${f.form}-${f.filed}-${i}`} className={styles.filingRow}>
                <span className={styles.filingForm}>{f.form || '—'}</span>
                <span className={styles.rcdate}>{f.filed || ''}</span>
                {f.url
                  ? <a className={styles.filingLink} href={f.url} target="_blank" rel="noopener noreferrer">View →</a>
                  : <span className={styles.muted}>—</span>}
              </div>
            ))}
          </div>
        )}
        {!isLoading && !filings.length && <div className={styles.fnote}>No SEC filings found for this ticker.</div>}
      </section>
    </div>
  )
}

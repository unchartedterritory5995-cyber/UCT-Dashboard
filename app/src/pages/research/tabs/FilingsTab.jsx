import useFilings from '../../../hooks/useFilings'
import styles from '../ResearchPage.module.css'

export default function FilingsTab({ sym }) {
  const { data, isLoading } = useFilings(sym)
  const filings = data?.filings || []

  return (
    <div className={styles.finWrap}>
      {data?.entity && data.entity.status !== 'resolved' && (
        <div className={styles.muted} style={{ fontSize: 11 }} data-testid="entity-unresolved-note">
          Symbol not yet linked to a canonical identity ({data.entity.status}).
        </div>
      )}

      <section className={styles.card}>
        <div className={styles.ct}>SEC filings (EDGAR)</div>
        {isLoading && !filings.length && <div className={styles.fnote}>Loading filings…</div>}
        {!!filings.length && (
          <div className={styles.rclist}>
            {filings.map((f, i) => (
              <div key={`${f.form}-${f.filed}-${i}`} className={styles.filingRow}>
                <span className={styles.filingForm}>{f.form || '—'}</span>
                <span className={styles.rcdate}>{f.filed || ''}</span>
                {f.period && <span className={styles.muted}>for {f.period}</span>}
                {f.accession && <span className={styles.muted} style={{ fontSize: 10 }}>{f.accession}</span>}
                {f.url
                  ? <a className={styles.filingLink} href={f.url} target="_blank" rel="noopener noreferrer">View →</a>
                  : <span className={styles.muted}>—</span>}
              </div>
            ))}
          </div>
        )}
        {!isLoading && !filings.length && <div className={styles.fnote}>No SEC filings found for this ticker.</div>}
        {/* Non-D1, deliberately: EDGAR filings are documents, not a
            quote-shaped feed -- no fabricated freshness class (mirrors the
            S7 document_arrival trigger's own freshness_class=None choice
            for this identical data). An honest source + lag disclosure,
            not a Provenance/FreshnessBadge component. */}
        <div className={styles.muted} style={{ fontSize: 11, marginTop: 6 }}>
          Source: SEC EDGAR{filings[0]?.filed ? ` · newest filing shown: ${filings[0].filed}` : ''} · results may lag up to 30 min behind EDGAR.
        </div>
      </section>
    </div>
  )
}

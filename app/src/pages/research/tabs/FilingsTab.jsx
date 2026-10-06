import useFilings from '../../../hooks/useFilings'
import ResearchLoading from '../ResearchLoading'
import styles from '../ResearchPage.module.css'

export default function FilingsTab({ sym }) {
  const { data, error, isLoading, mutate } = useFilings(sym)
  const filings = data?.filings || []
  // A failed read (an SEC outage answered as 200 {error}, a 5xx, a dropped
  // connection) is NOT an empty filing list -- see useFilings.js.
  const unavailable = error?.kind === 'unavailable'
  const noFiler = error?.kind === 'no_filer'

  return (
    <div className={styles.finWrap}>
      {data?.entity && data.entity.status !== 'resolved' && (
        <div className={styles.entityNote} data-testid="entity-unresolved-note">
          This symbol is not yet linked to a company record, so some sources below may not match it.
        </div>
      )}

      <section className={styles.card}>
        <div className={styles.ct}>SEC filings (EDGAR)</div>
        {isLoading && !filings.length && <ResearchLoading label="Loading filings" />}
        {!!filings.length && (
          <div className={styles.rclist}>
            {filings.map((f, i) => (
              <div key={`${f.form}-${f.filed}-${i}`} className={styles.filingRow} data-panel-row>
                <span className={styles.filingForm}>{f.form || '—'}</span>
                <span className={styles.rcdate}>{f.filed || ''}</span>
                {f.period && <span className={styles.muted}>for {f.period}</span>}
                {f.accession && <span className={styles.accession}>{f.accession}</span>}
                {f.url
                  ? <a className={styles.filingLink} href={f.url} target="_blank" rel="noopener noreferrer">View →</a>
                  : <span className={styles.muted}>—</span>}
              </div>
            ))}
          </div>
        )}
        {!isLoading && unavailable && (
          <div className={styles.fnote} data-testid="filings-unavailable">
            SEC EDGAR couldn&rsquo;t be read right now &mdash; this is not a statement about the company.{' '}
            <button type="button" className={styles.basisBtn} onClick={() => mutate()}>Retry</button>
          </div>
        )}
        {!isLoading && noFiler && (
          <div className={styles.fnote} data-testid="filings-no-filer">No SEC filer matched this ticker.</div>
        )}
        {!isLoading && !error && !filings.length && <div className={styles.fnote}>No SEC filings found for this ticker.</div>}
        {/* Non-D1, deliberately: EDGAR filings are documents, not a
            quote-shaped feed -- no fabricated freshness class (mirrors the
            S7 document_arrival trigger's own freshness_class=None choice
            for this identical data). An honest source + lag disclosure,
            not a Provenance/FreshnessBadge component. */}
        <div className={styles.srcNote}>
          Source: SEC EDGAR{filings[0]?.filed ? ` · newest filing shown: ${filings[0].filed}` : ''} · results may lag up to 30 min behind EDGAR.
        </div>
      </section>
    </div>
  )
}

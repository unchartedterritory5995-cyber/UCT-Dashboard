import { Link } from 'react-router-dom'
import useModelBookAppearances from '../hooks/useModelBookAppearances'
import { formatPercent } from '../../../lib/presentation/presentationPrimitives'
import ResearchLoading from '../ResearchLoading'
import styles from '../ResearchPage.module.css'

// Packet H CP1 -- the "has this ticker ever been in the Model Book" tab.
// Signed by the owner 2026-09-22 (fingerprint f119617df).
//
// ⛔ THE LINK TARGET IS THE BARE `/model-book` PAGE, NOT A DEEP LINK.
// Checked directly: `ModelBook.jsx` reads no `year`/`symbol` query or route
// param anywhere (year/stock selection is internal component state, driven
// by clicking year tabs), and `App.jsx` registers `/model-book` with no
// params either. This packet's own scope explicitly excludes "any change
// to Model Book's own pages" -- adding deep-link support there would be
// exactly that, so this tab links to the page as it actually exists today
// rather than to a URL shape that would silently do nothing.
export default function ModelBookTab({ sym }) {
  const { data, isLoading, error, paywalled, mutate } = useModelBookAppearances(sym)

  if (isLoading) {
    return <ResearchLoading label="Loading Model Book history" />
  }

  // TERM-088 -- a failed read is not "never in the Model Book". Render the
  // error distinctly so a backend hiccup never reads as a genuine absence.
  if (paywalled) {
    return <div className={styles.fnote} data-testid="modelbook-appearances-paywalled">Model Book history requires a paid plan.</div>
  }
  if (error) {
    return (
      <div className={styles.fnote} data-testid="modelbook-appearances-error">
        Couldn't load Model Book history for this ticker.
        {' '}
        <button type="button" className={styles.basisBtn} onClick={() => mutate()}>Retry</button>
      </div>
    )
  }

  const appearances = (data && data.appearances) || []

  return (
    <div className={styles.finWrap}>
      {!!appearances.length && (
        <section className={styles.card}>
          <div className={styles.ct}>Model Book appearances</div>
          <ul className={styles.newsList} data-testid="modelbook-appearances-list">
            {appearances.map((a) => (
              <li key={a.id} className={styles.newsItem}>
                <div className={styles.rowBody}>
                  <div className={styles.rowHead}>
                    <span className={styles.gold}>{a.year}</span>
                    {typeof a.gain_pct === 'number' && (
                      <span className={a.gain_pct >= 0 ? styles.up : styles.down}>
                        {formatPercent(a.gain_pct, { decimals: 1, signed: true })}
                      </span>
                    )}
                    {a.setup_count > 0 && (
                      <span className={styles.muted}>{a.setup_count} setup{a.setup_count > 1 ? 's' : ''}</span>
                    )}
                  </div>
                  {a.thesis ? <p className={styles.rowNote}>{a.thesis}</p> : null}
                </div>
              </li>
            ))}
          </ul>
          <Link to="/model-book" className={`${styles.returnLink} ${styles.cardLink}`}>
            Open the Model Book &rarr;
          </Link>
        </section>
      )}

      {!appearances.length && (
        <div className={styles.fnote} data-testid="modelbook-appearances-empty">
          Not yet in the Model Book.
        </div>
      )}
    </div>
  )
}

import { Link } from 'react-router-dom'
import useModelBookAppearances from '../hooks/useModelBookAppearances'
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
  const { data, isLoading } = useModelBookAppearances(sym)

  if (isLoading) {
    return <div className={styles.soon}><div className={styles.soonInner}><div className={styles.soonSub}>Loading Model Book history…</div></div></div>
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
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={styles.gold}>{a.year}</span>
                    {typeof a.gain_pct === 'number' && (
                      <span className={a.gain_pct >= 0 ? styles.up : styles.down}>
                        {a.gain_pct >= 0 ? '+' : ''}{a.gain_pct.toFixed(1)}%
                      </span>
                    )}
                    {a.setup_count > 0 && (
                      <span className={styles.muted}>{a.setup_count} setup{a.setup_count > 1 ? 's' : ''}</span>
                    )}
                  </div>
                  {a.thesis ? <p className={styles.fnote} style={{ padding: '4px 0 0' }}>{a.thesis}</p> : null}
                </div>
              </li>
            ))}
          </ul>
          <Link to="/model-book" className={styles.returnLink} style={{ display: 'inline-block', marginTop: 6 }}>
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

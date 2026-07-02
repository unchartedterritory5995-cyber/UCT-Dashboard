/** RH-style About section — company blurb + sector/industry chips. */
import { useState } from 'react'
import styles from './PositionDetailPage.module.css'

export default function AboutSection({ about, sector, industry }) {
  const [expanded, setExpanded] = useState(false)
  if (!about) return null
  return (
    <section className={styles.section} aria-label="About">
      <h2 className={styles.sectionTitle}>About</h2>
      {(sector || industry) && (
        <div className={styles.chipRow}>
          {sector && <span className={styles.chip}>{sector}</span>}
          {industry && <span className={styles.chip}>{industry}</span>}
        </div>
      )}
      <p className={expanded ? styles.about : styles.aboutClamped}>{about}</p>
      <button
        type="button"
        className={styles.showMore}
        onClick={() => setExpanded((x) => !x)}
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </section>
  )
}

import styles from '../ResearchPage.module.css'

export default function ComingSoonTab({ name }) {
  return (
    <div className={styles.soon}>
      <div className={styles.soonInner}>
        <div className={styles.soonGlyph}>⌁</div>
        <div className={styles.soonTitle}>{name} — coming soon</div>
        <div className={styles.soonSub}>This tab lands in an upcoming phase of the research hub.</div>
      </div>
    </div>
  )
}

/**
 * TERM-039 — "Here today / Working on", on the Support page.
 *
 * Every line is the server's: the capability names come from `docs/feature_flags.json`
 * and the states from the per-request auth payload (see `featureStatus.js`). So flipping
 * a flag changes this strip on the member's next authenticated request with no content
 * edit, and a capability that is off is simply not here.
 *
 * ⛔ "Working on" is what is on EARLY for this account (the same state as the Beta mark),
 * never a list of dark features — announcing an unreleased surface is a decision nobody
 * has taken, and with one paid tier it would read as a tier preview (CARD 17).
 *
 * ⛔ "Not available" and "nothing here" are different sentences. When the server did not
 * measure feature status the strip says so, and says that it does not mean anything is off.
 */
import { useContext, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'
import UIcon from '../ui/UIcon'
import { FEATURE_STATUS_ANCHOR, stripView } from './featureStatus'
import styles from './FeatureStatus.module.css'

function FeatureList({ items, beta }) {
  return (
    <ul className={styles.list}>
      {items.map((f) => (
        <li key={f.id} className={styles.item}>
          <span>{f.label}</span>
          <span className={styles.where}>{f.where}</span>
          {beta && <span className={styles.betaPill}>Beta</span>}
        </li>
      ))}
    </ul>
  )
}

export default function FeatureStatusStrip() {
  const ctx = useContext(AuthContext)
  const view = stripView(ctx?.featureStatus)
  const { hash } = useLocation()
  const ref = useRef(null)

  // The Beta mark links here; bring the strip into view when it is the target.
  useEffect(() => {
    if (hash === `#${FEATURE_STATUS_ANCHOR}`) ref.current?.scrollIntoView?.({ block: 'start' })
  }, [hash])

  return (
    <section
      ref={ref}
      id={FEATURE_STATUS_ANCHOR}
      className={styles.strip}
      aria-labelledby="feature-status-title"
      data-testid="feature-status"
    >
      <h2 id="feature-status-title" className={styles.title}>
        <UIcon name="info" size={14} />
        What is here
      </h2>
      {!view.measured ? (
        <p role="status" className={styles.status} data-testid="feature-status-unmeasured">
          Feature status is not available right now. That does not mean anything is switched off.
        </p>
      ) : (
        <>
          <div className={styles.columns}>
            <div className={styles.column} data-testid="feature-status-here">
              <h3 className={styles.columnTitle}>Here today</h3>
              {view.released.length > 0
                ? <FeatureList items={view.released} />
                : <p className={styles.empty}>Nothing is listed here yet.</p>}
            </div>
            <div className={styles.column} data-testid="feature-status-working">
              <h3 className={styles.columnTitle}>Working on</h3>
              {view.preview.length > 0 ? (
                <>
                  <p className={styles.columnNote}>
                    Turned on early for your account. These may still change.
                  </p>
                  <FeatureList items={view.preview} beta />
                </>
              ) : (
                <p className={styles.empty}>Nothing is in early access for your account right now.</p>
              )}
            </div>
          </div>
          {view.unknown.length > 0 && (
            <p className={styles.unknown} data-testid="feature-status-unknown">
              Status not measured: {view.unknown.map((f) => f.label).join(', ')}.
            </p>
          )}
        </>
      )}
    </section>
  )
}

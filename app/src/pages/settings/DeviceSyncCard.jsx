// TERM-076 (FB-A12-02) — "What syncs across your devices", published to members.
//
// ⛔ NO ROW IN THIS FILE IS TYPED. Every list item comes from `persistenceManifest.json` via
// `deviceSyncMatrix`, and the manifest's store/scope columns are derived from the code by
// `tools/persistence_census.mjs`. `DeviceSyncCard.test.jsx` compares the rendered rows to the
// manifest as an exact set per list, so a hand-written <li> here goes red. To change what this
// card says about a setting, change where the code saves it — or its label in the manifest.
import TileCard from '../../components/TileCard'
import { deviceSyncMatrix } from '../../lib/persistence/deviceSync'
import styles from './DeviceSyncCard.module.css'

function SurfaceList({ groups, testId, heading, lede }) {
  return (
    <section className={styles.block} data-testid={testId}>
      <h3 className={styles.heading}>{heading}</h3>
      <p className={styles.lede}>{lede}</p>
      {groups.map((g) => (
        <div key={g.surface} className={styles.surface}>
          <span className={styles.surfaceName}>{g.surface}</span>
          <ul className={styles.items}>
            {g.items.map((it) => (
              <li key={it.id} className={styles.item} data-persist-id={it.id}>
                {it.label}
                {it.store === 'sessionStorage' && <span className={styles.tabOnly}> (this tab only)</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

export default function DeviceSyncCard({ manifest }) {
  const m = manifest ? deviceSyncMatrix(manifest) : deviceSyncMatrix()
  return (
    <TileCard icon="refresh" title="What Syncs Across Your Devices">
      <div className={styles.card}>
        <p className={styles.intro}>
          Your watchlists, journal, notes and alerts are stored in your account. The settings and
          layouts below are saved in one of two places. This list is generated from the code that
          saves each one, so it changes whenever that does.
        </p>
        <SurfaceList
          groups={m.crossDevice}
          testId="sync-cross-device"
          heading="Follows your account"
          lede="Saved to your account. You get these on any device you sign in on."
        />
        <SurfaceList
          groups={m.deviceLocal}
          testId="sync-device-local"
          heading="Stays in this browser"
          lede="Saved only in this browser on this device. Another device or browser starts from its own copy, and clearing this browser's site data resets these."
        />
        <p className={styles.background} data-testid="sync-background">
          This browser also keeps {m.background} caches and diagnostic switches. They only make
          things load faster or control feature rollouts, and clearing them loses nothing you made.
        </p>
      </div>
    </TileCard>
  )
}

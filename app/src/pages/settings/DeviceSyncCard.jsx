// TERM-076 (FB-A12-02) — "What syncs across your devices", published to members.
//
// ⛔ NO ROW IN THIS FILE IS TYPED. Every list item comes from `persistenceManifest.json` via
// `deviceSyncMatrix`, and the manifest's store/scope columns are derived from the code by
// `tools/persistence_census.mjs`. `DeviceSyncCard.test.jsx` compares the rendered rows to the
// manifest as an exact set per list, so a hand-written <li> here goes red. To change what this
// card says about a setting, change where the code saves it — or its label in the manifest.
//
// TERM-052 (FB-S6-01) adds the other two personalization publications to the same card, on the
// same terms: which layouts save themselves is `layoutAutoSaves`' own answer, and every limit is
// the constant the enforcing code applies (`lib/persistence/personalization.js`).
import TileCard from '../../components/TileCard'
import { deviceSyncMatrix } from '../../lib/persistence/deviceSync'
import { densityCeilings, layoutAutosaveMatrix } from '../../lib/persistence/personalization'
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

function LayoutList({ rows, testId, heading, lede }) {
  if (!rows.length) return null
  return (
    <section className={styles.block} data-testid={testId}>
      <h3 className={styles.heading}>{heading}</h3>
      <p className={styles.lede}>{lede}</p>
      <ul className={styles.items}>
        {rows.map((r) => (
          <li key={r.id} className={styles.item} data-layout-kind={r.id}>{r.label}</li>
        ))}
      </ul>
    </section>
  )
}

export default function DeviceSyncCard({ manifest, ceilings, autoSaves }) {
  const m = manifest ? deviceSyncMatrix(manifest) : deviceSyncMatrix()
  const saving = autoSaves ? layoutAutosaveMatrix(autoSaves) : layoutAutosaveMatrix()
  const limits = ceilings ? densityCeilings(ceilings) : densityCeilings()
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
        <LayoutList
          rows={saving.autosaves}
          testId="sync-layout-autosaves"
          heading="Layouts that save as you work"
          lede="Changes to the arrangement are written into the open layout a moment after you stop moving things."
        />
        <LayoutList
          rows={saving.manual}
          testId="sync-layout-manual"
          heading="Layouts you save yourself"
          lede="Changes made while one of these is open are not written into it. To keep them, save the board as a new layout."
        />
        <LayoutList
          rows={saving.unreadable}
          testId="sync-layout-unreadable"
          heading="Layouts whose saving could not be read"
          lede="The rule that decides whether these save themselves could not be read from the code, so nothing is claimed about them."
        />
        <section className={styles.block} data-testid="sync-ceilings">
          <h3 className={styles.heading}>Limits</h3>
          <p className={styles.lede}>
            The most the app holds in one place. Each number is read from the code that enforces it.
          </p>
          <ul className={styles.limits}>
            {limits.map((c) => (
              <li key={c.id} className={styles.limit} data-ceiling-id={c.id}>
                <span className={styles.limitLabel}>{c.label}</span>
                <span className={styles.limitValue}>{c.display}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </TileCard>
  )
}

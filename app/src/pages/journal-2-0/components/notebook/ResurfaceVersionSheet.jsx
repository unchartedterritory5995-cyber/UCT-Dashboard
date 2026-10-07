import { useEffect } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import { formatET } from '../../../../utils/timeAgo'
import { useJ2NoteVersion } from '../../hooks/useJ2NoteVersions'
import NoteVersionPreview from './NoteVersionPreview'
import { SkeletonLine } from '../../../../components/Skeleton'
import styles from './ResurfaceVersionSheet.module.css'
// Wave 14 (W14-C1, item f): the first time this notice shows what the member wrote, it asks
// the registry for its passive explainer. The gate checks the capability's flag and the
// engine shows it once per member; nothing here decides either.
import { openRegistryTour } from './onboarding/tourRegistryControl'

export const RESURFACE_EXPLAINER_ID = 'note-resurfaces'

/**
 * Wave 13 lane 13D — "here's what you thought then".
 *
 * A resurfacing insight (the Awareness Engine's R7-R9: a ticker touched a level
 * this note named, moved 8% or more, or reached a date the member set) opens the
 * note with `?resurfaceVersion=<version id>`: the saved version that FIRST named
 * the level. This sheet shows that version read-only, beside the live note,
 * through the same `NoteVersionPreview` History uses — so a historical body never
 * mounts a live widget, never reaches search or Ask, and is never a second writer:
 * closing it returns to the note exactly as it is now. Restoring is History's job
 * (one door), not this sheet's.
 *
 * Rendered only while `awareness_note_resurface_enabled` is on (the editor checks
 * the latched flag before mounting it); off, the parameter is ignored.
 */
export default function ResurfaceVersionSheet({ noteId, versionId, onClose }) {
  const { version, isLoading, error } = useJ2NoteVersion(noteId, versionId)
  const shown = !isLoading && Boolean(version)
  useEffect(() => { if (shown) openRegistryTour(RESURFACE_EXPLAINER_ID) }, [shown])

  return (
    <Sheet
      open
      onClose={onClose}
      title="What you wrote then"
      labelledByTitle
      variant="auto"
      maxWidth={760}
      footer={(
        <div className={styles.footer}>
          <button type="button" className="btn btn-primary" onClick={onClose} data-tour="resurface-back">
            Back to the note as it is now
          </button>
        </div>
      )}
    >
      <div className={styles.wrap} data-testid="resurface-version">
        {isLoading && (
          <div role="status" aria-label="Loading what you wrote…">
            <SkeletonLine width="45%" height={16} />
            <SkeletonLine width="90%" height={13} />
            <SkeletonLine width="80%" height={13} />
          </div>
        )}
        {!isLoading && (error || !version) && (
          <p className={styles.note} role="alert">
            That earlier version of this note could not be opened. The note below is how it reads now.
          </p>
        )}
        {!isLoading && version && (
          <>
            <p className={styles.note} data-tour="resurface-then">
              Saved <time dateTime={version.createdAt}>{formatET(version.createdAt)}</time>. This is the
              version that first named the level. Your note itself is unchanged.
            </p>
            <NoteVersionPreview title={version.title} subtitle={version.subtitle} bodyJson={version.bodyJson} />
          </>
        )}
      </div>
    </Sheet>
  )
}

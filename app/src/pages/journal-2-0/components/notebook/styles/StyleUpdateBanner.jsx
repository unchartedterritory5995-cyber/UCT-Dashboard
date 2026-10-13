// Notebook P1 (spec P1.3): the "Update layout" offer under a styled note's title. Lazy chunk.
// It shows ONLY when all of these hold (Task 14 + integrator carry note b):
//   * the note records a style and that style is in the member's list at a NEWER version
//     (a deleted style is not in the list, so a note whose style is gone gets no offer: Review Focus 5);
//   * the preview (planStyleUpdate) says the update would add something: `!locked && !versionCurrent
//     && missingBlocks`. NOT `!upToDate`: a locked note is never written, and a newer version that adds
//     nothing is not worth an offer;
//   * the preview answers at all: a 404 (style deleted or purged) is no banner and the note is unchanged.
// The mount is gated on journalStylesEnabled() by the editor (so the chunk is never fetched with the
// switch off) and the list hook refuses to fetch with it off; this file restates neither.
import useSWR from 'swr'
import useJournalStyles from '../../../hooks/useJournalStyles'
import { knownStyleVersion, planStyleUpdate } from '../../../lib/journalStyles'
import styles from './StyleUpdateBanner.module.css'

export default function StyleUpdateBanner({ note, onOpen, hideUpTo = 0 }) {
  const { data } = useJournalStyles()
  const style = note?.styleId ? (data?.styles || []).find((s) => s.id === note.styleId) : null
  // `hideUpTo`: an update to this version already landed (the editor could not take it yet); never offer it twice.
  // A note with no recorded version (N9) is treated as older than every version, so it is still offered.
  const from = knownStyleVersion(note?.styleVersion)
  const latest = style && Number(style.version) > Math.max(from ?? 0, hideUpTo) ? style.version : null
  // Keyed on the note and the two versions, not its revision: the plan is asked for once per offer,
  // not once per autosave. Apply recomputes it on the server from the body it reads.
  const { data: planned } = useSWR(
    latest ? ['journal-style-plan', note.id, note.styleId, note.styleVersion, latest] : null,
    () => planStyleUpdate(note.id),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )
  const plan = planned?.plan
  if (!latest || !plan || plan.locked || plan.versionCurrent || !plan.missingBlocks) return null
  return (
    <div className={styles.banner} role="status" data-export-exclude>
      <span className={styles.text}>
        {from === null
          ? `This note uses an earlier version of ${style.name}. Update layout to v${latest}?`
          : `This note uses ${style.name} v${from}. Update layout to v${latest}?`}
      </span>
      <button type="button" className={styles.btn} onClick={onOpen}>Review update</button>
    </div>
  )
}

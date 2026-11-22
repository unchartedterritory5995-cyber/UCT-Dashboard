// L3 (live Obsidian probe, 2026-11-03): a note whose source app no longer has it.
//
// The sync engine never deletes a note whose remote went away: it tags it `source-deleted` and
// stops syncing it (engine.py `_tag_note_source_deleted`), and takes the tag off again if the
// item comes back (`_untag_note_source_reappeared`). Until this notice the tag chip was the only
// sign. Presentational only: the note view renders it when `noteIsSourceRemoved(note)`.
import UIcon from '../../../../components/ui/UIcon'
import { NOTE_CONNECTOR_PROVIDERS } from '../../hooks/useNoteConnectors'
import styles from './SourceRemovedNotice.module.css'

export const SOURCE_DELETED_TAG = 'source-deleted'
export const GENERIC_SOURCE_LABEL = 'its source app'

/** Shown for a CONNECTOR note the engine tagged: a note with no `importSource` was made in UCT,
 *  so a `source-deleted` tag on it is one the member typed, not a sync fact (fix round 1). */
export function noteIsSourceRemoved(note) {
  return Array.isArray(note?.tags) && note.tags.includes(SOURCE_DELETED_TAG)
    && typeof note?.importSource === 'string' && note.importSource !== ''
}

function providerOf(importSource) {
  const key = typeof importSource === 'string' ? importSource.toLowerCase() : ''
  return NOTE_CONNECTOR_PROVIDERS.find((p) => p.key === key) || null
}

/** The app's name from the note's `importSource` (the connector's provider key), else the
 *  generic wording: a name is only ever one the connector roster knows. */
export function sourceLabel(importSource) {
  return providerOf(importSource)?.label || GENERIC_SOURCE_LABEL
}

/** Fix round 1: only a provider whose listing is authoritative (Obsidian's vault walk) can say
 *  the note was REMOVED. Any other provider's listing can come back without a note that still
 *  exists there (sharing, a permission, an index), so it says what it knows: the note is no
 *  longer listed. */
export function sourceRemovedText(importSource) {
  const provider = providerOf(importSource)
  if (provider?.authoritativeListing) {
    return `This note was removed from ${provider.label}, so it no longer syncs. Your copy here is kept.`
  }
  const who = provider?.label || 'Its source app'
  return `${who} no longer lists this note, so it no longer syncs. Your copy here is kept.`
}

export default function SourceRemovedNotice({ importSource }) {
  return (
    <div className={styles.notice} role="note" data-testid="source-removed-notice" data-export-exclude>
      <UIcon name="info" size={14} gold={false} className={styles.icon} />
      <span className={styles.text}>{sourceRemovedText(importSource)}</span>
    </div>
  )
}

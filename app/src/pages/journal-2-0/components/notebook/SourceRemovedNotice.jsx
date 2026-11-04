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

export function noteIsSourceRemoved(note) {
  return Array.isArray(note?.tags) && note.tags.includes(SOURCE_DELETED_TAG)
}

/** The app's name from the note's `importSource` (the connector's provider key), else the
 *  generic wording: a name is only ever one the connector roster knows. */
export function sourceLabel(importSource) {
  const key = typeof importSource === 'string' ? importSource.toLowerCase() : ''
  return NOTE_CONNECTOR_PROVIDERS.find((p) => p.key === key)?.label || GENERIC_SOURCE_LABEL
}

export function sourceRemovedText(importSource) {
  return `This note was removed from ${sourceLabel(importSource)}, so it no longer syncs. Your copy here is kept.`
}

export default function SourceRemovedNotice({ importSource }) {
  return (
    <div className={styles.notice} role="note" data-testid="source-removed-notice" data-export-exclude>
      <UIcon name="info" size={14} gold={false} className={styles.icon} />
      <span className={styles.text}>{sourceRemovedText(importSource)}</span>
    </div>
  )
}

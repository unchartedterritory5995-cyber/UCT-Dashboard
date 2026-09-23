import { useId, useMemo, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import useJ2NoteFolders from '../../hooks/useJ2NoteFolders'
import styles from './BulkActionBar.module.css'

/** "Parent / Child" for every folder, sorted by that path. */
export function folderPathOptions(folders) {
  const byId = new Map((folders || []).map((f) => [f.id, f]))
  const pathOf = (f) => {
    const parts = []
    const seen = new Set()
    let cur = f
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      parts.unshift(cur.name)
      cur = cur.parentId ? byId.get(cur.parentId) : null
    }
    return parts.join(' / ')
  }
  return (folders || [])
    .map((f) => ({ id: f.id, path: pathOf(f) }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

export const UNFILED_VALUE = '__unfiled__'

/**
 * The toolbar that appears once one or more notes are selected (list and table
 * views, and the Trash). Every control is a native element — a <select> to
 * move, a <form> to tag, plain buttons — so it works with a keyboard, a screen
 * reader and a finger with nothing custom to learn.
 *
 * ⛔ It never reports outcomes itself. The sentence that says what happened
 * (and the Undo after a trash) is rendered by NotebookTab, OUTSIDE this bar,
 * because the bar unmounts the moment the selection empties — a message owned
 * by the control that fired it would be destroyed in the same commit that set
 * it (the joystick "Hide" toast defect, recorded in CLAUDE.md).
 */
export default function BulkActionBar({
  count,
  totalInView,
  allSelected,
  onSelectAll,
  onClear,
  trashView = false,
  busy = false,
  selectedTags = [],
  tagSuggestions = [],
  onMove,
  onAddTag,
  onRemoveTag,
  onFavorite,
  onUnfavorite,
  onExport,
  onTrash,
  onRestore,
  renderTagInput = null,
}) {
  const { folders } = useJ2NoteFolders()
  const folderOptions = useMemo(() => folderPathOptions(folders), [folders])
  const [tagsOpen, setTagsOpen] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const tagPanelId = useId()
  const datalistId = useId()

  const submitTag = (e) => {
    e.preventDefault()
    const t = tagDraft.trim()
    if (!t || busy) return
    onAddTag(t)
    setTagDraft('')
  }

  return (
    <div className={styles.bar} role="toolbar" aria-label="Actions for the selected notes">
      <div className={styles.selectionInfo}>
        <span className={styles.count} aria-live="polite">
          {count} selected
        </span>
        {!allSelected && totalInView > count && (
          <button type="button" className={styles.linkBtn} onClick={onSelectAll} disabled={busy}>
            Select all {totalInView} shown
          </button>
        )}
        <button
          type="button"
          className={styles.linkBtn}
          onClick={onClear}
          disabled={busy}
          aria-label="Clear the selection (Esc)"
          title="Clear the selection (Esc)"
        >
          Clear
        </button>
      </div>

      <div className={styles.actions}>
        {trashView ? (
          <button type="button" className={styles.action} onClick={onRestore} disabled={busy}>
            <UIcon name="refresh" size={14} gold={false} />
            Restore
          </button>
        ) : (
          <>
            <label className={styles.moveWrap}>
              <span className={styles.srOnly}>Move the selected notes to a folder</span>
              <select
                className={styles.moveSelect}
                value=""
                disabled={busy}
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) return
                  const folderId = v === UNFILED_VALUE ? null : v
                  const name = folderId ? folderOptions.find((f) => f.id === folderId)?.path : 'Unfiled'
                  onMove(folderId, name)
                }}
              >
                <option value="">Move to…</option>
                <option value={UNFILED_VALUE}>Unfiled</option>
                {folderOptions.map((f) => (
                  <option key={f.id} value={f.id}>{f.path}</option>
                ))}
              </select>
              <UIcon name="chevronDown" size={12} gold={false} />
            </label>

            <button
              type="button"
              className={styles.action}
              aria-expanded={tagsOpen}
              aria-controls={tagPanelId}
              onClick={() => setTagsOpen((o) => !o)}
              disabled={busy}
            >
              <UIcon name="tag" size={14} gold={false} />
              Tags
            </button>
            <button type="button" className={styles.action} onClick={onFavorite} disabled={busy}>
              <UIcon name="star" size={14} gold={false} />
              Favorite
            </button>
            <button type="button" className={styles.action} onClick={onUnfavorite} disabled={busy}>
              <UIcon name="star-fill" size={14} gold={false} />
              Unfavorite
            </button>
            <button type="button" className={styles.action} onClick={onExport} disabled={busy}>
              <UIcon name="download" size={14} gold={false} />
              {/* "selected", not bare "Export": the toolbar above already has an
                  Export that downloads the WHOLE notebook. */}
              Export selected
            </button>
            <button type="button" className={`${styles.action} ${styles.danger}`} onClick={onTrash} disabled={busy}>
              <UIcon name="trash" size={14} gold={false} />
              Move to Trash
            </button>
          </>
        )}
        {busy && <span className={styles.busy} role="status">Working…</span>}
      </div>

      {!trashView && tagsOpen && (
        <div id={tagPanelId} className={styles.tagPanel}>
          <form className={styles.tagForm} onSubmit={submitTag}>
            {renderTagInput ? renderTagInput({ value: tagDraft, onChange: setTagDraft, disabled: busy }) : (
              <>
                <input
                  className={styles.tagInput}
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  placeholder="Add a tag, e.g. research/semis"
                  aria-label="Tag to add to the selected notes"
                  list={datalistId}
                  disabled={busy}
                  autoComplete="off"
                />
                <datalist id={datalistId}>
                  {tagSuggestions.map((t) => <option key={t} value={t} />)}
                </datalist>
              </>
            )}
            <button type="submit" className={styles.action} disabled={busy || !tagDraft.trim()}>
              Add tag
            </button>
          </form>
          {selectedTags.length > 0 ? (
            <div className={styles.removeRow}>
              <span className={styles.removeLabel}>Remove:</span>
              {selectedTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={styles.tagChip}
                  onClick={() => onRemoveTag(t)}
                  disabled={busy}
                  aria-label={`Remove the tag ${t} from the selected notes`}
                >
                  #{t}
                  <UIcon name="x" size={10} gold={false} />
                </button>
              ))}
            </div>
          ) : (
            <p className={styles.hint}>None of the selected notes has a tag yet.</p>
          )}
        </div>
      )}
    </div>
  )
}

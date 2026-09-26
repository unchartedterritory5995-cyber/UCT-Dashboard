import { useId, useMemo, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import useJ2NoteFolders from '../../hooks/useJ2NoteFolders'
import TagSuggestInput from './TagSuggestInput'
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
 * The bar that appears once one or more notes are selected (list and table
 * views, and the Trash). Every control is a native element — a <select> and a
 * Move button, a <form> to tag, plain buttons — so it works with a keyboard, a
 * screen reader and a finger with nothing custom to learn.
 *
 * ⛔⛔ CHOOSING A FOLDER IS NOT MOVING (review B1). On Windows and Linux an
 * arrow key on a closed, focused <select> changes its value and fires `change`
 * on the spot, and type-ahead does it everywhere. When `change` moved the
 * notes, the first ↓ refiled the whole selection into "Unfiled" and every
 * further ↓ did it again — a keyboard member could not reach a real folder at
 * all. The <select> now only records a CHOICE; the Move button acts on it, and
 * the move can be undone (NotebookTab's notice). jsdom cannot show the browser
 * behaviour, so the rail fires the `change` a browser would.
 *
 * `role="group"`, not "toolbar": a toolbar promises roving arrow-key focus, and
 * this bar is Tab-only (review N4).
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
  /** The member's tag tree nodes (`{path, key, total}`), for suggestions. */
  tagNodes = [],
  onMove,
  onAddTag,
  onRemoveTag,
  onFavorite,
  onUnfavorite,
  onExport,
  onTrash,
  onRestore,
}) {
  const { folders } = useJ2NoteFolders()
  const folderOptions = useMemo(() => folderPathOptions(folders), [folders])
  const [tagsOpen, setTagsOpen] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [moveChoice, setMoveChoice] = useState('')
  const tagPanelId = useId()
  // A chosen folder that has since been deleted is no choice at all.
  const moveTarget = moveChoice === UNFILED_VALUE || folderOptions.some((f) => f.id === moveChoice)
    ? moveChoice : ''

  const submitMove = () => {
    if (!moveTarget || busy) return
    const folderId = moveTarget === UNFILED_VALUE ? null : moveTarget
    const name = folderId ? folderOptions.find((f) => f.id === folderId)?.path : 'Unfiled'
    onMove(folderId, name)
    setMoveChoice('')
  }

  const submitTag = (e) => {
    e.preventDefault()
    const t = tagDraft.trim()
    if (!t || busy) return
    onAddTag(t)
    setTagDraft('')
  }

  return (
    <div className={styles.bar} role="group" aria-label="Actions for the selected notes">
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
            <span className={styles.moveGroup}>
              <label className={styles.moveWrap}>
                <span className={styles.srOnly}>Folder to move the selected notes to</span>
                <select
                  className={styles.moveSelect}
                  value={moveTarget}
                  disabled={busy}
                  // Records the choice ONLY. Arrow keys and type-ahead change a
                  // closed <select> — they must never move a note.
                  onChange={(e) => setMoveChoice(e.target.value)}
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
                onClick={submitMove}
                disabled={busy || !moveTarget}
              >
                Move
              </button>
            </span>

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
            {/* Suggests the member's own tags, hierarchy first — "res" offers
                research/semis; "research/" offers what sits below it. */}
            <TagSuggestInput
              value={tagDraft}
              onChange={setTagDraft}
              nodes={tagNodes}
              disabled={busy}
              ariaLabel="Tag to add to the selected notes"
            />
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

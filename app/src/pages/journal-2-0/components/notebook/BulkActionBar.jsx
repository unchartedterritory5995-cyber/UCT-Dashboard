import { useEffect, useId, useMemo, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import useJ2NoteFolders from '../../hooks/useJ2NoteFolders'
import TagSuggestInput from './TagSuggestInput'
import { EXPORT_FORMATS } from './export/exportFormats'
import { bulkActionsChordLabel } from '../../lib/bulkActionsShortcut'
import styles from './BulkActionBar.module.css'

/** Left/Right/Up/Down move the roving stop; the ends hold rather than wrap --
 *  same convention as TemplatePicker's own card-grid arrows. */
const MOVES = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

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
 * ⛔ EXPORT OFFERS EVERY FORMAT (wave 9, lane 9D, D1). "Export selected" opens a
 * panel below the bar — the SAME disclosure idiom as Tags (`aria-expanded` +
 * `aria-controls`, native buttons inside, Tab-only) — listing `EXPORT_FORMATS`,
 * the ONE vocabulary the Export dialog and each note's Export menu read, each
 * with what it keeps. Choosing one calls `onExport(<format id>)`. Escape closes
 * the panel and hands focus back to the button that opened it.
 *
 * ⛔ F4 / A2R-04 (WCAG 2.4.3): Escape ANYWHERE IN THE BAR closes an open panel first.
 * Lane 10E-2's keyboard walk opened "Export selected" and pressed Escape with focus still
 * on that button -- the Escape reached the page's "Esc clears the selection", the whole
 * bar unmounted, and focus fell to <body>. An open panel (Export or Tags) is now what
 * Escape closes, from its toggle or from inside it, with focus back on the toggle; only
 * an Escape with no panel open is left to the page. A key an inner control already
 * handled (the tag field closing its suggestion list) is left alone.
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
  /** Wave 6: the Archived entry — its notes can be brought back, exported or trashed. */
  archiveView = false,
  busy = false,
  selectedTags = [],
  /** The member's tag tree nodes (`{path, key, total}`), for suggestions. */
  tagNodes = [],
  onMove,
  onAddTag,
  onRemoveTag,
  onFavorite,
  onUnfavorite,
  /** Called with the chosen format's id (`EXPORT_FORMATS[].id`). */
  onExport,
  onTrash,
  onRestore,
  onArchive,
  onUnarchive,
}) {
  const { folders } = useJ2NoteFolders()
  const folderOptions = useMemo(() => folderPathOptions(folders), [folders])
  const [tagsOpen, setTagsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [moveChoice, setMoveChoice] = useState('')
  const tagPanelId = useId()
  const exportPanelId = useId()
  const exportToggleRef = useRef(null)
  const tagsToggleRef = useRef(null)
  const barRef = useRef(null)
  // A chosen folder that has since been deleted is no choice at all.
  const moveTarget = moveChoice === UNFILED_VALUE || folderOptions.some((f) => f.id === moveChoice)
    ? moveChoice : ''
  // 13Q-5: the ONE action button in the Tab order right now — the rest carry
  // `tabIndex=-1` and are reached by Left/Right/Up/Down instead (the "one
  // roving group" the click-budget lane asked for). Deliberately still
  // `role="group"`, not "toolbar" (N4, above): the rail pinning that stays
  // true unchanged. A busy/disabled button is skipped — it was never reachable
  // by Tab either. `moveTarget` is in the deps below ONLY to repaint the Move
  // button's own tabIndex when it flips enabled/disabled -- known limitation,
  // stated rather than hidden: if that flip inserts Move ahead of whichever
  // button is CURRENTLY active, the active STOP is positional and can shift to
  // Move rather than following the button the member was just on. Narrow (it
  // needs a mouse pick on the folder select mid keyboard-navigation of this
  // bar) and recoverable in one Left/Right, so not chased further here.
  const [activeAction, setActiveAction] = useState(0)
  const rovingActions = () => (barRef.current
    ? [...barRef.current.querySelectorAll('[data-bulk-action]')].filter((el) => !el.disabled)
    : [])
  useEffect(() => {
    const list = rovingActions()
    if (!list.length) return
    const idx = Math.min(activeAction, list.length - 1)
    if (idx !== activeAction) { setActiveAction(idx); return }
    list.forEach((el, i) => { el.tabIndex = i === idx ? 0 : -1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trashView, archiveView, busy, activeAction, moveTarget])

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

  // One panel at a time: opening Export closes Tags, and the other way round.
  const toggleExport = () => {
    setExportOpen((o) => !o)
    setTagsOpen(false)
  }
  const chooseExport = (format) => {
    if (busy) return
    setExportOpen(false)
    onExport(format)
  }
  // The bar's Escape (see the header, A2R-04): it closes an open panel and must not also
  // reach the page's "Esc clears the selection" (NotebookTab skips an Esc already marked
  // handled, and this one stops here too).
  const onBarKeyDown = (e) => {
    if (e.key === 'Escape' && !e.isDefaultPrevented()) {
      const toggle = exportOpen ? exportToggleRef : tagsOpen ? tagsToggleRef : null
      if (toggle) {
        e.preventDefault()
        e.stopPropagation()
        setExportOpen(false)
        setTagsOpen(false)
        toggle.current?.focus()
      }
      return
    }
    // 13Q-5: Left/Right/Up/Down move the roving stop among the action buttons.
    // Scoped to a keypress that actually came FROM one of them, same guard
    // TemplatePicker's own onGalleryKeyDown uses for its card grid.
    if (e.key in MOVES) {
      const from = e.target.closest?.('[data-bulk-action]')
      if (!from) return
      const list = rovingActions()
      const at = list.indexOf(from)
      if (at < 0) return
      const to = list[Math.min(list.length - 1, Math.max(0, at + MOVES[e.key]))]
      if (!to || to === from) return
      e.preventDefault()
      setActiveAction(list.indexOf(to))
      to.focus()
    }
  }

  const exportButton = (
    <button
      ref={exportToggleRef}
      type="button"
      className={styles.action}
      aria-expanded={exportOpen}
      aria-controls={exportPanelId}
      onClick={toggleExport}
      disabled={busy}
      data-bulk-action=""
    >
      <UIcon name="download" size={14} gold={false} />
      {/* "selected", not bare "Export": the toolbar above already has an
          Export that downloads the WHOLE notebook. */}
      Export selected
      <UIcon name="chevronDown" size={12} gold={false} />
    </button>
  )

  return (
    <div
      ref={barRef}
      className={styles.bar}
      role="group"
      aria-label="Actions for the selected notes"
      onKeyDown={onBarKeyDown}
      data-bulk-bar=""
    >
      <div className={styles.selectionInfo}>
        <span className={styles.count} aria-live="polite">
          {count} selected
        </span>
        {/* 13Q-5: a visible hint, separate from the count's own aria-live text
            so the pinned "says how many are selected" rail keeps matching an
            exact "{count} selected" node — a member who just ticked a row (far
            from this bar in a long list) never has to discover the shortcut by
            tabbing the whole way here first. */}
        <span className={styles.shortcutHint} aria-live="polite">
          {bulkActionsChordLabel()} jumps here
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
          <button type="button" className={styles.action} onClick={onRestore} disabled={busy} data-bulk-action="">
            <UIcon name="refresh" size={14} gold={false} />
            Restore
          </button>
        ) : archiveView ? (
          <>
            {/* Archive is not trash: bringing a note back puts it exactly where
                it was, in its own folder. */}
            <button type="button" className={styles.action} onClick={onUnarchive} disabled={busy} data-bulk-action="">
              <UIcon name="library" size={14} gold={false} />
              Unarchive
            </button>
            {exportButton}
            <button type="button" className={`${styles.action} ${styles.danger}`} onClick={onTrash} disabled={busy} data-bulk-action="">
              <UIcon name="trash" size={14} gold={false} />
              Move to Trash
            </button>
          </>
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
                  // 13Q-5: the jump shortcut's STABLE anchor -- the first control
                  // in `.actions`, in every view that has one. Giving it this
                  // role is NOT the B1 hazard: that bug was arrow keys changing
                  // a FOCUSED select's value; a plain `.focus()` call changes
                  // nothing. It stays OUTSIDE the roving arrow-key group below
                  // (same B1 reasoning) -- this is a second, independent role.
                  data-bulk-move-select=""
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
                data-bulk-action=""
              >
                Move
              </button>
            </span>

            <button
              ref={tagsToggleRef}
              type="button"
              className={styles.action}
              aria-expanded={tagsOpen}
              aria-controls={tagPanelId}
              onClick={() => { setTagsOpen((o) => !o); setExportOpen(false) }}
              disabled={busy}
              data-bulk-action=""
            >
              <UIcon name="tag" size={14} gold={false} />
              Tags
            </button>
            <button type="button" className={styles.action} onClick={onFavorite} disabled={busy} data-bulk-action="">
              <UIcon name="star" size={14} gold={false} />
              Favorite
            </button>
            <button type="button" className={styles.action} onClick={onUnfavorite} disabled={busy} data-bulk-action="">
              <UIcon name="star-fill" size={14} gold={false} />
              Unfavorite
            </button>
            {exportButton}
            <button type="button" className={styles.action} onClick={onArchive} disabled={busy} data-bulk-action="">
              <UIcon name="library" size={14} gold={false} />
              Archive
            </button>
            <button type="button" className={`${styles.action} ${styles.danger}`} onClick={onTrash} disabled={busy} data-bulk-action="">
              <UIcon name="trash" size={14} gold={false} />
              Move to Trash
            </button>
          </>
        )}
        {busy && <span className={styles.busy} role="status">Working…</span>}
      </div>

      {!trashView && exportOpen && (
        <div
          id={exportPanelId}
          className={styles.tagPanel}
          role="group"
          aria-labelledby={`${exportPanelId}-label`}
        >
          <span id={`${exportPanelId}-label`} className={styles.removeLabel}>Export the selected notes as</span>
          {EXPORT_FORMATS.map((f) => (
            <div key={f.id} className={styles.removeRow}>
              <button
                type="button"
                className={styles.action}
                onClick={() => chooseExport(f.id)}
                disabled={busy}
                aria-describedby={`${exportPanelId}-${f.id}`}
              >
                {f.menuLabel}
              </button>
              <span id={`${exportPanelId}-${f.id}`} className={styles.hint}>{f.keeps}</span>
            </div>
          ))}
        </div>
      )}

      {!trashView && !archiveView && tagsOpen && (
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

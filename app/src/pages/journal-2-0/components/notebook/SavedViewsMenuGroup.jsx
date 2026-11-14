// Notebook simplify, Task 2 (2026-11-11): the member's saved views, as the "Saved views" group at the foot of the
// notes list's View menu. They used to be a section of the folders panel; the panel is now for finding notes, and a
// saved view is a way of LOOKING at notes, so it sits beside the modes it pins.
//
// Same capabilities the panel section had, moved, never re-implemented: a row applies the view (`onSelectView`),
// each row renames (an inline field, Enter or leaving it saves, Escape cancels, an empty name is a cancel) and
// deletes (`onDeleteView`, the tab's own confirm), and with no saved views at all the group offers "Add thesis
// starter views". The row icon is derived from VIEW_MODES, never a list/table binary (competitive audit UX #6).
//
// ⛔ The apply row, Rename and Delete are three SIBLING buttons, never a control inside a button (wave 7 lane J,
// J5). The apply row alone carries `title={view.name}`; the two controls keep the titles "Rename view" /
// "Delete view" and the names "Rename <view>" / "Delete <view>". Each is a menu item, so the menu's own Up and Down
// reach all three (`useMenuButton` in NewNoteMenu.jsx owns the keyboard).
import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { VIEW_MODES } from '../../lib/savedViewModes'
import { TOOLBAR_ICON } from '../../lib/notebookIcons'
import menuStyles from './NewNoteMenu.module.css'
import styles from './SavedViewsMenuGroup.module.css'

/** Go-live wave 1 (D3): what the group says when the saved views could not be read. */
export const SAVED_VIEWS_FAILED = 'Saved views could not be loaded.'

/** The mode's icon; an unrecognised viewType (older, or saved by a newer client) falls back to List's. */
const iconFor = (viewType) => VIEW_MODES.find((m) => m.id === viewType)?.icon || 'rows'

export default function SavedViewsMenuGroup({
  // `views` defaults to none, as the panel section's `savedViews` prop did: a caller with no list yet draws no rows.
  menu, views = [], activeViewId = null, onSelectView, onRenameView, onDeleteView,
  // null while the starter set must not be offered (the list has not answered, or failed): offering it then would
  // add four views beside ones the member may already have.
  onAddStarterViews = null,
  // Go-live wave 1 (D3): the saved views' read failed. With none to show, the group says so in one quiet line
  // (the list's own failure line, LoadFailed, carries the retry), instead of drawing nothing.
  loadFailed = false,
}) {
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  // After a rename the field goes away; focus goes back to that view's row, so it stays inside the open menu. Held
  // in a ref and taken by the effect after the render that drew the row again.
  const refocusId = useRef(null)
  const groupRef = useRef(null)
  // Enter saves and removes the field; a blur arriving as it goes must not save a second time.
  const finished = useRef(false)

  useEffect(() => {
    if (refocusId.current == null) return
    const id = String(refocusId.current)
    refocusId.current = null
    const rows = groupRef.current?.querySelectorAll('[data-saved-view-row]') || []
    ;[...rows].find((el) => el.getAttribute('data-saved-view-row') === id)?.focus()
  })

  if (!views.length && !onAddStarterViews && !loadFailed) return null

  const startRename = (view) => { finished.current = false; setEditingId(view.id); setEditName(view.name) }
  const finishRename = (id, save) => {
    if (finished.current) return
    finished.current = true
    const trimmed = editName.trim()
    refocusId.current = id
    setEditingId(null)
    if (save && trimmed) onRenameView(id, trimmed) // an empty name is a cancel, never an empty-named view
  }

  return (
    <div ref={groupRef} role="group" aria-label="Saved views" className={styles.group} data-saved-views-group="">
      <div className={styles.label} aria-hidden="true">Saved views</div>
      {!views.length && loadFailed ? (
        <p className={styles.failed}>{SAVED_VIEWS_FAILED}</p>
      ) : !views.length ? (
        <button type="button" role="menuitem" className={menuStyles.item} onClick={menu.run(onAddStarterViews, 'starter_views')} data-row="starter_views">
          <UIcon name="sliders" {...TOOLBAR_ICON} /> Add thesis starter views
        </button>
      ) : views.map((view) => {
        const active = activeViewId === view.id
        const icon = iconFor(view.viewType)
        return (
          <div key={view.id} className={styles.row}>
            {editingId === view.id ? (
              <input
                className={styles.renameInput}
                autoFocus
                value={editName}
                aria-label={`Rename view ${view.name}`}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => finishRename(view.id, true)}
                // The field keeps its keys: the menu's Escape would close the menu, its arrows would move focus.
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') { e.preventDefault(); finishRename(view.id, true) }
                  if (e.key === 'Escape') { e.preventDefault(); finishRename(view.id, false) }
                }}
              />
            ) : (<>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`${menuStyles.item} ${active ? menuStyles.itemChecked : ''} ${styles.apply}`}
                onClick={menu.run(() => onSelectView(view), 'saved_view')}
                data-row="saved_view"
                title={view.name}
                data-saved-view-row={view.id}
              >
                <UIcon name={icon} {...TOOLBAR_ICON} data-view-icon={icon} />
                <span className={styles.name}>{view.name}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.iconBtn}
                onClick={() => { menu.track?.('rename_view'); startRename(view) }}
                data-row="rename_view"
                title="Rename view"
                aria-label={`Rename ${view.name}`}
              ><UIcon name="edit" {...TOOLBAR_ICON} /></button>
              <button
                type="button"
                role="menuitem"
                className={`${styles.iconBtn} ${styles.deleteBtn}`}
                onClick={menu.run(() => onDeleteView(view.id, view.name), 'delete_view')}
                data-row="delete_view"
                title="Delete view"
                aria-label={`Delete ${view.name}`}
              ><UIcon name="x" {...TOOLBAR_ICON} /></button>
            </>)}
          </div>
        )
      })}
    </div>
  )
}

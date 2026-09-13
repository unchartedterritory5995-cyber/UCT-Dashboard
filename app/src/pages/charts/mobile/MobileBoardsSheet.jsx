import { useState } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import haptics from '../../../components/mobile/haptics'
import useTracings from '../../../components/chart/useTracings'
import { tracingLabel, peekTracingDrawings } from '../../../components/chart/drawingsStore'
import styles from './MobileBoardsSheet.module.css'

/* The phone's door to Drawing Boards — the last high-value orphaned mobile task.
 *
 * ⛔ THE ORPHAN, PRECISELY. Boards ("tracings") are named overlay sheets of
 * drawings that span every ticker. They are real, they are per-user, and they
 * SYNC — `useTracingsSync` pushes the whole document to `tracings_doc` from the
 * phone as readily as from the desktop. The only surface that could switch,
 * name, add or delete one was `BoardsToolButton` inside `ChartToolbar`, which is
 * `display:none` on the phone shell (presentation contract §0, mechanism M2). So
 * a phone user drew onto whichever board happened to be active, could not tell
 * which one that was, and could not change it.
 *
 * ⭐ AND FIXING THE SYNC IS WHAT MADE THIS URGENT. MOB-09 repaired the
 * highwatermark so a phone now correctly ADOPTS the boards a desktop created.
 * Before that a phone mostly saw one board because it was pinned; after it, a
 * phone sees all of them and still had no way to choose. Half a fix is its own
 * defect.
 *
 * ⛔ THIS SHEET OWNS NO STATE, exactly like `MobileLayoutsSheet`. Every action is
 * a `drawingsStore` function reached through `useTracings`, which is the same
 * store the desktop panel and the canvas read. A local copy of the board list
 * would be a second authority over which board you are drawing on — the worst
 * possible thing to duplicate.
 */
export default function MobileBoardsSheet({ open, onClose, sym = null, className = '' }) {
  const { tracings, activeId, createTracing, renameTracing, setActiveTracing, deleteTracing,
    visibleIds, setTracingVisible } = useTracings()
  const [renaming, setRenaming] = useState(null)   // id being renamed
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState(null)  // id pending delete confirm

  const startRename = (t) => { haptics.tap(); setConfirming(null); setRenaming(t.id); setDraft(t.name || '') }
  const commitRename = (t) => {
    const v = draft.trim()
    setRenaming(null)
    if (v !== (t.name || '')) renameTracing(t.id, v)
  }

  const activate = (id) => {
    haptics.tap()
    setActiveTracing(id)
    // ⛔ NOT `onClose()`. Switching boards is often the FIRST of several moves
    // (switch, rename, hide another); closing on the tap would make every
    // subsequent one a re-open. The desktop panel stays open for the same reason.
  }

  return (
    <Sheet open={open} onClose={onClose} variant="bottom-sheet" title="Drawing boards"
      ariaLabel="Drawing boards" className={className}>
      <div className={styles.list}>
        {tracings.map((t) => {
          const label = tracingLabel(t)
          const active = t.id === activeId
          const visible = !visibleIds || visibleIds.includes(t.id)
          const count = sym ? peekTracingDrawings(t.id, sym).length : 0
          return (
            <div key={t.id} className={`${styles.row} ${active ? styles.rowActive : ''}`} data-testid="board-row">
              {renaming === t.id ? (
                <input
                  className={styles.rename}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(t)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(t); if (e.key === 'Escape') setRenaming(null) }}
                  /* A DISTINCT name from the button that opened it — both
                     answering to "Rename X" makes every lookup ambiguous, for a
                     test and for a screen reader alike. */
                  aria-label={`New name for ${label}`}
                  placeholder={label}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className={styles.pick}
                  onClick={() => activate(t.id)}
                  aria-label={active ? `${label} (active board)` : `Draw on ${label}`}
                  aria-pressed={active}
                >
                  <span className={styles.check} aria-hidden="true">
                    {active ? <UIcon name="check" size={14} gold /> : null}
                  </span>
                  <span className={styles.name}>{label}</span>
                  {/* The count is per SYMBOL — "how much of this board is on the
                      chart I am looking at" — which is the question a trader has. */}
                  {sym ? <span className={styles.count}>{count} on {sym}</span> : null}
                </button>
              )}

              {/* ⛔ NO VISIBILITY CONTROL ON THE ACTIVE BOARD, and this is a
                  store fact rather than a style choice: `setTracingVisible`
                  force-adds `activeId` back into `visibleIds` (the single-sheet
                  render floor — you must always see what you are drawing on).
                  Offering the eye here would be a control that silently does
                  nothing, which is worse than not offering it. */}
              {!active && (
                <button
                  type="button"
                  className={`${styles.ctl} ${visible ? '' : styles.ctlOff}`}
                  onClick={() => { haptics.tap(); setTracingVisible(t.id, !visible) }}
                  aria-label={visible ? `Hide ${label}` : `Show ${label}`}
                  aria-pressed={!visible}
                >
                  <UIcon name={visible ? 'eye' : 'eyeOff'} size={16} gold={false} />
                </button>
              )}

              <button type="button" className={styles.ctl} onClick={() => startRename(t)}
                aria-label={`Rename ${label}`}>
                <UIcon name="edit" size={15} gold={false} />
              </button>

              {/* ⛔ INLINE CONFIRM, NOT `window.confirm`. A browser dialog blocks
                  the page and reads as a crash on a phone; and the last board can
                  never be deleted, so the control is ABSENT rather than disabled. */}
              {tracings.length > 1 && (
                confirming === t.id ? (
                  <>
                    <button type="button" className={`${styles.ctl} ${styles.danger}`}
                      onClick={() => { haptics.tap(); setConfirming(null); deleteTracing(t.id) }}
                      aria-label={`Confirm delete ${label}`}>
                      <UIcon name="check" size={15} gold={false} />
                    </button>
                    <button type="button" className={styles.ctl}
                      onClick={() => setConfirming(null)} aria-label="Cancel delete">
                      <UIcon name="x" size={14} gold={false} />
                    </button>
                  </>
                ) : (
                  <button type="button" className={styles.ctl}
                    onClick={() => { haptics.tap(); setRenaming(null); setConfirming(t.id) }}
                    aria-label={`Delete ${label}`}>
                    <UIcon name="trash" size={15} gold={false} />
                  </button>
                )
              )}
            </div>
          )
        })}

        <button type="button" className={styles.newRow}
          onClick={() => { haptics.tap(); setActiveTracing(createTracing()) }}
          aria-label="New board">
          <UIcon name="plus" size={15} gold={false} />
          <span>New board</span>
        </button>
      </div>
    </Sheet>
  )
}

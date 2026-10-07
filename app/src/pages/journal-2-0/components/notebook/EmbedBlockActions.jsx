/**
 * The "Block actions" button in a chart block's own toolbar (finish program, lane FE round 3).
 *
 * WHY IT EXISTS. On a phone or tablet a LIVE chart cannot be selected by tap or long-press: the
 * chart library cancels the touch itself, so no mousedown is produced and the editor's
 * click-to-select is never asked (the same on master). Selection is how a block gets moved there
 * (the block grip stands beside the block the caret is in, lib/blockHandle.js), so a live chart
 * had no way to be moved by touch at all. This button needs no selection: it knows its own block.
 *
 * It is shown at 1024 px and below only (WidgetEmbedView.module.css `.blockActions`); on a
 * desktop the hover toolbar, the grip and the keyboard already do all three.
 *
 * ONE MOVE, ONE MENU. The move is `moveBlock` (lib/blockHandle.js), the same transaction the grip
 * and Alt+Shift+Arrow make, so a moved chart keeps its attrs and one undo puts it back. The menu
 * is the shared ContextPopover: a bottom sheet with 44 px rows on touch, an anchored menu
 * otherwise. Remove is the block's own `deleteNode`, the call the toolbar's Remove button makes.
 */
import { useCallback, useRef, useState } from 'react'
import ContextPopover from '../../../../components/mobile/ContextPopover'
import { moveBlock, topBlockAt } from '../../lib/blockHandle'

export const BLOCK_ACTIONS_LABEL = 'Block actions'

export default function EmbedBlockActions({ editor, getPos, deleteNode, className = '' }) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const btnRef = useRef(null)

  const where = useCallback(() => {
    try {
      const pos = typeof getPos === 'function' ? getPos() : null
      if (typeof pos !== 'number' || !editor || editor.isDestroyed) return null
      const top = topBlockAt(editor.state.doc, pos)
      return top ? { pos, index: top.index, count: editor.state.doc.childCount } : null
    } catch {
      return null
    }
  }, [editor, getPos])

  const move = (dir) => {
    const at = where()
    if (!at) return
    // The move acts on the selection's block, so the selection is put on THIS block first.
    editor.commands.setNodeSelection(at.pos)
    moveBlock(editor, dir)
  }

  if (!editor || editor.isEditable === false) return null
  const at = open ? where() : null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={className}
        aria-label={BLOCK_ACTIONS_LABEL}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        title="Block actions: move or remove this block"
        data-embed-block-actions=""
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect?.()
          setAnchor(r ? { x: r.left, y: r.bottom + 4 } : { x: 8, y: 8 })
          setOpen((o) => !o)
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      <ContextPopover
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        title="Block actions"
        items={[
          { label: 'Move up', disabled: !at || at.index === 0, onClick: () => move(-1) },
          { label: 'Move down', disabled: !at || at.index >= at.count - 1, onClick: () => move(1) },
          { label: 'Remove block', danger: true, onClick: () => deleteNode?.() },
        ]}
      />
    </>
  )
}

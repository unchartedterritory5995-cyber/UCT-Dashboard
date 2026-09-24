/**
 * Wave 5 — the note's outline (table of contents): every heading H1–H6,
 * indented by level, live as the member writes; a click jumps to it.
 *
 * Desktop: a panel that stays open beside the note while the member works
 * (Obsidian's outline). Touch tier: a bottom sheet, which closes on a pick so
 * the note is what the member sees next. The heading the caret is in reads as
 * the current location (aria-current).
 *
 * Keyboard: ↑/↓ (and Home/End) move between entries, Enter or Space jumps,
 * Escape closes the panel and returns focus to the toolbar button.
 *
 * ⛔ Off the keystroke path: the list is re-read 200 ms after ANY document
 * change (lib/onDocChange.js — a restored or synced note swaps its content
 * without an `update`), a caret move reuses that list, and a click re-reads it
 * on the spot, so a jump never lands on a position the member has typed past
 * since the list was drawn.
 *
 * ⛔ A heading inside a CLOSED toggle is listed (it is a heading), so a jump to
 * it opens every collapsed toggle around it in the same transaction as the
 * caret move — otherwise the click looks dead and the next keystrokes land in
 * text nobody can see.
 */
import { useEffect, useRef, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import { useIsTouch } from '../../../../hooks/useBreakpoint'
import UIcon from '../../../../components/ui/UIcon'
import { currentHeadingIndex, outlineBaseLevel, outlineOf } from '../../lib/noteOutline'
import { onDocChange } from '../../lib/onDocChange'
import { Toggle } from '../../lib/toggleNode'
import styles from './NoteOutline.module.css'

export const OUTLINE_DEBOUNCE_MS = 200
export const OUTLINE_LABEL = 'Outline'

export default function NoteOutline({ editor, onClose, toggleRef }) {
  // ⛔ The one sanctioned useIsTouch: a click-triggered choice between a sheet
  // and a panel (CLAUDE.md, "useMediaQuery is stale at first paint").
  const isTouch = useIsTouch()
  const [outline, setOutline] = useState(() => outlineOf(editor?.state.doc))
  const [current, setCurrent] = useState(() => (editor ? currentHeadingIndex(outlineOf(editor.state.doc), editor.state.selection.from) : -1))
  const listRef = useRef(null)
  // The list the panel last drew: a caret move reads it rather than walking
  // the document again (N3 — the walk belongs to the debounced read).
  const outlineRef = useRef(outline)

  useEffect(() => {
    if (!editor) return undefined
    let timer = null
    const read = () => {
      if (editor.isDestroyed) return
      const next = outlineOf(editor.state.doc)
      outlineRef.current = next
      setOutline(next)
      setCurrent(currentHeadingIndex(next, editor.state.selection.from))
    }
    const onDoc = () => { clearTimeout(timer); timer = setTimeout(read, OUTLINE_DEBOUNCE_MS) }
    const onSelection = () => {
      if (editor.isDestroyed) return
      setCurrent(currentHeadingIndex(outlineRef.current, editor.state.selection.from))
    }
    const offDoc = onDocChange(editor, onDoc)
    editor.on('selectionUpdate', onSelection)
    return () => {
      clearTimeout(timer)
      offDoc()
      editor.off('selectionUpdate', onSelection)
    }
  }, [editor])

  const close = (refocusToggle) => {
    onClose()
    if (refocusToggle) toggleRef?.current?.focus()
  }

  const jump = (index) => {
    if (!editor || editor.isDestroyed) return
    // Re-read NOW: the drawn list may be up to one debounce behind the note.
    const fresh = outlineOf(editor.state.doc)
    const drawn = outline[index]
    const target = (fresh[index] && drawn && fresh[index].text === drawn.text)
      ? fresh[index]
      : fresh.find((h) => drawn && h.text === drawn.text && h.level === drawn.level)
    if (!target) { outlineRef.current = fresh; setOutline(fresh); return }
    editor.chain().focus()
      .command(({ tr }) => {
        // Open every collapsed toggle around the heading (S4). Attribute
        // steps move no positions, so target.pos stays valid.
        const $pos = tr.doc.resolve(target.pos)
        for (let d = $pos.depth; d > 0; d -= 1) {
          const node = $pos.node(d)
          if (node.type.name === Toggle.name && !node.attrs.open) tr.setNodeAttribute($pos.before(d), 'open', true)
        }
        return true
      })
      .setTextSelection(target.pos + 1)
      .run()
    const dom = editor.view.nodeDOM(target.pos)
    dom?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    if (isTouch) close(false)
  }

  const onKeyDown = (e) => {
    const items = [...(listRef.current?.querySelectorAll('button[data-outline-item]') || [])]
    const i = items.indexOf(document.activeElement)
    const focusAt = (k) => { e.preventDefault(); items[Math.max(0, Math.min(items.length - 1, k))]?.focus() }
    if (e.key === 'ArrowDown') focusAt(i + 1)
    else if (e.key === 'ArrowUp') focusAt(i - 1)
    else if (e.key === 'Home') focusAt(0)
    else if (e.key === 'End') focusAt(items.length - 1)
    else if (e.key === 'Escape' && !isTouch) {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    }
  }

  const base = outlineBaseLevel(outline)
  const body = outline.length ? (
    <ol className={styles.list} ref={listRef} onKeyDown={onKeyDown}>
      {outline.map((h, i) => (
        <li key={`${h.pos}-${i}`} className={styles.row}>
          <button
            type="button"
            data-outline-item
            data-level={h.level}
            // Indent by depth below the shallowest heading present (a note that
            // starts at H2 does not open with an empty step).
            style={{ paddingLeft: 8 + (h.level - base) * 14 }}
            className={`${styles.item} ${i === current ? styles.itemCurrent : ''} ${h.text ? '' : styles.itemEmpty}`}
            aria-current={i === current ? 'location' : undefined}
            onClick={() => jump(i)}
          >
            <span className={styles.level} aria-hidden="true">H{h.level}</span>
            <span className={styles.text}>{h.text || 'Untitled heading'}</span>
          </button>
        </li>
      ))}
    </ol>
  ) : (
    <p className={styles.empty}>No headings yet — start a line with # and a space, or type /heading.</p>
  )

  if (isTouch) {
    return (
      <Sheet open onClose={() => close(false)} variant="bottom-sheet" title={OUTLINE_LABEL}>
        <nav aria-label={OUTLINE_LABEL}>{body}</nav>
      </Sheet>
    )
  }
  return (
    <nav className={styles.panel} aria-label={OUTLINE_LABEL} data-export-exclude>
      <div className={styles.head}>
        <span className={styles.title}>{OUTLINE_LABEL}</span>
        <button type="button" className={styles.closeBtn} onClick={() => close(true)} aria-label="Close outline" title="Close (Esc)">
          <UIcon name="x" size={13} gold={false} />
        </button>
      </div>
      {body}
    </nav>
  )
}

/**
 * Wave 5 — the toolbar's text colour + highlight picker.
 *
 * Two rows of the SAME palette (lib/textColor.js): text colour (Default + six)
 * and highlight (None + six). Each swatch is a labelled, pressed-state button,
 * so the picker is fully keyboard- and screen-reader-operable; on the touch
 * tier it opens as a bottom sheet with 44px swatches. A pick applies to the
 * selection (or the stored marks at the caret), closes the picker and hands
 * focus back to the note. Mod-Shift-H toggles the default highlight without
 * opening anything.
 *
 * The swatches render their sample through the very classes a note renders
 * with (`uct-tc-*`, `uct-hl-*` in lib/noteContent.css) — one mapping from a
 * palette name to a colour, never a second copy of it here.
 */
import { useEffect, useId, useRef } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import { useIsTouch } from '../../../../hooks/useBreakpoint'
import { NOTE_COLORS, highlightClass, textColorClass } from '../../lib/textColor'
import { modKeyLabel } from '../../lib/platform'
import styles from './TextColorMenu.module.css'

// US spelling in every member-facing string (the Journal already says
// "Account color"; wave-5 review N7).
export const TEXT_COLOR_MENU_LABEL = 'Text color and highlight'

export default function TextColorMenu({ id, editor, onClose, toggleRef }) {
  // Per-instance ids: two pickers on one page must not label each other's
  // rows (wave-5 review N6).
  const textLabelId = useId()
  const highlightLabelId = useId()
  // ⛔ THE ONE SANCTIONED useIsTouch: a click-triggered choice between a bottom
  // sheet and an anchored popover (CLAUDE.md, "useMediaQuery is stale at first
  // paint" — it is read here only after a tap, never for layout).
  const isTouch = useIsTouch()
  const panelRef = useRef(null)

  const textColor = editor.getAttributes('textColor').color || null
  const highlighted = editor.isActive('highlight')
  const highlightColor = highlighted ? (editor.getAttributes('highlight').color || 'yellow') : null

  const close = (refocusToggle) => {
    onClose()
    if (refocusToggle) toggleRef?.current?.focus()
  }
  const apply = (fn) => {
    fn(editor.chain().focus()).run()
    close(false)
  }

  // Desktop popover: focus lands on the current swatch so a keyboard user can
  // pick at once; Escape and a click outside close it.
  useEffect(() => {
    if (isTouch) return undefined
    const panel = panelRef.current
    const first = panel?.querySelector('[aria-pressed="true"]') || panel?.querySelector('button')
    first?.focus()
    const onDown = (e) => {
      if (panel && !panel.contains(e.target) && !toggleRef?.current?.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [isTouch]) // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    }
  }

  // A swatch must not take the editor's selection away on mouse down; the
  // chain re-focuses the editor on apply either way.
  const keep = (e) => e.preventDefault()

  const body = (
    <div id={id} className={styles.menu} role="group" aria-label={TEXT_COLOR_MENU_LABEL} onKeyDown={onKeyDown}>
      <div className={styles.groupLabel} id={textLabelId}>Text color</div>
      <div className={styles.swatches} role="group" aria-labelledby={textLabelId}>
        <button
          type="button"
          className={styles.swatch}
          aria-pressed={!textColor}
          aria-label="Default text color"
          title="Default"
          onMouseDown={keep}
          onClick={() => apply((c) => c.unsetTextColor())}
        >
          <span className={styles.sample}>A</span>
        </button>
        {NOTE_COLORS.map((c) => (
          <button
            key={c.name}
            type="button"
            className={styles.swatch}
            aria-pressed={textColor === c.name}
            aria-label={`${c.label} text`}
            title={c.label}
            onMouseDown={keep}
            onClick={() => apply((ch) => ch.setTextColor(c.name))}
          >
            <span className={`${styles.sample} ${textColorClass(c.name)}`}>A</span>
          </button>
        ))}
      </div>
      <div className={styles.groupLabel} id={highlightLabelId}>Highlight</div>
      <div className={styles.swatches} role="group" aria-labelledby={highlightLabelId}>
        <button
          type="button"
          className={styles.swatch}
          aria-pressed={!highlighted}
          aria-label="No highlight"
          title="None"
          onMouseDown={keep}
          onClick={() => apply((c) => c.unsetHighlight())}
        >
          <span className={`${styles.sample} ${styles.none}`}>A</span>
        </button>
        {NOTE_COLORS.map((c) => (
          <button
            key={c.name}
            type="button"
            className={styles.swatch}
            aria-pressed={highlightColor === c.name}
            aria-label={`${c.label} highlight`}
            title={c.name === 'yellow' ? `${c.label} (${modKeyLabel()}+Shift+H)` : c.label}
            onMouseDown={keep}
            onClick={() => apply((ch) => ch.setHighlight({ color: c.name }))}
          >
            <mark className={`${styles.sample} ${highlightClass(c.name)}`}>A</mark>
          </button>
        ))}
      </div>
    </div>
  )

  if (isTouch) {
    return (
      <Sheet open onClose={() => close(false)} variant="bottom-sheet" title="Color">
        {body}
      </Sheet>
    )
  }
  return (
    <div ref={panelRef} className={styles.popover} data-export-exclude>
      {body}
    </div>
  )
}

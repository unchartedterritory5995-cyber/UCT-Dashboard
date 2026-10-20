// B/NewNoteMenu.jsx — Research Home's create door (spec P0.1). One press makes a blank note;
// the caret lists the other ways in. An item appears only when its handler exists, so a gate
// that is off leaves no door that opens nothing (plan Review Focus 1).
// P1 follow-up (owner GO 2026-10-12): the notes list renders the caret alone (NewNoteCaret) beside
// its own "+ New note". Both forms run the ONE caret + menu below; only the wrapper differs.
import { useRef, useState, useEffect } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import styles from './NewNoteMenu.module.css'

// The caret and its menu, as siblings: the caller's wrapper is the box the menu hangs from.
function CaretMenu({ caretClass, onFromOutline, onFromStyle, onVoice = null, onToday = null }) {
  const [open, setOpen] = useState(false)
  const caretRef = useRef(null)
  const menuRef = useRef(null)
  // Which item an ArrowDown / ArrowUp on the caret asked for; read once, when the menu opens.
  const wantLast = useRef(false)
  // ⛔ Tour anchors are LITERAL attributes in JSX (tourAnchors.test.js reads them by AST and
  // refuses an expression), so the voice item's anchor is written on its own element below,
  // not carried through this list as data. ("From a style" has no anchor: no tour points at it, and a
  // branch of its own for one costs the Notebook's first open ~200 B.)
  const items = [
    { key: 'outline', label: 'From an outline', run: onFromOutline, icon: 'document' },
    onFromStyle && { key: 'style', label: 'From a style', run: onFromStyle, icon: 'sliders' },
    onVoice && { key: 'voice', label: 'Voice note', run: onVoice, icon: 'mic' },
    onToday && { key: 'today', label: "Today's note", run: onToday, icon: 'sun' },
  ].filter(Boolean)

  useEffect(() => {
    if (!open) return undefined
    const rows = menuRef.current?.querySelectorAll('[role="menuitem"]') || []
    rows[wantLast.current ? rows.length - 1 : 0]?.focus()
    wantLast.current = false
    const away = (e) => {
      // The voice-notes tour keeps this menu open while its card (portalled to <body>, marked
      // `data-tour-card` by GenericTourEngine) describes the voice item: a press on the card's
      // Next is "outside" the menu, and closing here ended the tour before the click landed.
      if (e.target?.closest?.('[data-tour-card]')) return
      if (!menuRef.current?.contains(e.target) && !caretRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const close = () => { setOpen(false); caretRef.current?.focus() }
  // ArrowDown / ArrowUp on the caret open the menu on its first / last item (the menu button pattern);
  // on an already-open menu they just move focus into it.
  const onCaretKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const last = e.key === 'ArrowUp'
    if (!open) { wantLast.current = last; setOpen(true); return }
    const rows = menuRef.current?.querySelectorAll('[role="menuitem"]') || []
    rows[last ? rows.length - 1 : 0]?.focus()
  }
  // Tab (or a click) that takes focus out of the open menu closes it, so it is not left hanging open
  // over the page. Focus staying inside the menu, going back to the caret, or going to the tour card
  // (which keeps the menu open on purpose, see `away`) leaves it open; a null target (the window lost
  // focus) does too, since the pointer handler owns outside presses.
  const onMenuBlur = (e) => {
    const to = e.relatedTarget
    if (!to || menuRef.current?.contains(to) || caretRef.current?.contains(to) || to.closest?.('[data-tour-card]')) return
    setOpen(false)
  }
  const onMenuKey = (e) => {
    const list = [...menuRef.current.querySelectorAll('[role="menuitem"]')]
    const i = list.indexOf(document.activeElement)
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus() }
    // An open menu keeps Left/Right/Home/End to itself, in BOTH forms. The list's caret sits in a
    // role="toolbar" whose Left/Right/Home/End rove its controls (they would move focus out and leave the
    // menu hanging open); on Home nothing roves, but a window-level Left/Right (the video seek shortcuts)
    // no longer sees them while an item holds focus. Home/End go to the first/last item, not the page.
    else if (/^(Arrow[LR]|Home|End)/.test(e.key)) {
      e.stopPropagation()
      // Home/End (not 'Arrow…'): the first/last item. 'End' sorts before 'F', 'Home' after it.
      if (e.key[0] > 'A') { e.preventDefault(); list.at(e.key < 'F' ? -1 : 0).focus() }
    }
  }
  // Focus goes back to the caret BEFORE the item runs: the menu (and the item holding focus) is gone
  // on the next render, and what the item opens (the New-note sheet, the voice dialog) returns focus
  // to whatever held it when it opened.
  const run = (fn) => () => { setOpen(false); caretRef.current?.focus(); fn() }

  return (
    <>
      <button ref={caretRef} type="button" className={caretClass}
        aria-haspopup="menu" aria-expanded={open} aria-label="More ways to start a note"
        onClick={() => setOpen((o) => !o)} onKeyDown={onCaretKey}>
        <UIcon name="chevronDown" size={12} gold={false} />
      </button>
      {open && (
        <div ref={menuRef} className={styles.menu} role="menu" aria-label="Start a note" onKeyDown={onMenuKey} onBlur={onMenuBlur}>
          {items.map((it) => (it.key === 'voice' ? (
            <button key={it.key} type="button" role="menuitem" className={styles.item}
              data-tour="new-note-voice" onClick={run(it.run)}>
              <UIcon name={it.icon} size={14} gold={false} /> {it.label}
            </button>
          ) : (
            <button key={it.key} type="button" role="menuitem" className={styles.item}
              onClick={run(it.run)}>
              <UIcon name={it.icon} size={14} gold={false} /> {it.label}
            </button>
          )))}
        </div>
      )}
    </>
  )
}

// The notes list's form: the caret alone, sized like the list's `btn-sm` "+ New note". No tour
// anchor on the wrapper: "new-note-home" is Home's, and the voice tour starts there. Its CSS (touch
// floor, phone placement) is keyed on `.listCaret`, railed by NewNoteMenu.listCaret.css.test.js.
export function NewNoteCaret(doors) {
  return (
    <div className={styles.listCaret}>
      <CaretMenu caretClass="btn btn-primary btn-sm" {...doors} />
    </div>
  )
}

export default function NewNoteMenu({ onBlank, ...doors }) {
  return (
    <div className={styles.split} data-tour="new-note-home">
      <button type="button" className={`btn btn-primary ${styles.main}`} onClick={onBlank}>
        <UIcon name="plus" size={14} gold={false} /> New note
      </button>
      <CaretMenu caretClass={`btn btn-primary ${styles.caret}`} {...doors} />
    </div>
  )
}

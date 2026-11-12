// B/NewNoteMenu.jsx — Research Home's create door (spec P0.1). One press makes a blank note;
// the caret lists the other ways in. An item appears only when its handler exists, so a gate
// that is off leaves no door that opens nothing (plan Review Focus 1).
// S11 (audit 2026-11-05): the notes list's own caret (NewNoteCaret, P1 follow-up) was retired into the
// list toolbar's "+ New ▾"; that toolbar's three menus run the SAME engine as this caret (`useMenuButton`).
import { useRef, useState, useEffect } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import styles from './NewNoteMenu.module.css'

// ONE menu-button engine (S11, audit 2026-11-05): the New note caret below AND the notes list's own
// toolbar menus (View, New, More, in tabs/NotebookTab.jsx) run this hook, so the keyboard contract is
// written once. Headless on purpose: a caller renders its own trigger <button> (a tour anchor is a
// LITERAL `data-tour` attribute on it, which tourAnchors.test.js reads by AST) and spreads
// `triggerProps` onto it; `menuProps` go on the role="menu" element.
export function useMenuButton() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  // Which item an ArrowDown / ArrowUp on the trigger asked for; read once, when the menu opens.
  const wantLast = useRef(false)

  useEffect(() => {
    if (!open) return undefined
    const rows = rowsOf(menuRef.current)
    rows[wantLast.current ? rows.length - 1 : 0]?.focus()
    wantLast.current = false
    const away = (e) => {
      // The voice-notes tour keeps this menu open while its card (portalled to <body>, marked
      // `data-tour-card` by GenericTourEngine) describes the voice item: a press on the card's
      // Next is "outside" the menu, and closing here ended the tour before the click landed.
      if (e.target?.closest?.('[data-tour-card]')) return
      if (!menuRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const close = () => { setOpen(false); triggerRef.current?.focus() }
  // ArrowDown / ArrowUp on the trigger open the menu on its first / last item (the menu button pattern);
  // on an already-open menu they just move focus into it.
  const onTriggerKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const last = e.key === 'ArrowUp'
    if (!open) { wantLast.current = last; setOpen(true); return }
    const rows = rowsOf(menuRef.current)
    rows[last ? rows.length - 1 : 0]?.focus()
  }
  // Tab (or a click) that takes focus out of the open menu closes it, so it is not left hanging open
  // over the page. Focus staying inside the menu, going back to the trigger, or going to the tour card
  // (which keeps the menu open on purpose, see `away`) leaves it open; a null target (the window lost
  // focus) does too, since the pointer handler owns outside presses.
  const onMenuBlur = (e) => {
    const to = e.relatedTarget
    if (!to || menuRef.current?.contains(to) || triggerRef.current?.contains(to) || to.closest?.('[data-tour-card]')) return
    setOpen(false)
  }
  const onMenuKey = (e) => {
    const list = rowsOf(menuRef.current)
    const i = list.indexOf(document.activeElement)
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus() }
    // An open menu keeps Left/Right/Home/End to itself, in every form. The list's triggers sit in a
    // role="toolbar" whose Left/Right/Home/End rove its controls (they would move focus out and leave the
    // menu hanging open); on Home nothing roves, but a window-level Left/Right (the video seek shortcuts)
    // no longer sees them while an item holds focus. Home/End go to the first/last item, not the page.
    else if (/^(Arrow[LR]|Home|End)/.test(e.key)) {
      e.stopPropagation()
      // Home/End (not 'Arrow…'): the first/last item. 'End' sorts before 'F', 'Home' after it.
      if (e.key[0] > 'A') { e.preventDefault(); list.at(e.key < 'F' ? -1 : 0).focus() }
    }
  }
  // Focus goes back to the trigger BEFORE the item runs: the menu (and the item holding focus) is gone
  // on the next render, and what the item opens (a sheet, a dialog) returns focus to whatever held it
  // when it opened.
  const run = (fn) => () => { setOpen(false); triggerRef.current?.focus(); fn?.() }

  return {
    open,
    run,
    triggerProps: {
      ref: triggerRef,
      'aria-haspopup': 'menu',
      'aria-expanded': open,
      onClick: () => setOpen((o) => !o),
      onKeyDown: onTriggerKey,
    },
    menuProps: { ref: menuRef, className: styles.menu, role: 'menu', onKeyDown: onMenuKey, onBlur: onMenuBlur },
  }
}
const ROW = '[role="menuitem"], [role="menuitemradio"]'
// Tier 1b fix round 1 (review Important 4): a row with NO BOX (the list's phone-only ⋯ rows on a desktop) is not a
// stop -- focusing it is a no-op that left the menu open with focus nowhere useful. Where NOTHING has a box (a test
// environment with no layout) every row counts: the same rule as lib/useToolbarRoving.js.
function rowsOf(menuEl) {
  const all = [...(menuEl?.querySelectorAll(ROW) || [])]
  const shown = all.filter((el) => el.getClientRects().length > 0)
  return shown.length ? shown : all
}

/** The rows of a `useMenuButton` menu. `items`: {key, label, icon?, run, checked?, separator?, className?}. A row whose
 *  `checked` is a boolean is a `menuitemradio` (the View menu's modes); `separator: true` draws a rule.
 *  Notebook simplify, Task 3: `{key, group, items, heading?, className?}` is a named role="group" of rows (the View
 *  menu's "List layout" under List, the New menu's "Reviews"); `heading: true` also draws its name, set apart by a rule.
 *  Its rows are still the menu's rows, so the menu's Up and Down reach them. */
export function MenuRows({ menu, items }) {
  return items.map((it) => {
    if (it.separator) return <div key={it.key} role="separator" className={styles.separator} />
    if (it.group) {
      return (
        <div key={it.key} role="group" aria-label={it.group}
          className={`${it.heading ? styles.group : ''} ${it.className || ''}`}>
          {it.heading && <div className={styles.groupLabel} aria-hidden="true">{it.group}</div>}
          <MenuRows menu={menu} items={it.items} />
        </div>
      )
    }
    const radio = typeof it.checked === 'boolean'
    return (
      <button key={it.key} type="button" role={radio ? 'menuitemradio' : 'menuitem'}
        aria-checked={radio ? it.checked : undefined}
        className={`${styles.item} ${it.checked ? styles.itemChecked : ''} ${it.className || ''}`} onClick={menu.run(it.run)}>
        {it.icon && <UIcon name={it.icon} size={14} gold={false} />} {it.label}
      </button>
    )
  })
}

// The caret and its menu, as siblings: the caller's wrapper is the box the menu hangs from.
function CaretMenu({ caretClass, onFromOutline, onFromStyle, onVoice = null, onToday = null }) {
  const menu = useMenuButton()
  // ⛔ Tour anchors are LITERAL attributes in JSX (tourAnchors.test.js reads them by AST and
  // refuses an expression), so the voice item's anchor is written on its own element below,
  // not carried through this list as data. ("From a template" has no anchor: no tour points at it, and a
  // branch of its own for one costs the Notebook's first open ~200 B.)
  const items = [
    { key: 'outline', label: 'From an outline', run: onFromOutline, icon: 'document' },
    onFromStyle && { key: 'style', label: 'From a template', run: onFromStyle, icon: 'sliders' },
    onVoice && { key: 'voice', label: 'Voice note', run: onVoice, icon: 'mic' },
    onToday && { key: 'today', label: "Today's note", run: onToday, icon: 'sun' },
  ].filter(Boolean)

  return (
    <>
      <button {...menu.triggerProps} type="button" className={caretClass} aria-label="More ways to start a note">
        <UIcon name="chevronDown" size={12} gold={false} />
      </button>
      {menu.open && (
        <div {...menu.menuProps} aria-label="Start a note">
          {items.map((it) => (it.key === 'voice' ? (
            <button key={it.key} type="button" role="menuitem" className={styles.item}
              data-tour="new-note-voice" onClick={menu.run(it.run)}>
              <UIcon name={it.icon} size={14} gold={false} /> {it.label}
            </button>
          ) : (
            <button key={it.key} type="button" role="menuitem" className={styles.item}
              onClick={menu.run(it.run)}>
              <UIcon name={it.icon} size={14} gold={false} /> {it.label}
            </button>
          )))}
        </div>
      )}
    </>
  )
}

export default function NewNoteMenu({ onBlank, ...doors }) {
  return (
    <div className={styles.split} data-tour="new-note-home">
      <button type="button" className={`btn btn-primary ${styles.main}`} onClick={onBlank} data-guide="journal.newNote">
        <UIcon name="plus" size={14} gold={false} /> New note
      </button>
      <CaretMenu caretClass={`btn btn-primary ${styles.caret}`} {...doors} />
    </div>
  )
}

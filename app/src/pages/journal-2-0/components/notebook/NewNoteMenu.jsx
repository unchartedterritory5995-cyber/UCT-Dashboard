// NewNoteMenu.jsx -- the Notebook's ONE menu-button engine (`useMenuButton`) and the rows it draws (`MenuRows`).
// The name is historical: it was Research Home's create door (spec P0.1), a split button whose caret listed the other
// ways to start a note. S11 (audit 2026-11-05) moved the notes list's toolbar menus onto the same engine, and go-live
// wave 1 deleted the split button itself with Research home. What is left is used by the list's View, New and More
// menus (tabs/NotebookTab.jsx), the note's "AI" and "Aa" menus and the saved views group.
import { Fragment, useRef, useState, useEffect, useLayoutEffect } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import styles from './NewNoteMenu.module.css'

// ONE menu-button engine (S11, audit 2026-11-05): the notes list's toolbar menus (View, New, More, in
// tabs/NotebookTab.jsx) and the note's own menus run this hook, so the keyboard contract is written once. Headless on purpose: a caller renders its own trigger <button> (a tour anchor is a
// LITERAL `data-tour` attribute on it, which tourAnchors.test.js reads by AST) and spreads
// `triggerProps` onto it; `menuProps` go on the role="menu" element.
export function useMenuButton() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  // Which item an ArrowDown / ArrowUp on the trigger asked for; read once, when the menu opens.
  const wantLast = useRef(false)

  // Final fix (C3): the room from the open menu's top to the foot of the window, as `--menu-room` on the menu. On a
  // phone the menu's height is held to it, less the floating "+" (NewNoteMenu.module.css), and the rows scroll inside
  // it: the list's ⋯ menu is a dozen rows, and its last ones sat under the "+" or past the screen's end. A layout
  // effect, so the first frame of the open menu is already the right height. Arrow keys focus a row, and focusing a
  // row scrolls it into view inside the menu.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!open || !el) return
    const top = el.getBoundingClientRect().top
    el.style.setProperty('--menu-room', `${Math.max(0, Math.round(window.innerHeight - top))}px`)
  }, [open])

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
// Go-live wave 1, fix round 1 (review 4b): nor is a DISABLED row (the Reviews rows while a draft runs): focus() on a
// disabled button does nothing, so Up/Down/End stuck on it.
function rowsOf(menuEl) {
  const all = [...(menuEl?.querySelectorAll(ROW) || [])].filter((el) => !el.disabled)
  const shown = all.filter((el) => el.getClientRects().length > 0)
  return shown.length ? shown : all
}

/** The rows of a `useMenuButton` menu. `items`: {key, label, icon?, run, checked?, separator?, className?, disabled?}. A row whose
 *  `checked` is a boolean is a `menuitemradio` (the View menu's modes); `separator: true` draws a rule.
 *  Notebook simplify, Task 3: `{key, group, items, heading?, className?}` is a named role="group" of rows (the View
 *  menu's "List layout" under List, the New menu's "Reviews"); `heading: true` also draws its name, set apart by a rule.
 *  Its rows are still the menu's rows, so the menu's Up and Down reach them.
 *  Go-live wave 1: `render(rowProps, content)` lets the caller draw a row (or a group's box) itself, from the props and
 *  content MenuRows would have used. It exists for walkthrough anchors: a `data-tour` is a LITERAL attribute in the
 *  file its tour step names (onboarding/tourAnchors.test.js reads it by AST and refuses an expression), so the caller
 *  writes `<button {...rowProps} data-tour="...">{content}</button>` in its own file. */
export function MenuRows({ menu, items }) {
  return items.map((it) => {
    if (it.separator) return <div key={it.key} role="separator" className={styles.separator} />
    if (it.group) {
      const groupProps = {
        role: 'group', 'aria-label': it.group, className: `${it.heading ? styles.group : ''} ${it.className || ''}`,
      }
      const groupContent = (
        <>
          {it.heading && <div className={styles.groupLabel} aria-hidden="true">{it.group}</div>}
          <MenuRows menu={menu} items={it.items} />
        </>
      )
      if (it.render) return <Fragment key={it.key}>{it.render(groupProps, groupContent)}</Fragment>
      return <div key={it.key} {...groupProps}>{groupContent}</div>
    }
    const radio = typeof it.checked === 'boolean'
    const rowProps = {
      type: 'button',
      role: radio ? 'menuitemradio' : 'menuitem',
      'aria-checked': radio ? it.checked : undefined,
      className: `${styles.item} ${it.checked ? styles.itemChecked : ''} ${it.className || ''}`,
      onClick: menu.run(it.run),
      // Go-live wave 1 (D4): a row whose door is busy (a review drafting) cannot be pressed again meanwhile.
      disabled: it.disabled || undefined,
    }
    const content = <>{it.icon && <UIcon name={it.icon} size={14} gold={false} />} {it.label}</>
    if (it.render) return <Fragment key={it.key}>{it.render(rowProps, content)}</Fragment>
    return <button key={it.key} {...rowProps}>{content}</button>
  })
}

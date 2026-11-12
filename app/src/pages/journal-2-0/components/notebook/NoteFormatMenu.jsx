// Notebook simplify, Task 4 ("a calmer editor"): the DESKTOP formatting row's "Aa" menu.
//
// The owner found the Notebook "noisy". At 1025 px and up the formatting row keeps the controls a
// trader reaches for while writing (B, I, H1, H2, the two lists, link, image, the mic, Insert) and
// the rest wait behind this ONE door: Font, Size, Text color and highlight, Quote, Code, Attach a
// file and Divider. Each item runs exactly what its row control runs (the same editor command, the
// same file input, the same colour picker); the row controls themselves still exist and still
// serve the touch tier, where nothing changed (NoteEditorPage.module.css, `.foldDesktop`).
//
// ⛔ NOT THE PHONE'S "Aa". The touch tier has its own "Aa" glyph on the Format DISCLOSURE (accessible
// name "Format", `data-format-toggle`), which opens the row's runs in place. This is a separate,
// desktop-only MENU BUTTON named "More formatting"; the two never render at the same width.
//
// ONE menu engine: `useMenuButton` (NewNoteMenu.jsx), the one the notes list's View, New and More
// menus run, so Escape, an outside press, Tab out and focus going back to "Aa" behave the same.
// Font and Size are lists, not single commands, so they open a second view INSIDE the same menu
// (with a "Back" row first) rather than a select inside a role="menu", which a menu cannot hold.
//
// ⛔ It reads NO editor state itself. `format` is the toolbar's own signature object
// (`readToolbarFormatState`, held by NoteEditorPage's reducer), so this door can never go stale
// behind the reducer's bailout (NoteEditorPage.toolbarSignatureAudit.test.js).
import { useEffect, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { TOOLBAR_ICON } from '../../lib/notebookIcons'
import { FONT_OPTIONS } from '../../../../utils/fontFamilies'
import { useMenuButton } from './NewNoteMenu'
import menuStyles from './NewNoteMenu.module.css'
import { TEXT_COLOR_MENU_LABEL } from './TextColorMenu'
import styles from './NoteFormatMenu.module.css'

export const MORE_FORMATTING = 'More formatting'
const QUOTE_IN_LIST = "Quote isn't available inside a list -- exit the list first"

/**
 * @param editor       the TipTap editor the commands run on
 * @param format       the toolbar signature (`readToolbarFormatState`), or null before the first read
 * @param fontSizes    the sizes the row's Size select offers, in px numbers
 * @param onColor      opens the colour picker anchored here (NoteEditorPage owns the picker's state)
 * @param onAttach     the row's "Attach a file" door (its hidden file input)
 * @param triggerRef   optional ref that ALSO receives the "Aa" button (the colour picker's toggle)
 * @param buttonClassName / activeClassName   the row's own button classes, so "Aa" looks like its neighbours
 * @param children     rendered inside the anchor, after the menu (the colour picker, when it opened from here)
 */
export default function NoteFormatMenu({
  editor, format, fontSizes, onColor, onAttach, triggerRef = null,
  buttonClassName = '', activeClassName = '', children = null,
}) {
  const menu = useMenuButton()
  const [view, setView] = useState('root')   // root | font | size
  const f = format || {}
  // "Aa" reads as active while the caret is in a quote or a code block: two of its items are on.
  const active = Boolean(f.blockquote || f.codeBlock)

  // A closed menu always reopens on its first view.
  useEffect(() => { if (!menu.open) setView('root') }, [menu.open])
  // A second view replaces the rows, so focus goes to its first row ("Back").
  useEffect(() => {
    if (!menu.open || view === 'root') return
    menu.menuProps.ref.current?.querySelector('[role^="menuitem"]')?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per view change
  }, [view])
  // Back to the first view puts focus on the row that opened the list.
  const back = (from) => () => {
    setView('root')
    requestAnimationFrame(() => menu.menuProps.ref.current?.querySelector(`[data-format-item="${from}"]`)?.focus())
  }

  const chain = () => editor.chain().focus()
  const item = (key, label, onClick, extra = {}) => (
    <button key={key} type="button" role="menuitem" className={`${menuStyles.item} ${extra.className || ''}`}
      data-format-item={key} onClick={onClick} aria-disabled={extra.disabled || undefined}
      title={extra.title} aria-haspopup={extra.sub ? 'menu' : undefined}>
      {extra.icon && <UIcon name={extra.icon} {...TOOLBAR_ICON} />}
      <span className={styles.label}>{label}</span>
      {extra.sub && <UIcon name="chevronRight" {...TOOLBAR_ICON} />}
    </button>
  )
  const radio = (key, label, checked, onPick, style) => (
    <button key={key} type="button" role="menuitemradio" aria-checked={checked}
      className={`${menuStyles.item} ${checked ? styles.checked : ''}`} style={style} onClick={menu.run(onPick)}>
      <span className={styles.label}>{label}</span>
    </button>
  )

  let rows
  if (view === 'font') {
    rows = [
      item('back', 'Back', back('font'), { icon: 'chevronLeft' }),
      <div key="sep" role="separator" className={menuStyles.separator} />,
      ...FONT_OPTIONS.map((o) => radio(`font:${o.label}`, o.label, (f.fontFamily || '') === o.value,
        () => (o.value ? chain().setFontFamily(o.value).run() : chain().unsetFontFamily().run()),
        o.value ? { fontFamily: o.value } : undefined)),
    ]
  } else if (view === 'size') {
    rows = [
      item('back', 'Back', back('size'), { icon: 'chevronLeft' }),
      <div key="sep" role="separator" className={menuStyles.separator} />,
      radio('size:default', 'Default', !f.fontSize, () => chain().unsetFontSize().run()),
      ...fontSizes.map((s) => radio(`size:${s}`, String(s), f.fontSize === `${s}px`,
        () => chain().setFontSize(`${s}px`).run())),
    ]
  } else {
    const quoteOk = f.canBlockquote !== false
    rows = [
      item('font', 'Font', () => setView('font'), { sub: true }),
      item('size', 'Size', () => setView('size'), { sub: true }),
      item('color', TEXT_COLOR_MENU_LABEL, menu.run(onColor)),
      item('quote', 'Quote', quoteOk ? menu.run(() => chain().toggleBlockquote().run()) : undefined, {
        disabled: !quoteOk, title: quoteOk ? undefined : QUOTE_IN_LIST,
        className: f.blockquote ? styles.checked : '',
      }),
      item('code', 'Code', menu.run(() => chain().toggleCodeBlock().run()), {
        className: f.codeBlock ? styles.checked : '',
      }),
      item('attach', 'Attach a file', menu.run(onAttach)),
      item('divider', 'Divider', menu.run(() => chain().setHorizontalRule().run())),
    ]
  }

  const { ref: menuTriggerRef, ...trigger } = menu.triggerProps
  return (
    <span className={styles.anchor}>
      <button
        {...trigger}
        ref={(el) => { menuTriggerRef.current = el; if (triggerRef) triggerRef.current = el }}
        type="button"
        className={`${buttonClassName} ${active ? activeClassName : ''}`}
        aria-label={MORE_FORMATTING}
        title="More formatting: font, size, color, quote, code, attach a file, divider"
        data-active={active ? 'true' : undefined}
        data-more-formatting=""
      >
        <span aria-hidden="true" className={styles.glyph}>Aa</span>
      </button>
      {menu.open && (
        <div {...menu.menuProps} aria-label={MORE_FORMATTING}
          className={`${menu.menuProps.className} ${styles.menuStart} ${view === 'root' ? '' : styles.list}`}>
          {rows}
        </div>
      )}
      {children}
    </span>
  )
}

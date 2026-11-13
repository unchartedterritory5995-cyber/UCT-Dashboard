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
import { FONT_OPTIONS } from '../../../../utils/fontFamilies'
import { MenuRows, useMenuButton } from './NewNoteMenu'
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
  const f = format || {}
  // "Aa" reads as active while the caret is in a quote or a code block: two of its items are on.
  const active = Boolean(f.blockquote || f.codeBlock)

  const chain = () => editor.chain().focus()
  const on = menuStyles.itemChecked
  const quoteOk = f.canBlockquote !== false
  // Simplify pass 2: Font and Size are second views of the ONE menu engine (MenuRows `children`), which lifted the
  // view this file used to keep itself. A font row is drawn in its own face.
  const items = [
    {
      key: 'font', label: 'Font',
      children: FONT_OPTIONS.map((o) => ({
        key: `font:${o.label}`, label: o.label, checked: (f.fontFamily || '') === o.value,
        run: () => (o.value ? chain().setFontFamily(o.value).run() : chain().unsetFontFamily().run()),
        render: o.value ? (p, c) => <button {...p} style={{ fontFamily: o.value }}>{c}</button> : undefined,
      })),
    },
    {
      key: 'size', label: 'Size',
      children: [
        { key: 'size:default', label: 'Default', checked: !f.fontSize, run: () => chain().unsetFontSize().run() },
        ...fontSizes.map((s) => ({
          key: `size:${s}`, label: String(s), checked: f.fontSize === `${s}px`, run: () => chain().setFontSize(`${s}px`).run(),
        })),
      ],
    },
    { key: 'color', label: TEXT_COLOR_MENU_LABEL, run: onColor },
    {
      key: 'quote', label: 'Quote', run: () => chain().toggleBlockquote().run(), className: f.blockquote ? on : '',
      // Inside a list it stays a stop that says why (its title), and pressing it does nothing.
      render: quoteOk ? undefined : (p, c) => <button {...p} onClick={undefined} aria-disabled title={QUOTE_IN_LIST}>{c}</button>,
    },
    { key: 'code', label: 'Code', run: () => chain().toggleCodeBlock().run(), className: f.codeBlock ? on : '' },
    { key: 'attach', label: 'Attach a file', run: onAttach },
    { key: 'divider', label: 'Divider', run: () => chain().setHorizontalRule().run() },
  ]

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
          className={`${menu.menuProps.className} ${styles.menuStart} ${menu.sub ? styles.list : ''}`}>
          <MenuRows menu={menu} items={items} label={MORE_FORMATTING} />
        </div>
      )}
      {children}
    </span>
  )
}

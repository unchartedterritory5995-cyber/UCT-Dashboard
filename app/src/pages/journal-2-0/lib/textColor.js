/**
 * Wave 5 — text colour and highlight: ONE small palette, stored by NAME.
 *
 * ⛔ A PALETTE NAME, NEVER A COLOUR VALUE. The stock Color / multicolour
 * Highlight extensions store the CSS value itself (`style="color: #d33"`).
 * A value chosen on the dark theme is unreadable on the light one — red text
 * picked against #101012 is a different red from the one that reads on
 * #ffffff — and a stored hex can never follow the member's theme. So the
 * document stores `red`, and `noteContent.css` maps each name to a token that
 * ALREADY carries a light-theme value (--loss, --gain, --info, …). Changing a
 * shade is then one CSS line, applied to every note ever written, in both
 * themes, on every surface that renders a note.
 *
 * A foreign colour pasted from another app (any `style="color: …"`) is not
 * one of ours and is dropped — the words arrive, the arbitrary colour does
 * not. A foreign `<mark>` is kept as the default (yellow) highlight.
 *
 * Citation text: marks contribute nothing (note_citation_text.py header), so
 * neither mark needs a row in the tables; the `colouredMarks` fixture pins
 * that both runtimes read coloured text exactly as plain text.
 * Markdown: a highlight exports as `==text==` (Obsidian's syntax, which the
 * Highlight input rule also reads back); a text colour exports as its words.
 */
import { Mark, mergeAttributes } from '@tiptap/core'
import { Highlight } from '@tiptap/extension-highlight'

/** The palette, in the order the picker shows it. `name` is what a note stores. */
export const NOTE_COLORS = Object.freeze([
  { name: 'gray', label: 'Gray' },
  { name: 'red', label: 'Red' },
  { name: 'orange', label: 'Orange' },
  { name: 'yellow', label: 'Yellow' },
  { name: 'green', label: 'Green' },
  { name: 'blue', label: 'Blue' },
].map(Object.freeze))

const NAMES = new Set(NOTE_COLORS.map((c) => c.name))
/** A palette name, or null for anything else (a hex, a foreign name, junk). */
export function paletteName(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return NAMES.has(v) ? v : null
}

/** The raw class a palette colour renders through (styled in noteContent.css). */
export const textColorClass = (name) => `uct-tc uct-tc-${name}`
export const highlightClass = (name) => (name ? `uct-hl uct-hl-${name}` : 'uct-hl')

export const TextColor = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => paletteName(el.getAttribute('data-text-color')),
        renderHTML: (attrs) => (attrs.color
          ? { 'data-text-color': attrs.color, class: textColorClass(attrs.color) }
          : {}),
      },
    }
  },

  parseHTML() {
    // Only OUR spans: a colour outside the palette is not a mark we can hold.
    return [{ tag: 'span[data-text-color]', getAttrs: (el) => (paletteName(el.getAttribute('data-text-color')) ? null : false) }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setTextColor: (name) => ({ commands }) => {
        const color = paletteName(name)
        return color ? commands.setMark(this.name, { color }) : false
      },
      unsetTextColor: () => ({ commands }) => commands.unsetMark(this.name),
    }
  },
})

/**
 * TipTap's Highlight, with its colour stored as a palette NAME and rendered
 * through a class. Its keyboard shortcut (Mod-Shift-H, the default highlight)
 * and its `==text==` input and paste rules are kept as they are.
 */
export const NotebookHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => paletteName(el.getAttribute('data-color')),
        renderHTML: (attrs) => (attrs.color
          ? { 'data-color': attrs.color, class: highlightClass(attrs.color) }
          : { class: highlightClass(null) }),
      },
    }
  },
}).configure({ multicolor: true })

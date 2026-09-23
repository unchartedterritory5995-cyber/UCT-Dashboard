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
 * input rule below also reads back); a text colour exports as its words.
 */
import { InputRule, Mark, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
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
        // Narrowed again on the way out: JSON content never passes parseHTML,
        // so a stored value outside the palette must not become a class.
        renderHTML: (attrs) => {
          const name = paletteName(attrs.color)
          return name ? { 'data-text-color': name, class: textColorClass(name) } : {}
        },
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
 * `==text==` → a highlight, written for a trader's text.
 *
 * ⛔ TipTap's own rules matched ANY `==…==` pair: typing
 * "if rsi == 30 and macd == 0" highlighted " 30 and macd " and ate both
 * operators, and pasting it did the same. So, like `$…$` in mathNodes.js:
 *  - the opening `==` starts the text or follows a space or an opening
 *    bracket, and a non-space character follows it;
 *  - the closing `==` follows a non-space character, and the rule fires only
 *    when the member types a SPACE or punctuation right after it — so
 *    "x==y" and "a == b" never fire;
 *  - there is NO paste rule. Pasted text arrives exactly as it was copied.
 * No lookbehind (the iOS 16 floor, app/src/noRegexLookbehind.test.js): the
 * lead character is CAPTURED and the handler skips over it.
 */
const HIGHLIGHT_FIND = /(^|[\s([{])==([^=\s](?:[^=\n]*?[^=\s])?)==([\s.,;:!?)\]}])$/
export const HIGHLIGHT_INPUT_PATTERN = HIGHLIGHT_FIND

/** Attributes with the colour narrowed to a palette name (or null = default). */
const narrowHighlight = (attrs) => ({ ...(attrs || {}), color: paletteName(attrs?.color) })

/**
 * TipTap's Highlight, with its colour stored as a palette NAME and rendered
 * through a class. Its keyboard shortcut (Mod-Shift-H, the default highlight)
 * is kept; its `==text==` rules are replaced (see HIGHLIGHT_FIND).
 */
export const NotebookHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => paletteName(el.getAttribute('data-color')),
        renderHTML: (attrs) => {
          const name = paletteName(attrs.color)
          return name
            ? { 'data-color': name, class: highlightClass(name) }
            : { class: highlightClass(null) }
        },
      },
    }
  },

  // Every door that sets a colour narrows it: `setHighlight({ color: '#f00' })`
  // stores the default highlight, never a hex (a stored hex cannot follow the
  // theme — the header).
  addCommands() {
    const name = this.name
    return {
      setHighlight: (attributes) => ({ commands }) => commands.setMark(name, narrowHighlight(attributes)),
      toggleHighlight: (attributes) => ({ commands }) => commands.toggleMark(name, narrowHighlight(attributes)),
      unsetHighlight: () => ({ commands }) => commands.unsetMark(name),
    }
  },

  addInputRules() {
    const type = this.type
    return [
      new InputRule({
        find: HIGHLIGHT_FIND,
        handler: ({ state, range, match }) => {
          const [, lead, inner, trail] = match
          const { tr, doc, schema } = state
          const open = range.from + lead.length
          // The matcher read a text rendering; act only when the document
          // holds exactly those characters (an inline atom in between would
          // shift every position).
          if (doc.textBetween(open, range.to, '\n', '￼') !== `==${inner}==`) return null
          const trailMarks = (state.storedMarks || doc.resolve(range.to).marks()).filter((m) => m.type !== type)
          tr.delete(range.to - 2, range.to)
          tr.delete(open, open + 2)
          const end = open + inner.length
          tr.addMark(open, end, type.create())
          tr.insert(end, schema.text(trail, trailMarks))
          tr.removeStoredMark(type)
          tr.setSelection(TextSelection.create(tr.doc, end + trail.length))
          return undefined
        },
      }),
    ]
  },

  addPasteRules() {
    return []
  },
}).configure({ multicolor: true })

/**
 * Wave 5 — the emoji picker: type `:` and a name (`:rock` → 🚀).
 *
 * The same Suggestion + listbox + ARIA-combobox pattern as the `/` slash menu
 * and the `[[` note-link menu (applyComboboxWiring), on its OWN plugin key.
 * What it inserts is plain Unicode TEXT (lib/emojiData.js explains why no
 * emoji node): it saves, searches, exports and cites like any letter.
 *
 * ⛔ A NOTE IS FULL OF COLONS. "10:30", "Note: …", "3:1", "ratio:" must never
 * open a menu or swallow a key, so the menu arms only when the `:` starts a
 * word (after a space, a bracket or at the start of a line — Suggestion's
 * `allowedPrefixes`) AND a shortcode-shaped query of at least
 * EMOJI_MENU_MIN_QUERY characters follows it, never inside code. With no
 * match the menu renders nothing and every key passes through (the slash
 * menu's Enter-trap lesson).
 *
 * ⛔ TWO characters, not one: every letter is the start of some shortcode, so
 * a one-character floor armed the menu on the emoticons a trader types --
 * "great day :D" + Enter inserted 💵 and ate the new line, "ok :P" + Tab
 * inserted 📌. A one-letter shortcode (`:x:`) still converts typed whole.
 *
 * ⛔ And at TWO characters, only lower case (re-review, the S2 residue): two
 * characters are either the start of a shortcode -- every shortcode is lower
 * case, and that is how a member types one -- or an emoticon, which wears a
 * capital mouth (":oP", ":Oo", ":xD") or a nose (":-1", ":-P"). ":oP" opened
 * the menu on "open_mouth". So a two-character query arms it only when it is
 * lower-case letters, digits or `_`; from three characters any shortcode-shaped
 * query does (`:Roc` opens it, as `:roc` does). `:-1:` and `:+1:` typed whole
 * still convert.
 *
 * Keyboard: ↑/↓ move, Enter or Tab insert, Escape closes it (the Suggestion
 * plugin's own dismissal).
 * Touch: a tap on a row inserts (44px rows on the touch tier). Typing a whole
 * shortcode (`:rocket:`) converts on the closing colon without the menu.
 */
import { Extension, InputRule } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { SHORTCODE_BODY, emojiByName, searchEmoji } from '../../lib/emojiData'
import { applyComboboxWiring } from '../../lib/comboboxWiring'
import styles from './EmojiMenu.module.css'

export const EMOJI_MENU_ID = 'uct-emoji-menu'
export const EMOJI_MENU_MIN_QUERY = 2
// How long a query can be and still be an emoticon rather than a shortcode.
const EMOTICON_MAX_LENGTH = 2
const SHORTCODE_START = /^[a-z0-9_]+$/

/** Does what was typed after `:` open the menu? (See the ⛔ notes above.) */
export function emojiMenuArms(query) {
  const q = String(query || '')
  if (q.length < EMOJI_MENU_MIN_QUERY) return false
  if (q.length <= EMOTICON_MAX_LENGTH && !SHORTCODE_START.test(q)) return false
  return true
}
export const emojiMenuPluginKey = new PluginKey('emojiMenu')

const inCode = (state, pos) => {
  const $pos = state.doc.resolve(pos)
  return Boolean($pos.parent.type.spec.code || $pos.marks().some((m) => m.type.spec.code))
}

const EmojiList = forwardRef((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const { items } = props

  useEffect(() => setSelectedIndex(0), [items])
  useEffect(() => {
    props.onActiveChange?.(items.length ? `${EMOJI_MENU_ID}-opt-${selectedIndex}` : null)
  }, [selectedIndex, items]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false
      if (event.key === 'ArrowUp') { setSelectedIndex((selectedIndex + items.length - 1) % items.length); return true }
      if (event.key === 'ArrowDown') { setSelectedIndex((selectedIndex + 1) % items.length); return true }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[selectedIndex]
        if (item) props.command(item)
        return true
      }
      return false
    },
  }))

  if (!items.length) return null
  return (
    <div className={styles.menu} role="listbox" id={EMOJI_MENU_ID} aria-label="Insert emoji">
      {items.map((item, i) => (
        <button
          key={item.name}
          type="button"
          role="option"
          id={`${EMOJI_MENU_ID}-opt-${i}`}
          aria-selected={i === selectedIndex}
          aria-label={`${item.char} ${item.name.replace(/_/g, ' ')}`}
          className={`${styles.item} ${i === selectedIndex ? styles.itemActive : ''}`}
          onMouseDown={(e) => { e.preventDefault(); props.command(item) }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span className={styles.char} aria-hidden="true">{item.char}</span>
          <span className={styles.name} aria-hidden="true">:{item.name}:</span>
        </button>
      ))}
    </div>
  )
})
EmojiList.displayName = 'EmojiList'

// `:rocket:` typed whole: converts on the closing colon. The opening colon must
// start a word, exactly as for the menu (no lookbehind -- the lead is captured).
// Built from the one shortcode shape (lib/emojiData.js), case-insensitive like
// the menu, so `:Rocket:` converts exactly as picking `:Rocket` would.
const SHORTCODE_FIND = new RegExp(`(^|[\\s([{])(:(${SHORTCODE_BODY}):)$`, 'i')
export const EMOJI_INPUT_PATTERN = SHORTCODE_FIND

export const EmojiMenuExtension = Extension.create({
  name: 'emojiMenu',

  addInputRules() {
    return [new InputRule({
      find: SHORTCODE_FIND,
      handler: ({ state, range, match }) => {
        const emoji = emojiByName(match[3])
        if (!emoji) return null
        const start = range.from + match[1].length
        state.tr.insertText(emoji.char, start, range.to)
        return undefined
      },
    })]
  },

  addProseMirrorPlugins() {
    return [Suggestion({
      editor: this.editor,
      pluginKey: emojiMenuPluginKey,
      char: ':',
      allowSpaces: false,
      allowedPrefixes: [' ', '(', '[', '{'],
      allow: ({ state, range }) => !inCode(state, range.from),
      // What may match: searchEmoji answers [] for anything that is not
      // shortcode-shaped (":)", ": ", an empty query), and emojiMenuArms
      // answers no for a query too short (":D", ":P") or emoticon-shaped
      // (":oP", ":-1"). An empty list renders nothing and passes every key
      // through (EmojiList).
      items: ({ query }) => (emojiMenuArms(query) ? searchEmoji(query) : []),
      command: ({ editor, range, props }) => {
        editor.chain().focus().insertContentAt(range, props.char).run()
      },
      render: () => {
        let component
        let popup
        let getRect = null
        let editorDom = null
        const position = () => {
          if (!popup) return
          const rect = getRect?.()
          if (!rect) return
          const w = popup.offsetWidth || 0
          const h = popup.offsetHeight || 0
          popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - w - 8))}px`
          let top = rect.bottom + 6
          if (h && top + h > window.innerHeight - 8) top = Math.max(8, rect.top - 6 - h)
          popup.style.top = `${top}px`
        }
        const onViewportChange = () => position()
        const setActive = (id) => {
          applyComboboxWiring(editorDom, { menuId: EMOJI_MENU_ID, activeId: id, showing: Boolean(id) })
        }
        return {
          onStart: (props) => {
            getRect = props.clientRect
            editorDom = props.editor?.view?.dom || null
            component = new ReactRenderer(EmojiList, { props: { ...props, onActiveChange: setActive }, editor: props.editor })
            popup = document.createElement('div')
            popup.className = styles.popupWrap
            popup.style.position = 'fixed'
            popup.style.zIndex = 9999
            popup.appendChild(component.element)
            document.body.appendChild(popup)
            position()
            requestAnimationFrame(position)
            window.addEventListener('scroll', onViewportChange, true)
            window.addEventListener('resize', onViewportChange)
          },
          onUpdate(props) {
            getRect = props.clientRect
            component?.updateProps({ ...props, onActiveChange: setActive })
            position()
          },
          // ⛔ Escape is NOT handled here: @tiptap/suggestion v3 owns it -- it
          // exits the session (onExit below removes the popup) and keeps that
          // range dismissed until the member types on. A second dismissal
          // path here would be a guard no rail can tell apart from the first.
          onKeyDown(props) {
            if (props.event.key === 'Escape') return false
            return component?.ref?.onKeyDown?.(props) ?? false
          },
          onExit() {
            window.removeEventListener('scroll', onViewportChange, true)
            window.removeEventListener('resize', onViewportChange)
            setActive(null)
            popup?.remove()
            component?.destroy()
            popup = null
            component = null
          },
        }
      },
    })]
  },
})

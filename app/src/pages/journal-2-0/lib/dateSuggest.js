// P0.9 -- the `@` date suggestions. `@tomorrow ` with a trailing space was the only way to a due
// date and typing `@` showed nothing; this lists the choices as you type.
//
// What it inserts is the EXISTING `dateMention` node (dateMentionNode.js): no new node type, no
// new attribute, so the schema, the citation tables and the tasks reader (which takes a
// dateMention inside a task as its due date) are untouched. The input rule that turns
// "@tomorrow " into the same node is untouched too, and both doors end at the same node.
//
// ⛔ ONE COMMAND. `runDateCommand` is the only thing that inserts a choice: the extension's
// `command` calls it, so does the list's Enter and tap, and so do the rails. A second insertion
// path would be a second authority over what a chosen date becomes.
//
// ⛔ THE LIST ARMS ONLY ON A DATE-SHAPED QUERY. "@john", "@5pm", "@gmail" offer nothing, so the
// menu renders nothing and every key reaches the editor -- the lesson of the slash menu's Enter
// trap and the emoji menu's two-character floor. "Pick a date…" appears only for a bare "@", the
// browse state. And the "@" must start a word (a space or "(" before it, or the start of the
// line), so an email address never opens it; never inside code.
//
// ⛔ ENTER ENDS A LINE, SO IT NEVER PICKS A DATE UNCHOSEN. No row is pre-selected (see
// DateSuggestList.jsx): "Buy NVDA @" + Enter and "ask @tom" + Enter are a new line, not a date.
// A date goes in by down-arrow then Enter, by a tap, or by Tab (the first row).
//
// ⛔ ONE SUGGESTION AT A TIME. Slash and note-link sessions allow spaces, so `/chart AMD @` and
// `[[Weekly review @` are still inside THEIR sessions; the date list stays shut there, or it
// would claim the arrows and Enter that belong to the open command.
//
// ⛔ `items` runs on every transaction while the list is open, on the typing path: it is pure and
// synchronous (a fixed handful of day-number sums, no fetch, no Intl beyond todayET's shared
// formatter).
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { importWithOneRetry } from './lazyChunk'
import { isIsoDate, resolveDateWord } from './dateMentionNode'
import { todayET } from './calendar'
import { SuggestionPluginKey as slashMenuPluginKey } from '@tiptap/suggestion'
import { applyComboboxWiring } from './comboboxWiring'
import { noteLinkMenuPluginKey } from '../components/notebook/NoteLinkMenu'
import { DATE_SUGGEST_MENU_ID } from './dateSuggestMenuId'

// I4 (final review, spec section 6: every new surface lazy). The list's UI -- the listbox, its
// date input and its stylesheet -- is a separate chunk, fetched on the FIRST `@` of the page and
// kept. The plugin, `dateChoices` and `runDateCommand` stay here: they are small and they are what
// the editor needs at first open. Until the chunk arrives the session simply has no list: every key
// reaches the editor, which is what an empty list does anyway (Enter is a new line), except Tab,
// which still takes the first choice (`tabFirstChoice`, below).
let listModule = null
let listLoading = null
const loadDateList = () => {
  if (listModule) return Promise.resolve(listModule)
  if (!listLoading) {
    listLoading = importWithOneRetry(() => import('../components/notebook/DateSuggestList'))
      .then((m) => { listModule = m; return m })
      .finally(() => { listLoading = null })
  }
  return listLoading
}

// [label, the word resolveDateWord reads]. Order is the order a bare "@" shows them in.
const WORDS = [
  ['Today', 'today'],
  ['Tomorrow', 'tomorrow'],
  ['Next Monday', 'next monday'],
  ['Next Tuesday', 'next tuesday'],
  ['Next Wednesday', 'next wednesday'],
  ['Next Thursday', 'next thursday'],
  ['Next Friday', 'next friday'],
]
const PICKER = Object.freeze({ label: 'Pick a date…', date: null, picker: true })

/** "Nov 3, 2026" for `2026-11-03`, formatted in UTC so no time zone can move the day. */
function isoLabel(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

/** Does the typed query pick this word? "tom" -> tomorrow, "next" -> every "next ...", and a bare
 *  weekday ("fri", which the input rule also accepts) -> its "Next ..." row. */
function matches(q, label, word) {
  if (label.toLowerCase().startsWith(q) || word.startsWith(q)) return true
  const day = word.startsWith('next ') ? word.slice(5) : ''
  return day.startsWith(q)
}

/**
 * The choices for what follows an `@`. Pure.
 *  - "" -> today, tomorrow, next Monday...Friday, then the "Pick a date…" row;
 *  - a prefix -> the words it starts, case-insensitively;
 *  - a real ISO date -> that one exact choice; an impossible one, or anything else -> nothing.
 */
export function dateChoices(query, today) {
  const q = String(query || '').trim().toLowerCase()
  if (isIsoDate(q)) return [{ label: isoLabel(q), date: q }]
  const words = WORDS
    .filter(([label, word]) => !q || matches(q, label, word))
    .map(([label, word]) => ({ label, date: resolveDateWord(word, today) }))
    .filter((c) => c.date)
  return q ? words : [...words, PICKER]
}

/**
 * Insert a chosen date as a `dateMention` followed by a space. `range` is the `@query` text the
 * Suggestion plugin hands over; it is removed first. Without a range the mention goes in at the
 * caret and nothing is removed. A choice with no usable date (the picker row, a bad string)
 * changes nothing and answers false.
 */
export function runDateCommand(editor, choice, range) {
  if (!editor || !choice || !isIsoDate(choice.date)) return false
  const chain = editor.chain().focus()
  if (range) chain.deleteRange(range)
  return chain
    .insertContent([{ type: 'dateMention', attrs: { date: choice.date } }, { type: 'text', text: ' ' }])
    .run()
}

export const dateSuggestPluginKey = new PluginKey('dateSuggest')

/**
 * Tab with no list on screen yet (N3, polish round). On the FIRST `@` of a page load the list's
 * chunk is still on its way, and without this Tab went to the browser, which can move focus out of
 * the editor. The list's own rule is "Tab takes the selected row, or the first one" and before the
 * list exists nothing can be selected, so this takes the first choice -- computed here, eagerly,
 * from the plugin's own query and range (never from the list, never from a session's props, which
 * arrive a tick later) and inserted through the ONE command. Answers false (the key is not ours)
 * when no session is open or there is nothing to take; the picker row is never "taken" by Tab.
 */
export function tabFirstChoice(editor, state, today) {
  const s = dateSuggestPluginKey.getState(state)
  if (!s?.active) return false
  const first = dateChoices(s.query, today)[0]
  if (!first || first.picker) return false
  return runDateCommand(editor, first, s.range)
}

// Is the slash menu (`/`, which Suggestion keys by default) or the note-link menu (`[[`) in a
// session? `state` is the NEW editor state, and both of those plugins sit before this one in the
// plugin list, so their states are already this transaction's: `/due` + Enter, which ends the
// slash session and types the "@" in one step, reads as free and opens the date list.
const otherSuggestionOpen = (state) => [slashMenuPluginKey, noteLinkMenuPluginKey]
  .some((key) => Boolean(key.getState(state)?.active))

const inCode = (state, pos) => {
  const $pos = state.doc.resolve(pos)
  return Boolean($pos.parent.type.spec.code || $pos.marks().some((m) => m.type.spec.code))
}

export const DateSuggest = Extension.create({
  name: 'dateSuggest',

  addOptions() {
    return { today: () => todayET() }
  },

  addProseMirrorPlugins() {
    const today = this.options.today
    const editor = this.editor
    return [Suggestion({
      editor: this.editor,
      pluginKey: dateSuggestPluginKey,
      char: '@',
      allowSpaces: false,
      allowedPrefixes: [' ', '('],
      allow: ({ state, range }) => !inCode(state, range.from) && !otherSuggestionOpen(state),
      items: ({ query }) => dateChoices(query, today()),
      command: ({ editor, range, props }) => { runDateCommand(editor, props, range) },
      render: () => {
        // The same popup mechanism the emoji and slash menus use (Suggestion + ReactRenderer +
        // a fixed-position wrapper on the body); each keeps its closure state per session.
        let component
        let popup
        let getRect = null
        let editorDom = null
        // The newest props Suggestion handed us, for a list that arrives after the session began.
        let latest = null
        let live = false
        const position = () => {
          if (!popup) return
          // Measuring the caret can throw (a range the document no longer holds; an engine with
          // no layout, as in a test). Placing a popup must never throw into the editor's update.
          let rect = null
          try { rect = getRect?.() } catch { rect = null }
          if (!rect) return
          const w = popup.offsetWidth || 0
          const h = popup.offsetHeight || 0
          popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - w - 8))}px`
          let top = rect.bottom + 6
          if (h && top + h > window.innerHeight - 8) top = Math.max(8, rect.top - 6 - h)
          popup.style.top = `${top}px`
        }
        const onViewportChange = () => position()
        // `showing` is separate from `id`: the list is on screen with nothing chosen yet.
        const setActive = (id, showing = Boolean(id)) => {
          applyComboboxWiring(editorDom, { menuId: DATE_SUGGEST_MENU_ID, activeId: id, showing })
        }
        return {
          onStart: (props) => {
            // Suggestion starts a session a tick after the keystroke; the editor may have been
            // destroyed in between (a note closed mid-word). Reading its view then throws.
            if (props.editor?.isDestroyed) return
            latest = props
            live = true
            getRect = props.clientRect
            editorDom = props.editor?.view?.dom || null
            // Fetched once (the first `@` of the page); after that it is already here and the list
            // mounts in the same tick. A failed fetch leaves the session with no list, never an error.
            loadDateList().then((mod) => {
              // The session may have ended (or the note closed) while the chunk was on its way.
              if (!live || popup || latest?.editor?.isDestroyed) return
              component = new ReactRenderer(mod.default, { props: { ...latest, onActiveChange: setActive }, editor: latest.editor })
              popup = document.createElement('div')
              popup.className = mod.POPUP_WRAP_CLASS
              popup.style.position = 'fixed'
              popup.style.zIndex = 9999
              popup.appendChild(component.element)
              document.body.appendChild(popup)
              position()
              requestAnimationFrame(position)
              window.addEventListener('scroll', onViewportChange, true)
              window.addEventListener('resize', onViewportChange)
            }).catch(() => {})
          },
          onUpdate(props) {
            latest = props
            getRect = props.clientRect
            component?.updateProps({ ...props, onActiveChange: setActive })
            position()
          },
          // ⛔ Escape is NOT handled here: @tiptap/suggestion owns it (exits the session, keeps the
          // range dismissed until the member types on). A second dismissal path would be a guard no
          // rail could tell from the first (EmojiMenu says the same).
          onKeyDown(props) {
            if (props.event.key === 'Escape') return false
            const listKeys = component?.ref?.onKeyDown
            if (listKeys) return listKeys(props) ?? false
            // No list yet (its chunk is still on its way): every key reaches the editor, as an empty
            // list would let it, EXCEPT Tab, which takes the first choice as the list's Tab does.
            if (props.event.key === 'Tab') return tabFirstChoice(editor, props.view.state, today())
            return false
          },
          onExit() {
            live = false
            latest = null
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

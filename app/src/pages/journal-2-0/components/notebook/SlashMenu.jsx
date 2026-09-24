/**
 * Slash menu for the Notebook TipTap editor.
 *
 * Typing `/` opens a positioned dropdown of insertable blocks.
 * Arrow keys navigate, Enter inserts, Esc closes. Free-text after `/`
 * filters the list by label.
 */

import { Extension } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import { WIDGET_REGISTRY, JOURNAL_MENU_TYPES, tfText } from '../../../../widgets/registry'
import {
  parseChartSlashArgs, parseMtfSlashArgs, parseCompareSlashArgs, chartInsertNodes,
} from '../../lib/widgetEmbedCore'
import { applyComboboxWiring } from '../../lib/comboboxWiring'
import { BLOCK_MATH, INLINE_MATH, insertMathAndEdit } from '../../lib/mathNodes'
import { inColumn, insertColumns } from '../../lib/columnsNode'
import styles from './SlashMenu.module.css'

// Exported for the rails (SlashMenu.items.test.jsx): the block entries a bare
// `/` offers, and what each one inserts.
export const ITEMS = [
  {
    title: 'Heading 1',
    description: 'Big section heading',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    title: 'Heading 4',
    description: 'Sub-section heading — or type #### and a space',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 4 }).run(),
  },
  {
    title: 'Heading 5',
    description: 'Minor heading — or type ##### and a space',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 5 }).run(),
  },
  {
    title: 'Heading 6',
    description: 'Smallest heading, a label — or type ###### and a space',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 6 }).run(),
  },
  {
    title: 'Bullet list',
    description: 'Unordered list',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    description: 'Ordered list',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'Quote',
    description: 'Italic indented block',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: 'Code block',
    description: 'Monospace block',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: 'Divider',
    description: 'Horizontal rule',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: 'Table',
    description: '3x3 table with a header row',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    // Wave 6: side-by-side columns (columnsNode.js). ⛔ Never offered inside a
    // column — columns do not nest — which `available` answers per session.
    title: '2 columns',
    description: 'Two side-by-side columns — they stack on a phone',
    available: ({ editor }) => !inColumn(editor?.state?.selection?.$from),
    command: ({ editor, range }) => insertColumns(editor, 2, range),
  },
  {
    title: '3 columns',
    description: 'Three side-by-side columns — they stack on a phone',
    available: ({ editor }) => !inColumn(editor?.state?.selection?.$from),
    command: ({ editor, range }) => insertColumns(editor, 3, range),
  },
  {
    title: 'Checklist',
    description: 'Task list with checkboxes',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Callout',
    description: 'Highlighted box — note, info, success, warning or danger',
    // Wave 6: a new callout is STYLED (its icon is the style control, a UIcon);
    // only an imported or older callout shows an emoji.
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent({
      type: 'callout',
      attrs: { variant: 'note' },
      content: [{ type: 'paragraph' }],
    }).run(),
  },
  {
    title: 'Toggle',
    description: 'Collapsible section',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent({
      type: 'toggle',
      attrs: { open: true },
      content: [
        { type: 'toggleSummary', content: [{ type: 'text', text: 'Toggle' }] },
        { type: 'toggleContent', content: [{ type: 'paragraph' }] },
      ],
    }).run(),
  },
  {
    title: 'Inline math',
    description: 'A formula inside the sentence (LaTeX) — or type $x^2$ then a space',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      insertMathAndEdit(editor, INLINE_MATH)
    },
  },
  {
    title: 'Math block',
    description: 'A displayed equation (LaTeX) — or type $$…$$ on its own line',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      insertMathAndEdit(editor, BLOCK_MATH)
    },
  },
  {
    title: 'Emoji',
    description: 'Type : and a name — e.g. :rocket or :chart',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      // The `:` must start a word for the emoji menu to arm (EmojiMenu.jsx).
      const { $from } = editor.state.selection
      const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset)
      editor.chain().insertContent(before && !/\s/.test(before) ? ' :' : ':').run()
    },
  },
  {
    title: 'Image',
    description: 'Insert an image from your computer',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      // Trigger the editor's external file picker via a custom event.
      window.dispatchEvent(new CustomEvent('uct:notebook-open-image-picker'))
    },
  },
]

/** The block items offered where the caret is now (an item's `available`). */
export function blockItemsAvailable(editor) {
  return ITEMS.filter((it) => {
    if (typeof it.available !== 'function') return true
    try { return Boolean(it.available({ editor })) } catch { return false }
  })
}

// 'YYYY-MM-DD' → 'Mar 13, 2026' for menu previews (UTC parts — no TZ drift).
function fmtDayTitle(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return iso
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// ── Wave F: /price captures the note's own ticker's CURRENT price as an
// immutable financial fact -- mirrors /chart's own "type a symbol → instant
// insert, no modal" shape, but the resulting node holds a reference (factId)
// to a real backend row rather than reconstructable params: a fact capture
// is a real API call (checkpoint decision 30), so the command handler is
// async, unlike every other slash command in this file. ────────────────────
const FACT_SYMBOL_RE = /^[A-Za-z][A-Za-z.\-]{0,9}$/

export function factItems(query) {
  const raw = String(query || '')
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  const first = tokens[0]?.toLowerCase() || ''
  const singleToken = tokens.length <= 1
  // Same two-regime rail as widgetItems: a single token is a PREFIX match
  // (completion, nothing to eat yet); once args/prose follow, only the exact
  // type name matches (prefix + args would arm the Enter-trap this file's
  // own header comment warns about).
  if (singleToken ? !'price'.startsWith(first) : first !== 'price') return []
  const rest = singleToken ? '' : raw.trim().slice(first.length).trim()
  if (!rest) {
    return [{
      title: 'Price',
      description: 'Type a symbol — e.g. /price NVDA',
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).insertContent('/price ').run()
      },
    }]
  }
  const symTokens = rest.split(/\s+/).filter(Boolean)
  if (symTokens.length !== 1 || !FACT_SYMBOL_RE.test(symTokens[0])) return []
  const symbol = symTokens[0].toUpperCase()
  return [{
    title: `Price — ${symbol}`,
    description: 'Capture the current price as a financial fact',
    command: async ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      const noteId = editor?.storage?.uctJournalWidgets?.noteId
      if (!noteId) return
      try {
        const res = await fetch(`/api/j2/notes/${noteId}/facts`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: symbol, factType: 'price' }),
        })
        if (!res.ok) return
        const { fact } = await res.json()
        editor.chain().focus().insertContent({ type: 'financialFact', attrs: { factId: fact.id } }).run()
      } catch {
        // A failed capture must not corrupt the note (directive §48) --
        // nothing was inserted; the member sees nothing changed and can retry.
      }
    },
  }]
}

// ── Widget embeds (Journal Widgets) ─────────────────────────────────────────
// Registry-driven: every menus.journal type appears here automatically. The
// query's trailing tokens are ARGUMENTS — `/chart AMD 15m` inserts an AMD 15m
// snapshot directly (speed is the whole feature: no modal, no picker).
export function widgetItems(query) {
  const raw = String(query || '')
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  const first = tokens[0]?.toLowerCase() || ''
  const singleToken = tokens.length <= 1
  const out = []
  for (const id of JOURNAL_MENU_TYPES) {
    // Two matching regimes (the first cut of the Enter-trap fix demanded the
    // exact word everywhere and killed discoverability — '/ch' showed nothing):
    // - SINGLE token: prefix match. '/ch' offers Chart, and its command
    //   COMPLETES the text to '/chart ' — there is no prose after the name
    //   yet, so nothing can be eaten.
    // - Once a SPACE exists (args/prose follow): the exact type name only.
    //   With allowSpaces keeping a mid-sentence '/' suggestion alive, prefix
    //   matching here ('/c NVDA…') armed an Enter trap on ordinary prose.
    if (singleToken ? !id.startsWith(first) : first !== id) continue
    if (id === 'chart') {
      const rest = singleToken ? '' : raw.trim().slice(first.length).trim()
      const args = parseChartSlashArgs(rest)
      if (args) {
        out.push({
          title: `Chart — ${args.symbol} · ${tfText(args.tf)}${args.day ? ` @ ${fmtDayTitle(args.day)}` : ''}`,
          description: args.day
            ? 'Insert a chart anchored at that date'
            : 'Insert a frozen chart snapshot',
          command: ({ editor, range }) => {
            // settings: the user's RESOLVED own-chart blob, stamped into
            // editor storage by NoteEditorPage — frozen at insert so a March
            // embed never repaints when the user re-themes in April. Node
            // payload comes from chartInsertNodes — ONE builder shared with
            // the widget palette, never a second hand-written copy.
            const settings = editor.storage?.uctJournalWidgets?.chartSettings
            editor.chain().focus().deleteRange(range)
              .insertContent(chartInsertNodes('chart', args, settings))
              .caretAfterWidgetEmbed()
              .run()
          },
        })
      } else if (!rest) {
        // The hint renders ONLY for a bare '/chart' — once free text follows
        // that doesn't parse as SYMBOL [tf] [date], the menu must offer
        // NOTHING so Enter stays a newline and the prose survives.
        out.push({
          title: 'Chart',
          description: 'Type a symbol — e.g. /chart AMD 15m or /chart AMD D 3/13',
          command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertContent('/chart ').run()
          },
        })
      }
    }
  }

  // ── Composition presets (spec Phase 6 #4/#5): one action → N chart nodes.
  // Same two-regime matching + strictness contract as /chart: bare name
  // completes, valid args insert, anything else offers NOTHING (Enter stays
  // a newline — the '/chart looks great here' lesson).
  const restAfterName = singleToken ? '' : raw.trim().slice(first.length).trim()
  if (singleToken ? 'mtf'.startsWith(first) : first === 'mtf') {
    const args = restAfterName ? parseMtfSlashArgs(restAfterName) : null
    if (args) {
      out.push({
        title: `MTF stack — ${args.symbol} · D / 1h / 15m${args.day ? ` @ ${fmtDayTitle(args.day)}` : ''}`,
        description: args.day ? 'Three charts, top-down, anchored at that date' : 'Three frozen charts, top-down',
        command: ({ editor, range }) => {
          const settings = editor.storage?.uctJournalWidgets?.chartSettings
          editor.chain().focus().deleteRange(range)
            .insertContent(chartInsertNodes('mtf', args, settings))
            .caretAfterWidgetEmbed()
            .run()
        },
      })
    } else if (!restAfterName) {
      out.push({
        title: 'MTF stack',
        description: 'Type a symbol — e.g. /mtf AMD (D + 1h + 15m; add a date to anchor)',
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).insertContent('/mtf ').run()
        },
      })
    }
  }
  if (singleToken ? 'compare'.startsWith(first) : first === 'compare') {
    const args = restAfterName ? parseCompareSlashArgs(restAfterName) : null
    if (args) {
      const tfSuffix = args.tf !== 'D' ? ` · ${tfText(args.tf)}` : ''
      out.push({
        title: `Before / after — ${args.symbol} @ ${fmtDayTitle(args.day)}${tfSuffix}`,
        description: `Two half-width ${args.tf === 'D' ? 'dailies' : `${tfText(args.tf)} charts`}: window ending that day vs now`,
        command: ({ editor, range }) => {
          const settings = editor.storage?.uctJournalWidgets?.chartSettings
          editor.chain().focus().deleteRange(range)
            .insertContent(chartInsertNodes('compare', args, settings))
            .caretAfterWidgetEmbed()
            .run()
        },
      })
    } else if (!restAfterName) {
      out.push({
        title: 'Before / after',
        description: 'Type symbol + day — e.g. /compare AMD 3/13 (add 15m for intraday)',
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).insertContent('/compare ').run()
        },
      })
    }
  }
  return out
}

const SlashList = forwardRef((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const items = props.items
  const menuId = props.menuId || 'uct-slash-menu'

  useEffect(() => setSelectedIndex(0), [items])

  // ARIA combobox wiring: the render() closure points the EDITOR's
  // aria-activedescendant at the active option (the editor is the focused
  // element — an activedescendant on the unfocused listbox itself is inert).
  useEffect(() => {
    props.onActiveChange?.(items.length ? `${menuId}-opt-${selectedIndex}` : null)
  }, [selectedIndex, items, menuId]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      // No matching items = no visible menu — every key must pass through to
      // the editor. Swallowing Enter/arrows here with an EMPTY list broke
      // normal typing the moment allowSpaces kept a mid-sentence '/'
      // suggestion alive past its first space.
      if (!items.length) return false
      if (event.key === 'ArrowUp') {
        setSelectedIndex((selectedIndex + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((selectedIndex + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        const item = items[selectedIndex]
        if (item) props.command(item)
        return true
      }
      return false
    },
  }))

  if (!items.length) return null

  return (
    <div className={styles.menu} role="listbox" id={menuId} aria-label="Insert block">
      {items.map((item, i) => (
        <button
          key={item.title}
          type="button"
          role="option"
          id={`${menuId}-opt-${i}`}
          aria-selected={i === selectedIndex}
          className={`${styles.item} ${i === selectedIndex ? styles.itemActive : ''}`}
          onMouseDown={(e) => { e.preventDefault(); props.command(item) }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <div className={styles.itemTitle}>{item.title}</div>
          <div className={styles.itemDesc}>{item.description}</div>
        </button>
      ))}
    </div>
  )
})
SlashList.displayName = 'SlashList'

export const SlashMenuExtension = Extension.create({
  name: 'slashMenu',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        // Widget commands carry ARGUMENTS after the type name — `/chart AMD
        // 15m` must reach items() as one query. Space no longer exits the
        // suggestion; with zero matches the list renders nothing and (per the
        // guard in SlashList.onKeyDown) passes every key through.
        allowSpaces: true,
        command: ({ editor, range, props }) => {
          props.command({ editor, range })
        },
        items: ({ query, editor }) => {
          const q = (query || '').toLowerCase()
          const widgets = widgetItems(query)
          const factCaptures = factItems(query)
          // Wave 6: an item may say where it is NOT offered (`available`) —
          // columns inside a column, the table of contents inside one.
          const here = blockItemsAvailable(editor)
          if (!q) return [...here, ...widgets, ...factCaptures]
          // Widget/fact items match on their own tokenized rules (args after
          // the type name would defeat a plain substring filter).
          return [...here.filter((it) => it.title.toLowerCase().includes(q)), ...widgets, ...factCaptures]
        },
        render: () => {
          // One renderer object serves EVERY suggestion session, so all of
          // this closure state must reset in onStart.
          let component
          let popup
          let dismissed = false      // Esc hides for THIS session; next '/' re-arms
          let getRect = null
          let editorDom = null
          const MENU_ID = 'uct-slash-menu'

          // Fixed-position popup + a scrolling editor: without reposition the
          // menu detaches from the caret the moment the note scrolls (the app
          // scrolls the inner .main element, hence capture-phase). Clamp keeps
          // it inside the viewport; when it would cross the bottom edge it
          // flips above the caret.
          const position = () => {
            if (!popup || dismissed) return
            const rect = getRect?.()
            if (!rect) return
            const menuW = popup.offsetWidth || 0
            const menuH = popup.offsetHeight || 0
            const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuW - 8))
            let top = rect.bottom + 6
            if (menuH && top + menuH > window.innerHeight - 8) {
              const above = rect.top - 6 - menuH
              top = above >= 8 ? above : Math.max(8, window.innerHeight - 8 - menuH)
            }
            popup.style.left = `${left}px`
            popup.style.top = `${top}px`
          }
          const onViewportChange = () => position()

          // The editor is the focused element, so it carries the combobox
          // wiring: role="combobox" + aria-autocomplete + aria-expanded +
          // aria-controls (naming the listbox) + aria-activedescendant
          // (tracking the highlighted option, reported by SlashList through
          // onActiveChange) -- shared with NoteLinkMenu.jsx via
          // applyComboboxWiring, since both popups need the identical
          // pairing. Cleared whenever the menu isn't offering items.
          const setActiveDescendant = (id) => {
            applyComboboxWiring(editorDom, { menuId: MENU_ID, activeId: id, showing: Boolean(id && !dismissed) })
          }

          return {
            onStart: (props) => {
              dismissed = false
              getRect = props.clientRect
              editorDom = props.editor?.view?.dom || null
              component = new ReactRenderer(SlashList, {
                props: { ...props, menuId: MENU_ID, onActiveChange: setActiveDescendant },
                editor: props.editor,
              })
              popup = document.createElement('div')
              popup.className = styles.popupWrap
              popup.style.position = 'fixed'
              popup.style.zIndex = 9999
              popup.appendChild(component.element)
              document.body.appendChild(popup)
              position()
              // Post-mount second pass: the first ran before layout knew the
              // menu's size, so the clamp/flip had nothing to measure.
              requestAnimationFrame(position)
              window.addEventListener('scroll', onViewportChange, true)
              window.addEventListener('resize', onViewportChange)
            },
            onUpdate(props) {
              getRect = props.clientRect
              component?.updateProps({ ...props, menuId: MENU_ID, onActiveChange: setActiveDescendant })
              position()
            },
            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                // Hide, don't destroy: the suggestion session stays alive (the
                // '/' text is still there), so keep receiving updates silently
                // and let every key fall through to the editor. The next
                // '/' session re-arms via onStart.
                dismissed = true
                if (popup) popup.style.display = 'none'
                setActiveDescendant(null)
                return true
              }
              if (dismissed) return false
              return component?.ref?.onKeyDown?.(props) ?? false
            },
            onExit() {
              window.removeEventListener('scroll', onViewportChange, true)
              window.removeEventListener('resize', onViewportChange)
              setActiveDescendant(null)
              popup?.remove()
              component?.destroy()
              popup = null
              component = null
            },
          }
        },
      }),
    ]
  },
})

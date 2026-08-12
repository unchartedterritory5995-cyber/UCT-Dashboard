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
import { WIDGET_REGISTRY, JOURNAL_MENU_TYPES } from '../../../../widgets/registry'
import { parseChartSlashArgs } from '../../lib/widgetEmbedCore'
import styles from './SlashMenu.module.css'

const ITEMS = [
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
    title: 'Checklist',
    description: 'Task list with checkboxes',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
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

// ── Widget embeds (Journal Widgets) ─────────────────────────────────────────
// Registry-driven: every menus.journal type appears here automatically. The
// query's trailing tokens are ARGUMENTS — `/chart AMD 15m` inserts an AMD 15m
// snapshot directly (speed is the whole feature: no modal, no picker).
function widgetItems(query) {
  const raw = String(query || '')
  const first = raw.trim().split(/\s+/)[0]?.toLowerCase() || ''
  const out = []
  for (const id of JOURNAL_MENU_TYPES) {
    // EXACT type-name match only (review finding): with allowSpaces keeping a
    // mid-sentence '/' suggestion alive to end of paragraph, prefix matching
    // ('/c NVDA…') armed an Enter trap on ordinary prose. Typing the full
    // '/chart' is the deliberate gesture that arms the command.
    if (first !== id) continue
    if (id === 'chart') {
      const rest = raw.trim().slice(first.length).trim()
      const args = parseChartSlashArgs(rest)
      if (args) {
        out.push({
          title: `Chart — ${args.symbol} · ${args.tf}`,
          description: 'Insert a frozen chart snapshot',
          command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range)
              .insertWidgetEmbed('chart', { symbol: args.symbol, tf: args.tf }).run()
          },
        })
      } else if (!rest) {
        // The hint renders ONLY for a bare '/chart' — once free text follows
        // that doesn't parse as SYMBOL [tf], the menu must offer NOTHING so
        // Enter stays a newline and the prose survives.
        out.push({
          title: 'Chart',
          description: 'Type a symbol — e.g. /chart AMD 15m',
          command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertContent('/chart ').run()
          },
        })
      }
    }
  }
  return out
}

const SlashList = forwardRef((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const items = props.items

  useEffect(() => setSelectedIndex(0), [items])

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
    <div className={styles.menu}>
      {items.map((item, i) => (
        <button
          key={item.title}
          type="button"
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
        items: ({ query }) => {
          const q = (query || '').toLowerCase()
          const widgets = widgetItems(query)
          if (!q) return [...ITEMS, ...widgets]
          // Widget items match on their own tokenized rules (args after the
          // type name would defeat a plain substring filter).
          return [...ITEMS.filter((it) => it.title.toLowerCase().includes(q)), ...widgets]
        },
        render: () => {
          let component
          let popup
          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashList, {
                props,
                editor: props.editor,
              })
              popup = document.createElement('div')
              popup.className = styles.popupWrap
              popup.style.position = 'fixed'
              popup.style.zIndex = 9999
              const rect = props.clientRect?.()
              if (rect) {
                popup.style.left = `${rect.left}px`
                popup.style.top = `${rect.bottom + 6}px`
              }
              popup.appendChild(component.element)
              document.body.appendChild(popup)
            },
            onUpdate(props) {
              component?.updateProps(props)
              const rect = props.clientRect?.()
              if (rect && popup) {
                popup.style.left = `${rect.left}px`
                popup.style.top = `${rect.bottom + 6}px`
              }
            },
            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                popup?.remove()
                component?.destroy()
                return true
              }
              return component?.ref?.onKeyDown?.(props) ?? false
            },
            onExit() {
              popup?.remove()
              component?.destroy()
            },
          }
        },
      }),
    ]
  },
})

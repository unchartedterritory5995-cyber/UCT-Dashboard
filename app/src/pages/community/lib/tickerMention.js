// app/src/pages/community/lib/tickerMention.js
// $TICKER inline chip + $-triggered autocomplete (vanilla-DOM dropdown, no tippy).
import { Node, mergeAttributes } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'

export function extractTickers(doc) {
  const out = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'tickerChip' && node.attrs?.ticker) out.push(node.attrs.ticker)
    ;(node.content || []).forEach(walk)
  }
  walk(doc)
  return [...new Set(out)]
}

async function searchTickers(query) {
  if (!query) return []
  try {
    const r = await fetch(`/api/ticker-search?q=${encodeURIComponent(query)}&limit=8`,
                          { credentials: 'include' })
    if (!r.ok) return []
    const body = await r.json()
    return (body.results || []).slice(0, 8)
  } catch {
    return []
  }
}

function makeDropdown() {
  const el = document.createElement('div')
  el.className = 'community-ticker-dropdown'
  document.body.appendChild(el)
  return el
}

export const TickerMention = Node.create({
  name: 'tickerChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return { ticker: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'span[data-ticker]',
              getAttrs: (el) => ({ ticker: el.getAttribute('data-ticker') }) }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-ticker': node.attrs.ticker,
      class: 'community-ticker-chip',
    }), `$${node.attrs.ticker}`]
  },

  addProseMirrorPlugins() {
    let dropdown = null
    let items = []
    let selected = 0
    let currentProps = null

    const renderItems = () => {
      if (!dropdown) return
      dropdown.innerHTML = ''
      items.forEach((it, i) => {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = `community-ticker-row${i === selected ? ' is-active' : ''}`
        row.innerHTML = `<strong>$${it.ticker}</strong><span>${it.name || ''}</span>`
        row.onmousedown = (e) => { e.preventDefault(); pick(i) }
        dropdown.appendChild(row)
      })
      dropdown.style.display = items.length ? 'block' : 'none'
    }

    const pick = (i) => {
      const it = items[i]
      if (!it || !currentProps) return
      currentProps.command({ ticker: it.ticker })
    }

    return [
      Suggestion({
        editor: this.editor,
        char: '$',
        allowSpaces: false,
        command: ({ editor, range, props }) => {
          editor.chain().focus().insertContentAt(range, [
            { type: 'tickerChip', attrs: { ticker: props.ticker } },
            { type: 'text', text: ' ' },
          ]).run()
        },
        items: ({ query }) => searchTickers((query || '').toUpperCase()),
        render: () => ({
          onStart: (props) => {
            currentProps = props
            dropdown = makeDropdown()
            items = props.items || []
            selected = 0
            const rect = props.clientRect?.()
            if (rect) {
              dropdown.style.left = `${rect.left}px`
              dropdown.style.top = `${rect.bottom + 4}px`
            }
            renderItems()
          },
          onUpdate: (props) => {
            currentProps = props
            items = props.items || []
            selected = Math.min(selected, Math.max(0, items.length - 1))
            const rect = props.clientRect?.()
            if (rect && dropdown) {
              dropdown.style.left = `${rect.left}px`
              dropdown.style.top = `${rect.bottom + 4}px`
            }
            renderItems()
          },
          onKeyDown: ({ event }) => {
            if (!items.length) return false
            if (event.key === 'ArrowDown') { selected = (selected + 1) % items.length; renderItems(); return true }
            if (event.key === 'ArrowUp') { selected = (selected - 1 + items.length) % items.length; renderItems(); return true }
            if (event.key === 'Enter') { pick(selected); return true }
            if (event.key === 'Escape') { dropdown?.remove(); dropdown = null; return true }
            return false
          },
          onExit: () => { dropdown?.remove(); dropdown = null; items = []; currentProps = null },
        }),
      }),
    ]
  },
})

// app/src/pages/community/lib/userMention.js
// @user inline mention + @-triggered autocomplete (mirrors tickerMention). The
// stored node is what api/services/community_store.parse_mentions_from_doc reads
// server-side to fan out notifications.
import { Node, mergeAttributes } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'

async function searchMembers(query) {
  try {
    const r = await fetch(`/api/community/chat/members?q=${encodeURIComponent(query || '')}`,
                          { credentials: 'include' })
    if (!r.ok) return []
    return ((await r.json()).members || []).slice(0, 8)
  } catch {
    return []
  }
}

function makeDropdown() {
  const el = document.createElement('div')
  el.className = 'community-ticker-dropdown'   // reuse the same dropdown styling
  document.body.appendChild(el)
  return el
}

export const UserMention = Node.create({
  name: 'userMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return { userId: { default: '' }, label: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'span[data-user-id]',
              getAttrs: (el) => ({ userId: el.getAttribute('data-user-id'),
                                   label: el.getAttribute('data-label') || el.textContent?.replace(/^@/, '') }) }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-user-id': node.attrs.userId,
      'data-label': node.attrs.label,
      class: 'community-user-mention',
    }), `@${node.attrs.label}`]
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
        row.innerHTML = `<strong>@${it.name}</strong><span>${it.is_mentor ? 'Mentor' : ''}</span>`
        row.onmousedown = (e) => { e.preventDefault(); pick(i) }
        dropdown.appendChild(row)
      })
      dropdown.style.display = items.length ? 'block' : 'none'
    }
    const pick = (i) => {
      const it = items[i]
      if (!it || !currentProps) return
      currentProps.command({ userId: it.id, label: it.name })
    }

    return [
      Suggestion({
        editor: this.editor,
        char: '@',
        allowSpaces: false,
        command: ({ editor, range, props }) => {
          editor.chain().focus().insertContentAt(range, [
            { type: 'userMention', attrs: { userId: props.userId, label: props.label } },
            { type: 'text', text: ' ' },
          ]).run()
        },
        items: ({ query }) => searchMembers(query || ''),
        render: () => ({
          onStart: (props) => {
            currentProps = props
            dropdown = makeDropdown()
            items = props.items || []
            selected = 0
            const rect = props.clientRect?.()
            if (rect) { dropdown.style.left = `${rect.left}px`; dropdown.style.top = `${rect.bottom + 4}px` }
            renderItems()
          },
          onUpdate: (props) => {
            currentProps = props
            items = props.items || []
            selected = Math.min(selected, Math.max(0, items.length - 1))
            const rect = props.clientRect?.()
            if (rect && dropdown) { dropdown.style.left = `${rect.left}px`; dropdown.style.top = `${rect.bottom + 4}px` }
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

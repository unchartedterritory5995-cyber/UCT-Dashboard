import { Node, mergeAttributes } from '@tiptap/core'
import { fmtTime } from '../../../components/video/playerUtils'

const clampSecs = (v) => Math.max(0, Math.floor(Number(v) || 0))

// Atomic, non-editable inline chip that represents a moment in the note's
// source video. Clicking it asks the page's hero player to jump there via a
// bubbling `uct:video-seek` CustomEvent. Stored as raw seconds (robust past
// the one-hour mark); the display string is derived with fmtTime.
export const VideoTimestamp = Node.create({
  name: 'videoTimestamp',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      seconds: {
        default: 0,
        parseHTML: (el) => clampSecs(el.getAttribute('data-video-ts')),
        renderHTML: (attrs) => ({ 'data-video-ts': String(clampSecs(attrs.seconds)) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'button[data-video-ts]' }, { tag: 'span[data-video-ts]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const secs = clampSecs(node.attrs.seconds)
    return [
      'button',
      mergeAttributes(HTMLAttributes, {
        'data-video-ts': String(secs),
        type: 'button',
        class: 'uct-video-ts',
        contenteditable: 'false',
        title: 'Jump to this moment',
      }),
      `[${fmtTime(secs)}]`,
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const secs = clampSecs(node.attrs.seconds)
      const dom = document.createElement('button')
      dom.type = 'button'
      dom.className = 'uct-video-ts'
      dom.setAttribute('data-video-ts', String(secs))
      dom.setAttribute('contenteditable', 'false')
      dom.title = 'Jump to this moment'
      dom.textContent = `[${fmtTime(secs)}]`
      dom.style.cssText =
        'color:var(--ut-gold,#d4af37);background:none;border:none;padding:0 2px;' +
        'font:inherit;font-weight:600;cursor:pointer;'
      // Keep the editor from hijacking selection/focus on press.
      dom.addEventListener('mousedown', (e) => e.preventDefault())
      dom.addEventListener('click', (e) => {
        e.preventDefault()
        dom.dispatchEvent(
          new CustomEvent('uct:video-seek', { detail: { seconds: secs }, bubbles: true }),
        )
      })
      return { dom }
    }
  },
})

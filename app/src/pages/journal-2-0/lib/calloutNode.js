import { Node, mergeAttributes } from '@tiptap/core'
import { mountUIcon } from './uiconDom'

/**
 * Callout — one of Notion's two most common structural blocks (the other is
 * Toggle, in `toggleNode.js`). Spec: docs/superpowers/specs/2026-09-01-
 * notebook-migration-program-design.md §8 item 2 — without these two,
 * imported Notion pages "do not merely lose styling, they look broken."
 *
 * Notion's classic Markdown export ("Export > Markdown & CSV", the format the
 * file importer reads) represents a callout as a raw `<aside>` HTML island
 * with the emoji as a leading character in its text content — confirmed by
 * this repo's own `__fixtures__/notion/…/My Page….md` fixture (authored
 * against a real export) and the adapter's own docstring ("Markdown lane via
 * mdToHtml — `<aside>`/`<details>` HTML islands pass straight through"),
 * corroborated by Notion's own help docs ("Callout blocks will be exported as
 * HTML, as there is no Markdown equivalent") and independent write-ups
 * describing the `<aside>` tag specifically. `notion.js` deliberately leaves
 * these tags untouched for "the converter" (this module + `importer/
 * convert.js`) to handle — no change needed there.
 *
 * The leading emoji is extracted into the `emoji` attr by
 * `importer/convert.js::mapCalloutsAndToggles` (which also stamps
 * `data-type="callout"` on the source `<aside>`) BEFORE `generateJSON` ever
 * sees the HTML — this node's own `parseHTML` stays a plain tag match so it
 * degrades gracefully (default emoji, unstripped leading character kept as
 * body text) if that preprocessing is ever bypassed, rather than depending on
 * it to avoid dropping content.
 *
 * `renderHTML` (the static HTML: a copy, generateHTML) renders the emoji badge
 * as a nested, `0`-holed DOMOutputSpec child so it stays OUTSIDE the node's
 * contentDOM. The emoji is the user's own content (carried over from Notion),
 * not UI chrome, so it renders as plain text/data — no `UIcon`. Wave 6 adds a
 * DOM node view (below) of the same shape for the editor itself, whose icon is
 * also the callout's STYLE control.
 */
// ── Wave 6: a callout's STYLE, chosen from the callout's own control ────────
//
// Five variants, each drawn with a UIcon (never an emoji — once the member has
// picked a style the icon is chrome). A callout WITHOUT a variant — every
// Notion import, every callout written before wave 6 — keeps showing its own
// emoji, which is the member's content (see above), exactly as before.
//
// Schema: `variant` is an ATTRIBUTE on an existing node, so it needs no schema
// bump (an older client drops an unknown attr on load; the callout then shows
// its emoji, which is still there). Export writes it as `data-variant` on the
// `<aside>`, which this node's own parseHTML reads back (the round trip is
// railed through the real exporter and the real importer).
export const CALLOUT_VARIANTS = Object.freeze(['note', 'info', 'success', 'warning', 'danger'])
export const CALLOUT_VARIANT_LABELS = Object.freeze({
  note: 'Note', info: 'Info', success: 'Success', warning: 'Warning', danger: 'Danger',
})
export const CALLOUT_VARIANT_ICONS = Object.freeze({
  note: 'pin', info: 'info', success: 'check', warning: 'warning', danger: 'flame',
})
export const CALLOUT_STYLE_LABEL = 'Callout style'

export function normalizeCalloutVariant(value) {
  return CALLOUT_VARIANTS.includes(value) ? value : null
}

/**
 * The callout's DOM node view: the same shape `renderHTML` writes (icon box +
 * body), plus the style control. The icon box is `contenteditable=false` and
 * outside the content DOM, so the control can never become part of the
 * member's text. A pick is one `setNodeMarkup` transaction — the ordinary
 * autosave path, one undo step. A read-only editor (a locked note, a version
 * preview) offers no picker: the click is refused and the control is inert
 * (noteContent.css).
 */
function calloutView({ node: initial, editor, getPos }) {
  let node = initial
  const dom = document.createElement('div')
  dom.setAttribute('data-type', 'callout')
  const iconBox = document.createElement('div')
  iconBox.className = 'uctCalloutIcon'
  iconBox.setAttribute('contenteditable', 'false')
  const pick = document.createElement('button')
  pick.type = 'button'
  pick.className = 'uctCalloutPick'
  pick.setAttribute('aria-expanded', 'false')
  const glyph = document.createElement('span')
  glyph.className = 'uctCalloutGlyph'
  pick.appendChild(glyph)
  iconBox.appendChild(pick)
  const body = document.createElement('div')
  body.className = 'uctCalloutBody'
  dom.append(iconBox, body)

  let glyphIcon = null // { holder, handle } while a UIcon is shown
  let menu = null // { el, icons: [handle] } while the picker is open

  const showGlyph = (variant) => {
    if (variant) {
      if (glyphIcon) { glyphIcon.handle.update(CALLOUT_VARIANT_ICONS[variant]); return }
      glyph.textContent = ''
      const holder = document.createElement('span')
      glyph.appendChild(holder)
      glyphIcon = { holder, handle: mountUIcon(holder, CALLOUT_VARIANT_ICONS[variant], { size: 18 }) }
      return
    }
    if (glyphIcon) {
      glyphIcon.handle.destroy()
      glyphIcon.holder.remove()
      glyphIcon = null
    }
    glyph.textContent = node.attrs.emoji || '💡'
  }

  const paint = () => {
    const variant = normalizeCalloutVariant(node.attrs.variant)
    if (variant) dom.setAttribute('data-variant', variant)
    else dom.removeAttribute('data-variant')
    dom.setAttribute('data-emoji', node.attrs.emoji || '💡')
    pick.setAttribute('aria-label', `${CALLOUT_STYLE_LABEL}: ${variant ? CALLOUT_VARIANT_LABELS[variant] : 'emoji'}`)
    pick.title = 'Change the callout style'
    showGlyph(variant)
    if (menu) {
      for (const btn of menu.el.querySelectorAll('button[data-variant]')) {
        btn.setAttribute('aria-pressed', String(btn.getAttribute('data-variant') === variant))
      }
    }
  }

  const onOutside = (e) => {
    if (menu && !iconBox.contains(e.target)) close(false)
  }

  function close(refocus) {
    if (!menu) return
    menu.icons.forEach((h) => h.destroy())
    menu.el.remove()
    menu = null
    pick.setAttribute('aria-expanded', 'false')
    document.removeEventListener('mousedown', onOutside, true)
    if (refocus) pick.focus()
  }

  const choose = (variant) => {
    if (!editor.isEditable) return
    const pos = typeof getPos === 'function' ? getPos() : null
    if (typeof pos !== 'number') return
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, variant }))
    close(true)
  }

  const open = () => {
    if (menu || !editor.isEditable) return
    const el = document.createElement('div')
    el.className = 'uctCalloutMenu'
    el.setAttribute('role', 'group')
    el.setAttribute('aria-label', CALLOUT_STYLE_LABEL)
    const icons = []
    const current = normalizeCalloutVariant(node.attrs.variant)
    for (const variant of CALLOUT_VARIANTS) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'uctCalloutOption'
      btn.setAttribute('data-variant', variant)
      btn.setAttribute('aria-pressed', String(variant === current))
      const holder = document.createElement('span')
      holder.className = 'uctCalloutOptionIcon'
      btn.appendChild(holder)
      btn.appendChild(document.createTextNode(CALLOUT_VARIANT_LABELS[variant]))
      icons.push(mountUIcon(holder, CALLOUT_VARIANT_ICONS[variant], { size: 14 }))
      btn.addEventListener('mousedown', (e) => e.preventDefault())
      btn.addEventListener('click', () => choose(variant))
      el.appendChild(btn)
    }
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close(true)
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return
      const all = [...el.querySelectorAll('button')]
      const i = all.indexOf(document.activeElement)
      if (i < 0) return
      e.preventDefault()
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
      all[(i + step + all.length) % all.length].focus()
    })
    iconBox.appendChild(el)
    menu = { el, icons }
    pick.setAttribute('aria-expanded', 'true')
    document.addEventListener('mousedown', onOutside, true)
    const first = el.querySelector('[aria-pressed="true"]') || el.querySelector('button')
    if (first) first.focus()
  }

  pick.addEventListener('mousedown', (e) => e.preventDefault())
  pick.addEventListener('click', () => (menu ? close(true) : open()))

  paint()

  return {
    dom,
    contentDOM: body,
    update(next) {
      if (next.type !== node.type) return false
      node = next
      paint()
      return true
    },
    // The control is chrome: ProseMirror never handles an event inside it.
    stopEvent: (event) => iconBox.contains(event.target),
    ignoreMutation: (m) => m.type !== 'selection' && (iconBox.contains(m.target) || m.target === dom),
    destroy() {
      close(false)
      if (glyphIcon) glyphIcon.handle.destroy()
    },
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: '💡',
        parseHTML: (el) => el.getAttribute('data-emoji') || '💡',
        renderHTML: (attrs) => ({ 'data-emoji': attrs.emoji || '💡' }),
      },
      variant: {
        default: null,
        parseHTML: (el) => normalizeCalloutVariant(el.getAttribute('data-variant')),
        renderHTML: (attrs) => (normalizeCalloutVariant(attrs.variant) ? { 'data-variant': attrs.variant } : {}),
      },
    }
  },

  addNodeView() {
    return (props) => calloutView(props)
  },

  parseHTML() {
    return [
      // Renders back out with `data-type="callout"` (below) — matches on
      // copy/paste of our own output, including into another note.
      // `contentElement` is load-bearing: without it the parser would also
      // walk into `.uctCalloutIcon` (a DECORATION, not content — see
      // renderHTML) and absorb the emoji character as a stray leading text
      // run in the body, duplicating what `data-emoji` already carries.
      { tag: 'div[data-type="callout"]', contentElement: '.uctCalloutBody' },
      // Raw Notion export shape (or an `<aside>` that reached generateJSON
      // without the convert.js preprocessing pass) — its children ARE the
      // content directly, no wrapper to select.
      { tag: 'aside' },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }),
      // A styled callout's icon is chrome (the node view draws its UIcon), so
      // the static HTML — a copy, a paste into another app — carries no
      // stand-in for it; an emoji callout carries its emoji as before.
      ['div', { class: 'uctCalloutIcon', contenteditable: 'false' },
        normalizeCalloutVariant(node.attrs.variant) ? '' : (node.attrs.emoji || '💡')],
      ['div', { class: 'uctCalloutBody' }, 0],
    ]
  },
})

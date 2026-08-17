import { Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection, TextSelection, Selection } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'
import WidgetEmbedView from '../components/notebook/WidgetEmbedView'
import { buildWidgetEmbedAttrs } from './widgetEmbedCore'

// ⚠️ NEVER remove this extension from buildExtensions(): TipTap DROPS unknown
// node types at parse time, so unregistering it would silently delete every
// embed from every note the next time one is opened. "Unknown widget" is a
// VALUE-level state (attrs.widgetId not in the registry) handled inside the
// node view's render chain — the node type itself must always exist.
//
// Object attrs are persisted as individual JSON data-attributes so copy/paste
// and the importer's generateJSON round-trip keep the full embed intact; the
// static renderHTML also carries the searchText line as text content so
// HTML pasted OUTSIDE the app degrades to something readable.
const jsonAttr = (name, dflt) => ({
  default: dflt,
  parseHTML: (el) => {
    const raw = el.getAttribute(name)
    if (raw == null) return dflt
    try { return JSON.parse(raw) } catch { return dflt }
  },
  renderHTML: (attrs) => {
    const key = name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const v = attrs[key]
    return v == null ? {} : { [name]: JSON.stringify(v) }
  },
})

const stringAttr = (name, dflt = null) => ({
  default: dflt,
  parseHTML: (el) => el.getAttribute(name) ?? dflt,
  renderHTML: (attrs) => {
    const key = name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const v = attrs[key]
    return v == null ? {} : { [name]: String(v) }
  },
})

export const WidgetEmbed = Node.create({
  name: 'widgetEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      v: {
        default: 1,
        parseHTML: (el) => Number(el.getAttribute('data-v')) || 1,
        renderHTML: (attrs) => ({ 'data-v': String(attrs.v ?? 1) }),
      },
      widgetId: stringAttr('data-widget-id'),
      params: jsonAttr('data-params', {}),
      capturedAt: stringAttr('data-captured-at'),
      mode: stringAttr('data-mode', 'snapshot'),
      fallback: jsonAttr('data-fallback', null),
      // Frozen-to-image: renders the captured PNG at the embed's own size (no
      // live chart, no toolbar), still resizable via the corner handle.
      frozen: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-frozen') === 'true',
        renderHTML: (attrs) => (attrs.frozen ? { 'data-frozen': 'true' } : {}),
      },
      tradeRef: stringAttr('data-trade-ref'),
      annotations: jsonAttr('data-annotations', []),
      caption: stringAttr('data-caption'),
      layout: jsonAttr('data-layout', { width: 'full', height: 320 }),
      searchText: stringAttr('data-search-text'),
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-widget-embed]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-widget-embed': '', class: 'uct-widget-embed' }),
      node.attrs.searchText || '[widget]',
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(WidgetEmbedView)
  },

  addCommands() {
    return {
      insertWidgetEmbed: (widgetId, capture, extra) => ({ chain }) =>
        chain()
          .insertContent({
            type: this.name,
            attrs: buildWidgetEmbedAttrs(widgetId, capture, extra),
          })
          .caretAfterWidgetEmbed()
          .run(),
      // insertContent leaves a NodeSelection ON a freshly inserted atom, so
      // the very NEXT keystroke replaced the embed the user just created —
      // caught typing prose right after a /chart insert on prod (the most
      // natural next action there is). Park the caret in the first text
      // position after the embed instead; when the embed is the last node,
      // give it a trailing paragraph to land in. Chain this after EVERY
      // programmatic embed insert (the single-embed command above does it
      // itself; the /mtf and /compare array inserts call it explicitly).
      caretAfterWidgetEmbed: () => ({ tr, dispatch, editor }) => {
        const sel = tr.selection
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== this.name) return true
        if (!dispatch) return true
        const after = Selection.findFrom(tr.doc.resolve(sel.to), 1, true)
        if (after) {
          tr.setSelection(after)
          return true
        }
        const para = editor.schema.nodes.paragraph?.createAndFill()
        if (!para) return true
        tr.insert(sel.to, para)
        tr.setSelection(TextSelection.create(tr.doc, sel.to + 1))
        return true
      },
    }
  },
})

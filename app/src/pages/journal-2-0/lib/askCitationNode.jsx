import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import AskCitationView from '../components/notebook/AskCitationView'
import { ASK_CITATION_TYPE, claimFromBlock } from './askInsert'

/**
 * G-064 — one citation inside an inserted answer (spec §4.2).
 *
 * No `leafText`, exactly like noteLink: ProseMirror's textBetween gives it zero
 * characters, and the server's note_citation_text treats it as a one-position
 * leaf (spec §7.1). The source's own passage is deliberately NOT stored.
 *
 * ⚠️ Never remove this extension from buildExtensions() — see askInsertNode.jsx.
 */
export const askCitationStaleKey = new PluginKey('askCitationStale')

/**
 * Stale = the chip's paragraph text is no longer the text it had at insertion
 * (spec §6.2). ⛔ COMPUTED AT RENDER, NEVER STORED (§6.3): a decoration, so the
 * check can never dispatch a transaction and never trigger a save.
 */
export function staleCitationDecorations(doc) {
  const decos = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let claim = null
    node.forEach((child, offset) => {
      if (child.type.name !== ASK_CITATION_TYPE) return
      if (claim === null) claim = claimFromBlock(node)
      if (claim !== (child.attrs.claim || '')) {
        const from = pos + 1 + offset
        decos.push(Decoration.node(from, from + child.nodeSize, {}, { askStale: true }))
      }
    })
    return false
  })
  return DecorationSet.create(doc, decos)
}

function parseJsonAttr(raw) {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

export const AskCitation = Node.create({
  name: 'askCitation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      n: {
        default: null,
        // G-064 fix round 1 (Finding F4): a missing/empty data-n must read
        // null, not 0 -- `Number(null)` and `Number('')` are both `0`, and
        // `Number.isFinite(0)` is true, so the old body silently turned
        // "no n at all" into the real value zero.
        parseHTML: (el) => {
          const raw = el.getAttribute('data-n')
          if (raw == null || raw === '') return null
          const v = Number(raw)
          return Number.isFinite(v) ? v : null
        },
        renderHTML: (a) => (a.n != null ? { 'data-n': String(a.n) } : {}),
      },
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') || '',
        renderHTML: (a) => (a.label ? { 'data-label': a.label } : {}),
      },
      nav: {
        default: null,
        parseHTML: (el) => parseJsonAttr(el.getAttribute('data-nav')),
        renderHTML: (a) => (a.nav ? { 'data-nav': JSON.stringify(a.nav) } : {}),
      },
      citation: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-citation'),
        renderHTML: (a) => (a.citation ? { 'data-citation': a.citation } : {}),
      },
      claim: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-claim') || '',
        renderHTML: (a) => (a.claim ? { 'data-claim': a.claim } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="ask-citation"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'ask-citation' }), `[${node.attrs.n ?? '?'}]`]
  },

  addNodeView() {
    // ⛔ G-064 fix round 1 (Finding F1): `@tiptap/react`'s default
    // ReactNodeView.update (dist/index.js ~1006-1012) stores the new
    // decorations and returns `true` WITHOUT calling `updateProps` whenever
    // `newNode === this.node` — editing a chip's PARAGRAPH leaves the chip
    // node's own identity unchanged, so the default path never re-renders
    // the React component and `[n · edited]` never reaches the screen live.
    // `updateProps()` is called whenever the node identity changed OR the
    // DERIVED stale boolean differs — never on raw decoration-array identity,
    // which is a fresh array on every keystroke anywhere in the doc (see
    // staleCitationDecorations) and would otherwise re-render every chip on
    // every edit.
    const staleOf = (ds) => Array.isArray(ds) && ds.some((d) => d?.spec?.askStale)
    return ReactNodeViewRenderer(AskCitationView, {
      update: ({ oldNode, newNode, oldDecorations, newDecorations, updateProps }) => {
        if (oldNode !== newNode || staleOf(oldDecorations) !== staleOf(newDecorations)) updateProps()
        return true
      },
    })
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: askCitationStaleKey,
      state: {
        init: (_config, state) => staleCitationDecorations(state.doc),
        apply: (tr, old) => (tr.docChanged ? staleCitationDecorations(tr.doc) : old),
      },
      props: {
        decorations(state) { return askCitationStaleKey.getState(state) },
      },
    })]
  },
})

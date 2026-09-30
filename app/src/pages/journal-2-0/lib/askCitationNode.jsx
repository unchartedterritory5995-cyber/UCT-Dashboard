import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import AskCitationView from '../components/notebook/AskCitationView'
import { ASK_CITATION_TYPE, claimFromBlock } from './askInsert'
import { stepsIntroduceNodeType } from './stepInsertsNodeType'

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
 *
 * ⛔ G-064 final fix wave (I1) — a chip with NO claim (`null`) is UNKNOWN, not
 * edited, and is skipped. A public share serves every chip reduced to `{ n }`
 * (the one public reducer, `public_note_payload.NODE_POLICY`'s `askCitation`
 * row: `citation-n` on a share link; a published page drops the chip -- spec
 * §7.5), so a shared chip has no claim to compare. When the attribute defaulted to `''` instead, `''` never
 * equalled a paragraph with any text, and every chip on every shared note read
 * "[n · edited]". `buildAskInsertNode` always writes a STRING claim (a
 * chip-only paragraph's is the real value `''`), so every real insert is still
 * checked.
 */
export function staleCitationDecorations(doc) {
  const decos = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let current = null
    node.forEach((child, offset) => {
      if (child.type.name !== ASK_CITATION_TYPE) return
      const stored = child.attrs.claim
      if (typeof stored !== 'string') return
      if (current === null) current = claimFromBlock(node)
      if (current !== stored) {
        const from = pos + 1 + offset
        decos.push(Decoration.node(from, from + child.nodeSize, {}, { askStale: true }))
      }
    })
    return false
  })
  return DecorationSet.create(doc, decos)
}

/** Does the doc hold ANY askCitation chip, stale or not? */
function hasAskCitation(doc) {
  let found = false
  doc.descendants((node) => {
    if (found) return false
    if (node.type.name === ASK_CITATION_TYPE) { found = true; return false }
    return true
  })
  return found
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
      // G-064 final fix wave (I1) — `null` means UNKNOWN (a share-reduced copy
      // carries only `n`), and staleCitationDecorations skips it. A present
      // empty claim is a REAL value (a paragraph of chips only), so it is
      // written as `data-claim=""` and read back as `''`, never collapsed
      // into "unknown" on a copy/paste round trip.
      claim: {
        default: null,
        parseHTML: (el) => (el.hasAttribute('data-claim') ? el.getAttribute('data-claim') : null),
        renderHTML: (a) => (typeof a.claim === 'string' ? { 'data-claim': a.claim } : {}),
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
    // ⛔⛔ Wave 10 (TY, standard 4 -- typing budget): `apply` used to re-walk the
    // WHOLE document on every keystroke of EVERY note, whether or not it had
    // ever held an Ask citation chip -- this extension is in every editor's
    // roster (buildExtensions()). `hasCitation` is a CLOSURE, never plugin
    // state, because the plugin's state VALUE is a bare DecorationSet read
    // directly by two rails (`askCitationStaleKey.getState(...).find()` in
    // AskCitationView.live.test.jsx and askInsertNodes.test.js) and must stay
    // one. It tracks whether the doc has EVER held a chip, so a note that
    // never has can skip the walk outright: `staleCitationDecorations` would
    // find nothing to mark stale regardless, so the empty set already held is
    // the answer. A note that DOES hold one keeps re-walking on every
    // keystroke, exactly as before -- staleness depends on the text AROUND a
    // chip changing, not just whether one exists, so that direction stays
    // correct rather than becoming a heuristic.
    let hasCitation = false
    return [new Plugin({
      key: askCitationStaleKey,
      state: {
        init: (_config, state) => {
          hasCitation = hasAskCitation(state.doc)
          return staleCitationDecorations(state.doc)
        },
        apply: (tr, old) => {
          if (!tr.docChanged) return old
          if (!hasCitation && !stepsIntroduceNodeType(tr, ASK_CITATION_TYPE)) return old
          hasCitation = true
          return staleCitationDecorations(tr.doc)
        },
      },
      props: {
        decorations(state) { return askCitationStaleKey.getState(state) },
      },
    })]
  },
})

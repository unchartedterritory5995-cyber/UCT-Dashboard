/**
 * Notebook widgets Task 10: the `$TICKER` chip. A DECORATION, never a node or mark: the stored text stays
 * `$NVDA`, so getText, the saved JSON and the public reducer never see it. Editor-only (an editable editor with
 * the W1 switch on); text in a `code` mark or a code block is left alone. A click dispatches TICKER_CARD_EVENT on
 * the editor's own DOM, saying which pointer clicked (`via`); the card (components/notebook/widgets/TickerCardPopover.jsx)
 * is a lazy chunk, and it decides: a mouse click places the caret, a touch tap opens, a desktop hover opens.
 * ⛔ First-open bytes: keep this file to the regex, the decoration builder and the click.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { widgetsWaveOn } from './notebookWidgetsFlags'

export const TICKER_CARD_EVENT = 'uct:ticker-card'
export const tickerChipKey = new PluginKey('tickerChip')
const key = tickerChipKey

/** Every `$SYM` in `text`. A sentence's closing period is not part of the symbol.
 *  ⛔ No lookbehind (iOS 16 is the floor, and it throws there): the "not after a word char or `$`" rule is a
 *  consumed prefix, `^` or one such char, and the `$` is found inside the match (the prefix is never a `$`). */
export function findTickerRanges(text) {
  const out = []
  for (const m of String(text || '').matchAll(/(?:^|[^\w$])\$([A-Z][A-Z.]{0,5})(?![\w$])/g)) {
    const symbol = m[1].replace(/\.+$/, '')
    const from = m.index + m[0].indexOf('$')
    out.push({ from, to: from + 1 + symbol.length, symbol })
  }
  return out
}

// The chips of every textblock overlapping [from, to); returns the blocks' spans so the caller can drop old ones.
function scan(doc, from, to) {
  const decos = []
  const spans = []
  const code = doc.type.schema.marks.code
  doc.nodesBetween(from, to, (node, pos) => {
    // A code block's span is recorded too, so chips mapped into one (paragraph to code block) are dropped.
    if (node.type.spec.code || node.isTextblock) spans.push([pos, pos + node.nodeSize])
    if (node.type.spec.code) return false
    if (!node.isTextblock) return true
    for (const r of findTickerRanges(node.textBetween(0, node.content.size, undefined, '￼'))) {
      const a = pos + 1 + r.from
      const b = pos + 1 + r.to
      if (!code || !doc.rangeHasMark(a, b, code)) {
        decos.push(Decoration.inline(a, b, { class: 'tickerChip', 'data-symbol': r.symbol }))
      }
    }
    return false
  })
  return { decos, spans }
}

const full = (doc) => DecorationSet.create(doc, scan(doc, 0, doc.content.size).decos)

export const TickerChipExtension = Extension.create({
  name: 'tickerChip',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      key,
      state: {
        // null while the switch is off: nothing is scanned until it is on.
        init: (_, state) => (widgetsWaveOn(1) ? full(state.doc) : null),
        apply(tr, set, _old, state) {
          if (!set) return widgetsWaveOn(1) ? full(state.doc) : null
          if (!tr.docChanged) return set
          let next = set.map(tr.mapping, tr.doc)
          // Re-scan only the textblocks the steps touched. A mark step (code on or off) has an EMPTY map, so
          // its own from/to is the range.
          const size = tr.doc.content.size
          tr.steps.forEach((step, i) => {
            const touched = []
            step.getMap().forEach((_a, _b, s, e) => touched.push([s, e]))
            if (!touched.length && step.from != null) touched.push([step.from, step.to])
            const rest = tr.mapping.slice(i + 1)
            for (const [s, e] of touched) {
              const { decos, spans } = scan(tr.doc, Math.max(0, rest.map(s, -1) - 1), Math.min(size, rest.map(e, 1) + 1))
              for (const [a, b] of spans) next = next.remove(next.find(a, b))
              next = next.add(tr.doc, decos)
            }
          })
          return next
        },
      },
      props: {
        decorations: (state) => (editor.isEditable && widgetsWaveOn(1) ? key.getState(state) : null),
        handleDOMEvents: {
          click(view, event) {
            const el = event.target?.closest?.('.tickerChip')
            if (!el || !view.dom.contains(el) || !view.editable) return false
            let pos = null
            try { pos = view.posAtDOM(el, 0) } catch { pos = null }
            view.dom.dispatchEvent(new CustomEvent(TICKER_CARD_EVENT, {
              bubbles: true, detail: { symbol: el.getAttribute('data-symbol'), rect: el.getBoundingClientRect(), pos, via: event.pointerType },
            }))
            return false
          },
        },
      },
    })]
  },
})

// Price-stamped lines (spec §P2 item 4; R-P2-2, R-P2-3). The FIRST-OPEN stub (IR-S12): it decides only
// what it can without the ticker resolver, then loads priceStampsRun on the first stamp. Enter lands at
// once (the handler always returns false); the stamp follows as its own, history-closed transaction,
// within STAMP_TIMEOUT_MS of the Enter (chunk load included) or not at all. Off unless the journal
// styles switch is on (S24) and the note holds a priceStamps block with on = 'yes'.
// ⛔ IR-S3: a pending stamp tracks its line's START mapped with assoc = 1, so a deleted line reports
// `deleted` and takes no stamp.
// ⛔ Per-transaction cost: the plugin's apply returns its own (empty) state untouched unless a stamp is
// pending or this transaction carries a stamp meta, so typing pays one getMeta and nothing else.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { importWithOneRetry } from '../lazyChunk'
import { journalStylesEnabled } from '../journalStylesFlag'

export const STAMP_TIMEOUT_MS = 2000
export const PRICE_STAMPS_KEY = new PluginKey('uctPriceStamps')

export function stampsOn(doc) {
  let on = false
  doc.descendants((n) => {
    if (n.type.name === 'widgetEmbed' && n.attrs.widgetId === 'priceStamps' && n.attrs.params?.on === 'yes') on = true
    return !on && !n.isTextblock
  })
  return on
}

let seq = 0
/** Drops a pending stamp (its run ended, inserted or not). A meta-only transaction: no history step. */
export const settle = (editor, id) => {
  if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(PRICE_STAMPS_KEY, id))
}

export const PriceStamps = Extension.create({
  name: 'uctPriceStamps',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: PRICE_STAMPS_KEY,
      state: {
        init: () => new Map(),
        // meta: [id, pos] adds a pending stamp, an id alone settles one
        apply(tr, pending) {
          const meta = tr.getMeta(PRICE_STAMPS_KEY)
          if (meta == null && (!pending.size || !tr.docChanged)) return pending
          const next = new Map()
          for (const [id, pos] of pending) {
            const r = tr.mapping.mapResult(pos, 1)
            if (!r.deleted) next.set(id, r.pos)
          }
          if (Array.isArray(meta)) next.set(...meta)
          else next.delete(meta)
          return next
        },
      },
    })]
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor
        const { $from, empty } = state.selection
        if (!journalStylesEnabled() || !empty || !editor.isEditable || !$from.parent.isTextblock) return false
        if ($from.parentOffset !== $from.parent.content.size || !$from.parent.textContent) return false
        if (!editor.storage.uctJournalWidgets?.noteId || !stampsOn(state.doc)) return false
        // An open suggestion menu (/, :, @, [[) takes this Enter to pick an item: not a finished line.
        if (state.plugins.some((p) => { const s = p.getState(state); return s?.active === true && !!s.range })) return false
        const id = ++seq
        editor.view.dispatch(state.tr.setMeta(PRICE_STAMPS_KEY, [id, $from.before()]))
        // The budget starts HERE: the run aborts at `until`, chunk load included.
        const until = Date.now() + STAMP_TIMEOUT_MS
        importWithOneRetry(() => import('./priceStampsRun'))
          .then((m) => m.default({ editor, id, until, key: PRICE_STAMPS_KEY, settle }))
          .catch(() => settle(editor, id))
        return false
      },
    }
  },
})

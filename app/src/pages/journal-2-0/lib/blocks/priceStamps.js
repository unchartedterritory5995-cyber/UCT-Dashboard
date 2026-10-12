// Price-stamped lines (spec §P2 item 4; R-P2-2, R-P2-3). Fix round 1, review I-2 option E: this module
// is NOT in the editor's first-open chunk. It rides the price stamps block's own lazy chunk, and the
// block body registers the plugin while it is mounted with its switch on (attachPriceStamps). So
// stamping is on exactly while such a block is mounted: no per-Enter document walk, and nothing at all
// for a note without one. An Enter before the block's chunk has loaded simply stamps nothing.
//
// The plugin is PREPENDED, so its Enter is asked before every other Enter handler (list items, code
// blocks, suggestion menus); it always returns false, so Enter itself lands at once. On a plain Enter at
// the end of a non-empty, non-code text line, with no suggestion menu open, it records the line's START
// as pending (mapped with assoc = 1, so a deleted line reports `deleted` and takes no stamp, IR-S3) and
// starts the run after Enter has landed. The 2 s budget starts at the Enter (STAMP_TIMEOUT_MS).
// ⛔ Per-transaction cost: apply returns its own (empty) state untouched unless a stamp is pending and
// the doc changed, or the transaction carries a stamp meta.
import { Plugin, PluginKey } from '@tiptap/pm/state'
import runStamp from './priceStampsRun'

export const STAMP_TIMEOUT_MS = 2000
export const PRICE_STAMPS_KEY = new PluginKey('uctPriceStamps')

let seq = 0
/** Drops a pending stamp (its run ended, inserted or not). A meta-only transaction: no history step. */
export const settle = (editor, id) => {
  if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(PRICE_STAMPS_KEY, id))
}

function priceStampsPlugin(editor) {
  return new Plugin({
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
    props: {
      handleKeyDown(view, e) {
        if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false
        const { state } = view
        const { $from, empty } = state.selection
        const line = $from.parent
        if (!empty || !editor.isEditable || !line.isTextblock || line.type.spec.code) return false
        if ($from.parentOffset !== line.content.size || !line.textContent) return false
        if (!editor.storage.uctJournalWidgets?.noteId) return false
        // An open suggestion menu (/, :, @, [[) takes this Enter to pick an item: not a finished line.
        if (state.plugins.some((p) => { const s = p.getState(state); return s?.active === true && !!s.range })) return false
        const id = ++seq
        view.dispatch(state.tr.setMeta(PRICE_STAMPS_KEY, [id, $from.before()]))
        const until = Date.now() + STAMP_TIMEOUT_MS
        // After Enter has landed: the run reads the line, then fetches.
        Promise.resolve().then(() => runStamp({ editor, id, until, key: PRICE_STAMPS_KEY, settle }))
          .catch(() => settle(editor, id))
        return false
      },
    },
  })
}

const holders = new WeakMap()

/** Registers the plugin on `editor` (once, however many stamps blocks hold it) and returns the detach.
 *  The last detach unregisters it. Called by the block body: mounted, switched on, editable. */
export function attachPriceStamps(editor) {
  if (!PRICE_STAMPS_KEY.get(editor.state)) editor.registerPlugin(priceStampsPlugin(editor), (p, ps) => [p, ...ps])
  holders.set(editor, (holders.get(editor) || 0) + 1)
  let held = true
  return () => {
    if (!held) return
    held = false
    const n = holders.get(editor) - 1
    holders.set(editor, n)
    if (!n) editor.unregisterPlugin(PRICE_STAMPS_KEY)
  }
}

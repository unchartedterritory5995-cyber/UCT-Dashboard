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
/** Drops a pending stamp (its run ended, inserted or not). A meta-only transaction: no history step.
 *  N-4: nothing at all once the plugin is gone (it holds no pending stamps to drop). */
export const settle = (editor, id) => {
  if (!editor.isDestroyed && PRICE_STAMPS_KEY.get(editor.state)) editor.view.dispatch(editor.state.tr.setMeta(PRICE_STAMPS_KEY, id))
}

/** An open suggestion menu (/, :, @, [[): any plugin state that is `active` over a `range`. */
const menuOpen = (state) => state.plugins.some((p) => { const s = p.getState(state); return s?.active === true && !!s.range })

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
        if (menuOpen(state)) return false
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
const waiting = new WeakSet()

/** Makes the editor hold the plugin exactly when some stamps block holds it, when that is safe.
 *  ⛔ Registering or unregistering a plugin is NOT free: ProseMirror rebuilds every plugin view, one of
 *  which (notebookPlaceholder) dispatches from its constructor, so each costs one meta-only transaction;
 *  and the rebuild destroys the suggestion plugins' views, whose onExit removes an open menu. So:
 *  - N-3: while a suggestion menu is open, wait for a transaction that closes it (the listener removes
 *    itself), then reconcile in a microtask, outside that transaction's dispatch;
 *  - the holders are re-read every time, so a let-go and a re-hold in between cancel out. */
function reconcile(editor) {
  if (editor.isDestroyed) return
  if (menuOpen(editor.state)) {
    if (waiting.has(editor)) return
    waiting.add(editor)
    const closed = () => {
      if (!editor.isDestroyed && menuOpen(editor.state)) return
      editor.off('transaction', closed)
      waiting.delete(editor)
      queueMicrotask(() => reconcile(editor))
    }
    editor.on('transaction', closed)
    return
  }
  const want = (holders.get(editor) || 0) > 0
  const has = !!PRICE_STAMPS_KEY.get(editor.state)
  if (want && !has) editor.registerPlugin(priceStampsPlugin(editor), (p, ps) => [p, ...ps])
  else if (!want && has) editor.unregisterPlugin(PRICE_STAMPS_KEY)
}

/** Holds the plugin on `editor` (registered once, however many stamps blocks hold it; PREPENDED, so its
 *  Enter is asked first) and returns the let-go. Called by the block body: mounted, on, editable.
 *  ⛔ N-1: the last let-go reconciles in a MICROTASK, never synchronously. A block body unmounts from
 *  inside a transaction's own view.updateState when that transaction also creates a React node view
 *  (@tiptap/react's flushSync flushes the old portal's cleanup), and unregistering there re-enters
 *  updateState mid-docView.update. The microtask re-reads the holders and `isDestroyed`. */
export function attachPriceStamps(editor) {
  holders.set(editor, (holders.get(editor) || 0) + 1)
  reconcile(editor)
  let held = true
  return () => {
    if (!held) return
    held = false
    const n = holders.get(editor) - 1
    holders.set(editor, n)
    if (!n) queueMicrotask(() => reconcile(editor))
  }
}

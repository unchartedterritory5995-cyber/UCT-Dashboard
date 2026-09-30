// app/src/components/journalCaptureLoader.js — the ONE lazy door from the
// universal ticker menu (TickerActions) into the journal capture core.
//
// ⭐ WHY THIS FILE EXISTS. TickerActions is rendered by MoversSidebar →
// TickerPopup → MobileNav → Layout, i.e. on EVERY route, so every module it
// imports statically is in the ENTRY chunk. Its "Send chart to note" door used
// to import `buildWidgetEmbedAttrs` (widgetEmbedCore) and `sendCaptureToJournal`
// (sendToJournal) statically, and that one pair of edges dragged
//   widgetEmbedCore → ownChartSettings → chartDefaults → nativeRegistry → ast/*
// — the whole Pine engine (interpret, parse, pcf, closedTable.json, …) plus the
// widget registry — into the bundle every page downloads before it can paint.
// The door only needs those two functions when a member actually uses it, so
// they are loaded here, on demand, and nowhere else in TickerActions.
//
// ⛔ BEHAVIOUR IS UNCHANGED ONCE LOADED: the SAME two functions are called with
// the SAME arguments. `peekJournalCapture()` lets the menu stay synchronous when
// the module is already resolved (the menu warms it the moment it opens), so
// the only new state is the first-use gap before the chunk lands.
//
// ⛔ The rail `src/__tests__/entryExcludesChartEngine.test.js` fails BY NAME if
// TickerActions (or anything else on the entry's static closure) grows a static
// edge back into the engine.

let _mod = null
let _pending = null

/** The resolved capture core, or null if it has not loaded yet. */
export function peekJournalCapture() {
  return _mod
}

/** Load (once) the two capture functions the ticker menu's send-to-note door
 *  calls. A failed load is NOT cached, so the next attempt retries the fetch —
 *  a chunk that 404'd across a deploy must not poison the door for the session. */
export function loadJournalCapture() {
  if (_mod) return Promise.resolve(_mod)
  if (!_pending) {
    _pending = Promise.all([
      import('../pages/journal-2-0/lib/widgetEmbedCore'),
      import('../pages/journal-2-0/lib/sendToJournal'),
    ]).then(([core, send]) => {
      _mod = {
        buildWidgetEmbedAttrs: core.buildWidgetEmbedAttrs,
        sendCaptureToJournal: send.sendCaptureToJournal,
      }
      return _mod
    }).catch((err) => {
      _pending = null
      throw err
    })
  }
  return _pending
}

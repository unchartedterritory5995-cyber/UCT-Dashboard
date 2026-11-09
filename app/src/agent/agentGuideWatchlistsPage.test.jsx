// ⭐ RAILS, written FIRST (cov-4 item 8; docs/agent/program/TEACH-WATCHLISTS-PAGE-DESIGN.md): a watchlist control that lives
// only on the Watchlists page is taught there, behind the member's permission. Owner decision 2026-11-09 + AUDIT limits:
// never navigate without a yes, never write the workspace, cancel works across the page change, the board is untouched on
// return. ⛔ `it.todo` until the pieces other owners hold land (the Watchlists page's Agent host, the landing panel's handoff):
// each todo becomes a real test, against the real panel with navigation and workspace writers spied, before the feature ships.
import { describe, it } from 'vitest'

describe('teaching on the Watchlists page (asks first; teaching only)', () => {
  it.todo('a Watchlists-page walkthrough asks "This is on the Watchlists page. Go there now?" (Yes / No) and rings nothing')
  it.todo('before the member answers, host.navigate is never called and no workspace writer is called (persist, setPref, layouts, lists)')
  it.todo('No: no navigation, no walkthrough, no workspace write; the member is told they are staying put')
  it.todo('Yes: navigate("/watchlists") exactly once, the handoff holds the walkthrough, and still no workspace write')
  it.todo('the landing panel starts the walkthrough from the handoff exactly once; a reload does not restart it')
  it.todo('cancel after navigating (Exit, Escape, a new request) ends it cleanly, with no workspace write')
  it.todo('back on Charts the board pref is byte-identical to the one before the ask')
  it.todo('a control Charts can show is never sent to the page (Charts first)')
})

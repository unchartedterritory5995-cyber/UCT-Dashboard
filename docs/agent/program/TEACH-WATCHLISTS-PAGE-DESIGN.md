# Teaching a watchlist control that lives on the Watchlists page (cov-4 item 8) — design note

> Owner decision 2026-11-09, approved with scope limits; AUDIT review limits added. Teaching only: the Agent's execution scope
> does not grow. LOCAL design; nothing here is shipped. Evidence label for everything built from it: LOCAL / SIMULATED.

## The problem
29 inventory rows (Watchlist list management) are not taught. Most of their controls are in a list's header and its
right-click menu. **Pick mode hides them in the Charts Watchlist widget** (`Watchlists.module.css .pickMode .wlHeader`, an
owner decision). They are visible on the **Watchlists page** (`/watchlists`, `pages/Watchlists.jsx`).

## The rules (owner + AUDIT)
1. **Charts first.** A control that Charts can show is taught on Charts. Only a control Charts cannot show goes to the page.
2. **Ask first, never navigate without a yes.** Before any page change the guide asks: *"This is on the Watchlists page. Go
   there now?"* with **Yes / No**. No answer, or No, means the member stays put and nothing changes.
3. **No workspace writes, ever.** The walkthrough reads the screen and rings controls; it never writes a pref, the board,
   a layout or a list (AUDIT rail (a): spy on navigation and on workspace writes).
4. **Cancel and exit work across the page change.** Exit, Escape, a new request, or leaving the page ends it cleanly.
5. **Back on Charts the board is untouched.** Byte-identical board pref before and after.
6. **No new execution scope.** The navigation is the existing allow-listed page navigation (`capabilities/app.js`
   `DESTINATIONS`, `host.navigate`), taken only on the member's Yes, for a walkthrough.

## Flow
1. On Charts, `guide.show` routes the words to a walkthrough whose `surface` is `watchlists` (new page features in
   `guide/registry.js`, like the Screener's).
2. `answer()` sees the surface differs and returns an **ask** instead of "open it and ask me again": the question with
   Yes / No (the panel's existing choice buttons, as `doItForMe` uses them). Nothing is rung.
3. **No** → *"OK — staying here."* Nothing else happens.
4. **Yes** → the Agent's handoff (`AgentProvider` `handoff.set`, declared for exactly this and unused today) records
   `{ guide: { feature, detail } }`; then `host.navigate('/watchlists')` (once).
5. The Watchlists page registers its Agent page host (`useAgentPageHost('watchlists', host)`: a read-only host, no
   execution capabilities). The panel that lands takes the handoff **once** and starts the walkthrough there.
6. Exit / Escape / a new request / leaving the page end it (the lifecycle already in ship-2). Returning to Charts mounts the
   member's board from its own pref, which the walkthrough never wrote.

## What needs owners other than pl-teach
| Change | File | Owner |
|---|---|---|
| Register the Agent page host on the Watchlists page (read-only host, surface `watchlists`) | `pages/Watchlists.jsx` | Watchlists page owner |
| The landing panel takes the handoff once and starts the walkthrough | `agent/AgentPanel.jsx` or `useAgent.js` (a tiny hook) | Agent shell (the Lead's call; `useAgent.js` tiny edits were granted before) |
| Watchlists-page anchors (`data-guide`) for the header and row-menu controls, attribute-only | `pages/Watchlists.jsx` | Watchlists page owner |

pl-teach owns: the page features and walkthroughs (`guide/registry.js`, `guide/actions.js`), the ask in
`capabilities/guide.js`, the rails, the runner support for a page change.

## Rails (written first, as `it.todo` until the owners' pieces land: `agentGuideWatchlistsPage.test.jsx`)
1. The ask is shown for a Watchlists-page walkthrough, and **`host.navigate` is not called** before Yes.
2. **No** → no navigation, no walkthrough, no workspace write (spied: `persist`, `setPref`, layout and list writers).
3. **Yes** → `navigate('/watchlists')` exactly once; the handoff holds the walkthrough; still no workspace write.
4. The landing panel starts the walkthrough from the handoff exactly once, and a reload does not restart it.
5. Cancel after navigating (Exit, Escape, a new request) ends it; no write.
6. Back on Charts, the board pref is byte-identical to before the ask.
7. A control Charts can show is never sent to the page (Charts first).

## Not in scope
- Executing watchlist actions on the page (rename, export …): teaching only.
- The Signal-anchor walkthroughs: they wait for Pine's #994 on a separate branch (AUDIT (b)).

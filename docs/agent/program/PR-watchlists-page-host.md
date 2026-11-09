# PR: a read-only Agent page host on the Watchlists page (teaching only)

> LOCAL / SIMULATED. Branch `agent/pl/watchlists-page-host`, cut from master `46f28be66c`.

## Who authorised it
The Watchlists page owners were unavailable. The owner authorised this change on 2026-11-09, with these limits:
no watchlist execution powers, no watchlist data writes, no navigation without the member's yes, and cancel /
return-to-Charts preserved. pl-teach made it from `TEACH-WATCHLISTS-PAGE.patch` (cov-4 item 8). Nothing else from
the cov lineage is in this PR.

## What changes (product commit `78718f7d85`)
- `app/src/agent/hosts/usePageAgentHosts.js`: adds `useWatchlistsAgentHost({ embedded })`.
  - It is the bare page frame from `buildPageHost`: `surface: 'watchlists'`, `location()`, `navigate(to)`. That is all.
  - It has no capabilities of its own. It has no `watchlists` library (the door `capabilities/watchlist.js` reads and
    writes through) and no list writers.
  - `navigate` forwards to the app's existing allow-listed navigation only when something calls it. The host never
    calls it on its own.
  - It registers nothing in the Charts widget's embedded list, for a member without the Agent, or outside a provider.
- `app/src/pages/Watchlists.jsx`: one hook call, plus two attribute-only anchors, both on the page only:
  - `data-guide="watchlists.page"` on the page root;
  - `data-guide="watchlist.listName"` on the list name.
  - The embedded widget's markup is unchanged. `Watchlists.entitykeys`' golden render hashes the same with and
    without this PR (see below).

## Rails (test commit `1f9a14ce06`, `app/src/agent/agentPageWatchlists.test.jsx`, 8 tests)
1. The host's keys are exactly `location`, `navigate` and `surface`. Every write door a capability uses is absent.
   Reading `location()` navigates nowhere and writes nothing.
2. `navigate` forwards once per call and is never called on mount.
3. The embedded list, a member (`allowed: false`) and a render outside a provider each register nothing.
4. Mounting the page with the Agent writes nothing more than mounting it without. Checked: fetch writes, SWR
   `mutate`, prefs, flags, tags, alerts, `localStorage` keys and router navigation. No non-GET request either way.
5. The embedded list carries neither anchor and registers no host.
6. The manifest sent from this page has no `watchlist.*`, `chart.*`, `widget.*`, `journal.*`, `layout.*`,
   `alert.*`, `indicator.*` or `digest.*` capability. Its only non-read is `app.open`, the existing page navigation,
   which runs only when the member asks.

## Results (LOCAL / SIMULATED; Windows Node, vitest at BelowNormal)
- Rail, the page's own tests and the Agent page-host tests all pass: **64/64**.
  - Files: `agentPageWatchlists`, `Watchlists.rowmenu` / `.keyboard` / `.chartmount`,
    `agentPageBreadth` / `Calendar` / `Journal` / `Screener`, `agentProviderMembers`, `agentGuidePages`.
- All `src/pages/Watchlists*` tests, plus `WatchlistWidget` and `src/agent/contract`: 159/160.
  - The one failure is `Watchlists.entitykeys` "byte-identical … golden sha". **It fails the same way on unmodified
    master `46f28be66c`** in this environment.
  - With this PR, the rendered hash equals master's (`1aa5e8aa…`), so the PR does not change it.
  - An earlier draft that also put `watchlist.listName` on the embedded list did change that hash. That is why the
    anchor is page-only.
- Notebook bytes (`vite build` + `python tools/notebook_perf_budgets.py --dist`, budget as of the merge base `46f28be66c`):
  - master: 2,252,608 B;
  - this PR: 2,252,816 B;
  - **delta +208 B**, budget 2,264,889 B, 12,073 B headroom. Verdict: PASS.

## ⚠ What this PR does not do yet: there is no live Watchlists page to land on
`/watchlists` is a `LegacyRedirect` in `App.jsx`: it goes to `/charts?ensure=watchlist`. The file header of
`pages/Watchlists.jsx` says the unscoped page "ships nowhere". So on master today:
- the non-embedded `Watchlists` never mounts, so this host never registers and the anchors never render;
- cov-4-wl's ask-then-`navigate('/watchlists')` (`guide/pageWalk.js` `PAGE_PATHS`) would land back on Charts, with
  no page host and no walkthrough to start.

This PR is safe to merge, because it is inert. But it does not by itself make the cov-4 item 8 walkthroughs reachable.
That needs one of these owner decisions:
- (a) give the page a real route again;
- (b) teach those controls on Charts, in the Watchlist widget, outside pick mode;
- (c) drop the 29 rows from scope.

Until then `READY.watchlists` stays false on cov-4-wl.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Dhm4qhJhGoto7iixuJEEzM

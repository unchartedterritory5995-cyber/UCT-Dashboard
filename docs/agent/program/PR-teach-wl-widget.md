# PR: watchlist teaching inside the Charts Watchlist widget (owner decision 2026-11-09)

> LOCAL / SIMULATED (BROWSER-MOCK-MODEL for runner counts). Branch `agent/pl/teach-wl-widget`.
> - Stacked on `teach-cov-5` at `c387b2ad53`, so it sits on top of #1011.
> - Master `b554908dda` (#1005) and `50302a62b8` (#1006) are merged in.
> - Teaching only: no navigation, no workspace writes, nothing executed for the member.
> - The widget's anchors are in their own commit.

## Scope
The 29 watchlist rows of `TEACH-WATCHLISTS-WIDGET-DESIGN.md`, taught inside the Charts widget. The Watchlists-page
approach was dropped. #1011 reverts its page-walk code, and the page-host branch was never merged.

## What it teaches
- **Group A, controls the widget already shows:**
  - a list from a template (‹ Lists → ＋ New → Template);
  - a saved watchlist look (⚙ → Templates);
  - the widget's look (⚙);
  - attention facts (column menu → Attention);
  - column order (drag a title);
  - show or hide columns, resize, reset, a ticker's note, add or remove a ticker.
  - Every step the member takes to change mode is highlighted (‹ Lists, ⚙, a right-click). The Agent never changes the
    mode itself.
- **A member's own lists, by name** (`guide/listRefs.js`).
  - The names are read at run time from the watchlist store: "add NVDA to Momentum", "my swing ideas list". None is
    hard-coded.
  - On Charts, a column means a list widget's column, and a note on a ticker means a list row's note.
- **The list menu from the title** (#1005 + #1006, live). The member right-clicks the list's name, or clicks ⋯ List
  actions beside it, and then the row. Rows taught: Rename (including Flagged), Copy list to clipboard, Export
  CSV/Excel, Import tickers, Version history, Share with community / Make Private, Publish to Prebuilt (admin), and Save
  to My Lists… (a community list).
- **NOT IN PRODUCT** (a new status bucket, `notInProduct.json`, with the reason per row). These are not counted as
  missing:
  - C3-066: colour-tag lists;
  - C3-081: reorder a ticker by hand;
  - C3-084: column presets;
  - C3-089: expand or collapse a list;
  - C3-090: colour tag. It is set from the ticker action menu, not from the widget.
  - C3-080: Remove starred. Nothing in the product stars a ticker in a list, so that row never shows.

## Commits (own; merges of master and #1011's lineage aside)
**Design:** `c387b2ad53` (TEACH-WATCHLISTS-WIDGET-DESIGN).

**Held-out first, each committed before its routing:**
- `8246cf0b85`: group A;
- `d2f3102ea4`: list names;
- `53064a6219`: columns and notes without the word "list";
- `428119351d`: the title menu.

**Anchor (attribute only):** `166ded7811`, `data-guide="watchlist.settings"` on the portalled settings panel.

**Guide (product):**
- `dabe420b4a`: group A;
- `01e48c8e4f`: list names and context;
- `e9ac01364e`: the title-menu rows;
- `2bc33134b0`: opening a community list is never "Sharing";
- `ba5ffd28c7`: ⋯ first while the title was not hit;
- `e975e28beb`: the name's right-click (#1006 live);
- `bd2db9ef4f`: Remove starred is not taught.

**Rails and harness:**
- `0719de21a9`, `f474bf1601`, `a51ff1d9dc`, `3a7e64fafb`: the widget rails (highlight, the member's own step named,
  Exit / Escape / new request, no-write spy);
- `51ff146b07`: 11-07 held-out rows reinstated;
- `23a91e0156`, `3c47d8a56f`: the NOT IN PRODUCT bucket;
- `7bf99b59f3`: fixture lists in one module;
- `f1fbd572f4`: C3-080, plus the community-list given seeded through the real routes;
- assignments `5fb754364d`, `0c20e79dd6`.

## Evidence (SIMULATED)
- **Held-out:**
  - group A: 19/19;
  - list names: 11/11;
  - columns and notes: 8/8;
  - title menu: 12/13, plus 1 KNOWN MISS (Remove starred, not in product), recorded both ways.
- **Browser, title-menu cases once each, right-click step:** 9/9 (`runs/2026-11-09.titlemenu-rightclick.results.json`).
- **Fresh full runner pass** at `f570d32a69` (Vite fresh, frozen cases file): **314 VERIFIED of 338 cases.**
  - No new failures against the previous pass.
  - Status regenerated: 314 VERIFIED, 6 NOT IN PRODUCT (`runs/2026-11-10.wlwidget.results.json`).
- **Locked suite:** see below.

## Note for the stack
This branch was cut from `teach-cov-5` before #1011's page-walk revert (`a7397ec6e3`). It does not change those
files, so stacking on #1011 keeps the revert. A merge of #1011's head in here before AUDIT's GO is the Lead's call.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Dhm4qhJhGoto7iixuJEEzM

## Locked suite and bytes (SIMULATED)
- **One locked full suite** at `3ad0d4c277` (`src/agent`, `src/pages/command`, `src/pages/Watchlists*`,
  `src/pages/charts/widgets`; quiet machine; BelowNormal):
  - `Test Files 3 failed | 405 passed | 5 skipped (413)`, `Tests 4 failed | 10894 passed | 14 skipped (10912)`.
  - All four failures are the pre-existing master reds: `keyListenerCensus` ×2, `shortcutRegistry` DrillPlayer ×1, and
    the `Watchlists.entitykeys` golden.
  - The golden's local hash here is `3a6e9485…`, the same as master since #1006. This branch's anchor sits on the
    settings panel, which that render does not open.
- **Notebook bytes:** master `50302a62b8` 2,254,164 B → this head 2,254,173 B.
  - **+9 B**, inside the 2,260,793 B budget (PASS).
  - It is the same minifier naming in the entry chunk as #1011, where the Lead accepted it.

## On master `388dee7fce` (#1011 merged): head `0d605b91fd` (SIMULATED)
- **Merge:** one merge commit of master `388dee7fce`. The only conflict was the generated `CHARTS_TEACH_STATUS.md`.
  This branch's own status was kept: it comes from this branch's newer full pass, and the cases file is identical.
- **#1011's page-walk revert holds after the merge:**
  - `git ls-tree -r HEAD`: neither `app/src/agent/guide/pageWalk.js` nor `agentGuideWatchlistsPage.test.jsx` is in the
    tree.
  - `grep -E "pageWalk|pageWalkOffer|watchlistPage|WATCHLIST_PAGE_ACTIONS|goToPageWalk|takePageWalk|guidePage"` over
    `app/src`: no matches.
  - `manifest.golden.json` has no `watchlistPage`.
- **Related tests and guide tests** (guide, contracts, Sat1 requests, AgentPanel, useAgent, Watchlists, the widget):
  1350 passed.
  - The one failure is the pre-existing `Watchlists.entitykeys` master red.
  - The regenerated cases are identical to the frozen 338.
- **Notebook bytes:** master `388dee7fce` 2,254,173 B → this head 2,254,173 B. **Delta 0.**
- **One locked full suite** at `0d605b91fd`:
  - `Test Files 3 failed | 404 passed | 5 skipped (412)`, `Tests 4 failed | 10884 passed | 14 skipped (10902)`.
  - All four failures are the pre-existing master reds (command ×3, entitykeys golden).

## R-RAW browser evidence: the 9 title-menu cases (`docs/agent/program/evidence/teach-wl-widget/`)
LOCAL headless Chrome on the agent harness, real CDP input, scripted model. Same format as
`evidence/watchlist-title-hit/`.

**What the runner records.** `teach.mjs`, with `TEACH_EVIDENCE_DIR` set (an opt-in capture added to the runner), records
for every right-click it makes:
- the pointer coordinates;
- `document.elementFromPoint` at that point;
- the step's text and its ring;
- the menu that is open, with its rows;
- a screenshot before and after the press.

**Files:**
- per case: `<id>.json` (the full case record: every step's ring box and primary box, `onPrimary`, and the `evidence`
  entries), plus `<id>-rightclick-before.png` and `<id>-rightclick-after.png`;
- `run.json`: the run as a whole.

**Result: 9/9 pass.** In every case:
- the right-click point is the list name's text centre (1000.5, 118);
- `elementFromPoint` there is `watchlist.title`, the inner span from #1006;
- after the press the open menu is `watchlist.rowMenu`, with its rows listed;
- the last step's ring is on the named row (`onPrimary: true`).

| Case | Row the walkthrough ends on | Menu rows after the right-click |
|---|---|---|
| C3-072 Save a community list | Save to My Lists… | Copy list to clipboard, Save to My Lists… (a community list open, via the community given) |
| C3-073 Rename a list | Rename | Rename, Copy list to clipboard, Export CSV, Import tickers, Share with community, Publish to Prebuilt (UCT) |
| C3-074 Rename the Flagged list | Rename | as C3-073 (the runner opens the fixture list "Momentum"; Flagged's menu has the same Rename row) |
| C3-091 Share a tag colour or Flagged | Share with community | as C3-073 |
| C3-092 Make a list public | Share with community | as C3-073 |
| C3-093 Mark a list prebuilt (admin) | Publish to Prebuilt (UCT) | as C3-073 |
| C3-094 Copy a list | Copy list to clipboard | as C3-073 |
| C3-095 Export CSV or Excel | Export CSV | as C3-073 |
| C3-097 Version history | Version history | as C3-073, plus Version history (the version store given) |

**Attempt 1 was not kept.** See `RUN-LOG.md` in the evidence folder. Its menu probe read ⋯ instead of the menu. In that attempt C3-095 failed once, with a "Do you mean …?" reply, and then passed when re-run alone. I deleted those files before committing, which was wrong: raw output, failed attempts included, is committed before interpretation. They cannot be recovered. Attempt 2, above, is the result, and from now on every attempt is kept and labelled.

## `guide/listRefs.js` only reads
It reads list names through `host.watchlists.snapshot()`, a read of the store's current rows, and rewrites the
request's words for routing only. It makes no store write, no `fetch`, no SWR mutate, and has no other side effect (see
the diff: two pure functions plus that one read).

# PR: watchlist teaching inside the Charts Watchlist widget (owner decision 2026-11-09)

> LOCAL / SIMULATED (BROWSER-MOCK-MODEL for runner counts). Branch `agent/pl/teach-wl-widget`.
> - Stacked on `teach-cov-5` at `c387b2ad53`, so it sits on top of #1011.
> - Master `b554908dda` (#1005) and `50302a62b8` (#1006) are merged in.
> - Teaching only: no navigation, no workspace writes, nothing executed for the member.
> - The widget's anchors are in their own commit.

## Release readiness (2026-11-11, pl-teach): independent PR, on master `381f91acbd`
> LOCAL / jsdom for the tests below. Tested head `21ccffc6c0`; the commit that adds this section and the two raw logs changes docs only.

### Merge
- One merge commit of origin/master `381f91acbd` (188 commits since the last base `292983f4bc`): `21ccffc6c0`. **No
  conflicts.** Master's own guide changes in it (`guide/explain.js`, `guide/slots.js`, `capabilities/guide.js`) merged
  automatically.

### Overlap with #1028 (teach-chart-menu) and #1024 (teach-givens), from git
`git merge-tree` of this head with each branch head (#1028 `7cf11ebffb`, #1024 local `c7f85a9d8c`, which contains #1028):
- **#1028:** 5 shared files (`guide/actions.js`, `guide/words.js`, `teach.mjs`, `cases.inventory.json`,
  `expected.json`). **Merges clean.**
- **#1024:** 8 shared files (the 5 above plus `given.mjs`, `agentHarness.jsx`, `agentGuideTargets.test.js`). **One
  textual conflict, in `given.mjs`, on one line, `queryFor`:** this PR adds `g.lists ? 'watchlists=1' : ''`, #1024
  adds `...(g.extraQuery || [])`. The resolution is the union of both. No semantic conflict:
  - #1024's declared givens (`caseGivens.json`) name no watchlist case, and its `givens.mjs` adds no list or community
    given;
  - its declared routes go FIRST in `fixturesFor`, and this PR's community routes (`/api/watchlists/public`,
    `/api/auth/me`) are pushed after them, so neither shadows the other;
  - `cases.inventory.json` and `expected.json` are generated (`agentGuideInventory`). They auto-merge, but whichever
    PR lands second re-runs `agentGuideInventory` + `agentGuideTargets` on the merge.
- **Order:** either order works. Proposed: #1026 → #1020 → #1028 → #1024 → **#1014**. This PR goes last, so the one-line
  `queryFor` union is made here, on a merge with master, and tested here.

### Files (git-derived: `git diff --name-only origin/master HEAD`: 71 files at `21ccffc6c0`, 73 with the two raw logs below)
- **Product (6):** `app/src/agent/capabilities/guide.js`, `app/src/agent/guide/actions.js`,
  `app/src/agent/guide/listRefs.js` (new), `app/src/agent/guide/registry.js`, `app/src/agent/guide/words.js`,
  `app/src/pages/watchlist/WatchlistSettingsPanel.jsx` (one `data-guide` attribute).
- **Tests (9):** `agentGuideHeldOutControls`, `agentGuideHeldOutListColumns`, `agentGuideHeldOutListNames`,
  `agentGuideHeldOutWlTitleMenu`, `agentGuideHeldOutWlWidget`, `agentGuideInventory`, `agentGuideListRefsNoLookbehind`,
  `agentGuideTargets`, `agentGuideWlWidgetRails` (all `app/src/agent/*.test.js[x]`).
- **Harness and runner data (15, `app/src/testing/agent/`):** `agentHarness.jsx`, `fixtureWatchlists.js`, and in
  `guide/`: `cases.inventory.json`, `expected.json`, `given.mjs`, `knownMisses.json`, `notInProduct.json`,
  `status.mjs`, `teach.mjs`, plus 6 `runs/*.results.json`.
- **Docs and evidence (41, then 43):** `docs/agent/CHARTS_TEACH_STATUS.md`, this file, and
  `docs/agent/program/evidence/teach-wl-widget/**` (9 cases × json + 2 png, run log, scoped-suite log, lookbehind
  before/after).

### Focused tests at `21ccffc6c0` (LOCAL, jsdom, no lock, BelowNormal, node_modules LinkType Junction)
- Two runs, one after the other, 39 files (all 35 `agentGuide*` files, which include this PR's 9 own tests and the
  listRefs rail `agentGuideListRefsNoLookbehind`, plus the lookbehind rails `noRegexLookbehind`, `agentNoLookbehindStrings`,
  `agentNoLookbehindEquivalence`, `agentNoLookbehindOracle`):
  - run 1 (20 files): `Test Files 20 passed (20)`, `Tests 488 passed | 8 skipped (496)`;
  - run 2 (19 files): `Test Files 19 passed (19)`, `Tests 667 passed (667)`;
  - **total 39/39 files, 1155 passed, 8 skipped, 0 failed.** Raw logs: `evidence/teach-wl-widget/after/focused.21ccffc6c0.r1.log`, `.r2.log`.
- Code since then: docs only.

### Try it in production (Charts, Agent panel, with a Watchlist widget on the board; each step is highlighted and you click)
1. "how do I make a list using a saved template": rings ‹ Lists, then ＋ New, then Template.
2. "how do I hide the volume column in my watchlist": highlights the column controls step by step.
3. "how do I rename my <one of your list names> list": rings the list's name in the widget title (right-click it), then
   Rename. Also try "how do I export a list to CSV".
4. "how do I write a note on a ticker in my list": highlights where a row's note is written.
5. "how do I take TSLA off my watchlist": highlights the remove step. Nothing is removed for you.

### Known limits
- Teach only: the Agent never changes the widget's mode, never writes a list, a note or the board. The member clicks.
- 6 rows are NOT IN PRODUCT and are answered as such, not taught: colour-tag lists (C3-066), reorder a ticker by hand
  (C3-081), column presets (C3-084), expand/collapse a list (C3-089), colour tag from the widget (C3-090), Remove starred
  (C3-080).
- List names are read from the member's own watchlist store at run time; a name the member has never saved is not
  recognised as a list.
- Publish to Prebuilt shows for admins only. Save to My Lists… shows only with a community list open in the widget and
  the copy-or-link switch on for that member. Version history shows only while the version store is on.
- The browser evidence (9/9 title-menu cases, 314 VERIFIED of 338) is LOCAL headless Chrome on the harness with a
  scripted model, not production.
- **Notebook first-open bytes:** `app/src/agent/guide/*` changed, so CI's gating `notebook bytes` workflow
  (`.github/workflows/notebook-bytes.yml`, budget in `docs/notebook/perf-budgets.json`) checks this PR. Last local
  reading +9 B, then 0 B on master `388dee7fce`; not rebuilt on this merge.


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
- **Locked SCOPED suite:** see below. It is not a whole-tree run.

## Note for the stack
This branch was cut from `teach-cov-5` before #1011's page-walk revert (`a7397ec6e3`). It does not change those
files, so stacking on #1011 keeps the revert. A merge of #1011's head in here before AUDIT's GO is the Lead's call.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Dhm4qhJhGoto7iixuJEEzM

## Locked scoped suite and bytes (SIMULATED)
- **One locked SCOPED suite** at `3ad0d4c277` (`src/agent`, `src/pages/command`, `src/pages/Watchlists`,
  `src/pages/charts/widgets`; 413 files; quiet machine; BelowNormal). It is not a whole-tree run:
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
- **One locked SCOPED suite** at `0d605b91fd` (`src/agent`, `src/pages/command`, `src/pages/Watchlists`,
  `src/pages/charts/widgets`; 412 files). It is not a whole-tree run:
  - `Test Files 3 failed | 404 passed | 5 skipped (412)`, `Tests 4 failed | 10884 passed | 14 skipped (10902)`.
  - All four failures are the pre-existing master reds (command ×3, entitykeys golden).
- **Outside that scope (reconciled 2026-11-10, LOCAL / SIMULATED):** a partial whole-tree run elsewhere (teach-keys)
  failed 51 test files. Those 51 were rerun here, in pl-teach-wl2, at the master base `388dee7fce` and at `0d605b91fd`:
  - both: `Test Files 46 failed | 5 passed (51)`, `Tests 50 failed | 702 passed | 48 skipped (800)`;
  - the 46 failing FILE NAMES are identical at both, so this branch adds no failing file;
  - 3 of the 46 are inside the scope above and are its known reds (`Watchlists.entitykeys`, `keyListenerCensus`,
    `shortcutRegistry`); the other 43 are outside it, belong to other teams, and are morning-report material;
  - the 5 that pass here were teach-keys' own (3 golden manifests for its new enum id) and 2 load-only reds;
  - the 3 census files checked (formControls.census, formControls.terminal, persistenceManifest) fail identically on
    pl-mc-fw's own fresh install, which rules out the shared install for them;
  - `0d605b91fd..002cfb5516` changes only `teach.mjs` (the opt-in evidence capture) and docs.

  <details><summary>The 46 failing files at <code>388dee7fce</code> and <code>0d605b91fd</code> (identical)</summary>

  - `src/__tests__/sourcesAreText.test.js`
  - `src/components/StockChart.firstVisitFraming.test.jsx`
  - `src/components/StockChart.focusWarmStep.test.jsx`
  - `src/components/chart/engine/ast/symbolFoldParity.test.js`
  - `src/components/chart/engine/ast/targetScriptReport.measure.test.js`
  - `src/components/chart/engine/runtime/__tests__/hostParity.v8.rail.test.js`
  - `src/components/chart/engine/useServerColumns.test.jsx`
  - `src/components/provenance/freshnessAge.test.js`
  - `src/components/provenance/panelAdoption.ratchet.test.js`
  - `src/components/screener/reachable.test.js`
  - `src/components/ui/formControls.census.test.js`
  - `src/hub/writePathsTransitive.test.js`
  - `src/lib/context/symbolLinkChannels.test.js`
  - `src/lib/persistence/persistenceManifest.test.js`
  - `src/lib/presentation/dataGrid/dataGridSeed.rail.test.js`
  - `src/lib/presentation/handRolledFormatters.census.test.js`
  - `src/lib/swallowedFetch.census.test.js`
  - `src/noRegexLookbehind.test.js`
  - `src/pages/Watchlists.entitykeys.test.jsx` (in scope: known red)
  - `src/pages/command/keyListenerCensus.test.js` (in scope: known red)
  - `src/pages/command/shortcutRegistry.test.js` (in scope: known red)
  - `src/pages/journal-2-0/components/notebook/ChartEmbed.touchTargets.test.js`
  - `src/pages/journal-2-0/components/notebook/frozenWorkspace.test.jsx`
  - `src/pages/journal-2-0/components/notebook/myTools/VersionHistory.test.jsx`
  - `src/pages/journal-2-0/lib/calloutNode.variant.test.js`
  - `src/pages/journal-2-0/lib/captureContext.test.js`
  - `src/pages/journal-2-0/lib/dateMentionNode.test.js`
  - `src/pages/journal-2-0/lib/formula/offlineNeverStoresComputed.test.js`
  - `src/pages/journal-2-0/lib/importer/evernoteLinks.test.js`
  - `src/pages/journal-2-0/lib/importer/exportFormats.roundtrip.test.js`
  - `src/pages/journal-2-0/lib/importer/exportRoundtrip.test.js`
  - `src/pages/journal-2-0/lib/importer/fidelityCarryovers.roundtrip.test.js`
  - `src/pages/journal-2-0/lib/iteratorGlobalFloor.test.js`
  - `src/pages/journal-2-0/lib/noteBatch.jsonRoundtrip.test.js`
  - `src/pages/journal-2-0/lib/offline/noteCopy.test.js`
  - `src/pages/journal-2-0/lib/selectionExport.roundtrip.test.js`
  - `src/pages/journal-2-0/lib/templateLibrary.server.test.js`
  - `src/pages/journal-2-0/lib/widgetFormula/widgetFormula.lazy.test.js`
  - `src/pages/journal-2-0/rawErrorSurface.test.js`
  - `src/pages/terminal/a11y/terminalA11yStatic.test.js`
  - `src/pages/terminal/a11y/terminalReachableContrast.test.js`
  - `src/pages/terminal/formControls.terminal.test.js`
  - `src/pages/terminal/themeColours.rail.test.js`
  - `src/styles/tokens.reachable.test.js`
  - `src/surfaces/manifest.test.js`
  - `src/utils/jsonFetcher.test.js`

  </details>

## Limits, and the rail that proves each (LOCAL / SIMULATED)
- **listRefs.js only reads.** `app/src/agent/guide/listRefs.js` touches the host in one place,
  `host?.watchlists?.snapshot?.()` (`listNamesOf`). It writes nothing: it only rewrites the words for routing. Its one
  caller is `capabilities/guide.js` (guide.show's fast path). Rails: `agentGuideHeldOutListNames.test.js` (a host
  that has nothing but `watchlists.snapshot`), and `agentGuideWlWidgetRails.test.jsx` (below) on the real board.
- **Teach only, and no workspace writes.** `agentGuideWlWidgetRails.test.jsx`, "rings a real control, names the
  member's step, and writes nothing": no non-GET request outside `/api/agent/`, no watchlist store key written, and the
  board's widgets byte-identical before, during and after Exit. `agentGuideTargets.test.js:113`: guide.explain and
  guide.show are queries (`query: true`, no `apply`), so they can never change the workspace.
- **Ask before acting.** `agentGuide.test.jsx:375` D2, "nothing runs on a guess": the board is unchanged and the
  chart's timeframe is untouched. `agentGuidePages.test.jsx:163`, "DO IT FOR ME … says so — nothing runs".
- **No navigation without a yes.** This branch has no page walk (#1011's revert holds; see above). A walkthrough for
  another page only says where it lives: `agentGuidePages.test.jsx:262`, "points the member there — nothing is
  highlighted".

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

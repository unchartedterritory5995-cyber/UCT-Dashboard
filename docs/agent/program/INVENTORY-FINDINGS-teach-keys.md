# Inventory findings from teach-keys (for pl-auto's inventory-v2; the inventory itself is not edited here)

> The code read is at master `dfc645ccb3`. "CW" is `pages/charts/ChartsWorkspace.jsx`, "CWID" is
> `pages/charts/widgets/ChartWidget.jsx`, "SC" is `components/StockChart.jsx` and "KS" is
> `components/chart/keyboardShortcuts.js`.

| row | class | in one line |
|---|---|---|
| C3-223 | documentation mismatch | the key exists, but it captures a chart to the Journal; it toggles nothing |
| C1-123 | alternative access path → **present, pending merge** (owner-approved 2026-11-10) | the desktop /charts right-click menu never had Add indicator; the owner approved adding it, built on `agent/pl/chart-menu-add-indicator` (not yet on master) |
| C1-175 | documentation mismatch | Esc is declared and teachable; the row says it has no walkthrough and is BLOCKED |
| C3-080 | intentional removal, dead residue | "Remove starred" lost its only trigger on purpose in `72482c8400`; the code and CLAUDE.md line are leftovers |

Follow-up of 2026-11-10 (proposals only, nothing implemented): (a) C3-080 is below, and (b) and (c) are added under
C3-223 and C1-123.

## C3-223: "Toggle the journal shortcut (Ctrl+Alt+J)", cited at CW:2678

**What the code does**
- Two raw `keydown` listeners handle the key:
  - CWID:591 posts the last-hovered chart to the Journal inbox (`POST /api/j2/inbox`). Only the hovered chart answers.
  - CW:2843 handles the press when no chart is hovered, in single-chart mode. It shows a toast: "Hover a chart first — Ctrl+Alt+J
    captures the hovered chart".
- Nothing is toggled.
- The key is in neither registry: it is not in KS SHORTCUTS, so the `?` help overlay does not list it, and it is not in
  `pages/command/shortcutRegistry.js`.

**When it appeared:** `git log -S` dates it to `e312b0bf44` (2026-08-12, "insertion workflows — send-to-journal,
Ctrl+Alt+J capture, inbox tray"). `242bda9fe9` (2026-08-13) also touched it, and it is unchanged since. The inventory row
arrived with the first matrix (`0bb8f2a585`, 2026-11-05) and its wording was wrong from the start. The CW:2678 citation
is stale: the listener is at CW:2843 now.

**Proposed correction**
- Action: "Capture the hovered chart to the Journal inbox (Ctrl+Alt+J)".
- Source: CWID:591 and CW:2843.
- Note: "not declared in SHORTCUTS: absent from the ? overlay".

**Product follow-up, owner's call:** declare it in SHORTCUTS. The guide's key family would then teach it with no
guide change, because rows are built from SHORTCUTS.

**(b) Handler re-verified 2026-11-10 at `dfc645ccb3`**
- **Intended behaviour.** Both handlers say the same thing in their code comments.
  - CWID:586-615: "One-keystroke capture … only the last-hovered chart answers, so one press banks ONE chart into the
    inbox even with six on the board."
  - In detail, the widget handler checks `e.ctrlKey && e.altKey && e.key in {j, J}` and returns early on
    `isHiddenDeskKey(e)`. It requires `activeChartRef.current === widgetIdRef.current`; it deliberately does not use
    `hotkeysIsActive()`, because null-means-all would post N inbox rows.
  - It then POSTs `/api/j2/inbox` and shows the toast "SYM captured → Notebook inbox" or "Capture failed — try again".
  - CW:2833-2851 shows "Hover a chart first …" only when no chart is hovered, the board is shown and the layout is not
    grid mode. Its comment says grid cells don't implement capture.
- **History.**
  - Added in `e312b0bf44` (2026-08-12).
  - The explicit-hover-owner rule came from `e3236862f7` (2026-08-12, "capture demands an explicit hover owner").
  - Last touched in `a01389e3e7` (2026-11-09, the popped-out windows change); `git log -L` shows no behaviour change since.
- **No collision with Alt+J (horizontal ray).** `matchOverlayTool` returns null on any `ctrlKey || metaKey` (KS:404).
  `matchShortcut` returns null on any `altKey` (KS:228). So Ctrl+Alt+J never arms `tool:hray`.
- **Caveat for teaching it (flag before any SHORTCUTS declaration).** The handler tests `ctrlKey`, not `metaKey`.
  - The key family's rule "on a Mac, Cmd for Ctrl" would therefore produce a wrong instruction here. It would say
    Cmd+Option+J, but the code only answers Control+Option+J.
  - The handler also matches `e.key`, not `e.code`. With Option held, macOS can change `e.key` (Option+J gives '∆').
    Whether Control+Option+J reaches the handler with `e.key === 'j'` is UNVERIFIED: it needs a real Mac.
  - If the key is declared, it needs a per-row Mac override (or a `code: 'KeyJ'` match in the handler), not the
    blanket rule.

## C1-123: "Add indicator from menu", cited at SC:6012

**What the code does**
- The desktop /charts right-click menu is ChartWidget's own (CWID: `handleBarContextMenu`). Its rows are set-alert,
  journal, journal-choose, reset, settings, template, add-widget, clear-draw, ask-ai and pane-preset.
  - ChartWidget never reads the `sections` that StockChart hands it.
- StockChart's "Add indicator…" row (`id: 'ind-add'`, SC ~6925) is drawn only by the app-root menu, through
  `uct:chart-contextmenu` and then `GlobalAddPositionProvider` / `ChartContextMenu`. That happens only on a StockChart
  mount that has no `onBarContextMenu` host and has drawing tools.

**Was it ever there?** Not in the desktop widget menu.
- `git log -S"Add indicator" -- pages/charts/widgets/ChartWidget.jsx` returns no commits.
- The widget menu dates from `2c042b2a9f` (2026-07-15).
- StockChart's row was added later, in `87458cb206` (2026-08-03, "the library's other two entry points").

**Other ways to do it on desktop**
- the toolbar's indicator button;
- Alt+Shift+A, KS:173 (C1-172, now taught by the key family);
- Chart settings → Indicators.

**Proposed correction**
- Scope the row to the surfaces whose menu draws StockChart's sections, not desktop /charts.
- Add a desktop note: "no right-click entry; use the toolbar button or Alt+Shift+A".
- Owner decision: the comment at SC ~6902 cites spec §6, which names right-click as a third entry point to the
  library. On desktop /charts that entry does not exist. If the spec stands, this becomes a **missing feature** on desktop
  /charts: the widget menu would need to render the `ind-add` row.

**(c) Assessment of a widget-menu row that reuses the existing action (2026-11-10, proposal only)**
- **The existing action.** `openIndicatorLibrary`, at SC ~6915-6929, is `addIndicatorItem`
  (`id: 'ind-add'`, `onSelect: openIndicatorLibrary`).
  - It asks `toolbarRef.current.openIndicatorLibrary()` first and falls back to `openSettings()` on any non-`true`
    answer. That is the same order and the same call as Alt+Shift+A.
  - It writes nothing itself. Every add goes through the library dialog, and so through `setIndicatorEnabled`.
  - Its presence is the read-only gate (`showDrawingTools`).
  - It is pushed into the Chart region's section (SC:7179).
- **It already reaches the widget.** StockChart's `onBarContextMenu` payload carries `sections` (SC:18735-18742). The
  widget's `handleBarContextMenu` (CWID:520) copies selected fields into `ctxMenu` and drops `sections`.
- **Smallest no-duplicate shape.**
  - In `handleBarContextMenu`, keep only the `onSelect` of the `ind-add` item found in `p.sections`, for example as
    `addIndicator`.
  - Render one row when it is present; the row calls it, then `closeCtx()`.
  - No new launcher, no new gate, no settings write. If StockChart omits the item (read-only, Model Book, grid
    cell), the row is absent too. The same pattern already exists for `p.resetView` and `p.openSettings`.
- **What it does not cover.** `ind-add` is pushed only for the plot/price region branch, so a right-click on the price
  axis or time axis would still show no row. That matches StockChart's own menu, so it is consistent rather than a gap.
- **Costs and risks.**
  - One new `data-menu-id` on the widget menu. The guide would need a target for it, and any `data-guide` attribute
    needs the Lead's OK first.
  - The widget menu's row-order tests and goldens would change.
  - The C1-123 row would flip from "alternative access path" to "present".
  - This is a product change: the owner decides whether spec §6 stands for desktop /charts.

**(d) Owner decision and build (2026-11-10): APPROVED, built, NOT YET MERGED**
- The owner approved adding "Add indicator" to the desktop /charts right-click menu (spec §6 stands for desktop).
- Built on `agent/pl/chart-menu-add-indicator` off master `96230b5598`, in the shape (c) proposed:
  - `handleBarContextMenu` keeps StockChart's own `ind-add` item from `p.sections` (a handler is required); the row
    `data-menu-id="ind-add"`, just above Chart settings, calls that item's `onSelect` and closes the menu. No new
    launcher, no new gate. Absent wherever StockChart omits the item (read-only, no drawing tools, the price or time axis).
  - jsdom rails 5/5, written first (BEFORE 3 failed); 4 mutations each fail a rail.
  - REAL BROWSER (LOCAL harness): right-clicks in the price area offer the row and `elementFromPoint` at its centre is
    the row; the price axis menu has no row; a real click opens the indicator library (attempt-2; attempt-1 kept).
  - The walkthrough: C1-123 now assigned to `chartMenu` (right-click inside the chart, then Add indicator…, naming
    Alt+Shift+A as the other way in). Browser 1/1 + held-out 5/5 (LOCAL, BROWSER-MOCK-MODEL).
- Until that branch merges, master still matches (a)-(c) above: no row on desktop /charts.

## C1-175: "Escape to cursor / cancel", cited at KS:112

**What the code does**
- Esc is declared at KS:112 (`{ keys: 'Esc', command: 'tool:cursor', description: 'Cursor / cancel' }`), and the matcher
  maps `Escape` to `tool:cursor` (KS:257).
- `git log -S` dates it to `c95365468e` (2026-05-10, "keyboard shortcut matcher + help overlay").
- The `?` overlay lists it.

**The mismatch**
- The matrix row has Guide "none" and status BLOCKED ("Pointer-session state"). Teach status has NO WALKTHROUGH.
- The key is declared, and the chartKey walkthrough teaches it. Held-out HK-9, "what key cancels the drawing tool I
  picked", passes in a real browser (`evidence/teach-keys/run1-heldout.json`).
- The row's own words ("Escape to cursor / cancel") never say they are about a key, so they are not matched. I wrote no
  rule for that one sentence.

**Proposed correction**
- Action: "Press Esc to return to the cursor or cancel the armed drawing tool".
- Example: "what key cancels the drawing tool".
- Guide feature: chartKey, title "Cursor / cancel (Esc)".
- BLOCKED applies to *executing* Esc, which needs pointer-session state. It does not apply to teaching it.

## C3-080: "Remove all starred" (Watchlists list-name menu → "Remove starred (N)")

**What the code does** (`pages/Watchlists.jsx` at `dfc645ccb3`)
- The machinery is all still present:
  - `starred` state (:930);
  - `toggleStar` (:978);
  - `getStarredSyms` (:983);
  - `handleRemoveStarred` (:988; its only other `setStarred` call, at :1003, deletes keys);
  - the menu row, gated on `getStarredSyms(id).length > 0` (:3658-3662).
- `toggleStar` has no caller, and nothing else adds to `starred`. The set is therefore always empty, and the row can
  never render.
- The row's star now means Add to / Remove from Flagged.
- CLAUDE.md:5191 still documents "Star selection + bulk remove: star icon per row, right-click 'Remove starred (N)'".

**When and why the trigger was lost: intentionally**
- `git log -S toggleStar -- app/src` gives two commits:
  - `30bbd674e9` ("Add star selection and bulk remove for watchlist tickers") added it.
  - `72482c8400` (2026-07-19, "Watchlist columnar redesign: Flag·Sym·Price·Volume·%Change + star-as-flag") removed
    both `onClick={… toggleStar(…)}` callers.
- The 72482c8400 commit body says so outright: "The left star IS the Flagged toggle now" and "Note: inline
  drag-reorder + the old bulk 'star-select' were dropped in this pass (star is now the flag)."
- It was an owner-era redesign commit, not a regression. The commit left the state, helpers and menu row in place as
  dead code, and did not update CLAUDE.md.
- `git log -S "Remove starred"` shows only the original commit plus later agent-guide commits. Those commits teach
  around the row; none of them touch the product.

**Teaching status:** consistent already. PR #1014 withdraws "Remove starred" (`guide/actions.js:199`, the `WITHDRAWN`
set in `agentGuideHeldOutControls.test.js`, and "NOT IN PRODUCT (C3-080)").

**Proposal (not implemented)**
- Classify the row as **NOT IN PRODUCT: intentionally removed in 72482c8400**. It is not a defect, so restoration is
  not recommended by default. Restoring the per-row star as a selector would collide with the star-as-Flagged
  meaning the owner chose.
- Product clean-up, owner's call:
  - Delete the dead residue (`starred`, `toggleStar`, `getStarredSyms`, `handleRemoveStarred` and the
    "Remove starred" menu row).
  - Update CLAUDE.md:5191 to say the bulk star-select was dropped in 72482c8400.
- If the owner wants bulk removal back, reuse the existing `starred` Set and `handleRemoveStarred` (it already handles
  the Flagged list and linked-list gating) behind a selection gesture that is not the star, such as Ctrl/Cmd+click
  row multi-select. That is a new design decision, not a restoration, so it needs owner approval before any work.

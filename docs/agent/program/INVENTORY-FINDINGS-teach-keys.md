# Inventory findings from teach-keys (for pl-auto's inventory-v2; the inventory itself is not edited here)

> The code read is at master `dfc645ccb3`. "CW" is `pages/charts/ChartsWorkspace.jsx`, "CWID" is
> `pages/charts/widgets/ChartWidget.jsx`, "SC" is `components/StockChart.jsx` and "KS" is
> `components/chart/keyboardShortcuts.js`.

| row | class | in one line |
|---|---|---|
| C3-223 | documentation mismatch | the key exists, but it captures a chart to the Journal; it toggles nothing |
| C1-123 | alternative access path | the desktop /charts right-click menu never had Add indicator; other ways in exist |
| C1-175 | documentation mismatch | Esc is declared and teachable; the row says it has no walkthrough and is BLOCKED |

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

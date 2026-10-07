---
id: UX-DAILY-2026-10-06
title: UCT Terminal: daily-use interaction audit (command line, keys, linking, boards, panels, phone)
scope: app/src/pages/terminal/ interaction layer — CommandLine.jsx, parseCommand.js, ranking.js, recents.js, boardModel.js, BoardsMenu.jsx, TerminalShell.jsx, the terminal block of pages/command/shortcutRegistry.js, panels/HelpPanel.jsx
method: read from code and the existing vitest suites on branch terminal/fn-daily (base origin/master d46bfb033). No browser was used, so nothing here was measured on a real screen; "slow" means "more keystrokes or clicks than needed", not milliseconds.
date: 2026-10-06
status: shipped on terminal/fn-daily (see the last column of each table)
---

# UCT Terminal: daily-use audit

Who this is for: a swing trader who keeps the terminal open all day, flips through 20 to 60
tickers, and wants every common move to be one or two keystrokes, the way Bloomberg works
(`<ticker> <function> <GO>`, number keys for panels, history, autocomplete).

Benchmark used for each row: what a Bloomberg-style terminal user expects.

- **GO** = Enter runs the line. **MENU** = go back to the previous screen.
- Grammar is `<ticker> <function>`; a bare ticker loads the security.
- History recall on arrow keys, and search through history.
- Autocomplete that puts what you use first.
- Panels addressable by number; tab/cycle between them; close, maximise and re-link without the mouse.
- Every action reachable from the keyboard, and every control named for a screen reader.

Status key: **OK** = already right before this branch. **FIXED** = fixed or built on this branch.
**LEFT** = still open (listed again at the end).

## 1. Open a ticker in a function

| What happens today (before this branch) | Bloomberg expectation | Verdict | Status |
|---|---|---|---|
| `NVDA GP` + Enter puts the chart in the focused panel, links the group, and writes `?cmd=` so the command is a URL. | `<ticker> <func> <GO>` | Good. | OK |
| An echo line above the input says what Enter will do, before Enter (`GP: Chart on NVDA`), and flags unknown tickers ("did you mean NVDA?"). | Bloomberg has no echo; this is better. | Good. | OK |
| `@2 NVDA GP` / `@B NVDA` aim a command at panel 2 / group B. | Similar to Bloomberg's panel targeting. | Good. | OK |
| Autocomplete: codes and aliases are synchronous; **tickers only appear after the ticker search answers** (150 ms debounce plus a network round trip). A ticker you looked at a minute ago is fetched again. | Instant suggestions for things you use. | Slow on every keystroke for repeat tickers. | FIXED: tickers you recently viewed are offered instantly from the board's own channel history, before the search answers. |
| Ranking learns from use only for **function codes and aliases** (server-side counts). Tickers are never counted (by design: telemetry never stores a ticker), so a ticker you trade every day ranks no higher than one you never touched. | Recent and frequent items first. | Missing for tickers. | FIXED: tickers in your channel history get a recency tie-break inside their ranking class (never across a class boundary, so an exact match still wins). Computed in the browser from the board document; nothing new is sent to the server. |

## 2. Switch the ticker across linked panels

| Today | Expectation | Verdict | Status |
|---|---|---|---|
| A bare ticker (`AMD` + Enter) switches the whole link group to AMD, **but also turns the focused panel into DES (Overview)**. To keep a chart on screen you must type `AMD GP`. | Loading a security should not throw away the function you were looking at. | Slow: the most common move in a swing trader's day costs an extra token, and an easy slip loses the chart. | FIXED: **Shift+Enter** on a bare ticker loads it into the focused panel's link group and **keeps every panel's function**. Plain Enter is unchanged (bare ticker still opens DES, presets still apply). |
| Recents → Securities: one tap re-loads a past ticker into a group (keeps functions). | Quick-pick of recent tickers. | Good, but mouse/touch only and two steps (open sheet, tap). | FIXED (partly): Alt+R opens Recents from the keyboard; recent tickers now also appear first in autocomplete. |
| Re-linking a panel: click the coloured dot, pick a group from a popover. | One keystroke. | Mouse only. | FIXED: **Alt+L** cycles the focused panel through A, B, C, D, any groups the board added, then "not linked", and says which group (and ticker) it joined. |

## 3. Jump between panels by keyboard

| Today | Expectation | Verdict | Status |
|---|---|---|---|
| Alt+1..4 focuses panel N (from the command line too); Alt+[ / Alt+] step back/forward, wrapping. Alt+3 on a two-panel board says why nothing happened. | Number-key panel focus, cycling. | Good. | OK |
| No key to close the focused panel, re-open the last closed one, duplicate it, move it, or maximise it. Each needs the mouse (and duplicate/pop-out are hidden on phones). | Every panel action on the keyboard. | Missing. | FIXED: Alt+X close, Alt+Z re-open, Alt+C duplicate, Alt+Shift+[ / Alt+Shift+] move left/right, Alt+M maximise/restore. |
| No maximise at all: a chart in a four-panel board can never be seen full size without changing the board's panel count (which is saved). | Zoom a panel and come back. | Missing. | FIXED: Maximise (Alt+M or the header button) shows the focused panel alone; Alt+1..4 / Alt+[ ] flip through the others full size; Alt+M again restores. It is a view state, not saved to the board, and the other panels stay mounted (no reload when you come back). |
| HELP has a "Keys" table read from the shortcut registry, but it lists only panel focus, backtick and Ctrl/Cmd+K, and **none of the command-line keys** (↑/↓, Tab, Esc, Shift+Enter). | A visible cheat sheet. | Incomplete. | FIXED: HELP's Keys table now lists every terminal binding plus the command-line keys; **Alt+/** opens the same sheet over the board from anywhere. |
| Buttons do not announce their keys. | `aria-keyshortcuts` / tooltip. | Missing. | FIXED: bar and panel buttons carry `aria-keyshortcuts` and the key in their tooltip. |

Browser collisions avoided: no Ctrl+T/W/N/L/R/D, no Alt+D (address bar), Alt+F/E (Chrome menu),
Alt+F/E/V/S/B/T/H (Firefox menus), Alt+Left/Right (Back/Forward). Chart collisions avoided:
StockChart already owns Alt+U/I/G/Q/N/S/Comma and Alt+Shift+A/I/W, so none of those letters is used.
All new keys require Alt with Ctrl and Cmd forbidden, so AltGr (Ctrl+Alt on Windows) still types
Polish/German characters. They are declared in the shortcut registry, so the existing conflict
rail checks them against every other binding.

## 4. Recall a recent command

| Today | Expectation | Verdict | Status |
|---|---|---|---|
| ↑/↓ walk the last 50 typed lines (per browser, localStorage), and ↓ returns to the draft. | Shell-style history. | Good. | OK |
| ↑ ignores what you have typed: typing `AMD` then ↑ shows the newest line, not the newest line about AMD. | Prefix/substring history search (zsh/fish ↑, Bloomberg recall). | Slow for "the thing I ran on AMD this morning". | FIXED: if what you typed appears in earlier commands, ↑/↓ walk only those; if it appears in none, ↑ walks everything as before. |
| No way to see several past commands at once. | A recall list. | Missing. | FIXED: ↓ on an empty line opens the recent-commands list (newest first); typing two or more characters also shows up to two matching past commands under the suggestions (letters in order, so `nvgp` finds `NVDA GP W`). |
| Ctrl+R style search. | Bloomberg has none; shells do. | Ctrl+R is the browser's reload, so it is deliberately not used. | n/a |

## 5. Save and reopen a board

| Today | Expectation | Verdict | Status |
|---|---|---|---|
| Boards sheet: save as, open, share, delete, per-ticker preset, version history. `B:<slug>` opens a board from the command line; the echo says whether you have it. | Named workspaces, one-step switching. | Good. | OK |
| `B:` is **not autocompleted**: you must remember the slug. | Autocomplete names you own. | Slow. | FIXED: typing `B:` lists your boards (by slug or name), instantly, no network. |
| The Boards and Recents sheets are mouse-only. | Keyboard path. | Missing. | FIXED: Alt+O opens Boards, Alt+R opens Recents. |
| "Back to my layout" after opening a board. | MENU / back. | Good. | OK |

## 6. Recover a closed panel

| Today | Expectation | Verdict | Status |
|---|---|---|---|
| Closing says "Closed GP" with Undo; a bar button "Undo close" stays while the 10-deep closed stack has anything; phones get a short Undo in the switcher row. A re-open on a full board says which panel it parked. | Undo, with the stack visible. | Good. | OK |
| No keyboard undo. | Ctrl+Z-like. | Missing (Ctrl+Z would fight the text field's own undo). | FIXED: Alt+Z re-opens the last closed panel. |

## 7. Use it on a phone

| Today | Expectation | Verdict | Status |
|---|---|---|---|
| One panel at a time under a pinned command line (16 px input, no iOS zoom), a tab row to switch panels, Functions in a bottom sheet, Undo in the tab row, all controls on the 44 px floor. Hidden panels stay mounted. | Thumb-sized, nothing lost on switch. | Good. | OK |
| The panel tab row is `role="tablist"` but **arrow keys do nothing** and every tab is a Tab stop (ARIA tabs expect arrows + one Tab stop). Matters for iPad with a keyboard and for screen readers. | ARIA tabs pattern. | Inconsistent. | FIXED: ←/→/Home/End move between panel tabs, with one Tab stop (roving tabindex). |
| Tabs do not say which panel they control. | `aria-controls`. | Missing. | FIXED: each tab names its panel. |

## 8. Smaller things checked

| Item | Finding | Status |
|---|---|---|
| Layout jank while a panel loads | Every panel body renders the shared `PanelSkeleton` inside Suspense; the grid uses fixed `1fr` tracks and the panel header has a fixed min-height, so loading does not move neighbours. The command-line echo row has a reserved min-height. Not measured in a browser. | OK (unmeasured) |
| Focus after a notice action | Returns to the command line (audit #24). | OK |
| MENU (back) | Browser Back already replays the previous `?cmd=` into the panel it came from. | OK |
| Panel count | Buttons 1-4 on the bar (desktop) and switcher row (phone). No key. | FIXED on terminal/fn2-daily2: **Alt+Shift+1..4** sets the count (physical digit key, so it works whatever Shift does to the digit on your layout), says the new count, and the buttons carry the key in their tooltip. Alt+N without Shift still focuses panel N. |
| Reorder by mouse | Only the new keyboard move exists; no drag. | FIXED on terminal/fn2-daily2: each panel header has a move handle. Drag it onto another panel (mouse); tap or click it for a "Move to panel N" list (touch, where HTML5 drag never fires); or focus it and press left/right. One pure move (`boardModel.reorderPanel`), saved with the board. |
| "Open X" inside a list | MOST's catalyst "Open SYM MOVE" and an RRG row ran in the same panel and replaced the list. | FIXED on terminal/fn7-ux: they open beside the list (a new panel after it when the board has room, else the next panel; a second story reuses that panel), and the notice says where. A typed RRG row number does the same. IMOV rows and MOST rows already LOAD the name and keep every function. |
| IMOV theme by name | Only the picker could choose a theme, and the choice was lost on reload. | FIXED on terminal/fn7-ux: `IMOV semiconductors`, `IMOV "AI / GPU Chips"` (case/spacing-insensitive, unique prefix, a visible "did you mean" otherwise); a hand-picked theme is written into the panel's command (`IMOV THEME <KEY>`) so the URL, history and a reload keep it. |
| Unsupported window | `CORR … 5Y` said "Window 5Y is not available here"; REL and RRG had no such line. | FIXED on terminal/fn7-ux: REL and RRG show the same line; every window the command line accepts is railed as one the panel draws. |
| History is per browser | ↑ history and function recents live in localStorage, so a second device starts empty. Entity recents and boards already sync (board document). | FIXED on terminal/fn2-daily2 for ↑ history: server preference `terminal_command_history` (100 lines, newest first), written read-modify-write through `setPrefMerged`; localStorage stays as the fallback while the preference loads or cannot be read. Function recents are still per browser. |

## Shortcut list (after this branch)

Panel and board keys (work from the command line too; declared in `pages/command/shortcutRegistry.js`):

| Keys | Does |
|---|---|
| `` ` `` | Put focus in the command line (opens the terminal from elsewhere) |
| Ctrl/Cmd+K | Command palette |
| Alt+1 … Alt+4 | Focus panel 1-4 |
| Alt+[ / Alt+] | Previous / next panel (wraps) |
| Alt+Shift+1 … Alt+Shift+4 | Show 1-4 panels (terminal/fn2-daily2) |
| Alt+Shift+[ / Alt+Shift+] | Move the focused panel left / right |
| Alt+M | Maximise / restore the focused panel |
| Alt+X | Close the focused panel |
| Alt+Z | Re-open the last closed panel |
| Alt+C | Duplicate the focused panel |
| Alt+L | Link the focused panel to the next group (… then "not linked") |
| Alt+O | Open Boards |
| Alt+R | Open Recents |
| Alt+/ | Show the keyboard sheet |

Command-line keys (`COMMAND_LINE_KEYS` in `CommandLine.jsx`, printed by HELP):

| Keys | Does |
|---|---|
| Enter | Run the line (GO); on a highlighted suggestion, fill it in |
| Shift+Enter | On a bare ticker: load it into the linked panels and keep their functions |
| Tab | Accept the top (or highlighted) suggestion |
| ↑ / ↓ | Walk earlier commands; with text typed, only the ones that contain it |
| ↓ on an empty line | Show recent commands |
| Esc | Close the list, then clear the line |

## What is still left

1. ~~Per-member (cross-device) command history.~~ Done on terminal/fn2-daily2 (function recents are still per browser).
2. ~~Mouse drag to reorder panels.~~ Done on terminal/fn2-daily2 (drag, a Move list for touch, and arrows on the handle).
3. ~~A key for panel count.~~ Done on terminal/fn2-daily2 (Alt+Shift+1..4).
4. A real-browser pass (no browser was used here): confirm Alt+letter on macOS Safari/Chrome
   reaches the page with the command line focused, and confirm no visible jank on slow panels.

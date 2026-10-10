# The five terminal-grade properties, walked on `/terminal` (2026-10-10)

Closes ledger rows **X-11** and **V22** (the walk half; the throwing-panel rail was already built).

## What was asked

The 2026-09-24 "5/5 PASS" walk (`../2026-09-24-day7-walkthrough/`) ran the roadmap's integrator
checklist on `/dashboard`, `/charts`, `/research` and `/screener`, not on the UCT Terminal shell.
The checklist is `2026-09-23-one-week-execution-roadmap.md` §5, "What the integrator actually checks
per surface": one concrete action per property. This record runs the same five actions against the
real `TerminalShell`.

## How it was run

An automated suite, `app/src/pages/terminal/TerminalShell.fiveProperties.test.jsx`, renders the real
`TerminalShell` under its real `TerminalRoute` gate in jsdom. Real: the shell, the command line, the
board model, the Boards sheet, `PanelProvenance`, the per-panel `ErrorBoundary`, the shortcut
registry, the app-wide `CommandPalette` (owner of the backtick key) and the real `GradePanel`. Stood
in: preferences storage (an in-memory store that survives a "closed tab", as server preferences do),
the network answer of `/api/terminal/grade/:sym` (grade_ticker's shape), and every panel other than
GRADE (a stub that prints its function and security).

No Playwright run. A browser walk would need a built frontend served by a local sandbox from
`scripts/hub_sandbox_boot.py` plus a paid local account; that was not attempted in this lane, so
nothing in this record is a pixel, focus-ring or real-network claim.

```
bash uct-testlock.sh npx vitest run src/pages/terminal/TerminalShell.fiveProperties.test.jsx --maxWorkers=2
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

## Result: 5 of 5 hold on `/terminal`, at the jsdom layer

| # | property | the action (roadmap §5) | what the suite did and saw | proxy, stated |
|---|---|---|---|---|
| 1 | One context | Load a symbol on Surface A; open Surface B; B already shows it | Typed `NVDA` in the command line on a 3-panel board (GP and FA on group A, CN on group B). The focused panel became `Overview:NVDA`, its group-A neighbour showed `Financials:NVDA` with nothing re-typed, the group-B panel kept `QQQ`, and `charts_workspace_groups` (the preference `/charts` reads) became `{A: NVDA, B: QQQ}`. Reverse: a board opened with `charts_workspace_groups.A = QQQ` showed `QQQ` in both group-A panels on arrival. | `/charts` itself is not mounted; its side of the contract is the shared preference (`pages/charts/ChartsWorkspace.jsx` reads it), asserted in both directions. |
| 2 | Provenance | Click a computed number; the citation resolves to a real, specific source | GRADE (real `GradePanel`) on NVDA: the panel header shows `Source: Compass grade_ticker`; clicking its disclosure opens `Compass grade_ticker` with the observed instant `10:13:20 AM ET` (the server's `as_of`). The body lists the verdict's own sources. Control: a failed read claims no source. | The network answer is a fixture in grade_ticker's shape. Every other panel's adoption is the separate rail `panelProvenance.rail.test.js`. |
| 3 | Addressable | Save a view; close the tab; open it by name/link; same state, not a default | (a) Saved a 3-panel board as "Walk board" through the Boards sheet; closed the tab (unmount, session and local storage cleared); moved the working board to one panel on TSLA; opened `/terminal?cmd=B:walk-board`: 3 panels, `Chart:NVDA`, `Financials:NVDA`, GRADE on AMD, board named "Walk board". (b) The sheet's share link opened in a fresh session with NO saved preferences: the same 2-panel NVDA board. (c) A single panel's `?cmd=MSFT GRADE` reopened that panel after the tab was closed. | "Close the tab" is an unmount plus cleared browser storage; the saved preferences survive, as a real reload keeps them. |
| 4 | Keyboard-fast | Complete the primary action without the mouse | From an unfocused page: backtick (the palette's `terminal.focus` key) put focus in the command line; `NVDA GRADE` + Enter graded NVDA; Alt+2 moved focus to panel 2 from inside the command line; `AMD DES` + Enter put `Overview:AMD` there, panel 1 untouched. A capture listener counted click, mousedown, mouseup, pointerdown, pointerup and touchstart through the whole walk: **zero**. | jsdom dispatches the key events; no real keyboard or focus ring. |
| 5 | Resilient panels | Force one panel's data call to fail; the rest survives, the error only in that panel | A 4-panel board: GRADE NVDA (answers), GRADE AMD (its read answers 500), FA on a security whose panel THROWS in render, DES MSFT. Only panel 2 shows "Could not grade AMD just now." with Retry; panel 1 shows its NVDA verdict; panel 3 shows its own "FA hit an error" boundary; panel 4 renders; exactly one data error and one crash on the board. The command line still drove panel 4 (`TSLA`). Retry, once the source answered, recovered panel 2 in place. | The 500 is a fixture; the render throw is a stub. |

## Can it fail

Mutation, run 2026-10-10: removing the shell's `PanelProvenance` render (`TerminalShell.jsx`, the
`{freshness && <PanelProvenance …/>}` line) turns property 2 red (1 failed, 8 passed); restored
byte-for-byte from a copy taken first. Each other property carries a control in the file: the
pre-load symbol (1), the failed-read no-source case (2), the moved-on working board and the empty
preferences of the share-link session (3), the unfocused start (4), the healthy neighbours (5).

## Not measured here

Pixel layout, real focus rings, real network timing, and a real phone. The 2026-09-24 walk's
Playwright layer (boxes, screenshots) has no `/terminal` counterpart yet.

# r8-scanner-filter: scanner and filter operations through the widgets' own controls (family 2)

Local branch, not pushed. Base: ship-5 (stacked; ship-5 6ff0dc666d merged in). Evidence: LOCAL native Windows Node v24, jsdom,
BROWSER-MOCK-MODEL / SIMULATED (scripted model). Shared targeting core: not touched (`board.js`, `widgetNames.js`, widget doors).

## Rows (each a real MISSING row, checked against `listControl.outcome`, which already covers the Watchlist/Scanner list rows)

- **C3-140** apply one of the News (Trade Exchange) widget's own saved filter presets by name, as its Presets menu does
  (`presetPatch`), through `widget.setOption`; read back from its opts and the rows it shows; Undo restores the filters exactly.
  A preset that also SEARCHES is refused with the reason (the search box is widget state outside an exact Undo).
- **C3-108** a Scanner back to its picker, as its own back control does (`exitScan`); offered only while a scan is open.
- **C3-109** search the Scanner's preset list through its picker's own search box (a `text` door control on `ScannerPicker`),
  offered only while the picker shows; read back from the box and the scans it lists; Undo empties it.
- **C3-194** the Market Map's "Follow the linked list" toggle (an existing row), run over the REAL widget's own toggle.

## Mechanism

`board.js`: a control row may refuse a value with its reason (`valueWhy`) and read its value off the opts its write changes
(`value`). Byte-neutral (no manifest change); routing side effect 0 (rail).

## Held-out (`agentScanFilterHeldOut`, committed first: eed7873feb, then 84b6daac68 for C3-109)

- Outcome tests: all held-out phrasings pass over the real widgets (`teNewsWatchlist.outcome`, `widgetDoorRows.outcome`).
- First-call reach (pinned as measured): presets / back / follow 6/4/4 of 6 on both routings (the two C3-108 misses are the
  reach board's Scanner showing its picker, where "back" is rightly not offered); C3-109 0/2 on both routings ("the scan list",
  "the scanner picker" do not route the Scanner's controls on the first call; the reroute reaches them).

## Full suite

Full 4-shard vitest at 24dfbac979 (LOCAL native Windows Node v24, BROWSER-MOCK-MODEL / SIMULATED): 9321 passed, 0 failed, 6 skipped (2274+3 / 3180 / 2032+1 / 1835+2). pytest not run (C:\data rule): owed to AUDIT / CI.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

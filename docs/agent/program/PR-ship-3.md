# ship-3: the new widget doors

Local branch, not pushed. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted model). Built by cherry-picking ONLY this slice's commits from agent/pl/exec-gen-1 (doc commits left out); no Multi Chart family code (da498735c3 onward) and no 2c9457ea9b runtime read-back is carried. Left on exec-gen-1 because it needs Multi Chart: 5cad3da0e3 (the receipt note naming a left-out empty Multi Chart cell).

Base: ship-2 (stacked; needs ship-1's widget-control machinery). Shared targeting core: not touched (`board.js`, `widgetNames.js` and widget doors only).

## Behaviour changes AUDIT must review

- Scanner widget: criteria (door `about`) and capture. Company Info panel tab and collapse as Agent-side controls written by `normalizeDock` / `setFeatureOpen`, offered only while the chart has the panel.
- Notebook: open a note by name; create a note through the widget's own New control (an item-list `create` op, proposed first, read back by name; Undo of a create is refused honestly). `NotebookWidget.jsx` gains a door.
- Watchlist widget: the Flagged list, as its picker's Flagged row writes it (`source` control).
- ETF holdings: the chart door reads/writes the View Holdings button's own toggle (`ChartWidget.jsx`, `ViewHoldingsControl.jsx`), offered only while the button shows; refused with the reason on a plain stock. A control's `when` now sees the widget's door values.
- News (Trade Exchange): the watchlist filter over the real widget; a general `text` door control writes its own search box (door: `setQueryRaw`); empty clears it, at most 80 characters.
- Test only: a strict `earnings.date` oracle (the corpus fixture serves no earnings, so that corpus intent only ever passed on a not-found answer).

## AUDIT round 1 — carried from ship-1, and fixed here

- **S1-C / S1-A for the Notebook create:** a create is ONE operation through the widget's own New control (`{ op: 'create' }`,
  read back by a new note appearing); it offers no Undo (`undoPatch` null), so "undo" after a create never times out; the door
  ignores a list handed to it. Rail in `widgetDoorRows.outcome` ("AUDIT S1-C/S1-A").
- ship-1's S1-A/B/C fixes arrive here through the merge from ship-2.

## Full suite

Suite on 32f3b9613d (code head): 2240/2243, 3149, 2022/2023, 1839/1841 = 9250 passed, 0 failed, 6 skipped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

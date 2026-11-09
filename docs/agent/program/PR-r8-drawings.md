# r8-drawings: drawing management across charts (family 5)

Local branch, not pushed. Base: ship-5 6ff0dc666d (stacked). Evidence: LOCAL native Windows Node v24, jsdom,
BROWSER-MOCK-MODEL / SIMULATED (scripted model). Product code: one new capability (Drawing Boards, below); otherwise the capabilities exist (`drawing.setVisible`,
`drawing.lock`, `drawing.setAllVisible`); this branch proves them on the chart the words or the click mean, over the REAL drawings
store, with Undo.

## Rows evidenced

- C1-126 hide (and show) every drawing on a chart; C1-158 lock / unlock a drawing; C1-159 hide / show one drawing.
- (C1-116 "alert at a line's fixed level" is already evidenced on this base by `drawingFamily.outcome`: "a horizontal line is a
  line alert at its price"; its status-doc citation is owed on exec-gen-1.)

## Evidence

- Held-out (`agentDrawManageHeldOut`, 6, committed first in e7a8d2b60d): each on QUAD with a decoy line on another symbol —
  by the click ("this chart", "here", "this one"), by ticker ("the QQQ chart", "on TSLA"), by position ("the bottom left chart").
  6/6 (`drawManage.outcome`): the meant line's state reads back from the store; the decoy never changes; Undo restores the
  exact prior state.
- Negative: a plan on the decoy chart for "this chart" never lands there.

## Drawing Boards (C1-167 switch, C1-168 create, C1-169 rename, C1-170 delete): one NEW capability

The Lead allowed a new capability if the byte growth is small, stated, and its size is reviewed by AUDIT.

- `app/src/agent/capabilities/drawingBoards.js` (new, 7.7 KB source): ONE capability `drawingBoard.set` {op: switch | create |
  rename | delete, board, name} on a new account-level kind `drawingBoards`, written through the product's own board store
  (`drawingsStore` setActiveTracing / createTracing / renameTracing / deleteTracing), never a second store. A board is named by
  its name or "Board N", exact or a unique part; two that fit, a missing board, a taken name, or the last board are refused with
  the real names. switch / create / rename undo; delete is always shown first (Apply) and has no Undo (its drawings go).
- Registered in `builtins.js`; the drawings route group's domains gain `drawingBoard` (`routing.js`).
- Context: the `drawingBoards` entry goes into a request only when the member has more than the one default board, a named
  board, NLM-1 is on, or the message says "board(s)", so ordinary requests are byte-identical (the SAT-1 request fixture
  `section_b_requests.json` is unchanged).
- **Byte growth:** manifest golden 195,543 -> 196,639 bytes (+1,096 pretty-printed); the compact manifest the model is sent
  grows by **+803 bytes** (the new entry is 802 bytes). Route-group count pin 157 -> 158 (`agentRouting.test.jsx`).
- Capability regression: corpus intent `drawingBoard.switch` (DRAW board: a line on the default board, a new "Swing" board,
  then the switch -> the chart shows no drawings; Undo -> the line is back), 4 phrasings; contract and coverage re-pinned
  (`UPDATE_CAPREG=1`). The harness now resets the Drawing Boards per case (module-level store), as it already did drawings.
- NL-1 assemble parity fixture re-pinned (`tests/fixtures/nl1_assemble_parity.json`, +4/-1: the new capability). pytest that
  reads it is owed to AUDIT / CI.
- Held-out (`agentDrawingBoardsHeldOut`, committed first in d18d52de8f) through the real panel store: `agentDrawingBoards`
  6/6 (each non-delete op undoes exactly; delete is Apply-first with no Undo; NEGATIVE: missing / ambiguous / taken / last board
  refused, nothing changes).

## Full suite

(to be filled after the full 4-shard run)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

# r8-drawings: drawing management across charts (family 5)

Local branch, not pushed. Base: ship-5 6ff0dc666d (stacked). Evidence: LOCAL native Windows Node v24, jsdom,
BROWSER-MOCK-MODEL / SIMULATED (scripted model). No product code changes: the capabilities exist (`drawing.setVisible`,
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

## Full suite

(to be filled after the full 4-shard run)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

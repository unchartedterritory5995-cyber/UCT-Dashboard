# r8-multistep: multi-step execution (one plan, a receipt per step, honest partial failure, Undo of the whole)

Local branch, not pushed. Base: ship-5's code head 2f286340fe (stacked on the ship series). Evidence: LOCAL native Windows
Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED; these instant sequences make no model call. No Multi Chart family code.
Shared targeting core touched: `useAgent.js`, `compound.js`, `fastPath.js`, `capabilities/chart.js`: AUDIT full suite.

## Behaviour changes AUDIT must review

- **An unknown indicator inside a sequence.** "switch to NVDA, make it weekly, then add the zorkblat indicator": an indicator the
  library does not have (by id or by name) is now a step of its own in the plan. The steps before it run, each with its own
  receipt; the run stops there with "Done n of m steps, then stopped at … Not done: …". The same request on its own still goes
  to the model, which may know an indicator the member made.
- **Undo of a multi-step request takes back the whole sequence on BOTH routings** (it was routing v2 only). A request that stopped
  partway is one Undo too: "undo" takes back exactly the steps that ran.
- **Several kinds of change for one chart on a board of several** ("set this chart to QQQ and hourly, then add RSI"): the chart
  is resolved once, the way a one-kind command resolves it (the click for "this", the conversation's chart, a description), and
  each kind of change takes that chart's entry. Before, the request went to the model.
- **A ticker an instant op takes as its argument is not a chart the sentence names** ("set this chart to QQQ" with a QQQ chart
  on the board keeps its instant reading).
- **Words:** "set (this chart / it) to TICKER" sets the symbol; "take back everything you just did", "take back all of that",
  "undo the whole sequence / all those steps" undo the whole request.
- A layout save inside a sequence ("…, then save the layout") stays what it always is: a card that waits for Apply. The steps
  before it are done and said; the save is proposed.

- **pl-auto unseen8 (u8-sequences-02):** the ticker a step switches TO names no chart inside a sequence either: "switch to
  AAPL, weekly, hide the volume and draw a line at 120" with the left chart clicked and AAPL on the right chart acts on the left
  chart, no question. The screens (`screenUnnamedTargets`, the deictic screen) read the words without the ops' own ticker
  arguments (`withoutArgTickers`).
- **"every chart except that one":** an indicator added to every chart but the one set aside (the click for a negated
  pointer, or the charts named after "except") names its targets: no "Which charts should it go on?".

## Held-out (agentMultiStepHeldOut, committed first in 77a98ad782)

6/6 pass after the change; 2/6 passed before it (q1, u1). **Oracle note:** the held-out file expects `ind: ['ema']` for "add a
20 EMA". The chart stores an EMA as the catalog's `movingAverage` with its type as an input, so the test maps `ema` (and `sma`,
`ma`) to `movingAverage`. The frozen file is unchanged; the mapping is in `agentMultiStep.test.jsx`.

## Full suite

Suite on c5e251a211 (code head; this doc commit adds only this file): shards 2248/2251, 3191, 2026/2027, 1837/1839 =
9302 passed, 0 failed, 6 skipped. Golden manifest unchanged (195,543 bytes on disk).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

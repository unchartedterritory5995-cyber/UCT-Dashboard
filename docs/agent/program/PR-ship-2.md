# ship-2: per-clause targets, shared-change clauses, anchorless relations, Undo by kind, field-scoped Undo

Local branch, not pushed. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted model). Built by cherry-picking ONLY this slice's commits from agent/pl/exec-gen-1 (doc commits left out); no Multi Chart family code (da498735c3 onward) and no 2c9457ea9b runtime read-back is carried. Left on exec-gen-1 because it needs Multi Chart: 5cad3da0e3 (the receipt note naming a left-out empty Multi Chart cell).

Base: ship-1 (stacked). Shared targeting core touched: `deixis.js`, `useAgent.js`, `runtime.js`, `fastPath.js`, `capabilities/chart.js`: AUDIT full suite.
Why one slice: the per-clause guard, the round-3 flow refusal and the round-3 Undo follow-ups edit the same `useAgent.js` block, in that order.

## Behaviour changes AUDIT must review

- Per-clause targets: "make the NVDA chart weekly and this one log": each op runs only on its own clause's chart; anything uncertain asks. "the other" and a relation are read in their own clause.
- Shared-change clauses: "the TSLA chart to the hourly and this one too" gives the one stated change to both clause charts; each op goes to the clause whose chart it is on.
- Anchorless relation (decision 2026-11-07): "the chart above", "the one to its left" read from the click; never before "of", a number or a price; no click asks. A plan on the click itself is now asked, not run.
- Undo by kind: "undo the indicator" reaches back to the newest change of that kind. Field-scoped chart Undo restores only the fields that change touched, read against the EFFECTIVE settings (AUDIT D1).
- An indicator alert's level must lie in the indicator's declared range; a crossing at the range's end is refused.
- An Options Flow chip request with the widget on the board is refused about the widget's own chips (superseded by ship-4).
- Test infrastructure: the panel harness's ticker search behaves like the server (echo opt-in); the breadth timing rails measure the Agent's own send-to-output time.
- Tests only: board arrangement and chart P0s through the real panel; C2-092 / C3-107 / C3-150 held-out.

## AUDIT round 1 — fixed

- **S2-A (usability regression, no wrong chart):** an anchorless "the one below / above" fired even when "one" stood for a
  line, an alert or a level named just before it, so "make this chart weekly and delete the line and the one below", "make this
  one weekly, then move the alert to the one below" and "make it weekly, the level I drew and the one above are both support"
  asked "Which chart?". A bare **"one"** now stands for the nearest noun before it: a line, alert, level, drawing, indicator
  (catalog words), order, position… → no chart relation (the sentence acts on the click as before); a chart word or no noun →
  the relation stands. "chart / cell / pane / panel / graph" stay unconditional. Rails (`agentClauseShared`, "AUDIT S2-A"): the
  three feature sentences act on the click (they failed before the fix); "make the chart above weekly", "log scale on the one
  to the right" and "put a macd on the chart below" with no click still ask. The pre-existing "the ema and the one under it"
  case is left as logged.
- ship-1's S1-A/B/C/D fixes arrive through the merge.

## AUDIT round 2 — fixed (S2-B, a wrong-chart defect introduced by S2-A)

- **S2-B:** S2-A's antecedent scan took ANY indicator or placed-thing word earlier in the sentence, so "add RSI to the one below"
  (click TL) added RSI on the click instead of the chart below. Now a bare "one" stands for a thing ONLY when it is COORDINATED
  with that thing in the same noun phrase ("the line and the one below", "the level I drew and the one above"); after a
  preposition (to / on / onto / in / into / for / at / from / over) "the one <relation>" is the place, a chart; a word separated
  from "one" by a verb or a preposition is never its antecedent.
- Rails (`agentClauseShared`, "AUDIT S2-B"): probe 7's three phrasings — the plan on the neighbour lands; a plan on the click
  never lands (all failed on ba6a4ffbf1). "make this one weekly, then move the alert to the one below" now ASKS (an ambiguous
  move never acts on the click); it moved out of the S2-A acts-on-the-click rail. The S2-A coordination cases still act on the click.

## S2-B generalised (owner priority 2026-11-08)

- The coordination rule now covers the ANCHORED relation too ("delete the alert and the one above it": the "one" is the alert's
  kind, no chart relation; the sentence acts on the click).
- **Held-out set** (`agentRelationHeldOut`, 24 cases, committed first in 8ed64f31c4, never tuned on; AUDIT's probe-7 three
  included): TWO / THREE / FOUR / SIX boards, with and without a click, below / above / left / right / next to / beside / under,
  positions, after a preposition vs coordinated with a non-chart noun. Before this commit 42/44 checks passed; after it 44/44
  (`agentRelation`): the chart meant lands, a plan on the click never lands, the ask cases land nowhere, the coordination cases
  act on the click. **One changed expectation:** t3 ("log scale on the chart to the left", TWO, no click) was frozen as 'ask';
  with no click "left" is a position that fits one chart, so it acts on the left chart — never a click. Graded so, reported here.
- **The live production bug** ("make the chart above weekly" changed the clicked chart on master): a rail shows a plan on the
  click does not land and the plan on the chart above does.

## Full suite

Suite on 679b8b2d14 (code head): 2256/2259, 3119, 2002/2003, 1823/1825 = 9200 passed, 0 failed, 6 skipped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

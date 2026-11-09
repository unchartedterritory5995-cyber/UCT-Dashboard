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

## Full suite

Suite on 679b8b2d14 (code head): 2256/2259, 3119, 2002/2003, 1823/1825 = 9200 passed, 0 failed, 6 skipped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

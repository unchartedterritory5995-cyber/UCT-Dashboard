# ship-5: conversational targeting (owner decision 2026-11-07, with the Program Lead's clarification)

Local branch, not pushed. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted model). Built by cherry-picking ONLY this slice's commits from agent/pl/exec-gen-1 (doc commits left out); no Multi Chart family code (da498735c3 onward) and no 2c9457ea9b runtime read-back is carried. Left on exec-gen-1 because it needs Multi Chart: 5cad3da0e3 (the receipt note naming a left-out empty Multi Chart cell).

Base: ship-4 (stacked; needs ship-2's clause readers). Shared targeting core touched: `useAgent.js`, `deixis.js`, `host.js`, `memory.js`, `ChartsWorkspace.jsx` (a click token): AUDIT full suite.

## Behaviour changes AUDIT must review

- After a change on ONE chart, or a request naming one chart, that chart reads as the click for the next request while no new click has happened (fast path, the model's context `selected`, deixis, the relative / negation / per-clause rules).
- A fresh click redirects, a re-click included: the workspace exposes a click token per pointer-down, and a change is stamped with the click as it stood when the request was sent.
- "this" / "this one" / "here" is the click, an old click too. A request naming another chart redirects, unless it also says "it" / "that one". After a change on several charts a bare follow-up asks. A request that created a widget ends the target.
- One instant op for a sentence whose clauses name two charts goes to the model.
- Held-out h7 was frozen as 'ask' before the clarification; it is graded on the clarified rule (see PR-exec-gen-1.md on exec-gen-1).

## Full suite

Suite on 2f286340fe (code head): 2236/2239, 3191, 2026/2027, 1836/1838 = 9289 passed, 0 failed, 6 skipped. AUDIT probes 1-3 run inside it (untracked files in the worktree).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

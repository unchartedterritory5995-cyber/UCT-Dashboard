# ship-4: Options Flow, every filter (owner decision 2026-11-07)

Local branch, not pushed. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted model). Built by cherry-picking ONLY this slice's commits from agent/pl/exec-gen-1 (doc commits left out); no Multi Chart family code (da498735c3 onward) and no 2c9457ea9b runtime read-back is carried. Left on exec-gen-1 because it needs Multi Chart: 5cad3da0e3 (the receipt note naming a left-out empty Multi Chart cell).

Base: ship-3 (stacked). Shared targeting core touched: `useAgent.js` (one fast-path branch): AUDIT full suite.

## Behaviour changes AUDIT must review

- `CONTROL_LABELS`: the registry's Options Flow rows (minimum premium, calls / puts, print type, direction, view, scope) read and write in the chips' own words; values unchanged. Receipts: "calls / puts is now Puts (was All)".
- The round-3 Calls-Only refusal is replaced by a reroute: an instant flow-screen reading with the widget on the board goes to the model, which plans `widget.setOption`. With no Options Flow widget the F-16 screen refusal is unchanged.
- Server F-16 text check (`turn.py`, `refusal_for_text`) runs only when `screener.run` is routed; the flow-chip requests route without it on both routings (tested). No server change.
- Rails: readOptions and receipts use the chips' words; reach pin widget held-out 24/21/21 of 24.

## Full suite

Suite on ca9e7e1644 (code head): 2257/2260, 3149, 2022/2023, 1839/1841 = 9267 passed, 0 failed, 6 skipped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

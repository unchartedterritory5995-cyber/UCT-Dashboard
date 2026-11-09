# ship-4: Options Flow, every filter (owner decision 2026-11-07)

Local branch, not pushed. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted model). Built by cherry-picking ONLY this slice's commits from agent/pl/exec-gen-1 (doc commits left out); no Multi Chart family code (da498735c3 onward) and no 2c9457ea9b runtime read-back is carried. Left on exec-gen-1 because it needs Multi Chart: 5cad3da0e3 (the receipt note naming a left-out empty Multi Chart cell).

Base: ship-3 (stacked). Shared targeting core touched: `useAgent.js` (one fast-path branch): AUDIT full suite.

## Behaviour changes AUDIT must review

- `CONTROL_LABELS`: the registry's Options Flow rows (minimum premium, calls / puts, print type, direction, view, scope) read and write in the chips' own words; values unchanged. Receipts: "calls / puts is now Puts (was All)".
- The round-3 Calls-Only refusal is replaced by a reroute: an instant flow-screen reading with the widget on the board goes to the model, which plans `widget.setOption`. With no Options Flow widget the F-16 screen refusal is unchanged.
- Server F-16 text check (`turn.py`, `refusal_for_text`) runs only when `screener.run` is routed; the flow-chip requests route without it on both routings (tested). No server change.
- Rails: readOptions and receipts use the chips' words; reach pin widget held-out 24/21/21 of 24.

## AUDIT round 1 (CHANGES REQUIRED) — fixed

- **S4-A (server):** `api/services/uct_agent/turn.py` (the F-16 text gate, ~2617) no longer discards a plan made ONLY of
  `widget.setOption` ops on the strength of screen-shaped words: "filter the options flow to sweeps" (routed
  [boardEdit, screener, agent] with an Options Flow widget on the board) keeps its widget plan. A plan with any screener op, or
  with no ops, is gated exactly as before.
- **pytest owed to AUDIT / CI:** `tests/test_uct_agent_flow_widget_gate.py` pins the case (the words trip both checks; the
  widget plan is kept), a hidden-field screen still refused, and a mixed plan with a screener op still refused. It was NOT run
  on this PC (no backend, no pytest under pl-exec's rules).
- ship-1's S1 fixes and ship-3's Notebook fix arrive through the merge from ship-3.

## AUDIT round 2 — hardening

- `widget_only` in `turn.py` is narrowed to plans whose every `widget.setOption` targets an **Options Flow** widget on the board
  the request was sent with (`_flow_widget_ids(context)`): its chips carry no hidden field. A setOption on any other widget (one
  that can be backed by a hidden screener field, e.g. a Scanner) is gated exactly as before.
- pytest extended (owed to AUDIT / CI, not run here): a setOption on a Scanner with the same words is still refused;
  `_flow_widget_ids` reads only Options Flow widgets.
- ship-2's S2-B arrives through the merge.

## Full suite

Suite on ca9e7e1644 (code head): 2257/2260, 3149, 2022/2023, 1839/1841 = 9267 passed, 0 failed, 6 skipped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

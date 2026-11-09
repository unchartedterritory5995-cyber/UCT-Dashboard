# AUDIT review packet: r8-drawings (Drawing Boards, one new capability)

Branch `agent/pl/r8-drawings` (local, not pushed). The new capability is in 6651348a47; the suite fixes are in 51ab832149. Evidence:
LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted model). The Lead approved a new capability on three conditions:
the byte growth is small, it is stated, and AUDIT reviews it. This packet covers those three points.

## 1. Manifest growth: +1,243 bytes (was +803 before AUDIT (a))

- New: ONE capability, `drawingBoard.set` {op: switch | create | rename | delete, board, name}, on the kind `drawingBoards`.
  The four board actions share one entry; four separate entries would have grown the manifest about four times as much.
- Compact manifest (what the model is sent): **+1,243 bytes** (154,341 to 155,584). As first built it was +803 (one 802-byte entry).
  AUDIT (a) split delete into its own guarded action (48e0eabce1): `drawingBoard.set` is now 732 bytes and
  `drawingBoard.delete` 509, plus the joining commas.
- `contract/manifest.golden.json` (pretty-printed): 195,543 to 196,639 bytes (+1,096).
- The model sees this entry only when the drawings route group is selected. The group's domains gain `drawingBoard` in
  `routing.js`. A request routed elsewhere does not carry it.
- What to check: is the summary/hints text (about 400 of drawingBoard.set's 732 bytes) as short as it can be? Is one op-enum capability the
  right shape, compared with a separate entry per op?

## 2. Context gating: ordinary requests are byte-identical

- The context provider `drawingBoards` sends `{ref, active, boards: [names]}`. That is 52 bytes for the default single board
  and 59 bytes for two named boards.
- It is sent ONLY when at least one of these holds:
  - the member has more than one board;
  - a board has its own name (not the panel's "Board N");
  - NLM-1 is on (selection is never gated on words);
  - the message says "board" or "boards" (`/\bboards?\b/i`).
- Proof: the SAT-1 request fixture (`api/services/uct_agent/scan/sat/section_b_requests.json`) was regenerated after the gating
  and is unchanged. Before the gating, every request gained the entry and context refs shifted (d2 to d3), about 300 lines of
  diff. That version was never committed.
- What to check:
  - "board" also means the chart workspace, so a workspace request mentioning "board" adds 52 bytes. That was accepted as small.
  - A member with only the default board who says "make a new drawing sheet" without the word "board" gets no target unless
    NLM-1 is on. The held-out phrasings all say "board".

## 3. Re-pinned counts and fixtures (every one moves only by the new capability)

| Pin | File | Before | After |
|---|---|---|---|
| route-group capability count | `agentRouting.test.jsx` | 157 | 158 |
| Charts manifest length | `agentScreener.test.jsx` | 151 | 152 |
| compact manifest golden | `contract/manifest.golden.json` | 195,543 B | 196,639 B (+48 lines, one entry) |
| capability-regression contract | `qa/capabilityRegression/coverage/contract.json` | (prior) | +1 capability (+13 lines) |
| capability-regression coverage | `coverage/coverage.json`, `COVERAGE.md` | (prior) | + `drawingBoard.set` covered by corpus intent `drawingBoard.switch` |
| corpus | `baseline/corpus.json` | (prior) | +1 intent `drawingBoard.switch` (4 phrasings and Undo); one compact line kept byte-identical |
| NL-1 assemble parity | `tests/fixtures/nl1_assemble_parity.json` | (prior) | +4 / -1 (the new capability). **The pytest that reads it is owed to AUDIT / CI** (not run here: C:\data rule) |
| discovery topic rail | `discovery.js` "Drawing tools" | (prior) | + `drawingBoard.set`; canDo extended; "switching Drawing Boards" removed from the not-yet list |

There is also one test-harness change, outside any product path. The capreg harness (`testing/harness.jsx`) resets the module-level
Drawing Boards per DRAW case, just as it already cleared drawings. Without the reset, a second case would see two "Swing" boards.

## Safety

- Writes go only through the product's own store (`drawingsStore` setActiveTracing / createTracing / renameTracing /
  deleteTracing). There is no second store.
- Delete is risk `confirmIf`: it is always shown first, and nothing is deleted before Apply. It has no Undo, which the
  receipt says. The last board is refused.
- Switch, create and rename each undo exactly (agentDrawingBoards 6/6).
- A missing board, an ambiguous part of a name, or a taken name is refused with the real names, and nothing changes.
- Model calls: 0 new paid paths (the capability is a planner op like any other).

## Suites

- Targeted, after the gating: capability-regression folder 3556/3556; related suites 3683/3683.
- Full 4-shard run at 6651348a47: 2 failures (the discovery rail and the manifest count pin), both fixed in 51ab832149.
  The full rerun at 51ab832149 is owed after the release runs.

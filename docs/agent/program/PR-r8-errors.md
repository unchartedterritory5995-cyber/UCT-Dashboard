# r8-errors: actionable errors — answers to the Agent's own choice question (family 4, unseen8 class 2)

Local branch, not pushed. Base: ship-5 6ff0dc666d (stacked). Evidence: LOCAL native Windows Node v24, jsdom,
BROWSER-MOCK-MODEL / SIMULATED; no model call is made (the question is UCT's own). Shared targeting core touched: `deixis.js`,
`useAgent.js` — AUDIT full suite.

## Behaviour changes AUDIT must review

- **An answer to UCT's own local choice question is read against the OPTIONS IT OFFERED, never the board** (`pickOffered`):
  - a number / ordinal / "option N" / "the last one" is that place in the offered list;
  - the words of one option's label (a position: "top right", "the bottom one"; a ticker: "the TSLA one") pick that option;
  - two options that fit are asked again with just those two ("Two of those fit: A or B. Which one?");
  - anything else is not an answer to the list (the request is read as before; the question's own set-aside rule applies).
  One option fits → exactly what clicking it does (`chooseTarget`).
- The model-question path's `pickedChoice` reads the same way (it now delegates to `pickOffered`).

## Evidence

- Tuning (pl-auto's own): "2" picks the second offered chart; "the bottom one" asks between Bottom-left / Bottom-right, then
  "the left one" picks Bottom-left. 0 model calls.
- Held-out (`agentChoiceAnswerHeldOut`, 8 answers): written after the mechanism but before any test of it ran; never tuned.
  8/8 pass (`agentChoiceAnswer`).
- Negative: a new request while the question is open is not taken for a pick; `pickOffered` refuses out-of-range numbers and
  words no option has.
- Not in this branch: unseen8 class 3 (the saved screen, waiting on pl-auto's fixture check).

## Full suite

(to be filled after the full 4-shard run)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

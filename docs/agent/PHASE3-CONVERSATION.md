# UCT Agent Phase 3: conversational intelligence (Workstream 1)

This workstream makes the Agent understand more of what members actually type, without new phrase lists. Each fix
generalises a rule that already existed. Each was measured first: a baseline probe ran the owner's example requests
through the real panel with a stand-in model and recorded whether the request stayed local, what it changed on the
board, and what was said.

The Agent is still admin-only, and NL-1 is still OFF. No server allow-list, approval rule, action limit, cost control,
receipt or Undo rule was changed.

## What now reads locally (no model call)

| Request | Before | Now | Where |
|---|---|---|---|
| "make the 9 green" → "make the other one yellow" | asked "Which one?" | colours EMA 20 | `conversation.js` `resolveReferent` |
| "fast one green slow one yellow", "the 9 green, the 20 yellow" | model | colours both | `conversation.js` `verblessPairs` |
| "open daily charts for aapl msft nvda" → "make them weekly" | model | the three new charts, one change | `references.js` `pluralTarget` |
| "switch em to weekly" with nothing to point at | model | asks which charts; nothing changes | `references.js` `pluralTarget` |
| "change the bottom right to amd", "change the first chart to msft" | model | that one chart | `capabilities/chart.js` `chart.setSymbol` phrase |
| "actually, change the second chart instead", "no, the bottom right one", "I meant the NVDA chart" | model | the last change is undone, then made on the chart now named | `references.js` `retargetCorrection` |
| "undo just the color change", "undo the timeframe change" | model | the newest change, only when it IS that change | `fastPath.js` control words, `useAgent.js` `undoMatches` |
| "slap the 9/20 on all four" | model | EMA 9 and EMA 20 on each chart | `fastPath.js` `slashPairs` |
| "put rsi underneath" | model | RSI below price | `compound.js` `NEW_PANE` |
| "keep the NVDA chart but replace the others with aapl msft and amzn" | model | the others, in reading order, as one change | `multiChart.js` `keepOthers` |
| "make everything look like my NVDA chart", "make the others look like the NVDA chart" | model | **proposed** look copy onto the other charts (owner rule: copyLook is proposed) | `conversation.js` `copyLookPlan` |

Already local before this work, and unchanged:
- "make them all hourly"
- "put those indicators on the rest of my charts"
- the four-chart compound request ("Build me four charts for NVDA, AMD, AVGO and MU, make them daily, put the 9 and 20 EMA on each, make the fast one green and the slow one yellow, and put RSI below price")
- "make the RSI pane taller"
- "make the right chart look like the one next to it"

## The rules behind them

**"The other one".** A turn that acted on SOME of the indicators the conversation holds picks them. A turn that acted on
all of them picks none.
- "Add the 9 and 20" then "make the other one yellow" still asks.
- When the latest turn's set holds one indicator and the turn before added it plus exactly one more, "the other one" is
  that one.
- Memory keeps the previous turn's indicator set (`memory.priorIndicatorSet`) for this.

**"Them" as a target.** "Them" means the charts the last turn changed. A board change that named its charts by ticker
(`chartGrid.set`, `widget.addCharts`) counts as the charts now showing those tickers. Otherwise:
- With nothing to point at, the Agent asks. It never picks every chart by guess.
- For indicator actions ("hide them"), the indicator rules apply, as before.

**Lowercase tickers.**
- A chart's ticker after "change … to" may be typed in lowercase, under the shared N4 rule (`plainSymbolWord`):
  - not a word UCT knows, or a typo of one;
  - not a pronoun.
- So "change to weekly" stays a timeframe and "change to candles" stays a chart type.
- The ticker search still refuses an unknown symbol.

**Corrections move the last change.** This applies only when the words say nothing but the correction and ONE chart.
- **Gates:** the Agent's last change must be the newest Undo entry, plain, reversible, and on one chart. It must also
  name no indicator instance: "actually the 20 instead" is not a move.
- **Undo first:** the existing Undo runs before anything else. It refuses when the change is protected, on another
  board or changed since, and then nothing moves.
- **Then the same ops:** they run on the new chart through the normal planner, policy and receipts.
- **Not a move:** "Actually make the bottom left daily too" adds something to the last change, so it is read as a new
  instruction.

**Undo stays newest-first.** A described undo ("just the colour change") never reaches past the newest change to an
older one. If the newest change isn't the described one, nothing is undone and the member is told what it was. This is
the existing F14 rule, extended from kinds (indicator, chart…) to descriptions (colour, timeframe, symbol, pane,
style…), checked against the receipt.

**"9/20".** A slash is read as two lengths only in a sentence that starts with an add verb, so "go to 10/29" is never
split.

**One-step plans** no longer end with "All 1 steps done."

## Model fallback: failure sentences (server)

The model's unreadable reply is still refused before anything reaches the browser, and validation is unchanged. The
member now hears what went wrong, always with "nothing was changed":

| Reason (server log) | Member hears |
|---|---|
| `json` + `stop_reason=max_tokens` | the plan was longer than can be written in one go; try two or three smaller requests |
| `args_json`, `args_schema` | a step's details couldn't be filled in; name the values directly |
| `json` (not cut off) | the plan came back incomplete; try again or say it more simply |
| `disposition`, `empty_answer` | "UCT Agent returned something unreadable, so nothing was changed." |

The sentences are fixed: they never include the model's text, an action name or an argument. `TurnError.reason` carries
the code for telemetry. The server log line `uct_agent unreadable: <reason> <shape>` is unchanged.

**Not done: a bounded repair retry** of an unreadable reply outside NL-1. That would add a paid model call per failure,
and its benefit can only be measured with paid evaluation runs, which need owner authorisation. NL-1's existing
one-repair path is unchanged.

## Tests

- `app/src/agent/agentConversationP3.test.jsx`: 23 multi-turn tests through the real panel. They assert symbols,
  timeframes and indicator colours on the board, Undo, and that no request needed the model.
- `tests/test_uct_agent_failure_sentences.py`: the failure sentences, the log shape, and that no internal name reaches
  the member.
- `tests/test_uct_agent.py` and `tests/test_uct_agent_nl1_selection.py` now expect the more specific sentence for a
  step whose details don't fit.

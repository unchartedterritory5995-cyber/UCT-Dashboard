# Gate C — completion report (2026-10-13)

Branch `feat/agent-conv-gate-c` (C:/w/aconvc), on top of Gate B. **Local only.** No push, merge, deploy or paid inference.

**Release boundary:** Gate C is NOT in the Gate B release candidate (`release/agent-gate-b`). The only Gate B commits here are cherry-picked so Gate C builds on them; the Gate B release contains no Gate C file.

## Commits (Gate C's own)
| Commit | What |
|---|---|
| `1b3b01a36d` | Session memory + references: "open the third one", "compare it to the others", "do the same on the right one", "it" = the chart this chat changed; the model sees `conversation_memory` |
| `7f57484d29` | `setInputs` in Indicators' `agentMutations.js`. Drafted by Agent, **reviewed and APPROVED by INDICATORS** (their integration proof on A1.2: 108/108). The commit title still reads "DRAFT", from before approval. |
| `099339f07e` | `indicator.update`: edit in place; owner MA defaults; sturdier routing fallback, with no extra network hop |
| `90349c652e` | Corrections into memory; model-path memory test; no-op wording; transcripts; layer-A results |
| (+ this report, the comparison and VOCABULARY-VERIFICATION.md) | |

## What it does
1. **Structured session memory** (`agent/memory.js`, written only by UCT):
   - result sets, as tickers in the order shown (never re-run);
   - the last committed change;
   - the subject chart;
   - the subject indicator (taken from Indicators' confirmed receipt);
   - recent corrections.
   Retention: 30 min TTL; chart subjects and the last change are dropped on a layout switch; everything is cleared per chat (new chat, chat switch, reload).
2. **References** (`agent/references.js`):
   - ordinals ("#3", "the third one", "the last one");
   - "compare it to the others / to the top N" (≤ 10 overlays, else it asks);
   - "do the same on the right one" (repeats only local, reversible changes);
   - "it" fills a missing chart target from memory, but never overrides a click, position or name.
3. **Validation before every mutation:**
   - Each reference is re-checked against the live board: the set is fresh, the index exists, the chart is still on this layout, the indicator is still on that chart.
   - Failure is a plain sentence, or it goes to the model path, which sees the same memory and asks.
   - The ops are the same registry ops as any request, so they get the same planner, policy, runtime and Undo.
4. **Editing an indicator in place:**
   - "make it a 9", "change that to an SMA", "change the 20 to a 50", "make the rsi 7".
   - Same instance, through Indicators' writers, with fingerprint-guarded exact Undo.
   - Becomes a proposal when other indicators read the edited one.
   - Two matches → it asks. Already set → "Nothing to change". Removed by hand → said, nothing re-created.
5. **Reusing the current chart:** "open the third one" switches the chart in front of the member. With several charts and no subject it asks which one, and adds no new widget.
6. **Owner MA defaults (provisional):**
   - a bare length is EMA for 8/9/10/20/21 and SMA for 50+;
   - any other length is not guessed (the model asks);
   - explicit words win, and an edit keeps the indicator's own type;
   - receipts name the type used ("period 20, type EMA").

## Gate B vs Gate C — the same nine conversations, identical fixtures and criteria
**Method:** a disposable export of each build, outside both worktrees; the real panel; no model (`/turn` answers 503). Harness: `gateC-compare-harness.test.jsx.txt`; raw rows: `gateC-compare-gateB.json` / `gateC-compare-gateC.json`.

| | Gate B | Gate C |
|---|---|---|
| Conversations fully completed | 0 / 9 | **9 / 9** |
| Steps completed | 12 / 35 | **35 / 35** |
| Context-reference steps | 0 / 8 | **8 / 8** |
| In-place indicator edits | 0 / 5 | **5 / 5** |
| Stale-context steps handled correctly | 1 / 4 | **4 / 4** |
| Steps needing a model call | 18 | **3** (all intended: an unlisted MA length, a correction, a reference after "new chat") |
| Wrong actions (unprompted) | 0 | **0** |
| Undo results flagged by the harness | 2* | 0 |
| Unnecessary clarifications | 1 ("make it weekly" with no context → "Which chart?") | **0** |
| Steps that could not run | 1 (no "Which chart?" to click) | 0 |

\* Gate B's two flagged Undo steps (C3.3, C5.4) are **knock-on effects, not wrong actions**: the step before failed, so Undo correctly took back that build's own last change. Neither build made a change the member didn't ask for.

**Latency.**
- **Local steps:** about the same (jsdom: p50 93 ms vs 67 ms; not a production measure).
- **Model calls avoided:** 15 per 35 steps. At production's measured model p50 of 2.9 s and $0.007–0.014 per call, that is about **44 s of waiting and about $0.10–0.21 saved** across these conversations. The no-model run here cannot measure that directly.
- **Latency benchmark** (`agentLatency.test.jsx`): within budget after the fix. Fallback groups are no longer re-read before the turn.

## Single-turn evaluation (layer A; WRONG must stay 0)
| Set | Gate B after | Gate C |
|---|---|---|
| Familiar (dev) | 71/95 fast · WRONG 0 · MISS 6 | 73/96 fast · WRONG 0 · MISS 7 |
| Held-out v1 | 18/39 · 0 · 10 | 18/39 · 0 · 12 |
| Adversarial v1 | 1/8 · 0 · 7 | 1/8 · 0 · 6 |
| **Held-out v2** (clean) | 24/58 · 0 · 17 | **25/58 · 0 · 10** |
| **Adversarial v2** | 0/3 · 0 · 11 | 0/3 · 0 · 11 |

Layer A is single-turn, so it cannot show the reference gains above. "ind-09 change the rsi to 7" moved from unsupported to supported, as planned at Gate A.

## Tests
- **Frontend:** `src/agent` + Indicators' mutation suites + census: **1,302 passed**. Gate C specific:
  - `agentGateCConversations.test.jsx` (5 conversations, including the model-path memory and correction);
  - `agentGateCIndicators.test.jsx` (4 conversations);
  - `agentMemory.test.js` (20 unit tests);
  - `agentMutations.inputs.test.js` (+13 `setInputs` tests).
- **Backend:** Agent + Perplexity: **607 passed**. The golden manifest is regenerated (91 actions); the server contract test is green.
- **Stale context:**
  - expiry and layout invalidation (unit);
  - "nothing to repeat"; new chat forgets results;
  - indicator removed by hand;
  - out-of-range ordinal;
  - two ambiguous "21"s.
- **Undo:**
  - compare → undo (only the comparison);
  - do-the-same → undo (only the right chart);
  - edit → undo → undo (exactly back, same instance id);
  - byte-exact after the persisted read;
  - stale fingerprint → refused.

## Cross-session review
- **INDICATORS:**
  - approved A1.0 (their refactor; I reviewed it);
  - approved `setInputs` with writer-routing rules, which I followed;
  - confirmed: Agent writes stay only on Agent's Undo; a member's later hide or show makes a pending Agent Undo refuse (agreed).
- **Shared files I touched:** `agentMutations.js`, `agentMutations.inputs.test.js`, `controlDoorCensus.test.js` (count 4 → 5, with its reason row). StockChart, ChartsWorkspace, ChartSettingsModal and agentSeams were not touched.

## Transcripts
`gateC-transcripts/` holds 8 conversations exactly as the member sees them. Examples:
- "open the third one" → "Changed symbol to AMD";
- "make it a 9" → "Changed EMA 9 on Chart (QQQ) — period 20 → 9";
- the two-"21"s question.

## Section A vocabulary
Verification done: VOCABULARY-VERIFICATION.md. **Nothing new enabled**: seven owner questions are open, chiefly that RS Rank is 0% populated in the local data copy, and the EMA20/SMA20 and intraday/close definitions. Section B stays off.

## Remaining limitations
1. **Memory is per chat, in the browser.** A reload forgets it, by design.
2. **"Compare it to the others" overlays at most 10;** larger sets ask for a smaller number.
3. **"Do the same" repeats only local, reversible single-kind changes;** anything else goes to the model.
4. **References need a fresh result set** (30 min). An expired set → the model path.
5. **The ambiguity question for two matching indicators shows internal ids** ("EMA 21 (inst:movingAverage:1)"). That wording predates Gate C (the interface's AMBIGUOUS sentence) and is worth a polish pass.
6. **No paid evaluation was run.** Model-path understanding of `conversation_memory` is untested with the real model; the prompt and the request body are tested.
7. **Routing:** two sets lost one or two routing hits against Gate B (dev 6→7, held-out v1 10→12), while clean v2 improved 17→10. The trade-off is from the sturdier fallback.

# UCT Agent — Phase 1: Intelligence, Autonomy & Execution

Branch `feat/agent-intelligence-p1` (worktree `C:\w\agent-p1`), from master `d4e5200ace`.
Evolution of the existing Agent: no second framework, no new orchestration engine.

## Gate A — architecture map (as found)

```
member text
  └─ useAgent.send
       ├─ fastPath.fastParse (regex control words + capability `fast` phrases)  ── 0 model calls
       │     └─ execute(ops)
       └─ model path
            refreshContext → buildContext (context providers, short refs)
            routeManifest (routing.js: action GROUPS by keyword; others named)
            POST /api/agent/turn ── turn.run_turn: 1 model call (Haiku 4.5, structured output)
                 + 1 if need_groups (reroute)  + 1 if research  + 1 if schema refused (compact retry)
            envelope: answer | clarify | unsupported → shown, nothing runs
                      apply | propose → bindSourceRefs → screenModelOps → execute
  execute → executeInner
       expandOps (macros) → compose (typed producers → consumers; producers run at APPLY)
       queries answered (read-only capabilities)
       planOps (validate ALL ops; aliases from `creates` become virtual targets)
       protectionRefusal → decideMode (policy.js: confirm / irreversible / >1 resource / >1 target → propose)
       commitPlan (runtime.js: real targets → created targets re-planned on the real ref → ACK read-back
                   → compensation newest-first on failure → Undo entry)
       persistBoard (server ACK) → receipt (+ Undo) → record (conversation memory = receipts)
       followUps (separate executions, own receipt + Undo)
```

Strengths reused: the capability registry and manifest, typed composition (`as` / `{from, top}`),
virtual targets for create-then-configure, compensation, read-back ACK, receipts, typed Undo,
protected layouts, cross-session board guard, follow-up executions, routing.

## Gate A — root causes

### Software watchlist ("all software stocks over $10, > $10M daily dollar volume, open it")

| Symptom | Root cause | Kind |
|---|---|---|
| "Which software stocks?" | `screener.js` drops every list-valued field (sector, industry, exchange, theme): the model had no way to express "software" | tool schema inadequate |
| Daily dollar volume | the Screener holds only `dollar_vol_30d` (30-day average); no latest-session dollar volume exists anywhere the Agent can read | backend data not exposed |
| "How many stocks? (up to 50)" | `watchlist.add` refuses `{from, top: null}` with "Say how many… (up to 50)". The 50 is Agent-only (the watchlist server has no size cap; bulk add is chunked) | artificial limit + forced clarification |
| Results stop at 100 | `PRODUCE_MAX = 100` (screen → symbols) and compose `MAX_TOP = 100`; one page only | silent truncation risk |
| "Couldn't find the watchlist" / open fails | no action opens a list on the board in the same request: `widget.showList` needs an existing widget AND a real list id (an alias of a list created in the same request is "not one of your watchlists"), and the planner refuses creating + changing an existing target in one request | missing workspace action + orchestration gap |
| Partial failure | a failure after `watchlist.create` compensates by DELETING the new list ("nothing was left changed") — the brief wants the list kept when only the open step fails | error handling |

### Unnecessary clarification

- `TARGETING` in the system prompt: "If several exist and the member did not identify one … use clarify. Never guess." — correct for edits, too strict for opening/showing (where the product's own door picks the first Watchlist widget).
- No "act on established defaults" rule: the prompt never tells the model that a default indicator/timeframe/count is acceptable; "clarify" is described only as "you need one thing first".
- Capability checks that turn a missing-but-defaultable value into a question (`watchlist.add` top=null).
- `sanitize_envelope` turns any op naming an unknown target into "Which one do you mean?" with no choices.

### Latency (structural; real-model timing needs an authorized paid run)

- 1 model call per model-path turn; +1 on a routing miss (`need_groups`), +1 for research, +1 for a schema refusal.
- Fast path (0 model calls) covers only exact phrasings; common short commands with a symbol/timeframe/indicator still pay a model call.
- Composed plans run producers serially; the Screener scan is one page only.

## What changed (Gates B–E)

| Area | Change |
|---|---|
| Screener (Agent) | List fields (sector, industry, theme…): the model writes the member's words, UCT matches the real values (`/api/screener/fields?options=1`), names them, says coverage; unmatched words are refused with the real names. A word that only fits the sibling field (Sector→Industry) is matched there and said. |
| Latest-session measures | `capabilities/sessionMeasures.js` + `POST /api/agent/session-stats`: close / volume / dollar volume of the newest session whose close has passed (whole-market grouped frame, raw), checked after the engine's filters. One clock: a price condition in the same screen is checked on that session's close. |
| Complete results | Screens are read page by page (parallel after page 1) up to `FILL_MAX` = 1,000 for a fill; "all of them" past that is refused with the real count — never a silent first page. Model-typed tickers stay capped at 50. |
| watchlist.add | `{from, top: null}` = all results, no "how many?" question. |
| watchlist.open (board) | The product's `?openWatchlist=` write: first switchable Watchlist widget, or one new widget in empty space; own receipt and Undo. |
| Deferred steps | A capability marked `deferred` runs after the rest of the request lands, as its own execution (follow-up); its failure keeps what the rest made and says so. Shown on the same approval card. |
| Alias safety | A plan's own `as` alias wins over a same-spelled context ref for later ops of that kind (the fill otherwise went to an existing list). |
| Prompt | "Act on clear intent" defaults + the four reasons to clarify; "whole requests" in one plan; follow-up references resolve from the latest receipt. No capability names hard-coded. |
| Fast path | "change my chart to 15 minutes", "change the timeframe to daily", "switch to the 15 minute", "change my chart to candles", exact-name indicator adds ("put RSI on my chart", "add VWAP"), "open <list>", "open the watchlist you just made". |

## Results (Gate F) — `agentEval.test.jsx`, same 20 tasks, same scripted manifest-aware model

| Metric | master `d4e5200ace` | branch |
|---|---|---|
| Tasks completed | 75% | **100%** |
| Tasks with an unnecessary question | 22% | **0%** |
| Necessary questions still asked | 100% | 100% |
| Model calls per task | 0.95 | **0.60** |
| Model calls across the 9 simple commands | 6 | **1** |
| Writes before approval | 0 | 0 |
| Local pipeline ms (p50 / p95) | 93 / 293 | 108 / 311 |

Local ms excludes the model; the branch's p95 is higher because it now does work the old build refused
(full paged scans + session read). Real-model latency was NOT measured (no paid calls); each model call
avoided is one full Haiku round trip saved.

Real-backend E2E (scratchpad `p1/e2e_software.py`, real /charts, real screener DB + session frame from
local bars, scripted model): 12/12 — the list held exactly the 20 stocks computed independently.

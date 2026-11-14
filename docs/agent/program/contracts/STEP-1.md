# STEP-1 — the planner v2 step protocol (FROZEN for Wave 1 by builder-a, 2026-11-02; A-01)

Scope: the contract between the server's tool-use loop (`run_turn_v2`, `api/services/uct_agent/turn_v2.py`, served only when `UCT_AGENT_PLANNER=v2`) and the browser executor (`app/src/agent/steps.js`). Everything downstream of a step (planOps → decideMode → commitPlan → receipts → Undo) is unchanged. With the flag unset the v1 path is byte-identical: `turn.run_turn` only dispatches, `/api/agent/config` reports `planner: "v1"`.

## Request
`POST /api/agent/turn/stream` with v1's `TurnIn` (message, context + conversation_memory, pending, reference, conversationId). v2 differences: `capabilities` = the FULL available manifest (no routing; the browser sends it only when `config.planner === "v2"`), limit `MAX_CAPABILITIES_V2` (300, = `catalog.maxRegistered`), `routing` ignored. v1's `/api/agent/turn` (non-stream) is never used for v2 (its answer would carry no steps).

## Tools the model sees (built from the manifest; nothing is named in server code)
- `tool_search_tool_regex_20251119` (its name is fixed by the API: `tool_search_tool_regex`), non-deferred.
- 12 domain tools, non-deferred, `strict: true`, no arguments: `chart`, `board`, `watchlist`, `layout`, `indicator`, `drawing`, `alert`, `screener`, `data`, `news`, `research`, `history`. Each returns (as a `tool_result`, server-side, free) the names + one-line summaries of its capabilities and the rule "load the capability with tool_search_tool_regex by its exact tool name". Prefix map (capability domain → tool): chart, chartSetup, chartGrid, volume, pane → `chart`; board, widget, app, settings, guide, agent → `board`; watchlist → `watchlist`; layout → `layout`; indicator, indicatorCopy, indicatorStyle, definition → `indicator`; drawing → `drawing`; alert, indicatorAlert → `alert`; screener → `screener`; stock, index, commodity, crypto → `data`; news → `news`; research → `research`; breadth (history) and every other prefix → `history`.
- One tool per manifest capability, `defer_loading: true`, `strict: true`, name = the capability name with `.` → `__` (`chart.setType` → `chart__setType`; tool names may not contain dots), `input_schema` = `{target: string, args: <the capability's closed args schema, model_safe_schema'd>}`, both required, `additionalProperties: false`. Description = summary + hints + risk/Undo truth (`_catalog_lines` wording).
- `tool_choice` auto only (never forced). No `temperature`. `cache_control: ephemeral` on the last tool (the catalog is the static prefix) and on the last system block; the workspace context is in the user message (volatile, last).

## Loop (server; one SSE response per segment)
```
turnId = opaque token issued at turn start (NOT the transcript row id)
round 1..N   N = UCT_AGENT_PLANNER_ROUNDS (6); $ cap per turn UCT_AGENT_TURN_USD (0.25)
  before EVERY call: turn_spent + worst_case_usd(request) ≤ UCT_AGENT_TURN_USD, else stop (step_limit);
                     then budget.Meter.call reserves the worst case against the daily cap (BudgetRefused → stop)
  model → tool_use(name, input) | text
  server per tool_use: name ∈ manifest (else tool_result is_error "unknown action"; the step is NOT sent);
                       args_match(cap.args, input.args) (else is_error "args off schema");
                       mode = 'query' if cap.query else ('propose' if enforce_approval would turn an apply
                       into a propose for this action — risk confirm / reversible false, EXPLICIT_OK excepted — else 'apply')
  SSE event  {"t":"step","turnId","id","round","action","target","args","mode"}
  browser → POST /api/agent/turn/step {turnId, id, status, receipt?, refusal?, result?}
            status ∈ done | proposed | refused | failed | query
  server: tool_result text = receipt / refusal (is_error for refused|failed) / result;
          isolated kinds (LOCAL_ONLY_ACTIONS, `isolated: true` objects) → value-free note only (ADR-005 L6)
  'proposed' → PAUSE: the loop state (messages, usage, round, spent) is parked under turnId for 10 min;
               the segment ends with {"t":"paused","turnId","id"}; later POST /api/agent/turn/resume
               {turnId, id, status: done|refused, receipt?} continues the loop in a new SSE segment
end: {"t":"final", conversationId, turnId (row id), envelope: {disposition:"answer", reply, ops: []}, usage}
     — exactly v1's final shape, so nothing in the browser executes from it; a transcript row per turn
```
- Parallel tool_use blocks are run in order, one step each; all their tool_results go back in ONE user message.
- `stop_reason` max_tokens / refusal, the round cap, the $ cap and a step timeout (120 s without a step_result) end the turn with a fixed sentence (never the model's claim); every step already applied stays applied with its own receipt and Undo.
- Research is the `research` domain's one capability (`research.web`), ≤ 1 per turn, metered through `Meter.research` as today; its results are data, never a reason to plan a change in the same turn.
- The pause/step registry is in-process (one uvicorn process, as production runs); a second process would not see it — documented constraint, not a Wave 1 target.

## Browser (`steps.js`, v2 only; `useAgent` chooses by `config.planner`)
- Opens the stream, maps each `step` to `execute([op], {path:'model', mode})` (refs translated exactly as v1 does), reads the outcome the executor recorded (applied/noop → done; proposed → proposed; refused/clarify → refused; failed → failed; answered → query with the view's value-free summary for isolated kinds) and POSTs `step_result`.
- A `propose` step shows the ordinary approval card; "do it" / dismiss go through the existing `approve` / `dismiss`, then `resume` is POSTed with the outcome.
- One Undo group per v2 turn across pause/resume: "undo all of that" reverts every applied step of the last v2 turn, newest first, through the existing group Undo (`undoTurn`).
- Receipts stream per step; the final reply is appended as an agent line. Outcome rows are recorded per step (`/api/agent/record`), as every execution is today.

## Safety invariants (tests pin them: `tests/test_uct_agent_planner_v2.py`, `app/src/agent/agentPlannerV2.test.jsx`)
- No step runs for an action not in the manifest; args fail closed on schema (server AND browser planner).
- confirm-risk / irreversible steps never auto-apply; the loop pauses on the card.
- Isolated kinds return value-free step results; the model never sees raw values (L5 strip in the browser, L6 on the server).
- Rounds and $ caps are enforced BEFORE the call (reservation), never after; a refused reservation ends the turn.
- A step failure compensates newest-first (existing runtime) and the model is told `is_error`.
- Member (non-admin) → 403 before any provider call (`require_admin_dark`, G4 rail), unchanged.
- Flag off → v1 byte-identical (`run_turn` dispatch only; one test diffs the v1 request kwargs with and without the dispatch).

# STEP-1 — the planner v2 step protocol (DRAFT seeded by the integrator; builder-a owns and freezes it in A-01)

Scope: the contract between the server's tool-use loop (`run_turn_v2`, flag `UCT_AGENT_PLANNER=v2`) and the browser executor. Everything downstream of a step (planOps → decideMode → commitPlan → receipts → Undo) is unchanged.

## Request
Unchanged from v1 (`TurnIn`): message, context (+ conversation_memory), capabilities (the FULL available manifest, no routing; the server builds tools from it), pending, reference. The 60-action limit does not apply to v2.

## Tools the model sees
- `tool_search` (non-deferred).
- 12 domain tools, non-deferred: `chart`, `board`, `watchlist`, `layout`, `indicator`, `drawing`, `alert`, `screener`, `data`, `news`, `research`, `history` — each returns the names + one-line summaries of its capabilities (so a routing miss is impossible; the model asks the domain, then calls the capability).
- One tool per manifest capability, `defer_loading: true`, `strict: true`, `input_schema` = the capability's `args` schema (closed, all required).

## Loop (server)
```
round 1..N (N = UCT_AGENT_PLANNER_ROUNDS, default 6; per-turn $ cap UCT_AGENT_TURN_USD, default 0.25; both reserved in budget.py before each call)
  model → tool_use(name, args) | text
  server: sanitize step (name ∈ manifest; args validated; enforce_approval → kind: 'propose' for confirm/irreversible) → emit SSE event {type:'step', id, action, target, args, mode:'apply'|'propose'|'query'}
  browser: executes (or shows the approval card) and POSTs {type:'step_result', id, status:'done'|'proposed'|'refused'|'failed'|'query', receipt|refusal|result (value-free for isolated kinds)}
  server: returns tool_result to the model (errors as is_error) → next round
  'proposed' → the loop PAUSES: server stores the model state keyed by turnId; 'do it' resumes with the receipt as the tool_result; 'no' resumes with a refusal
end: text reply → {type:'reply', text, sources}; usage/cost per round logged
```
Research is a tool (`research.web`), one call per turn by default, metered as today.

## Browser
- `steps.js`: subscribes to `step` events, maps each to `execute([op], {path:'model', mode})` with the existing executor, posts `step_result`. One Undo group per turn: "undo all of that" reverts every applied step of the last turn (reuses the WS4 group Undo).
- Receipts stream per step; the final reply is appended.
- v1 path is untouched when the flag is off; `useAgent` chooses by `/api/agent/config.planner`.

## Safety invariants (tests must pin)
- No step runs for an action not in the manifest; args fail closed on schema.
- confirm-risk / irreversible steps never auto-apply; the loop pauses.
- Isolated kinds (ADR-005) return value-free `step_result`s; the model never sees raw values.
- Per-turn rounds and $ caps are enforced before the call (reservation), not after.
- A step failure compensates newest-first (existing runtime) and the model is told `is_error`.
- Member (non-admin) → 403 before any provider call (G4 rail), unchanged.

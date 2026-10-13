# 01 — Current architecture and request flow

All findings below are CONFIRMED by reading code at `e051fa9721`, unless they are marked otherwise. Paths are relative to the repository root.

## 1. Request flow

```
AgentPanel.jsx  ── agent.send(text)
  └─ useAgent.send (app/src/agent/useAgent.js ~893)
       ├─ fastParse(text,{host})  (fastPath.js:168)
       │    controlWord (undo / do it / dismiss / "just the first N")
       │    matchWhole (capabilities with fastWhole: breadth, breadth.history, watchlist lists …)
       │    extractTarget (position words, both/all, deixis) → clause split (, ; and then &) ≤6 clauses
       │    matchClause: EXACTLY one capability `fast` per clause, else the whole message → model
       │    correctTypos (nl/lexicon.js) — only if one reading results and the op is local + reversible
       │  hit → target resolution (position / all / deixis "this chart") → execute(path:'fast')
       └─ miss → MODEL PATH
            selectGroups / routeManifest (routing.js) → ≤55 routed actions (manifest.contract.json)
            refreshContext (≤1.5 s) → buildContext (23 context providers, ≤20 KB)
            POST /api/agent/turn  {message, context, capabilities, pending, manifestVersion, routing}
              router (api/routers/uct_agent.py): admin+paid → daily cap → $ cap (opt-in) → population cap
              run_turn (api/services/uct_agent/turn.py:1128):
                system prompt = _SYSTEM_HEAD + manifest lines + BREADTH_RULE + _SYSTEM_TAIL + routing note
                history = last 12 turns (36 rows), outcome rows labelled [UCT executed]/[UCT proposed]
                ONE Anthropic call: structured output (json_schema envelope), max_tokens 2048,
                  max_retries 0, timeout 60 s, cache_control on the system prompt
                [optional: 1 Perplexity research call → answer only]
                sanitize_envelope: TALK → no ops; >12 ops refused; unknown action refused;
                  unknown target → clarify; "Done." claims stripped
            ← envelope {disposition, reply, question, ops, research, need_groups}
            need_groups → ONE reroute with the requested groups (useAgent ~1059)
            answer/unsupported → shown · clarify → question
            apply/propose → translateRefs → screenModelOps → screenDeicticOps → execute(path:'model')
  execute → executeInner (useAgent ~366)
       deferred/sequential split → expandOps (compose.js: {from, top} refs, lastScreen)
       → queries answered (read-only capabilities; localOnly answers never return to the model)
       → planOps (executor.js:25: shapeError + check + apply per op; aliases via `as`; one refusal refuses all)
       → protectionRefusal (protectedLayouts.js) → decideMode (policy.js:30)
       → propose card | commitPlan (runtime.js:66: freshness fingerprint, commit, read-back, compensate on failure)
       → persist → receipt + Undo → record() POST /api/agent/record (outcome row = history for the model)
```

## 2. Layers: implemented, partial or missing

| Layer | Status | Evidence |
|---|---|---|
| Deterministic phrase matching | IMPLEMENTED. All-or-nothing per message; ≤160 characters; ≤6 clauses | `fastPath.js:168-236` |
| Typo correction | IMPLEMENTED (bounded). Only for local and reversible ops; never for ticker-bearing actions or breadth | `nl/lexicon.js:116`, `fastPath.js:158-185`, `breadth.js` `fastCorrect:false` |
| Capability discovery ("can you …?") | IMPLEMENTED. Deterministic, 19 topics including planned ones | `discovery.js:37-258`, `capabilities/about.js` |
| Routing to the model | IMPLEMENTED (keyword regex groups). 55-action budget; misses lose groups | `routing.js:24-173` |
| Model understanding and planning | IMPLEMENTED. Single-shot structured output; Haiku 4.5 by default (`UCT_AGENT_MODEL` unset in production) | `turn.py:61-64`, `:343`, `:1199` |
| Need-more-groups reroute | IMPLEMENTED. One extra call | `turn.py:1012-1016`, `useAgent.js ~1059-1081` |
| Research (web) | IMPLEMENTED. Perplexity sonar-pro; answers only; blocked for breadth; 0 of 50 production turns used it | `turn.py:767`, `:1240-1309` |
| Structured intent representation | PARTIAL. The op envelope (`disposition`, `ops[{action,target,args,as}]`, `question`) is validated by both server and browser. There is no separate intent frame, no assumption field and no references | `turn.py:343`, `executor.js` |
| Conversation memory | PARTIAL. 12 turns of stored prose plus outcome lines; no summarisation; nothing structured except the breadth subject | `turn.py:52`, `:729-760`; `capabilities/breadth.js:94` |
| Result-set references ("the third one") | NOT IMPLEMENTED. Designed (N5) but not built | `docs/agent/nl-intent/IMPLEMENTATION-2026-10-12.md:77` |
| Workspace awareness | IMPLEMENTED. Charts, board, selected chart, layouts, indicators, drawings, watchlists, screener state | `capabilities.js:120-236`, `host.js:51-131` |
| Deixis ("this chart", "it") | IMPLEMENTED for charts | `deixis.js:80-117` |
| Multi-step plans | IMPLEMENTED. ≤12 ops; aliases; producer→consumer refs (`{from, top}`) only into `widget.addCharts`; compensation; Undo | `executor.js:25-122`, `compose.js`, `runtime.js:44-207` |
| Confirmation policy | IMPLEMENTED. Act on explicit reversible requests; propose risk:confirm, irreversible and `confirmIf` | `policy.js:1-35` |
| Streaming | IMPLEMENTED but OFF (`UCT_AGENT_STREAM` unset); not verified with a real model | `api/routers/uct_agent.py:165-219` |
| Response presentation | IMPLEMENTED. Views (value, comparison, metrics, range, table, headlines, text); concise lead + Details; Open chart | `present.js`, `AgentResult.jsx` |

## 3. Prior projects, as built

- **Speed (`docs/agent/LATENCY.md`).** Measured overhead with a fake model: pre p50 26 ms, post 15 ms. Background naming and telemetry run after the reply; the board check and ticker search run in parallel. The documented numbers are simulated. The **first production timing data is in [04](04-speed-cost-safety.md)**.
- **Intelligence Phases 1–2 (`docs/agent/PHASE1-INTELLIGENCE.md`, `PHASE2.md`).** Scripted evaluation of 24 tasks with 100% completion and 0.54 model calls per task (re-run during this audit: all tasks completed; simple tasks take 0 model calls and about 95 ms).
- **NL intent (`docs/agent/nl-intent/`).**
  - N2–N4 shipped: fuzzy matching of the member's own names, typo correction, ticker grounding.
  - N1 (typed answers), N5 (reference context) and N6 (lexicon-normalised routing) are designed but **not built**.
- **Context & Awareness.** Selected-chart deixis, the breadth subject memory and "simple conversations" (no second approval for explicit reversible ops).
- **Breadth integration (today).** One selection policy (`api/services/uct_agent/breadth_select.py`) covering now, latest close, dated sessions and the last N sessions. It labels completed versus finalized and is local-only.

## 4. Strengths to preserve
1. The capability registry contract: closed schemas, risk/Undo metadata, `fast` matchers, golden manifest.
2. One executor and runtime for both paths: compensation, read-back and fingerprinted Undo.
3. The model plans and never executes: sanitize, refuse, clarify.
4. Local-only data boundary and claim filtering.
5. Deterministic fast path with zero wrong actions on the corpus.
6. Protected layouts, admin gating, caps.

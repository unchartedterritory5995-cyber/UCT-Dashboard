# Deliverable 3 — Architecture assessment

## 1. The system as it is

```
 browser (/charts only)                                   server (FastAPI)
 ─────────────────────────────────────────────────        ──────────────────────────────────────────
 member text
   │
   ├─ references / corrections / follow-ups (deterministic)
   ├─ fastPath: each capability's fast() matcher ──► ops ─┐
   ├─ compound.js (multi-clause, model-free)              │
   └─ else: routeManifest (regex groups, ≤55 of 121) ─────┼─► POST /api/agent/turn
              + context providers (≤20 KB) + memory       │     require_admin_dark, limits, budget ($5/day, 2 calls)
                                                          │     history: last 36 stored rows
                                                          │     claude-haiku-4-5, json_schema envelope, no tools
                                                          │     ◄── envelope {answer|clarify|apply|propose|unsupported, ops}
                                                          │     sanitize_envelope: action ∈ manifest, ≤12 ops, claims scrubbed
                                                          │     enforce_approval: confirm/irreversible → propose
   executor.planOps  (schema, available, check(), apply())◄┘
   policy.decideMode (apply vs propose)
   runtime.commitPlan (kind.commit → read-back landed() → fingerprint → Undo entry)
   present.js (views) ── /api/agent/record (transcript, telemetry; value-free)
                                                               MD-1 gateway (/api/agent/data): 13 kinds, envelopes with
                                                               as_of/freshness/isolated; all flags OFF; 2 kinds consumed
```

Everything on the left is generic: adding a capability is one `registerCapability` entry and the planner, policy, runtime, Undo and server schema pick it up (`app/src/agent/README.md`). That generality is the asset to protect.

## 2. Component verdicts

| Component | Verdict | Why | What to do |
|---|---|---|---|
| Capability registry + target kinds + context providers (`capabilities.js`) | **Preserve** | one declaration drives schema, validation, receipts, Undo | extend with `surfaces` beyond `charts` and a `page` dimension |
| Canonical-writer rule + read-back (`runtime.js`, kind.commit/landed) | **Preserve** | this is what makes Undo exact and receipts honest | none |
| Server sanitizer + approval escalation (`turn.py:1233-1332`) | **Preserve** | the only server-side safety net; works for any catalog | keep as the final gate under a tool-use loop |
| MD-1 gateway + envelopes + isolation stamping (`gateway.py`, `envelope.py`, ADR-005) | **Preserve, extend** | freshness/provenance on every value; 11 kinds unused | wire the unused kinds to capabilities; add index/commodity/crypto kinds |
| fastPath / compound / references (deterministic layers) | **Preserve, stop investing** | correct when they fire, but they reach 41 % of ideal-fast cases on unseen wording and 0/31 discovery questions | keep as a latency/cost optimization for exact phrasings; stop extending them by hand; let the model own understanding |
| Routing (`routing.js`, 60-action cap) | **Replace** | an artifact of a small model + JSON-schema envelope; causes 20–22 % misses and the "too many parts of UCT" refusal | expose the full catalog through tool use with deferred tools (tool search), or a two-level "domain → actions" tool hierarchy; drop the cap |
| Model call (`turn.py:run_turn`): Haiku 4.5, json_schema, ≤2 calls, 2048 tokens, no tools | **Replace (targeted)** | previous-generation model, 10x the price of Haiku 5.5, caching ineffective, cannot iterate on execution results | Sonnet 5.5 (adaptive thinking, low/medium effort) with tool use; Haiku 5.5 for classification/cheap turns; proper cache breakpoints (static catalog first, volatile context last) |
| One plan per turn, `as` aliases, compound stops at first refusal | **Extend** | no dependent-step planning (scan → pick → watchlist → charts → layout) | an agentic loop: model calls a tool, UCT executes (or proposes), the *result* returns to the model, up to N rounds; the existing executor/policy/runtime stay the executor of each round |
| NL-1 hybrid (dark) | **Retire** | a second interpreter built to work around the 60 cap; never evaluated; needs both a flag and localStorage | subsumed by the planner upgrade |
| Session memory (`memory.js`, 30-min TTL) + server transcript (`store.py`) | **Extend** | nothing persists about the member | add a member preference store (preferred indicators, timeframes, lists, risk rules) with explicit consent and a `settings` capability to view/clear it |
| Host (`host.js`, Charts workspace only) | **Extend** | the single biggest coverage limiter | an app-level `AgentProvider` with per-page host adapters; capabilities declare `surfaces` they support; queries available everywhere |
| Research (`_web_search` via Perplexity, 1/turn) | **Extend into a service** | one answer-only query, no company-data grounding | RS-1: compose MD-1 kinds (fundamentals, earnings, news.company, themes) + web search + citations; separate facts / interpretation / unknowns in the envelope |
| Historical (`event_study.py`, zero callers) | **Wire** | the service exists, local-only, model-isolated | a `history.eventStudy` capability returning value-free summaries to the model and full tables to the member |
| Guide (explain/show/do) | **Extend** | 11 features, Charts only | registry-driven targets per page once the host is app-level |
| Tests (144 vitest files, 59 pytest, scripted model) | **Simplify** | 16–18 min in the serial gate; many rails pin wording | split: fast contract suite in the gate (≤3 min), full suite on PR to agent branches, real-model eval nightly |
| Docs (`docs/agent`, 90 files, 35 plan/status docs) | **Simplify** | the record is spread over phase reports, status logs, checklists | one `PROGRAM.md` (vision, packages, owners), one `BOARD.md` (task graph), ADRs; archive the rest |

## 3. The planner upgrade, concretely

Current: one JSON envelope per turn, chosen from ≤ 55 actions, no feedback from execution.

Proposed (server-side, inside the existing `run_turn`):

```
tools = [ tool_search (regex or BM25),                      # non-deferred
          12 "domain" tools always loaded (chart, board, watchlist, layout, indicator, drawing, alert,
                                           screener, data, news, research, history),
          121 capability tools generated from the manifest, defer_loading: true ]
loop ≤ N rounds (N = 6 default, budgeted):
   model → tool_use(capability, args)
   server: sanitize (action ∈ manifest, args schema) → return to browser as a "step"
   browser: planOps → decideMode → commit or propose → result/receipt/refusal
   browser → server: tool_result (receipt text or refusal; data queries return value-free summaries
                                 for isolated kinds, full data otherwise)
   model continues or ends the turn with a reply
```

- The browser remains the executor; the server never mutates. The approval model is unchanged: a `propose` step pauses the loop and resumes on "do it".
- `sanitize_envelope` and `enforce_approval` apply per step instead of per envelope.
- Cost: with the static catalog (≈ 8–10k tokens) cached and ≈ 2k tokens of volatile context, a Sonnet 5.5 round is ≈ $0.004 cached input + ≈ $0.005 output; a 4-round multi-step turn ≈ $0.04. Haiku 5.5 is 10x cheaper for simple turns. Today's Haiku 4.5 turn at ~24k mostly-uncached tokens costs ≈ $0.03 for one step. The upgrade is cost-neutral per step and cheaper per *completed task*.
- Latency: Sonnet 5.5 at low effort with streaming shows first text in ~1–2 s; a 4-round turn ≈ 8–12 s with per-step receipts streaming to the panel. Streaming (`UCT_AGENT_STREAM`) is already implemented and dark.

Why not keep the envelope and just raise the cap? The cap exists because a json_schema with 121 strict variants is too large; compact mode loses arg validation. Tool use with `strict: true` gives validated args per call and lets the model see execution results, which the envelope cannot do.

## 4. Multi-page host, concretely

```
<AgentProvider>                      app-level; owns the panel, conversation, memory
   useAgent({ host: pageHost })      pageHost built by each page from a small adapter:
      /charts  → today's host.js (unchanged)
      /screener → { screens, results, savedScreens }
      /journal  → { notes, trades (read), positions (read) }
      /breadth, /calendar, /morning-wire, /model-book → read adapters
      everywhere → queries (quote, bars, news, research, history), navigation, settings
```

Capabilities declare `surfaces: ['charts']` today; they gain `['*']` for queries and page lists for writes. The registry's `availableCapabilities(ctx)` already filters on `ctx.surface`; no planner change is needed.

## 5. Security, cost and licensing controls: generic vs per-feature

Generic today (apply to any new capability automatically): route guard, admission/budget chain, manifest-derived schema, approval escalation, receipts/Undo per target kind, gateway flags/budgets/envelope/isolated stamp, marker strip (App. E §8).

Per-feature today (must be made generic before scaling): `LOCAL_ONLY_ACTIONS` and `EXPLICIT_OK_ACTIONS` hand lists in `turn.py`; breadth/news route-specific rules; legacy `stock.js`/`alert.js` fetching `/api/live-prices` outside the gateway (alert side-effect risk); keyword research gates.

Recommended: a single `policy` block on each registered capability (`isolated`, `localOnly`, `explicitOk`, `sideEffects`, `license`) read by the server from the manifest, so the server lists stop being hand-maintained. Keep `require_admin_dark` until member rollout; replace with `require_paid` + per-capability `available(ctx)` then.

## 6. What a rewrite would cost and why it is not warranted

A rewrite would re-derive the registry, writers, read-back, Undo, approvals, isolation and the 2,490 tests, which took 27 days and is the part that works. The limiting pieces (planner call, routing, host mount, memory store, research/history services) total a few thousand lines and sit behind interfaces the rest of the system already honors. Targeted replacement of the planner and extension of the host gets the full vision on the existing foundation.

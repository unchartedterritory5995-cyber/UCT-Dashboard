# ADR-005 — Model isolation for UCT-derived data (breadth, ratings)

- **Status:** accepted 2026-11-01 (agent-lead). Owner policy: strict isolation, member-direct display only, with no relaxation until a separately reviewed interface is approved.
- **Raised by:** agent-md's finding on #596. The gateway's `model_isolated` refusal trusts a **caller-asserted** `purpose`, so on its own it is not proof (owner rule: "do not consider gateway-only refusal sufficient proof").

## The rule

Raw values of `model_isolated` kinds must never enter anything the model sees. Today those kinds are `breadth.current` (including the NH/NL measures) and `ratings`. The model must not see them in:
- prompts;
- tool results or op outcomes;
- conversation history or replay;
- summaries or titles;
- planner context;
- memory;
- traces or telemetry visible to the model;
- any alternate serialization.

They may only be shown to the member directly. Research, scan, and any composition that needs protected values are refused.

## Layers (defence in depth; no single layer is the proof)

| # | Layer | Mechanism | Owner | When |
|---|---|---|---|---|
| L1 | Gateway | **Dormant by default:** isolated kinds are refused server-side for every purpose unless `UCT_AGENT_ISOLATED=1` (default off; activation is a separate owner decision), so their security never rests on the browser-supplied `purpose`. When active: only `purpose: "answer"` (#588). | agent-lead | in place |
| L2 | Envelope marker | Envelopes of isolated kinds carry `isolated: true` (additive MD-1 field) | agent-lead (`gateway.py`) | before the first caller |
| L3 | Caller allowlist | Only an allowlisted capability module may call `readData` with an isolated kind. A static rail fails on any other caller. | agent-qa (rail), agent-lead (allowlist) | before the first caller |
| L4 | Local-result boundary (server) | Every action of an allowlisted capability is in `turn.LOCAL_ONLY_ACTIONS`, and its outcome rows are recorded `local: true`. History then replays only `LOCAL_RESULT_NOTE`, never the values (`turn.is_local_row` / `outcome_for_model`, as `breadth.show` does today). | agent-lead (`turn.py`) | with the first caller |
| L5 | Model-path refusal (browser) | The turn-request serializer (`agentClient`) drops any object marked `isolated: true` from `context`, `history` or `memory`, and records the drop (content-free). | agent-lead | before the first caller |
| L6 | Model-path refusal (server) | `turn.run_turn` refuses (or strips, fail closed) a request whose context or history carries the `isolated` marker. | agent-lead | before the first caller |
| L7 | Memory and traces | `memory.js` holds tickers and labels, never values. **Traces and telemetry** (`trace.js` turns, apply traces, `/api/agent/record` telemetry fields) carry phase names and kinds only, never values. The member's own stored transcript (the `/record` outcome text and views that restore their screen) MAY hold the values they were shown, and is railed **never replayed** to the model (L4). Ruling on QA F-13. | agent-lead + agent-qa (rails) | rails in place (#603) |

## Gates

1. **#596** (the kinds themselves) may be integrated once agent-qa proves that today's exposure is nil:
   - no non-test caller;
   - every model-visible serializer is railed against the marker / local-result boundary as **forward rails**, which fail when a caller is wired without L2–L7.
2. **The first capability that reads an isolated kind** is not integrated until L2–L7 are in place and QA's rails pass with that capability wired.
3. **Any relaxation** (for example a reviewed interface that gives the model derived, non-raw signals) needs a new ADR and the owner's explicit approval.

## Known findings (QA, #596 isolation proof)

- **F-11** (latent): `turn._row_actions` treats an answered row with no `actions` as `[]`, so it would be replayed. No browser path omits `actions` today. QA pins it as a strict known finding. A lead hardening PR after the release candidate will treat such rows as unreadable (fail closed).
- **F-12**: `stock.compare` shows the UCT composite rating from `/api/research/compare`, outside MD-1, so L3 can't see it. This is existing pre-program behaviour. The value sits only in the stored table, never in replayed outcome text, and that is railed end to end. Routing it through `ratings`, or making `stock.compare` local-only, changes live behaviour and needs an owner decision.

## Not done here

Purpose derived on the server, rather than asserted by the caller, can't prove isolation: the server can't see where a browser takes a value after `/api/agent/data`. L4–L6 put the guarantee on the model path instead.

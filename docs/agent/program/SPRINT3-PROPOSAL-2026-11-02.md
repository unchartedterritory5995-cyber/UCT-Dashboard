# UCT Agent — proposed Sprint 3 (for owner approval; nothing here is started)

Evidence: [DIAGNOSTIC-UNDERSTAND-VS-EXECUTE-2026-11-02.md](DIAGNOSTIC-UNDERSTAND-VS-EXECUTE-2026-11-02.md),
[ARCH-REVIEW-NL-2026-11-02.md](ARCH-REVIEW-NL-2026-11-02.md), QA #662, agent-sc scanner review, agent-md
`MD-1-failure-review.md`. Constraints honoured: existing architecture and canonical APIs, server-side permissions
and allowlists, approvals, receipts, Undo, admin-only, cost and security controls. No competing execution system.

## Ranked backlog

Impact = how many member requests it rescues. Effort: S ≤ 1 session, M 1–3, L > 3. Risk = chance of a wrong action.

| Rank | Item | Fixes (diagnostic #) | Impact | Effort | Risk | Owner |
|---|---|---|---|---|---|---|
| 0 | **Capped evaluation** of the planner: SAT-1 §B (≤ $1) and the NL-1 trial ($2.60 cap) → then legacy vs NL-1, Haiku 4.5 vs a stronger model, sealed sets (recorded estimate ≈ $15, ceiling $45; prices re-verified at run start). Needs a dedicated dev credential. | 20, and decides 3–5 | Decides the rest | S | None (no production effect) | QA + lead |
| 1 | **Show the model the right tools**: pin the screener group while a screen is the conversation's subject and for screen-shaped text; always send the labelled field catalog. Admin path only, flags unchanged. | 3, 4, 5 | High | S | Low (every op still validated) | lead + agent-sc |
| 2 | **Scanner follow-ups that express what members say**: `remove: [keys]`, universe fields replace on refine, wire filters (keys) in context. | 6, 7 | High | S | Low (fixes a *silent* wrong result) | agent-sc |
| 3 | **Refusal and receipt wording** that says what happened and what to do next: one-scan-per-message, F-16 refusals with public alternatives (after the owner's strength ruling), "Did you mean AMZN?", "SMA 50 is already on that chart", gateway refusal codes. | 12, 13, 18, 19 | Medium–high (perceived failures) | S | Very low | lead + owners |
| 4 | **Field definitions** for ~20 ambiguous screener fields (volume ratio vs relative volume, distance fields, dollar-volume windows) via the catalog's existing `description`. | 11 | Medium | S | Low | agent-sc + Screener owner |
| 5 | **Research answers (RS-1)**: W1 "why is X moving", W2 "compare X and Y", W3 "since earnings" — compositions of existing MD-1 kinds; every number cited to an envelope; never a live price without a fresh envelope; uncertainty stated. Dark until activation is approved. | (new value) | High once data is on | M | Medium (needs QA held-out per workflow) | agent-md |
| 6 | **Small quote-language gaps** (agent-md review): "vs" as a separator, "how much is a share of…", intraday high/low from existing rows, a dated close via `to`, remember a confirmed symbol for the conversation. | 8 + misses | Medium | S | Low (still resolved on every read) | agent-md |
| 7 | **NL-1 path** (built, dark): evaluate, then switch on for admin only if it beats the legacy path on sealed sets. Retires word routing as a gate and most pre-model interceptors. | 1–5 structurally | Highest, if measured | S to switch / M to harden | Medium until measured | lead |
| 8 | **News → Agent headline conversations** (spec agreed with UCT News): answer-only news turn, `useAgentAsk`, `AgentIdentity`, `openAgent`. | (new value) | Medium | M | Low (answer-only, admin-only) | lead |
| 9 | **F-23** half-day bars answer; **F-16 metadata tag** with the Screener owner (default-deny exposure attribute). | correctness / governance | Low–medium | S / M | Low | agent-md / agent-sc + Screener owner |

## Not proposed

New phrase handlers or word lists; the parked scan-intent layer (dropped unless the evaluation shows the planner
cannot build screens); local-only rating screens; any data activation (separate decisions).

## Decisions needed before Sprint 3 starts

1. Approve item 0 (credential + capped budget). Everything else is better decided with its numbers.
2. "Strength" under F-16: refuse, or answer from public price performance and say so.
3. Which items to include; suggested first slice: 0, 1, 2, 3 (all small, low risk, high visibility), then 5 or 7
   depending on the evaluation.

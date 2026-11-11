# ADR-004 — Indicator-condition scans follow IC-1 (Indicators-owned)

- **Status:** contract ACCEPTED by agent-lead 2026-11-01. IC-1 draft.2 is **approved by the owner as the contract, but not yet merged to master**: `docs/indicators/IC-1-INDICATOR-CONDITIONS.md` at `3ec68dcedd`, branch `docs/indicators-ic1`, PR #573 (open). It joins the next approved master release window.
- **Runtime:** **none authorized.** The SC-1 v1.2 kind is planning-only until the owner schedules it.
- **Decider:** agent-lead. The contract owner is Indicators.

## Context

SC-1 v1.0/v1.1 scans only the screener's own field specs. An indicator condition, such as a cross or a member's custom indicator, had no defined route, which risked a second condition language. Indicators drafted IC-1, and agent-sc's review comments C1–C8 are folded into draft.2.

## Decision

1. **Now:** the Agent refuses the screener's `scan` key (the definition-results join) and any indicator-condition spec with a sentence, and never approximates it (`scan/spec.py` `INDICATOR_KEYS`, railed).
2. **When scheduled:** SC-1 v1.2 adds **one** scan-category kind that delegates exactly as IC-1 specifies:
   - **Identity:** keyed by `user_definitions.result_identity`, validated with `RESULT_IDENTITY_RE`. Never the bare `ast_hash`.
   - **Outcomes:** "not run" means `unavailable`, never zero hits. A symbol that isn't computable is reported per symbol and makes the read `partial`. A receipt whose arithmetic doesn't close is `unavailable`.
   - **Freshness:** periodic, with `as_of` = the session's 16:00 ET close in UTC. Also stale when more than one NYSE session behind. The live tier is excluded.
   - **Data access:** only the `scan_store` functions, no SQL, and never `scan_evaluator` on a request path. `provider_calls` is 0.
   - **Budget:** shares the gateway's 1 scan per turn. IC-1's refusals before admission spend nothing (`Kind.validate`, #575); after admission they spend the scan.
   - **Refusals:** the five named `ic1:*` codes.
3. **Definitions** are read-only (`/api/user-definitions`, as the member). The Agent writes them only through `agentMutations` / `agentSeams`. Indicators stays EXTERNAL in `OWNERSHIP.md`.

## Consequences

agent-qa's conformance list is IC-1 §13. agent-sc owns the delegating kind when it is scheduled. Indicators owns the contract, the definition format, `result_identity` and the engines.

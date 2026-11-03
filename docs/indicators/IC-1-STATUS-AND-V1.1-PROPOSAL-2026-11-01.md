# IC-1 — status, and a v1.1 proposal (2026-11-01)

**Status of v1.0.**
- Draft.2 is approved at `3ec68dcedd` (PR #573, branch `docs/indicators-ic1`), and ACKed by agent-lead and agent-sc.
- It is **held from master** by owner decision (release timing) and goes into the next approved release window.
- Nothing in this file changes v1.0.

**This file is a proposal for later review.** Indicators proposes and agent-lead records (MD-1 §8). It
has not been agreed, and none of it is implemented.

## Why a v1.1 is worth having

Plain-English authoring (`docs/indicators/PLAIN-ENGLISH-AUTHORING-2026-11-01.md`) and IC-1 meet at
one member journey: *"make an indicator for when the 9 EMA crosses the 20, then show me which stocks
did it today."* On v1.0 that journey has three rough edges:

1. **A condition saved today reads `not-run` until the 05:00 ET sweep.** That is correct, but the
   Agent cannot tell "just created, scanned tonight" from "the sweep stopped".
2. **The Agent must compute the result identity itself** (`definitionSemantics.resultIdentity`, or the
   server's `result_identity`). Keying is exactly where defect N11 lives: the bare hash reads nothing
   for semantics 2.
3. **A condition cannot be combined with screener filters** (§11a): "EMA cross among RS > 80".

## Proposals

### P1. Read by `def_id`, and the server derives the identity (Indicators + agent-sc)

- **The change.** The IC-1 read takes `def_id` (the member's own or shared definition). The server
  then:
  - loads it as the member, through the same read the route uses;
  - applies the §6 refusals;
  - computes `result_identity` itself.
- **The consumer** never sends an identity, so the N11 class cannot recur in the Agent.
- **`def_hash` stays** for back-compatibility, with the v1.0 rules.
- **Cost:** one gateway-side lookup. Budget: unchanged; it is the same single scan read.

### P2. A named "first sweep pending" note (Indicators + agent-sc)

When the answer is `not-run` **and** the definition's last write is newer than the latest sweep's
`swept_at`, add the note: "saved after the last scan; tonight's 05:00 ET scan will include it".

- It is still `not-run` and still `unavailable`. Only the note changes.
- It needs no new evaluator. It is read-only, from `user_definitions` and `scan_store` timestamps.

### P3. The screener's `scan` join, keyed by result identity (Screener + Indicators)

This is the precondition for combining a condition with field filters.
- `screener/query.py::_scan_clauses` joins by whatever hash the spec carries. That is the N11 shape.
- **Proposal:** the join resolves a `def_id` (or validates a `RESULT_IDENTITY_RE` value) before it
  reads `scan_store`.
- This is Screener-owned code, so it needs both owners. IC-1 would then lift its §11a refusal in a
  later version.

### Out of scope, unchanged

- An on-demand sweep of one new definition. That would be a second evaluation path. If ever wanted, it
  belongs to the Screener's `scan_evaluator`, behind its own budget, and is not part of IC-1.
- Thresholding a numeric-yield definition on the Agent's behalf. It stays `ic1:not-a-condition`.

## Plain-English authoring and conditions use the same interfaces

A condition created in words is an ordinary saved definition whose output is yes/no. It is created
only through `agentAuthoring.saveDraft` (Agent) or the builder (member). It is read only through IC-1.

- Tonight's chart-door fixes (full indicator names, Bollinger Bands) make more conditions sayable.
  They add no condition format, no evaluator and no Agent-side logic.
- One optional additive seam would help P1/P2: `saveDraft`'s success result could carry
  `isCondition` (boolean yield). It is **not implemented**, because `agentAuthoring.js` is an
  Agent-consumed contract (`AUTHORING_CONTRACT`) and a field there is agent-lead's call.

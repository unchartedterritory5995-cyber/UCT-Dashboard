# NL-1: owner decisions (2026-10-16)

The owner approved NL-1 as UCT Agent's next major milestone on 2026-10-16. The objective is genuine model-first natural-language understanding, not more phrase lists or regex routing. Audit: [NL1-AUDIT.md](NL1-AUDIT.md).

| # | Decision | Status |
|---|---|---|
| 1 | Steps 1 (eval suite) and 3 (interpreter): free, isolated, local. Separate branch/worktree; no change to the frozen Gate C release candidate or Indicators-owned files | **Approved** |
| 2 | The model interprets all ordinary requests; deterministic instant handling only for exact Undo, Confirm, Cancel. Production routing stays; new behaviour sits behind a **disabled** flag until evaluated | **Design target** |
| 3 | Model choice deferred: compare candidates on measured intent accuracy, safety, latency, cost; verify availability and pricing before assuming | **Deferred** |
| 4 | The model should understand all 91 capabilities. Design a compact, complete catalog and **propose** a safe change to the 60-action limit; no production limit change or authorization bypass without separate approval | **Approved in principle** |
| 5 | Eval budget: a separate, explicitly capped non-production budget; never the Agent's production $5/day. **No paid evaluations or API calls authorized yet.** Prepare the harness, estimate tokens, propose a hard cap | **Prepare only** |
| 6 | Conversational corrections ("No, I meant 15 minutes"): reverse the Agent's previous action and apply the correction, only when authoritative readback confirms it is reversible, unchanged and authorized. Never silently undo irreversible or externally modified actions | **Design target** |

## Implementation rules
- Preserve deterministic execution, permissions, approvals, receipts, Undo, stale-state protection, admin-only access.
- No second capability registry or Indicators engine.
- Never tune against sealed blind evaluation sets.
- Measure intent accuracy separately from execution success.
- Tests for: ambiguous instructions, unsupported actions, prompt injection, multi-turn corrections, multi-step requests.
- Production behaviour unchanged until NL-1 passes its acceptance gates.
- Release order **A0 → Gate C → A1 → NL-1**.
- No paid calls, long full suites, pushes, merges or deployments without separate authorization.

## Development location
- Branch `feat/agent-nl1`, worktree `C:\UCT\nl1`. Local only.
- Based on the Gate C rehearsal `5f32761809` (Gate C `3191545b71` rebased onto master `6f54d107ec`), because NL-1 extends Gate C's files (`turn.py`, `useAgent.js`, `references.js`, `memory.js`). It is rebased after Gate C lands.
- The rehearsal branch itself is never modified.

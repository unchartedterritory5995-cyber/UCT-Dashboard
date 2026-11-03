# IC-1 v1.1: P1 and P2 design and implementation plan (2026-11-02)

**Owner decision, 2026-11-02:**
- P1 and P2 proceed to design and implementation planning.
- P3 (the screener `scan` join) is held until the Screener owner can coordinate.
- The optional Agent save-result field (`isCondition`) stays deferred until Sprint 3 is approved.

Background and v1.0 status: `IC-1-STATUS-AND-V1.1-PROPOSAL-2026-11-01.md` (on #670). v1.0 itself is PR #573, approved and held for a release window. This plan does not change v1.0. It is not implemented yet. Implementation waits until #573 is on master, because v1.1 amends that document.

## Ownership

| Piece | Owner | Why |
|---|---|---|
| Resolving a definition to its result identity | **Indicators** (`api/services/user_definitions.py`) | Identity is computed there today (`result_identity`, `trees_identity`) |
| The "saved after the last scan" fact | **Indicators** (reads `user_definitions` timestamps) plus a read-only sweep timestamp from the Screener's `scan_store` | No new evaluator |
| The Agent gateway calling it | **agent-sc** | Agent-owned gateway; Indicators does not edit Agent files |
| `/api/scans/definition-results` | **Screener** | Unchanged by P1/P2, so no Screener change is needed |

## P1: read by `def_id`; the server derives the identity

**Interface.** One new pure, read-only function, owned by Indicators:

```python
user_definitions.condition_identity(user_id, def_id) -> dict
# ok:      {"ok": True, "def_id", "version", "result_identity", "is_condition": bool, "updated_at"}
# refused: {"ok": False, "refusal": "ic1:not-found" | "ic1:not-a-condition" | ...}   (the v1.0 §6 names)
```

What it does:
- Loads through `user_definitions.get(user_id, def_id)`: the member's own definition, with the same access rules as the route. A shared definition goes through the existing shared read; it is never a raw table read.
- Computes `result_identity(definition)` with the existing function. No second hash implementation.
- Decides `is_condition` from the scan plot's yield (boolean).
  - This is the same rule v1.0 §6 uses for `ic1:not-a-condition`.
  - A numeric yield is refused with that refusal, not thresholded.

The Agent gateway (agent-sc) calls this function, then makes the existing scan read with the returned identity. The consumer never sends an identity, so the N11 class (a bare hash reads nothing for semantics 2) cannot recur.

**`def_hash` input stays**, with the v1.0 rules, for back-compatibility.

**Tests (Indicators):**
- a semantics-1 and a semantics-2 definition each resolve to the identity the sweep writes under (cross-checked against `scan_evaluator`'s own keying on a fixture sweep);
- another member's private `def_id` returns `ic1:not-found`, not a different refusal, so it cannot be used to probe existence;
- a numeric definition returns `ic1:not-a-condition`;
- a deleted definition returns `ic1:not-found`;
- a non-vacuity control: one fixture with hits proves the identity reads rows.

**Steps:**
1. Write the function and its tests (Indicators).
2. Amend the IC-1 document to v1.1 §P1: the interface and the refusal table. Ask for ACKs from agent-lead and agent-sc.
3. agent-sc wires its gateway (Agent's branch, Agent's release).

## P2: a named "first sweep pending" note

**The fact:**
- `saved_after_last_sweep = newest_version.created_at > last_sweep_completed_at(tf)`
- There is no `updated_at` column. A save writes a new `user_definitions` version row, and that row's
  `created_at` is the last write (`user_definitions.py`, the versions table).
- It is computed only when the answer is already `not-run`.

**The source of `last_sweep_completed_at`.**
- It must be the sweep's own record of finishing, not "the newest coverage row of some definition". A sweep that skipped this definition must not count as proof of anything.
- **Read on `2cd4c3839c`.** The nightly sweep persists `record_hits` and `record_coverage` per
  definition (`scan_evaluator.py`, the `scan_store.record_coverage(...)` call). `swept_at` defaults to
  `time.time()` (`scan_store.record_coverage`). A run-level record exists only for the LIVE mode
  (`record_live_cycle` / `last_live_cycle`). **No nightly run-level completion time was found.**
- Step 1 of implementation re-reads this at the then-current master.
- If no run-level completion time is persisted, P2 adds one additive, read-only row on the Screener side. That would then need the Screener owner, so it is flagged now.

**The answer.** The answer is still `not-run` and still `unavailable`. Only a note is added, from the v1.1 note table:

> "saved after the last scan; tonight's 05:00 ET scan will include it"

The time string comes from `scan_evaluator.SWEEP_HOUR_ET` / `SWEEP_MINUTE_ET`, never typed.

**When no note is shown.** The note is NOT shown when the definition is older than the last completed sweep. In that case `not-run` means something else, possibly a stopped sweep, and the existing note applies.

**Tests:**
- saved after the sweep gives the note;
- saved before the sweep gives no note;
- no sweep ever gives no note (unknown is not "pending");
- the note's time is derived from the constants;
- a control in which the sweep timestamp is unreadable shows that the function answers "unknown", not "pending".

## Sequencing and gates

1. #573 (v1.0) lands in an approved release window.
2. P1 and P2 are implemented on an Indicators branch, with model-free tests only. Draft PR.
3. The v1.1 amendment is ACKed by agent-lead and agent-sc.
4. agent-sc integrates after Sprint 2 is deployed, coordinated with agent-lead.

There are no flags and no member-visible change until the Agent consumes it.

## Out of scope (unchanged)

- P3, the screener join. Held for the Screener owner.
- `isCondition` on `saveDraft`. Deferred until Sprint 3 is approved.
- An on-demand sweep of one definition.

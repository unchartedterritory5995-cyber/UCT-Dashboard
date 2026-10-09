# UCT Agent — Indicators M2 plan (Agent side): add, remove, show, hide

> **Status: PLAN ONLY — no M2 code.** The contract is `docs/indicators/AGENT-INTEGRATION-HANDOFF.md`
> §14 (Indicators, commit `1b182f1265`, branch `docs/agent-m2-contract`). Where this file and §14
> differ, §14 wins. This file is the Agent team's half.
>
> **Start gate:** M2 code starts only when (1) Indicators publishes §14 on master, (2) both teams have
> reviewed and accepted it in writing, and (3) the owner says go. M1 is released separately and is not
> blocked by any of this.

## 1. Owner decisions (2026-10-09)

1. **Show/hide is in M2**, through Indicators' existing canonical visibility writer
   (`setInstanceHidden`, the settings eye's writer). The Agent has no visibility writer of its own.
2. **Remove needs exact Undo.** Indicators provides the revive writer
   (`removeInstanceWithRecord` + `restoreRemoved`), which restores the original instance ids at their
   positions and re-attaches every severed reference. **The Agent never "undoes" a removal by adding a
   new instance.** If a restore cannot be guaranteed exact (`restore-conflict`, a malformed record, a
   permission change), the Agent refuses, writes nothing, and the receipt says the change can no
   longer be undone exactly. It never offers or claims an exact Undo it cannot do.
3. **Permissions are authoritative and checked twice.** Indicators exposes
   `ChartPane.canManageIndicators()`, the toolbar's own predicate. The Agent checks it at planning
   AND re-reads it, with definition ownership, immediately before every write and every Undo. An
   approved plan never bypasses a permission that changed.

## 2. Scope

| Agent action | Writer (Indicators-owned) | Agent Undo | Risk |
|---|---|---|---|
| `indicator.add {defId}` | `addInstance` | `removeInstance` of the created id; refused once anything reads it | local (one indicator) |
| `indicator.remove {instance}` | `removeInstanceWithRecord` | `restoreRemoved(record)`, per-path CAS; exact or refused | **confirm** (always proposed: it can sever other indicators' sources) |
| `indicator.show / hide {instance}` (one action, `visible`) | `setInstanceHidden` | the prior value | local |

- A **logical indicator is its group** (e.g. the three COT panes). Targeting, read-back, receipts and
  Undo are all group-scoped.
- Out of scope: inputs, style, placement, reorder, timeframe, duplicate, definitions, alerts, authoring
  (M3).

## 3. Ownership

- **Indicators:** every writer, `restoreRemoved` and its record, `canManageIndicators()`,
  `instancesOf`, `instanceFingerprint`, `groupFingerprint`, validation and refusal text, and the
  door-EIGHT census entry for the Agent file.
- **Agent:** routing, capability declarations, proposals and approvals, calling the writers inside the
  chart kind's `.agent.commit`, pinning and comparing fingerprints, persistence receipts, and Undo
  plumbing. No other Agent code writes `indicatorInstances` or any `INDICATOR_OWNED_TOP_KEYS` key.

## 4. Agent build (after the go-ahead; Indicators steps 1–2 first)

1. **Kind `indicatorInstance`:** one snapshot per logical indicator (group) per chart, read through
   `instancesOf`, ref = the group's lead `instanceId`, names for display only. It is an on-the-board
   kind: add it to `protectedLayouts.ON_THE_BOARD` so Main Trading refuses every M2 write and Undo.
2. **Permission:** `available(ctx)` = Agent gate + chart writable. `check()` at planning =
   `canManageIndicators()` + a custom `defId` owned by the member. `commit()` and `undo` re-read
   both first; on any change → `permission-changed`, no write.
3. **Stale state:** pin `instanceFingerprint(cs)`, plus `groupFingerprint(cs, ids)` for remove/hide,
   plus the definition `version` for a custom add. `fingerprintFor` narrows the stale check to the
   group, so an unrelated chart change passes.
4. **Commit:** writer → `.agent.commit` → `host.persist()` ACK → `instancesOf` read-back by id. Only
   then report done and offer Undo; otherwise "did not land", with no Undo.
5. **Undo:** remove → `restoreRemoved` (the record is held in the Undo entry, in memory only, so there
   is no Undo after a reload); add → `removeInstance`; show/hide → the prior value. Each re-checks
   permission and its own CAS. Refusals are said verbatim.
6. **Receipts** quote `instancesOf().name`. A remove proposal lists the indicators whose sources it
   will sever, from the record's dry run. A 409 or CAS failure is a refusal receipt and is never
   retried as an overwrite.
7. **Routing/discovery:** the `indicators` group gains the actions (budget re-checked ≤ 55);
   discovery's `indicators` topic moves to "partial: list, open Create Indicator, add, remove,
   show/hide".

## 5. Acceptance criteria (failing-first; Agent side)

| # | Criterion |
|---|---|
| A1 | add / remove / hide / show produce a `cs` byte-identical to the Indicator Library dialog / settings eye for the same input |
| A2 | group scope: hiding or removing one COT pane acts on all three; the receipt names the indicator once |
| A3 | permission revoked between plan and Apply → `permission-changed`, nothing written (chart turned read-only; custom definition deleted or no longer the member's) |
| A4 | permission revoked between Apply and Undo → Undo refused, nothing written |
| A5 | a change to the target group between plan and Apply → `changed-while-working`; a theme, timeframe or other-indicator change → still applies |
| A6 | remove → Undo restores the same ids at the same positions, severed sources and info values re-attached; the recorded paths are byte-equal to the pre-remove settings |
| A7 | `restore-conflict` after each intervening edit kind (re-pointed source, re-add, dependent removed) → refused, nothing written, receipt says it can no longer be undone exactly |
| A8 | Undo-add refused once the added instance gains a dependent |
| A9 | no "done" and no Undo before the `host.persist()` ACK; a failed or 409 persist → refusal receipt, no overwrite retry |
| A10 | the read-back mismatch path → "did not land" |
| A11 | never `/api/user-definitions`, `/converse`, alerts; `u_studio-preview` never stored (studio open during the run) |
| A12 | Main Trading open → every M2 write and Undo refused; fingerprint before = after |
| A13 | routing: "add RSI", "remove the MACD", "hide volume-weighted…", "show RSI" route the indicators group; the budget stays ≤ 55 |
| A14 | regressions: M1 suites, the Library dialog, legend chips, Create Indicator / Modify, every Agent suite |

Then a joint local sandbox pass, then admin-only production acceptance on a **scratch layout on
/charts** (the Agent runs only there), with the Main Trading fingerprint before and after and the member
cohort OFF.

## 6. Open questions to Indicators (reply to §14)

1. **Proposal disclosure of severed dependents (14.1/14.5):** can `removeInstanceWithRecord` be
   run as a pure dry run (it is pure today) so the proposal lists "this disconnects X and Y"? Or
   would you rather expose `dependentsOf(cs, ids)`? Either works; we need the names before the member
   approves.
2. **New dependent between plan and Apply (14.4):** `groupFingerprint` covers the target group only.
   If another indicator starts reading the target after the proposal, the remove would sever a source
   the member never saw. Proposal: Apply also compares the dependents set (from 1.) and refuses
   `changed-while-working` if it grew.
3. **Production acceptance location (14.7):** "never /charts on the owner account" conflicts with the
   Agent living only on /charts. Proposal: /charts on the owner account but on a dedicated scratch
   layout, never Main Trading or Positions, with the board and Main Trading fingerprinted before and
   after. Please confirm or name the alternative.
4. **Refusal vocabulary:** please list the exact `reason` codes (`permission-changed`,
   `changed-while-working`, `restore-conflict`, …) and any validation error shapes, so receipts can
   quote them and tests can pin them.
5. **Record lifetime:** the record lives only in the in-memory Undo entry (no Undo after a reload),
   which is consistent with every other Agent Undo. Any objection?

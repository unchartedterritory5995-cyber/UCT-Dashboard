---
id: ADR-0018
title: Per-panel error isolation, the close control outside it, and a mount cap are a STANDING INVARIANT — and they already ship
status: accepted
date: 2026-09-25 (corrected hours after first shipping)
decided_by: the programme (gate item 20)
gate_item: 20, 22
promotion: Locked, and it is a first-class REVERSAL: the same document first published this as an unmet precondition and struck it the same day against measured code. The correction is the record's whole value.
supersedes: gate item 20's own first-draft claim that per-panel error isolation was an UNMET PRECONDITION of choosing hybrid, and D-06 §1.7's *"no matches. CONFIRMED"*
superseded_by: none
register_row: DEC-01 (Workspace model)
---

# ADR-0018 — Per-panel error isolation, the close control outside it, and a mount cap are a STANDING INVARIANT — and they already ship

**STATUS: ACCEPTED** · 2026-09-25 (corrected hours after first shipping) · decided by the programme (gate item 20) · gate item 20, 22

**Why it is an ADR and not a tracker row:** Locked, and it is a first-class REVERSAL: the same document first published this as an unmet precondition and struck it the same day against measured code. The correction is the record's whole value.

**Register:** DEC-01 (Workspace model) — `12-decisions/ARCHITECTURAL_DECISION_REGISTER.md` remains the authority for that row. This ADR records only what locked after 2026-09-02 and is not in the register.

**Supersedes:** gate item 20's own first-draft claim that per-panel error isolation was an UNMET PRECONDITION of choosing hybrid, and D-06 §1.7's *"no matches. CONFIRMED"*
## Context

⚰️⚰️ **The first version of this section called per-panel error isolation an
unmet precondition of the hybrid choice**, quoting D-06 §1.7's *"grep of
`ChartsWorkspace.jsx` + `WidgetHost.jsx` → no matches. CONFIRMED"* and its *"a widget that
throws on every mount currently cannot be closed, because its header is inside the subtree that
fails."* **Both are now false**, measured directly
(`06-ux-and-information-architecture/fixed-modular-hybrid.md:260-274`).

| the superseded claim | reality in `WidgetHost.jsx`, live on production |
|---|---|
| no per-widget error boundary | **`ErrorBoundary` wraps `WidgetBody` at `:107-111`**, with a `WidgetErrorFallback` naming the widget type and `key={groupId}` so a tab swap resets a tripped boundary |
| the throwing widget cannot be closed | **The header renders OUTSIDE and BEFORE the boundary** — `WidgetHeader` at `:227` and `:254`, `WidgetBody` at `:270`. The close control survives its widget's failure |
| no mount queue | **`PANEL_MOUNT_CAP = 3`** (`ChartsWorkspace.jsx:84`) with a staggered-mount queue |
| no board cap | ⚠️ **STILL TRUE.** There is no `MAX_WIDGETS`; the bound on panels per board is geometric (`FIXED_ROWS = 20`). **Concurrent mounts are capped; board SIZE is not** |

All three landed in **one** commit on **2026-09-21** — `424bf3355`, *"S1 CP3: panel registry
formalization — registerPanel, TD-02 boundary, mount cap"* — an ancestor of
`origin/production`. **D-06 was accurate when written and is stale now** (`:276-278`).

## Decision

Commitment 3 is **not work to schedule. It is a standing invariant to protect**: any
Terminal-Next shell that composes panels must keep (a) a boundary per panel, (b) the close control
outside it, and (c) a mount cap. ⛔ **Losing any one of the three re-opens the blast-radius
objection, and the third is the one most likely to be dropped by a new shell that "just renders
the list"** (`:288-296`).

## Alternatives actually considered

1. **Schedule it as a precondition build.** Rejected on measurement — it ships.
2. **Treat it as done and stop mentioning it.** Rejected: a shipped property with no invariant
   protecting it is the thing a new shell silently drops.

## Consequences

* ⭐ **It STRENGTHENS the hybrid lock.** The original argument against composition was blast
  radius — a board fails at whatever its worst panel does, and §3 measures the modal
  board at five panels. *"That objection is already mitigated in shipped code"* (`:280-286`).
* Item 22 inherits it for AI panels specifically: *"An AI panel is the most likely to throw
  … and therefore the least acceptable place to lose the close control"*
  (`08-ai/ai-architecture.md:491`ff, §4.1).
* ⚠️ **THE LESSON, and it is why this is an ADR rather than a footnote — second
  correction of the same shape within one hour in the same document:** *"an accepted input is a
  claim about its own date. Both errors came from quoting a dated document as a live fact. The
  tell in both cases was cheap — one grep, one table lookup — and in both cases the
  correction moved the decision toward MORE confidence, not less, which is precisely why nobody
  would have gone looking."* (`:298-302`)
* ⛔ The master checklist records why this was corrected at all: **agents are dispatched with
  those rows as their brief**, so a false precondition there is an active wrong-precedent source
  (`00-program-control/MASTER_CHECKLIST.md:26`).

## Sources

- `06-ux-and-information-architecture/fixed-modular-hybrid.md:260-302`
- `00-program-control/MASTER_CHECKLIST.md:26`
- `08-ai/ai-architecture.md:491`

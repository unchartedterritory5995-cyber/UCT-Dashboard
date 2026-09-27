---
id: ADR-0023
title: Widen the auth-surface auditor to READ routes — the rail, not the four fixes — and the rail ships first
status: accepted
date: 2026-09-26
decided_by: the programme (gate item 23, DP-6: engineering, no owner input needed)
gate_item: 23, 29
promotion: Locked: it is the one engineering change item 23 argues for, explicitly marked as needing no owner input, additive, and failing closed. The ORDERING half is locked by item 29's H3 with a measurement behind it.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0023 — Widen the auth-surface auditor to READ routes — the rail, not the four fixes — and the rail ships first

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme (gate item 23, DP-6: engineering, no owner input needed) · gate item 23, 29

**Why it is an ADR and not a tracker row:** Locked: it is the one engineering change item 23 argues for, explicitly marked as needing no owner input, additive, and failing closed. The ORDERING half is locked by item 29's H3 with a measurement behind it.

## Context

`api/auth_surface_check.py:79` sets `MUTATING = {"POST","PUT","PATCH","DELETE"}` and `:248`
iterates only those, **so the boot auditor cannot see a GET**
(`09-security-licensing-cost/security-entitlement-architecture.md:64-104`). Six route families
still declare no auth dependency in master's source — `/api/stream/prices`,
`/api/gex/compare`, the three `/api/dealer-positioning/*` diagnostics, `/api/flow-scoreboard` and
`/r/*`. Two are deliberate with owner escalations open (ESC-13, ESC-06); four look like the same
omission class R-17 named.

⛔ **The GEX family was remediated once, recurred, was remediated again at `/api/gex/data`
— and `/api/gex/compare`, four lines below it in the same file, is still open**
(`:730-760`).

## Decision

1. **Widen `api/auth_surface_check.py` to audit read routes, on the existing design, and let it
   fail by name at boot** (`:730-760`).
   * Reads get their own pass with their own allowlist, because a read allowlist will be longer
     and its entries need reasons. Reuse `ALLOWED_OPEN`'s shape (`:118`): an exact
     `(method, path)` key → a **written reason**. The file already distinguishes *"checked and
     safe for a stated reason"* from *"open"* (`:41-43`), *"and that distinction is the entire
     value."*
   * ⛔ **It must be able to fire**, with a non-vacuity control proving the probe can see a
     sibling it is not looking for.
   * ⛔ **It reads the mounted route objects, never a probe** — the auditor's own
     docstring records why: a probe of a mutating endpoint once executed a real production job
     before anyone intended it.
2. **The rail ships before the fix.** Item 29's H3: **`FB-S9-02` cannot ship before `FB-S9-01`**
   — close the six dependency-less route families only *after* the auditor can see a GET.
   *"Doing the four fixes first produces a state that looks finished and is not."*
   (`10-roadmap/dependency-graph.md:68`ff, H3)

## Alternatives actually considered

1. **Fix the four routes.** Rejected as insufficient: *"A class that recurs after remediation is
   not a bug that needs fixing again; it is a missing check."* F-04's R-A6-1 says so in those
   words and item 23's §2.2 is the third data point (`:730-760`).
2. **Probe the routes at boot.** Rejected — see the docstring above.
3. **Close the routes and widen the auditor in one change.** Rejected by H3's ordering: the fix
   without the rail is indistinguishable from done.

## Consequences

* The change is **additive and fails closed**, and needs no owner input (DP-6, `:717-729`).
* ⚠️ **The four open route families are a production matter for a normal engineering
  session, not this programme's to change** — R-17's own mitigation column says exactly that
  (`:730-760`, `:761-792` point 5).
* Item 25 adds the denominator requirement for the same instrument (G-4) but takes no position on
  the fix (`10-roadmap/observability-plan.md:830`, point 6).
* Two of the six are deliberate: `/api/flow-scoreboard` and `/r/*` are ESC-13 and ESC-06, owner
  calls with a cost written down, and **A5 holds for Terminal-Next under either answer** (DP-1).

## Sources

- `09-security-licensing-cost/security-entitlement-architecture.md:64-104,436-494,717-792`
- `10-roadmap/dependency-graph.md:68`
- `10-roadmap/observability-plan.md:429,830`

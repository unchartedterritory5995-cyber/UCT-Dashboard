---
id: ADR-0022
title: One entitlement object, authored once, consulted at three points — never at the renderer
status: accepted
date: 2026-09-26
decided_by: the programme (gate item 23 / ARCH-06)
gate_item: 23
promotion: Locked as a MECHANISM with the numbers explicitly excluded. Every number in it is the owner's and the document says so eight times; the mechanism itself carries no open input.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0022 — One entitlement object, authored once, consulted at three points — never at the renderer

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme (gate item 23 / ARCH-06) · gate item 23

**Why it is an ADR and not a tracker row:** Locked as a MECHANISM with the numbers explicitly excluded. Every number in it is the owner's and the document says so eight times; the mechanism itself carries no open input.

## Context

`entitlements.py` ships four axes and one toolkit `"all"` whose three optional bounds are `None`
(`:241-249`), reading a `user["toolkit"]` key the `users` table does not have (`toolkit_for:268-275`
vs `auth_db.py`, where `grep toolkit` returns **nothing**). D-10's gap — no per-user cohort
store that any gate reads — stands unchanged
(`09-security-licensing-cost/security-entitlement-architecture.md:64-104`).

## Decision

**S9 exposes one function and one object** — `plan`, `paid_equiv`, `toolkit`, `limits`,
`dataClasses` (new, licensing-driven), `audience` (new), `cohorts` (new), `cadence`
(`:574-604`).

* ⛔ **One object, reused by every surface AND every agent**, because *"a parallel
  authorisation path is a second authority over what may this member see."* Concretely: the AI
  tool registry's per-lane allowlists must become **a function of the entitlement**, not per-lane
  constants (`:580-590`).
* ⛔ **It must not collapse the two paid families.** `comped` and the 402/403 split are
  deliberate and tested; the object returns a verdict *per data class* and the caller's refusal
  code stays the caller's (`:592-595`).
* ⛔ **The client copy is never an authority** (`:596-597`).

**Three check points, three different questions** (`:605-624`):

| # | point | question | refusal |
|---|---|---|---|
| 1 | the route | *may you be here at all?* | 401 / 402 / 403 |
| 2 | the producer | *how much of it do you get?* | `withheld`, reason from a **closed set** |
| 3 | the publication chokepoint | *may this leave the product?* | refuse to publish; fail closed |

⛔ **Never the renderer.** `entitlements.py:8-11`: *"A UI that hides rows is not entitlement
— the rows were computed, they held the GIL while a universe sweep ran, and a client can ask
for them."*

⛔ **The refusal vocabulary stays closed.** `withheld` ≠ `dropped` ≠
`not_computable` (`entitlements.py:13-18`), enforced by `ToolkitWithheld.__init__:148-151` raising
on an unknown reason. A new axis adds its token in **one** place or the coverage line that
branches on it silently mis-reports.

**And a new axis must pass a four-part test**, derived from the shipped history ruling rather than
invented (`:626-657`): it narrows the **question**, never the **answer** (*"nobody is sold a worse
RSI"*); it is applied where breadth is **produced**, never where it is displayed; its refusal is a
**declared outcome** with a token in the closed set; and its number lives in **exactly one table**
(`TOOLKITS`), referencing a capacity bound rather than restating it.

## Alternatives actually considered

1. **Per-lane allowlists as module constants** (the shipped state). Rejected as a second
   authority (`:580-590`).
2. **Hide rows in the renderer.** Rejected in the source's own words above.
3. **Trim the answer instead of refusing.** Rejected on measurement: the history axis was kept
   **as a refusal** because the trimming alternative produced a number `pytest.approx` called
   equal to the honest one (`:626-657`).

## Consequences

* ⭐ **Point 3 does not exist yet**, and it is the point licensing actually needs. It is
  cheapest built on an existing idiom: the repo already has fail-closed publication gates whose
  default is silence — they need a second reason to consult, not a replacement (`:620-624`).
* **After ADR-0009 the tier axis collapses to a binary**, so this mechanism ships simpler than it
  was designed and should be **re-read, not rewritten**
  (`12-decisions/DECISION_CARDS_2026-09-26.md:255-258`).
* ⚠️ **It depends on ARCH-04's provenance field (R-A4-1). If provenance does not ship,
  `dataClasses` and `audience` have nothing to read** (`:602-604`, DP-8).
* ⭐ A per-request role-derived cohort rung **already ships** on the auth payload
  (`auth.py:214` `_ADMIN_ONLY`, resolved `:253-263`, spread at `:375`) — rung 1 of the
  dark-launch ladder, free to Terminal-Next. **Cohorts are not tiers** (`:64-104`, §3.4;
  ADR-0009 consequence 3).
* ⛔ **Not decided here:** tiers, plans, prices, packaging or any number in `TOOLKITS`
  (DP-2, the owner's); cohort durability (DP-3); whether a runtime kill switch is required (DP-4);
  a staff tier finer than `admin` (DP-5); which data class each surface may reach (DP-7)
  (`:717-729`, `:761-792`).

## Sources

- `09-security-licensing-cost/security-entitlement-architecture.md:64-104,279-350,570-729,761-792`
- `12-decisions/DECISION_CARDS_2026-09-26.md:250-262`

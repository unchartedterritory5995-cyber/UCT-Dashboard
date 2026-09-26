---
id: ADR-0027
title: The edge DOES cache the flow payload — and an unauthenticated probe of a gated route measures the gate
status: accepted
date: 2026-09-26
decided_by: the programme (measured on the owner's grant)
gate_item: 24
promotion: Locked: a measurement, taken twice, that settles a question two earlier readings got wrong in opposite directions — plus a general method rule the document states as binding on all future measurement.
supersedes: ADR-0026
superseded_by: none
register_row: none
---

# ADR-0027 — The edge DOES cache the flow payload — and an unauthenticated probe of a gated route measures the gate

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme (measured on the owner's grant) · gate item 24

**Why it is an ADR and not a tracker row:** Locked: a measurement, taken twice, that settles a question two earlier readings got wrong in opposite directions — plus a general method rule the document states as binding on all future measurement.

**Supersedes:** ADR-0026

## Context

Two earlier readings of `/api/flow/data` disagreed, and both were taken unauthenticated
(ADR-0026).

## Decision

✅✅ **The measurement was taken, on the owner's grant, and it settles the question the
opposite way from both earlier readings.** Two successive authenticated
`GET /api/flow/data?days=1`: **MISS then HIT**, 5,289,793 bytes, `age: 0` on the hit,
`content-type: text/csv`. `MISS → HIT` is §8's own stated success signal.
**The documented Cloudflare rule IS in effect.**
(`12-decisions/DECISION_CARDS_2026-09-26.md:329-332`)

⭐ **And the wire disagrees with the source exactly as the source predicted.** The constant
sets `max-age=0`; the wire says **`max-age=14400`** — the very override the comment at
`flow_router.py:128-130` records. **Confirmed, not inferred** (`:334-336`).

✅ **The leak hazard is tested and clear.** A fresh context with **zero cookies**, twice, after
the cache was populated: **401, 30 bytes, a JSON refusal, `BYPASS`** both times. The edge does not
serve the cached object to a caller without the credential (`:338-342`).

⚠️ **Measured behaviour, not a read of the cache-key configuration** — so it is
correct for a reason nobody has established, and a rule edit could change it silently
(`:342`).

## The general rule, stated because it will recur

⚠️ **An unauthenticated probe of a gated route measures the gate.** Any future latency or
cache measurement against a paid surface either **authenticates first or declares that it did
not** (`:349-351`; `07-technical-architecture/realtime-performance-architecture.md:568-588`,
§5.3).

## Alternatives actually considered

1. **Accept the unauthenticated reading.** Rejected — it produced two opposite conclusions in
   one day.
2. **Read the cache-key configuration instead of measuring.** Not done, and the gap is named:
   ⛔ *"That stays worth one dashboard read. It is a durability question, not an incident."*
   (`:380-384`)

## Consequences

* ⭐⭐ **What survives is a FRESHNESS defect, not a security one**: a four-hour browser
  TTL on a 5.3 MB live options tape, overriding an origin that deliberately said `max-age=0`. The
  edge revalidates every 60 s; the member's browser does not, for four hours
  (`:344-347`). Acted on by ADR-0028.
* ⛔ **Gate the edge on the credential question, not on the performance question.** *"The
  cheapest high-value measurement in the programme turned out to be the one most easily misread,
  and the misreading pointed at a change that could re-open the product's largest historical data
  leak."* (`realtime-performance-architecture.md:568-588`)
* Item 24's D6 row is therefore **moot as written**: its options were "status quo" vs "apply the
  rule", and neither describes reality (`:542-567`).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:329-352`
- `07-technical-architecture/realtime-performance-architecture.md:121-160,161-252,568-588`

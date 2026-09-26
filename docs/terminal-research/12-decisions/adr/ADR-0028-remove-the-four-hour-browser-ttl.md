---
id: ADR-0028
title: Remove the four-hour BROWSER TTL on the flow tape; keep the edge cache
status: accepted
date: 2026-09-26 (ruled and EXECUTED the same day)
decided_by: the programme under owner delegation, then executed
gate_item: 24
promotion: Locked AND SHIPPED — the only executed infrastructure decision in this set. It also carries its own correction: the ruling's diagnosis of WHERE the override lived was wrong, and the error was caught before the change because the thing was read before it was changed.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0028 — Remove the four-hour BROWSER TTL on the flow tape; keep the edge cache

**STATUS: ACCEPTED** · 2026-09-26 (ruled and EXECUTED the same day) · decided by the programme under owner delegation, then executed · gate item 24

**Why it is an ADR and not a tracker row:** Locked AND SHIPPED — the only executed infrastructure decision in this set. It also carries its own correction: the ruling's diagnosis of WHERE the override lived was wrong, and the error was caught before the change because the thing was read before it was changed.

## Context

`/api/flow/data?days=1` shipped `Cache-Control: public, max-age=14400, s-maxage=60,
stale-while-revalidate=600` on the wire while the origin constant (`api/flow_router.py:132`) sets
**`max-age=0`** (`12-decisions/DECISION_CARDS_2026-09-26.md:359-362`). The edge cache itself was
confirmed working (ADR-0027).

## Decision

**Keep the edge cache. Remove the browser-TTL override. Let the origin's `max-age=0` through.**
Three reasons, in order of weight (`:364-378`):

1. ⭐ **The origin's author already made this decision and wrote down that it was being
   overridden.** *"A rule silently overriding a deliberate, commented instruction is the
   second-authority-over-one-value defect this repo has paid for with three separate outages.
   Remove one authority, and the code is the one that ships with a reviewer attached."*
2. **`s-maxage=60` already delivers the whole performance win.** The four-hour browser TTL adds
   nothing measurable and costs freshness.
3. ⛔ **Four hours is wrong for this payload in particular.** The origin stamps
   `X-Flow-Version` precisely so a client can *detect* a stale body — and
   **detection is not freshness.**

## ⚰️ The correction: CARD 20's diagnosis of WHERE was WRONG

**CARD 20 said a Cache Rule was rewriting the browser TTL. It was not.** Read in the dashboard:
the rule matching `/api/flow/data` (and `/api/flow/indexes-data`) set only **Eligible for cache**
and **Edge TTL**, with Browser TTL **unset**. The `max-age=14400` came from the **zone-wide Browser
Cache TTL setting** under Caching → Configuration, set to **4 hours**
(`:585-588`).

⛔⛔ **That materially changed the fix and is why it was read before it was changed.**
Changing the global would have altered **every response on the domain**. Instead one action was
added to the existing rule — **Browser TTL → Respect origin TTL** — scoping the
change to those two paths. Cache eligibility and the existing 1-minute Edge TTL override were left
untouched, which is why the edge cache survived (`:590-594`).

⭐ **This is the house pattern, not an invention:** the other three cache rules
(`/api/bars-history/`, `/api/ticker-logo/`, `/api/bars-today-pack`) already set Browser TTL
per-path for exactly this reason (`:596-598`).

## Measured, before and after

| | before | after |
|---|---|---|
| `Cache-Control` browser lifetime | `max-age=14400` | **`max-age=0`** |
| 2nd request `cf-cache-status` | HIT | **still HIT** |

(`:580-583`)

## Alternatives actually considered

1. **Change the zone-wide setting.** Rejected once read — blast radius is every response on
   the domain.
2. **Turn off the edge cache too.** Rejected: `s-maxage=60` is the performance win and removing it
   buys nothing.
3. **Leave it and rely on `X-Flow-Version`.** Rejected — detection is not freshness.

## Consequences

* ⚠️ **STILL OPEN, deliberately unchanged: the zone-wide 4-hour Browser Cache TTL
  remains.** Any other route whose origin asks for a shorter browser lifetime is presumably being
  raised the same way. **Two responses were measured; the blast radius was NOT**, so no claim is
  made about how many routes are affected — only that the mechanism exists. Evidence it
  behaves as a **floor** rather than an override: hashed static assets still carry
  `max-age=31536000` on the wire (`:600-604`).
* ⚠️ **What this does NOT rule:** whether the edge should cache a gated payload at all.
  It measurably does not leak, but that is measured behaviour, not a read of the cache-key
  configuration (`:380-384`).
* Item 24 bars any further edge change until the existing rule and the cache key are read
  (`07-technical-architecture/realtime-performance-architecture.md:589-604`, point 3).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:355-390,576-605`
- `07-technical-architecture/realtime-performance-architecture.md:121-160,589-604`

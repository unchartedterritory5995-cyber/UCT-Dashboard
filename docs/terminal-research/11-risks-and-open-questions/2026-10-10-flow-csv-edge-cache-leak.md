---
id: RISK-2026-10-10-FLOW-EDGE-CACHE
title: The paid Options Flow CSV was served to anonymous callers from the Cloudflare edge
date: 2026-10-10
status: closed for /api/flow/data and /api/flow/indexes-data; open (known, owned) for chart bars
---

# Paid flow CSV served from the edge to anyone (TERM-008)

## What was found

Read on 2026-10-10 in the owner's Cloudflare dashboard (TERM-008, decision T-5 / owner action B2).
Cache Rule 1, "Options Flow CSV — cache at edge", matched `/api/flow/data` and
`/api/flow/indexes-data` with **Eligible for cache**, **Edge TTL: ignore cache-control and use a
fixed TTL**, and the default cache key (no cookie, no header). The origin answers those paths only to
a signed-in member (anonymous: `401 {"detail":"Not authenticated"}`), but a member's 200 is
`Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=600`.

Measured, in this order:

1. Anonymous `GET /api/flow/data`: `401`, `cf-cache-status: BYPASS`.
2. One signed-in member `GET /api/flow/data`: `200`, 14,299,826 bytes, `cf-cache-status: MISS`.
3. Anonymous `GET /api/flow/data` straight after: **`200`, 14,299,826 bytes, `cf-cache-status: HIT`,
   `Age: 5`**.

So for as long as the rule stood, anyone who asked within the cached window after any member got
the whole paid flow tape without signing in.

## What was changed

Rule 1's cache eligibility was set to **Bypass cache** (the rule stays in place, so it is one
radio button to undo). Re-measured after the change: a member gets `200` with
`cf-cache-status: DYNAMIC`; anonymous `/api/flow/data` and `/api/flow/indexes-data` get `401`
with `cf-cache-status: DYNAMIC`. The browser still keeps its own copy per the origin headers.

Browser Cache TTL (zone, Caching > Configuration) already read **Respect Existing Headers** when it
was opened, last changed about a minute before; nothing was changed there.

## What was looked at and left alone

Rules 2 (`/api/bars-history/`) and 4 (`/api/bars-today-pack`) show the same shape: a member's 200
is `public`, and an anonymous request after it is a `HIT`. They were set to Bypass for a few
minutes and then **restored exactly** (rule 2: Eligible for cache, Respect origin TTL; rule 4:
Eligible for cache, Edge TTL "use cache-control header if present, default TTL if not", Respect
origin TTL), because:

- `/api/bars/{ticker}` already answers anonymous callers today through the `bars-edge-router`
  Worker. That is known and owned: `api/chart_edge_token.py` is Phase 1 of the chart edge
  entitlement token (mint only, the Worker verifies in shadow). Bypassing the history cache would
  remove the edge performance the chart programme is built on while closing nothing that
  `/api/bars` does not already expose.
- Daily OHLC bars are not the paid product the way the flow tape is.

The chart edge-token programme should treat rules 2 and 4 as in scope for its enforcement phase.

## Cost of the change

Every member load of the flow CSV now reaches the origin (flow proxy to flow-worker) instead of
the edge within its 60 s window. Watch flow-worker and web response times during the 2026-10-14
market-hours window (TERM-007).

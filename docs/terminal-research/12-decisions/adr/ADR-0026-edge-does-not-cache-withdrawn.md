---
id: ADR-0026
title: The origin sends no `Cache-Control`, so Cloudflare defaults to BYPASS; the fix is a response header
status: withdrawn
date: 2026-09-26 (published and withdrawn the same day)
decided_by: the programme (Protocol D / CARD 19)
gate_item: 24
promotion: Promoted as a WITHDRAWN record. It was published, it named a fix, and that fix could have re-opened the product's largest historical data leak. An ADR set that shows only the correction cannot stop it being re-proposed.
supersedes: none
superseded_by: ADR-0027
register_row: none
---

# ADR-0026 — The origin sends no `Cache-Control`, so Cloudflare defaults to BYPASS; the fix is a response header

**STATUS: WITHDRAWN** · 2026-09-26 (published and withdrawn the same day) · decided by the programme (Protocol D / CARD 19) · gate item 24

**Why it is an ADR and not a tracker row:** Promoted as a WITHDRAWN record. It was published, it named a fix, and that fix could have re-opened the product's largest historical data leak. An ADR set that shows only the correction cannot stop it being re-proposed.

⛔⛔ **SUPERSEDED BY ADR-0027 — DO NOT ACT ON THIS RECORD.** It is kept, with its reasoning intact, because deleting it is how the next engineer re-proposes it.

## Context

Protocol D probed `/api/flow/data` and recorded `content-type: application/json`,
`cf-cache-status: BYPASS`, no `Cache-Control`.

## Decision as taken (FALSE AT THE FIRST STEP)

*"The origin sends no `Cache-Control` at all, so Cloudflare has no instruction and defaults to
BYPASS; the fix is a RESPONSE HEADER, not a dashboard rule."*
(`12-decisions/DECISION_CARDS_2026-09-26.md:288-290`)

⛔ **Withdrawn rather than amended** (`:290`).

## Why it was wrong

* `/api/flow/data` is gated — `Depends(require_flow_user)` — so an unauthenticated probe
  gets **401**, and a 401 carries no cache header. Two reads at 02:0xZ confirm: `HTTP/1.1 401`,
  `content-type: application/json`, `cf-cache-status: BYPASS`, no `Cache-Control`. That is an exact
  match for what Protocol D recorded **except for the status** — and the recorded
  `application/json` could not have come from this route at all, because **it serves `text/csv`**
  (`:292-298`).
* ⭐ **The header exists.** `api/flow_router.py:131-134` sends
  `public, max-age=0, s-maxage=60, stale-while-revalidate=600`, merged into every successful
  response at `:466`, and the web-side proxy forwards it (`flow_proxy.py:184-190`) (`:300-302`).

## ⛔⛔ Why withdrawing it mattered more than a cache miss

The router's own docstring (`:17-20`) records that before the 2026-08-19 gate,
`GET /api/flow/data` *"answered an anonymous caller with 3.07 MB of the firm's options-flow tape
— the single largest raw-data leak in the product."* Cloudflare's default cache key is the
URL, not the session, and the shipped header says `public`. **Turning this path into a cache HIT
without first reading the zone's cache key could have served the paid tape to an anonymous caller
from the edge** (`:320-326`).

## Consequences

* Superseded by ADR-0027, which settles the question the opposite way on an authenticated read.
* ⭐ **The surviving half is a better instrument than the original** — three reads in the
  same minute establish that `DYNAMIC` and `BYPASS` are different Cloudflare states, so the flow
  path was **not** at the default and a rule had demonstrably acted on it
  (`:304-318`).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:286-352`
- `07-technical-architecture/realtime-performance-architecture.md:77-120,253-279`

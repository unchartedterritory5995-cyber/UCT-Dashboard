# ADR-003 — Options flow and dark pool for the Agent: a safety assessment (DRAFT)

- **Status:** DRAFT, 2026-11-01. A read-only spike: no code, no kinds, no flags, no production access.
- **Author:** agent-md. **Decider:** agent-lead (the owner for anything touching flow-worker).
- **Scope:** MD-1 §4 deferred `flow.summary` and `darkpool` until this spike. This ADR answers two questions:
  1. Can a **web-side** read reach options-flow data through the flow proxy, without importing `flow_router` and without touching flow-worker?
  2. Does dark pool have a **trustworthy `as_of`**?

## Findings — options flow

**1. Where the data is.** After the P5 cutover, the Massive OPRA consumer and `flow.db` run on **flow-worker**. Web's `/data/flow.db` is a frozen pre-cutover copy. So importing `flow_router` or `flow_db` on web reads stale data, and must never be done (ADR-001).

**2. The flow proxy is an HTTP reverse proxy, not a Python read API.** `api/flow_proxy.py` registers catch-all routes on web for the flow-family prefixes (`/api/flow`, `/api/notable-flow`, `/api/dealer-positioning`, `/api/oi-snapshot`, `/api/liveflow`, `/api/live/massive`, …). It forwards **member** requests to `WORKER_INTERNAL_URL` over Railway private networking, vouching for the member with an HMAC-signed header.
- Fully gated: `FLOW_READS_PROXY_ENABLED=1` **and** `WORKER_INTERNAL_URL`.
- Honest failure: an upstream error is a 502, never a stale local answer.

**3. A server-side read path already exists and is the established pattern.** Several web services read flow-worker directly over `WORKER_INTERNAL_URL`, each with a short timeout and fail-soft behaviour:
- `catalyst/sources.py` (`/api/flow/top-conviction`);
- `options_analytics/market_tide.py`;
- `data_exports.py`, `routers/signature.py`, `routers/ai_search.py`.

They authenticate with the **service** credential `flow_proxy.internal_read_headers()` (the PUSH_SECRET bearer that `require_flow_user` accepts), never a member's cookie. They open **no** new upstream connection: each call is an ordinary HTTP request to flow-worker, which already serves these routes. They add **no** Massive connection.

**So the answer to question 1 is yes, in principle,** through that pattern. It is not through the member proxy routes, and never through `flow_router`. ⚠️ **Not verified live:** this spike had no production access. "The data is really there from web" has not been measured, and MD-1 §4 makes that a precondition. The verification is one owner-run, read-only call from web (`GET {WORKER_INTERNAL_URL}/api/flow/top-conviction?limit=1` with the service bearer), with its status code and payload `as_of` recorded.

**4. The canonical layer to wrap is `options_analytics`, not the raw tape.** `options_analytics/market_tide.py` already does the honest work:
- the tape's own filters are stated on every answer (50+ contracts, $10K+ premium);
- a failed source is named and the answer is `partial`, never a quiet tape;
- the session is today's once the session opens, labelled `prior_session` otherwise;
- `computed_at` is separated from how far the tape runs.

It is dark (`OPTIONS_MARKET_TIDE_ENABLED`, default off) and builds off the request path with stale-while-revalidate. A future `flow.summary` kind should be a thin adapter over it, the way `breadth.current` wraps `breadth_current`.

**5. Time semantics are available.** Each print carries its own `CreatedTime`, the data's time. MD-1 `as_of` = the newest print in the window, freshness `periodic` or `delayed` as the tape reports, and **never `live`**. The tape has known gaps: Massive OPRA does not replay a dropped socket, so a gap stays until the T+1 flat file. The envelope must say "the tape may have gaps until T+1", and a session whose gap-fill has not run must not be presented as complete.

**6. Risks if this goes ahead.**
- **Load on flow-worker.** Agent reads would hit flow-worker's tape reads. Use the cached `options_analytics` builds, and never `/api/flow/data` per Agent turn (a one-day tape is a large CSV).
- **No restart or deploy of flow-worker is needed or allowed.** Everything here is reads against existing routes.
- **Budget.** One internal HTTP read counts as 1 `provider_call` (it can miss the service cache and read the tape).
- **Model-data question.** Flow figures are UCT-computed (signed premium, conviction). Whether they are model-visible or **model-isolated** like breadth and ratings (MD-1 §4.4, ADR-005) is an owner decision, and it must be made before implementation.

## Findings — dark pool

**7. Where the data is.** `darkpool.db` is **web-local**. The flow proxy deliberately excludes `/api/darkpool`. So no proxy is involved, and `api/darkpool_db.py` / `darkpool_aggregator.py` are read on web.

**8. Each print has a trustworthy time; a SUMMARY does not.** The rows carry `Date` + `Timestamp`. The flat-file ingest takes the SIP timestamp (`sip_timestamp`, else `participant_timestamp`), which is the trade's own time. But the store is fed by **three paths with different coverage**:
- a CSV seed;
- the per-ticker Massive ingest (an intraday poller plus a 19:20 ET nightly), which covers a **ticker universe only**;
- the all-symbols T+1 flat file (about 11:00 ET the next day).

So the newest print's time says nothing about whether that session is **complete**. Today's prints are a universe-only partial view until the next morning.

**9. There is no durable coverage ledger.** `darkpool_flatfile_ingest` keeps its run state in memory (`_run_state`), and it resets on every deploy. Nothing durable records which sessions have been ingested all-symbols versus universe-only. The aggregator's cache key (`row_count`, `max_id`) records change, not completeness.

**So the answer to question 2 is: per print, yes; per session or summary, no.** A dark-pool answer would carry an honest `as_of` but could not honestly say whether the session it describes is complete. That is exactly the "a quiet tape that is really a missed ingest" failure MD-1 exists to prevent.

## Recommendations

1. **`flow.summary`: feasible, NOT YET.** Prerequisites:
   - (a) the owner-run read-only probe from web (finding 3);
   - (b) the owner's model-visibility decision (finding 6);
   - (c) agent-lead's approval of a thin adapter over `options_analytics`, using the service bearer and the existing internal-read pattern.

   The adapter must state the tape filters, report `partial` for a failed source, say "gaps possible until T+1", and never be `live`. It needs no flow-worker change, restart or deploy.
2. **`darkpool`: DEFER.** The prerequisite is a **durable per-session coverage ledger** in the dark-pool service (e.g. `{session, source: universe|flatfile, completed_at}`), owned by the dark-pool owner, not the Agent. Once it exists, the envelope can state `as_of` = newest print and `coverage` = universe-only vs complete. Until then, a member asking about dark pool gets "unavailable for the Agent", never a summary that might be partial.
3. Neither kind is added to MD-1 by this ADR. MD-1 §4's deferred note stays as it is until a decision here is accepted.

## What this spike did NOT do

- No production read, no flag, no connection, no flow-worker interaction.
- No measurement of flow-worker read latency or load.
- No legal or licensing review of displaying flow or dark-pool data through the Agent.

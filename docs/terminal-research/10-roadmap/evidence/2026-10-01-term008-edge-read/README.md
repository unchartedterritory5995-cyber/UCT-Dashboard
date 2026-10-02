# TERM-008: the edge, read on the wire (2026-10-02 00:48Z)

Read-only. `authenticated-headers.json` is the authenticated pass as smoke@ (headers only, no bodies).

## Finding: the paid options-flow tape is served to ANONYMOUS callers from the edge

| request | status | cf-cache-status | body |
|---|---|---|---|
| smoke@ `/api/flow/data?days=1` | 200 | EXPIRED then HIT | CSV |
| anonymous `/api/flow/data?days=1` (same URL, right after) | **200** | **HIT** | **CSV: `CreatedDate,CreatedTime,Symbol,Type,Volume,Price,Side,CallPu...`** |
| anonymous `/api/flow/data?days=20` | **200** | **HIT** | **CSV** |
| anonymous `/api/flow/data?days=1&_cb=<random>` (cache-busted) | 401 | BYPASS | JSON refusal |

The ORIGIN is closed (`require_flow_user`, since 2026-08-09; the cache-busted row proves it). The
EDGE is not: the Cache Rule "Options Flow CSV - cache at edge" (read by the owner 2026-09-26, roadmap
RM-N07) keys on the URL only, with no cookie, so a body fetched by any member is served to anyone who
requests the same URL for the rule's 1-minute edge TTL plus `stale-while-revalidate=600`. The member
page requests `/api/flow/data?days=1&v=<version>`, a guessable URL.

`api/flow_router.py`'s own header has recorded this residual since 2026-08-09 as an owner dashboard
action; it was never taken. This read is the first that shows it serving the tape on the wire.

Exposure: the firm's options-flow tape (OPRA-derived prints) to the public internet. That is a paywall
leak AND a redistribution question under the data licence.

## The fix is at the edge (owner's Cloudflare credential)

Fastest: in the rule "Options Flow CSV - cache at edge", change the expression to

    ((http.request.uri.path eq "/api/flow/data") or (http.request.uri.path eq "/api/flow/indexes-data"))
      and http.cookie contains "uct_session="

A request with no session cookie then falls to the origin, which answers 401. Members still share the
edge copy. Residual: a caller who sends any `uct_session=` value still matches; closing that fully is
the edge-verified entitlement token the bars Worker already uses in shadow mode (`api/chart_edge_token.py`).

Stop-gap with no dashboard access: disable the rule (members then hit the origin; it carries the 60 s
s-maxage herd protection only inside Cloudflare's default, which does not cache this extension-less path).

## Other rows

- `/api/health`, `/api/bars/SPY` and `/` are DYNAMIC (not edge-cached). `/api/bars` sends `no-store`.
- Hashed assets: `public, max-age=31536000, immutable`, MISS then HIT. Correct.
- The zone-wide 4-hour Browser Cache TTL was NOT measured to bite: every route read here sends its own
  Cache-Control, so the zone default is overridden on all of them.

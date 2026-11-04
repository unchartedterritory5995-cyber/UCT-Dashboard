# UCT Agent — the per-turn dollar cap (planner v1)

Owner-approved 2026-11-04. Code: `api/services/uct_agent/budget.py` (`reserve`, `Meter`), call sites in
`api/services/uct_agent/turn.py`. Tests: `tests/test_uct_agent_turn_cap.py`. Planner v2 (`turn_v2.py`) keeps its
own in-loop check and reads the same switch.

## What is enforced

One **member request** may commit at most `UCT_AGENT_TURN_USD` (default **$0.25**; 0, blank or garbage mean the
default, never "unlimited"). A request is everything the browser sends for one message: the planner call, a schema
retry, the server repair (false-capability claim / NL-1 plan repair), the research lookup, the post-research call,
the browser's reroute (`need_groups`) and repair of the same message, the background chat-naming call, and E-1's
evidence classifier where that branch is merged (its `counts_as_call=False` calls still count dollars).

Before **every** paid call, `reserve()` runs one `BEGIN IMMEDIATE` transaction on the Agent ledger and admits the call
only if

    request's settled actuals + request's open reservations + this call's worst case <= $0.25
    day's settled actuals + day's open reservations + this call's worst case <= $5   (unchanged)

Both sums run in the same transaction, so two calls racing (two turns from one member, a reroute against a naming
call) cannot both fit in the same headroom. After the call, `settle()` replaces the reservation with the actual cost.

| outcome of the call | charged to the turn |
|---|---|
| reply with usage (including `stop_reason: max_tokens`) | actual usage at the repo price table |
| provider error response before any stream started (nothing generated) | released, $0 |
| stream dropped or errored after `message_start` reported input | reported input + `max_tokens` of output (never released) |
| timeout / dropped connection / reply without usage | the full worst case |
| settle itself failed / process died | stays reserved at the worst case |

A refused call is **never made and never shortened** (`max_tokens` is not lowered to fit). The member gets a fixed
sentence: `TURN_CAP_FIRST` when nothing of the request has run yet ("nothing was sent and nothing changed"), otherwise
`TURN_CAP_LATER` ("I stopped before finishing it. Nothing was changed."). The
v1 server never applies an op itself; ops reach the browser only in a returned envelope, so a refused call can never
leave an op half-reported. Optional steps are checked up front and skipped honestly instead of failing late: the
server repair is skipped if the repair call cannot fit (the first plan is served through the usual checks), and
research is skipped with `RESEARCH_TURN_CAP` unless the lookup **and** the call that reads it both fit (a mixed
request keeps its planned change). After the lookup, the REAL results are measured before the call that reads them
is reserved; if they do not fit, the turn ends with `RESEARCH_UNREAD_TURN_CAP` (the lookup ran and is paid; nothing
from it reaches the reply) instead of a late refusal. The naming call is a nicety: refused, the chat keeps its
first-message name. A refused NL-1 browser repair is not written to the transcript: the browser ignores a failed
repair and serves its first plan, so the stored chat matches what the member saw.

## Worst case per call (Haiku 4.5: $1 in, $1.25 cache write, $5 out per MTok — `narrative_cost_guard._PRICES`)

Model call: `(UTF-8 bytes of system + messages + 2 x output schema + 4000 framing) x cache-write rate + max_tokens x
output rate`. The schema is counted twice because the provider renders a structured-output schema into the prompt as
well as constraining the reply with it. A token is never shorter than a byte, and the 1.25x cache write is the dearest way input is billed
(a block asking for the 1-hour cache is priced at 2x).

| call | max_tokens | measured request | worst case |
|---|---|---|---|
| planner / reroute / repair / schema retry / post-research | 2048 ($0.0102) | 56-61 KB (golden manifest, empty chat) | $0.085-0.091 |
| same, at the request limits (24 KB context, 12 history turns, 2000-char message) | 2048 | 130-135 KB | $0.178-0.184 |
| chat naming | 64 | <= 7.4 KB | <= $0.015 |
| research (Perplexity sonar-pro) | 600 | 4000-token allowance | 4 attempts x ($0.012 + $0.009 + $0.006 fee) = $0.108 |

Because each reservation settles before the next call starts, a normal two-call turn needs only one worst case of
headroom at a time (call 1 settles at its real cost, typically a few cents).

## Limits of the guarantee (read before relying on it)

### Paths the cap does not bound

1. **An actual cost above its reservation is kept.** If a byte bound's assumptions fail (below), `settle()` records the
   real figure and logs it; it is never hidden or clamped. That one turn can then end above $0.25 (later calls of the
   turn see it and are refused).
2. **Perplexity's per-request fee tiers.** The research bound uses the repo's lowest fee ($0.006); higher search-context
   tiers bill up to $0.014, and the settle uses the $0.006 fee, so on a higher tier up to $0.008 per attempt would go
   **unrecorded** (not caught by case 1). It cannot happen today: the request sends no `search_context_size`, so
   Perplexity bills the default low tier. Setting that parameter requires raising the fee constant first.
3. **Planner v2, v2 resume and scripts** carry no request id and are not capped here (v2 checks its own turn in the loop).

Research retries and missing usage are no longer an unbounded path: `web_search` reports how many requests it sent
and whether usage came back, and `Meter.research` keeps the WHOLE reservation (4 attempts' worst case) whenever there
was a retry or no usage. Only a single attempt with usage settles at its reported cost. A reservation still open
after 15 minutes (a process that died mid-call) is settled at its worst case by a bounded sweep (200 rows per
reservation transaction), never released.

### Assumptions

* **Not a provider guarantee.** The Messages API has no per-request dollar ceiling. The bound rests on: tokens <=
  bytes + 4000 framing; billed output <= `max_tokens` (thinking included); the repo price table being right; no
  server tools, data-residency or long-context multipliers on these requests (v1 uses none). Within those
  assumptions the $0.25 holds; it is not an absolute guarantee. Under the bytes + 4000 assumption:
  * the provider's own framing (role markers, any schema rendering beyond the second copy counted) is assumed
    to fit in 4000 tokens;
  * the 12 KB research-result allowance used by the research PRE-CHECK is not a bound (a non-ASCII answer or long
    citation URLs exceed it). It only decides whether to start the lookup: the real results are measured before the
    follow-up call, and that call's own reservation is exact, so the cap still holds; the cost of exceeding the
    allowance is a paid lookup whose results are not read (`RESEARCH_UNREAD_TURN_CAP`).
* **Research is a different provider.** Its bound and its settled cost both come from `perplexity_search._PPLX_PRICES`
  and `PPLX_REQUEST_FEE_USD` ($0.006); see "Paths the cap does not bound" for the fee tiers.
* **Conservative by design.** Bytes-as-tokens overstates input about 3-4x, so a request can be refused while its real
  cost would fit. On Haiku 4.5 no request inside the current size limits is refused at its first call. On a dearer
  planner model (for example Sonnet 5.5 at $2/$10) a request at the size limits reserves about $0.36 and **would be
  refused**; switching models needs either a higher `UCT_AGENT_TURN_USD` or an exact pre-call input count (the free
  token-counting endpoint, one extra round trip) in place of the byte bound.
* **Research on long chats.** Research runs only if the lookup ($0.108 worst) and the call that reads it (its
  request + a 12 KB allowance for the results) both fit. A typical request (golden manifest, short chat) fits even
  after a cache miss (tested); a request near the size limits does not, and is told `RESEARCH_TURN_CAP` instead.
* A timeout is charged at its worst case, so it can stop the rest of that turn even though less was spent.
* Ledger rows written before this change carry no request id; requests in flight at deploy time are capped only from
  their next call on.
* Requests with no request id (scripts, planner v2, v2 resume) are not turn-capped here; v2 caps its own turn.

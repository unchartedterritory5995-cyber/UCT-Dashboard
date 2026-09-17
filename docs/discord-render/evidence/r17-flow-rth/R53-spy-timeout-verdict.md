# R53 — the SPY `/flow` timeout: verdict, and where the fix belongs

**The 14:00:07–14:00:38Z log window the directive names is GONE.** Railway's retention on this
service is ~35 minutes (measured); by the time R53 was reachable it was 3 h 13 m old. What
follows is built from the line captured *inside* retention on the day, plus source. Said plainly
rather than reconstructed — an absence is only evidence if the instrument could have seen a
presence.

## The chain, and what each link rests on

| # | link | basis | status |
|---|---|---|---|
| 1 | The member's reply was the pre-V2 catch-all, not a partition miss | `discord_interactions.py:246-255` — `not ok` → *"the flow feed is reconnecting"*; ok-but-empty → *"no significant options flow"* | **ESTABLISHED** |
| 2 | The read TIMED OUT at 30 s | `[flow] fetch failed SPY (30): timed out`, captured 14:00:37,886Z — 30.1 s after the 14:00:07,740Z ack, against `timeout_s: float = 30.0` | **ESTABLISHED** |
| 3 | The timeout is on flow-worker's `ticker-flow`, not on web | `run_flow_card_job` does `httpx.get(f"{base}/api/live/massive/ticker-flow", params={symbol, days, source, cid}, timeout=timeout_s)` with `base = WORKER_INTERNAL_URL`; the `httpx.TimeoutException` arm sets `flow_timeout` / *"no answer in 30s"* | **ESTABLISHED** |
| 4 | The query ran in the **stocks** partition | `discord_interactions.py:499` calls `run_flow_card_job(app_id, token, tkr, days)` with **no `source`**, so the signature default `source: str = "stocks"` applies. V2's `commands.py:579-584` computes `symbols.flow_source(tkr)` and passes `etfs`. | **ESTABLISHED** |
| 5 | SPY has nothing to find there | `symbols.flow_source`'s own docstring: *"asking `stocks` for SPY answered 'no significant options flow' — 0 contracts against 182 under `etfs` on 2026-09-13."* | **ESTABLISHED (quoted)** |
| 6 | The work is proportional to the 30-day **stocks** tape regardless | `_compute_ticker_flow` → `_build_by_contract(today, se, 1, True, lookback, only_ticker=sym)` with `lookback=30`, `se="stocks"` — the filter is `only_ticker`, applied to a 30-day aggregation | **ESTABLISHED** |
| 7 | That scan crossed 30 s between 09-13 and 09-17 as the tape grew | the same query **returned** on 09-13 (fast enough to count zero) and **timed out** on 09-17 | ⚠️ **INFERRED — two points, not a measured rate** |
| 8 | flow-worker's index coverage for `(source, symbol, date)` | — | ⛔ **NOT MEASURED.** Needs a read-only query-plan check on flow-worker. |

⭐ **Links 1–6 are enough to act on; link 7 is not needed for the fix.** Whatever the growth
curve is, asking the **stocks** partition for an **ETF** is doing a 30-day scan to return an
answer that is empty by construction. It is wasted work in the best case and a member-visible
failure in the worst, and it is wrong on the day it is fast.

## ⭐ THE FIX IS ON WEB, AND THE DIRECTIVE PREDICTED IT

R53: *"if the fix is on web (the pre-V2 dispatch passing no source, so ETFs are read from the
stocks partition), fix it in the pre-V2 path."* That is exactly link 4. The pre-V2 dispatch
should pass `symbols.flow_source(tkr)` — the same classifier V2 already uses — so `/flow SPY`
reads `etfs` and answers with the 182 contracts that are there.

It is one argument at `discord_interactions.py:499`, with:
- a **rail**: `/flow` on an ETF underlying resolves `source="etfs"` and on an equity resolves
  `"stocks"`, asserted at the call site, not in a harness that restates it;
- a **mutation**: the argument dropped → RED;
- and the **non-vacuity** half: an equity must still read `stocks`, or a rail that pins
  everything to `etfs` passes for the wrong reason.

⛔⛔ **IT IS NOT BEING MERGED IN THIS SESSION, AND THAT IS A STOP CONDITION, NOT A JUDGEMENT
CALL.** D-14's stop conditions — carried forward verbatim by D-15 ("STOP CONDITIONS unchanged
from D-14, plus…") — include **"a second master push"**. This session's one master push was the
owner-directed D-15 merge (`e50c0552d`). R53 says *"merge under R36"*, and R36 cannot repeal a
stop condition D-15 restates in the same breath. So the fix is built and pushed **on a branch**,
and the merge is the owner's word or the next session's first act.

⚠️ **Members are failing today, and this is the honest cost of that rule.** `/flow` on any ETF or
index underlying has been returning *"the flow feed is reconnecting — try again in a moment"* —
advice that cannot work — for at least four days. The rule is still right: two master pushes in
one session is what produced the 2026-09-12 502 and the lost sampler row. But the cost is real
and belongs in the report rather than buried.

## What R53 still owes, read-only

- flow-worker's own logs for a **fresh** `/flow SPY` (its retention is its own; the 14:00 window
  is gone, a new one can be made whenever the owner wants it).
- the **query plan** on flow-worker's `flow.db` for the `(source, symbol)` predicate — link 8.
  `/api/admin/flow/plan` exists for exactly this and is *"Read-only. Inspect DB size, query plan,
  and indexes on the flow table."* ⚠️ On **web** it would inspect web's FROZEN pre-cutover copy,
  not flow-worker's live one — `/api/admin/*` is not in `flow_proxy.PROXY_PREFIXES`. Reading the
  wrong database and believing it is the failure mode to avoid here.

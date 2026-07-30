# Plan: 2nd Q-pool WebSocket connection (double NBBO coverage)

**Status:** scoped, NOT started. **Blocked on** the Massive connection-limit answer (see §1).
**Owner context:** Ravi. **Service:** flow-worker (off-hours deploy only). **Date:** 2026-07-30.

## 0. Why (the problem this fixes)

Our options **trade-side classification is correct** — `massive_ws_worker.py::_classify_side`
uses the midpoint quote rule (`mid=(bid+ask)/2`; closer to ask → A, closer to bid → B; AA/BB
beyond the touch), which matches Massive's own recommended method **and** BlackBox + Unusual
Whales (benchmarked 6/9 → 9/9 vs BBS on the AAPL 335P set). Every classify path is already
freshness-guarded (`NBBO_STALENESS_NS`, default 30s) with a reclassify buffer that recovers
blank sides when a fresh quote arrives.

The failure mode is **quote coverage/freshness**, proven against BBS + Unusual Whales on 7/29:
big whale prints we drop as bid/blank are genuinely ASK per the consolidated tape —
e.g. SPCX 109P (ours all-bid / BBS+UW ask-heavy), CRWV 45C (ours blank / UW 4,641 ask vs 41 bid).
Root cause: the single Q pool caps at **950** contracts (Massive's limit is 1,000/connection),
so on busy days contracts **churn/evict every few seconds** — a fill on an evicted/churning
contract has no fresh NBBO (→ blank) or is classified against a stale-but-<30s quote on a
fast mover (→ wrong side). Massive streams the **consolidated OPRA NBBO** (correcting the old
"per-exchange" belief in CLAUDE.md §5); we're simply not holding a current quote for enough
contracts.

**A side-flip heuristic ("B/blank sweep → ASK") is NOT viable** — measured 24% correct even on
≥$5M bid sweeps, ~50% on blank. The only real fix is **coverage**: hold a fresh consolidated
NBBO for more contracts.

## 1. RESOLVED — connection limits (Massive reply, 2026-07-30)

Limits are **per asset class**, not shared across products:
- **Individual plans: 1 WS per product** (1 options, 1 stocks) — **this is our current default.**
- **Business plans: 3 per product, with up to 2 more available** (so up to 5 options WS).
- Each connection: up to **1,000 contracts**; receives the **same consolidated NBBO independently**
  (no dedup/coordination between connections). Options quotes are ~**300,000 msg/sec** firehose-wide.

Massive **confirmed the two-connection design is the correct way to scale past 1,000 contracts.**

⚠️ **NEW GATE — this is now a BILLING/PLAN decision, not a technical one:** a 2nd options connection
is **beyond our default allowance** and **requires upgrading to a Business plan (3/product) or
purchasing add-on connections.** The build cannot ship until that plan change is made.
→ **Next action: owner decides on the Business upgrade / add-on connections (cost).** Everything in
§2–§8 is ready to implement the moment we have the 2nd connection allowance.

## 2. Current architecture (as of this plan)

- **One** WS to `MASSIVE_OPTIONS_WS_URL`: connect → `auth` (API key) → `subscribe` **trades**
  (`MASSIVE_WS_SUBSCRIBE`) → `_run_session(ws)` drains messages + manages the Q pool.
- **Q pool** on the same socket: `_q_subscribed` (set, cap `MAX_Q_SUBSCRIPTIONS=950`),
  premium-weighted-LRU eviction (`_q_cumulative_premium` + `last_seen`, sorted ASC), stickiness
  (`Q_STICKY_PREMIUM`/`Q_STICKY_SEC`), fast-path subscribe on a big print, and
  `_q_pending_subscribe`/`_q_pending_unsubscribe` queues.
- NBBO lands in the **global** `_nbbo_table` (+ `_NBBO_HISTORY`); a contract occupies exactly one slot.
- Massive **enforces a connection cap** — `max_connections`-at-hello detection + a `maxconn_strikes`
  back-off ladder already exist.

## 3. The change

Add a **2nd WS connection carrying ONLY `Q.*`** (no trade stream — trades stay on connection 0).
Logical Q pool grows **950 → ~1,900**. Both connections write the shared `_nbbo_table`; no merge
conflict since each contract sits in exactly one connection.

## 4. Design decisions

1. **Overflow model, one logical pool** (recommended over hash-partition): keep a single eviction
   ordering over ~1,900 slots; add `_contract_conn: {sym → conn_id}`; route each
   `Q.subscribe`/`Q.unsubscribe` to the connection holding that contract; assign new subs to the
   least-full connection. Eviction/sticky logic is reused unchanged — the cap just becomes
   `MAX_Q_SUBSCRIPTIONS × N_conns`.
2. **Trades on connection 0 only** — the trade firehose is one subscription; never duplicate it.
3. **Eviction / sticky unchanged** — same premium-weighted-LRU + `Q_STICKY_*`, against the bigger
   cap. More slots → far less churn → sub-1s NBBO for the contracts that matter → sticky rarely bites.

## 5. Risks

- **Plan/billing** (the §1 gate) — needs a Business upgrade or add-on connection first.
- **Throughput** (confirmed by Massive): options quotes are ~**300,000 msg/sec** feed-wide. Our
  1,000-contract subscription is a subset, but a 2nd Q connection roughly **doubles inbound quote
  volume** on the single flow-worker event loop. This sharpens the event-loop risk below — validate
  the loop absorbs it (watch ping-timeout flapping + the `nbbo_age_*` histogram) before flipping to 2.
- **flow-worker event loop**: a 2nd recv loop adds CPU/memory to the single uvicorn loop — same
  surface as the ping-timeout flapping (the 45s `MASSIVE_WS_PING_TIMEOUT` + 60s stale watchdog).
  Mitigate: conn 1 is Q-only (lighter than trades); watch the event loop after enabling.
- **Auth/reconnect per connection**: conn 1 needs its own auth + backoff + `maxconn_strikes`
  ladder — reuse the connect wrapper, don't fork it.
- **Warm-start / session reset**: the Phase 2c.1 warm-start currently assumes one connection.
- **Deploy** drops both pools → warm restart; off-hours only.

## 6. Config & rollout

- New env `MASSIVE_Q_CONNECTIONS` (default **1** = today's behavior; set **2** to enable).
  Kill-switch = set back to 1 + redeploy.
- `MAX_Q_SUBSCRIPTIONS` stays **950 per connection**; total = `950 × MASSIVE_Q_CONNECTIONS`.
- Rollout: confirm limit (§1) → build behind the flag (default off) → flow-worker off-hours deploy
  → flip to 2 → watch `max_connections` errors, event-loop health, and the **`nbbo_age_*`
  histogram** (should shift toward sub-1s). Rollback = flag back to 1 + redeploy.

## 7. Implementation sketch (files / functions)

`api/massive_ws_worker.py`:
- Parameterize the connect loop → `_run_connection(conn_id, subscribe_trades: bool)`; conn 0 =
  trades + Q, conn 1+ = Q only. Launch `MASSIVE_Q_CONNECTIONS` of them under `asyncio.gather`.
- Add `_contract_conn` map; make the subscribe/unsubscribe senders route by `_contract_conn[sym]`;
  assign new subs to the least-full connection.
- Eviction picks from the logical pool; the unsub message goes to the holding connection.
- Shared `_nbbo_table` unchanged (both connections write it).
- Per-connection `q_subscribed_count` surfaced in `/status`.

## 8. Validation

- Local **mock WS** (two connections). `MASSIVE_WS_DRY_RUN` does **not** protect the prod slot
  (any local run with the prod key kicks prod off the feed — Massive allows ~1 conn/key) — test
  against a **localhost mock** per the playbook.
- After deploy: confirm NBBO coverage ~doubles, `nbbo_age` shifts sub-1s, and **re-run the BBS
  side-agreement comparison** — the SPCX/SNDK/CRWV-class contracts should classify correctly.

## Appendix: exact question for Massive

> **Subject: Options WebSocket — connection limit (per product vs total)**
>
> We're on Options Advanced + Stocks Advanced. You mentioned up to 1,000 option contracts per
> WebSocket connection. To increase our NBBO/quote coverage we'd like to open a **second options
> WebSocket connection** dedicated to the `Q` channel (another ~1,000 contracts, ~2,000 total).
>
> 1. How many concurrent WebSocket connections can we open — is the limit **per product**
>    (e.g. 3 for options, a separate 3 for stocks) or a **single total** across all products on
>    the account/API key?
> 2. If per-product: how many options WS connections are allowed? (We currently run one options
>    connection carrying trades + `Q`; adding a `Q`-only connection would make two.)
> 3. Any throughput/rate considerations running two `Q` connections in parallel (combined
>    subscription cap, message-rate caps)?
> 4. Do both connections receive the same consolidated NBBO independently, or is there any
>    dedup/coordination we should account for?
>
> We already handle `max_connections` rejections gracefully; we just want to size this correctly
> before opening the second socket in production. Thanks!

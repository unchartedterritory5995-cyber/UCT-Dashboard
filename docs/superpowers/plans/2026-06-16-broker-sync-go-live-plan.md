# Broker Sync — Go-Live Test & Deployment Plan (2026-06-16)

Status after first live test: SnapTrade account created (`UNCHARTED-TERRITORY-TEST-PYLAS`),
real Robinhood connected read-only, and the **holdings → J2 open-positions** path
proven end-to-end against an isolated DB (5 positions imported, balance resolver in
broker mode, sync_log ok). 147 broker unit tests pass.

This plan covers everything still to test and the path to production.

---

## The core insight (what the first test did and did NOT prove)

We proved the **plumbing**: creds → API → encryption → register → portal → live pull →
J2 ingestion. That's real and important.

But the first test only flowed **one shape** of live data (accounts + positions +
balances). The single biggest residual risk is **the SnapTrade API contract itself**:

- The adapter (`snaptrade_adapter.py`) hard-codes ~25 assumptions about live SnapTrade
  shapes — activity `type` enum strings (`BUY`/`SELL`/`OPTIONEXPIRATION`/…), field names
  (`units`, `fee`, `trade_date`, `option_symbol.strike_price`…), the pagination envelope
  (`{data, pagination}`), the currency object (`{code}`), and the bad-secret error codes
  (`1076`/`1083`). **All 147 unit tests validate logic against mocks that assume these
  shapes — none are verified against the live API.**
- Robinhood returned **0 activities** on first connect (async backfill), so the entire
  activity → FIFO → trades pipeline has **never seen real data**.

So the work ahead is less "build more" (the feature is complete and merge-ready) and
more "**flow real data of every shape through it once**, then turn it on." The plan is
ordered by risk-retired-per-effort.

---

## Phase 0 — Retire the API-contract risk (highest value, runnable now)

**Goal:** verify the adapter's real-shape assumptions against live SnapTrade JSON, not mocks.

- **0.1 Shape-capture harness** (`tools/snaptrade_shape_audit.py`): dump the RAW JSON
  SnapTrade returns for `list_accounts` / `get_balances` / `get_positions` /
  `get_activities` for the connected Robinhood account, pretty-printed + with a flat
  key inventory.
- **0.2 Adapter contract assertions:** for each captured object, assert the field names
  + enum values the adapter expects actually appear. Emit a PASS/MISMATCH table. This
  immediately validates accounts/positions/balances (data we already have) and will
  validate activities/options the moment they exist.
- **0.3 Reconcile findings:** any MISMATCH → patch `snaptrade_adapter.py` /
  `snaptrade_client.py` (the wrapper isolates all of this by design) + add a regression
  test seeded with the REAL captured shape.

**Exit:** a checked-in "live shape contract" snapshot + green adapter assertions for
every object type we can currently observe.

---

## Phase 1 — Exercise the activities → trades pipeline with REAL data

The positions path is proven; this is the other half (the actual trade history).
Pick one trigger:

- **1a (zero cost, slow):** wait for Robinhood's async transaction backfill, re-run
  `snaptrade_smoke_test.py data` until `activities > 0`, then re-run the J2 e2e.
- **1b (fastest, deterministic — user's call):** place **one tiny real trade** on
  Robinhood (e.g. 1 share) to force a fresh `BUY` activity within minutes. Cleanest way
  to see the full pipeline on known data.
- **1c:** connect a second broker with instant/richer history.

**Validate once activities exist:**
- FIFO reconstruction → `j2_trades` (entry/exit VWAP, dates, side).
- **Equity fees** threaded into `j2_trades.fees` and netted in P&L.
- **Idempotent re-sync** = 0 new rows (stable `external_id` fingerprint).
- **Holdings ↔ FIFO reconciliation**: a position with matching activity history flips
  `entry_estimated` 0 (exact basis) instead of the cost-basis seed we saw.
- Shape-audit (Phase 0) passes on the real activity objects.

**Exit:** at least one round-trip trade reconstructed correctly from live data, and a
re-sync that imports nothing.

---

## Phase 2 — The hard correctness paths (data-dependent)

These need specific event types. Trigger what's cheap; accept unit-coverage for the rest
and verify opportunistically in beta.

| Path | How to trigger live | Fallback |
|------|--------------------|----------|
| Single-leg **options** (open/close/expire/assign/exercise) | one cheap option trade or a near-dated long option to expiry | strong unit coverage |
| **Corrections-heal** (void/amend) | hard to force on Robinhood | unit-covered; watch in beta |
| **Split / cost-basis divergence** | only if a held name splits | unit-covered |
| **Multi-currency / non-USD** | connect a CAD/intl account | unit-covered |
| **Manual↔broker dedup + merge** | manually log a trade in J2 that matches a real broker fill → resolve the flag in UI | unit-covered; **easy to do in Phase 3** |
| **Concurrency lock** | fire on-open + manual sync simultaneously | unit-covered |

**Exit:** options validated live (do at least this one); the rest consciously signed off
as unit-covered + beta-watched.

---

## Phase 3 — Full app integration test (browser, real backend)

So far we've driven the service layer directly. This validates the **frontend +
router + auth gating** that real users hit.

- Run the real backend locally with the broker env vars + an **admin/paid** account
  (admins pass `require_plan`).
- Drive `BrokerConnectionsCard` in Settings: consent → Connect → SnapTrade portal →
  return → refresh accounts → first full sync → **see the 5 positions in the J2 journal
  UI**.
- Exercise the rest of the UI: per-account sync toggle, **dup-flags merge/dismiss**
  (set up a manual dup first — covers Phase 2 dedup too), reconnect button, disconnect
  (with/without purge).
- Confirm a **free-tier** account gets the upsell (connect 402/blocked), status still readable.

**Exit:** the feature works through the actual UI for a paid user, blocked correctly for free.

---

## Phase 4 — Webhook + scheduler live test

- **4.1 Webhook:** set `SNAPTRADE_WEBHOOK_SECRET`, register the webhook URL in the
  SnapTrade dashboard, trigger a data-change (place a trade), confirm
  `POST /api/j2/broker/webhook` fires a background sync. Verify bad-secret → 401.
- **4.2 Scheduler:** set `BROKER_SYNC_ENABLED=1` locally; confirm `broker_sync_due`
  picks up due accounts (market-hours gating) + `broker_sync_nightly_reconcile` is
  scheduled. Verify **downgrade-pause**: flip the test user to free → next cycle skips
  it (not an error) → re-upgrade → resumes.

**Exit:** reactive + scheduled sync proven; downgrade behavior confirmed.

---

## Phase 5 — Go-live (merge as a unit + deploy)

**⚠️ Merge atomically** — `main.py` import (line 56) + `include_router` (2096) +
scheduler block (1527-1547) + all broker files together. (Schema + deps are already on
master; the branch adds the rest. A dangling import = pod boot crash — the 2026-06-15
storm.)

1. Merge branch → master via fast-forward push (respect the shared-worktree hazard;
   verify ancestry, never `git add -A`).
2. Set Railway env vars **(web pod)**: `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`,
   `BROKER_ENCRYPTION_KEY` (the backed-up Fernet key), `SNAPTRADE_WEBHOOK_SECRET`.
   Worker pod doesn't run broker sync (auth.db is web-local) — keep it off there.
3. **Leave `BROKER_SYNC_ENABLED` unset** at first → endpoints live, scheduler off →
   connect + manual sync work, no background load. Verify in prod with your own account.
4. Register the prod webhook URL in the SnapTrade dashboard.
5. Flip `BROKER_SYNC_ENABLED=1` once prod-verified. Monitor `/api/j2/broker/admin/stats`
   (connected users, cost @ $1.50/user/mo, broken connections, recent errors).
6. Beta: yourself → a few paid users → general availability.

**Exit:** live for paid users, monitored, reversible (unset the flag to pause all sync).

---

## Cross-cutting checks (fold into the phases above)

- **Security/compliance:** GDPR purge on account deletion (`purge_on_account_deletion`)
  revokes at SnapTrade + drops all broker rows — verify in Phase 3.
- **Cost:** SnapTrade bills per connected user (~$1.50/mo). Admin stats endpoint is the
  monitor. Free tier of the API key has a connection cap — fine for beta.
- **Regime stamping:** confirm broker-reconstructed trades land with NULL regime (don't
  inherit today's) — the documented invariant; verify there's no accidental stamping.
- **Key custody:** `BROKER_ENCRYPTION_KEY` is permanent + catastrophic to lose — confirm
  it's in the password manager AND Railway before any prod write.

---

## Recommended sequence

Phase 0 now (pure win, no new data needed) → Phase 1b (one tiny trade) to light up the
activities pipeline → Phase 3 (browser test, also knocks out dedup) → Phase 2 options →
Phase 4 → Phase 5 go-live. Phases 0,1,3 retire ~90% of the real risk.

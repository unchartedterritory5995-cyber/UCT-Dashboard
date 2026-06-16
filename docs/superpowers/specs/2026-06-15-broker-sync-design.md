# Broker Sync — SnapTrade auto-import for Journal 2.0

**Status:** Phases 1–7 implemented on branch `worktree-broker-sync`. Inert in
production until env vars are set. Plan: `.claude/plans/okay-this-is-going-toasty-crescent.md`.

## Goal
Connect a brokerage once; the J2 journal auto-imports every buy/sell/partial
fill, open position, balance, and option — no manual entry. Multi-user,
premium-gated, read-only, safe to deploy disabled.

## Provider
**SnapTrade** aggregator (30+ US brokers), OAuth read-only. Wrapped in
`api/services/journal_two/broker/snaptrade_client.py` — sync SDK methods run via
`asyncio.to_thread`, behind a global token-bucket rate limiter, with structured
errors (`SnapAuthError`, `SnapUserSecretInvalid`, `SnapRateLimited`,
`SnapTransient`). All SnapTrade-shape knowledge is isolated here.

## Required env (feature is inert until all set)
- `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY` — partner creds (server-only).
- `BROKER_ENCRYPTION_KEY` — Fernet key (urlsafe-base64); encrypts the per-user
  SnapTrade `userSecret` at rest (`api/services/crypto_box.py`, key-id prefixed
  for rotation). Treat as a permanent, backed-up secret.
- `SNAPTRADE_WEBHOOK_SECRET` — shared secret for the webhook.
- `BROKER_SYNC_ENABLED=1` — turns on the background scheduler (default off).
- Tunables: `BROKER_SYNC_INTERVAL_MIN` (20), `BROKER_SYNC_CONCURRENCY` (4),
  `SNAPTRADE_RATE_PER_SEC` (4), `SNAPTRADE_RATE_BURST` (8).

## Data model (additive)
New tables in `_J2_SCHEMA`: `j2_broker_users` (encrypted secret + consent),
`j2_broker_accounts` (each brokerage account ↔ a `j2_account`),
`j2_broker_activities` (raw activity ledger / source-of-record),
`j2_broker_sync_log`, `j2_broker_dup_flags`. ALTERs add `source` + `external_id`
to `j2_trades`/`j2_positions`/`j2_option_strategies` (partial-unique index on
`external_id`), `entry_estimated` to positions, and `balance_source` +
`broker_*` balance columns to `j2_accounts`.

## Pipeline (per account, `broker/sync.py`)
1. Fetch activities — full backfill (no cursor) or incremental (cursor − 3d
   overlap), paginated. Per-account `asyncio.Lock` (on-open + scheduler +
   webhook can't double-process).
2. Store new activities in the ledger (dedup by id). **Heal:** drop ledger rows
   the broker no longer returns within the window (voided/amended).
3. Reconstruct equity/short round-trips over the FULL ledger
   (`fifo.reconstruct_trades(allow_shorts=True)` → `bulk_insert_trades`,
   idempotent via stable fingerprint `external_id`). Single-leg option
   strategies via `option_reconstruct` (incl. expiration/assignment/exercise).
   **Prune** broker trades/strategies no longer in the desired set (trade-side
   of the heal). Manual rows never touched.
4. Holdings-as-truth: `reconcile_positions` writes open positions from the
   broker's holdings (cost-basis seed → `entry_estimated=1` for carried-in
   lots), preserving user enrichments; `write_balances` sets real
   cash/equity/buying-power. `balance_resolver` is the single equity chokepoint
   (broker accounts → real equity; manual → startingBalance + realized P&L,
   unchanged).
5. Flag likely manual↔broker duplicates (`dedup`) for user Merge/Dismiss.

## Surfaces
- Router `api/routers/broker_sync.py` (`/api/j2/broker/*`): status, connect,
  accounts/refresh, sync, dup-flags (+resolve), webhook, DELETE connections.
  Writes are paid-gated + consent-gated.
- Settings `BrokerConnectionsCard.jsx`: consent → SnapTrade portal → return →
  refresh + sync; account list with sync toggle / reconnect / disconnect;
  duplicate review. Broker badge (🔗) + "connect your brokerage" nudge in
  `TradesTable`.
- Scheduler: APScheduler interval job (web pod; `auth.db` is web-local), gated.
- Webhook: shared-secret, fire-and-forget reactive sync.
- GDPR: `service.purge_on_account_deletion` wired into both delete paths.

## Safety invariants
- Read-only scopes; secret encrypted at rest; webhook + partner creds server-only.
- Idempotent reconstruction + per-account lock → no double-import.
- Heal converges to broker truth; manual data never deleted; dup-merge keeps the
  broker row (stable external_id) so it can't re-duplicate.
- Inert by default; **must merge to master as a unit** (router import + files +
  pip deps together, or the pod won't boot).

## Tests
~110 broker-specific tests across `tests/test_broker_*.py` + `test_crypto_box.py`;
full broker + J2 regression suite green. Pre-existing `test_options.py` failures
are time-brittle fixtures (hardcoded past expirations), unrelated.

## Deferred
Multi-leg option auto-grouping (single-leg only v1); edge-cache; deeper Compass
prompt integration (the `source`/`imported` flags are surfaced to the assembler).
SnapTrade exact webhook signature scheme + sandbox field shapes to confirm
against live docs before go-live.

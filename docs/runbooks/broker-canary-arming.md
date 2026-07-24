# Arming the broker canary (`BROKER_CANARY_USER_ID`)

The canary full-syncs one designated connection nightly (3:10 AM ET) and pings
owner Discord unless the sync **actually produced data**. No-op until the var is
set.

## It does NOT need a robot account

`run_canary_sync_blocking` calls `sync_all_for_user(<id>, full=True)` — **any**
user id with a live connection works. A dedicated robot account with a
throwaway brokerage is the tidiest option, but it costs an extra SnapTrade
connected-user fee (~$1–1.50/mo) plus a portal round-trip.

**Pointing it at a connection the owner already controls costs nothing and arms
it immediately.** Trade-off: if that connection is legitimately disconnected the
canary alarms — correct behavior, but repoint the var so it isn't mistaken for
an outage. The alert text says exactly that.

The sync is read-only and `full=True` — the same thing the 2:30 AM reconcile
already does to every account daily, so this adds one extra read-only pass.

## What it catches that the other detectors don't

`notifications.sweep_failure_spike` (2026-07-23) fires when ≥3 accounts and ≥50%
of a single sweep fail, wired into both the due-sweep and the nightly reconcile
— **including weekends**, since the 2:30 AM reconcile has no day-of-week gate.
That covers the fleet-wide-outage case well, so the canary is complementary,
not redundant:

- **Unambiguous fault attribution.** Member accounts span several brokerages, so
  a failure could be us, the partner, one broker, or a member revoking access.
  The canary is a constant — same user, same broker, every night. A canary
  failure is never a member action.
- **Below the spike thresholds.** A partial regression (one broker's options
  path breaks → 2 of 12 accounts) never reaches 50%. Neither does anything at
  all if the fleet shrinks below 3 accounts.
- **Silent-success states.** The spike detector counts raised exceptions. The
  canary asserts OUTCOMES (below), catching syncs that "succeed" while
  producing stale or wrong data.

## The outcome assertions (`canary_failures`)

The original canary checked only for an `error` key or an empty result. Three
states returned neither while the pipeline was demonstrably broken:

| State | What `sync_all_for_user` returns | Why it matters |
|---|---|---|
| **skipped** | `{"skipped": True, "reason": "broken"}` | **The single failure the canary exists to catch made it report green.** Broken / disabled / sync-disabled connections are skipped, not errored. |
| **balancesError** | a normal summary with `balancesError` set | Activities imported but holdings/balances did not refresh → equity, cash and positions are STALE. |
| **fifoErrors** | a normal summary with `fifoErrors > 0` | The ledger was fetched but trade reconstruction errored → the numbers members see are wrong. |

All three are now failures, and every bad account is reported, not just the
first.

## Arming it

1. Pick the user id — any live connection; prefer one the owner controls.
2. Keep it out of the fleet digest so it never reads as a member problem: add
   the id to `BROKER_FLEET_SUPPRESS` (comma/space-separated; see
   `fleet_monitor._suppressed_user_ids`).
3. Set the var and redeploy (`railway variables --set` only STAGES a value):
   ```
   railway variables --service web --set BROKER_CANARY_USER_ID=<uuid>
   railway redeploy --service web --yes
   ```
4. **Test the alarm, don't assume it.** Temporarily point the var at a user id
   with no broker accounts → expect a `Broker canary FAILED` ping reading
   "no accounts synced". Then point it back. An untested alarm is not an alarm.

## If you use a NEW robot account instead

Order matters — `POST /connect` is paid-gated (`require_plan`):

1. Sign up the robot with an email you control.
2. **Comp it first** (`/admin` → Grant comp access). A fresh account is inside
   its 14-day trial, so connecting appears to work without comping and then the
   canary silently stops when the trial lapses. `comped` satisfies both the
   connect gate and the background-sync gate (`sync._user_is_paid`).
3. Connect a brokerage as the robot, then follow "Arming it" above.

SnapTrade's synthetic `SANDBOX` brokerage is only offered on non-prod keys, so
on production credentials this must be a real connection.

## Rollback

Unset `BROKER_CANARY_USER_ID` and redeploy. The job returns immediately again;
no code change needed.

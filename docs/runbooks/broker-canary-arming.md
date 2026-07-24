# Arming the broker canary (`BROKER_CANARY_USER_ID`)

**Status: NOT ARMED.** `BROKER_CANARY_USER_ID` is unset in Railway, so
`fleet_monitor.run_canary_sync_blocking` returns immediately and the nightly
3:10 AM ET job is a no-op. It has never run.

## Why this matters

The canary is the only detector that proves the **whole pipeline works** rather
than inferring health from per-member state. Every other signal is reactive:
it waits for real members' connections to break, then reports them.

On **2026-07-23** an SDK bump silently dropped our SnapTrade credentials and all
11 member connections 401'd at the 2:30 AM ET reconcile. The first owner-visible
signal arrived ~17 hours later, as a digest that read like 11 separate member
problems. An armed canary would have failed at 3:10 AM — 40 minutes after the
outage started — with an unambiguous `Broker canary FAILED` ping.

The complementary detector (fleet-wide failure spike, shipped alongside this
doc) now fires within the failing sweep itself. The canary remains valuable
because it also catches the case where **nobody is due to sync** — a partner
outage on a quiet weekend would otherwise go unnoticed until Monday.

## What it does when armed

`run_canary_sync_blocking` (`fleet_monitor.py`) full-syncs every account of the
designated robot user end-to-end and pings owner Discord on **any** failure or
on zero accounts synced. Read-only, one user, once nightly — negligible cost.

## Steps (owner action required)

1. **Create a robot user** in the app (a normal signup, e.g.
   `canary@uctintelligence.com`). It needs a paid/comped plan or admin role —
   `sync_all_for_user` runs through `_user_is_paid`.
2. **Connect a brokerage** to that user via Settings → Brokerage Connections.
   Any real read-only broker connection works; a low-activity account is ideal
   (the canary asserts the pipeline runs, not that trades exist).
   - SnapTrade's synthetic `SANDBOX` brokerage is only offered on non-prod
     keys, so on production credentials this must be a real connection.
3. **Suppress it from the fleet digest** so the robot never shows up as a
   member problem — add its user id to `BROKER_FLEET_SUPPRESS`
   (comma/space-separated; see `fleet_monitor._suppressed_user_ids`).
4. **Set the env var and redeploy:**
   ```
   railway variables --service web --set BROKER_CANARY_USER_ID=<uuid>
   railway redeploy --service web --yes
   ```
   (`railway variables --set` only STAGES the value — the redeploy applies it.)
5. **Verify** the next morning: no `Broker canary FAILED` ping = the pipeline
   ran clean end-to-end. To test the alarm itself, temporarily point
   `BROKER_CANARY_USER_ID` at a user id with no broker accounts — it should
   ping `no accounts synced`.

## Rollback

Unset `BROKER_CANARY_USER_ID` and redeploy. The job returns immediately again;
no code change needed.

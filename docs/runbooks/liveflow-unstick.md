# Live Options Flow — Unstick Runbook (pre-P1 interim)

**When to use:** the Massive OPRA live-flow feed is down RIGHT NOW during market hours.
**Why this works:** there is no force-reconnect endpoint; the 600s `max_connections` cooldown is process-local state, and a cooldown-stuck process holds NO open WS session (its connect was refused at hello) — so restarting it cannot create a new zombie.

## Gates — ALL three must be true before restarting
1. **Market hours** (9:30 AM–4:15 PM ET). Outside RTH a large event age is normal, not an outage.
2. `GET https://uctintelligence.com/api/live/massive/status` shows `last_event_age_sec > 180` **and climbing** on a second check ~30s later.
3. **≥60s since the current web container booted** (newest entry in `/api/live/massive/restart-log`) — guarantees any zombie from the previous kill (10-30s server-side hold) has expired.

⛔ **Never** restart while `connected: true` / age < 120s — that manufactures a fresh zombie and likely a new self-inflicted 600s cooldown.

## Steps
1. Railway dashboard → *luminous-recreation* → **web** → active deployment → ⋮ → **Restart** (exact image, no rebuild, seconds). Do NOT use Remove. Fallback: `railway redeploy --service web -y` (slower, full build).
2. Verify within ~90s: status age drops below 120s; restart-log shows the new boot.
3. Still stuck after 3 min (fresh process ALSO hit max_connections)? → something else holds a session on the key. Do NOT restart-loop. Check for a second client (local script/notebook with the prod key), then contact Massive support.
4. Log the incident (time, deployment ids, gap window) in the ops channel thread — feeds the T+1 gap report.

This same procedure ends Class B stalls (watchdog→cooldown loops): a fresh process resets `last_trade_ts` and the loop's state.

**Cost note:** each restart blips the dashboard for ~200 users (SSE drops, warm caches reset). The gates exist so the price is only paid when flow is genuinely down.

## Shipping windows (until P1 is verified live)
- **Green:** after **4:20 PM ET** (options tape runs to 4:15) or before **~9:15 AM ET**.
- **Red:** 9:15 AM–4:15 PM ET for anything that deploys web — today that is EVERY commit.
- A **failed** build is harmless (no swap; old container keeps streaming). Only a **successful** swap kills the consumer.

## Urgent mid-day fix protocol (pre-P1)
1. Can it wait until 4:20 PM ET? Most "urgent" fixes can.
2. If genuinely urgent: push it. When the new deployment goes ACTIVE, watch `/api/live/massive/status`:
   - `connected: true` within ~2 min → done, touch nothing.
   - age climbing past ~3 min → it's in the 600s cooldown → run the unstick procedure above (gates will already be satisfied). Two-step (deploy → conditional Restart) cuts ~9-10 min to ~3-5 min.
3. Do not stack a third action within 10 min. If two kicks didn't restore flow, escalate (second-client check → Massive support).

**Context:** full design in `docs/superpowers/specs/2026-07-06-liveflow-worker-deploy-survival-design.md`. This runbook retires once P1 (graceful stop + reconnect ladder) is live and drill-verified.

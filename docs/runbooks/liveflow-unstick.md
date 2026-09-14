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

## Shipping windows — NO FREEZE (2026-08-24)
The market-hours push freeze and both its guards were removed by owner decision. Push whenever.
The physics did not change, so know what a mid-session push costs:
- A **web** swap blips `/api/*` for ~1 min. Since the 2026-07-17 cutover the flow worker is a
  separate service, so a web-only push does NOT gap the tape.
- A push touching a **flow-worker watched file** (list in `api/flow_worker_main.py`'s header)
  bounces the OPRA consumer, and that gap is PERMANENT until the overnight T+1 flat file.
- A **failed** build is harmless (no swap; old container keeps streaming). Only a **successful** swap kills the consumer.

## Mid-day fix protocol
1. Push it. When the new deployment goes ACTIVE, watch `/api/live/massive/status`:
   - `connected: true` within ~2 min → done, touch nothing.
   - age climbing past ~3 min → it's in the 600s cooldown → run the unstick procedure above (gates will already be satisfied). Two-step (deploy → conditional Restart) cuts ~9-10 min to ~3-5 min.
2. Do not stack a third action within 10 min. If two kicks didn't restore flow, escalate (second-client check → Massive support).

**Context:** full design in `docs/superpowers/specs/2026-07-06-liveflow-worker-deploy-survival-design.md`. This runbook retires once P1 (graceful stop + reconnect ladder) is live and drill-verified.

---
*P0 landed 2026-07-06 evening: exec + drainingSeconds:30 + --timeout-graceful-shutdown 5 live on both services (`0cc854ec`); worker watch paths active. This line doubles as the negative watch-path smoke commit (docs-only → worker must NOT rebuild).*

---

## ⛔ FOR THE FLOW-WORKER WORKSTREAM — the coverage rail's CI exit code changed (2026-09-14)

**`flow-worker deploy coverage` now exits 0 on a RED and reports through a `::warning::`
annotation plus the GitHub job summary. The rail is unchanged; only its CI exit code is.**

**Why it had to change.** `docs/runbooks/deploy-windows.md` has always said a red there is
a REVIEW GATE requiring a written classification, never a block. The workflow ran
`tools/flow_worker_watch_coverage.py` directly, which exits non-zero, so GitHub recorded
that deliberate signal as a **failed check**. Harmless while nothing consumed check
status — and load-bearing the moment Railway's **"Wait for CI"** entered the picture,
because it waits on **all** checks. Enabling it would have turned this rail into a hard
deploy block for essentially every backend change.

**Measured, last 50 master runs:** 44 pass / 6 "fail" — and all six were correctly
classified ADDITIVE breadth merges (`b4c141948`, `725151fd3`, `685a19bdb`, `7705c2d3b`,
`2d7ae7795`, `bd68c4147`), each with a written strand classification in `docs/breadth/`.
Not one was a real defect.

⭐ **The signal is not weakened.** The same text now appears as a warning on the commit
and in the job summary, which is more readable than a red X was — a reviewer previously
had to open the run to learn whether a failure meant anything.

⚠️ **The SCRIPT still exits non-zero.** `python tools/flow_worker_watch_coverage.py` run
locally still fails, which is what a developer's own run should do. The neutralisation is
in the workflow only, at the one place an exit code was being read as a deploy verdict.

⚠️ **If you want this to be a hard block again**, the honest way is to say so in
`deploy-windows.md` first and change the rule — not to restore the exit code and leave the
runbook saying the opposite. That mismatch is what cost this day.


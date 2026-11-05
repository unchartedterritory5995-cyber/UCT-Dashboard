# Owner actions: decided where delegable, exact steps where only the owner can act (desktop, 2026-11-05)

The owner asked the desktop to "figure it out" for the open items. Every DECISION below is made, with the reason. The ACTS stay with the owner, for two reasons:
- the programme's standing rules say agents never change Railway, set flags, arm, use the capture rig or sign in;
- the Railway runbook (W5-T19, section 3) says "nothing here is done by an agent".

Each act is listed in order, with its precondition.

## Order (each step waits on the one before)
1. **Landing train green and reviewed** (desktop, running now).
2. **OWNER: approve the train merge to master** (production deploy). Say so in chat when the desktop asks.
3. **Desktop:** merge, verify the production deploy, re-grade `adx-and-di-for-v4` on the deployed tree, and re-measure coverage (W0).
4. **OWNER: arm runtime stage 1** (section B), after step 3 is green.
5. **OWNER: create the `pine-runtime` Railway service** (section C), after step 3. It is independent of step 4.
6. **OWNER: capture sessions on the rig** (section A), whenever convenient, in the queue's priority order.

## A. The rig's TradingView plan (W9 D4)
- **Finding (inferred, not confirmed).** The committed captures loaded 20,616 SPY 60-minute bars (`vw-bool-cast-spy-60`) and 20,052 RDDT 5-minute bars (`vw-bar-counters-rddt-5`), each scrolled until the chart stopped growing. A cap of about 20K intraday bars matches TradingView's **Premium** tier.
- **Decision.** Plan as if the rig is Premium.
  - The bar magnifier and `calc_on_every_history_tick` captures (W9-M1) may run on it.
  - The single magnifier task (W9-T9) stays deferred anyway: one sample script uses it, and it needs lower-timeframe data (W7.3).
- **Owner act (10 seconds, optional).** Glance at the plan name in the rig profile's account menu. Only if it is NOT Premium or higher, tell the desktop, and W9-M1 is dropped.

## B. Arming the runtime lane, stage 1 (W2 packet `docs/pine/ARMING-PACKET-2026-11-02.md`, review GO-WITH-NOTES)
**Decisions:**
- **Stage 1: GO**, admins only, one script: `adx-and-di-for-v4`. It has 2 MATCH captures, a mutation-proved allowlist latch, S1-S8 PASS and budgets B1-B5 met. The x4-throttle B5 miss was already accepted for this stage.
- **Timing: AFTER the train lands, not before.** The train moves the engine from version 5 to about 12. Arming first would put admins on an engine that is replaced days later, and would force a second re-grade.
- **P11: accepted.** 25 sharded failures, 0 caused by the branch: 17 fail on master too, and 8 pass when run alone.
- **Save door (`PINE_RUNTIME_SAVE_ENABLED`): stays CLOSED at stage 1.** Stage 1 is about watching served runs; saving opens at the cohort stage.
- **New registry rows on joint evidence (9c): NO.** Each script needs its own MATCH capture, one evidence tier.
- **Census detector learns the input-selected arm (9a): YES.** This is follow-up F11, so deadband and fibonacci stop being withheld by a detector mismatch.
- **Renko captures (9b): defer.** Not worth rig time before the W6/W9 captures.
- **Stage-2 exit metric (8.4).** The S8 telemetry records stops but never runs, so the "<2% stop rate" cannot be computed. Follow-up F12 adds a run counter before stage 2.

**Owner act** (after step 3; the desktop pings with the re-grade result):
- On Railway service `web`, set `PINE_RUNTIME_STAGE=admins`. The committed allowlist already names only adx.
- Rollback is `PINE_RUNTIME_STAGE=off`; it is read on each call, and open tabs drop within 60 s.
- Then the 14-day watch in packet section 8.

## C. Creating the `pine-runtime` service (W5-T20)
**Precondition:** the train (all of W5) is on `production`. Before that, the service has no code to deploy.

**Owner act:** follow `docs/runbooks/pine-runtime-service.md` section 3 exactly (on master after the train lands):
1. Generate the secret locally.
2. Create the service from `services/pine_runtime/railway.json`, trigger branch `production`.
3. Private networking only, no public domain.
4. Set exactly one variable on `pine-runtime`: `PINE_RUNTIME_SERVICE_SECRET`.
5. Set the same secret on `web`.
6. Set `PINE_RUNTIME_SERVICE_URL=http://pine-runtime.railway.internal:8080` on `web`, last.
7. Leave `PINE_RUNTIME_SERVER_STAGE` UNSET.

**Smoke:** section 4. `python tools/pine_runtime_service_smoke.py` runs inside `web` (`railway ssh --service web`). It is read-only; exit 0 is green.

**Then:** server lanes stay off until the owner sets `PINE_RUNTIME_SERVER_STAGE=admins` (runbook section 5).

## D. Delegated rulings already recorded
R10 (history length is W5-T14's 5,000 bars), R11 (the scans lane owns the sweep cap), R12 (W9 D1-D3 and D5-D8). See DESKTOP-STATUS.md.

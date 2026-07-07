# Ravi handoff — ready-to-send (2026-07-06 evening, end-of-night state)

*Post as one Discord message (or a short thread). This supersedes the draft in coordination-package.md Part 1 — it reflects everything actually shipped tonight. One ACTION REQUIRED item for Ravi is flagged up top so it isn't missed.*

---

**Worked the live-flow worker issue end-to-end tonight — it's fixed + a lot more. One thing needs your attention first:**

**⚠️ ACTION NEEDED — your scripts:** I auth-gated every mutating flow endpoint tonight (they were wide open — an unauthenticated `DELETE /api/darkpool/clear` was a one-curl production wipe). Any external script/cron of yours that POSTs to `/api/flow/*`, `/api/darkpool/*`, `/api/dealer-positioning/*`, `/api/notable-flow/*`, or `/api/top-flow/*` now needs a header: `Authorization: Bearer <PUSH_SECRET>` (same secret as /api/push). Browser/admin-panel flows still work via your logged-in session — only headless scripts are affected. Ping me if anything of yours 403s and I'll confirm the endpoint.

**What was actually happening (your handoff was the thread that made it traceable):**
- The Massive OPRA consumer runs on **web**, not worker (the 7/1 migration is half-finished — worker is still dry-run staging). Every web deploy killed it, Massive hit `max_connections`, and the code slept a blind **600s** → ~9-10 min of unreplayable prints per deploy. 11 market-hours deploys Monday = the outages you saw. The morning "reconnects" were a watchdog→zero-gap-reconnect→cooldown loop (concrete mechanism, in the doc).

**Fixed + verified in prod (all after-hours):**
- **Graceful stop() + reconnect ladder** in `massive_ws_worker.py` (your file — I reviewed it hard, 9 unit tests vs a mock WS, merged after a live drill). Deploy gap measured **~36s, down from ~10 min**. The clean close frame + 30/60/120/300/600 ladder (env-tunable) replace the blind 600s; `last_trade_ts` reset kills the morning loop. Drill logs: clean stop chain on the old container, new one auth'd on the first try.
- **T+1 self-healing gap-fill** (`flow_gap_autofill.py`) — any minute we ever miss now heals from the flat file post-close (delete-window + archive + rollback + the cache-version bump so it's actually visible). **Running in DRY_RUN this week** — first dry run detected 17 windows for Monday, matched the known outages. I'll flip it to real after a clean week.
- **Independent monitor + nightly integrity scorecard** on the worker (separate process, so it survives web dying) — posts to Discord, and its *absence* by 4:30 PM is itself the alarm.
- **DST fix in `live_massive_router.py`** — your 4 hardcoded UTC-4 sites → ZoneInfo. They'd have skewed every timestamp +1h from Nov 1 (false "worker down" + phantom gaps). Surgical, 4 sites, all tests pass — flag me if you'd rather I'd left it.
- **Bullflow SSE worker** got the same treatment (graceful stop, read-timeout instead of the infinite hang, and day-state rehydration so alert caps/dedup survive deploys).
- **Live tape is actually live now**: the 43s `/recent` query is fixed (covering index + micro-cache → 0.1s cached), both live pages back to 5s polling, and `/live-massive` is promoted into the nav as "Live Flow" with an honest feed-health badge.

**Two things I changed in your ingest area (additive-only, flag me if you disagree):**
- **F3 — a real data-loss bug**: the aggregator's volume floor and premium floor were an AND, so an expensive low-lot print (big dollars, few contracts — a $120K 20-lot index option) got dropped and never hit flow.db. Added a high-premium escape (`MASSIVE_HIGH_PREMIUM_ESCAPE`, default $25K): a below-volume print is kept if its premium clears the escape. Absolute $10K premium floor still applies to everything, so it ONLY adds genuinely-large prints, never noise. New stat `kept_high_premium_low_volume`. Tested (5 cases), live.
- **F2 honesty (additive)**: added a `sideConfidence` field (measured|presumed) so the tape can distinguish a real NBBO-classified side from an empty-side sweep that's *presumed* buyer-driven. The SIDE cell now shows "≈ask" (dimmed, tooltip) for presumed rows instead of a bare "—". **I did NOT touch `_derive_direction`** — your bid-side-is-unreliable drop and the sweep-empty-side-as-ask presumption are your calls, left exactly as-is.

**Two F2 items I deliberately left for YOU (product judgment, not bugs):** (1) whether B-side/bid rows should show as bearish instead of being dropped — your comment says bid-side is an unreliable directional signal, so that's your decision; (2) raising the ~53% NBBO side coverage — that's deep tuning of your ingest classification. Happy to pair on either.

**Three questions for you (your call, no rush):**
1. **Delete-window vs per-contract reconciliation** for the T+1 gap-fill — I went delete-window (deterministic, provably single-source per second; reasoning in the spec). Good with that?
2. Optional 3-line hardening of `_current_version()` in `flow_router.py` (add `MAX(id)` so any fill changes the version persistently) — want me to, or keep the boot-rebump I already added?
3. For the pre-instrumentation morning flapping — one hypothesis is a second client on the prod key (Massive counts sessions per key). Did any local dev run / notebook / script connect with the prod key Monday morning? Purely closing attribution; the watchdog loop explains most of it either way.

**Also:** I emailed Massive support asking for a **second concurrent options connection** — that's what gets us to a true *zero*-gap deploy handoff (new process connects before old exits). Until then the 36s residual stands. And I built a full competitive roadmap (vs Unusual Whales / BlackBox) — committed at `docs/superpowers/specs/2026-07-06-options-flow-competitive-roadmap.md`; the short version is "don't out-tape UW, out-answer them" (verified public hit-rate scoreboard + AI print explanations + flow-in-your-workflow). Worth a read when you have a sec.

Full write-up + every commit: `docs/superpowers/specs/2026-07-06-liveflow-worker-deploy-survival-design.md`. Outage runbook (if the feed ever drops mid-day before we get the 2nd connection): `docs/runbooks/liveflow-unstick.md`.

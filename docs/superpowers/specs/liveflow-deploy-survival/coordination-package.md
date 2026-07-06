# Deliverable — Human Factors, Coordination & Sequencing Package

## Part 1 — Discord message draft (Patrick → Ravi)

*Post as one message (or a 2-part thread if over the limit). Paste the actual restart-log JSON excerpt + the 11 deployment IDs where marked.*

---

**Live flow deploys — full trace results, your watch-paths change (going in tonight), and 3 questions**

Ravi — worked through the worker issue from your handoff today. First: the restart-log endpoint you shipped in the 12:50 deploy is what made this traceable at all — every conclusion below hangs off it. Full write-up is committed at `docs/superpowers/specs/2026-07-06-liveflow-worker-deploy-survival-design.md`; short version + asks:

**1. The consumer is running on web, not worker.** Three independent checks agree: Railway env (web `MASSIVE_WS_ENABLED=1, DRY_RUN=0`; worker `=0, DRY_RUN=1`), the `start()` env gate at massive_ws_worker.py:1964, and every `deployment_id` in the restart-log resolving to the **web** service via Railway's API — all 11 restarts on 7/6 were web deploys, all during market hours. `<paste: restart-log JSON excerpt + the 11 deployment IDs>` (live: https://uctintelligence.com/api/live/massive/restart-log). Looks like the 7/1 migration is half-finished — worker is still dry-run staging. So the worker watch-paths change alone wouldn't have stopped the bleeding: web has `watchPatterns=[]` and redeploys on every commit.

**Your ask is still going in tonight** — one widening: the worker also runs the bars pipeline (`api/worker_main.py`, `api/services/**`), so the narrow file list in the handoff would silently stop deploying that code. Setting `api/**` + build files (`requirements.txt`, `railway.json`, `nixpacks.toml`, `Procfile`, `runtime.txt`).

**2. The morning windows (your \"10 WebSocket reconnects\") have a concrete mechanism, not a mystery.** Heavy `_write_events` flush runs on the consumer's loop → loop stalls → stale watchdog closes with 1001 (clean) → `_run_session` returns normally → the reconnect sleep only exists in the `except` branch (:1324) → zero-gap reconnect against a server still counting the half-dead session → `max_connections` → the flat 600s cooldown (:1309). And session-clear (:1338-1374) doesn't reset `last_trade_ts`, so a fresh session can get watchdog-killed within its first 10s check. ~60s stale + ~600s cooldown ≈ the 9-11 min windows. 7/2 was 390/390 clean — this only appeared under today's launch-day load.

**3. Fix package.** The deploy-survival side is ~40 lines in your file: `stop()` + `close_timeout=3`, a `MIN_RECONNECT_GAP` sleep after clean return, `last_trade_ts = None` in session-clear, and a 30/60/120/300/600 ladder replacing the flat 600. Spec is in the doc, and I can push a ready-to-review branch tonight — your file, your review. If you're heads-down this week, just reply \"land it\" and I will; otherwise I won't touch it. My side ships tonight after the close, none of it in your files: drain-seconds env, railway.json graceful-shutdown flag, your watch paths, a defensive main.py shutdown hook (it no-ops until your `stop()` exists — exact name `stop`, no args, so the hook finds it), and an independent down-monitor running from the worker service.

**4. T+1 refill — one data-safety flag before it gets built.** Blind `process_date(force=True)` over a partially-captured day double-counts every gap edge: boundary events captured live have different Volume/Premium → different `dedup_key`, and the enriched flatfile rows can't be fingerprinted for rollback afterward — a bad run would be permanent. Two safe shapes: delete-window-then-fill (gap ± ~1 min) or per-contract post-fill reconciliation, plus a run manifest so every run is reversible.

**Three questions:**
1. `live_massive_router.py` has 4 hardcoded UTC-4 sites — that's a DST bomb in November, and the refill's gap-detection would inherit it. Want me to patch those (+ add a tiny liveness endpoint), or keep my hands off and put gap-detection in a new module?
2. Delete-window-then-fill vs per-contract reconciliation for the refill — your DB, your call.
3. For the pre-12:50 morning flapping (before the instrumentation existed) — one hypothesis I want to rule in or out is a second client on the same key, since `max_connections` counts sessions per key. My own tooling is a candidate too. Did anything on your side — a local dev run, test script, notebook — connect with the prod key Monday morning? Purely closing out attribution; the loop in #2 explains most of the morning either way.

Also emailing Massive support tonight: *does a connect attempt made while at the connection limit extend the lockout, or does only zombie-session overlap matter?* Holding any retry <30s until they answer. Until the graceful close lands I'm treating every market-hours web deploy as a ~10-minute flow outage — batching my pushes to after 4:20 PM ET, and pinning an unstick runbook in this channel. If you need to deploy anything to web during market hours this week, ping me first so I can babysit the reconnect.

---

## Part 2 — Interim runbook (pre-P1)

### 2a. Unstick procedure — \"flow is down RIGHT NOW\"

**Fact base:** there is NO admin endpoint to force a reconnect (full route audit of `live_massive_router.py` — everything is read/diagnostic/threshold-config). The 600s cooldown is a local variable inside `_consume_forever`; only a process restart clears it. The irony is total: until P1, **the only remedy is the same mechanism causing the outages** — but it is safe, because a cooldown-stuck process holds no open WS session (its connect was refused at hello), so restarting it cannot create a new zombie.

**Gates — ALL three must be true:**
1. Market hours (9:30 AM–4:15 PM ET). Outside RTH, a large event age is normal, not an outage.
2. `GET https://uctintelligence.com/api/live/massive/status` shows `last_event_age_sec > 180` and climbing on a second check ~30s later.
3. ≥60s since the current web container booted (check the newest entry in `/api/live/massive/restart-log`). This guarantees any zombie from the previous kill (10-30s server-side hold) has expired.

**Never** restart while `connected: true` / age < 120s — that manufactures a fresh zombie and likely a brand-new 600s cooldown (self-inflicted outage).

**Steps:**
1. Railway dashboard → project *luminous-recreation* → service **web** → active deployment → ⋮ → **Restart**. (Restart restores the exact image, no rebuild — seconds. Do NOT use Remove. Fallback if dashboard is unreachable: `railway redeploy --service web -y` from the linked repo dir — slower, full build cycle.)
2. Verify within ~90s: status age drops below 120s; restart-log shows the new boot.
3. If still stuck after 3 min (i.e., the fresh process ALSO hit max_connections): something else holds sessions on the key — do NOT restart-loop. Check for a second client (local script/notebook with the prod key), then contact Massive support. Repeated restarts here are at-limit probing, the exact thing we're asking support about.
4. Log the incident (time, deployment IDs, gap window) in the ops channel thread — this feeds the T+1 gap report.

This same procedure ends Class B stalls (watchdog→cooldown loops): a fresh process resets `last_trade_ts` and the loop's state.

**Cost note:** each restart blips the dashboard for ~200 users (SSE streams drop, warm caches reset, web is single-process). That's the price of the lever until P1; the gates exist so it's only paid when flow is genuinely down.

### 2b. Shipping windows (until P1 is verified live)

- **Green:** after **4:20 PM ET** (ETF/index options trade to 4:15) or before **~9:15 AM ET** (leave headroom — a deploy at 9:20 puts the cooldown's end at ~9:30 and eats the open).
- **Red:** 9:15 AM–4:15 PM ET for anything that deploys web — which today is EVERY commit (`watchPatterns=[]`).
- **Standing-preference override:** the memorized `feedback_always_push` rule (\"always commit+push after tasks\") is what produced the 11-deploy storm. Until P1 is live and verified: market-hours work accumulates on the branch; ONE batch push after 4:20 PM ET. Write this exception into CLAUDE.md and the memory behavior file — a doc section alone will not override a memorized automation rule in future sessions.
- A **failed** build is harmless (no swap; old container keeps streaming). Only a **successful** swap kills the consumer.

### 2c. Urgent mid-day fix protocol (pre-P1)

Verdict on \"deploy + immediately redeploy\": **yes — two-step (deploy, then conditional Restart) beats one deploy**, cutting ~9-10 min to ~3-5 min. The evidence supports it: fresh deploys consistently ENDED outages because the cooldown is client-side process state; and the post-deploy stuck process has no session to zombie, so the second kick connects clean and adds zero at-limit attempts.

1. Ask first: can it wait until 4:20? Most \"urgent\" fixes can (batch-punch-list discipline).
2. If genuinely urgent: push the fix. (Build failure = no harm; fix the build and re-push.)
3. When the new deployment goes ACTIVE, watch `/api/live/massive/status`:
   - `connected: true` within ~2 min → the swap window happened to outlast the zombie. Done. Do NOT touch anything.
   - age climbing past ~3 min → the process is in the 600s cooldown → run the unstick procedure (2a) — gates will already be satisfied.
4. Do not stack a third action within 10 min. If two kicks didn't restore flow, escalate per 2a step 3.
5. Post the gap window in the ops thread for the T+1 report.

### 2d. Who can ship what if Ravi is unavailable

| Item | Patrick alone? | Notes |
|---|---|---|
| P0 (drain env, railway.json, worker watchPatterns) | **Yes** | This IS Ravi's ask, honored + widened |
| main.py shutdown hook | **Yes** | Shared file, not massive_*; defensive no-op until stop() exists |
| P3 independent monitor | **Yes** | Worker-side poller, Patrick-owned files |
| Unstick runbook + Discord pin + Massive support email | **Yes** | Tonight |
| P2a: T+1 gap DETECTION + Discord report | **Yes** | NEW module, read-only, zoneinfo (never inherits UTC-4 bug), doesn't touch Ravi's files |
| P2b: T+1 fill WRITES | **No** | Mutates Ravi's flow.db; blocked on his delete-window-vs-reconcile call |
| P1 patch in massive_ws_worker.py | **No — unless delegated** | Prep the PR tonight; merge only on his \"land it\" |
| live_massive_router.py UTC-4 fix + liveness endpoint | **No — asked (Q1)** | New-module fallback exists |
| Post-P1 admin \"kick\" endpoint (stop()+start()) | **Yes, after P1** | Lives in a Patrick-owned router; imports Ravi's module, doesn't edit it |

**Ownership-split vs handoff spirit:** the handoff's \"What we need you to do\" shows Ravi expects Patrick to execute infra/config — the plan's split (Ravi: his file; Patrick: config/monitor/glue) matches that spirit exactly. Where the plan goes beyond the handoff (patching his file, redesigning his cron, touching his DB) it must run through consent, which the message secures with a zero-friction \"just say land it\" path. **Escalation timebox:** T+0 message + PR branch pushed (not merged) · T+1 close, no reply → one-line ping · T+2 close → explicit \"may I land the branch myself? config-only rollback available.\" Never merge into his file without a yes.

## Part 3 — Merge-order matrix

Artifacts: **A** = P1 patch (Ravi, massive_ws_worker.py) · **B** = main.py shutdown hook (Patrick) · **C1** = `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` env (dashboard, no commit) · **C2** = railway.json commit (uvicorn `--timeout-graceful-shutdown 5` + worker watchPatterns).

**Canonical hook form (load-bearing):**
```python
@app.on_event(\"shutdown\")  # NEVER convert main.py to lifespan= — it silently disables ALL on_event handlers
def _massive_ws_shutdown():
    import api.massive_ws_worker as _mw          # module import only — never `from ... import stop`
    _stop = getattr(_mw, \"stop\", None)           # resolved AT CALL TIME, inside the handler
    if callable(_stop):
        _stop()
        logger.info(\"[massive-ws] stop-hook: wired\")
    else:
        logger.info(\"[massive-ws] stop-hook: missing (P1 not landed)\")
```

| Ordering / scenario | Boot risk | Runtime effect |
|---|---|---|
| B before A — canonical form | **None** (no import-time symbol reference) | Hook no-ops; logs \"missing\" |
| B before A — `from api.massive_ws_worker import stop` | **ImportError at boot → deploys FAIL** (dangling-import class; web serves last SUCCESS) | Forbidden pattern — the one ordering that breaks boot |
| B before A — bare `massive_ws_worker.stop()` call | Boots fine | AttributeError at shutdown — logged noise, harmless, but masks wiring state; use canonical form |
| A before B | None | stop() dormant; **Class B fixes (clean-close sleep, watchdog reset, ladder) active immediately** — a big win on their own |
| C1 before A/B | None (dashboard change; 1 redeploy) | SIGTERM + 30s window exists but nothing closes the WS yet → still a dirty death; neutral, enables A+B |
| C2 before A/B | Typo in startCommand → failed deploys (users fine, shipping frozen) — verify flag locally first | `--timeout-graceful-shutdown 5` caps uvicorn drain; harmless alone |
| A+B live, C1 unset | None | **SIGKILL at 0s — stop() never gets a chance; deploys still dirty.** C1 is mandatory for effect, not for safety |
| A lands with a different function name | None | Hook silently no-ops **forever** — caught by the \"missing\" fingerprint log + P3 gap alarms; name contract stated in Discord + PR |
| Anyone introduces `lifespan=` in main.py | Boots, but ALL on_event handlers silently dead → **consumer never starts** | Forbidden — CLAUDE.md LOCKED invariant + inline comment |

**Conclusion:** with the canonical getattr-inside-handler form, all six A/B/C orderings are boot-safe; the only boot-breaking pattern is a module-level `from`-import of `stop` (plus the lifespan= trap, which is a start-side not merge-order hazard). Order matters for EFFECT only: **C1 is the enabling dependency for A+B; A alone still ships the Class B fixes.**

**Recommended landing order (tonight, all after 4:20 PM ET):**
1. Set C1 on web + worker (1 redeploy each).
2. ONE commit: C2 + B + this spec doc + runbook file → 1 deploy. Boot-test the branch locally first (hook must no-op against un-patched worker code).
3. Push the ready-to-review P1 branch (A) — unmerged; send the Discord message.
4. A merges whenever Ravi reviews (or delegates); after-hours preferred until proven.
5. Verification deploy (after hours): logs show clean close + \"stop-hook: wired\" + reconnect <60s; then and only then relax the shipping-window discipline.

## Part 4 — Socialization (single-point-of-knowledge fix)

1. **Commit to origin/master tonight** (the doc currently exists only on the ~1.2K-commit-stale local tree — Ravi literally cannot see it): the spec + `docs/runbooks/liveflow-unstick.md` (Part 2a-2c as an ops card).
2. **CLAUDE.md** new short section \"Live Options Flow (Massive OPRA) — deploy survival\": consumer runs on WEB; never introduce `lifespan=` in api/main.py; `stop()` name is load-bearing for the shutdown hook; shipping windows; runbook path; 600s-cooldown symptom + Restart lever. This is the highest-leverage location — the deploy storms come from Claude sessions, and CLAUDE.md is what every session reads.
3. **Memory behavior file**: amend `feedback_always_push` with the market-hours batching exception for this repo (see HF-R2 — a doc section alone won't override a memorized automation rule).
4. **Discord**: pin the unstick card in the shared ops channel; the message to Ravi links the committed doc (canonical copy, not a paste).
5. **Ravi's copy**: the committed doc + the message ARE his copy; ask him to skim §2 (corrections) and §P1 specifically, so the on-web finding replaces the on-worker premise in his head before he plans anything else against it.

---
## Risk appendix

**HF-R1** (medium×high): The correction message reads as 'you were wrong three times' — Ravi disengages or gets defensive, P1 review stalls, and the one fix that needs him never lands.
- Mitigation: Use the credit-forward draft below: lead with his instrumentation making the diagnosis possible, honor his watch-path ask visibly and FIRST, present P1/P2 as review-ready proposals with 'your file, your review, your call' framing, and give him a zero-effort out ('just say land it').
- Verify: Ravi replies engaging on technical substance (not tone) within 1 business day; the message contains zero evaluative adjectives about his work — only evidence links.

**HF-R2** (high×high): Patrick's standing behavior preference feedback_always_push ('always commit+push to Railway after tasks') directly produced the 11-deploy market-hours storm and will keep producing them — every Claude session obeys it. P4's shipping windows conflict with a memorized automation rule that no doc section overrides.
- Mitigation: Amend the working agreement explicitly: for uct-dashboard, market-hours work accumulates on the branch and is batch-pushed after 4:20 PM ET until P1 is verified live; write this into CLAUDE.md AND the feedback_always_push memory file so future sessions inherit the exception, not just the doc.
- Verify: Next 5 trading days: /api/live/massive/restart-log shows zero web deploys between 9:30 AM–4:15 PM ET except sanctioned urgent-fix runs.

**HF-R3** (medium×medium): Question 3 (prod key used by a local instance on 7/6 morning) is read as an accusation, souring the exact collaboration the message is trying to build.
- Mitigation: Phrase as a hypothesis to rule in/out, explicitly include Patrick's own tooling as an equal candidate, scope it to the pre-instrumentation window only, and state that Class B explains most of the morning either way (so nothing hangs on his answer).
- Verify: Draft below includes all four softeners; Ravi answers factually rather than defensively.

**SEQ-R1** (medium×high): Ravi is slow/unavailable this week → P1 (his file) unmerged → every market-hours deploy keeps costing ~9-10 min of unreplayable OPRA data.
- Mitigation: Ship everything Patrick-ownable tonight (P0, main.py hook, P3 monitor, P2a read-only gap report, runbook); push a ready-to-review P1 branch (NOT merged); timebox escalation — if no response by close of T+2, ask explicitly 'may I land the branch myself?'. Interim runbook caps each incident at ~3-5 min; shipping windows make incidents rare.
- Verify: Deploy-gap telemetry via restart-log + /api/live/massive/status; the P1 branch exists on origin by tonight; escalation ask sent no later than T+2 if silent.

**SEQ-R2** (low×medium): main.py hook written as module-level `from api.massive_ws_worker import stop` before Ravi's patch lands → ImportError at boot → all web deploys FAIL (dangling-import class; web serves last SUCCESS so users are fine, but shipping is frozen).
- Mitigation: Mandate the canonical form: resolve `stop` via getattr INSIDE the shutdown handler with a callable() check (matrix below). Boot-test the branch locally with uvicorn before pushing.
- Verify: grep the diff for `from api.massive_ws_worker import` (must only import the module, never `stop`); local `uvicorn api.main:app` boots on the hook-only branch with origin/master's un-patched worker file.

**SEQ-R3** (medium×medium): Ravi implements the P1 shutdown function under a different name/signature (e.g. `shutdown()` or `stop(timeout)`) → the getattr hook silently no-ops forever; deploys look fixed on paper but still dirty-kill the socket.
- Mitigation: State the contract in the Discord message and PR description ('exact name `stop`, no args'); add a startup fingerprint log `[massive-ws] stop-hook: wired|missing` so the wiring state is observable in deploy logs; P3 monitor independently alarms if deploy gaps persist.
- Verify: After A+B are both live, run one after-hours deploy and confirm logs show the clean close + reconnect in <60s and the fingerprint says 'wired'.

**SEQ-R4** (low×critical): A future session 'modernizes' main.py to lifespan= — this silently disables ALL @app.on_event handlers, including the consumer's startup registration: the consumer never starts after the next deploy.
- Mitigation: LOCKED invariant in CLAUDE.md ('never introduce lifespan= in api/main.py') plus an inline comment at the hook site; P3 monitor catches the symptom (no flow events after a deploy) within 3 minutes.
- Verify: CLAUDE.md section merged; kill-test: P3 alert fires when /api/live/massive/status age exceeds 180s during market hours.

**SEQ-R5** (medium×medium): Unstick 'Restart' executed while the consumer is actually connected (misread status, or run outside market hours when age is legitimately large) → creates a fresh zombie session → self-inflicted max_connections + new 600s cooldown.
- Mitigation: Hard gates in the runbook: market hours only AND last_event_age_sec > 180 AND ≥60s since the current container booted. The gate exploits a verified property: a cooldown-stuck process holds NO open WS session (connect refused at hello), so restarting a genuinely-stuck process cannot create a zombie.
- Verify: Dry-run the runbook once after hours against the status endpoint; gates printed on the pinned Discord card.

**SEQ-R6** (medium×medium): P0 itself bleeds: each Railway env-var change and the railway.json commit trigger their own redeploys — installing the fix during market hours causes the exact 10-min outage it prevents.
- Mitigation: Schedule ALL P0 work after 4:20 PM ET; batch railway.json + main.py hook + spec-doc commit into ONE push (one deploy); set env vars immediately before that push so total deploys ≤ 2-3, all after hours.
- Verify: Railway deploy timestamps for the P0 evening are all ≥ 16:20 ET.

**COORD-R1** (low×medium): Patrick's main.py hook conflicts with Ravi's concurrent edits (partner co-edits master) or with the live parallel session in the shared local tree.
- Mitigation: Do all work against origin/master from an isolated worktree (never git add -A, ship via push origin <branch>:master per house rules); keep the hook a minimal self-contained block; rebase immediately before push.
- Verify: Push is fast-forward on top of freshly-fetched origin/master; no edits inside Ravi-owned files in the diff.

**KNOW-R1** (high×high): The analysis lives only in one doc on Patrick's stale local tree + one memory file — Ravi and future Claude sessions keep acting on the old premise (consumer on worker), and nobody but Patrick knows the unstick lever during an outage.
- Mitigation: Four-place socialization tonight: (1) commit the spec + a runbook file to origin/master with the P0 commit; (2) add a short 'Live Options Flow — deploy survival' section to CLAUDE.md (consumer on WEB, never lifespan=, stop() name contract, shipping windows, runbook path); (3) pin the unstick card in the shared Discord channel; (4) link the committed doc in the Discord message so Ravi reads the canonical copy, not a paste.
- Verify: Doc + runbook visible on GitHub master; CLAUDE.md diff merged; pinned message exists; Discord message contains the repo path.

**SEQ-R7** (low×low): RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30 lengthens the web swap window on every deploy (volume services are stop-then-start, so users wait out the drain) — trading flow-loss for user-facing 502 blips.
- Mitigation: Drain is a ceiling, not a fixed wait: with uvicorn --timeout-graceful-shutdown 5 and stop()'s thread.join(5), the process exits in ~5-8s and Railway proceeds immediately. Keep 30 as headroom only.
- Verify: Measure the swap window (old-stop → new-healthy) on one after-hours deploy after P0+P1; expect <15s added vs today.

**SEQ-R8** (low×medium): P1 merges with retry timings tightened below 30s before Massive support answers the lockout-extension question → if at-limit attempts DO extend lockout, the 'fix' worsens outages.
- Mitigation: Keep the plan's HOLD: ladder floor stays ≥30s and no sustained at-limit probing until support answers; note in the PR description so Ravi doesn't 'optimize' it during review. The interim runbook is already safe: it adds zero at-limit attempts (verified below).
- Verify: P1 diff review: no sleep <30s on any reconnect path; support email sent tonight and answer recorded in the doc.

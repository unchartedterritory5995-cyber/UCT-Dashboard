# P1 PATCH — Graceful handoff + reconnect discipline for `api/massive_ws_worker.py`

Target: `origin/master` @ `054c60cd` (Jul 6). All hunks verified byte-identical between the provided temp copy and origin/master; origin line numbers ≈ temp+5 after line 121. **Part 1 is Ravi's file → ship as a PR for his review. Part 2 (main.py) is Patrick's.** Prerequisite: P0 (`RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` + `--timeout-graceful-shutdown 5`) must be live first — without it the stop path never executes (SIGKILL at 0s / SSE-starved teardown).

---

## Part 1 — `api/massive_ws_worker.py`

### Hunk 1 — config block (after `FLUSH_INTERVAL_SEC`, temp :83 / origin :83)

```diff
 # How often (seconds) to flush stale aggregator buckets and write to DB.
 # 2s = events appear in OptionsFlow.jsx within 2-3 seconds of the trade.
 FLUSH_INTERVAL_SEC = float(os.environ.get("MASSIVE_FLUSH_INTERVAL", "2.0"))
+
+# Minimum gap between ANY two connection attempts -- clean close OR error.
+# Massive support guidance: leave 10-30s between reconnections so their
+# server fully reaps the old session before a new one arrives; reconnecting
+# into a still-counted session trips max_connections. We take the high end.
+# Module-level + env-tunable so unit tests and after-hours smokes can shrink
+# it, and ops can raise it (e.g. to 45) without a code change.
+MIN_RECONNECT_GAP = float(os.environ.get("MASSIVE_MIN_RECONNECT_GAP", "30"))
+
+# max_connections backoff ladder -- replaces the old blind 600s cooldown.
+# Strike count resets ONLY on auth_success. While process uptime is under
+# MAXCONN_YOUNG_UPTIME_SEC (i.e. right after a deploy), the cooldown is
+# capped at MAXCONN_YOUNG_CAP_SEC: a young process's max_connections is
+# almost always the 10-30s zombie-session overlap from the deploy handoff,
+# not a real lockout -- sleeping 600s there is 10 minutes of lost tape.
+# NOTE: no rung and no cap is ever below 30s (Massive 10-30s guidance;
+# spec HOLD pending their lockout-extension answer is respected).
+MAXCONN_LADDER = (30.0, 60.0, 120.0, 300.0, 600.0)
+MAXCONN_YOUNG_UPTIME_SEC = float(os.environ.get("MASSIVE_MAXCONN_YOUNG_UPTIME", "900"))
+MAXCONN_YOUNG_CAP_SEC = float(os.environ.get("MASSIVE_MAXCONN_YOUNG_CAP", "60"))
```

### Hunk 2 — `_state` dict (after `\"thread\": None,`, temp :100 / origin :100)

```diff
     "thread": None,
+    # Graceful-stop plumbing (2026-07-06 deploy-survival patch). Captured by
+    # _consumer_root() at thread start; consumed by stop(). NOT JSON-
+    # serializable -- get_status() strips them (like "thread").
+    "loop": None,            # asyncio loop owned by the consumer thread
+    "root_task": None,       # root Task wrapping _consume_forever
+    "stop_requested": False, # set by stop(); guards against double-cancel
+    # Reconnect-discipline telemetry (post-deploy verification via /status)
+    "maxconn_strikes": 0,     # consecutive max_connections since last auth_success
+    "last_cooldown_sec": None, # duration of the most recent reconnect sleep
+    "clean_reconnects": 0,     # sessions that ended with a clean close (e.g. watchdog 1001)
```

### Hunk 3 — `get_status()` (temp :209-219 / origin :214-224) — FULL REPLACEMENT

```python
def get_status() -> dict:
    """Snapshot of worker state. Wire to a health endpoint if useful."""
    s = dict(_state)
    # Non-serializable runtime handles -- never expose via JSON endpoints
    # (/api/live/massive/status would 500 and blind the P3 monitor).
    s.pop("thread", None)
    s.pop("loop", None)
    s.pop("root_task", None)
    if s["started_at"]:
        s["uptime_sec"] = round(time.time() - s["started_at"], 1)
    s["dry_run"] = DRY_RUN
    s["enabled"] = ENABLED
    s["min_premium"] = MIN_PREMIUM
    s["min_volume"] = MIN_VOLUME
    s["min_reconnect_gap"] = MIN_RECONNECT_GAP
    s["graceful_stop"] = True  # feature-detect for monitors / smoke checks
    return s
```

### Hunk 4 — `_consume_forever()` (temp :1219-1326 / origin :1224-1331) — FULL REPLACEMENT

```python
async def _consume_forever():
    """Outer loop: connect, run, reconnect with backoff.

    Reconnect discipline (2026-07-06 deploy-survival patch):
    - EVERY reconnect -- clean session end or error -- waits at least
      MIN_RECONNECT_GAP (30s). Massive's server keeps counting a dead session
      for 10-30s after it drops; reconnecting inside that window trips
      max_connections. The old code slept only in the error path, so a
      watchdog-initiated clean close (code 1001) reconnected with ZERO gap,
      hit max_connections, and fell into a blind 600s cooldown.
    - max_connections uses the MAXCONN_LADDER (30/60/120/300/600s) instead of
      a blind 600s. Strikes reset ONLY on auth_success. While process uptime
      < MAXCONN_YOUNG_UPTIME_SEC the cooldown is capped at
      MAXCONN_YOUNG_CAP_SEC -- a young process's max_connections is deploy-
      handoff overlap, not a real lockout.
    - Exponential backoff for other errors resets ONLY on auth_success
      (unchanged) -- NOT on TCP connect, so a locked-out account is never
      hammered.
    """
    import websockets

    backoff = MIN_RECONNECT_GAP
    MAX_BACKOFF = 120.0
    maxconn_strikes = 0

    while ENABLED:
        try:
            logger.info("[massive-ws] connecting to %s", MASSIVE_OPTIONS_WS_URL)
            async with websockets.connect(
                MASSIVE_OPTIONS_WS_URL,
                ping_interval=20,
                ping_timeout=20,
                close_timeout=3,   # bound the closing handshake: shutdown and
                                   # watchdog closes must not hang on a dead
                                   # peer (library default is 10s)
                max_size=2**24,  # 16 MB frames; bursts can be large
            ) as ws:
                _state["connected"] = True
                # NOTE: do NOT reset backoff here -- wait for auth_success below

                # 1. Initial status message -- could be "connected" OR an error
                first = await asyncio.wait_for(ws.recv(), timeout=10)
                logger.info("[massive-ws] hello: %s", first[:200])
                # Detect immediate rejection (e.g. max_connections) and fail
                # fast so we don't waste an auth attempt that's guaranteed to
                # be rejected too. Triggers the ladder path below.
                if "max_connections" in first:
                    raise RuntimeError(f"max_connections at hello: {first[:300]}")

                # 2. Authenticate
                await ws.send(json.dumps({
                    "action": "auth",
                    "params": MASSIVE_API_KEY,
                }))
                auth_resp = await asyncio.wait_for(ws.recv(), timeout=10)
                logger.info("[massive-ws] auth: %s", auth_resp[:200])
                if "auth_success" not in auth_resp:
                    raise RuntimeError(f"auth failed: {auth_resp[:300]}")

                # Auth successful -- NOW reset backoff AND the max_connections
                # strike ladder. (Resetting on TCP-open would hammer a locked
                # account; resetting only here is the safe anchor.)
                backoff = MIN_RECONNECT_GAP
                maxconn_strikes = 0
                _state["maxconn_strikes"] = 0

                # 3. Subscribe to trades
                await ws.send(json.dumps({
                    "action": "subscribe",
                    "params": MASSIVE_WS_SUBSCRIBE,
                }))
                sub_resp = await asyncio.wait_for(ws.recv(), timeout=10)
                logger.info("[massive-ws] sub: %s", sub_resp[:200])

                # 4. Drain forever -- message loop alongside a periodic flusher.
                # Warm-start (Phase 2c.1) happens INSIDE _run_session after it
                # clears the per-session state, so we don't accidentally wipe
                # the warm-started pool.
                await _run_session(ws)

            # ---- clean session end (watchdog 1001 / server clean close) ----
            # The async-with has fully closed our side of the socket by the
            # time we get here. Honor the same server-cleanup window as the
            # error path before reconnecting: the old zero-gap loop here is
            # what turned every watchdog close into a max_connections spiral
            # ending in the blind 600s cooldown (7/6 Class B).
            _state["connected"] = False
            _state["clean_reconnects"] += 1
            if not ENABLED:
                break
            _state["last_cooldown_sec"] = MIN_RECONNECT_GAP
            logger.info(
                "[massive-ws] session ended cleanly -- reconnect in %.0fs "
                "(server cleanup window)", MIN_RECONNECT_GAP,
            )
            await asyncio.sleep(MIN_RECONNECT_GAP)

        except asyncio.CancelledError:
            logger.info("[massive-ws] cancelled -- exiting")
            raise
        except Exception as e:
            _state["connected"] = False
            _state["last_error"] = str(e)
            _state["reconnect_count"] += 1

            err_str = str(e)
            if "max_connections" in err_str:
                idx = min(maxconn_strikes, len(MAXCONN_LADDER) - 1)
                sleep_for = MAXCONN_LADDER[idx]
                maxconn_strikes += 1
                _state["maxconn_strikes"] = maxconn_strikes
                uptime = time.time() - (_state.get("started_at") or time.time())
                capped = ""
                if uptime < MAXCONN_YOUNG_UPTIME_SEC and sleep_for > MAXCONN_YOUNG_CAP_SEC:
                    # Deploy-overlap residual: the zombie session dies within
                    # 10-30s server-side; probe again soon instead of eating
                    # a 5-10 minute hole in the tape.
                    sleep_for = MAXCONN_YOUNG_CAP_SEC
                    capped = " [young-process cap]"
                logger.warning(
                    "[massive-ws] max_connections -- cooldown %.0fs%s "
                    "(strike %d, uptime %.0fs)",
                    sleep_for, capped, maxconn_strikes, uptime,
                )
            else:
                sleep_for = backoff
                logger.warning(
                    "[massive-ws] connection error (%s) -- reconnect in %.1fs",
                    e, sleep_for,
                )
                backoff = min(backoff * 2, MAX_BACKOFF)

            _state["last_cooldown_sec"] = sleep_for
            await asyncio.sleep(sleep_for)

    logger.info("[massive-ws] consumer loop exiting (ENABLED=False)")
```

### Hunk 5 — watchdog re-arm in `_run_session`'s session-clear block (after `_state[\"quotes_received\"] = 0`, temp :1344 / origin :1349)

```diff
     _state["q_subscribed_count"] = 0
     _state["quotes_received"] = 0
+
+    # Deploy-survival patch: reset the watchdog's staleness anchor for the
+    # NEW session. Without this, a fresh session inherits the pre-disconnect
+    # last_trade_ts; if the outage exceeded STALE_THRESHOLD_SEC the watchdog
+    # kills the brand-new healthy connection on its first 10s check --
+    # making the watchdog->reconnect->cooldown loop self-sustaining.
+    # None re-arms the watchdog's grace path ("no events yet -- give it time").
+    _state["last_trade_ts"] = None
```

### Hunk 6 — teardown guards in the three network managers (mirrors the watchdog's existing `else: break` pattern)

`q_subscription_manager` (temp :1450-1454 / origin :1455-1459):
```diff
         while not stop_event.is_set():
             try:
                 await asyncio.wait_for(stop_event.wait(), timeout=5.0)
             except asyncio.TimeoutError:
                 pass
+            else:
+                # Session tearing down: the socket is dying and Massive clears
+                # subscriptions on disconnect anyway. Skipping the final send
+                # keeps stop() teardown inside its 5s join budget.
+                break
```

`spot_fetch_manager` (temp :1550-1554 / origin :1555-1559) — same three lines (`else: break` with comment `# skip the final Yahoo batch (up to 8s) during teardown`).

`oi_fetch_manager` (temp :1606-1610 / origin :1611-1615) — same three lines (`# skip the final Schwab batch during teardown; next session re-queues`).

**The `flusher` is deliberately NOT guarded** — its final pass writes Side-classified events for stale buckets; `_run_session`'s finally then `flush_all()`s the remainder. Both writes are sync and complete once started.

### Hunk 7 — thread entry + `stop()` (replaces `_thread_main`, temp :1942-1951 / origin :1947-1956; `start()` is UNTOUCHED, so it does not collide with Ravi's new spot-backfill thread there)

```python
async def _consumer_root():
    """Root coroutine for the consumer thread's event loop.

    Exists so stop() -- called from ANOTHER thread (uvicorn's lifespan
    teardown) -- has a Task handle to cancel and a loop to schedule the cancel
    on. Captures both into _state BEFORE the first await so the
    stop()-before-refs race window is microseconds.
    """
    _state["loop"] = asyncio.get_running_loop()
    _state["root_task"] = asyncio.current_task()
    try:
        await _consume_forever()
    except asyncio.CancelledError:
        # Terminal cancel from stop(). Swallow it HERE -- not in
        # _consume_forever, which must re-raise so the websockets context
        # manager's __aexit__ runs the closing handshake -- so asyncio.run()
        # returns instead of dumping a CancelledError via threading.excepthook.
        logger.info("[massive-ws] root task cancelled -- graceful stop complete")
    finally:
        _state["loop"] = None
        _state["root_task"] = None


def _thread_main():
    """Run the asyncio loop in this dedicated thread."""
    try:
        asyncio.run(_consumer_root())
    except Exception as e:
        logger.exception("[massive-ws] thread crashed: %s", e)
        _state["last_error"] = f"thread_crash: {e}"
    finally:
        _state["running"] = False
        _state["connected"] = False


def stop(timeout: float = 5.0) -> bool:
    """Gracefully stop the WS consumer. Safe from any thread, any number of
    times, whether or not start() ever ran.

    Sequence:
      1. Flip module-level ENABLED so `while ENABLED` exits even if the cancel
         below is lost (e.g. thread hasn't registered loop/task refs yet).
         Verified 2026-07-06: no module does `from ... import ENABLED`, so the
         reassignment is seen everywhere.
      2. call_soon_threadsafe(root_task.cancel) -- FIRST call only. Lands
         CancelledError at the consumer's current await; the websockets
         context manager's __aexit__ then performs the closing handshake
         (close frame, bounded by close_timeout=3), so Massive sees a CLEAN
         disconnect and frees the slot in seconds instead of holding a zombie
         session for 10-30s+ that trips the next process into max_connections.
      3. join(timeout): bounded. On timeout we return False -- the daemon
         thread finishes behind us inside the Railway drain window.
    """
    global ENABLED
    already_requested = _state.get("stop_requested", False)
    _state["stop_requested"] = True
    ENABLED = False

    t = _state.get("thread")
    if t is None or not t.is_alive():
        logger.info("[massive-ws] stop(): consumer not running -- nothing to do")
        return True

    if not already_requested:
        loop = _state.get("loop")
        task = _state.get("root_task")
        if loop is not None and task is not None:
            try:
                loop.call_soon_threadsafe(task.cancel)
                logger.info("[massive-ws] stop(): cancel scheduled on consumer loop")
            except RuntimeError:
                pass  # loop already closed -- thread exiting on its own
        else:
            logger.info(
                "[massive-ws] stop(): no loop/task refs yet -- relying on "
                "ENABLED flag"
            )
    # else: a second stop() must NOT cancel again -- a second CancelledError
    # would land inside _run_session's finally (BaseException escapes the
    # `except Exception` guards there) and abort the final flush.

    t.join(timeout)
    if t.is_alive():
        logger.warning(
            "[massive-ws] stop(): thread still alive after %.1fs -- daemon "
            "thread finishes during the remaining drain window", timeout,
        )
        return False
    logger.info("[massive-ws] stop(): consumer thread exited cleanly")
    return True
```

---

## Part 2 — `api/main.py` (Patrick's hunk; lifespan teardown, NOT @app.on_event)

main.py already uses `FastAPI(lifespan=lifespan)` — an `@app.on_event("shutdown")` handler would be **silently ignored**. Insert at main.py:2753 (origin/master):

```diff
     yield
+    # -- Massive WS graceful stop (deploy-survival P1) ---------------------
+    # Runs on SIGTERM during the Railway drain window. Sends a clean WS close
+    # so Massive frees the OPRA slot in seconds and the replacement deploy
+    # doesn't hit max_connections. Defensive getattr: if this deploys before
+    # the massive_ws_worker patch, it's a no-op (dangling-import playbook --
+    # merge order can't crash boot OR shutdown).
+    try:
+        import asyncio as _aio  # main.py has no top-level asyncio import
+        from api import massive_ws_worker as _mww
+        _mww_stop = getattr(_mww, "stop", None)
+        if callable(_mww_stop):
+            # stop() blocks up to ~5s in thread.join -- run in a worker thread
+            # so the event loop keeps servicing uvicorn's shutdown work.
+            _clean = await _aio.to_thread(_mww_stop, 5.0)
+            print(f"[shutdown] Massive WS consumer stop: "
+                  f"{'clean' if _clean else 'join timed out (daemon finishing in drain window)'}")
+        else:
+            print("[shutdown] Massive WS stop() not present -- skipping (pre-patch module)")
+    except Exception as e:
+        print(f"[shutdown] Massive WS stop failed (non-fatal): {e}")
     if _scheduler is not None:
         _scheduler.shutdown(wait=False)
     stop_snapshot_scheduler()
```

(When P5 moves the consumer to the worker service, the identical block goes into worker_main's shutdown path.)

---

## Self-attack results (what I probed and what the patch does about it)

**Cancellation matrix** (single cancel from stop(), guaranteed by the `stop_requested` guard; asyncio.run never re-cancels its finished main task):
- **Inside `websockets.connect` handshake (`__aenter__`)**: CancelledError aborts the in-progress handshake; the library closes the transport. No close frame exists yet (session not established) — nothing for Massive to hold. Propagates → `except CancelledError: raise` → `_consumer_root` swallows → thread exits.
- **Inside `asyncio.sleep(...)` (cooldown/ladder/gap)**: raises immediately out of the while loop. No socket open — no close needed. Fastest path (~ms).
- **Inside `_run_session`'s `async for`**: CancelledError raises at the recv await → **finally runs in full**: `stop_event.set()` → the four manager awaits return quickly (flusher does one last classified write; q/spot/oi now `break` instead of firing final network batches) → watchdog cancelled → **`agg.flush_all()` + drain + `_write_events` runs synchronously to completion — buffered aggregates are WRITTEN, not lost** (they land Side-unclassified, same as today's disconnect path). Then the exception exits the `async with` → `__aexit__` sends a real close frame (code 1011 on websockets≥14, 1000 on legacy — both clean handshakes), bounded by `close_timeout=3`. Total teardown ≈ 0.5–4s, inside join(5) except under severe SQLite contention (logged, non-fatal: daemon + 30s drain).
- **Residual edge**: a CancelledError delivered *while the finally is awaiting a manager task* would escape the `except Exception` guards and skip the final flush — impossible by construction here (only one cancel is ever scheduled), documented in the code comment.

**Does `thread.join(5)` block the uvicorn loop?** It would — Starlette runs lifespan teardown (and sync on_event handlers) inline on the event loop, no threadpool. The snippet wraps stop() in `asyncio.to_thread`, so the loop keeps draining while we wait. Even in the worst case the whole budget (5s SSE cap + ~5s stop + scheduler shutdown) fits the 30s drain.

**Idempotency**: stop-before-start → no thread → returns True after flipping ENABLED (start() afterwards correctly refuses: process is shutting down). Double-stop → second call skips re-cancel, just re-joins. stop() on the worker service (ENABLED=0, never started) → no-op.

**Other managers on the same loop**: q/spot/oi/watchdog are child tasks of the session, not of the root task — root-cancel does NOT cancel them directly; they exit via `stop_event` + the `else: break` guards. Ravi's new `massive-spot-backfill` thread (origin-only) is untouched: daemon, transactional SQLite, dies harmlessly with the process.

**ENABLED caching**: `while ENABLED` (:1253), `get_status` (:221), `start` (:1969) all do runtime global lookups; `git grep origin/master` confirms no `from api.massive_ws_worker import ENABLED` anywhere — reassignment is authoritative. (The env var itself is still read once at import; the docstring's \"without redeploying\" claim was already wrong and is unrelated.)

**`_state` serialization**: new loop/root_task handles would 500 `/api/live/massive/status` — get_status now pops them (Hunk 3).

---

## Test plan — never touches the prod slot

**Rule zero: the prod MASSIVE_API_KEY never leaves the web service. `DRY_RUN=1` does NOT protect the slot — it gates FlowDB writes only; the WS connection is still made and consumes the single per-asset-class connection.** Flipping the worker service's `MASSIVE_WS_ENABLED` to 1 \"for staging\" would cause a live outage the same way. Ask Massive support whether a sandbox key exists (bundle with the lockout-semantics question).

### 1. Unit tests vs a local mock WS server (`tests/test_massive_ws_stop.py`)

Harness: `websockets.serve` on `127.0.0.1:<ephemeral>`; monkeypatch module attrs after import (`MASSIVE_OPTIONS_WS_URL`, `MASSIVE_API_KEY=\"test-key-not-prod\"`, `DRY_RUN=True`, `MIN_RECONNECT_GAP=1.0`, `MAXCONN_LADDER=(0.2,0.4,0.8)`, `_build_warm_start_contracts` → `[]`, `_write_events` → capture list). Fixture hard-guard before any `start()`:

```python
assert mww.MASSIVE_OPTIONS_WS_URL.startswith("ws://127.0.0.1"), "TEST SAFETY: never a real Massive URL"
assert "test-key" in mww.MASSIVE_API_KEY
```

Mock server modes: `normal` (hello→auth_success→sub-ack→optional T stream→record `ws.close_code` on exit), `max_conn` (send `max_connections` status at hello), `close_1001` (clean-close after sub-ack), recording `accept_times` monotonic timestamps.

Cases:
1. **stop() sends a close frame + joins**: start → wait `_state[\"connected\"]` → stop() → returns True in <5s; server recorded `close_code in (1000, 1001, 1011)`; `_state[\"running\"] is False`; `json.dumps(get_status())` succeeds and shows `graceful_stop: true`.
2. **stop() during cooldown**: `max_conn` mode → wait `_state[\"last_cooldown_sec\"]` → stop() → joins <2s (cancel lands in the ladder sleep).
3. **stop() during handshake**: server accepts TCP then stalls before hello → stop() while consumer is in `wait_for(ws.recv(), 10)` → clean exit.
4. **Clean-close gap**: `close_1001` mode → assert `accept_times[1] - accept_times[0] >= MIN_RECONNECT_GAP - ε` (kills the zero-gap bug forever) and `_state[\"clean_reconnects\"] >= 1`.
5. **Ladder + reset**: perpetual `max_conn` → observed accept intervals ≈ 0.2/0.4/0.8/0.8…; `maxconn_strikes` climbs; flip mock to `normal` → after auth_success `_state[\"maxconn_strikes\"] == 0`. Young-process cap: set `MAXCONN_YOUNG_CAP_SEC=0.3` → intervals clamp at 0.3 while uptime < threshold.
6. **Watchdog re-arm**: seed `_state[\"last_trade_ts\"] = time.time() - 999` → drive one session → assert it was reset to None in the session-clear block before first T, then updates on first trade.
7. **Idempotency**: stop() twice; stop() before start(); stop() immediately after start() in a 50-iteration loop — no exceptions, no hangs.
8. **Final flush on stop**: stream T events passing filters (e.g. `O:SPY260918C00500000`, price 5.0 × size 60 = $30k premium ≥ MIN_PREMIUM, vol ≥ MIN_VOLUME) → stop() before the 2s flush tick → patched `_write_events` received the drained aggregates (flush_all path). Mark `xfail(strict=False)` initially if `massive_processor` fixtures fight back; the flush path is also covered by prod behavior unchanged.

### 2. After-hours prod smoke (market closed: watchdog inactive, tape quiet)

Deploy after 8 PM ET. Then trigger ONE more no-op redeploy and check:
- **OLD deployment logs** (the acceptance test for all of P1): `[shutdown] Massive WS consumer stop: clean` → `[massive-ws] stop(): cancel scheduled on consumer loop` → `[massive-ws] root task cancelled -- graceful stop complete` → `[massive-ws] stop(): consumer thread exited cleanly`.
- **NEW deployment logs**: `[startup] Massive WS consumer started` → `hello:` → `auth:` containing auth_success **on the first attempt — zero `max_connections at hello`**.
- `GET /api/live/massive/status`: `graceful_stop: true`, `min_reconnect_gap: 30`, `maxconn_strikes: 0`, `stop_requested: false`, `connected: true`, fresh `uptime_sec`.

### 3. Next-trading-morning watch (9:30–10:30 ET)

- `/status` `last_event_age_sec` stays < 60; `clean_reconnects`/`watchdog_force_reconnects` ideally 0.
- If a WATCHDOG line appears: the follow-up must now be `session ended cleanly -- reconnect in 30s` then auth_success ≈ 35–45s later, **not** `max_connections` + 600s. If max_connections still follows a 30s gap, raise `MASSIVE_MIN_RECONNECT_GAP` to 45 (env change; apply after hours — env edits redeploy).
- If watchdog closes recur at all, execute the spec's contingency: offload `_write_events` to an executor (root de-staller).

### Dev-local-instance hypothesis (could a developer's box with the prod key explain the 7/6 morning flapping?)

**Assessed: inconsistent with the evidence — low likelihood.** (1) Fresh deploys consistently *ended* outages; if an external process held the slot, a fresh deploy would hit `max_connections at hello` immediately instead of connecting clean. (2) Outage windows quantize to ~60s stale + ~600s ≈ 9–11 min — the exact client-side `MAX_CONN_COOLDOWN` signature; slot ping-pong between two live clients produces irregular fast alternation and near-continuous max_connections logs, not 16 discrete windows. (3) 7/2 was a perfect 390/390 session under presumably identical dev habits; onset correlates with launch-day load + 100% streaming (the Class B stall trigger), not a new local runner. The near-periodic ~20-min cycle = ~9 min healthy tape until the next morning-load flush stall + ~11 min watchdog→cooldown outage. **Cheap falsification anyway**: ask Ravi directly, and grep 7/6 logs for `max_connections at hello` events NOT preceded within ~2 min by a `WATCHDOG:` line or a boot banner — any such orphan would indicate external slot contention.

---

## Rollout

1. **Order**: P0 config first (drain=30s + `--timeout-graceful-shutdown 5` — the latter is a hard P1 prerequisite: uvicorn waits on open SSE streams *before* running lifespan teardown). Then this patch, **after 4 PM ET**, via an isolated worktree against origin/master (never `git add -A`; ship `push origin <branch>:master` after Ravi reviews the `massive_ws_worker.py` half — his file; the main.py hunk is Patrick's and is safe to land first thanks to the getattr guard).
2. **Post-deploy**: run the after-hours smoke (section 2), then the morning watch (section 3).
3. **Rollback**: revert the commit (also after hours). The main.py hook degrades to a logged no-op against the old module; nothing else depends on the new fields.
4. **Held pending Massive support**: nothing in this patch retries faster than 30s; if support answers that at-limit attempts extend lockouts, raise `MASSIVE_MAXCONN_YOUNG_CAP`/`MASSIVE_MIN_RECONNECT_GAP` via env — no code change.

---
## Risk appendix

**P1-R1** (high×critical): Shutdown hook registered via @app.on_event('shutdown') per the spec's instruction NEVER fires: origin/master main.py already uses FastAPI(lifespan=lifespan) (main.py:760-761, app construction after :2757). Starlette only runs on_shutdown handlers from its default lifespan; a custom lifespan replaces it, so the hook is a silent no-op and the entire P1 deploy-survival win is dead code.
- Mitigation: Register the stop in the lifespan teardown (after `yield`, before _scheduler.shutdown) — exact snippet in deliverable. v2 doc must rewrite P1 item 1's registration instruction.
- Verify: After-hours redeploy: OLD deployment's logs must show '[shutdown] Massive WS consumer stop: clean' followed by '[massive-ws] stop(): consumer thread exited cleanly'; NEW deployment must auth_success on first attempt with no 'max_connections at hello'.

**P1-R2** (medium×high): SIGKILL lands before the lifespan teardown runs: without RAILWAY_DEPLOYMENT_DRAINING_SECONDS>0 (P0) nothing here executes; and uvicorn waits for open connections (hundreds of live SSE streams at 100% streaming rollout) BEFORE running lifespan shutdown, so without --timeout-graceful-shutdown 5 the teardown can be starved past the drain window.
- Mitigation: Hard-order the rollout: P0 (drain=30s + --timeout-graceful-shutdown 5) must be live BEFORE or WITH this patch. Note in v2 doc that P0's graceful-shutdown flag is a P1 prerequisite, not just SSE hygiene.
- Verify: Railway env/API check for both settings, then the same redeploy log-pair check as P1-R1.

**P1-R3** (medium×medium): Teardown exceeds thread.join(5): the final flush (_write_events, sync SQLite) can take seconds under contention, and pre-patch the spot/oi/q managers could each fire a last network batch (Yahoo up to 8s, Schwab batch) after stop_event set, blowing the budget so the close frame goes out late.
- Mitigation: Patch adds `else: break` teardown guards to q/spot/oi managers (skip the final network body when stopping — server clears subs on disconnect anyway) and close_timeout=3 on connect. join timeout is non-fatal by design: daemon thread finishes inside the 30s drain; stop() logs and returns False.
- Verify: Unit test: stop() returns within ~2s against the mock server. Prod: grep old-deploy logs for '[massive-ws] stop(): thread still alive after' — should be absent or rare.

**P1-R4** (low×low): A second CancelledError delivered while _run_session's finally block is awaiting manager tasks would escape the `except Exception` guards (CancelledError is BaseException in py3.8+), skipping the final flush_all write — buffered aggregates lost.
- Mitigation: stop() is guarded by _state['stop_requested']: only the FIRST call schedules task.cancel; repeat calls just re-join. asyncio.run never re-cancels its own main task, so exactly one CancelledError is delivered by construction.
- Verify: Unit test: double-stop() and stop-before-start() return True without exceptions; patched _write_events still receives the final drain.

**P1-R5** (high×medium): Storing loop/root_task handles in _state makes get_status()'s dict(_state) non-JSON-serializable → /api/live/massive/status (and the P3 monitor that polls it) 500s.
- Mitigation: get_status() pops 'loop' and 'root_task' alongside the existing 'thread' pop (in the patch).
- Verify: Unit test json.dumps(get_status()); prod smoke curls /api/live/massive/status and checks graceful_stop:true.

**P1-R6** (medium×medium): If Massive support answers that at-limit connect attempts EXTEND the lockout, the ladder's early rungs (30/60s) and the young-process 60s cap probe more often than the old blind 600s and could lengthen real lockouts.
- Mitigation: No retry anywhere is <30s (complies with the spec's HOLD and Massive's 10-30s guidance). Ladder cap knobs are env-tunable (MASSIVE_MAXCONN_YOUNG_CAP / _YOUNG_UPTIME) so the response to support's answer is a config change, not a code change. maxconn_strikes is exposed in /status for the P3 monitor to alert on ≥3.
- Verify: Massive support reply; watch maxconn_strikes in /status after the first market-hours deploy — expect 0 or 1, never climbing.

**P1-R7** (low×medium): Watchdog re-arm (last_trade_ts=None on session start) makes the watchdog blind to a session that authenticates but never delivers trades during market hours (e.g. subscribe silently broken).
- Mitigation: Accept: the T.* firehose delivers trades within seconds during market hours and hello/auth/sub each have 10s timeouts; the P3 independent monitor (>3 min alert on last_event_age_sec) is the designed backstop for exactly this residual.
- Verify: P3 monitor alert fires in a staged test (temporarily point it at a stale timestamp).

**P1-R8** (medium×low): websockets version drift: requirements pin is `websockets>=12.0`, so builds resolve to the new asyncio implementation (>=14) where context-manager exit under an exception (incl. CancelledError) sends close code 1011, while legacy sends 1000. Tests or log-greps asserting code 1000 would falsely fail; behavior differences in close() timing exist between implementations.
- Mitigation: Tests accept close_code in {1000, 1001, 1011}; both implementations send a real close frame (which is all Massive's slot accounting needs) and both accept close_timeout=. Optionally pin websockets to a known minor in requirements.txt during this change.
- Verify: Unit test records server-side close_code; after-hours smoke confirms next process auths first-try.

**P1-R9** (medium×high): Any local/dev run with the prod MASSIVE_API_KEY — including DRY_RUN=1, which gates only DB writes, NOT the connection — consumes the single prod OPRA slot and causes a live outage. Same applies to flipping the worker service's MASSIVE_WS_ENABLED to 1 for 'staging'.
- Mitigation: Test-safety rules in deliverable: prod key never leaves the web service; all local tests run against the localhost mock server with a fake key and a hard `assert MASSIVE_OPTIONS_WS_URL.startswith('ws://127.0.0.1')` guard before start(); worker stays ENABLED=0. Ask Massive support whether a sandbox/second key is available.
- Verify: Test fixture asserts the URL guard; code review checklist item on the PR.

**P1-R10** (low×low): Race: stop() called in the instant after t.start() but before _consumer_root stores loop/root_task — the cancel is never scheduled and the thread only exits via the ENABLED flag at the next `while ENABLED` check, which can be up to one cooldown-sleep away (worst case 600s, longer than the drain).
- Mitigation: Refs are captured before the first await in _consumer_root (microsecond window); ENABLED=False guarantees no NEW connection is opened; thread is daemon so process exit reaps it — the only loss is the close frame in an already-degenerate timing, equivalent to today's behavior.
- Verify: Unit test: stop() immediately after start() in a tight loop, 50 iterations, no hang, no exception.

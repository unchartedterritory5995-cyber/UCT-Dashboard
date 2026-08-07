"""`/api/signature/confluence-scan` — the ten-minute request, bounded.

WHAT THIS FILE EXISTS TO STOP
-----------------------------
The scan looped up to 40 symbols through `_dpc_cached` -> `_fetch_flow_by_date`
with no serve-stale and no pacing. Each of those reads is bounded by
`_FLOW_READ_BUDGET_S`, so a fully cold list was bounded at
`40 x 15 = 600 seconds` on a single anyio worker. The web pod is ONE uvicorn
process with ONE event loop and ONE 64-slot threadpool shared by every user, so
a request able to hold a worker for ten minutes is the 2026-07-01 outage class
(`incident_524_single_process_overload`) with a query string in front of it.

Three separate failures live in here and each gets its own rail:

1. **Occupancy.** A cold scan must not cost what 40 sequential builds cost, and
   the bound must be arithmetic rather than hopeful.
2. **The shared budget.** `lesson_bulk_job_starves_a_shared_rate_budget`: an
   unpaced sweep 429'd on its FIRST call, engaged a shared cooldown, raced
   through everything reading empty, and REPORTED SUCCESS. The correction is to
   pace to a minority of the budget and to make an unread symbol say so.
3. **The empty answer.** A failed flow read used to become `ok: True,
   signals: []`, cached for 300 s — `lesson_market_cap_cache_poison` wearing a
   green tick. A symbol the scan did not reach must be `pending`, never quiet.
"""
import threading
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import signature as sig
from api.middleware.auth_middleware import get_current_user_with_plan


def _syms(n: int) -> list[str]:
    """`n` distinct LETTER-ONLY symbols — `_SYM_RE` refuses digits, so a
    generated "SYM01" would be dropped before the scan ever saw it and every
    count below would quietly measure zero."""
    az = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    out = []
    for a in az:
        for b in az:
            out.append(f"S{a}{b}")
            if len(out) == n:
                return out
    raise AssertionError("ran out of symbols")


@pytest.fixture(autouse=True)
def lane(monkeypatch):
    """Reset every piece of module-level lane state, and make sure no warmer
    thread outlives the test that started it.

    The warmer is a daemon thread that calls `_dpc_build`. `monkeypatch` undoes
    its patches at teardown, so a warmer still running afterwards would call the
    REAL build — a live dark-pool read and a live flow read, from a test that
    has already reported green. Draining the queue and waiting for the thread to
    notice is not tidiness; it is the difference between a hermetic suite and
    one that occasionally reaches the network.
    """
    for slot in (sig._DPC_STALE,):
        slot._slots.clear()
    with sig._DPC_WARM_LOCK:
        sig._DPC_WARM_QUEUE.clear()
    sig._DPC_PACE_NEXT_AT = 0.0
    sig.cache.delete_prefix("sig:")
    yield
    with sig._DPC_WARM_LOCK:
        sig._DPC_WARM_QUEUE.clear()
    deadline = time.time() + 5.0
    while sig._DPC_WARM_RUNNING and time.time() < deadline:
        time.sleep(0.01)
    assert not sig._DPC_WARM_RUNNING, "a warm thread outlived its test"
    with sig._DPC_WARM_LOCK:
        sig._DPC_WARM_QUEUE.clear()
    sig._DPC_STALE._slots.clear()
    sig.cache.delete_prefix("sig:")


@pytest.fixture
def app():
    a = FastAPI()
    a.include_router(sig.router)
    a.dependency_overrides[get_current_user_with_plan] = lambda: {
        "id": "u1", "role": "user", "plan": "premium"}
    return a


def _slow_build(delay, calls=None, signals=None):
    def build(sym):
        if calls is not None:
            calls.append(sym)
        time.sleep(delay)
        return {"ok": True, "sym": sym, "signals": list(signals or []),
                "levels": [], "close": 10.0, "asOf": time.time(),
                "version": "dpc-v1"}
    return build


def _hot(monkeypatch, delay=0.0, calls=None, signals=None):
    """Patch the BUILD, not the fetchers: every rail below is about the lane
    that surrounds a build, and stubbing the build is what makes its cost a
    number this file controls."""
    monkeypatch.setattr(sig, "_dpc_build", _slow_build(delay, calls, signals))


# ═══════════════════════════════════════════════════════════════════════════
# 1. OCCUPANCY — the ten minutes
# ═══════════════════════════════════════════════════════════════════════════

def test_the_worst_case_occupancy_is_ARITHMETIC_and_it_is_not_ten_minutes():
    """The before and the after, as the two numbers they are.

    BEFORE: the handler started a build for every symbol on the list with
    nothing in between, so the only bound was the per-build one —
    `_DPC_SCAN_MAX_SYMS x _FLOW_READ_BUDGET_S`.

    AFTER: a cold build is only STARTED while the wall-clock budget is unspent,
    and a build is itself bounded, so the worst case is
    `_DPC_SCAN_BUDGET_S + _FLOW_READ_BUDGET_S` — one budget, plus the single
    build that may have begun on its last instant.

    Pinned as an inequality AND as the two literals, because "it is bounded" is
    the kind of claim that survives the bound being raised to something equally
    useless.
    """
    before = sig._DPC_SCAN_MAX_SYMS * sig._FLOW_READ_BUDGET_S
    after = sig._DPC_SCAN_BUDGET_S + sig._FLOW_READ_BUDGET_S
    assert before == 600.0, before
    assert after == 25.0, after
    assert after < before / 20


def test_a_cold_forty_symbol_scan_no_longer_COSTS_what_forty_builds_cost(monkeypatch):
    """The measurement, on this box, of the shape that changed.

    The control is the OLD handler's loop written out verbatim — `for s in
    syms: _dpc_cached(s)` — over its own untouched symbol set, so the two halves
    differ in the lane and in nothing else. Same stub build, same delay, same
    process.
    """
    per_build = 0.05
    _hot(monkeypatch, delay=per_build)
    monkeypatch.setattr(sig, "_DPC_SCAN_BUDGET_S", 0.30)
    monkeypatch.setattr(sig, "_DPC_COLD_PACE_S", 0.0)
    monkeypatch.setattr(sig, "_dpc_queue_warm", lambda syms: None)

    old_syms = _syms(40)
    new_syms = [s + "X" for s in old_syms]      # a DIFFERENT cold set

    t0 = time.monotonic()
    for s in old_syms:                          # the shipped-before loop, verbatim
        sig._dpc_cached(s)
    old_elapsed = time.monotonic() - t0

    t0 = time.monotonic()
    body = sig._dpc_scan(new_syms)
    new_elapsed = time.monotonic() - t0

    print(f"\n  40 cold symbols @ {per_build}s/build: "
          f"BEFORE {old_elapsed:.2f}s -> AFTER {new_elapsed:.2f}s")
    assert old_elapsed > 40 * per_build * 0.8, (
        f"the control did not actually pay for 40 builds ({old_elapsed:.2f}s) — "
        "without that this comparison measures nothing")
    assert new_elapsed < old_elapsed / 3, (old_elapsed, new_elapsed)
    assert body["pending"], "a bounded scan that reached everything proves nothing here"


def test_the_scan_starts_NO_cold_build_once_its_budget_is_spent(monkeypatch):
    """The bound is enforced at the point a build is STARTED. Checking it after
    the fact would let the 40th build begin at second 599."""
    calls = []
    _hot(monkeypatch, delay=0.05, calls=calls)
    monkeypatch.setattr(sig, "_DPC_SCAN_BUDGET_S", 0.20)
    monkeypatch.setattr(sig, "_DPC_COLD_PACE_S", 0.0)
    monkeypatch.setattr(sig, "_dpc_queue_warm", lambda syms: None)

    body = sig._dpc_scan(_syms(40))

    assert len(calls) < 40, f"every symbol was still built: {len(calls)}"
    assert len(calls) == body["evaluated"]
    assert len(body["pending"]) == 40 - len(calls)


def test_a_warm_symbol_never_loses_its_answer_to_a_budget_a_cold_one_spent(monkeypatch):
    """Two passes, and the ORDER is the point.

    A single loop would scan `[cold, warm]` in list order, the cold one would
    spend the budget, and the warm one — whose answer was already sitting in the
    cache and cost nothing — would be reported as pending. The user's own
    watchlist ordering would decide which of their names got an answer.
    """
    _hot(monkeypatch, delay=0.05, signals=[{"score": 7.0, "direction": "bull"}])
    monkeypatch.setattr(sig, "_DPC_COLD_PACE_S", 0.0)
    monkeypatch.setattr(sig, "_dpc_queue_warm", lambda syms: None)

    sig._dpc_cached("WARM")                       # now in the TTL cache
    assert sig._dpc_ready("WARM") is not None

    monkeypatch.setattr(sig, "_DPC_SCAN_BUDGET_S", 0.0)   # no cold work at all
    body = sig._dpc_scan(["COLD", "WARM"])

    assert body["pending"] == ["COLD"]
    assert [h["sym"] for h in body["signals"]] == ["WARM"]
    assert body["evaluated"] == 1 and body["complete"] is False


# ═══════════════════════════════════════════════════════════════════════════
# 2. THE SHARED BUDGET — a minority of it, and paced
# ═══════════════════════════════════════════════════════════════════════════

def test_the_cold_lane_holds_a_MINORITY_of_the_threadpool(monkeypatch):
    """At most `_DPC_COLD_LANE_SLOTS` workers inside a cold build at once,
    across every caller — 2 of the 64 anyio slots, ~3 %.

    The non-vacuity half matters as much as the bound: the test asserts that
    somebody was actually TURNED AWAY. A lane that admitted everyone would also
    satisfy "max concurrent <= 2" if the threads happened not to overlap.
    """
    live, peak, refused = [0], [0], [0]
    lock = threading.Lock()

    def build(sym):
        with lock:
            live[0] += 1
            peak[0] = max(peak[0], live[0])
        time.sleep(0.15)
        with lock:
            live[0] -= 1
        return {"ok": True, "sym": sym, "signals": [], "asOf": 0.0}

    monkeypatch.setattr(sig, "_dpc_build", build)
    monkeypatch.setattr(sig, "_DPC_COLD_PACE_S", 0.0)

    def run(s):
        if sig._dpc_cold(s) is None:
            with lock:
                refused[0] += 1

    threads = [threading.Thread(target=run, args=(f"T{c}",)) for c in "ABCDEF"]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)

    assert peak[0] <= sig._DPC_COLD_LANE_SLOTS, peak[0]
    assert refused[0] >= 1, (
        "no caller was ever turned away, so this measured a queue that never "
        "formed rather than a lane that bounds one")


def test_a_caller_that_cannot_get_a_slot_is_NOT_QUEUED_behind_one(monkeypatch):
    """Non-blocking on purpose. Queueing for the slot rebuilds the pile-up the
    slot exists to prevent — the waiters still hold their anyio workers, they
    just hold them somewhere less visible."""
    _hot(monkeypatch, delay=0.0)
    held = [sig._DPC_COLD_LANE.acquire(blocking=False)
            for _ in range(sig._DPC_COLD_LANE_SLOTS)]
    assert all(held)
    try:
        t0 = time.monotonic()
        answer = sig._dpc_cold("NVDA")
        elapsed = time.monotonic() - t0
    finally:
        for _ in held:
            sig._DPC_COLD_LANE.release()

    assert answer is None, "a full lane must not build"
    assert elapsed < 0.25, f"the caller waited {elapsed:.2f}s for a slot"


def test_two_cold_builds_are_PACED_apart_lane_wide(monkeypatch):
    """The pace is lane-wide, not per-request: two scans that know nothing about
    each other still take turns. Measured as elapsed time across three builds
    driven through the real `_dpc_cold`."""
    _hot(monkeypatch, delay=0.0)
    monkeypatch.setattr(sig, "_DPC_COLD_PACE_S", 0.12)
    sig._DPC_PACE_NEXT_AT = 0.0

    t0 = time.monotonic()
    for s in ("PA", "PB", "PC"):
        assert sig._dpc_cold(s) is not None
    elapsed = time.monotonic() - t0

    # Three builds, two gaps. The first call reserves the next slot rather than
    # sleeping, so the floor is 2 x pace, not 3.
    assert elapsed >= 2 * 0.12, f"{elapsed:.3f}s — the builds were not paced"


def test_the_scan_hands_its_leftovers_to_exactly_ONE_warmer(monkeypatch):
    """One thread for the whole lane, however many scans ask.

    A thread per scan would move the fan-out this endpoint just lost off the
    request path — where at least the anyio pool bounded it — into a place
    nothing bounds at all.
    """
    _hot(monkeypatch, delay=0.02)
    monkeypatch.setattr(sig, "_DPC_WARM_PACE_S", 0.0)
    monkeypatch.setattr(sig, "_DPC_SCAN_BUDGET_S", 0.0)

    before = {t.name for t in threading.enumerate() if t.name == "sig-dpc-warm"}
    assert not before

    sig._dpc_scan(_syms(6))
    sig._dpc_scan(_syms(6))                  # a second scan, same leftovers
    sig._dpc_scan([s + "Q" for s in _syms(6)])

    warmers = [t for t in threading.enumerate() if t.name == "sig-dpc-warm"]
    assert len(warmers) <= 1, [t.name for t in warmers]

    deadline = time.time() + 5.0
    while sig._DPC_WARM_RUNNING and time.time() < deadline:
        time.sleep(0.01)
    assert sig._dpc_ready(_syms(6)[0]) is not None, (
        "the warmer never actually warmed anything — a warmer that does not "
        "warm makes the next scan pay the same budget again")


def test_the_warmer_makes_the_NEXT_scan_complete(monkeypatch):
    """Serve-stale, applied to a batch: the first caller pays a bounded slice
    and the background finishes the job, so the second caller is complete and
    instant. That is the whole reason a partial answer is acceptable."""
    _hot(monkeypatch, delay=0.0)
    monkeypatch.setattr(sig, "_DPC_WARM_PACE_S", 0.0)
    monkeypatch.setattr(sig, "_DPC_COLD_PACE_S", 0.0)
    monkeypatch.setattr(sig, "_DPC_SCAN_BUDGET_S", 0.0)

    syms = _syms(5)
    first = sig._dpc_scan(syms)
    assert first["complete"] is False and len(first["pending"]) == 5

    deadline = time.time() + 5.0
    while sig._DPC_WARM_RUNNING and time.time() < deadline:
        time.sleep(0.01)

    second = sig._dpc_scan(syms)
    assert second["complete"] is True, second
    assert second["pending"] == [] and second["evaluated"] == 5


# ═══════════════════════════════════════════════════════════════════════════
# 3. THE EMPTY ANSWER — an unread symbol is never a quiet one
# ═══════════════════════════════════════════════════════════════════════════

def test_a_symbol_the_budget_did_not_reach_is_PENDING_never_a_quiet_tape(monkeypatch, app):
    """The response must make "not looked at" impossible to read as "nothing
    there". `signals: []` with a populated `pending` is a different statement
    from `signals: []` with `complete: true`, and the endpoint says which."""
    _hot(monkeypatch, delay=0.05)
    monkeypatch.setattr(sig, "_DPC_SCAN_BUDGET_S", 0.0)
    monkeypatch.setattr(sig, "_dpc_queue_warm", lambda syms: None)

    body = TestClient(app).get(
        "/api/signature/confluence-scan?syms=AAA,BBB,CCC").json()

    assert body["signals"] == []
    assert body["complete"] is False
    assert sorted(body["pending"]) == ["AAA", "BBB", "CCC"]
    assert body["evaluated"] == 0 and body["scanned"] == 3


def test_a_FAILED_flow_read_is_never_scored_as_no_confluence(monkeypatch):
    """🔴 THE POISONING, AND IT WAS SHIPPED.

    `_dpc_build` read the flow with `_fetch_flow_by_date(...) or {}`, and
    `_fetch_flow_by_date` returns **None** for a failed read precisely so its
    caller can tell an outage from a quiet tape — its entire docstring is about
    that distinction. Collapsing None to `{}` handed `confluence.evaluate` an
    empty join, which found nothing, which returned `ok: True, signals: []`,
    which was cached for 300 s and served to everyone.

    So a flow outage published "no confluence anywhere" as a successful answer,
    and nothing anywhere logged, raised or looked wrong.
    """
    monkeypatch.setattr(sig, "fetch_dp_levels",
                        lambda s: {"levels": [{"price": 10.0, "lo": 9.9, "hi": 10.1,
                                               "notional": 2e7, "rank": 1}]})
    monkeypatch.setattr(sig, "_fetch_bars", lambda s, n=60: [
        {"t": 20260601 + i, "o": 10.0, "h": 10.2, "l": 9.8, "c": 10.0, "v": 100}
        for i in range(30)])
    monkeypatch.setattr(sig, "_fetch_flow_by_date", lambda s, cutoff_iso="": None)

    payload = sig._dpc_build("NVDA")

    assert payload["ok"] is False, payload
    assert payload["error"] == "flow unavailable"
    assert sig.cache.get(sig._ck("dpc", "NVDA")) is None, "an outage was CACHED"
    assert sig._DPC_STALE.peek("NVDA") == (None, None), (
        "an outage was remembered as the last GOOD payload")


def test_the_next_scan_RETRIES_a_symbol_whose_read_failed(monkeypatch):
    """Retry THROUGH the cooldown, rather than remembering the answer read
    during it. `lesson_bulk_job_starves_a_shared_rate_budget`: the sweep that
    429'd on its first call then read empty for everything and reported
    success. Nothing here may remember an unanswered symbol as answered."""
    state = {"down": True}

    def build(sym):
        if state["down"]:
            return {"ok": False, "sym": sym, "signals": [], "error": "flow unavailable"}
        return {"ok": True, "sym": sym, "signals": [{"score": 3.0}], "asOf": 0.0}

    monkeypatch.setattr(sig, "_dpc_build", build)
    monkeypatch.setattr(sig, "_DPC_COLD_PACE_S", 0.0)
    monkeypatch.setattr(sig, "_dpc_queue_warm", lambda syms: None)

    first = sig._dpc_scan(["NVDA"])
    assert first["pending"] == ["NVDA"] and first["signals"] == []

    state["down"] = False
    second = sig._dpc_scan(["NVDA"])
    assert second["complete"] is True
    assert [h["sym"] for h in second["signals"]] == ["NVDA"]


def test_a_second_scan_of_a_warm_list_drives_NO_build_and_raises_no_ttl(monkeypatch):
    """The fix is serve-stale + single-flight, not a longer TTL. `_DPC_TTL_S`
    is pinned here so "make it faster" can never quietly become "make it
    staler" — `lesson_ttl_cache_expiry_makes_a_user_rebuild` is explicit that
    raising a TTL only picks WHICH user pays."""
    assert sig._DPC_TTL_S == 300
    assert sig._DPC_STALE.max_age == 1800

    calls = []
    _hot(monkeypatch, delay=0.0, calls=calls)
    monkeypatch.setattr(sig, "_DPC_COLD_PACE_S", 0.0)

    syms = _syms(5)
    sig._dpc_scan(syms)
    assert len(calls) == 5
    sig._dpc_scan(syms)
    assert len(calls) == 5, f"the warm scan rebuilt: {calls[5:]}"


def test_the_stale_slot_answers_after_the_ttl_lapses_and_refreshes_behind(monkeypatch):
    """The half of stale-while-revalidate that was missing entirely: dpc had a
    TTL cache and no stale slot, so every caller arriving after 300 s rebuilt —
    the treadmill `serve_stale.py`'s own docstring measures on /api/calendar."""
    calls = []
    _hot(monkeypatch, delay=0.0, calls=calls)

    sig._dpc_cached("NVDA")
    assert len(calls) == 1
    sig.cache.delete_prefix("sig:dpc:")            # the TTL lapses; the slot stays

    answer = sig._dpc_cached("NVDA")
    assert answer["ok"] is True and answer["sym"] == "NVDA"

    deadline = time.time() + 3.0
    while len(calls) < 2 and time.time() < deadline:
        time.sleep(0.01)
    assert len(calls) == 2, "the refresh never ran behind the caller"


def test_the_single_symbol_route_is_UNCHANGED_in_shape(monkeypatch, app):
    """`/confluence` still answers one symbol synchronously — it is one bounded
    read, not a fan-out, and returning `pending` there would change a contract
    for no gain. The lane bounds the SCAN."""
    _hot(monkeypatch, delay=0.0, signals=[{"score": 4.0, "direction": "bull"}])
    body = TestClient(app).get("/api/signature/confluence?sym=nvda").json()
    assert body["ok"] is True and body["sym"] == "NVDA"
    assert "pending" not in body
    assert [s["score"] for s in body["signals"]] == [4.0]


def test_the_scan_still_caps_the_list_and_still_drops_an_invalid_symbol(monkeypatch, app):
    """Two behaviours the rework had to carry across unchanged."""
    _hot(monkeypatch, delay=0.0)
    monkeypatch.setattr(sig, "_DPC_COLD_PACE_S", 0.0)
    monkeypatch.setattr(sig, "_dpc_queue_warm", lambda syms: None)
    c = TestClient(app)

    over = c.get("/api/signature/confluence-scan?syms="
                 + ",".join(_syms(50))).json()
    assert over["scanned"] == sig._DPC_SCAN_MAX_SYMS == 40

    mixed = c.get("/api/signature/confluence-scan?syms=NVDA,..,-,SPY").json()
    assert mixed["scanned"] == 2 and mixed["evaluated"] == 2

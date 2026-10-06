"""Boot contention (2026-10-06): a member never queues behind a boot warmer.

MEASURED on the 17:46 UTC web boot: three opens of `/api/research/estimates/TSM?consensus=1`
started 17:48:41, 17:49:36 and 17:50:18 and all answered within 7 ms of each other at
17:50:23 (102 s, 47 s, 5 s; identical 1845-byte bodies) while `/api/ticker-meta/MXL`, a sync
route on the same anyio pool, answered in 0.3 s. Released together = followers of ONE
in-flight computation, not a starved pool. The fix has three structural parts, railed here:

  1. single_flight: a FOREGROUND caller never follows a BACKGROUND (warmer) flight.
  2. research_panel_warm: runs as background work, yields the FMP bucket to members.
  3. api/main.py: the research warm starts after every other boot warmer, and no boot
     warmer runs on the anyio default limiter (the pool member sync routes need).

Each rail carries a control proving it can fail. No network, no uvicorn.
"""
from __future__ import annotations

import ast
import logging
import threading
import time
from pathlib import Path

import pytest

from api.services import single_flight
from api.services import research_panel_warm as rpw

REPO = Path(__file__).resolve().parents[1]
MAIN = REPO / "api" / "main.py"


@pytest.fixture(autouse=True)
def _clean_flights():
    single_flight.reset_for_tests()
    yield
    single_flight.reset_for_tests()


def _start_background_leader(key: str, release: threading.Event, started: threading.Event):
    """A warmer thread leading `key` until `release` is set."""
    def _warm():
        with single_flight.background():
            single_flight.run(key, lambda: (started.set(), release.wait(10), "warm")[2])
    t = threading.Thread(target=_warm, daemon=True)
    t.start()
    assert started.wait(5), "the warmer never became the leader"
    return t


# ── 1. single_flight: a member is never a follower of a warmer ──────────────────────────

def test_a_member_does_not_wait_for_a_warmers_flight():
    release, started = threading.Event(), threading.Event()
    t = _start_background_leader("research_est::TSM", release, started)
    try:
        t0 = time.monotonic()
        got = single_flight.run("research_est::TSM", lambda: "member", wait=2.0)
        took = time.monotonic() - t0
        assert got == "member"            # computed on its own thread, not the warm's value
        assert took < 1.0                 # did not sit out the warm (which is still running)
        assert single_flight.preempted() == 1
    finally:
        release.set()
        t.join(5)


def test_control_a_member_DOES_wait_for_another_members_flight():
    """Non-vacuity: without the background mark the same shape still collapses, so the test
    above passes because of the mark, not because single_flight stopped collapsing."""
    release, started = threading.Event(), threading.Event()

    def _member_leader():
        single_flight.run("research_est::TSM", lambda: (started.set(), release.wait(10), "a")[2])
    t = threading.Thread(target=_member_leader, daemon=True)
    t.start()
    assert started.wait(5)
    try:
        with pytest.raises(single_flight.SingleFlightTimeout):
            single_flight.run("research_est::TSM", lambda: "b", wait=0.3)
        assert single_flight.preempted() == 0
    finally:
        release.set()
        t.join(5)


def test_later_members_follow_the_member_not_the_warmer():
    release_warm, warm_started = threading.Event(), threading.Event()
    warm = _start_background_leader("k", release_warm, warm_started)
    release_member, member_started = threading.Event(), threading.Event()
    calls = []

    def _member_leader():
        calls.append(single_flight.run(
            "k", lambda: (member_started.set(), release_member.wait(10), "m1")[2]))
    m1 = threading.Thread(target=_member_leader, daemon=True)
    m1.start()
    assert member_started.wait(5)
    got = []
    m2 = threading.Thread(target=lambda: got.append(single_flight.run("k", lambda: "m2")),
                          daemon=True)
    m2.start()
    time.sleep(0.2)
    release_member.set()                  # the warmer is STILL running
    m2.join(5)
    m1.join(5)
    try:
        assert got == ["m1"]              # m2 followed member 1, and was released by it
        assert single_flight.stats()["collapsed"] == 1
    finally:
        release_warm.set()
        warm.join(5)
    # The warmer's exit must not have removed a flight it no longer owns, nor left one.
    assert single_flight.inflight_keys() == []


def test_a_warmer_still_shares_with_another_warmer():
    release, started = threading.Event(), threading.Event()
    t = _start_background_leader("k2", release, started)
    out = []

    def _second_warm():
        with single_flight.background():
            out.append(single_flight.run("k2", lambda: "second"))
    t2 = threading.Thread(target=_second_warm, daemon=True)
    t2.start()
    time.sleep(0.2)
    release.set()
    t.join(5)
    t2.join(5)
    assert out == ["warm"]
    assert single_flight.preempted() == 0


def test_the_background_mark_is_scoped_and_restored():
    assert not single_flight.in_background()
    with single_flight.background():
        assert single_flight.in_background()
        with single_flight.background():
            assert single_flight.in_background()
        assert single_flight.in_background()
    assert not single_flight.in_background()


# ── 2. research_panel_warm: background, and yields the FMP bucket ───────────────────────

def test_the_warm_runs_every_surface_as_background_work():
    seen = []
    rpw.warm_research_panels(["X"], surfaces=[("s", lambda _s: seen.append(
        single_flight.in_background()))], sleep=lambda _s: None, clock=lambda: 0.0,
        fmp_tokens=lambda: 999.0)
    assert seen == [True]
    assert not single_flight.in_background()   # control: the mark does not leak out


def test_the_warm_waits_for_the_fmp_reserve_before_a_symbol():
    levels = iter([10.0, 30.0, 61.0, 120.0])
    order, sleeps = [], []
    stats = rpw.warm_research_panels(
        ["X", "Y"], surfaces=[("s", lambda s: order.append(s))],
        sleep=lambda secs: (sleeps.append(secs), order.append(f"sleep{secs}")),
        clock=lambda: 0.0, fmp_reserve=60.0, fmp_tokens=lambda: next(levels),
        reserve_poll_seconds=5.0, pace_seconds=1.5)
    # Two reads below the reserve, then X; the pace sleep, then Y with the bucket full.
    assert order == ["sleep5.0", "sleep5.0", "X", "sleep1.5", "Y"]
    assert stats["fmp_waits"] == 2 and stats["symbols"] == 2


def test_control_a_full_bucket_never_waits():
    sleeps = []
    stats = rpw.warm_research_panels(["X", "Y"], surfaces=[("s", lambda _s: None)],
                                     sleep=sleeps.append, clock=lambda: 0.0,
                                     fmp_tokens=lambda: 120.0, pace_seconds=1.5)
    assert sleeps == [1.5] and stats["fmp_waits"] == 0


def test_a_bucket_that_never_refills_stops_the_pass_on_its_budget():
    now = [0.0]

    def _sleep(secs):
        now[0] += secs
    seen = []
    stats = rpw.warm_research_panels(["X", "Y"], surfaces=[("s", seen.append)],
                                     sleep=_sleep, clock=lambda: now[0],
                                     budget_seconds=30.0, fmp_tokens=lambda: 0.0,
                                     reserve_poll_seconds=5.0)
    assert seen == []                     # nothing was started on an empty bucket
    assert stats["stopped"] == "budget"


def test_fmp_tokens_available_refills_without_taking_one(monkeypatch):
    from api.services import fmp_client as fc
    monkeypatch.setattr(fc, "_bucket_tokens", 0.0)
    monkeypatch.setattr(fc, "_bucket_updated", time.monotonic() - 30.0)
    before = fc.budget()
    avail = fc.tokens_available()
    assert avail >= fc._FMP_RATE_LIMIT_PER_MIN * 0.45     # ~30 s of refill
    assert fc.budget() == before                           # read-only: nothing moved
    assert fc._bucket_tokens == 0.0


# ── 3. api/main.py: the research warm starts last; no warmer on the anyio limiter ───────

def _main_tree() -> ast.Module:
    return ast.parse(MAIN.read_text(encoding="utf-8"))


def _starter_delays(tree: ast.Module) -> dict[str, float]:
    """{starter name: default delay_seconds} for every `_start_*` def with that parameter,
    constants resolved from module-level assignments."""
    consts = {}
    for n in tree.body:
        if (isinstance(n, ast.Assign) and len(n.targets) == 1
                and isinstance(n.targets[0], ast.Name) and isinstance(n.value, ast.Constant)
                and isinstance(n.value.value, (int, float))):
            consts[n.targets[0].id] = n.value.value
    out = {}
    for n in tree.body:
        if not (isinstance(n, ast.FunctionDef) and n.name.startswith("_start_")):
            continue
        args = n.args.args
        defaults = n.args.defaults
        for a, d in zip(args[len(args) - len(defaults):], defaults):
            if a.arg != "delay_seconds":
                continue
            if isinstance(d, ast.Constant):
                out[n.name] = d.value
            elif isinstance(d, ast.Name):
                out[n.name] = consts[d.id]
    return out


def test_the_research_warm_starts_after_every_other_boot_warmer():
    delays = _starter_delays(_main_tree())
    # Non-vacuity: the probe sees the heavy siblings it is comparing against.
    for sibling in ("_start_rs_rankings_warm_background", "_start_dashboard_warm_background",
                    "_start_calendar_enrichment_warm_background"):
        assert sibling in delays, sibling
    research = delays.pop("_start_research_panel_warm_background")
    latest = max(delays.values())
    # After the latest starter PLUS the ~67 s RS recompute it measured overlapping.
    assert research >= latest + 60, (research, latest)


_ANYIO_MARKERS = ("run_in_threadpool", "to_thread", "anyio", "run_in_executor")


def _anyio_uses(node: ast.AST) -> list[str]:
    hits = []
    for n in ast.walk(node):
        if isinstance(n, ast.Attribute) and n.attr in _ANYIO_MARKERS:
            hits.append(n.attr)
        elif isinstance(n, ast.Name) and n.id in _ANYIO_MARKERS:
            hits.append(n.id)
        elif isinstance(n, (ast.Import, ast.ImportFrom)):
            mod = getattr(n, "module", None) or ""
            names = [a.name for a in n.names]
            if "anyio" in mod or any("anyio" in x for x in names) or \
                    any(x in _ANYIO_MARKERS for x in names):
                hits.append(mod or ",".join(names))
    return hits


def test_no_boot_warmer_runs_on_the_anyio_default_limiter():
    """The anyio default limiter (64) is what every sync route a member calls runs on. Boot
    warmers run on their own daemon threads; none may borrow a slot from that pool."""
    tree = _main_tree()
    starters = [n for n in tree.body if isinstance(n, ast.FunctionDef)
                and n.name.startswith("_start_") and n.name.endswith("_background")]
    assert len(starters) >= 8, [s.name for s in starters]     # non-vacuity
    offenders = {s.name: _anyio_uses(s) for s in starters if _anyio_uses(s)}
    assert offenders == {}
    # The warm module itself too.
    warm_tree = ast.parse(Path(rpw.__file__).read_text(encoding="utf-8"))
    assert _anyio_uses(warm_tree) == []


def test_control_the_anyio_probe_sees_a_borrowed_slot():
    snippet = ast.parse(
        "def _start_x_background(delay_seconds: int = 1):\n"
        "    import anyio\n"
        "    anyio.from_thread.run(anyio.to_thread.run_sync, f)\n")
    assert _anyio_uses(snippet)


# ── 4. the EE route names a slow open's legs ────────────────────────────────────────────

def test_a_slow_ee_open_logs_its_legs(monkeypatch, caplog):
    from api.routers import research as r
    monkeypatch.setattr(r, "_SLOW_EE_SECONDS", 0.0)
    monkeypatch.setattr(r, "get_estimates", lambda s: {"sym": s, "forward": [], "revisions": []})
    import api.services.research.estimates_consensus as ec
    monkeypatch.setattr(ec, "get_consensus", lambda s: {"sym": s, "state": "ok",
                                                         "annual": [], "quarterly": []})
    with caplog.at_level(logging.WARNING, logger=r._logger.name):
        out = r.research_estimates("ZZZT", consensus=1)
    assert out["consensus"]["state"] == "ok"
    lines = [m for m in caplog.messages if m.startswith("[ee-slow]")]
    assert len(lines) == 1 and "yf " in lines[0] and "fmp " in lines[0], lines


def test_control_a_fast_ee_open_logs_nothing(monkeypatch, caplog):
    from api.routers import research as r
    monkeypatch.setattr(r, "get_estimates", lambda s: {"sym": s})
    import api.services.research.estimates_consensus as ec
    monkeypatch.setattr(ec, "get_consensus", lambda s: {"sym": s, "state": "ok"})
    with caplog.at_level(logging.WARNING, logger=r._logger.name):
        r.research_estimates("ZZZT", consensus=1)
    assert not [m for m in caplog.messages if m.startswith("[ee-slow]")]

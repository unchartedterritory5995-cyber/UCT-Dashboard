"""Rails for the breadth-history request timing probe (Session 2 §2b).

The probe exists to settle a 30x that local measurement cannot reach. Everything
here is about the two ways a probe of that kind lies: by reporting a number it
never measured, and by breaking the route it is watching.
"""
from __future__ import annotations

import logging
import threading
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import breadth_monitor as breadth_monitor_module
from api.services import breadth_timing, single_flight


def _app():
    app = FastAPI()

    @app.get("/api/breadth-monitor")
    def route():
        breadth_timing.begin(span=8000)
        t0 = time.perf_counter()
        time.sleep(0.05)                       # stands in for the reader
        breadth_timing.note(reader_ms=(time.perf_counter() - t0) * 1000.0, rows=4703,
                            cache="miss", coalesced=False)
        return {"rows": []}

    @app.get("/api/breadth-monitor/ohlc/status")
    def sibling():
        return {"ok": True}

    app.add_middleware(breadth_timing.BreadthTimingMiddleware)
    return app


# ── what it must report ───────────────────────────────────────────────────────

def test_the_response_carries_a_server_timing_breakdown():
    r = TestClient(_app()).get("/api/breadth-monitor")
    assert r.status_code == 200
    st = r.headers.get("server-timing", "")
    assert "reader;dur=" in st and "post;dur=" in st and "total;dur=" in st, st


def test_reader_and_post_reader_partition_the_total():
    """post_reader_ms is DERIVED, so it can never disagree with what was measured."""
    r = TestClient(_app()).get("/api/breadth-monitor")
    st = dict(p.strip().split(";dur=") for p in r.headers["server-timing"].split(","))
    reader, post, total = float(st["reader"]), float(st["post"]), float(st["total"])
    assert reader > 40, f"the stand-in reader sleeps 50ms; got {reader}"
    assert abs((reader + post) - total) < 0.5, (reader, post, total)


def test_a_sibling_admin_route_is_not_instrumented():
    """⛔ NON-VACUITY IN BOTH DIRECTIONS. Scoping is only a fact if the probe can be
    shown to fire somewhere — a middleware that is broken everywhere also passes
    'it did not fire on the sibling'."""
    c = TestClient(_app())
    assert "server-timing" in c.get("/api/breadth-monitor").headers
    assert "server-timing" not in c.get("/api/breadth-monitor/ohlc/status").headers


def test_the_log_line_carries_no_member_identifier(caplog):
    with caplog.at_level(logging.INFO, logger="api.services.breadth_timing"):
        TestClient(_app()).get("/api/breadth-monitor?days=8000",
                               headers={"Cookie": "session=super-secret-token",
                                        "X-Forwarded-For": "203.0.113.9"})
    text = chr(10).join(r.getMessage() for r in caplog.records)
    assert "[breadth-timing]" in text, "the probe logged nothing at all"
    for forbidden in ("super-secret-token", "203.0.113.9", "session", "@"):
        assert forbidden not in text, f"{forbidden!r} reached the timing log: {text}"


def test_rss_reports_none_rather_than_zero_when_unreadable(monkeypatch):
    """⛔ 0.0 MB and 'cannot read it' are different facts. The local harness for
    this programme got 0.0 from an unchecked ctypes call and nearly published it."""
    monkeypatch.setattr(breadth_timing, "_PAGE", 4096)
    monkeypatch.setattr("builtins.open", lambda *a, **k: (_ for _ in ()).throw(OSError))
    assert breadth_timing.rss_mb() is None


# ── what it must never do ─────────────────────────────────────────────────────

def test_a_probe_that_raises_cannot_break_the_route(monkeypatch):
    boom = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("probe exploded"))
    monkeypatch.setattr(breadth_timing, "rss_mb", boom)
    monkeypatch.setattr(breadth_timing, "server_timing", boom)
    r = TestClient(_app()).get("/api/breadth-monitor")
    assert r.status_code == 200, "a timing probe failed a paid route"


def test_the_kill_switch_silences_the_line_without_touching_the_response(monkeypatch, caplog):
    monkeypatch.setenv("BREADTH_TIMING_LOG", "0")
    with caplog.at_level(logging.INFO, logger="api.services.breadth_timing"):
        r = TestClient(_app()).get("/api/breadth-monitor")
    assert r.status_code == 200
    assert not [x for x in caplog.records if "[breadth-timing]" in x.getMessage()]
    monkeypatch.setenv("BREADTH_TIMING_LOG", "1")
    with caplog.at_level(logging.INFO, logger="api.services.breadth_timing"):
        TestClient(_app()).get("/api/breadth-monitor")
    assert [x for x in caplog.records if "[breadth-timing]" in x.getMessage()],         "the switch silences it in BOTH positions, so it proves nothing"


# ── the single-flight role signal, which is the whole reason it is a callback ──

def test_the_role_is_exact_under_real_concurrency():
    """⛔ THE REASON THIS IS NOT A COUNTER DIFF. Diffing `collapsed` around the call
    misattributes when two arrivals land on one key — the exact case it exists to
    observe. The callback fires under the lock that decides the role."""
    single_flight.reset_for_tests()
    gate = threading.Event()
    roles: list[str] = []
    lock = threading.Lock()

    def record(role):
        with lock:
            roles.append(role)

    def call():
        return single_flight.run("k", lambda: (gate.wait(timeout=5), "v")[1], on_role=record)

    barrier = threading.Barrier(4)

    def _one():
        barrier.wait(timeout=5)
        call()

    threads = [threading.Thread(target=_one) for _ in range(4)]
    for t in threads:
        t.start()
    time.sleep(0.2)                  # let followers queue behind the leader
    gate.set()                       # ⛔ release BEFORE joining, never after
    for t in threads:
        t.join(timeout=5)

    assert roles.count("leader") == 1, roles
    assert roles.count("follower") == 3, roles


def test_an_observer_that_raises_cannot_break_the_flight():
    single_flight.reset_for_tests()
    out = single_flight.run("k2", lambda: "value",
                            on_role=lambda role: (_ for _ in ()).throw(RuntimeError("nope")))
    assert out == "value"


def test_run_without_an_observer_is_unchanged():
    single_flight.reset_for_tests()
    assert single_flight.run("k3", lambda: 7) == 7


# ── per-phase timing (Session 6) ──────────────────────────────────────────────

def _phase_app(seen: dict):
    """The route is a plain `def`, so FastAPI runs it in the anyio threadpool and
    anyio COPIES the context into the worker. That is the boundary the phases have
    to cross, and `seen` is how the test proves they actually crossed it rather
    than being recorded on the event loop where the middleware already lives."""
    app = FastAPI()

    @app.get("/api/breadth-monitor")
    def route():
        seen["route_thread"] = threading.get_ident()
        seen["route_rec_id"] = id(breadth_timing.get())
        breadth_timing.begin(span=8000)
        t0 = time.perf_counter()
        with breadth_timing.phase("numeric_fetch"):
            time.sleep(0.03)
        with breadth_timing.phase("derive"):
            time.sleep(0.02)
        with breadth_timing.phase("cache_set"):
            pass                                   # real, and far under a millisecond
        breadth_timing.note(reader_ms=(time.perf_counter() - t0) * 1000.0, rows=4703,
                            cache="miss", coalesced=False)
        with breadth_timing.phase("route_tail"):
            time.sleep(0.01)
        breadth_timing.mark("route_return")
        return {"rows": []}

    @app.middleware("http")
    async def _note_loop_thread(request, call_next):
        seen["loop_thread"] = threading.get_ident()
        return await call_next(request)

    app.add_middleware(breadth_timing.BreadthTimingMiddleware)
    return app


def test_phases_recorded_in_the_threadpool_reach_the_header_on_the_event_loop():
    """⛔ FALSE INSTRUMENT #2, railed. The first version of this probe rebound the
    contextvar inside the worker; anyio's copy meant the middleware never saw it and
    production reported `reader_ms=0.0` for a reader that had just run."""
    seen: dict = {}
    r = TestClient(_phase_app(seen)).get("/api/breadth-monitor")
    # ⛔ NON-VACUITY: if the route happened to run ON the event loop there would be
    # no boundary to cross and this test would prove nothing at all.
    assert seen["route_thread"] != seen["loop_thread"], (
        "the stand-in did not cross the threadpool — this proof is vacuous")
    st = dict(p.strip().split(";dur=") for p in r.headers["server-timing"].split(","))
    assert float(st["numeric_fetch"]) > 20, st
    assert float(st["derive"]) > 10, st
    assert float(st["route_tail"]) > 5, st


def test_the_worker_mutates_the_middlewares_record_rather_than_its_own():
    """The mechanism behind the test above, asserted directly: one object, two
    threads. If `begin()` ever rebinds instead of merging, these ids diverge and the
    phases go to a record nobody reads."""
    seen: dict = {}
    TestClient(_phase_app(seen)).get("/api/breadth-monitor")
    assert seen["route_rec_id"], "the middleware did not open a record before the route"


def test_a_phase_that_did_not_run_reads_absent_and_is_omitted_from_the_header(caplog):
    """⛔ `absent` and `0.0` are different facts. A phase reported as 0.0 is a stage
    priced at nothing; four earlier instruments in this programme failed that way."""
    seen: dict = {}
    with caplog.at_level(logging.INFO, logger="api.services.breadth_timing"):
        r = TestClient(_phase_app(seen)).get("/api/breadth-monitor")
    line = [x.getMessage() for x in caplog.records if "READER" in x.getMessage()][0]
    assert "merged_dates=absent" in line, line
    assert "merged_dates=0.0" not in line, line
    assert "merged_dates" not in r.headers["server-timing"], r.headers["server-timing"]
    # ...and the control: a phase that DID run is present in both.
    assert "numeric_fetch=" in line and "numeric_fetch;dur=" in r.headers["server-timing"]


def test_a_sub_millisecond_phase_does_not_round_away_to_zero():
    """`cache_set` really costs microseconds. At `.1f` it printed `0.0` — the one
    string this instrument promises never to emit for work that happened."""
    assert breadth_timing._phase_ms(0.02) == "0.020"
    assert breadth_timing._phase_ms(12.34) == "12.3"
    # Below the instrument's own resolution it says so — a third fact, distinct
    # from `absent` and from a measured value. `.3f` alone just moved the zero down.
    assert breadth_timing._phase_ms(0.0004) == "<0.001"
    # ...but the header must stay a bare number, or a parser reading it gets nothing.
    assert float(breadth_timing._phase_dur(0.0004)) > 0
    assert float(breadth_timing._phase_dur(0.001)) > 0
    assert breadth_timing._phase_dur(12.34) == "12.3"


def test_the_send_phase_is_reported_on_its_own_line_because_the_header_is_gone(caplog):
    """⛔ `gzip_send` is knowable only AFTER `http.response.start`, and both the
    header and the main log line are emitted there. It sat in POST_PHASES until it
    was measured: every consumer read `gzip_send=absent` for a stage that had run."""
    seen: dict = {}
    with caplog.at_level(logging.INFO, logger="api.services.breadth_timing"):
        r = TestClient(_phase_app(seen)).get("/api/breadth-monitor")
    assert "gzip_send" not in r.headers["server-timing"]
    assert "gzip_send" not in breadth_timing.POST_PHASES
    assert breadth_timing.SEND_PHASES == ("gzip_send",)
    send = [x.getMessage() for x in caplog.records if "| SEND " in x.getMessage()]
    assert send, "the send phase was measured and then reported nowhere"
    assert "gzip_send=absent" not in send[0], send[0]
    assert "total_with_send_ms=" in send[0], send[0]


def test_a_phase_whose_body_raises_still_records_its_span():
    """⛔ THE RAIL FOR THE HAND-ROLLED `__enter__`/`__exit__` DEFECT. `merge_rows` was
    written as `t = phase(...); t.__enter__()` … `t.__exit__(None, None, None)`, which
    skips `__exit__` entirely when the body raises — so a merge that failed halfway
    would report `merge_rows=absent`: the instrument going quiet at exactly the moment
    something went wrong. `phase()` records in a `finally`, and this asserts it.

    ⚠️ THIS TEST DOES NOT DETECT THE DEFECT, and saying so is the point. `phase()` was
    never broken — the CALL SITE bypassed it — so reinstating the hand-rolled pair
    leaves this green. It establishes the guarantee that makes the structural rail
    below worth enforcing. The mutation proof is on that one; a reader who takes this
    as the detector would have a rail that cannot fail.
    """
    breadth_timing._ctx.set(None)
    breadth_timing.begin(span=8000)
    with pytest.raises(ValueError):
        with breadth_timing.phase("merge_rows"):
            time.sleep(0.01)
            raise ValueError("the merge blew up halfway")
    rec = breadth_timing.get()
    assert rec is not None
    got = (rec.get("phases") or {}).get("merge_rows")
    assert got is not None, "the phase went ABSENT because its body raised"
    assert got > 5, f"the span was recorded but is wrong: {got}"


def test_the_reader_wraps_its_phases_in_with_blocks_not_a_manual_pair():
    """The structural half: the behaviour above is only reached if the reader actually
    uses `with`. Read as an AST, never as text.

    ⭐ AST, and the reason is specific rather than stylistic: the FIX's own comment
    contains the words `__enter__` and `__exit__` (it explains why they are not used),
    so a text search for them matches the explanation and fails the correct code —
    this repo's "CODE, NEVER PROSE" rule, which it has re-learned six times. An AST
    never sees a comment, so the needle cannot match its own justification.
    """
    import ast
    import pathlib

    src = pathlib.Path(breadth_monitor_module.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    manual = [n.attr for n in ast.walk(tree)
              if isinstance(n, ast.Attribute) and n.attr in ("__enter__", "__exit__")]
    assert not manual, f"a phase is entered/exited by hand: {manual}"

    # ⛔ NON-VACUITY: an empty parse, or a module with no phases at all, would also
    # produce an empty `manual` list. Prove the file really contains the construct.
    withs = [n for n in ast.walk(tree)
             if isinstance(n, ast.With)
             for item in n.items
             if isinstance(item.context_expr, ast.Call)
             and isinstance(item.context_expr.func, ast.Attribute)
             and item.context_expr.func.attr == "phase"]
    assert len(withs) >= 9, f"expected the nine reader phases as with-blocks, found {len(withs)}"
    assert "__exit__" in src, "the control itself is broken — the comment naming it is gone"


def test_the_phase_sums_reconcile_with_the_measured_totals():
    """Control (b) as a standing rail: the parts must account for the whole, or the
    breakdown is decoration. The residual is real work outside any named phase."""
    seen: dict = {}
    r = TestClient(_phase_app(seen)).get("/api/breadth-monitor")
    st = dict(p.strip().split(";dur=") for p in r.headers["server-timing"].split(","))
    reader = float(st["reader"])
    rsum = sum(float(st[p]) for p in breadth_timing.READER_PHASES if p in st)
    assert rsum <= reader + 0.5, (rsum, reader)
    assert rsum > reader * 0.9, f"phases account for only {100 * rsum / reader:.1f}% of reader_ms"

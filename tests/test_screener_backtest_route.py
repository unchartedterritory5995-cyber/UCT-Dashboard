"""WHAT THE BACKTEST ROUTE ITSELF DECIDES — each rule with a CONTROL.

``tests/test_screener_backtest_auth.py`` is the gate. This is the other half: the
route's own decisions, which are the ones that can be wrong while every gate holds
— the bound that does not bound, the refusal that reads as an error, the poll that
never resolves, the count restated beside the count that owns it.

⭐ EVERY RULE IS ASSERTED TWICE — once on the case that must trip it, once on the
neighbouring case that must NOT. The control is the half that would stay green if
the safety were deleted, and it is what separates "the guard fired" from "the
fixture was degenerate".

⛔ THE ENGINE IS STUBBED HERE, THE CONTRACT IS NOT.
``test_the_routers_ONE_engine_call_binds_against_the_REAL_signature`` reads the
keywords this router actually passes OFF THE ROUTER'S AST and binds them against
``inspect.signature(backtest.run_backtest)``. So the stub below cannot drift away
from the real engine without something going red — the vacuity
``lesson_injected_dependency_hides_the_fetch`` names.

⛔ NO CLOCK AND NO RNG. Every window, tree and bar array is a literal, which is the
only thing that makes the determinism assertion mean anything.
"""
from __future__ import annotations

import ast as pyast
import inspect
import threading
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.routers import screener_backtest as bt
from api.services.screener import backtest as engine
from api.services import bars_sqlite
from api.services.screener import snapshot_builder

ROOT = Path(__file__).resolve().parents[1]
ROUTER_SRC = ROOT / "api" / "routers" / "screener_backtest.py"

PAID = {"id": "paid1", "role": "member", "plan": "pro"}


# ─── fixtures: trees and bars, all literal ───────────────────────────────────

def NUM(v):
    return {"type": "num", "value": v}


def SER(n):
    return {"type": "series", "name": n}


def OP(n, *a):
    return {"type": "op", "name": n, "args": list(a)}


def CALL(n, *a):
    return {"type": "call", "name": n, "args": list(a)}


#: ``close > sma(close, 3)`` — bar-expressible, so backtestable.
BAR_TREE = OP(">", SER("close"), CALL("sma", SER("close"), NUM(3)))

#: ⭐ THE SAME SHAPE with a declared scalar on the left, so a refusal that fires
#: here and not on ``BAR_TREE`` fired for the SCALAR and not for the shape.
SCALAR_TREE = OP(">", SER("rs_rank"), NUM(80))

WINDOW = {"from": "2024-01-02", "to": "2024-06-28"}


def _store_rows(n=200):
    """``n`` rising daily rows in the STORE's own shape: ``(ts, o, h, l, c, v)``
    with ``ts`` the ``YYYYMMDD`` int ``bars.db`` really holds."""
    import datetime
    d0 = datetime.date(2024, 1, 2)
    out = []
    for i in range(n):
        d = d0 + datetime.timedelta(days=i)
        px = 10.0 + i
        out.append((d.year * 10_000 + d.month * 100 + d.day,
                    px, px + 1.0, px - 1.0, px, 1000.0))
    return out


def _client(monkeypatch, *, universe=("AAA", "BBB"), bars=None, engine_mod=None):
    """A paid client with the universe and the bars pinned.

    ⚠️ `bars_sqlite.get_bars_before` IS PATCHED ON ITS OWN MODULE, not on the
    router — the router resolves it off the module at call time, and
    `from … import` would have severed it
    (`lesson_from_import_severs_a_module_from_its_guards`). It returns STORE TUPLES
    `(ts, o, h, l, c, v)` with a `YYYYMMDD` ts, which is what the real store holds:
    stubbing the already-formatted shape would skip `_fmt_sqlite_bars` and hide the
    translation this route exists to get right.
    """
    monkeypatch.setattr(snapshot_builder, "_load_universe", lambda: list(universe))
    rows = _store_rows() if bars is None else bars
    monkeypatch.setattr(bars_sqlite, "get_bars_before",
                        lambda sym, tf, want, to_key: list(rows)[:want])
    if engine_mod is not None:
        monkeypatch.setattr(bt, "_engine", lambda: engine_mod)
    app = FastAPI()
    app.include_router(bt.router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean_receipts():
    """⛔ THE RECEIPT CACHE IS PROCESS-WIDE. Without this a later test reads an
    earlier one's answer and passes for the wrong reason."""
    from api.services.cache import cache
    cache.delete_prefix("screen_backtest::")
    with bt._INFLIGHT_GUARD:
        bt._INFLIGHT.clear()
    yield
    cache.delete_prefix("screen_backtest::")
    with bt._INFLIGHT_GUARD:
        bt._INFLIGHT.clear()


# ─── the seam: the router's ONE engine call, bound against the REAL engine ───

def _engine_call_from_source():
    """``(attr, [kwarg names])`` for the call on ``engine`` inside ``_run_engine``.

    ⛔ DERIVED FROM THE ROUTER'S AST, NEVER TYPED
    (``lesson_probe_names_must_be_derived_not_typed``). A hand-written list would
    keep agreeing with itself after the router changed which keywords it passes,
    which is the exact failure this test exists to catch.
    """
    tree = pyast.parse(ROUTER_SRC.read_text(encoding="utf-8"))
    fn = next(n for n in pyast.walk(tree)
              if isinstance(n, pyast.FunctionDef) and n.name == "_run_engine")
    calls = [n for n in pyast.walk(fn)
             if isinstance(n, pyast.Call) and isinstance(n.func, pyast.Attribute)
             and isinstance(n.func.value, pyast.Name) and n.func.value.id == "engine"]
    assert len(calls) == 1, (
        f"_run_engine makes {len(calls)} calls on the engine module; the router's "
        "contract with the engine is supposed to be exactly ONE point of contact")
    call = calls[0]
    return call.func.attr, len(call.args), [kw.arg for kw in call.keywords]


def test_the_routers_ONE_engine_call_binds_against_the_REAL_signature():
    """⛔ THE CONTRACT, CHECKED AGAINST THE REAL MODULE.

    Everything else in this file stubs the engine. That is correct — it keeps these
    tests about the route — and it is also how a router quietly stops matching the
    engine it calls. So the names and arity the router really passes are read off
    its AST and BOUND against ``inspect.signature`` of the real function.
    """
    attr, n_pos, kwargs = _engine_call_from_source()
    fn = getattr(engine, attr, None)
    assert callable(fn), (
        f"the router calls `engine.{attr}(...)` and the engine has no such "
        f"callable — the contract is broken at the name")
    sig = inspect.signature(fn)
    sig.bind(*[object()] * n_pos, **{k: object() for k in kwargs})

    # THE CONTROL: the bind is not vacuous — a keyword the engine does not declare
    # must fail, so a green bind above means the real parameters were checked.
    with pytest.raises(TypeError):
        sig.bind(*[object()] * n_pos,
                 **{k: object() for k in kwargs},
                 not_a_real_parameter_of_the_engine=1)


def test_the_default_horizons_are_the_ENGINES_and_not_a_second_copy():
    """⛔ ONE WRITER. A request naming no horizons must resolve to exactly what the
    engine declares, so the receipt's ``method.horizons`` cannot disagree with the
    door that asked for them."""
    assert bt._horizons(None) == list(engine.DEFAULT_HORIZONS)
    # The control: an explicit list is honoured, so the line above is a default and
    # not a hard-coded answer to every request.
    assert bt._horizons([3, 3, 1]) == [1, 3]


# ─── the refusal is an ANSWER, not an error ──────────────────────────────────

def test_a_scalar_screen_is_REFUSED_BY_NAME_with_a_200(monkeypatch):
    """🔴 THE FEATURE. ``rs_rank`` has one row per ticker and no history, so
    evaluating it at a 2024 bar would screen the past with a fact from the future.
    The member must SEE that, beside the screen — which means a 200 carrying
    ``backtestable: false`` and the offending name, never a 4xx.
    """
    client = _client(monkeypatch)
    r = client.post("/api/screener/backtest",
                    json={"ast": SCALAR_TREE, **WINDOW})
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["backtestable"] is False
    assert body["refused"] == "scalar_no_history", body
    assert "rs_rank" in body["names"], body
    assert "rs_rank" in body["detail"], body


def test_the_control_a_bar_only_screen_of_the_SAME_SHAPE_is_not_refused(monkeypatch):
    """THE CONTROL for the test above: same operator, same literal, same arity —
    only the left operand differs. If this refused too, the refusal above would be
    about the shape and the whole feature would be a no-op that looks like a
    principle."""
    client = _client(monkeypatch)
    r = client.post("/api/screener/backtest", json={"ast": BAR_TREE, **WINDOW})
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body.get("refused") != "scalar_no_history", body


# ─── the bars the engine is handed ───────────────────────────────────────────

def test_a_daily_bar_reaches_the_engine_with_an_ISO_date(monkeypatch):
    """⛔⛔ THE MISMATCH THAT WOULD HAVE REFUSED EVERY SCREEN.

    ``bars_sqlite`` stores a daily bar's ``ts`` as the int ``20240102``;
    ``backtest.bar_date`` is the ONE owner of "what date is this bar" and answers
    only to ``YYYY-MM-DD``. Handed the store's rows unchanged the engine refuses
    ``non_daily_bars`` for the whole universe — a correct refusal about something
    the member never asked for. ``bars_fetch._fmt_sqlite_bars`` is the one place
    that translation lives, and this is the proof the route goes through it.
    """
    raw = [(20240102, 1.0, 2.0, 0.5, 1.5, 9.0)]
    monkeypatch.setattr(bars_sqlite, "get_bars_before",
                        lambda sym, tf, want, to_key: list(raw))
    got = bt._bars_reader("D", 20240401)("AAA", 10)
    assert got[0]["t"] == "2024-01-02", got
    assert engine.bar_date(got[0]) == "2024-01-02", (
        "the engine still cannot read this bar's date — the reader is not going "
        "through the formatter the engine's shape depends on")
    assert (got[0]["o"], got[0]["c"], got[0]["v"]) == (1.0, 1.5, 9.0)

    # THE CONTROL: the formatter is also the sanitiser, and a non-positive price is
    # a vendor sentinel, not a trade. It must be DROPPED before the engine can
    # divide by it — so the reader returning fewer bars than the store handed it
    # is the guard working, not data going missing.
    poisoned = [(20240102, 0.0, 0.0, 0.0, 0.0, 0.0),
                (20240103, 1.0, 2.0, 0.5, 1.5, 9.0)]
    monkeypatch.setattr(bars_sqlite, "get_bars_before",
                        lambda sym, tf, want, to_key: list(poisoned))
    out = bt._bars_reader("D", 20240401)("AAA", 10)
    assert [b["t"] for b in out] == ["2024-01-03"], out


def test_a_store_that_cannot_be_read_is_NOT_TESTED_and_not_a_500(monkeypatch):
    """⭐ HONEST-NONE ON THE READ. ``bars_sqlite`` RAISES when the store has no
    ``ohlcv`` table (a fresh pod, a restored volume, a sandbox). An unguarded read
    turns the whole surface into a 500 that says nothing about bars; returning
    empty hands the engine the state it already models, and the symbol is COUNTED
    in ``coverage.symbols_missing_bars`` rather than dropped.
    """
    def boom(sym, tf, want, to_key):
        raise RuntimeError("no such table: ohlcv")

    monkeypatch.setattr(bars_sqlite, "get_bars_before", boom)
    assert bt._bars_reader("D", 20240401)("AAA", 10) == []

    # THE CONTROL: a store that CAN be read still returns its bars, so the empty
    # list above is the guard and not the reader being inert.
    monkeypatch.setattr(bars_sqlite, "get_bars_before",
                        lambda sym, tf, want, to_key: [(20240102, 1.0, 2.0, 0.5, 1.5, 9.0)])
    assert len(bt._bars_reader("D", 20240401)("AAA", 10)) == 1


def test_the_far_end_of_the_read_is_the_window_PADDED_by_the_longest_horizon():
    """⛔ A PAST WINDOW NEEDS BOTH ENDS BOUNDED. ``get_bars`` would return the
    NEWEST N rows — 2026 bars for a 2020 question — so the read is cut at
    ``padded_end``. The pad is the horizon: a signal on the last day of the window
    resolves after it, and that forward return is the answer, not lookahead."""
    end = bt.padded_end(20241231, 20)
    assert end > 20241231, end
    # 20 trading days is about four calendar weeks, plus a week of slack.
    assert 20250101 <= end <= 20250210, end
    # THE CONTROL: a longer horizon pads further, so the pad really tracks it.
    assert bt.padded_end(20241231, 250) > bt.padded_end(20241231, 20)


def test_the_read_is_sized_by_the_WINDOW_not_by_the_stores_ceiling():
    """⛔ THE SWEEP'S SIZE IS THE REQUEST'S, PLUS WHAT THE TREE DECLARES IT NEEDS.

    Reading ``MAX_BARS_PER_SYMBOL`` for every symbol regardless of window is
    what turns "backtest my 40-name screen over one month" into a 200,000-bar read,
    and the engine holds every one of those bars at once.
    """
    month = bt.bars_wanted(20240102, 20240201, warmup=20, max_horizon=5)
    year = bt.bars_wanted(20240102, 20241231, warmup=20, max_horizon=5)
    assert month < year < bt.MAX_BARS_PER_SYMBOL, (month, year)

    # It covers the window: ~22 sessions in a month, plus warmup, plus forward room.
    assert month > 22 + 20 + 5, month
    # A longer warmup asks for more history — the tree's declaration is really read.
    assert bt.bars_wanted(20240102, 20240201, warmup=200, max_horizon=5) > month
    # A longer horizon asks for more forward room, for the same reason.
    assert bt.bars_wanted(20240102, 20240201, warmup=20, max_horizon=250) > month
    # THE CONTROL: the store's ceiling still applies, so this is a bound and not
    # just an estimate that can run away.
    assert bt.bars_wanted(19000101, 20991231, warmup=5000,
                          max_horizon=250) == bt.MAX_BARS_PER_SYMBOL


# ─── the bounds: off the request path, and off the pod's memory ──────────────

def test_a_universe_too_big_for_a_request_thread_is_refused_and_names_the_door(monkeypatch):
    """A whole-universe sweep must never land on a request thread — and the refusal
    has to say what to do instead, or the member just sees a wall."""
    big = tuple(f"S{i:04d}" for i in range(bt.INLINE_MAX_SYMBOLS + 5))
    client = _client(monkeypatch, universe=big)
    r = client.post("/api/screener/backtest", json={"ast": BAR_TREE, **WINDOW})
    assert r.status_code == 400, r.text[:300]
    detail = r.json()["detail"]
    assert str(bt.INLINE_MAX_SYMBOLS) in detail and "background=1" in detail, detail

    # THE CONTROL: the SAME request with ?background=1 is accepted and queued, so
    # the refusal above is a routing decision and not the feature being broken.
    r2 = client.post("/api/screener/backtest?background=1",
                     json={"ast": BAR_TREE, **WINDOW})
    assert r2.status_code == 200, r2.text[:300]
    assert r2.json()["status"] in ("running", "ready"), r2.json()


def test_a_sweep_bigger_than_the_memory_ceiling_is_refused_with_BOTH_numbers(monkeypatch):
    """⛔ BACKGROUNDING IS NOT A BOUND. The engine holds every scanned symbol's bars
    at once, so ``symbols × bars`` is what has to be capped — a queued OOM is still
    an OOM, and it takes the pod down for everybody instead of one caller.
    """
    monkeypatch.setenv("SCREEN_BACKTEST_MAX_CELLS", "100")
    client = _client(monkeypatch, universe=("AAA", "BBB"))
    r = client.post("/api/screener/backtest?background=1",
                    json={"ast": BAR_TREE, **WINDOW})
    assert r.status_code == 400, r.text[:300]
    detail = r.json()["detail"]
    assert "100" in detail and "symbols" in detail and "bars" in detail, detail

    # THE CONTROL: raise the ceiling and the identical request is accepted — so the
    # refusal is the ceiling firing, not the request being malformed.
    monkeypatch.setenv("SCREEN_BACKTEST_MAX_CELLS", "10000000")
    ok = client.post("/api/screener/backtest?background=1",
                     json={"ast": BAR_TREE, **WINDOW})
    assert ok.status_code == 200, ok.text[:300]


def test_the_ceiling_is_read_at_call_time_so_the_knob_is_not_inert(monkeypatch):
    """``lesson_a_measured_knob_is_inert_if_the_consumer_skips_its_stage`` — a
    module-level literal read once at import would ignore the env var forever."""
    assert bt.max_cells() == bt.DEFAULT_MAX_CELLS
    monkeypatch.setenv("SCREEN_BACKTEST_MAX_CELLS", "12345")
    assert bt.max_cells() == 12345
    # The control: garbage does not silently disable the ceiling.
    monkeypatch.setenv("SCREEN_BACKTEST_MAX_CELLS", "not-a-number")
    assert bt.max_cells() == bt.DEFAULT_MAX_CELLS
    monkeypatch.setenv("SCREEN_BACKTEST_MAX_CELLS", "0")
    assert bt.max_cells() == bt.DEFAULT_MAX_CELLS


# ─── one writer per value ────────────────────────────────────────────────────

def test_the_envelope_REFUSES_to_restate_a_key_the_receipt_already_owns():
    """🔴 "one writer per value", AS CODE. The route publishing its own
    ``symbols_tested`` beside the engine's is the drift this repo keeps paying for;
    here it is a raise, not a review note."""
    receipt = {"backtestable": True, "symbols_tested": 806, "universe": {"a": 1}}
    with pytest.raises(bt.EnvelopeCollision) as exc:
        bt._envelope(receipt, {"symbols_tested": 812})
    assert "symbols_tested" in str(exc.value)

    # THE CONTROL: a genuinely route-owned key passes, so the guard is not simply
    # refusing everything.
    out = bt._envelope(receipt, {"job": "abc", "status": "ready"})
    assert out["symbols_tested"] == 806 and out["job"] == "abc"


def test_the_response_carries_the_ENGINES_universe_block_and_the_routes_provenance(monkeypatch):
    """Both facts, at two addresses, neither overwriting the other: the engine says
    how many symbols it was handed and states the survivorship caveat; the route
    says which door built the list."""
    client = _client(monkeypatch, universe=("AAA", "BBB", "CCC"))
    body = client.post("/api/screener/backtest",
                       json={"ast": BAR_TREE, **WINDOW}).json()
    assert body["universe"]["symbols_requested"] == 3, body["universe"]
    assert body["universe"]["survivorship_bias"] is True, body["universe"]
    assert "caveat" in body["universe"], body["universe"]
    assert body["universe_request"]["kind"] == "current", body["universe_request"]


def test_the_route_writes_no_SECOND_survivorship_caveat(monkeypatch):
    """⛔⛔ ONE CAVEAT, ONE ADDRESS.

    Spec §3 rule 4 demands the survivorship statement travel with the result, and
    the ENGINE owns it: ``Receipt.universe`` is a required field carrying
    ``membership``, ``symbols_requested``, ``survivorship_bias`` and the sentence.
    A second, kinder wording lived in this route for one draft — it read like
    diligence, and it is the two-authorities defect: a later edit softens one copy
    while the other still says the hard thing, and nobody can tell which the member
    read.
    """
    client = _client(monkeypatch, universe=("AAA", "BBB", "CCC"))
    body = client.post("/api/screener/backtest",
                       json={"ast": BAR_TREE, **WINDOW}).json()

    # The engine's copy is present and is the ONE that says it.
    assert body["universe"]["survivorship_bias"] is True, body["universe"]
    caveat = body["universe"]["caveat"]
    assert "survivorship" in caveat.lower(), caveat

    # The route's block says only what the engine cannot know — no membership, no
    # symbol count, no second sentence.
    prov = body["universe_request"]
    assert set(prov) <= {"kind", "screen_id", "screen_name", "matched", "truncated"}, prov
    blob = " ".join(str(v) for v in prov.values()).lower()
    assert "survivor" not in blob and "yesterday's prices" not in blob, prov

    # THE CONTROL: the route's block is not empty either — it really does carry the
    # provenance the engine has no way to report.
    assert prov["kind"] == "current" and prov["matched"] == 3, prov


# ─── the polled receipt ──────────────────────────────────────────────────────

def test_a_job_nobody_ran_polls_as_UNKNOWN_not_as_running(monkeypatch):
    """⛔ HONEST-NONE ON THE POLL. If an id nobody has heard of read as ``running``,
    a dead job and a slow job would be indistinguishable and the client would poll
    forever (``lesson_a_warm_pass_that_persists_nothing_reads_as_healthy``)."""
    client = _client(monkeypatch)
    body = client.get("/api/screener/backtest/deadbeefdeadbeefdeadbeef").json()
    assert body["status"] == "unknown", body

    # THE CONTROL: a job that really is in flight reads `running`, so `unknown` is
    # a distinction and not this endpoint's only answer.
    with bt._INFLIGHT_GUARD:
        bt._INFLIGHT.add("deadbeefdeadbeefdeadbeef")
    try:
        assert client.get(
            "/api/screener/backtest/deadbeefdeadbeefdeadbeef").json()["status"] == "running"
    finally:
        with bt._INFLIGHT_GUARD:
            bt._INFLIGHT.discard("deadbeefdeadbeefdeadbeef")


def test_a_background_job_that_RAISES_polls_as_error_and_not_as_silence():
    """⛔ A FAILED JOB LEAVES A RECORD. Swallowing the exception would leave the
    receipt absent, the poll would answer ``unknown``, and "it broke" would read as
    "you asked for something that does not exist"."""
    done = threading.Event()

    def boom():
        try:
            raise RuntimeError("the sweep fell over")
        finally:
            pass

    def _run():
        try:
            boom()
        finally:
            done.set()

    bt._submit("job-that-fails", _run)
    assert done.wait(10), "the pool never ran the job"
    for _ in range(200):
        got = bt.status_for("job-that-fails")
        if got.get("status") != "running":
            break
        threading.Event().wait(0.02)
    assert got["status"] == "error", got
    assert "the sweep fell over" in got["detail"], got

    # THE CONTROL: a job that SUCCEEDS records its receipt, so `error` above is the
    # failure path and not the only thing `_submit` can produce.
    ok = threading.Event()

    def _good():
        ok.set()
        return {"backtestable": True, "status": "ready", "job": "job-that-works"}

    bt._submit("job-that-works", _good)
    assert ok.wait(10)
    for _ in range(200):
        got2 = bt.status_for("job-that-works")
        if got2.get("status") != "running":
            break
        threading.Event().wait(0.02)
    assert got2["status"] == "ready", got2


def test_a_queued_job_is_pollable_and_then_ready(monkeypatch):
    """The whole ``?background=1`` round trip: POST hands back an id, the poll
    resolves to the receipt, and the id is the SAME one the POST returned."""
    big = tuple(f"S{i:04d}" for i in range(bt.INLINE_MAX_SYMBOLS + 5))
    client = _client(monkeypatch, universe=big)
    started = client.post("/api/screener/backtest?background=1",
                          json={"ast": BAR_TREE, **WINDOW}).json()
    job = started["job"]
    for _ in range(500):
        body = client.get(f"/api/screener/backtest/{job}").json()
        if body.get("status") != "running":
            break
        threading.Event().wait(0.02)
    assert body["status"] == "ready", body
    assert body["job"] == job, body
    assert "backtestable" in body, body


# ─── determinism ─────────────────────────────────────────────────────────────

def test_the_same_request_yields_the_same_job_id_and_a_changed_one_does_not():
    """No clock, no RNG, no counter — so the receipt is reproducible and a repeat
    caller reads the answer that was already computed."""
    a = bt.job_id(BAR_TREE, ["AAA", "BBB"], "D", 20240102, 20240628, [5, 10])
    b = bt.job_id(BAR_TREE, ["AAA", "BBB"], "D", 20240102, 20240628, [5, 10])
    assert a == b

    # THE CONTROL: every input really participates, so equality above is not the
    # digest ignoring its arguments.
    assert a != bt.job_id(BAR_TREE, ["AAA", "BBB"], "D", 20240102, 20240628, [5, 20])
    assert a != bt.job_id(BAR_TREE, ["AAA"], "D", 20240102, 20240628, [5, 10])
    assert a != bt.job_id(SCALAR_TREE, ["AAA", "BBB"], "D", 20240102, 20240628, [5, 10])
    assert a != bt.job_id(BAR_TREE, ["AAA", "BBB"], "D", 20240103, 20240628, [5, 10])


def test_two_spellings_of_one_request_reach_the_same_receipt(monkeypatch):
    """Horizons are deduped and sorted before the digest, so ``[10, 5, 5]`` and
    ``[5, 10]`` are ONE job rather than two sweeps of the same work."""
    client = _client(monkeypatch)
    one = client.post("/api/screener/backtest",
                      json={"ast": BAR_TREE, "horizons": [10, 5, 5], **WINDOW}).json()
    two = client.post("/api/screener/backtest",
                      json={"ast": BAR_TREE, "horizons": [5, 10], **WINDOW}).json()
    assert one["job"] == two["job"], (one["job"], two["job"])
    # THE CONTROL: a genuinely different horizon set is a different job.
    three = client.post("/api/screener/backtest",
                        json={"ast": BAR_TREE, "horizons": [5, 11], **WINDOW}).json()
    assert three["job"] != one["job"]


# ─── the request door ────────────────────────────────────────────────────────

@pytest.mark.parametrize("body,needle", [
    ({"source": "close > sma(close, 3)", **WINDOW}, "canonical tree"),
    ({**WINDOW}, "`ast`"),
    ({"ast": BAR_TREE, "from": "2024-06-28", "to": "2024-01-02"}, "after"),
    ({"ast": BAR_TREE, "from": "not-a-date", "to": "2024-06-28"}, "`from`"),
    ({"ast": BAR_TREE, "tf": "5", **WINDOW}, "daily-only"),
    ({"ast": BAR_TREE, "horizons": [0], **WINDOW}, "outside 1.."),
    ({"ast": BAR_TREE, "horizons": [1, 2, 3, 4, 5, 6, 7], **WINDOW}, "at most"),
    ({"ast": BAR_TREE, "universe": "not-an-id", **WINDOW}, "saved screen id"),
])
def test_a_bad_request_is_refused_by_NAME(monkeypatch, body, needle):
    """Each refusal says which field and which bound — never a bare 422."""
    client = _client(monkeypatch)
    r = client.post("/api/screener/backtest", json=body)
    assert r.status_code == 400, (body, r.status_code, r.text[:200])
    assert needle in r.json()["detail"], (needle, r.json()["detail"])


def test_the_control_the_same_door_accepts_a_good_request(monkeypatch):
    """THE CONTROL for the parametrised refusals above: with every field valid the
    door answers 200, so those 400s are the validators firing and not the endpoint
    refusing everything."""
    client = _client(monkeypatch)
    r = client.post("/api/screener/backtest",
                    json={"ast": BAR_TREE, "tf": "D", "horizons": [5, 10],
                          "universe": "current", **WINDOW})
    assert r.status_code == 200, r.text[:300]


def test_the_wire_name_is_from_and_the_python_name_also_binds(monkeypatch):
    """⚠️ ``from`` IS A PYTHON KEYWORD, so the field is ALIASED. Pydantic 2.12 emits
    ``UnsupportedFieldAttributeWarning`` from FastAPI's schema pass for every
    spelling of that alias — measured on the assignment form AND on
    ``Annotated`` — so the warning cannot be used as evidence either way. This is
    the evidence: the wire name binds, and a request that only sets the PYTHON name
    binds too, so a caller written against either does not silently lose its
    window.
    """
    client = _client(monkeypatch)
    wire = client.post("/api/screener/backtest",
                       json={"ast": BAR_TREE, "from": "2024-01-02", "to": "2024-06-28"})
    assert wire.status_code == 200, wire.text[:300]
    py = client.post("/api/screener/backtest",
                     json={"ast": BAR_TREE, "from_": "2024-01-02", "to": "2024-06-28"})
    assert py.status_code == 200, py.text[:300]
    assert wire.json()["job"] == py.json()["job"], "the two spellings built different jobs"

    # THE CONTROL: with NEITHER spelling the door refuses by name, so the 200s above
    # are the alias resolving and not the window being invented.
    none = client.post("/api/screener/backtest",
                       json={"ast": BAR_TREE, "to": "2024-06-28"})
    assert none.status_code == 400 and "`from`" in none.json()["detail"], none.text[:200]


def test_a_tree_the_TABLE_refuses_is_refused_at_the_door_not_per_symbol(monkeypatch):
    """``max_lookback`` resolves every call on its way to a number, so a formula
    naming a function the table does not declare must refuse ONCE, loudly — not
    3,742 times inside the sweep."""
    client = _client(monkeypatch)
    bogus = OP(">", CALL("no_such_function", SER("close"), NUM(3)), NUM(0))
    r = client.post("/api/screener/backtest", json={"ast": bogus, **WINDOW})
    assert r.status_code == 400, r.text[:300]


# ═══════════════════════════════════════════════════════════════════════════
# FIX ROUND 1 MINOR (query.py reviewed 2026-08-26) — `_universe_for`'s
# saved-screen branch calls `scr_query.run_scan(screen_spec)` with NO
# `except ValueError`, unlike every OTHER validation failure in this same
# function (a bad `universe` value, an unknown saved-screen id, an empty
# universe), all of which are deliberate `HTTPException(400, ...)`.
# `run_scan` raises `ValueError` for a filter/sort/rank/columns request that
# names an unknown or not-yet-live column (`unknown sort key: ...` predates
# this fix entirely; X27's `_readiness_refusal` widened WHEN it fires, not
# WHETHER `run_scan` can raise) — so a saved screen carrying one 500s here
# where `POST /api/scan` gives the member a 400 naming the problem.
# ═══════════════════════════════════════════════════════════════════════════
def test_a_saved_screen_that_run_scan_refuses_gives_400_not_an_unhandled_500(monkeypatch):
    """`run_scan` raising ValueError is not X27-specific — `unknown sort key`
    is a pre-existing refusal reachable through a saved screen's own stored
    spec, which a member does not directly control (it was saved before, or
    is a screen shared with them). Uses a throwaway on-disk screener.db (never
    ``C:\\data``) so `run_scan` reaches the real sort-key check rather than
    failing to even open a connection."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(_tmp_screener_db(monkeypatch)))
    from api.routers import screener_backtest as bt
    from api.services.screener import saved_screens as scr_saved

    monkeypatch.setattr(scr_saved, "get", lambda sid, uid: {
        "id": sid, "name": "poisoned",
        "spec": {"sort": {"key": "__no_such_column_at_all__"}},
    })
    with pytest.raises(HTTPException) as exc:
        bt._universe_for("42", "user1")
    assert exc.value.status_code == 400, (exc.value.status_code, exc.value.detail)
    assert "__no_such_column_at_all__" in exc.value.detail


def _tmp_screener_db(monkeypatch):
    import tempfile
    import pathlib
    d = pathlib.Path(tempfile.mkdtemp(prefix="uct_screener_backtest_route_"))
    return d / "screener.db"

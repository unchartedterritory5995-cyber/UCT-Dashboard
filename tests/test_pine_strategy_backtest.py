"""W9-T14 rails: server-side strategy backtests (W9 design 3.4, ruling D5).

  * the record codec (``pine_runtime_codec``) and the client (``pine_runtime_client``) decode the
    service's sealed answer -- the committed fixture the vitest host-parity rail writes from the
    REAL server surface (``w9T14ServerRecord.test.js``) -- and refuse any byte that does not verify;
  * the client sends the window only when a caller states it, and never a default;
  * ``POST /api/pine/strategy-backtest``: dark (404 while the server stage admits nobody), auth
    (401), the plan gate (402), the window read from ``bars_window.HISTORY_WINDOW_BARS``, the start
    stated on every answer, refusals by name per symbol, transport refusals mapped by W5-T15's table,
    D5 single-symbol (none / several refused by name), the W5 server lanes' plan gate, and one authority over the window (a record describing another window is a 500);
  * W5-T15's descriptor path refuses a strategy document ``runtime:strategy-start``;
  * the JS constants the codec mirrors are read from the JS sources, so they cannot drift;
  * E-3 walks the new route.
No network; no flag is set (the server stage is monkeypatched per test, never through the env).
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.routers import pine_strategy_backtest as pst
from api.routers import screener_backtest as sbt
from api.services import bars_sqlite
from api.services import pine_runtime_client as prc
from api.services import pine_runtime_codec as codec
from api.services import runtime_definitions as rd
from api.services import user_definitions as defs
from api.services.bars_window import HISTORY_WINDOW_BARS

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "pine_runtime" / "w9t14_strategy_result.json"
RT = ROOT / "app" / "src" / "components" / "chart" / "engine" / "runtime"
DEF_ID = "u_0123456789ab"
PAID = {"id": "paid1", "role": "member", "plan": "pro"}


def _js_const(path: pathlib.Path, name: str) -> str:
    found = re.findall(r"^export const " + name + r" = '([^']+)'", path.read_text(encoding="utf-8"), re.M)
    assert len(found) == 1, (path, name, found)
    return found[0]


def test_the_codec_mirrors_the_js_declarations_exactly():
    assert codec.STRATEGY_WANT == _js_const(ROOT / "services" / "pine_runtime" / "protocol.mjs", "STRATEGY_WANT")
    assert codec.STRATEGY_RECORD_SCHEMA == _js_const(RT / "strategyRecord.js", "STRATEGY_RECORD_SCHEMA")
    assert codec.STRATEGY_WINDOW_HISTORY == _js_const(RT / "strategyRecord.js", "STRATEGY_WINDOW_HISTORY")
    assert codec.STRATEGY_START_GUARD == _js_const(RT / "broker.js", "BROKER_START_GUARD")


# --- the record through the client -------------------------------------------------------------

def _fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _decode(result, want=(codec.STRATEGY_WANT,), n=None):
    fx = _fixture()
    client = prc.PineRuntimeClient(url="http://x", secret="s", identity=fx["identity"])
    job = prc.Job(job=fx["job"]["job"], ticker="RDDT", tf="D", bars=[], want=tuple(want))
    try:
        return client._result(result, job, n or fx["job"]["n"])
    except prc._Refuse as e:
        return e


def test_the_served_record_decodes_and_verifies_through_the_one_door():
    fx = _fixture()
    res = _decode(dict(fx["result"]))
    assert isinstance(res, prc.JobResult), getattr(res, "sentence", res)
    assert res.status == "ok" and res.columns == {}
    assert res.strategy == json.loads(fx["result"]["strategy"])
    assert res.strategy["schema"] == codec.STRATEGY_RECORD_SCHEMA
    assert res.refusal_for(codec.STRATEGY_WANT) is None
    assert codec.strategy_record_sha256(fx["result"]["strategy"]) == fx["result"]["strategy_sha256"]


@pytest.mark.parametrize("mutate,why", [
    (lambda r: r.update(strategy=r["strategy"].replace('"qty":1', '"qty":2', 1)), "does not verify"),
    (lambda r: r.update(strategy_sha256="0" * 64), "does not verify"),
    (lambda r: r.pop("strategy_sha256"), "does not verify"),
    (lambda r: r.pop("strategy"), "does not verify"),
    (lambda r: r.update(strategy=r["strategy"].replace('"entryPrice":104', '"entryPrice":NaN'),
                        strategy_sha256=codec.strategy_record_sha256(
                            r["strategy"].replace('"entryPrice":104', '"entryPrice":NaN'))), "not a JSON number"),
    (lambda r: r.update(strategy="[]", strategy_sha256=codec.strategy_record_sha256("[]")), "not an object"),
])
def test_a_record_that_does_not_verify_withholds_the_job_as_integrity(mutate, why):
    r = dict(_fixture()["result"])
    mutate(r)
    res = _decode(r)
    assert isinstance(res, prc._Refuse) and res.guard == prc.INTEGRITY
    assert why in res.sentence


def test_a_record_not_asked_for_and_a_record_both_served_and_refused_are_integrity():
    fx = _fixture()
    assert "not asked for" in _decode(dict(fx["result"]), want=()).sentence
    both = dict(fx["result"], refusals=[{"key": codec.STRATEGY_WANT, "guard": "x", "sentence": "s", "bar": None}])
    assert isinstance(_decode(both), prc._Refuse)
    held = {"job": "RDDT", "status": "withheld", "refusals": [{"key": "*", "guard": "g", "sentence": "s", "bar": None}],
            "strategy": fx["result"]["strategy"]}
    assert "strategy record" in _decode(held).sentence


def test_asked_and_refused_by_name_is_an_answer_not_an_integrity_failure():
    fx = _fixture()
    client = prc.PineRuntimeClient(url="http://x", secret="s", identity=fx["identity"])
    refusals = [{"key": codec.STRATEGY_WANT, "guard": "runtime:server-output-absent", "sentence": "none", "bar": None}]
    digest = client._digest({}, [{"key": codec.STRATEGY_WANT, "guard": "runtime:server-output-absent", "bar": None}])
    r = {"job": "RDDT", "status": "ok", "columns": {}, "refusals": refusals, "warmup": {"withheldBars": 0}, "digest": digest}
    res = _decode(r)
    assert isinstance(res, prc.JobResult) and res.strategy is None
    assert res.refusal_for(codec.STRATEGY_WANT).guard == "runtime:server-output-absent"


def test_the_client_states_the_window_only_when_the_caller_does_and_never_defaults_it():
    base = prc.Job(job="A", ticker="A", tf="D", bars=[])
    assert "historyWindowBars" not in prc._ctx_of(base)
    assert prc._ctx_of(prc.Job(job="A", ticker="A", tf="D", bars=[], history_window_bars=HISTORY_WINDOW_BARS))[
        "historyWindowBars"] == HISTORY_WINDOW_BARS
    for bad in (0, -1, True, 2.5, "5000"):
        with pytest.raises(prc._Refuse):
            prc._ctx_of(prc.Job(job="A", ticker="A", tf="D", bars=[], history_window_bars=bad))


# --- the route --------------------------------------------------------------------------------

def strategy_row(stamp=codec.STRATEGY_WINDOW_HISTORY):
    meta = {"runtimeHistory": stamp} if stamp else {}
    return {"def_id": DEF_ID, "version": 2, "user_id": "paid1",
            "definition": {"meta": meta, "compute": {"kind": "runtime", "source": "//@version=5\nstrategy('x')",
                                                     "outputs": {"p": 0}}}}


def _store_rows(n=12):
    return [(20240102 + i, 10.0 + i, 11.0 + i, 9.0 + i, 10.5 + i, 1000.0) for i in range(n)]


class StubClient:
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def run(self, **kw):
        self.calls.append(kw)
        return [self.answer(j) for j in kw["jobs"]]


def record_for(job, **window):
    # the stub stands in for the JS service, so it states the start by the route's mirror of
    # `strategyRecord.js::startSentenceOf` (held to the JS function by the W9-T13a fixture rail below)
    w = {"startTime": job.bars[0]["t"], "startDate": pst.start_date_of(job.bars[0]["t"]),
         "startSentence": pst.start_sentence_of(job.bars[0]["t"]), "fromListing": False, "bars": len(job.bars),
         "historyWindowBars": HISTORY_WINDOW_BARS, "asOfBar": job.bars[-1]["t"], **window}
    return {"schema": codec.STRATEGY_RECORD_SCHEMA, "window": w, "trades": [], "settings": {}}


def ok(job, **window):
    return prc.JobResult(job=job.job, status="ok", warmup={"withheldBars": 0}, strategy=record_for(job, **window))


def withheld(guard, sentence="why", bar=7):
    return lambda job: prc.JobResult(job=job.job, status="withheld", refusals=(prc.Refusal("*", guard, sentence, bar),))


@pytest.fixture
def world(monkeypatch):
    state = {"open": True, "paid": True, "row": strategy_row(), "reads": [], "client": StubClient(ok),
             "admission": None}
    monkeypatch.setattr(rd, "server_permitted", lambda role, uid: state["open"])
    monkeypatch.setattr(pst, "is_paid_user", lambda u: state["paid"])
    monkeypatch.setattr(defs, "get", lambda uid, did, version=None:
                        dict(state["row"]) if (did == DEF_ID and uid == "paid1") else None)
    monkeypatch.setattr(sbt.runtime_server_lane, "admission", lambda row, plot, lane: state["admission"])

    def get_bars(sym, tf, n):
        state["reads"].append((sym, tf, n))
        return [] if sym == "NONE" else _store_rows()
    monkeypatch.setattr(bars_sqlite, "get_bars", get_bars)
    monkeypatch.setattr(pst, "_runtime_client", lambda: state["client"])
    # W9-T4-F1: the store's CACHED exchange per ticker (r1 N2: the route reads the cache only)
    from api.services import ticker_meta
    state["exchanges"] = {"AAA": "NYSE"}
    monkeypatch.setattr(ticker_meta, "_peek_base",
                        lambda sym: {"exchange": state["exchanges"].get(sym)} if sym in state["exchanges"] else None)

    state["provider_calls"] = []

    def no_provider(*a, **k):
        state["provider_calls"].append(a)
        raise AssertionError("the strategy route made a provider call")
    for name in ("get_ticker_meta", "_base_meta", "_from_yfinance", "_from_fmp", "_from_finnhub", "_primary_theme"):
        monkeypatch.setattr(ticker_meta, name, no_provider)
    app = FastAPI()
    app.include_router(pst.router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    state["http"] = TestClient(app)
    return state


def post(w, **body):
    return w["http"].post("/api/pine/strategy-backtest", json={"def_id": DEF_ID, "symbols": ["AAA"], **body})


def test_DARK_the_route_is_not_there_while_the_server_stage_admits_nobody(world):
    world["open"] = False
    world["paid"] = False
    r = post(world)
    assert r.status_code == 404
    assert world["reads"] == [] and world["client"].calls == []


def test_DARK_by_default_the_real_stage_admits_nobody(monkeypatch):
    """No monkeypatch of the stage: with PINE_RUNTIME_SERVER_STAGE / PINE_RUNTIME_STAGE unset the
    real `server_permitted` refuses a member and an admin alike."""
    monkeypatch.delenv(rd.SERVER_STAGE_ENV, raising=False)
    monkeypatch.delenv(rd.STAGE_ENV, raising=False)
    for user in (PAID, {"id": "a1", "role": "admin", "plan": "pro"}):
        with pytest.raises(HTTPException) as e:
            pst._require_open(dict(user))
        assert e.value.status_code == 404


def test_auth_unauthenticated_is_401_and_unpaid_is_402(world):
    app = FastAPI()
    app.include_router(pst.router)
    assert TestClient(app).post("/api/pine/strategy-backtest", json={"def_id": DEF_ID, "symbols": ["AAA"]}).status_code == 401
    world["paid"] = False
    r = post(world)
    assert r.status_code == 402 and r.json()["detail"] == "Strategy backtesting requires a paid plan"


def test_the_window_is_the_one_authority_and_the_start_is_stated(world):
    r = post(world, symbols=[" aaa "])
    assert r.status_code == 200, r.text
    assert world["reads"] == [("AAA", "D", HISTORY_WINDOW_BARS)]
    [call] = world["client"].calls
    assert call["profile"] == "backtest"
    for job in call["jobs"]:
        assert job.history_window_bars == HISTORY_WINDOW_BARS
        assert job.history_from_listing is False
        assert job.want == (codec.STRATEGY_WANT,)
    body = r.json()
    assert body["historyWindowBars"] == HISTORY_WINDOW_BARS
    a = body["results"][0]
    assert a["symbol"] == "AAA" and a["status"] == "ok"
    assert a["window"]["startDate"] == "2024-01-02" and a["window"]["fromListing"] is False
    assert a["window"]["note"] == "this backtest starts on 2024-01-02 (UTC); TradingView may start elsewhere"
    assert a["window"]["startTime"] == call["jobs"][0].bars[0]["t"]
    assert a["strategy"] == record_for(call["jobs"][0])


def test_a_non_listing_window_refused_by_the_broker_is_served_with_its_start(world):
    world["client"] = StubClient(withheld("runtime:strategy-unsettled", "not known to start at the listing (Q-S1n)", 0))
    r = post(world)
    assert r.status_code == 200, r.text
    a = r.json()["results"][0]
    assert a["status"] == "refused"
    assert a["refusal"] == {"guard": "runtime:strategy-unsettled", "sentence": "not known to start at the listing (Q-S1n)", "bar": 0}
    assert a["window"]["startDate"] == "2024-01-02" and a["window"]["bars"] == 12


@pytest.mark.parametrize("guard", ["runtime:strategy-unpinned", "pine:strategy-call", "runtime:strategy-start"])
def test_every_script_refusal_is_answered_by_name_per_symbol(world, guard):
    world["client"] = StubClient(withheld(guard))
    a = post(world).json()["results"][0]
    assert a["status"] == "refused" and a["refusal"]["guard"] == guard and "strategy" not in a


def test_a_symbol_with_no_bars_is_stated_and_never_sent(world):
    r = post(world, symbols=["NONE"]).json()["results"]
    assert r[0]["refusal"]["guard"] == "runtime:strategy-no-bars" and r[0]["window"] is None
    assert world["client"].calls == []


@pytest.mark.parametrize("guard,code", [(prc.UNAVAILABLE, 503), (prc.BUSY, 503), (prc.INTEGRITY, 500),
                                        (prc.ENGINE_MISMATCH, 409), (prc.TIME_BUDGET, 409)])
def test_a_transport_refusal_is_the_whole_answer_by_W5_T15s_table(world, guard, code):
    world["client"] = StubClient(withheld(guard))
    r = post(world)
    assert r.status_code == code and r.json()["detail"].startswith(guard)


def test_one_authority_a_record_describing_another_window_is_a_500(world):
    world["client"] = StubClient(lambda job: ok(job, historyWindowBars=HISTORY_WINDOW_BARS + 1))
    assert post(world).status_code == 500
    world["client"] = StubClient(lambda job: ok(job, bars=len(job.bars) - 1))
    assert post(world).status_code == 500


def test_D5_the_refusal_names_are_the_published_ones():
    """The names a member (and the docs) read; a rename is a contract change, not a refactor."""
    assert pst.MULTI_SYMBOL_GUARD == "runtime:strategy-multi-symbol"
    assert pst.NO_SYMBOL_GUARD == "runtime:strategy-no-symbol"
    assert pst.MAX_SYMBOLS == 1


def test_D5_one_symbol_passes_the_gate_and_is_run(world):
    r = post(world, symbols=["AAA"])
    assert r.status_code == 200, r.text
    assert [a["symbol"] for a in r.json()["results"]] == ["AAA"]
    assert [j.job for j in world["client"].calls[0]["jobs"]] == ["AAA"]


@pytest.mark.parametrize("symbols", [["AAA", "BBB"], ["AAA", "AAA"], ["AAA", "aaa"], ["A", "B", "C", "D", "E"]])
def test_D5_two_or_more_symbols_refuse_by_name_and_nothing_runs(world, symbols):
    """Single-symbol only (D5, 2026-11-07). Never truncated: even the same ticker twice is refused,
    so the answer never covers fewer symbols than were sent."""
    r = post(world, symbols=symbols)
    assert r.status_code == 400
    assert r.json()["detail"].startswith(pst.MULTI_SYMBOL_GUARD + ":")
    assert f"names {len(symbols)}" in r.json()["detail"]
    assert world["reads"] == [] and world["client"].calls == []


def test_D5_zero_symbols_refuse_by_name_and_nothing_runs(world):
    r = post(world, symbols=[])
    assert r.status_code == 400
    assert r.json()["detail"].startswith(pst.NO_SYMBOL_GUARD + ":")
    assert world["reads"] == [] and world["client"].calls == []


def test_D5_the_refusals_come_after_the_dark_and_plan_gates(world):
    """A caller the stage does not admit, or an unpaid one, never learns the symbol rule."""
    world["paid"] = False
    assert post(world, symbols=["A", "B"]).status_code == 402
    world["open"] = False
    assert post(world, symbols=[]).status_code == 404


def test_D5_the_plan_gate_is_the_W5_server_lanes_own_predicate():
    """D5: "the same plan gate as the W5 server lane". Every W5 server-lane door gates on
    `auth_middleware.is_paid_user` over `get_current_user_with_plan`; this route's `require_paid`
    calls that very function (not a copy), behind its dark gate, which reads the same user."""
    import inspect
    from api.middleware import auth_middleware
    from api.routers import definition_record, scan_results, user_definitions as udr
    assert pst.is_paid_user is auth_middleware.is_paid_user
    for door in (sbt, scan_results, udr, definition_record):
        assert door.is_paid_user is auth_middleware.is_paid_user, door.__name__
    assert "is_paid_user(user)" in inspect.getsource(pst.require_paid)
    open_dep = inspect.signature(pst.require_paid).parameters["user"].default.dependency
    assert open_dep is pst._require_open
    assert inspect.signature(pst._require_open).parameters["user"].default.dependency is get_current_user_with_plan


def test_the_store_and_the_stamp_are_asked_first(world):
    assert world["http"].post("/api/pine/strategy-backtest", json={"def_id": "u_ffffffffffff", "symbols": ["A"]}).status_code == 404
    world["row"] = strategy_row(stamp=None)
    r = post(world)
    assert r.status_code == 409 and r.json()["detail"].startswith("runtime:not-strategy")
    world["row"] = strategy_row()
    world["admission"] = ("runtime:server-stage", "not switched on")
    r = post(world)
    assert r.status_code == 409 and r.json()["detail"].startswith("runtime:server-stage")
    assert world["client"].calls == []


# --- W5-T15's descriptor path -----------------------------------------------------------------

def test_a_screen_backtest_of_a_strategy_document_refuses_strategy_start(monkeypatch):
    monkeypatch.setattr(sbt.runtime_server_lane, "admission", lambda row, plot, lane: None)
    row = strategy_row()
    doc = row["definition"]
    with pytest.raises(HTTPException) as e:
        sbt._runtime_descriptor(row, doc, doc["compute"], DEF_ID, "paid1", "p")
    assert e.value.status_code == 409
    assert e.value.detail.startswith(codec.STRATEGY_START_GUARD + ":")
    assert str(HISTORY_WINDOW_BARS) in e.value.detail and str(sbt.RUNTIME_HISTORY_LEAD) in e.value.detail
    # control: the same document without the stamp is described as before
    plain = strategy_row(stamp=None)
    desc, _ = sbt._runtime_descriptor(plain, plain["definition"], plain["definition"]["compute"], DEF_ID, "paid1", "p")
    assert desc["plot"] == "p"


# --- E-3 walks the route ----------------------------------------------------------------------

def test_E3_walks_the_new_route_and_it_cannot_reach_the_sweep():
    from tests import test_scan_evaluator_off_request_path as e3
    handlers = e3._endpoints_from_router_routes()
    mine = [h for h in handlers if h[2] == "/api/pine/strategy-backtest"]
    assert mine == [("api.routers.pine_strategy_backtest", "run_strategy_backtest", "/api/pine/strategy-backtest")]
    assert e3._transitive_imports_and_calls(mine[0]) is False


# --- r1 (review W9-T14 N1, N2, coordinator item 2) ---------------------------------------------

def test_r1_G3_the_REAL_stage_is_asked_with_the_callers_own_role_and_id(monkeypatch):
    """N1: at `admins`/`admins` a member is told the route is not there and an admin is let past.
    The real `server_permitted`, never a stand-in that ignores its arguments."""
    monkeypatch.setenv(rd.STAGE_ENV, rd.STAGE_ADMINS)
    monkeypatch.setenv(rd.SERVER_STAGE_ENV, rd.STAGE_ADMINS)
    with pytest.raises(HTTPException) as e:
        pst._require_open({"id": "m1", "role": "member", "plan": "pro"})
    assert e.value.status_code == 404
    admin = {"id": "a1", "role": "admin", "plan": "pro"}
    assert pst._require_open(dict(admin)) == admin
    # and through HTTP: the member's request reads nothing
    reads = []
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda *a: reads.append(a) or [])
    app = FastAPI()
    app.include_router(pst.router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    r = TestClient(app).post("/api/pine/strategy-backtest", json={"def_id": DEF_ID, "symbols": ["AAA"]})
    assert r.status_code == 404 and reads == []


@pytest.mark.parametrize("shift", [86_400, -86_400, 1])
def test_r1_W1_a_record_starting_on_another_bar_is_a_500(world, shift):
    """N2: the start half of the one-authority window check."""
    world["client"] = StubClient(lambda job: ok(job, startTime=job.bars[0]["t"] + shift))
    r = post(world)
    assert r.status_code == 500 and r.json()["detail"].startswith(prc.INTEGRITY)


DARK_FIXTURE = ROOT / "tests" / "fixtures" / "pine_runtime" / "w9t14_dark_result.json"


def test_r1_arming_the_shared_server_stage_does_not_make_a_strategy_run(monkeypatch):
    """Coordinator r1 item 2 (review N3). Both stages at `all` (as arming them for indicators would
    leave them), the script graded, the service configured: the route reaches the service, and the
    service -- whose broker gate nobody registers -- answers `pine:strategy-call`. The reply is the
    service's REAL sealed answer (`w9t14_dark_result.json`, written and byte-checked by
    `w9T14ServerRecord.test.js` from the server bundle's own surface), decoded here by the REAL
    client: the route serves the refusal by name and no record, and computes nothing itself."""
    monkeypatch.setenv(rd.STAGE_ENV, rd.STAGE_ALL)
    monkeypatch.setenv(rd.SERVER_STAGE_ENV, rd.STAGE_ALL)
    monkeypatch.setattr(rd, "not_graded", lambda source, graded_only=False: None)
    monkeypatch.setattr(rd, "service_missing", lambda: [])
    monkeypatch.setattr(rd, "killed", lambda def_id, source: None)
    monkeypatch.setattr(defs, "engine_withheld_reason", lambda row, current=None: None)
    monkeypatch.setattr(defs, "get", lambda uid, did, version=None: strategy_row() if did == DEF_ID else None)
    monkeypatch.setattr(pst, "is_paid_user", lambda u: True)
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda sym, tf, n: _store_rows())
    dark = json.loads(DARK_FIXTURE.read_text(encoding="utf-8"))
    sent = []

    def transport(url, body, headers, timeout):
        req = json.loads(body)
        sent.append(req)
        return 200, json.dumps({"protocol": 1, "engine": dark["identity"],
                                "results": [dict(dark["result"], job=j["job"]) for j in req["jobs"]]}).encode()

    prc._forget_signing_times()
    monkeypatch.setattr(pst, "_runtime_client", lambda: prc.PineRuntimeClient(
        url="http://pine-runtime.test", secret="s", identity=dark["identity"], transport=transport))
    app = FastAPI()
    app.include_router(pst.router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    r = TestClient(app).post("/api/pine/strategy-backtest", json={"def_id": DEF_ID, "symbols": ["RDDT"]})
    assert r.status_code == 200, r.text
    [a] = r.json()["results"]
    assert a["status"] == "refused" and "strategy" not in a
    assert a["refusal"]["guard"] == "pine:strategy-call"
    assert a["window"]["fromListing"] is False and a["window"]["startDate"] == "2024-01-02"
    # the one request the route made: the record asked for, over the one window, no listing claimed
    [req] = sent
    assert req["profile"] == "backtest"
    assert req["jobs"][0]["want"] == [codec.STRATEGY_WANT]
    assert req["jobs"][0]["ctx"]["historyWindowBars"] == HISTORY_WINDOW_BARS
    assert req["jobs"][0]["ctx"]["historyFromListing"] is False


# --- W9-T13a r1, ruling D2: ONE authority over the start sentence -----------------------------

START_FIXTURE = ROOT / "tests" / "fixtures" / "pine_runtime" / "w9t13a_start_sentence.json"


def _start_cases():
    return json.loads(START_FIXTURE.read_text(encoding="utf-8"))["cases"]


def test_D2_the_routes_mirror_says_exactly_what_strategyRecord_js_says():
    """The fixture is WRITTEN by `w9T13aBrokerReport.test.js` from `strategyRecord.js` (and
    byte-checked there), so this compares the route's refusal-path mirror to the JS function."""
    cases = _start_cases()
    assert any(c["name"].startswith("ASX") for c in cases)
    # review N3: a start between 00:00 and 05:59 UTC is the previous day in host-local US time
    assert any(0 <= (c["startTime"] % 86400) < 6 * 3600 for c in cases)
    # W9-T13b r1, D2 ALWAYS: a run from the listing states the same sentence, so the mirror needs no
    # listing argument (and the route's runs are never from the listing anyway)
    assert any(c["fromListing"] is True for c in cases)
    assert all(isinstance(c["recordSentence"], str) and c["recordSentence"] for c in cases)
    for c in cases:
        assert pst.start_date_of(c["startTime"]) == c["startDate"]
        assert pst.start_sentence_of(c["startTime"]) == c["recordSentence"] == c["reportSentence"]
    assert pst.start_sentence_of(None) == "this backtest ran over no bars"


def _asx(world):
    """A non-US daily session: the bar time SENT is the ASX open (23:00 UTC the day before), so a
    route that dated the start from its own bars instead of the run's time would say another day."""
    [c] = [c for c in _start_cases() if c["name"].startswith("ASX")]
    bars = [{"t": c["startTime"] + i * 86400, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1.0} for i in range(3)]
    world["bars"] = bars
    return c, bars


def test_D2_a_non_US_session_route_and_report_state_the_identical_sentence(world, monkeypatch):
    c, bars = _asx(world)
    monkeypatch.setattr(pst, "_window_bars", lambda sym: [dict(b) for b in bars])

    def answer(job):  # the record the JS service would send: its window as `strategyRecordOf` states it
        rec = record_for(job)
        rec["window"].update(startDate=c["startDate"], startSentence=c["recordSentence"])
        return prc.JobResult(job=job.job, status="ok", warmup={"withheldBars": 0}, strategy=rec)
    world["client"] = StubClient(answer)
    r = post(world)
    assert r.status_code == 200, r.text
    a = r.json()["results"][0]
    assert a["status"] == "ok"
    assert a["window"]["startTime"] == c["startTime"]
    assert a["window"]["note"] == c["reportSentence"] == a["strategy"]["window"]["startSentence"]
    assert a["window"]["startDate"] == c["startDate"] == "2024-03-20"


def test_D2_a_non_US_session_refused_states_the_same_sentence(world, monkeypatch):
    c, bars = _asx(world)
    monkeypatch.setattr(pst, "_window_bars", lambda sym: [dict(b) for b in bars])
    world["client"] = StubClient(withheld("runtime:strategy-unsettled", "why", 0))
    a = post(world).json()["results"][0]
    assert a["status"] == "refused"
    assert a["window"]["note"] == c["recordSentence"]
    assert a["window"]["startDate"] == c["startDate"]


def test_D2_a_record_that_does_not_state_its_start_by_the_rule_is_a_500(world):
    world["client"] = StubClient(lambda job: ok(job, startDate="1999-01-01"))
    assert post(world).status_code == 500
    world["client"] = StubClient(lambda job: ok(job, startSentence=None))
    assert post(world).status_code == 500


# --- W9-T4-F1: the job carries the store's exchange; the SERVICE settles the minimum contract -------

def test_F1_the_job_carries_the_symbols_store_exchange(world):
    """The route hands the service ``{ticker, exchange}`` from the store the chart reads, so the run's
    ``syminfo.*`` (and the broker's minimum contract, derived from it in ``runtimeColumns.js``) settle
    from one symbol. It never states a minimum contract itself."""
    r = post(world, symbols=["AAA"])
    assert r.status_code == 200, r.text
    [job] = world["client"].calls[0]["jobs"]
    assert (job.ticker, job.exchange) == ("AAA", "NYSE")


@pytest.mark.parametrize("meta", [None, {}, {"exchange": None}, {"exchange": 7}, {"exchange": "x" * 40},
                                  {"exchange": "bad\tname"}])
def test_F1_an_unknown_or_unusable_exchange_is_empty_never_guessed(world, monkeypatch, meta):
    from api.services import ticker_meta
    monkeypatch.setattr(ticker_meta, "_peek_base", lambda sym: meta)
    r = post(world, symbols=["AAA"])
    assert r.status_code == 200, r.text
    assert world["client"].calls[0]["jobs"][0].exchange == ""


def test_F1_a_store_failure_is_empty_never_a_dead_request(world, monkeypatch):
    from api.services import ticker_meta

    def boom(sym):
        raise RuntimeError("cache unreadable")
    monkeypatch.setattr(ticker_meta, "peek_exchange", boom)
    r = post(world, symbols=["AAA"])
    assert r.status_code == 200, r.text
    assert world["client"].calls[0]["jobs"][0].exchange == ""


def test_F1_the_route_never_states_a_minimum_contract():
    """The wire's ctx is closed (``protocol.mjs``); the route must not try to smuggle one either."""
    text = (ROOT / "api" / "routers" / "pine_strategy_backtest.py").read_text(encoding="utf-8")
    assert not re.search(r"\bminContract\b|min_contracts?\s*=", text)


def test_F1_r1_a_cold_cache_is_empty_and_never_calls_a_provider(world):
    """r1 N2: nothing cached for the ticker -> "" (sizing then refuses by name). The fixture makes every
    provider-backed reader raise, so a synchronous provider call on the request path fails this test."""
    world["exchanges"] = {}
    r = post(world, symbols=["AAA"])
    assert r.status_code == 200, r.text
    assert world["client"].calls[0]["jobs"][0].exchange == ""
    assert world["provider_calls"] == []


def test_F1_r1_peek_exchange_reads_memory_then_disk_and_nothing_else(monkeypatch, tmp_path):
    """The accessor itself: memory hit, disk hit (24h entry), cold -> None; never a provider."""
    from api.services import ticker_meta as tm

    def no_provider(*a, **k):
        raise AssertionError("peek_exchange made a provider call")
    for name in ("_base_meta", "_from_yfinance", "_from_fmp", "_from_finnhub", "_primary_theme"):
        monkeypatch.setattr(tm, name, no_provider)
    monkeypatch.setattr(tm, "_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(tm, "_mem", tm.TTLCache())  # a fresh memory layer, nothing leaks
    tm._mem.set("tmeta_ZZMEM", {"exchange": "NASDAQ"}, ttl=60)
    assert tm.peek_exchange("zzmem") == "NASDAQ"
    (tmp_path / "ZZDISK.json").write_text(json.dumps({"name": "x", "exchange": "NYSE Arca"}), encoding="utf-8")
    assert tm.peek_exchange("ZZDISK") == "NYSE Arca"
    assert tm.peek_exchange("ZZCOLD") is None
    (tmp_path / "ZZNOEX.json").write_text(json.dumps({"name": "x", "exchange": None}), encoding="utf-8")
    assert tm.peek_exchange("ZZNOEX") is None
    assert tm.peek_exchange("") is None

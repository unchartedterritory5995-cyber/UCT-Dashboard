"""EVST, a member's own historical event study (api/services/event_study_member.py, api/routers/event_study.py).
Every price, date, symbol and series value here is INVENTED.

  * the menu: grouped by category from the adapters' own static metadata, value-free, reads no store,
    names the kinds not offered and why, and every ready-made example is a study the route takes;
  * the spec: the engine's own `validate` judges it under this route's scope; every refusal is ONE plain
    sentence; the windows are a fixed menu of at most four;
  * the study: the engine's numbers shaped for the panel (per window, against every session; every
    episode newest first; the method in words), "no episodes" and "too little history for that window"
    as counts, never zeros; the study ends on the evening's session;
  * the held answers: per spec per evening, never computed on the request (computing, then the answer),
    the queue bound (busy), a transient failure never held, a refusal held;
  * the bound: a heavy study measured through the real engine;
  * the route: two paid GETs, 401 / 402, 422 with a plain sentence, a plain def, mounted; local only.
"""
from __future__ import annotations

import inspect
import pathlib
import re
import threading
import time
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import event_study as route
from api.services import event_study_member as M
from api.services import session_calendar as sc
from api.services.held_reads import KeyedHeld
from api.services.market_intel import event_study as ES
from api.services.market_intel import price_reads

ROOT = pathlib.Path(__file__).resolve().parents[1]
FREE_USER = {"id": "evs-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "evs-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
EVENING = "2026-06-30"


def sessions(start: str, end: str) -> list[str]:
    d, stop, out = date.fromisoformat(start), date.fromisoformat(end), []
    while d <= stop:
        if sc.covers(d) and sc.is_trading_day(d):
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def walk(days: list[str], seed: int = 7, start: float = 100.0, drop_every: int = 0) -> list[dict]:
    """An invented close series: a small deterministic wobble, with a -4% day every `drop_every` sessions."""
    x, c, out = seed, start, []
    for i, d in enumerate(days):
        x = (x * 1103515245 + 12345) % (2 ** 31)
        move = ((x % 2001) - 1000) / 100000.0          # -1% .. +1%
        if drop_every and i and i % drop_every == 0:
            move = -0.04
        c = max(1.0, c * (1.0 + move + 0.0002))
        out.append({"t": d, "o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": 1_000_000})
    return out


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    M.reset_for_tests()
    monkeypatch.setattr(M, "_held", KeyedHeld("event-study-test", M._build_for, lambda a, c: False, max_keys=M.MAX_HELD, wait_s=5.0))
    monkeypatch.setattr(M, "session_key", lambda now: EVENING)
    yield
    M._held.drain(5.0)
    M.reset_for_tests()


def _store(monkeypatch, bars_by_symbol: dict):
    reads = []

    def load(sym):
        reads.append(sym)
        if sym not in bars_by_symbol:
            return []
        return [dict(b) for b in bars_by_symbol[sym]]
    monkeypatch.setattr(price_reads, "_load_bars", load)
    return reads


def _spec(**over) -> dict:
    base = {"kind": "technical", "series": "ZZQA", "indicator": "day_pct", "op": "below", "threshold": "-3",
            "symbol": "ZZQA", "horizons": "1w,1mo,3mo", "episodes": "first", "entry": "event_close"}
    base.update(over)
    return base


def _plain(sentence: str) -> bool:
    return (isinstance(sentence, str) and sentence.endswith(".") and len(sentence) < 200
            and not re.search(r"[_{}\[\]|]|cross_|event_close|next_close", sentence))


# ── the menu ─────────────────────────────────────────────────────────────────────────────────

def test_the_menu_groups_every_wired_kind_from_the_adapters_metadata_and_reads_no_store(monkeypatch):
    from api.services.market_indicators import series as mis
    from api.services.market_intel import breadth_reads, series_adapters
    monkeypatch.setattr(price_reads, "_load_bars", lambda s: pytest.fail("the menu read prices"))
    monkeypatch.setattr(breadth_reads, "sealed_series", lambda *a: pytest.fail("the menu read breadth"))
    monkeypatch.setattr(mis, "cot_observations", lambda *a: pytest.fail("the menu read COT"))
    M.catalog.cache_clear()
    cat = M.catalog()
    assert [c["kind"] for c in cat["categories"]] == list(M.MEMBER_KINDS) == ["breadth", "technical", "cot"]
    breadth, tech, cot = cat["categories"]
    assert [u["universe"] for u in breadth["universes"]] == list(breadth_reads.SLICE1_UNIVERSES)
    assert [m["metric"] for m in breadth["metrics"]] == list(breadth_reads.SLICE1_METRICS)
    a50 = next(m for m in breadth["metrics"] if m["metric"] == "pct_above_50sma")
    meta, _ = series_adapters.describe({"kind": "breadth", "universe": "us", "metric": "pct_above_50sma"})
    assert meta["label"].endswith(a50["name"]) and a50["unit"] == meta["unit"] and a50["domain"] == meta["domain"]
    assert [i["indicator"] for i in tech["indicators"]] == list(series_adapters._TECH)
    rsi = next(i for i in tech["indicators"] if i["indicator"] == "rsi")
    assert rsi["name"] == "RSI" and rsi["period"] == {"min": 2, "max": 200, "default": 14}
    assert next(i for i in tech["indicators"] if i["indicator"] == "day_pct")["period"] is None
    assert {g["group"] for g in cot["groups"]} == {"large_spec", "commercial", "small_spec"}
    assert any(m["market"] == "GC" for m in cot["markets"]) and len(cot["markets"]) > 20
    # the kinds the engine knows that this route does not run, each with why
    assert [x["kind"] for x in cat["not_offered"]] == ["econ", "fundamental", "market_cap"]
    assert set(series_adapters.ADAPTERS) == set(M.MEMBER_KINDS) | {x["kind"] for x in cat["not_offered"]}
    assert all(_plain(x["why"]) for x in cat["not_offered"])
    assert cat["max_horizons"] == 4 and [h["token"] for h in cat["horizons"]] == list(M.HORIZONS)
    assert cat["defaults"] == {"symbol": "SPY", "horizons": ["1mo", "3mo", "6mo"], "episodes": "first", "entry": "event_close"}


def test_the_menu_holds_no_data_value():
    cat = M.catalog()
    numbers = []

    def scan(v, path=""):
        if isinstance(v, dict):
            for k, x in v.items():
                scan(x, f"{path}.{k}")
        elif isinstance(v, list):
            for x in v:
                scan(x, path)
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            numbers.append(path)
    scan(cat)
    # the only numbers are period bounds and the window cap: no series value, no date, no count of data
    assert set(numbers) <= {".categories.indicators.period.min", ".categories.indicators.period.max",
                            ".categories.indicators.period.default", ".max_horizons"}, set(numbers)


def test_every_ready_made_example_is_a_study_the_route_takes_on_a_wired_series():
    cat = M.catalog()
    assert 2 <= len(cat["examples"]) <= 3
    kinds = set()
    for ex in cat["examples"]:
        study, why = M.parse(ex["spec"])
        assert why is None, (ex["id"], why)
        assert study["spec"]["kind"] in M.MEMBER_KINDS
        kinds.add(study["spec"]["kind"])
        assert ES.validate(study["request"], allowed_kinds=M.MEMBER_KINDS)[1] is None
    assert kinds == set(M.MEMBER_KINDS)            # one from each wired category


# ── the spec ─────────────────────────────────────────────────────────────────────────────────

def test_a_spec_becomes_the_engines_request_judged_by_the_engines_own_validate(monkeypatch):
    seen = []
    real = ES.validate
    monkeypatch.setattr(ES, "validate", lambda req, allowed_kinds=None: seen.append(tuple(allowed_kinds)) or real(req, allowed_kinds=allowed_kinds))
    study, why = M.parse(_spec(horizons="3mo,1w,1mo,1w"))
    assert why is None and seen == [M.MEMBER_KINDS]
    assert study["spec"] == {"kind": "technical", "series": "ZZQA", "indicator": "day_pct", "op": "below",
                             "threshold": -3.0, "symbol": "ZZQA", "horizons": ["1w", "1mo", "3mo"],
                             "episodes": "first", "entry": "event_close"}
    assert study["request"]["horizons"] == [{"sessions": 5}, {"months": 1}, {"months": 3}]
    assert study["request"]["condition"] == {"series": {"kind": "technical", "symbol": "ZZQA", "indicator": "day_pct"},
                                             "op": "below", "threshold": -3.0}
    b, why = M.parse({"kind": "breadth", "universe": "NASDAQ", "metric": "pct_above_50sma", "op": "below",
                      "threshold": "10", "symbol": "qqq", "horizons": ""})
    assert why is None and b["spec"]["universe"] == "nasdaq" and b["spec"]["symbol"] == "QQQ"
    assert b["spec"]["horizons"] == ["1mo", "3mo", "6mo"]            # the default windows
    c, why = M.parse({"kind": "cot", "market": "gc", "group": "large_spec", "op": "cross_below", "threshold": "0", "symbol": "GLD"})
    assert why is None and c["spec"]["market"] == "GC"


@pytest.mark.parametrize("over,words", [
    ({"kind": "econ"}, "Pick the kind of series first"),
    ({"kind": "fundamental"}, "Pick the kind of series first"),
    ({"op": "on_release"}, "Pick a condition"),
    ({"threshold": "ten"}, "Type the threshold as a number"),
    ({"threshold": "nan"}, "Type the threshold as a number"),
    ({"threshold": "1e300"}, "Type the threshold as a number"),
    ({"symbol": "$$$"}, "Name the ticker to measure afterwards"),
    ({"series": ""}, "Name the ticker whose indicator is measured"),
    ({"horizons": "1d,1w,2w,1mo,3mo"}, "Pick at most 4 windows."),
    ({"horizons": "5y"}, "A window is one of"),
    ({"episodes": "some"}, "Count each run once"),
    ({"entry": "open"}, "Measure from the close"),
    ({"indicator": "rsi", "period": "1"}, "The period must be a whole number from 2 to 200."),
    ({"indicator": "rsi", "period": "x"}, "The period is a whole number of sessions."),
    ({"indicator": "macd_hist", "period": "9"}, "MACD uses the standard 12/26/9 settings"),
    ({"indicator": "stochastic"}, "That technical indicator is not available for studies."),
    ({"kind": "breadth", "universe": "lse", "metric": "pct_above_50sma"}, "Breadth studies cover US, NYSE and Nasdaq stocks only."),
    ({"kind": "breadth", "universe": "us", "metric": "pct_above_50sma", "threshold": "150"}, "That threshold is not a possible value"),
    ({"kind": "cot", "market": "ZZZZ", "group": "large_spec"}, "There is no published COT series for ZZZZ."),
])
def test_a_spec_the_study_cannot_take_is_one_plain_sentence(over, words):
    study, why = M.parse(_spec(**over))
    assert study is None and (why.startswith(words) or words in why), why
    assert _plain(why), why


# ── the study ────────────────────────────────────────────────────────────────────────────────

def test_a_study_is_the_engines_numbers_shaped_for_the_panel(monkeypatch):
    days = sessions("2015-01-02", EVENING)
    reads = _store(monkeypatch, {"ZZQA": walk(days, drop_every=250)})
    study, _ = M.parse(_spec())
    got = M.get_study(study)
    assert got["status"] == "ok", got
    assert got["spec"] == study["spec"] and got["session"] == EVENING
    assert got["series"]["label"] == "ZZQA one-day change, close vs the previous close (%)"
    assert [h["token"] for h in got["horizons"]] == ["1w", "1mo", "3mo"]
    used = got["counts"]["events_used"]
    assert used == len(got["events"]) and used >= 5
    # the very numbers the engine works out, per window
    raw = ES._study(ES.validate({**study["request"], "end": EVENING})[0])
    for mine, theirs in zip(got["horizons"], raw["horizons"]):
        assert mine["n"] == theirs["n"] and mine["mean"] == pytest.approx(theirs["mean"])
        assert mine["median"] == pytest.approx(theirs["median"]) and mine["positive_rate"] == pytest.approx(theirs["positive_rate"])
        assert mine["best"]["return"] == pytest.approx(theirs["best"]["return"]) and mine["worst"]["event_date"] == theirs["worst"]["event_date"]
    assert [b["token"] for b in got["baseline"]] == ["1w", "1mo", "3mo"] and got["baseline"][0]["n"] > 1000
    # every episode, newest first, its condition value and a return per window
    dates = [e["event_date"] for e in got["events"]]
    assert dates == sorted(dates, reverse=True)
    assert all(e["condition_value"] < -3 for e in got["events"])
    assert all([r["token"] for r in e["returns"]] == ["1w", "1mo", "3mo"] for e in got["events"])
    # the engine's method in words, under the table
    lines = got["method"]["lines"]
    assert lines[0].startswith("Episodes: the first session of each run") and any(l.startswith("Entry: the close of the event session") for l in lines)
    assert any("split-adjusted, not dividend-adjusted" in l for l in lines)
    assert got["method"]["entry"] == "event_close" and got["source"]
    assert set(reads) == {"ZZQA"}


def test_the_study_ends_on_the_evenings_session_so_an_unclosed_session_is_never_an_episode(monkeypatch):
    days = sessions("2018-01-02", "2026-07-02")
    bars = walk(days)
    for b in bars:                                   # a -5% day after the evening (an unfinished session)
        if b["t"] == "2026-07-01":
            b["c"] = b["c"] * 0.95
    _store(monkeypatch, {"ZZQA": bars})
    study, _ = M.parse(_spec(threshold="-4.5"))
    got = M.get_study(study)
    assert got["status"] == "ok" and got["coverage"]["study_end"] <= EVENING
    assert all(e["event_date"] <= EVENING for e in got["events"])


def test_no_episodes_is_a_count_of_zero_never_a_row_of_zeros(monkeypatch):
    _store(monkeypatch, {"ZZQA": walk(sessions("2018-01-02", EVENING))})
    study, _ = M.parse(_spec(threshold="-30"))
    got = M.get_study(study)
    assert got["status"] == "ok" and got["counts"]["events_used"] == 0 and got["events"] == []
    assert all(h["n"] == 0 and "mean" not in h and "positive_rate" not in h for h in got["horizons"])
    assert all(b["n"] > 0 for b in got["baseline"])                   # every session still compares


def test_too_little_history_for_a_window_is_counted_as_still_open(monkeypatch):
    days = sessions("2025-06-02", EVENING)
    _store(monkeypatch, {"ZZQA": walk(days, drop_every=40)})
    study, _ = M.parse(_spec(horizons="1w,24mo"))
    got = M.get_study(study)
    w1, m24 = got["horizons"]
    assert w1["n"] > 0
    assert m24["n"] == 0 and m24["incomplete"] == got["counts"]["events_used"] > 0 and "mean" not in m24
    assert all(r["outcome"] == "incomplete" and r["return"] is None for e in got["events"] for r in e["returns"] if r["token"] == "24mo")


def test_a_symbol_with_no_stored_history_is_said_in_words_and_held(monkeypatch):
    reads = _store(monkeypatch, {})
    study, _ = M.parse(_spec())
    got = M.get_study(study)
    assert got["status"] == "unavailable" and got["reason"] == "no_price_history"
    assert got["detail"] == "UCT has no stored daily history for ZZQA."
    n = len(reads)
    assert M.get_study(study)["reason"] == "no_price_history" and len(reads) == n       # held, not read again


# ── the held answers ─────────────────────────────────────────────────────────────────────────

def test_one_answer_per_spec_per_evening_and_the_request_never_computes(monkeypatch):
    runs = []
    monkeypatch.setattr(M, "_run", lambda req: runs.append(req) or {"status": "unavailable", "reason": "no_overlap", "detail": "x."})
    study, _ = M.parse(_spec())
    M.get_study(study)
    M.get_study(study)
    assert len(runs) == 1 and runs[0]["end"] == EVENING
    other, _ = M.parse(_spec(threshold="-2"))
    M.get_study(other)
    assert len(runs) == 2
    monkeypatch.setattr(M, "session_key", lambda now: "2026-07-01")
    M.get_study(study)
    assert len(runs) == 3 and runs[-1]["end"] == "2026-07-01"
    callers = []
    monkeypatch.setattr(M, "_run", lambda req: callers.append(threading.current_thread().name) or {"status": "unavailable", "reason": "no_overlap"})
    monkeypatch.setattr(M, "session_key", lambda now: "2026-07-02")
    M.get_study(study)
    assert callers and callers[0] != threading.current_thread().name


def test_a_slow_study_says_computing_then_answers(monkeypatch):
    monkeypatch.setattr(M, "_held", KeyedHeld("event-study-test", M._build_for, lambda a, c: False, wait_s=0.05))
    gate = threading.Event()

    def slow(req):
        gate.wait(5)
        return {"status": "unavailable", "reason": "no_overlap", "detail": "Invented."}
    monkeypatch.setattr(M, "_run", slow)
    study, _ = M.parse(_spec())
    first = M.get_study(study)
    assert first == {"status": "computing", "spec": study["spec"], "session": EVENING}
    gate.set()
    M._held.drain(5)
    assert M.get_study(study)["status"] == "unavailable"


def test_the_study_queue_is_bounded_past_it_a_request_is_told_busy(monkeypatch):
    monkeypatch.setattr(M, "MAX_INFLIGHT", 0)
    monkeypatch.setattr(M, "_run", lambda req: pytest.fail("ran past the bound"))
    study, _ = M.parse(_spec())
    got = M.get_study(study)
    assert got["status"] == "busy" and got["reason"] == "busy" and _plain(got["detail"])


def test_a_series_that_could_not_be_read_just_now_is_never_held_for_the_evening(monkeypatch):
    monkeypatch.setattr(M, "RETRY_S", 0.3)
    monkeypatch.setattr(M, "BUSY_HOLD_S", 0.3)
    answers = [{"status": "unavailable", "reason": "read_failed", "detail": "x"},
               {"status": "unavailable", "reason": "warming", "detail": "x"},
               {"status": "unavailable", "reason": "no_overlap", "detail": "Invented."}]
    monkeypatch.setattr(M, "_run", lambda req: answers.pop(0))
    study, _ = M.parse(_spec())
    got = M.get_study(study)
    assert got["status"] == "busy" and got["reason"] == "read_failed" and _plain(got["detail"])
    assert M.get_study(study)["reason"] == "read_failed"              # said for the hold, not asked again
    time.sleep(0.35)
    assert M.get_study(study)["reason"] == "warming"
    time.sleep(0.35)
    held = M.get_study(study)
    assert held["status"] == "unavailable" and held["reason"] == "no_overlap"
    assert M.get_study(study) == held and answers == []                # a refusal IS held


def test_a_build_that_fails_is_said_and_never_a_500(monkeypatch):
    monkeypatch.setattr(M, "_run", lambda req: (_ for _ in ()).throw(RuntimeError("boom")))
    study, _ = M.parse(_spec())
    got = M.get_study(study)
    assert got["status"] == "busy" and got["reason"] == "error" and _plain(got["detail"])


# ── the bound ────────────────────────────────────────────────────────────────────────────────

def test_a_heavy_study_stays_inside_its_bound(monkeypatch, capsys):
    """The heaviest study the form can ask for: every session since the shared calendar starts (2000) an
    episode (`all`, a threshold every session passes), four windows up to 24 months, every session as the
    baseline. The engine's pool runs at most two at once; the windows are capped at four."""
    days = sessions("2000-01-03", EVENING)
    _store(monkeypatch, {"ZZQA": walk(days)})
    study, why = M.parse(_spec(op="above", threshold="-99", episodes="all", horizons="1d,1mo,12mo,24mo"))
    assert why is None
    req = {**study["request"], "end": EVENING}
    t0, c0 = time.perf_counter(), time.process_time()
    res = ES.run(req, deadline_s=60, allowed_kinds=M.MEMBER_KINDS)
    wall, cpu = time.perf_counter() - t0, time.process_time() - c0
    assert res["status"] == "ok" and res["counts"]["events_used"] > 6000
    with capsys.disabled():
        print(f"\n[evst] heavy study: {len(days)} sessions, {res['counts']['events_used']} episodes, "
              f"4 windows: {wall:.2f}s wall, {cpu:.2f}s CPU (this process)")
    assert wall < M.BUILD_DEADLINE_S
    assert ES._pool._max_workers == 2 and M.MAX_HORIZONS == 4 and M.MAX_INFLIGHT <= 8
    assert len(res["events"]) == ES.MAX_EVENTS_LISTED and res["events_listed_truncated"] is True


# ── the route ────────────────────────────────────────────────────────────────────────────────

def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_two_paid_gets_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(M, "get_study", lambda study: asked.append(study["spec"]) or {"status": "ok", "spec": study["spec"]})
    paths = {(r.path, tuple(sorted(r.methods))) for r in route.router.routes}
    assert paths == {("/api/research/event-study", ("GET",)), ("/api/research/event-study/series", ("GET",))}
    for r in route.router.routes:
        assert route.require_paid in {d.call for d in r.dependant.dependencies}
    assert route.require_paid.__module__ == "api.routers.event_study"
    q = "/api/research/event-study?kind=technical&series=ZZQA&indicator=day_pct&op=below&threshold=-3&symbol=ZZQA&horizons=1w"
    for path in (q, "/api/research/event-study/series"):
        assert _client(None).get(path).status_code == 401
        refused = _client(FREE_USER).get(path)
        assert refused.status_code == 402 and refused.json() == {"detail": "Historical studies require a paid plan"}
    assert asked == []
    ok = _client(PAID_USER).get(q)
    assert ok.status_code == 200 and ok.json()["spec"]["horizons"] == ["1w"]
    assert _client(PAID_USER).get("/api/research/event-study/series").json()["status"] == "ok"


def test_an_invalid_spec_is_422_with_one_plain_sentence(monkeypatch):
    monkeypatch.setattr(M, "get_study", lambda study: pytest.fail("an invalid spec reached the study"))
    c = _client(PAID_USER)
    for q, words in [
        ("kind=econ&symbol=SPY", "Pick the kind of series first"),
        ("kind=breadth&universe=us&metric=pct_above_50sma&op=below&threshold=150&symbol=SPY", "That threshold is not a possible value"),
        ("kind=technical&series=SPY&indicator=day_pct&op=below&threshold=-3&symbol=SPY&horizons=1d,1w,2w,1mo,3mo", "Pick at most 4 windows."),
        ("kind=technical&series=SPY&indicator=day_pct&op=below&threshold=abc&symbol=SPY", "Type the threshold as a number"),
    ]:
        r = c.get(f"/api/research/event-study?{q}")
        assert r.status_code == 422, q
        detail = r.json()["detail"]
        assert isinstance(detail, str) and detail.startswith(words) and _plain(detail), detail


def test_the_handlers_are_plain_defs_and_the_route_is_mounted():
    assert not inspect.iscoroutinefunction(route.get_event_study)
    assert not inspect.iscoroutinefunction(route.get_event_study_series)
    main = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    assert "from api.routers import event_study as event_study_router" in main
    assert "app.include_router(event_study_router.router)" in main


def test_local_only_no_model_client_and_the_agent_kind_untouched():
    for f in ("api/services/event_study_member.py", "api/routers/event_study.py"):
        src = (ROOT / f).read_text(encoding="utf-8")
        assert not re.search(r"^\s*(from|import)\s+\S*(anthropic|openai|uct_agent|llm)", src, re.I | re.M), f
    # the Agent's own scope is still technical only
    from api.services.uct_agent.history_note import ALLOWED_SERIES_KINDS
    assert ALLOWED_SERIES_KINDS == ("technical",)

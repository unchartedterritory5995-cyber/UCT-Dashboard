"""MD-1 kind `rs.leadership` (Phase 2 market intelligence) — relative strength + sector / industry leadership.

No network, no screener.db, no bars store, no industry map: every read seam of the adapter is stubbed (synthetic
values, never market data). Pins: the pure math (period return, identical-window excess, cohort stats), industry
resolution (exact / alias / unique contained match; ambiguous and not-covered never guessed), each scope's shape,
as_of = the RS session's close, stale by rs_history's OWN rule (its failures note), honest partials, the dark gate,
MODEL ISOLATION (refused for any purpose but "answer", dormant without UCT_AGENT_ISOLATED), and ACCESS: anonymous 401,
free 402 and paid non-admin 403 through the Agent's real doors, with the stores never read.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.uct_agent import turn
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import rs_leadership as rl

SESSION = "2026-11-12"
EXPECTED = 20261112
INDUSTRIES = ["Semiconductors", "Semiconductor Equipment & Materials", "Software - Application",
              "Software - Infrastructure", "Biotechnology", "Banks - Regional", "Exchange Traded Fund"]


def _closes(last: str, n: int, start: float, step: float):
    d = date.fromisoformat(last)
    out = []
    i = 0
    while len(out) < n:
        day = d - timedelta(days=i)
        i += 1
        if day.weekday() >= 5:
            continue
        out.append(day.isoformat())
    out.reverse()
    return [(t, round(start + step * k, 4)) for k, t in enumerate(out)]


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, rl.KIND)
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    gw._reset_for_test(None)
    yield
    gw._reset_for_test(None)


@pytest.fixture()
def store(monkeypatch):
    """Synthetic stores behind every seam; `calls` records each read so a refused request can prove it read nothing."""
    s = {"ratings": {}, "fail": [], "groups": {}, "members": {}, "bars": {}, "calls": []}

    def ratings(tickers, failures):
        s["calls"].append(("ratings", tuple(tickers)))
        failures.extend(s["fail"])
        return {t: dict(s["ratings"][t], asof=SESSION) if t in s["ratings"] else {} for t in tickers}

    def closes(sym, n, expected):
        s["calls"].append(("bars", sym, n))
        return list(s["bars"].get(sym, []))[-n:]
    monkeypatch.setattr(rl, "_ratings", ratings)
    monkeypatch.setattr(rl, "_closes", closes)
    monkeypatch.setattr(rl, "_groups", lambda t: (s["calls"].append(("groups",)), {k: v for k, v in s["groups"].items() if k in t})[1])
    monkeypatch.setattr(rl, "_industries", lambda: (s["calls"].append(("industries",)), list(INDUSTRIES))[1])
    monkeypatch.setattr(rl, "_members", lambda ind: (s["calls"].append(("members", ind)), list(s["members"].get(ind, [])))[1])
    monkeypatch.setattr(rl, "_expected_session", lambda: EXPECTED)
    return s


def _rt(ibd, d5=None, d20=None, **k):
    return {"ibd": ibd, "d5": d5, "d20": d20, "m1": k.get("m1"), "m3": k.get("m3"), "m6": k.get("m6"), "m12": k.get("m12")}


def _read(params, turn_id="t1", purpose="answer"):
    return gw.read(rl.KIND, params, user_id=1, turn_id=turn_id, purpose=purpose)


# ── pure math ────────────────────────────────────────────────────────────────────────────────────
def test_period_return_is_close_over_close_n_sessions_back():
    c = [("2026-11-09", 100.0), ("2026-11-10", 105.0), ("2026-11-11", 110.0), ("2026-11-12", 121.0)]
    assert rl.period_return(c, 3) == {"from": "2026-11-09", "to": "2026-11-12", "pct": 21.0}
    assert rl.period_return(c, 1) == {"from": "2026-11-11", "to": "2026-11-12", "pct": 10.0}
    assert rl.period_return(c, 4) is None                         # fewer than n+1 closes: no return, never a shorter one
    assert rl.period_return([("a", 0.0), ("b", 1.0)], 1) is None


def test_excess_only_over_the_identical_window():
    a = {"from": "2026-10-14", "to": "2026-11-12", "pct": 7.5}
    assert rl.excess(a, {"from": "2026-10-14", "to": "2026-11-12", "pct": 2.25}) == 5.25
    assert rl.excess(a, {"from": "2026-10-13", "to": "2026-11-12", "pct": 2.25}) is None
    assert rl.excess(a, {"from": "2026-10-14", "to": "2026-11-11", "pct": 2.25}) is None
    assert rl.excess(None, a) is None and rl.excess(a, None) is None


def test_cohort_stats_median_pairs_rank_and_top():
    r = {"A": _rt(90, d20=10), "B": _rt(80, d20=-5), "C": _rt(70, d20=0), "D": _rt(40), "E": {}, "F": _rt(90, d20=20)}
    st = rl.cohort_stats(r, ["A", "B", "C", "D", "E", "F"], focus="B")
    assert st["members"] == 6 and st["rated"] == 5 and st["median"] == 80.0
    assert st["paired_20"] == 4
    assert st["median_paired_now"] == 85.0                        # A 90, B 80, C 70, F 90
    assert st["median_paired_20_ago"] == 75.0                     # 80, 85, 70, 70
    assert st["median_change_20"] == 10.0
    assert st["at_or_above_80"] == 3 and st["rising_20"] == 2 and st["falling_20"] == 1
    assert st["top"][:3] == [{"symbol": "A", "rating": 90}, {"symbol": "F", "rating": 90}, {"symbol": "B", "rating": 80}]
    assert st["focus"] == {"symbol": "B", "rating": 80, "rank": 3}
    assert rl.cohort_stats(r, ["A"], focus="E")["focus"] is None   # an unrated focus has no rank
    assert rl.cohort_stats(r, ["A", "B", "C", "D", "E", "F"], focus="A")["focus"]["rank"] == 1   # ties share the higher rank


@pytest.mark.parametrize("word,want", [
    ("semis", "Semiconductors"), ("Semiconductors", "Semiconductors"), ("the semiconductor industry", "Semiconductors"),
    ("biotech", "Biotechnology"), ("biotech stocks", "Biotechnology"), ("regional banks", "Banks - Regional"),
    ("semi equipment", "Semiconductor Equipment & Materials"),
])
def test_industry_words_resolve_to_the_maps_own_names(word, want):
    assert rl.resolve_industry(word, INDUSTRIES) == (want, [])


def test_ambiguous_and_unknown_industries_are_never_guessed():
    ind, cands = rl.resolve_industry("software", INDUSTRIES)
    assert ind is None and cands == ["Software - Application", "Software - Infrastructure"]
    assert rl.resolve_industry("uranium", INDUSTRIES) == (None, [])
    assert rl.resolve_industry("solar", INDUSTRIES) == (None, [])          # an alias whose target the map lacks


# ── scopes ───────────────────────────────────────────────────────────────────────────────────────
def _seed_symbols(s):
    s["ratings"].update({"NVDA": _rt(95, d5=1, d20=4, m1=88, m3=92), "AMD": _rt(70, d20=-6), "INTC": _rt(30, d20=2),
                         "SPY": _rt(60, d20=1)})
    s["groups"].update({"NVDA": {"sector": "Technology", "industry": "Semiconductors"},
                        "AMD": {"sector": "Technology", "industry": "Semiconductors"},
                        "INTC": {"sector": "Technology", "industry": "Semiconductors"}})
    s["members"]["Semiconductors"] = ["AMD", "INTC", "NVDA", "ZZZ"]
    s["bars"]["SPY"] = _closes(SESSION, 30, 100.0, 0.1)
    s["bars"]["NVDA"] = _closes(SESSION, 30, 50.0, 0.5)


def test_symbols_scope_rating_change_return_vs_spy_and_industry_rank(store):
    _seed_symbols(store)
    out = _read({"scope": "symbols", "symbols": ["nvda"], "period": "1M"})
    assert env.validate_envelope(out) == [] and out["isolated"] is True
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["provider_calls"] == 0 and out["stale"] is False
    assert out["as_of"] == "2026-11-12T21:00:00Z"                 # the RS session's 4:00 PM ET close, in UTC
    d = out["data"]
    row = d["rows"][0]
    assert row["symbol"] == "NVDA" and row["rating"] == 95 and row["d5"] == 1 and row["d20"] == 4 and row["m3"] == 92
    spy = rl.period_return(store["bars"]["SPY"], 21)
    assert row["return"] == {**rl.period_return(store["bars"]["NVDA"], 21), "isolated": True}   # the gateway stamps every dict (ADR-005 F-21) and row["vs_spy"] == round(row["return"]["pct"] - spy["pct"], 2)
    ctx = row["industry_context"]
    assert ctx["rated"] == 3 and ctx["members"] == 4 and ctx["focus"] == {"symbol": "NVDA", "rating": 95, "rank": 1, "isolated": True}
    assert d["rating_session"] == SESSION and d["benchmark_row"]["rating"] == 60
    assert ("ratings", ("NVDA", "SPY", "AMD", "INTC", "ZZZ")) in store["calls"]   # ONE ratings read for every ticker
    assert rl.NOTE_HISTORICAL in out["notes"]


def test_stale_ratings_follow_rs_historys_own_rule(store):
    _seed_symbols(store)
    store["fail"].append("stale:6d")
    out = _read({"scope": "symbols", "symbols": ["NVDA"]})
    assert out["stale"] is True and out["data"]["ratings_stale"] is True
    assert rl.NOTE_STALE.format(session=SESSION) in out["notes"]


def test_a_stale_bar_marks_the_read_stale(store):
    _seed_symbols(store)
    store["bars"]["NVDA"] = _closes("2026-11-10", 30, 50.0, 0.5)
    out = _read({"scope": "symbols", "symbols": ["NVDA"]})
    assert out["stale"] is True and out["data"]["rows"][0]["bars_stale"] is True
    assert out["data"]["rows"][0]["vs_spy"] is None              # a different window: never compared


def test_unrated_unmapped_and_barless_symbols_are_named_partial(store):
    _seed_symbols(store)
    out = _read({"scope": "symbols", "symbols": ["NVDA", "QQQQ"]})
    assert out["status"] == "partial"
    assert rl.NOTE_NOT_RATED.format(syms="QQQQ") in out["notes"] and rl.NOTE_NO_BARS.format(syms="QQQQ") in out["notes"]
    assert rl.NOTE_NO_GROUP.format(syms="QQQQ") in out["notes"]
    q = out["data"]["rows"][1]
    assert q["rated"] is False and q["rating"] is None and q["return"] is None and "industry_context" not in q


def test_nothing_known_is_an_honest_partial_with_no_as_of(store):
    out = _read({"scope": "symbols", "symbols": ["QQQQ"]})
    assert env.validate_envelope(out) == []
    assert out["status"] == "partial" and out["as_of"] is None and out["coverage"]["answered"] == 0
    assert rl.NOTE_NO_RATINGS in out["notes"]


def test_sectors_scope_ranks_the_spdr_roster_by_return(store):
    etfs = rl._sector_etfs()
    store["bars"]["SPY"] = _closes(SESSION, 30, 100.0, 0.1)
    for k, t in enumerate(sorted(etfs.values())):
        store["bars"][t] = _closes(SESSION, 30, 100.0, 0.05 * k)
        store["ratings"][t] = _rt(10 + 5 * k, d20=k - 5)
    out = _read({"scope": "sectors", "period": "3M"})          # 63 sessions: more than the 30 held -> no returns
    assert out["status"] == "ok" and all(r["return"] is None for r in out["data"]["sectors"])
    out = _read({"scope": "sectors", "period": "1M"}, turn_id="t2")
    sect = out["data"]["sectors"]
    assert len(sect) == 11 and {r["symbol"] for r in sect} == set(etfs.values())
    pcts = [r["return"]["pct"] for r in sect]
    assert pcts == sorted(pcts, reverse=True)
    assert all(r["label"] == next(n for n, t in etfs.items() if t == r["symbol"]) for r in sect)
    assert all(r["is_etf"] for r in sect) and out["data"]["indices"] == []


def test_backdrop_scope_has_the_index_etfs_and_the_sectors(store):
    store["bars"]["SPY"] = _closes(SESSION, 30, 100.0, 0.1)
    out = _read({"scope": "backdrop", "period": "1W"})
    assert [r["symbol"] for r in out["data"]["indices"]] == list(rl._index_etfs())
    assert len(out["data"]["sectors"]) == 11


def test_industry_scope_cohort_distribution(store):
    _seed_symbols(store)
    out = _read({"scope": "industry", "industry": "semis"})
    assert out["status"] == "ok" and out["data"]["industry"] == "Semiconductors"
    c = out["data"]["cohort"]
    assert c["rated"] == 3 and c["median"] == 70.0 and c["paired_20"] == 3
    assert c["median_paired_now"] == 70.0 and c["median_paired_20_ago"] == 76.0 and c["median_change_20"] == -6.0
    assert c["rising_20"] == 2 and c["falling_20"] == 1 and c["at_or_above_80"] == 1
    assert c["top"][0] == {"symbol": "NVDA", "rating": 95, "isolated": True}


def test_ambiguous_industry_lists_candidates_and_reads_no_ratings(store):
    out = _read({"scope": "industry", "industry": "software"})
    assert env.validate_envelope(out) == [] and out["status"] == "partial" and out["as_of"] is None
    assert out["data"]["ambiguous"] is True and out["data"]["candidates"] == ["Software - Application", "Software - Infrastructure"]
    assert not any(c[0] == "ratings" for c in store["calls"])


def test_unknown_industry_is_not_covered(store):
    out = _read({"scope": "industry", "industry": "uranium miners"})
    assert out["data"]["candidates"] == [] and rl.NOTE_INDUSTRY_NOT_COVERED.format(word="uranium miners") in out["notes"]


@pytest.mark.parametrize("params", [
    {}, {"scope": "x"}, {"scope": "symbols"}, {"scope": "symbols", "symbols": []}, {"scope": "symbols", "symbols": "NVDA"},
    {"scope": "symbols", "symbols": ["A", "B", "C", "D", "E", "F", "G"]}, {"scope": "symbols", "symbols": ["<b>"]},
    {"scope": "sectors", "period": "2Y"}, {"scope": "sectors", "symbols": ["NVDA"]}, {"scope": "industry"},
    {"scope": "industry", "industry": "<script>"}, {"scope": "sectors", "industry": "semis"},
])
def test_bad_requests_are_refused_before_any_read(store, params):
    out = _read(params)
    assert out["status"] == "refused" and store["calls"] == []


# ── dark gate + model isolation ──────────────────────────────────────────────────────────────────
def test_dark_unless_the_kind_is_named(store, monkeypatch):
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes")
    assert _read({"scope": "sectors"})["status"] == "refused"
    monkeypatch.delenv(gw.DATA_ENV)
    assert _read({"scope": "sectors"}, turn_id="t2")["status"] == "refused"
    assert store["calls"] == []


def test_model_isolated_dormant_without_the_switch_and_answer_only(store, monkeypatch):
    assert gw.registry().get(rl.KIND).model_isolated is True
    for purpose in ("research", "scan"):
        assert _read({"scope": "sectors"}, purpose=purpose)["status"] == "refused"
    monkeypatch.delenv(gw.ISOLATED_ENV)
    assert _read({"scope": "sectors"}, turn_id="t3")["status"] == "refused"
    assert store["calls"] == []


def test_the_capability_is_local_only_on_the_server():
    assert "rs.compare" in turn.LOCAL_ONLY_ACTIONS and "rs.compare" not in turn.DATA_READ_ACTIONS


# ── ACCESS: the Agent's real doors ───────────────────────────────────────────────────────────────
RS_ASK = "which sectors are leading this month?"


def _app(user=None):
    from api.middleware.auth_middleware import get_current_user_with_plan
    from api.routers import uct_agent as rx
    app = FastAPI()
    app.include_router(rx.router)
    if user is not None:                       # identity only; the paid / admin gates stay the real dependencies
        app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


@pytest.mark.parametrize("user,code", [(None, 401), ({"id": "u-free", "plan": "free", "role": "user"}, 402)])
def test_anonymous_and_unpaid_get_no_rs_data_through_any_agent_door(store, user, code):
    _seed_symbols(store)
    c = _app(user)
    r = c.post("/api/agent/data", json={"kind": rl.KIND, "params": {"scope": "sectors"}, "turn_id": "t-anon"})
    assert r.status_code == code and "sectors" not in r.text
    for path in ("/api/agent/turn", "/api/agent/turn/stream", "/api/agent/turn/resume"):
        r = c.post(path, json={"message": RS_ASK, "context": {}, "capabilities": []})
        assert r.status_code == code, path
    assert store["calls"] == []                # no store was read


def test_a_paid_member_who_is_not_an_admin_is_refused_too_while_the_agent_is_dark(store):
    _seed_symbols(store)
    r = _app({"id": "u-paid", "plan": "pro", "role": "user"}).post(
        "/api/agent/data", json={"kind": rl.KIND, "params": {"scope": "symbols", "symbols": ["NVDA"]}, "turn_id": "t-m"})
    assert r.status_code == 403 and store["calls"] == []


def test_an_admin_reads_it_through_the_gateway(store):
    _seed_symbols(store)
    r = _app({"id": "u-admin", "plan": "pro", "role": "admin"}).post(
        "/api/agent/data", json={"kind": rl.KIND, "params": {"scope": "symbols", "symbols": ["NVDA"]}, "turn_id": "t-a"})
    assert r.status_code == 200 and r.json()["data"]["rows"][0]["rating"] == 95


# ── the side-effect-free group read ──────────────────────────────────────────────────────────────
def _no_init(monkeypatch, im):
    """Any init / connect / fallback / self-heal from a peek fails the test."""
    boom = lambda *a, **k: (_ for _ in ()).throw(AssertionError("a peek touched the writer path"))  # noqa: E731
    for name in ("_ensure_init", "_init_db", "_connect", "_enqueue_fallback", "_maybe_self_heal"):
        monkeypatch.setattr(im, name, boom)


def test_peeks_fail_closed_when_the_map_file_is_missing_and_create_nothing(tmp_path, monkeypatch):
    from api.services import industry_map as im
    db = tmp_path / "absent" / "im.db"
    monkeypatch.setattr(im, "_DB_PATH", str(db))
    _no_init(monkeypatch, im)
    assert im.peek_groups(["NVDA"]) == {} and im.peek_industries() == [] and im.peek_members("Semiconductors") == []
    assert not db.exists() and not db.parent.exists()


def test_peeks_fail_closed_when_the_table_is_missing_and_create_no_table(tmp_path, monkeypatch):
    import sqlite3
    from api.services import industry_map as im
    db = tmp_path / "im.db"
    sqlite3.connect(db).close()                                 # an empty database file: no industry_map table
    monkeypatch.setattr(im, "_DB_PATH", str(db))
    _no_init(monkeypatch, im)
    assert im.peek_groups(["NVDA"]) == {} and im.peek_industries() == [] and im.peek_members("Semiconductors") == []
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()[0] == 0     # still no table


def test_peeks_read_a_populated_map_read_only(tmp_path, monkeypatch):
    import sqlite3
    from api.services import industry_map as im
    db = tmp_path / "im.db"
    with sqlite3.connect(db) as c:
        c.executescript(im._SCHEMA)
        c.executemany("INSERT INTO industry_map VALUES (?,?,?,'t',1)",
                      [("NVDA", "Technology", "Semiconductors"), ("AMD", "Technology", "Semiconductors"), ("JPM", "Financial", "")])
    monkeypatch.setattr(im, "_DB_PATH", str(db))
    _no_init(monkeypatch, im)
    assert im.peek_groups(["nvda", "ZZZZ", ""]) == {"NVDA": {"sector": "Technology", "industry": "Semiconductors"}}
    assert im.peek_industries() == ["Semiconductors"] and im.peek_members("Semiconductors") == ["AMD", "NVDA"]
    assert im.peek_members("") == []


def test_a_missing_map_makes_the_kind_say_not_covered(tmp_path, monkeypatch):
    """The kind over the REAL peeks (its group seams unpatched): no map → the industry is not covered, no figure."""
    from api.services import industry_map as im
    db = tmp_path / "absent.db"
    monkeypatch.setattr(im, "_DB_PATH", str(db))
    _no_init(monkeypatch, im)
    reads = []
    monkeypatch.setattr(rl, "_ratings", lambda t, f: reads.append(t) or {})
    monkeypatch.setattr(rl, "_closes", lambda *a: [])
    monkeypatch.setattr(rl, "_expected_session", lambda: EXPECTED)
    out = _read({"scope": "industry", "industry": "semis"})
    assert env.validate_envelope(out) == [] and out["status"] == "partial" and out["as_of"] is None
    assert out["data"]["industry"] is None and out["data"]["candidates"] == []
    assert rl.NOTE_INDUSTRY_NOT_COVERED.format(word="semis") in out["notes"] and reads == []
    sym = _read({"scope": "symbols", "symbols": ["NVDA"]}, turn_id="t2")
    assert rl.NOTE_NO_GROUP.format(syms="NVDA") in sym["notes"] and "industry_context" not in sym["data"]["rows"][0]
    assert not db.exists()

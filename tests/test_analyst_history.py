"""Gap audit P1 + R3: UPDG's dated store of analyst actions, the dated / full route, and its two writers.

* the STORE (`api/services/analyst_history.py`): a wire push records its FULL list under the wire's date, a re-push
  replaces that date, the backfill never does; the nightly FMP pass adds its upgrade/downgrade rows under each firm's
  own date; a date not held is `held: False`, never a neighbour; rows past the retention window are pruned;
* the ROUTE (`GET /api/analyst-actions`): no argument = the old capped answer, unchanged; `full=1` / `date=` / `limit`
  = the uncapped dated read, each item naming its source; a bad date is 422; a store failure on a dated read is 503;
* the WRITERS: `/api/push` + `/api/push/archive` hand the payload over, and `analyst_pass.run_pass` hands over the
  rows its grade leg already read (no new vendor call).
"""
from __future__ import annotations

import sqlite3
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import engine_data, push  # imported BEFORE any patch (the conftest binding guard)
from api.middleware.auth_middleware import get_current_user_with_plan
from api.services import analyst_history as ah
from api.services import engine
from api.services.screener import analyst_pass as ap

TODAY = date(2026, 11, 27)


@pytest.fixture
def store(monkeypatch, tmp_path):
    db = tmp_path / "screener_analyst.db"
    monkeypatch.setenv("SCREENER_ANALYST_DB_PATH", str(db))
    monkeypatch.setattr(ah, "_today", lambda: TODAY)
    return db


def _wire(day, n_up=0, n_down=0, n_pt=0, extra=()):
    acts = []
    acts += [{"ticker": f"U{i:03d}", "action": "Upgrade", "firm": f"Firm {i}", "from_rating": "Hold",
              "to_rating": "Buy", "price_target": "50"} for i in range(n_up)]
    acts += [{"ticker": f"D{i:03d}", "action": "Downgrade", "firm": f"Firm {i}", "from_rating": "Buy",
              "to_rating": "Hold", "price_target": "20"} for i in range(n_down)]
    acts += [{"ticker": f"P{i:03d}", "action": "Raises PT", "firm": f"Firm {i}", "from_rating": "",
              "to_rating": "", "price_target": "75"} for i in range(n_pt)]
    return {"date": day, "analyst_actions": acts + list(extra)}


# ── the store ──────────────────────────────────────────────────────────────────────────────────

def test_a_wire_is_recorded_whole_and_uncapped_under_its_own_date(store):
    assert ah.record_wire(_wire("2026-11-20", 20, 14, 30)) == 64
    day = ah.read_day("2026-11-20")
    assert day["wire_held"] is True
    assert len(day["wire"]) == 64
    assert [a["ticker"] for a in day["wire"][:2]] == ["U000", "U001"]   # the wire's own order
    assert day["wire"][0] == {"ticker": "U000", "action": "upgrade", "firm": "Firm 0", "from_rating": "Hold",
                              "to_rating": "Buy", "price_target": "50", "source": "wire"}


def test_a_day_not_held_is_not_held_and_never_a_neighbour(store):
    ah.record_wire(_wire("2026-11-20", 3))
    day = ah.read_day("2026-11-21")
    assert day["wire_held"] is False and day["wire"] == [] and day["fmp"] == []


def test_a_wire_that_listed_none_is_held_and_empty(store):
    assert ah.record_wire({"date": "2026-11-20", "analyst_actions": []}) == 0
    day = ah.read_day("2026-11-20")
    assert day["wire_held"] is True and day["wire"] == []
    assert ah.held_dates() == [{"date": "2026-11-20", "wire": True, "fmp": 0}]


def test_a_repush_replaces_that_date_and_the_backfill_never_does(store):
    ah.record_wire(_wire("2026-11-20", 5))
    ah.record_wire(_wire("2026-11-20", 2))
    assert len(ah.read_day("2026-11-20")["wire"]) == 2
    assert ah.record_wire(_wire("2026-11-20", 9), overwrite=False) == 0
    assert len(ah.read_day("2026-11-20")["wire"]) == 2
    assert ah.record_wire(_wire("2026-11-19", 4), overwrite=False) == 4     # a new date is taken


@pytest.mark.parametrize("payload", [
    {"analyst_actions": [{"ticker": "A", "action": "Upgrade"}]},          # no date
    {"date": "2026-02-30", "analyst_actions": []},                        # not a real date
    {"date": "2026-11-20"},                                               # no list
    {"date": "2026-11-20", "analyst_actions": "nope"},
    "not a dict",
])
def test_an_unusable_payload_is_skipped_never_guessed(store, payload):
    assert ah.record_wire(payload) == 0
    assert ah.held_dates() == []


def test_rows_past_the_retention_window_are_pruned_and_not_listed(store):
    old = date.fromordinal(TODAY.toordinal() - ah.RETENTION_DAYS - 1).isoformat()
    with sqlite3.connect(store) as c:           # a row written when it was still inside the window
        c.executescript(ah._SCHEMA)
        c.execute(f"INSERT INTO {ah.TABLE} (action_date, source, seq, ticker, firm, action, recorded_at) "
                  "VALUES (?, 'wire', 0, '', '', '', 1)", (old,))
    assert ah.record_wire(_wire(old, 2)) == 0     # a write that old is refused outright
    ah.record_wire(_wire("2026-11-20", 1))        # any write prunes
    with sqlite3.connect(store) as c:
        assert c.execute(f"SELECT COUNT(*) FROM {ah.TABLE} WHERE action_date = ?", (old,)).fetchone()[0] == 0
    assert [d["date"] for d in ah.held_dates()] == ["2026-11-20"]


def test_fmp_grades_land_under_the_firms_own_date_upgrades_and_downgrades_only(store):
    grades = [
        {"symbol": "NVDA", "date": "2026-11-25", "gradingCompany": "Firm A", "previousGrade": "Hold",
         "newGrade": "Buy", "action": "upgrade"},
        {"symbol": "NVDA", "date": "2026-11-24", "gradingCompany": "Firm B", "previousGrade": "Buy",
         "newGrade": "Hold", "action": "downgrade"},
        {"symbol": "NVDA", "date": "2026-11-24", "gradingCompany": "Firm C", "action": "maintain"},
        {"symbol": "NVDA", "date": None, "gradingCompany": "Firm D", "action": "upgrade"},
        {"symbol": "NVDA", "date": "2026-10-01", "gradingCompany": "Firm E", "action": "upgrade"},   # before since
    ]
    assert ah.record_fmp_grades("nvda", grades, since="2026-10-28") == 2
    assert ah.record_fmp_grades("NVDA", grades, since="2026-10-28") == 0      # already held: kept as first seen
    d25 = ah.read_day("2026-11-25")
    assert d25["wire_held"] is False
    assert d25["fmp"] == [{"ticker": "NVDA", "action": "upgrade", "firm": "Firm A", "from_rating": "Hold",
                           "to_rating": "Buy", "price_target": None, "source": "fmp"}]
    assert [a["firm"] for a in ah.read_day("2026-11-24")["fmp"]] == ["Firm B"]
    assert {d["date"]: d["fmp"] for d in ah.held_dates()} == {"2026-11-25": 1, "2026-11-24": 1}


def test_a_writer_never_raises_into_its_caller(store, monkeypatch):
    def boom():
        raise sqlite3.OperationalError("disk gone")
    monkeypatch.setattr(ah, "_connect", boom)
    assert ah.record_wire(_wire("2026-11-20", 2)) == 0
    assert ah.record_fmp_grades("NVDA", [{"date": "2026-11-25", "action": "upgrade"}]) == 0


# ── shaping ────────────────────────────────────────────────────────────────────────────────────

def test_the_split_uses_the_same_words_as_the_default_answer(monkeypatch):
    """The default answer's buckets (engine) and the full answer's (here) are the same split, caps aside."""
    acts = [{"ticker": t, "action": a, "firm": "F"} for t, a in [
        ("A", "Upgrade"), ("B", "upgraded"), ("C", "Initiates"), ("D", "initiated"), ("E", "Downgrade"),
        ("F", "downgraded"), ("G", "Raises PT"), ("H", "lowers pt"), ("I", "Reiterates"), ("J", "")]]
    monkeypatch.setattr(engine, "cache", type("C", (), {"get": lambda s, k: None, "set": lambda s, *a, **k: None})())
    monkeypatch.setattr(engine, "_load_wire_data", lambda: {"date": "2026-11-20", "analyst_actions": acts})
    old = engine.get_analyst_actions()
    new = ah.split(acts)
    for k in ("upgrades", "downgrades", "pt_changes"):
        assert [a["ticker"] for a in new[k]] == [a["ticker"] for a in old[k]], k


def test_the_split_cuts_from_the_end_and_says_so():
    acts = [{"ticker": f"T{i}", "action": "upgrade"} for i in range(5)] + [{"ticker": "Z", "action": "downgrade"}]
    out = ah.split(acts, limit=3)
    assert [a["ticker"] for a in out["upgrades"]] == ["T0", "T1", "T2"]
    assert out["totals"] == {"upgrades": 5, "downgrades": 1, "pt_changes": 0}
    assert out["summary"] == {"upgrades": 3, "downgrades": 1, "pt_changes": 0}
    assert out["cut"] == {"limit": 3, "lists": ["upgrades"], "from": "end"}
    assert ah.split(acts)["cut"]["lists"] == []


def test_merge_keeps_the_wire_first_and_drops_an_fmp_row_the_wire_already_has():
    wire = [{"ticker": "NVDA", "action": "upgrade", "firm": "Morgan Stanley", "source": "wire"}]
    fmp = [{"ticker": "NVDA", "action": "upgrade", "firm": "Morgan-Stanley", "source": "fmp"},     # same call
           {"ticker": "NVDA", "action": "downgrade", "firm": "Morgan Stanley", "source": "fmp"},   # other side
           {"ticker": "AMD", "action": "upgrade", "firm": "Firm X", "source": "fmp"}]
    out = ah.merge(wire, fmp)
    assert [(a["ticker"], a["action"], a["source"]) for a in out] == [
        ("NVDA", "upgrade", "wire"), ("NVDA", "downgrade", "fmp"), ("AMD", "upgrade", "fmp")]


# ── the view ───────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def live(monkeypatch):
    state = {"wire": None}
    monkeypatch.setattr(engine, "_load_wire_data", lambda: state["wire"])
    monkeypatch.setattr(engine, "wire_freshness", lambda d: "unknown" if not d else "stale")
    return state


def test_the_latest_view_is_the_live_wire_uncapped_plus_fmp_for_its_day(store, live):
    live["wire"] = _wire("2026-11-26", 20, 1, 16)
    ah.record_fmp_grades("AMD", [{"date": "2026-11-26", "gradingCompany": "Firm X", "action": "upgrade"}])
    ah.record_wire(_wire("2026-11-20", 2))
    out = ah.actions_view()
    assert out["date"] == "2026-11-26" and out["latest"] is True and out["held"] is True
    assert out["totals"] == {"upgrades": 21, "downgrades": 1, "pt_changes": 16}
    assert out["upgrades"][-1]["source"] == "fmp" and out["upgrades"][0]["source"] == "wire"
    assert out["wire_date"] == "2026-11-26" and out["wire_status"] == "stale"
    assert out["sources"]["fmp"]["count"] == 1 and out["sources"]["fmp"]["may_grow"] is True
    assert out["dates"] == ["2026-11-26", "2026-11-20"]     # the live day is listed even before it is stored


def test_a_past_day_reads_the_store_never_the_live_wire(store, live):
    live["wire"] = _wire("2026-11-26", 9)
    ah.record_wire(_wire("2026-11-20", 2, 1))
    out = ah.actions_view("2026-11-20")
    assert out["date"] == "2026-11-20" and out["latest"] is False
    assert out["totals"] == {"upgrades": 2, "downgrades": 1, "pt_changes": 0}
    assert out["wire_status"] is None and out["wire_date"] == "2026-11-20"


def test_a_day_with_no_wire_still_has_the_fmp_actions(store, live):
    """R3: a day the wire never covered is not empty when the nightly pass saw actions dated it."""
    live["wire"] = _wire("2026-11-26", 3)
    ah.record_fmp_grades("AMD", [{"date": "2026-11-24", "gradingCompany": "Firm X", "action": "downgrade"}])
    out = ah.actions_view("2026-11-24")
    assert out["held"] is True and out["wire_date"] is None and out["sources"]["wire"]["held"] is False
    assert [(a["ticker"], a["source"]) for a in out["downgrades"]] == [("AMD", "fmp")]


def test_a_day_not_held_says_so(store, live):
    live["wire"] = _wire("2026-11-26", 3)
    out = ah.actions_view("2026-11-10")
    assert out["held"] is False and out["upgrades"] == [] and out["date"] == "2026-11-10"


def test_no_wire_at_all_is_an_empty_unknown_latest(store, live):
    out = ah.actions_view()
    assert out["date"] is None and out["held"] is False and out["wire_status"] == "unknown"


def test_a_store_failure_is_reported_on_the_latest_read_and_raised_on_a_dated_one(store, live, monkeypatch):
    live["wire"] = _wire("2026-11-26", 3)
    def boom():
        raise sqlite3.OperationalError("disk gone")
    monkeypatch.setattr(ah, "_connect", boom)
    out = ah.actions_view()
    assert out["store_ok"] is False and out["totals"]["upgrades"] == 3
    with pytest.raises(sqlite3.OperationalError):
        ah.actions_view("2026-11-20")


# ── the route ──────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def client(store, live):
    app = FastAPI()
    app.include_router(engine_data.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "pro"}
    return TestClient(app, raise_server_exceptions=False)


def test_the_bare_route_is_the_old_capped_answer_unchanged(client, live, monkeypatch):
    monkeypatch.setattr(engine, "cache", type("C", (), {"get": lambda s, k: None, "set": lambda s, *a, **k: None})())
    live["wire"] = _wire("2026-11-26", 20, 14, 30)
    body = client.get("/api/analyst-actions").json()
    assert body["summary"] == {"upgrades": 12, "downgrades": 12, "pt_changes": 15}
    assert set(body) == {"upgrades", "downgrades", "pt_changes", "summary", "wire_date", "wire_status"}


def test_full_and_date_read_the_uncapped_dated_answer(client, live):
    live["wire"] = _wire("2026-11-26", 20, 14, 30)
    ah.record_wire(_wire("2026-11-20", 1))
    full = client.get("/api/analyst-actions?full=1").json()
    assert full["summary"] == {"upgrades": 20, "downgrades": 14, "pt_changes": 30}
    assert full["dates"] == ["2026-11-26", "2026-11-20"]
    day = client.get("/api/analyst-actions?date=2026-11-20").json()
    assert day["date"] == "2026-11-20" and day["summary"]["upgrades"] == 1
    cut = client.get("/api/analyst-actions?full=1&limit=5").json()
    assert cut["summary"]["upgrades"] == 5 and cut["cut"]["lists"] == ["upgrades", "downgrades", "pt_changes"]


@pytest.mark.parametrize("q", ["date=2026-02-30", "date=11/20", "full=2", "limit=0", "limit=5000"])
def test_a_bad_argument_is_refused(client, q):
    assert client.get(f"/api/analyst-actions?{q}").status_code == 422


def test_a_store_failure_on_a_dated_read_is_503_never_an_empty_day(client, monkeypatch):
    def boom():
        raise sqlite3.OperationalError("disk gone")
    monkeypatch.setattr(ah, "_connect", boom)
    assert client.get("/api/analyst-actions?date=2026-11-20").status_code == 503


def test_the_route_is_paid(store, live):
    app = FastAPI()
    app.include_router(engine_data.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": "u2", "role": "member", "plan": "free"}
    c = TestClient(app, raise_server_exceptions=False)
    assert c.get("/api/analyst-actions?full=1").status_code == 402


# ── the writers ────────────────────────────────────────────────────────────────────────────────

def test_the_push_routes_record_the_full_list(store, monkeypatch, tmp_path):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.setenv("WIRE_ARCHIVE_DIR", str(tmp_path / "wire"))
    monkeypatch.setattr(push, "PERSISTENT_WIRE_DATA_FILE", str(tmp_path / "wire_data.json"))
    app = FastAPI()
    app.include_router(push.router)
    c = TestClient(app)
    hdr = {"Authorization": "Bearer s3cret"}
    payload = {**_wire("2026-11-20", 15), "rundown_html": "<p>x</p>"}
    assert c.post("/api/push", json=payload, headers=hdr).status_code == 200
    assert len(ah.read_day("2026-11-20")["wire"]) == 15
    # the backfill takes a new date and never replaces a pushed one
    assert c.post("/api/push/archive", json={**_wire("2026-11-20", 2), "rundown_html": "<p>y</p>"},
                  headers=hdr).status_code == 200
    assert len(ah.read_day("2026-11-20")["wire"]) == 15
    c.post("/api/push/archive", json={**_wire("2026-11-19", 2), "rundown_html": "<p>y</p>"}, headers=hdr)
    assert len(ah.read_day("2026-11-19")["wire"]) == 2


def test_the_nightly_pass_hands_over_the_rows_its_grade_leg_read(store, monkeypatch):
    """No new vendor call: the rows come from the same `/stable/grades` read the 30-day counts use."""
    import datetime as _dt

    class _Res:
        def __init__(self, v):
            self.value = v

    calls = []

    def grades(ticker, limit=None, timeout=None):
        calls.append(ticker)
        return _Res([{"symbol": ticker, "date": "2026-11-25", "gradingCompany": "Firm A", "action": "upgrade",
                      "previousGrade": "Hold", "newGrade": "Buy"},
                     {"symbol": ticker, "date": "2026-11-25", "gradingCompany": "Firm B", "action": "maintain"}])

    monkeypatch.setattr(ap._fmp, "get_analyst_grades", grades)
    monkeypatch.setattr(ap, "_fetch_consensus_label", lambda t: None)
    monkeypatch.setattr(ap, "_fetch_pt_target", lambda t: None)
    monkeypatch.setattr(ap, "_fetch_eps_growth", lambda t: None)
    monkeypatch.setattr(ap, "actives", lambda failures=None: {"NVDA"})
    monkeypatch.setattr(ap, "_cap_universe", lambda: {"NVDA"})
    monkeypatch.setenv("SCREENER_ANALYST_GAP_SECONDS", "0")
    now = _dt.datetime(2026, 11, 26, 2, 0, tzinfo=ap._ET)
    monkeypatch.setattr(ap, "_now_et", lambda: now)
    receipt = ap.run_pass(now=now)
    assert receipt["fetched"] == 1
    assert calls == ["NVDA"]
    assert [(a["ticker"], a["firm"]) for a in ah.read_day("2026-11-25")["fmp"]] == [("NVDA", "Firm A")]
    assert ap._grade_rows == {}


def test_a_direct_fetch_writes_nothing(store, monkeypatch):
    monkeypatch.setattr(ap._fmp, "get_analyst_grades", lambda *a, **k: type("R", (), {"value": [
        {"date": "2026-11-25", "gradingCompany": "F", "action": "upgrade"}]})())
    import datetime as _dt
    monkeypatch.setattr(ap, "_now_et", lambda: _dt.datetime(2026, 11, 26, 2, 0, tzinfo=ap._ET))
    assert ap._fetch_grade_actions_30d("AMD") == (1, 0)
    assert ah.held_dates() == []

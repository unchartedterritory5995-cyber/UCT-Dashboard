"""TERM-049 — the per-ticker history join: six citable lanes, counts-only room and flow,
entity ids across renames, dark route.

Every store is REAL and seeded in a tmp dir: the flow lane is read through the REAL
`/api/flow/ticker/{sym}/day-counts` route (and, for an older flow side, `/api/flow/ticker` and
`/api/flow/dates`) (flow_router, `require_flow_user`, the
PUSH_SECRET bearer) over a real FlowDB; the setup lane over a real SQLite file with the
engine's `setup_triggers` schema at the Brain Pack's install path; renames through the
real Entity Master store, written by `apply_event`.
"""
from __future__ import annotations

import contextlib
import csv
import io
import json
import os
import sqlite3
import tempfile
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# flow_router builds a FlowDB at IMPORT, at FLOW_DB_PATH (default /data/flow.db, which exists
# on the dev box and is live). Pin it before anything can import the router.
os.environ.setdefault("FLOW_DB_PATH", os.path.join(tempfile.mkdtemp(prefix="th-flow-"), "flow.db"))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import ticker_history as th

ET = ZoneInfo("America/New_York")
TODAY = datetime.now(ET).date()
D1 = (TODAY - timedelta(days=3)).isoformat()
D2 = (TODAY - timedelta(days=2)).isoformat()
OLD = (TODAY - timedelta(days=200)).isoformat()
PUSH = "test-push-secret"

# The engine's own table, as `sqlite_master.sql` reads in uct_intelligence.db (2026-10-01).
# The lane must read the store as it is, not a convenient subset of it.
SETUP_TRIGGERS_DDL = """CREATE TABLE setup_triggers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, trigger_date TEXT NOT NULL,
    setup_name TEXT NOT NULL, entry_level REAL NOT NULL, stop_level REAL NOT NULL,
    entry_kind TEXT NOT NULL DEFAULT '', stop_kind TEXT NOT NULL DEFAULT '',
    quality_total REAL, quality_proximity REAL, quality_risk REAL, quality_confluence REAL,
    quality_provenance REAL, source TEXT NOT NULL DEFAULT '', regime_at_publish TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open', resolved_at TEXT, r_multiple REAL, ret_3d REAL, ret_5d REAL,
    ret_10d REAL, ret_20d REAL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(symbol, trigger_date, setup_name, source))"""


def _mdy(iso):
    y, m, d = iso.split("-")
    return f"{int(m)}/{int(d)}/{y}"


def _flow_csv(rows):
    from api.flow_db import COLUMNS
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLUMNS)
    w.writeheader()
    for i, (sym, iso) in enumerate(rows):
        w.writerow({"CreatedDate": _mdy(iso), "CreatedTime": f"10:{i:02d}:00", "Symbol": sym,
                    "Type": "SWEEP", "Volume": str(100 + i), "Price": "1.50", "Side": "A",
                    "CallPut": "CALL", "Strike": "150", "Spot": "148", "Premium": "987654",
                    "ExpirationDate": "12/18/2026", "Color": "MAGENTA"})
    return buf.getvalue()


@pytest.fixture
def stores(tmp_path, monkeypatch):
    from api.services import buzz_store, uct20_nav, wire_archive
    from api.services.catalyst import store as cat_store

    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    with contextlib.suppress(Exception):
        buzz_store._reset_for_tests()
    buzz_store.init_db(str(tmp_path / "buzz.db"))
    ts = int(datetime.fromisoformat(D2 + "T11:00:00").replace(tzinfo=ET).timestamp())
    with contextlib.closing(sqlite3.connect(tmp_path / "buzz.db")) as c:
        c.executemany("INSERT INTO mentions VALUES (?,?,?,?,?,?)",
                      [("m1", "ch", "author-1", "NVDA", ts, "cashtag"),
                       ("m2", "ch", "author-2", "NVDA", ts + 60, "exact"),
                       ("m3", "ch", "author-3", "AMD", ts, "exact")])
        c.commit()

    monkeypatch.setattr(cat_store, "_DB_PATH", str(tmp_path / "catalysts.db"))
    cat_store._init_db()
    with contextlib.closing(sqlite3.connect(tmp_path / "catalysts.db")) as c:
        c.execute("INSERT INTO catalysts (market_date, ticker, rank, tag, thesis_text) VALUES (?,?,?,?,?)",
                  (D1, "NVDA", 3, "Earnings", "Beat and raised."))
        c.commit()

    monkeypatch.setenv("WIRE_ARCHIVE_DIR", str(tmp_path / "wire"))
    wire_archive.record({"date": D1, "rundown_html": "<p>Watching $NVDA and NVDA into the print.</p>"})
    wire_archive.record({"date": D2, "rundown_html": "<p>Semis weak; SNVDA is not NVDAX.</p>"})

    comp = tmp_path / "uct20.json"
    comp.write_text(json.dumps([{"date": D1, "holdings": ["AMD"]},
                                {"date": D2, "holdings": ["AMD", "NVDA"]}]), encoding="utf-8")
    monkeypatch.setattr(uct20_nav, "_COMPOSITIONS_FILE", str(comp))

    # ── flow: the REAL router over a real FlowDB, reached with the PUSH_SECRET bearer ──
    from api import flow_router
    from api.flow_db import FlowDB
    fdb = FlowDB(str(tmp_path / "flow.db"))
    fdb.insert_csv(_flow_csv([("NVDA", D1)] * 3 + [("NVDA", D2), ("NVDA", OLD), ("AMD", D1)]),
                   source="stocks")
    fdb.insert_csv(_flow_csv([("SPY", D2), ("SPY", D2)]), source="indexes")
    monkeypatch.setattr(flow_router, "db", fdb)
    monkeypatch.setenv("PUSH_SECRET", PUSH)
    fapp = FastAPI()
    fapp.include_router(flow_router.flow_router)
    fclient = TestClient(fapp)
    seen = []

    def _req(path, params):
        seen.append((path, dict(params)))
        return fclient.get(path, params=params, headers=th._flow_auth_headers())
    monkeypatch.setattr(th, "_flow_request", _req)

    # ── setups: the engine DB at the Brain Pack's install path ──
    monkeypatch.setenv("BRAIN_DIR", str(tmp_path / "brain"))
    os.makedirs(tmp_path / "brain" / "data")
    with contextlib.closing(sqlite3.connect(tmp_path / "brain" / "data" / "uct_intelligence.db")) as c:
        c.execute(SETUP_TRIGGERS_DDL)
        c.executemany(
            "INSERT INTO setup_triggers (symbol, trigger_date, setup_name, entry_level, stop_level, "
            "quality_total, source, status, resolved_at, r_multiple) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [("NVDA", D1, "VCP", 100.0, 95.0, 0.77, "leadership", "win", D2 + " 22:38:12", 0.419),
             ("NVDA", D2, "Flat Base", 101.0, 97.0, 0.66, "leadership", "open", None, None),
             ("AMD", D1, "VCP", 50.0, 48.0, 0.5, "leadership", "loss", D2 + " 22:38:12", -1.0),
             ("NVDA", OLD, "HTF", 10.0, 9.0, 0.9, "leadership", "loss", OLD + " 22:00:00", -1.0)])
        c.commit()

    monkeypatch.delenv("ENTITY_MASTER_MEMBER_ENABLED", raising=False)
    monkeypatch.setenv(th.LANES2_ENV, "1")
    # The flow lane's wait budget is a production latency knob; on a loaded test box the
    # in-process tape can take longer than it, and these rails are about the ANSWER.
    monkeypatch.setattr(th, "LANE_WAIT_S", 60.0)
    th._LANE_PARKED.clear()
    th._LANE_INFLIGHT.clear()
    FLOW_REQUESTS[:] = []
    seen[:] = []
    FLOW_REQUESTS.append(seen)        # one list per test, read by the projection rail
    return tmp_path


FLOW_REQUESTS: list = []

_SETTINGS = {"breakevenRange": {"enabled": True, "unit": "$", "value": 20}}


def _journal_member() -> str:
    import uuid
    return f"th-j-{uuid.uuid4().hex[:10]}"


def _trade(uid, sym, entry, exit_, *, entry_px=100.0, exit_px=110.0, stop=95.0):
    """A REAL closed trade through the journal's own manual-add service."""
    from api.services.journal_two import trades
    return trades.create_trade_manual(uid, {
        "symbol": sym, "side": "Long", "shares": 10, "entryPrice": entry_px, "entryDate": entry,
        "exitPrice": exit_px, "exitDate": exit_, "originalStop": stop, "setup": "VCP",
        "notes": f"private note of {uid}"}, _SETTINGS)


def _position(uid, sym, entry):
    from api.services.journal_two import positions
    return positions.create_position(uid, {"symbol": sym, "side": "Long", "shares": 5,
                                           "entryPrice": 50.0, "entryDate": entry, "stopPrice": 45.0},
                                     {})


def test_all_six_lanes_join_with_source_and_date(stores):
    me = _journal_member()
    _trade(me, "NVDA", D1, D2)
    out = th.history("nvda", days=30, user_id=me)
    assert out["ticker"] == "NVDA"
    assert {k: v["status"] for k, v in out["lanes"].items()} == {l: "ok" for l in th.LANES}
    lanes = {r["lane"] for r in out["timeline"]}
    assert lanes == {"wire", "book", "catalysts", "room", "flow", "setups", "journal"}
    assert "flow" not in out["not_rendered"] and "journal" not in out["not_rendered"]
    for r in out["timeline"]:
        assert r["source"] and r["as_of"] and r["ref"] and r["date"]


def test_wire_counts_whole_word_ticker_only(stores):
    wire = [r for r in th.history("NVDA", days=30)["timeline"] if r["lane"] == "wire"]
    assert [(r["date"], r["mentions"]) for r in wire] == [(D1, 2)]  # SNVDA / NVDAX never match


def test_book_lane_derives_entry_from_consecutive_compositions(stores):
    book = [r for r in th.history("NVDA", days=30)["timeline"] if r["lane"] == "book"]
    assert [(r["date"], r["event"]) for r in book] == [(D2, "entered")]


def test_room_lane_is_counts_only_never_text_or_authors(stores):
    room = [r for r in th.history("NVDA", days=30)["timeline"] if r["lane"] == "room"]
    assert [(r["date"], r["mentions"]) for r in room] == [(D2, 2)]
    blob = json.dumps(room)
    assert "author" not in blob and "m1" not in blob and "message" not in blob


def test_a_failed_lane_is_unavailable_not_empty(stores, monkeypatch):
    def boom(sym, since):
        raise sqlite3.OperationalError("store unreadable")
    monkeypatch.setitem(th._LANE_FNS, "catalysts", boom)
    out = th.history("NVDA", days=30)
    assert out["lanes"]["catalysts"] == {"status": "unavailable", "count": None}
    assert out["lanes"]["wire"]["status"] == "ok"


def _client(user):
    from api.routers import ticker_history as router_mod
    from api.middleware.auth_middleware import get_current_user_with_plan

    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


PAID = {"id": "u1", "role": "member", "plan": "pro", "subscription_status": "active"}
FREE = {"id": "u2", "role": "member", "plan": "free", "subscription_status": None}


def test_route_is_404_while_dark(monkeypatch, stores):
    monkeypatch.delenv(th.ENABLED_ENV, raising=False)
    assert _client(PAID).get("/api/research/history/NVDA").status_code == 404


def test_route_serves_paid_and_refuses_free_when_armed(monkeypatch, stores):
    monkeypatch.setenv(th.ENABLED_ENV, "1")
    from api.middleware import auth_middleware
    monkeypatch.setattr("api.routers.ticker_history.is_paid_user", lambda u: u.get("plan") == "pro")
    r = _client(PAID).get("/api/research/history/NVDA?days=30")
    assert r.status_code == 200 and r.json()["ticker"] == "NVDA"
    assert _client(FREE).get("/api/research/history/NVDA").status_code == 402


def test_the_auth_payload_carries_the_flag(monkeypatch):
    from api.routers import auth
    monkeypatch.delenv(th.ENABLED_ENV, raising=False)
    assert auth._ticker_history_enabled() is False
    monkeypatch.setenv(th.ENABLED_ENV, "1")
    assert auth._ticker_history_enabled() is True


def test_history_never_closes_the_shared_buzz_connection(stores):
    """buzz_store.connect() is the pod's ONE shared connection: the ingest poller, /buzz
    and the scheduled boards all read and write through it. 2026-09-29 the room lane
    closed it, so after the first History request every buzz call on the pod raised."""
    from api.services import buzz_store

    th.history("NVDA", days=30)
    th.history("NVDA", days=90)                      # the second call is what failed live
    assert th.history("NVDA", days=30)["lanes"]["room"]["status"] == "ok"
    buzz_store.connect().execute("SELECT 1").fetchone()   # raises on a closed connection


def test_each_lane_names_where_its_store_begins(stores):
    """A lane whose store starts after the window opens is PARTIAL, and says from when.
    The wire archive began 2026-09-28, so a bare '0 mentions in 90 days' read as
    'never named' for every ticker."""
    lanes = th.history("NVDA", days=30)["lanes"]
    assert lanes["wire"]["covers_from"] == D1          # first archived wire in the fixture
    assert lanes["book"]["covers_from"] == D1
    assert lanes["catalysts"]["covers_from"] == D1
    assert lanes["room"]["covers_from"] == D2
    # every slice-1 fixture store starts days ago (flow/setups reach back 200 days on purpose)
    assert all(lanes[k]["partial"] for k in ("wire", "book", "catalysts", "room"))
    wide = th.history("NVDA", days=2)["lanes"]         # a window opening after the stores do
    assert wide["wire"]["partial"] is False


def test_an_empty_store_is_partial_not_complete(stores, monkeypatch):
    monkeypatch.setitem(th._COVERAGE_FNS, "wire", lambda: (None, None))
    assert th.history("NVDA", days=30)["lanes"]["wire"]["partial"] is True


# ── slice 2: the flow lane ───────────────────────────────────────────────────────────

def _lane(out, name):
    return [r for r in out["timeline"] if r["lane"] == name]


def test_flow_lane_counts_prints_per_session_inside_the_window(stores):
    flow = _lane(th.history("NVDA", days=30), "flow")
    assert [(r["date"], r["prints"]) for r in flow] == [(D2, 1), (D1, 3)]   # OLD is outside
    for r in flow:
        assert r["source"] == "flow_tape" and r["as_of"] == r["date"] and r["ref"] == "/options-flow"


def test_flow_lane_falls_back_to_the_index_partition(stores):
    flow = _lane(th.history("SPY", days=30), "flow")
    assert [(r["date"], r["prints"]) for r in flow] == [(D2, 2)]


class _Gone:
    """What a flow side that predates a route answers: FastAPI's 404."""
    status_code = 404
    text = '{"detail":"Not Found"}'

    def json(self):
        return {"detail": "Not Found"}


NEW_FLOW_ROUTES = ("/day-counts", "/api/flow/tape-span")


def _legacy_flow_side(monkeypatch):
    """Point HIS at a flow-worker that predates the count + span routes (web deploys first)."""
    real = th._flow_request

    def old_side(path, params):
        if path.endswith(NEW_FLOW_ROUTES):
            FLOW_REQUESTS[0].append((path, dict(params)))
            return _Gone()
        return real(path, params)
    monkeypatch.setattr(th, "_flow_request", old_side)


def test_flow_lane_reads_ONE_count_route_not_the_tape(stores):
    """The lane asks flow-worker for counts (a GROUP BY there), never the ticker's tape."""
    out = th.history("NVDA", days=30)
    assert [(r["date"], r["prints"]) for r in _lane(out, "flow")] == [(D2, 1), (D1, 3)]
    reads = [(p, q) for p, q in FLOW_REQUESTS[0] if p.startswith("/api/flow/")]
    assert reads == [("/api/flow/ticker/NVDA/day-counts", {"source": "all"})], reads


def test_flow_lane_is_counts_only_and_asks_for_one_column(stores, monkeypatch):
    """The tape holds premium, side, strike and expiry; the lane must never carry them. The
    count route answers counts alone; against an older flow side the fallback asks the tape for
    `CreatedDate` alone, and refuses a tape that answers with more."""
    for legacy in (False, True):
        if legacy:
            _legacy_flow_side(monkeypatch)
            th._FLOW_MEMO.clear()
            th._LANE_PARKED.clear()
        FLOW_REQUESTS[0][:] = []
        out = th.history("NVDA", days=30)
        assert [(r["date"], r["prints"]) for r in _lane(out, "flow")] == [(D2, 1), (D1, 3)], legacy
        blob = json.dumps(_lane(out, "flow"))
        for paid in ("987654", "Premium", "CALL", "Strike", "150", "12/18/2026", "SWEEP"):
            assert paid not in blob
        tape_reads = [q for p, q in FLOW_REQUESTS[0]
                      if p.startswith("/api/flow/ticker/") and not p.endswith("/day-counts")]
        if legacy:
            assert tape_reads and all(q["cols"] == "CreatedDate" for q in tape_reads)
        else:
            assert tape_reads == []                       # never the tape when counts exist
    th._FLOW_MEMO.clear()


def test_a_tape_that_ignores_the_projection_is_unavailable(stores, monkeypatch):
    _legacy_flow_side(monkeypatch)
    real = th._flow_request

    def wide(path, params):
        return real(path, {k: v for k, v in params.items() if k != "cols"})   # every column
    monkeypatch.setattr(th, "_flow_request", wide)
    out = th.history("NVDA", days=30)
    assert out["lanes"]["flow"] == {"status": "unavailable", "count": None}
    assert "987654" not in json.dumps(out)


@pytest.mark.parametrize("days", [
    {"2026-01-05": {"Premium": 987654}},      # a nested row, not a count
    {"2026-01-05": "3"},                       # a string, not a count
    {"2026-01-05": -1},
    {"1/5/2026": 3},                           # the tape's spelling, not the route's
    [["2026-01-05", 3]],                       # not a map at all
])
def test_a_count_route_answering_more_than_counts_is_unavailable(monkeypatch, days):
    class _R:
        status_code = 200

        def json(self):
            return {"days": days, "tape": {"first": "2026-01-02", "last": "2026-01-05"}}
    th._FLOW_MEMO.clear()
    monkeypatch.setattr(th, "_flow_request", lambda p, q: _R())
    with pytest.raises(th.LaneUnreadable):
        th._flow_counts("ZZBAD", th.FLOW_ALL)
    th._FLOW_MEMO.clear()


def test_a_count_route_error_is_unavailable_not_a_fallback(monkeypatch):
    """Only a 404 (the route does not exist yet) falls back. A 500/503 is the lane failing --
    re-reading the whole tape behind a failing worker would only make it fail slower."""
    calls = []

    class _R:
        status_code = 503
    th._FLOW_MEMO.clear()
    monkeypatch.setattr(th, "_flow_request", lambda p, q: calls.append(p) or _R())
    with pytest.raises(th.LaneUnreadable):
        th._flow_counts("ZZ503", th.FLOW_ALL)
    assert calls == ["/api/flow/ticker/ZZ503/day-counts"]
    th._FLOW_MEMO.clear()


def test_an_older_flow_side_is_read_the_old_way(stores, monkeypatch):
    """web deploys before flow-worker: a 404 from the count route reads the tape, stocks then
    indexes, and the span from `/dates` -- the same answers, just slower."""
    _legacy_flow_side(monkeypatch)
    for sym, want in (("NVDA", [(D2, 1), (D1, 3)]), ("SPY", [(D2, 2)])):
        out = th.history(sym, days=30)
        assert [(r["date"], r["prints"]) for r in _lane(out, "flow")] == want, sym
        assert (out["lanes"]["flow"]["covers_from"], out["lanes"]["flow"]["covers_to"]) == (OLD, D2)
    paths = [p for p, _ in FLOW_REQUESTS[0]]
    assert "/api/flow/ticker/SPY" in paths and paths.count("/api/flow/dates") == 2


def test_flow_lane_without_the_internal_credential_is_unavailable(stores, monkeypatch):
    """`/api/flow/ticker` is `require_flow_user`: no bearer, a 401 -- which is NOT a quiet tape."""
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    out = th.history("NVDA", days=30)
    assert out["lanes"]["flow"] == {"status": "unavailable", "count": None}
    assert out["lanes"]["wire"]["status"] == "ok"


def test_flow_lane_names_the_sessions_the_tape_holds(stores):
    lane = th.history("NVDA", days=30)["lanes"]["flow"]
    assert (lane["covers_from"], lane["covers_to"]) == (OLD, D2)
    assert lane["partial"] is False                   # the tape reaches back past the window
    assert th.history("NVDA", days=365)["lanes"]["flow"]["partial"] is True


def test_slice2_lanes_are_dark_and_unread_until_their_own_gate_is_set(stores, monkeypatch):
    """TICKER_HISTORY_ENABLED is armed in production; the new lanes must not ride it in.
    Unset: no tape request, the engine DB never opened, both lanes named as dark."""
    monkeypatch.delenv(th.LANES2_ENV, raising=False)
    opened = []
    monkeypatch.setattr(th, "_engine_ro", lambda: opened.append(1) or (_ for _ in ()).throw(AssertionError))
    journal_reads = []
    monkeypatch.setattr(th, "_member_journal", lambda uid, sym=None: journal_reads.append(uid) or ([], []))
    out = th.history("NVDA", days=30, user_id="u-dark")
    assert set(out["lanes"]) == {"wire", "book", "catalysts", "room"}
    assert {r["lane"] for r in out["timeline"]} <= {"wire", "book", "catalysts", "room"}
    assert "TICKER_HISTORY_LANES2_ENABLED" in out["not_rendered"]["flow"]
    assert "TICKER_HISTORY_LANES2_ENABLED" in out["not_rendered"]["setups"]
    assert "TICKER_HISTORY_LANES2_ENABLED" in out["not_rendered"]["journal"]
    assert FLOW_REQUESTS[0] == [] and opened == [] and journal_reads == []


# ── slice 2: the setup ledger ────────────────────────────────────────────────────────

def test_setup_lane_rows_publication_and_recorded_outcome(stores):
    rows = _lane(th.history("NVDA", days=30), "setups")
    got = sorted((r["date"], r["event"], r["setup"]) for r in rows)
    assert got == sorted([(D1, "published", "VCP"), (D2, "outcome", "VCP"),
                          (D2, "published", "Flat Base")])        # the open setup has no outcome
    outcome = next(r for r in rows if r["event"] == "outcome")
    assert outcome["text"] == f"VCP setup from {D1}: won (+0.42R)"
    assert outcome["as_of"] == D2 and outcome["source"] == "setup_triggers"
    assert "quality" not in json.dumps(rows) and "0.77" not in json.dumps(rows)


def test_setup_lane_names_the_ledger_span(stores):
    lane = th.history("NVDA", days=30)["lanes"]["setups"]
    assert (lane["covers_from"], lane["covers_to"]) == (OLD, D2)


def test_setup_lane_without_the_brain_pack_is_unavailable(stores, monkeypatch, tmp_path):
    monkeypatch.setenv("BRAIN_DIR", str(tmp_path / "not-installed"))
    out = th.history("NVDA", days=30)
    assert out["lanes"]["setups"] == {"status": "unavailable", "count": None}
    assert out["lanes"]["catalysts"]["status"] == "ok"


# ── slice 2: entity ids across renames ───────────────────────────────────────────────

@pytest.fixture
def renamed(stores, monkeypatch):
    """FB became META on D2 (Massive `ticker_change`, applied as the D5 producer applies it).
    A catalyst row was recorded under FB on D1 and under META on D2 -- and one under FB on D2,
    AFTER the rename, which belongs to whoever holds FB then, never to META."""
    from api.services.entity_master import api as em_api
    from api.services.entity_master import schema as em_schema
    from api.services.entity_master import store as em_store
    from api.services.catalyst import store as cat_store

    monkeypatch.setattr(em_schema, "DB_PATH", str(stores / "em" / "entity_master.db"))
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False
    r = em_api.apply_event("new_entity", {"entity_type": "equity", "initial_alias": "FB",
                                          "initial_alias_valid_from": "2012-05-18"},
                           dedup_key="fx:fb", source="admin_manual")
    assert r.accepted, r.reason
    r2 = em_api.apply_event("renamed", {"entity_id": r.entity_id, "old_alias": "FB",
                                        "old_alias_valid_to": D2, "new_alias": "META",
                                        "new_alias_valid_from": D2},
                            dedup_key="fx:fb-meta", source="d5-renames")
    assert r2.accepted, r2.reason
    with contextlib.closing(sqlite3.connect(cat_store._DB_PATH)) as c:
        c.executemany("INSERT INTO catalysts (market_date, ticker, rank, tag, thesis_text) VALUES (?,?,?,?,?)",
                      [(D1, "FB", 1, "News", "FB era."), (D2, "META", 2, "News", "META era."),
                       (D2, "FB", 3, "News", "Someone else's FB.")])
        c.commit()
    yield r.entity_id
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False


def test_renames_join_inside_each_alias_window_when_armed(renamed, monkeypatch):
    monkeypatch.setenv("ENTITY_MASTER_MEMBER_ENABLED", "1")
    out = th.history("META", days=30)
    assert out["key"] == "entity" and out["entity"]["entity_id"] == renamed
    cats = _lane(out, "catalysts")
    assert sorted((r["date"], r["symbol"], r["text"]) for r in cats) == [
        (D1, "FB", "FB era."), (D2, "META", "META era.")]        # never "Someone else's FB."


def test_dark_entity_master_keys_by_the_bare_ticker_and_says_why(renamed, monkeypatch):
    monkeypatch.delenv("ENTITY_MASTER_MEMBER_ENABLED", raising=False)
    out = th.history("META", days=30)
    assert out["key"] == "ticker" and out["entity"]["status"] == "not_armed"
    assert [(r["date"], r["symbol"]) for r in _lane(out, "catalysts")] == [(D2, "META")]


# ── tail: the member's OWN journal lane (owner-scoped, behind LANES2) ──────────────────

def test_journal_lane_is_the_callers_own_trades_and_never_another_members(stores):
    me, other = _journal_member(), _journal_member()
    _trade(me, "NVDA", D1, D2)                        # mine: opened D1, closed D2 (a win)
    _position(me, "NVDA", D2)                         # mine, still open
    _trade(me, "AMD", D1, D2)                         # mine, another ticker
    _trade(other, "NVDA", D1, D2, exit_px=90.0)       # SOMEONE ELSE's NVDA trade (a loss)
    rows = _lane(th.history("NVDA", days=30, user_id=me), "journal")
    got = sorted((r["date"], r["event"], r["source"]) for r in rows)
    assert got == sorted([(D1, "opened", "j2_trades"), (D2, "closed", "j2_trades"),
                          (D2, "opened", "j2_positions")])
    closed = next(r for r in rows if r["event"] == "closed")
    assert closed["result"] == "Win" and closed["text"].startswith(f"You closed your long from {D1}: win (+2.00R)")
    blob = json.dumps(rows)
    assert other not in blob and "loss" not in blob and "private note" not in blob
    # ...and the other member sees exactly their own, none of mine
    theirs = _lane(th.history("NVDA", days=30, user_id=other), "journal")
    assert sorted(r["event"] for r in theirs) == ["closed", "opened"]
    assert all(r["source"] == "j2_trades" for r in theirs) and me not in json.dumps(theirs)


def test_journal_lane_without_a_member_is_unavailable_not_anyones(stores):
    _trade(_journal_member(), "NVDA", D1, D2)
    out = th.history("NVDA", days=30)                 # no caller id
    assert out["lanes"]["journal"] == {"status": "unavailable", "count": None}
    assert not _lane(out, "journal")
    assert out["lanes"]["wire"]["status"] == "ok"


def test_journal_lane_covers_from_the_members_first_entry(stores):
    me = _journal_member()
    _trade(me, "AMD", OLD, D1)                        # first journalled entry, another ticker
    _trade(me, "NVDA", D1, D2)
    lane = th.history("NVDA", days=30, user_id=me)["lanes"]["journal"]
    assert lane["status"] == "ok" and lane["covers_from"] == OLD and lane["partial"] is False
    empty = th.history("NVDA", days=30, user_id=_journal_member())["lanes"]["journal"]
    assert empty == {"status": "ok", "count": 0, "covers_from": None, "covers_to": None, "partial": True}


def test_the_route_keys_the_journal_lane_on_the_caller(monkeypatch, stores):
    monkeypatch.setenv(th.ENABLED_ENV, "1")
    monkeypatch.setattr("api.routers.ticker_history.is_paid_user", lambda u: True)
    a, b = _journal_member(), _journal_member()
    _trade(a, "NVDA", D1, D2)
    _trade(b, "NVDA", D2, D2)
    body = _client({**PAID, "id": a}).get("/api/research/history/NVDA?days=30").json()
    assert sorted(r["date"] for r in body["timeline"] if r["lane"] == "journal") == [D1, D2]
    body_b = _client({**PAID, "id": b}).get("/api/research/history/NVDA?days=30").json()
    assert sorted(r["date"] for r in body_b["timeline"] if r["lane"] == "journal") == [D2, D2]


# ── R20: bare-word false matches on short / dictionary tickers ─────────────────

class TestWireMentionsNeedANameForWordTickers:
    def test_short_tickers_are_not_matched_as_bare_words(self):
        html = "<p>AI capex is on fire; it is now a theme. A big day.</p>"
        for sym in ("AI", "IT", "ON", "A"):
            assert th._wire_mentions(sym, html) == 0, sym

    def test_a_cashtag_still_counts_for_a_short_ticker(self):
        assert th._wire_mentions("AI", "<p>Watching $AI into the print; AI broadly hot.</p>") == 1

    def test_the_wires_own_ticker_markup_counts(self):
        html = ('<div class="rd-pick"><span class="rd-pick-sym">ON</span></div>'
                '<p>Turn it on.</p><td class="rd-watch-sym x">$IT</td>')
        assert th._wire_mentions("ON", html) == 1
        assert th._wire_mentions("IT", html) == 1

    def test_a_dictionary_word_ticker_needs_a_name(self, monkeypatch):
        from api.services import buzz_universe
        monkeypatch.setattr(buzz_universe, "ambiguous", lambda: frozenset({"NOW"}))
        assert th._wire_mentions("NOW", "<p>Buy NOW before the open.</p>") == 0
        assert th._wire_mentions("NOW", "<p>$NOW beat.</p>") == 1

    def test_an_unambiguous_ticker_keeps_the_whole_word_match(self, monkeypatch):
        from api.services import buzz_universe
        monkeypatch.setattr(buzz_universe, "ambiguous", lambda: frozenset())
        assert th._wire_mentions("NVDA", "<p>Watching $NVDA and NVDA; SNVDA is not NVDAX.</p>") == 2


# ── live sweep 2026-10-05: HIS took 15.7 s for NVDA ───────────────────────────────

def test_the_lanes_run_side_by_side(monkeypatch):
    import time as _t
    spans = {}

    def slow(name):
        def _f(*a):
            t0 = _t.monotonic()
            _t.sleep(0.3)
            spans[name] = (t0, _t.monotonic())
            return []
        return _f

    monkeypatch.setattr(th, "_LANE_FNS", {n: slow(n) for n in th.LANES})
    monkeypatch.setattr(th, "_COVERAGE_FNS", {n: (lambda *a: (None, None)) for n in th.LANES})
    monkeypatch.setattr(th, "_entity_eras", lambda s: ({"status": "unresolved"}, [(s, None, None)]))
    t0 = _t.monotonic()
    out = th.history("ZZHS", days=30)
    took = _t.monotonic() - t0
    assert set(out["lanes"]) == set(spans)
    assert max(s for s, _ in spans.values()) < min(e for _, e in spans.values()), "lanes did not overlap"
    assert took < 0.3 * len(spans) * 0.6
    assert list(out["lanes"]) == [n for n in th.LANES if n in out["lanes"]]   # order kept


def test_a_failed_flow_read_is_not_waited_out_twice(monkeypatch):
    calls = []

    def _req(path, params):
        calls.append(params["source"])
        raise TimeoutError("tape slow")

    th._FLOW_MEMO.clear()
    monkeypatch.setattr(th, "_flow_request", _req)
    for _ in range(3):
        with pytest.raises(TimeoutError):
            th._flow_counts("ZZFL", th.FLOW_ALL)
    assert calls == [th.FLOW_ALL]
    th._FLOW_MEMO.clear()


# ── first open of HIS was 5-6 s: the flow lane must not hold the other lanes hostage ──

def _fast_lanes_slow_tape(monkeypatch, gate, tape_calls):
    """Every local lane answers at once; the tape blocks until `gate` is set."""
    import threading as _th
    monkeypatch.setattr(th, "_entity_eras", lambda s: ({"status": "unresolved"}, [(s, None, None)]))
    fns = {n: (lambda *a: []) for n in th.LANES}
    fns["flow"] = th.flow_lane
    monkeypatch.setattr(th, "_LANE_FNS", fns)
    cov = {n: (lambda *a: (None, None)) for n in th.LANES}
    cov["flow"] = lambda *a: ("2026-01-02", "2026-01-05")
    monkeypatch.setattr(th, "_COVERAGE_FNS", cov)
    monkeypatch.setenv(th.LANES2_ENV, "1")

    class _R:
        status_code = 200

        def json(self):
            return {"days": {"2026-01-05": 2}, "tape": {"first": "2026-01-02", "last": "2026-01-05"}}

    lock = _th.Lock()

    def _req(path, params):
        with lock:
            tape_calls.append((path, params.get("source")))
        assert gate.wait(10), "test gate never opened"
        return _R()
    th._FLOW_MEMO.clear()
    monkeypatch.setattr(th, "_flow_request", _req)


def test_a_slow_tape_answers_pending_and_the_next_ask_has_the_counts(monkeypatch):
    import threading as _th
    import time as _t
    gate, calls = _th.Event(), []
    _fast_lanes_slow_tape(monkeypatch, gate, calls)
    monkeypatch.setattr(th, "LANE_WAIT_S", 0.2)
    t0 = _t.monotonic()
    out = th.history("ZZPD", days=3650)
    took = _t.monotonic() - t0
    assert took < 2.0, f"the response waited on the tape ({took:.2f}s)"
    assert out["lanes"]["flow"]["status"] == "pending"
    assert out["lanes"]["flow"]["count"] is None          # never a count of zero
    assert not [r for r in out["timeline"] if r["lane"] == "flow"]
    assert out["lanes"]["wire"]["status"] == "ok"           # the other lanes answered
    gate.set()                                              # the tape answers ...
    deadline = _t.monotonic() + 5
    while ("ZZPD", th.FLOW_ALL) not in th._FLOW_MEMO and _t.monotonic() < deadline:
        _t.sleep(0.02)
    again = th.history("ZZPD", days=3650)                   # ... and the re-ask has it
    assert again["lanes"]["flow"]["status"] == "ok"
    assert [(r["date"], r["prints"]) for r in again["timeline"] if r["lane"] == "flow"] == [("2026-01-05", 2)]
    assert [c for c in calls if c[0].startswith("/api/flow/ticker/")] == [("/api/flow/ticker/ZZPD/day-counts", "all")]
    th._FLOW_MEMO.clear()


def test_asks_during_a_running_read_join_it_instead_of_reading_again(monkeypatch):
    import threading as _th
    gate, calls = _th.Event(), []
    _fast_lanes_slow_tape(monkeypatch, gate, calls)
    monkeypatch.setattr(th, "LANE_WAIT_S", 0.05)
    for _ in range(3):                                      # the panel re-asking while it reads
        assert th.history("ZZJN", days=3650)["lanes"]["flow"]["status"] == "pending"
    gate.set()
    monkeypatch.setattr(th, "LANE_WAIT_S", 10.0)
    assert th.history("ZZJN", days=3650)["lanes"]["flow"]["status"] == "ok"
    tape = [c for c in calls if c[0].startswith("/api/flow/ticker/")]
    assert tape == [("/api/flow/ticker/ZZJN/day-counts", "all")], tape
    th._FLOW_MEMO.clear()


def test_a_fast_tape_is_answered_in_the_same_response(stores):
    """The budget only bites when the tape is slow: a quick tape is never `pending`."""
    lane = th.history("NVDA", days=30)["lanes"]["flow"]
    assert lane["status"] == "ok" and lane["count"] == 2


def test_the_tape_span_rides_the_count_read(stores):
    """The count route carries the tape's span, so an open costs ONE flow-side read: no
    `/dates` scans (~3 s each on the worker), no separate span read."""
    for sym in ("NVDA", "AMD", "SPY"):
        lane = th.history(sym, days=30)["lanes"]["flow"]
        assert (lane["covers_from"], lane["covers_to"]) == (OLD, D2), sym
    paths = [p for p, q in FLOW_REQUESTS[0]]
    assert paths == [f"/api/flow/ticker/{s}/day-counts" for s in ("NVDA", "AMD", "SPY")], paths


def test_a_stale_span_is_refreshed_from_the_span_route_not_dates(stores):
    """Counts are memoised longer than the span; when only the span is stale it is re-read
    from `/api/flow/tape-span` (a ~ms read), never from the two `/dates` scans."""
    th.history("NVDA", days=30)
    th._FLOW_COVERAGE_MEMO.clear()
    th._LANE_PARKED.clear()
    th._LANE_INFLIGHT.clear()
    lane = th.history("NVDA", days=30)["lanes"]["flow"]
    assert (lane["covers_from"], lane["covers_to"]) == (OLD, D2)
    paths = [p for p, q in FLOW_REQUESTS[0]]
    assert paths == ["/api/flow/ticker/NVDA/day-counts", "/api/flow/tape-span"], paths


def test_the_tape_span_is_read_once_for_every_ticker_on_an_older_flow_side(stores, monkeypatch):
    """`/api/flow/dates` is the same answer for every ticker; HIS asks for it once, not per open."""
    _legacy_flow_side(monkeypatch)
    th.history("NVDA", days=30)
    th.history("AMD", days=30)
    th.history("SPY", days=30)
    dates = [p for p, q in FLOW_REQUESTS[0] if p == "/api/flow/dates"]
    assert dates == ["/api/flow/dates", "/api/flow/dates"]   # stocks + indexes, once


# ── dual-class names: each lane asks its store in the spelling that store's WRITER holds ──
# BRK.B has three spellings here: BRK-B (canonical, cap_universe, journal since 09-06, buzz
# cashtags since 09-05), BRK.B (the vendor form and older rows) and BRKB (the OCC option root,
# the only form the flow tape's writers can produce). Typed either way, HIS finds them all, and
# a day is never shown twice.

DUAL = ("BRK.B", "brk-b", "BRK-B")


def test_wire_counts_both_class_spellings_once_each(stores):
    from api.services import wire_archive
    d0 = (TODAY - timedelta(days=5)).isoformat()
    wire_archive.record({"date": d0, "rundown_html":
                         "<p>Watching BRK.B into the print and $BRK-B on the list; BRKB and BRK are not it.</p>"})
    for s in DUAL:
        wire = _lane(th.history(s, days=30), "wire")
        assert [(r["date"], r["mentions"]) for r in wire] == [(d0, 2)], s


def test_book_holdings_in_either_spelling_are_one_holding(stores, monkeypatch):
    """Holdings are `leadership[].sym` from the wire push; a switch of spelling between two
    pushes is the same name staying in the book, never a 'left' and an 'entered'."""
    from api.services import uct20_nav
    comp = stores / "uct20-dual.json"
    comp.write_text(json.dumps([{"date": D1, "holdings": ["BRK.B", "AMD"]},
                                {"date": D2, "holdings": ["BRK-B", "AMD"]}]), encoding="utf-8")
    monkeypatch.setattr(uct20_nav, "_COMPOSITIONS_FILE", str(comp))
    for s in DUAL:
        book = _lane(th.history(s, days=30), "book")
        assert [(r["date"], r["event"]) for r in book] == [(D1, "entered")], s


def test_catalysts_read_both_spellings_and_keep_one_row_per_day(stores):
    from api.services.catalyst import store as cat_store
    with contextlib.closing(sqlite3.connect(cat_store._DB_PATH)) as c:
        c.executemany("INSERT INTO catalysts (market_date, ticker, rank, tag, thesis_text) VALUES (?,?,?,?,?)",
                      [(D1, "BRK.B", None, "News", "Hunter saw it."),       # the hunter's dot spelling
                       (D1, "BRK-B", 4, "Catalyst", "On the list today."),  # discovery's hyphen spelling
                       (D2, "BRK.B", 2, "Earnings", "Beat and raised.")])
        c.commit()
    for s in DUAL:
        cats = _lane(th.history(s, days=30), "catalysts")
        assert sorted((r["date"], r["text"]) for r in cats) == [
            (D1, "On the list today."), (D2, "Beat and raised.")], s


def test_room_counts_a_message_once_across_both_spellings(stores):
    """Cashtags were stored as typed (BRK.B) before 2026-09-05 and hyphenated after."""
    ts = int(datetime.fromisoformat(D1 + "T11:00:00").replace(tzinfo=ET).timestamp())
    with contextlib.closing(sqlite3.connect(stores / "buzz.db")) as c:
        c.executemany("INSERT INTO mentions VALUES (?,?,?,?,?,?)",
                      [("b1", "ch", "a1", "BRK.B", ts, "cashtag"),
                       ("b2", "ch", "a2", "BRK-B", ts + 60, "cashtag"),
                       ("b2", "ch", "a2", "BRK.B", ts + 60, "cashtag")])   # one message, both forms
        c.commit()
    for s in DUAL:
        room = _lane(th.history(s, days=30), "room")
        assert [(r["date"], r["mentions"]) for r in room] == [(D1, 2)], s


def test_flow_asks_the_tape_in_the_occ_root_spelling(stores, monkeypatch):
    from api import flow_router
    flow_router.db.insert_csv(_flow_csv([("BRKB", D1), ("BRKB", D1), ("BRKB", D2)]), source="stocks")
    th._FLOW_MEMO.clear()
    for s in DUAL:
        flow = _lane(th.history(s, days=30), "flow")
        assert [(r["date"], r["prints"]) for r in flow] == [(D2, 1), (D1, 2)], s
    asked = {p for p, _ in FLOW_REQUESTS[0] if p.startswith("/api/flow/ticker/")}
    assert asked == {"/api/flow/ticker/BRKB/day-counts"}
    th._FLOW_MEMO.clear()


def test_setups_read_both_spellings_and_never_show_one_setup_twice(stores):
    db = stores / "brain" / "data" / "uct_intelligence.db"
    with contextlib.closing(sqlite3.connect(db)) as c:
        c.executemany(
            "INSERT INTO setup_triggers (symbol, trigger_date, setup_name, entry_level, stop_level, "
            "source, status) VALUES (?,?,?,?,?,?,?)",
            [("BRK.B", D1, "VCP", 400.0, 390.0, "leadership", "open"),
             ("BRK-B", D1, "VCP", 400.0, 390.0, "leadership", "open"),
             ("BRK-B", D2, "Flat Base", 405.0, 395.0, "leadership", "open")])
        c.commit()
    for s in DUAL:
        setups = _lane(th.history(s, days=30), "setups")
        assert sorted((r["date"], r["setup"]) for r in setups) == [(D1, "VCP"), (D2, "Flat Base")], s


def test_journal_matches_a_pre_normalisation_dot_row(stores, monkeypatch):
    """Journal writes canonicalise BRK.B -> BRK-B only since 2026-09-06; an older row reads BRK.B."""
    closed = [{"id": "t1", "symbol": "BRK.B", "side": "Long", "entryDate": D1, "exitDate": D2,
               "result": "Win", "rMultiple": 1.5}]
    open_pos = [{"id": "p1", "symbol": "BRK-B", "side": "Long", "entryDate": D2}]
    monkeypatch.setattr(th, "_member_journal", lambda uid, sym=None: (closed, open_pos))
    for s in DUAL:
        rows = _lane(th.history(s, days=30, user_id="me"), "journal")
        assert sorted((r["date"], r["event"], r["source"]) for r in rows) == [
            (D1, "opened", "j2_trades"), (D2, "closed", "j2_trades"), (D2, "opened", "j2_positions")], s


def test_two_same_day_journal_trades_are_both_kept(stores, monkeypatch):
    """The de-duplication is (date, lane, text) -- for the journal it also carries the trade's
    ref, because two trades opened the same day read exactly alike."""
    closed = [{"id": f"t{i}", "symbol": "NVDA", "side": "Long", "entryDate": D1, "exitDate": None}
              for i in (1, 2)]
    monkeypatch.setattr(th, "_member_journal", lambda uid, sym=None: (closed, []))
    rows = _lane(th.history("NVDA", days=30, user_id="me"), "journal")
    assert sorted(r["ref"] for r in rows) == ["j2_trades#t1", "j2_trades#t2"]


def test_the_route_hands_the_lanes_the_canonical_spelling(monkeypatch, stores):
    monkeypatch.setenv(th.ENABLED_ENV, "1")
    monkeypatch.setattr("api.routers.ticker_history.is_paid_user", lambda u: True)
    asked = []
    monkeypatch.setattr(th, "history", lambda s, **k: asked.append(s) or {"ticker": s})
    c = _client(PAID)
    for s in DUAL:
        assert c.get(f"/api/research/history/{s}").status_code == 200
    assert asked == ["BRK-B"] * 3


# ── fn5: live HIS was still 3.2-6.2 s with flow memoised: EVERY lane gets the budget ──

def _stub_lanes(monkeypatch, slow_name, gate, reads):
    """Every lane answers at once except `slow_name`, which blocks until `gate` is set."""
    import threading as _th
    lock = _th.Lock()
    monkeypatch.setattr(th, "_entity_eras", lambda s: ({"status": "unresolved"}, [(s, None, None)]))

    def slow(sym, since, *a):
        with lock:
            reads.append(sym)
        assert gate.wait(10), "test gate never opened"
        return [{"date": "2026-01-05", "lane": slow_name, "text": "late row", "source": "x",
                 "as_of": "2026-01-05", "ref": "x"}]
    fns = {n: (lambda *a: []) for n in th.LANES}
    fns[slow_name] = slow
    monkeypatch.setattr(th, "_LANE_FNS", fns)
    monkeypatch.setattr(th, "_COVERAGE_FNS", {n: (lambda *a: ("2026-01-01", None)) for n in th.LANES})
    monkeypatch.setenv(th.LANES2_ENV, "1")
    th._LANE_PARKED.clear()
    th._LANE_INFLIGHT.clear()


@pytest.mark.parametrize("slow_name", ["wire", "room", "setups"])
def test_any_slow_lane_answers_pending_and_the_re_ask_has_its_rows(monkeypatch, slow_name):
    import threading as _th
    import time as _t
    gate, reads = _th.Event(), []
    _stub_lanes(monkeypatch, slow_name, gate, reads)
    monkeypatch.setattr(th, "LANE_WAIT_S", 0.2)
    sym = f"ZZ{slow_name[:2].upper()}"
    t0 = _t.monotonic()
    out = th.history(sym, days=3650, user_id="u1")
    assert _t.monotonic() - t0 < 2.0, "the response waited on the slow lane"
    assert out["lanes"][slow_name] == {"status": "pending", "count": None, "retry_after_s": 2}
    assert all(out["lanes"][n]["status"] == "ok" for n in out["lanes"] if n != slow_name)
    assert not [r for r in out["timeline"] if r["lane"] == slow_name]
    th.history(sym, days=3650, user_id="u1")                   # a re-ask while it still reads
    gate.set()
    deadline = _t.monotonic() + 5
    while not th._LANE_PARKED and _t.monotonic() < deadline:
        _t.sleep(0.02)
    again = th.history(sym, days=3650, user_id="u1")
    assert again["lanes"][slow_name]["status"] == "ok"
    assert [r["text"] for r in again["timeline"] if r["lane"] == slow_name] == ["late row"]
    assert reads == [sym], reads                                # ONE read, joined and parked
    assert not th._LANE_PARKED and not th._LANE_INFLIGHT        # used once, then gone


def test_a_lane_answered_in_budget_is_never_served_again_from_a_park(monkeypatch):
    """A fast answer is used by its own request and parked for nobody: the next ask re-reads."""
    import threading as _th
    gate, reads = _th.Event(), []
    gate.set()
    _stub_lanes(monkeypatch, "wire", gate, reads)
    monkeypatch.setattr(th, "LANE_WAIT_S", 5.0)
    th.history("ZZFA", days=3650)
    th.history("ZZFA", days=3650)
    assert reads == ["ZZFA", "ZZFA"]
    assert not th._LANE_PARKED


def test_every_lane_is_timed_and_a_slow_read_logs_each_one(monkeypatch, caplog):
    import threading as _th
    gate, reads = _th.Event(), []
    _stub_lanes(monkeypatch, "catalysts", gate, reads)
    monkeypatch.setattr(th, "LANE_WAIT_S", 0.1)
    monkeypatch.setattr(th, "SLOW_HISTORY_LOG_S", 0.05)
    with caplog.at_level("WARNING", logger=th.logger.name):
        out = th.history("ZZTM", days=3650)
    gate.set()
    names = [n for n, _ms, _st in out["_timing"]]
    assert names[0] == "entity" and names[-1] == "total"
    assert set(names) >= set(out["lanes"])
    assert dict((n, st) for n, _ms, st in out["_timing"])["catalysts"] == "pending"
    line = [r.getMessage() for r in caplog.records if "slow ZZTM" in r.getMessage()]
    assert line and all(f"{n}=" in line[0] for n in out["lanes"]), line
    header = th.server_timing(out["_timing"])
    assert 'his-catalysts;dur=' in header and 'desc="pending"' in header and "his-total;dur=" in header


def test_the_route_sends_per_lane_server_timing_and_keeps_it_out_of_the_body(monkeypatch, stores):
    monkeypatch.setenv(th.ENABLED_ENV, "1")
    monkeypatch.setattr("api.routers.ticker_history.is_paid_user", lambda u: u.get("plan") == "pro")
    r = _client(PAID).get("/api/research/history/NVDA?days=30")
    assert r.status_code == 200
    st = r.headers.get("server-timing", "")
    for lane in r.json()["lanes"]:
        assert f"his-{lane};dur=" in st, st
    assert "_timing" not in r.json()


def test_an_archived_wire_is_parsed_once_and_re_read_when_rewritten(stores, monkeypatch):
    import os as _os
    import time as _t
    from api.services import wire_archive
    th._WIRE_DOC_MEMO.clear()
    real, reads = wire_archive.read, []
    monkeypatch.setattr(wire_archive, "read", lambda ymd: (reads.append(ymd), real(ymd))[1])
    first = _lane(th.history("NVDA", days=30), "wire")
    assert sorted(reads) == sorted([D1, D2])
    reads.clear()
    assert _lane(th.history("AMD", days=30), "wire") == [] and reads == []   # memo, not the disk
    assert _lane(th.history("NVDA", days=30), "wire") == first
    wire_archive.record({"date": D2, "rundown_html": "<p>$NVDA NVDA NVDA again.</p>"})
    p = wire_archive.path_for(D2)
    _os.utime(p, ns=(_t.time_ns(), _t.time_ns() + 10_000_000))
    again = {r["date"]: r["mentions"] for r in _lane(th.history("NVDA", days=30), "wire")}
    assert reads == [D2] and again[D2] == 3
    th._WIRE_DOC_MEMO.clear()


def _spy_journal(monkeypatch):
    """Record every journal read as (kind, symbol filter, limit, offset); never change answers."""
    from api.services.journal_two import positions, trades
    calls = []
    real_t, real_p = trades.list_trades_for_user, positions.list_open_positions

    def t(uid, *a, spec=None, **k):
        calls.append(("t", spec and spec.symbol, spec and spec.limit, spec and spec.offset))
        return real_t(uid, *a, spec=spec, **k)
    monkeypatch.setattr(trades, "list_trades_for_user", t)
    monkeypatch.setattr(positions, "list_open_positions",
                        lambda uid, *a, **k: (calls.append(("p",)), real_p(uid, *a, **k))[1])
    return calls


def test_the_journal_lane_never_reads_the_whole_journal(stores, monkeypatch):
    """fn6 -- live: a large journal cost >1 s on EVERY open, because the lane read and decoded
    every trade. It now asks the service for this ticker only, and the coverage for one row."""
    uid = _journal_member()
    _trade(uid, "AMD", OLD, D1)
    _trade(uid, "NVDA", D1, D2)
    calls = _spy_journal(monkeypatch)
    out = th.history("NVDA", days=30, user_id=uid)
    assert out["lanes"]["journal"]["status"] == "ok" and out["lanes"]["journal"]["covers_from"] == OLD
    trade_reads = [c for c in calls if c[0] == "t"]
    assert trade_reads, calls
    assert all(c[1] == "NVDA" or c[2] == 1 for c in trade_reads), calls   # ticker-only, or ONE row
    assert calls.count(("p",)) == 1, calls                                 # positions once per run
    assert [r["date"] for r in _lane(out, "journal")] == [D2, D1]


def test_the_ticker_filter_is_narrowed_to_the_exact_ticker(stores):
    """The service filter is a PREFIX match; NVDL, NVDAX and NV must never ride into NVDA."""
    uid = _journal_member()
    for s in ("NVDA", "NVDL", "NVDAX", "NV"):
        _trade(uid, s, D1, D2)
    rows = _lane(th.history("NVDA", days=30, user_id=uid), "journal")
    assert len(rows) == 2 and {r["symbol"] for r in rows} == {"NVDA"}


def test_a_dot_and_a_hyphen_class_share_are_both_found_through_the_filter(stores):
    from api.services.auth_db import get_connection
    uid = _journal_member()
    t1 = _trade(uid, "BRK-B", D1, D2)
    _trade(uid, "BRKR", D1, D2)
    with contextlib.closing(get_connection()) as c:       # a pre-2026-09-06 row kept the dot
        c.execute("UPDATE j2_trades SET symbol='BRK.B' WHERE id=?", (t1["id"],))
        c.commit()
    _trade(uid, "BRK-B", D2, D2)
    rows = _lane(th.history("BRK.B", days=30, user_id=uid), "journal")
    assert len({r["ref"] for r in rows}) == 2 and all(r["symbol"] == "BRK-B" for r in rows)


def test_the_coverage_follows_a_new_earlier_trade_at_once(stores, monkeypatch):
    """The oldest-trade answer is kept per (member, trade count): adding a trade re-reads it."""
    th._JOURNAL_OLDEST_MEMO.clear()
    uid = _journal_member()
    _trade(uid, "NVDA", D1, D2)
    assert th._journal_coverage(uid) == (D1, None)
    calls = _spy_journal(monkeypatch)
    assert th._journal_coverage(uid) == (D1, None)
    assert [c for c in calls if c[0] == "t" and c[3] is not None] == [], calls         # memo: no offset read
    _trade(uid, "AMD", OLD, D1)
    assert th._journal_coverage(uid) == (OLD, None)
    th._JOURNAL_OLDEST_MEMO.clear()


def test_the_setup_ledger_is_read_through_its_symbol_index(stores):
    import contextlib as _cl
    import inspect
    with _cl.closing(th._engine_ro()) as c:
        plan = " ".join(str(tuple(r)) for r in c.execute(
            "EXPLAIN QUERY PLAN SELECT trigger_date FROM setup_triggers WHERE symbol IN (?) "
            "AND (trigger_date >= ? OR substr(resolved_at, 1, 10) >= ?)", ("NVDA", "2026-01-01", "2026-01-01")))
    assert "USING INDEX" in plan and "SCAN setup_triggers" not in plan, plan
    assert "UPPER(symbol)" not in inspect.getsource(th.setups_lane)


# ── TERM-019 as-of + the boot warm of the wire-archive parse ─────────────────────────────

def test_the_history_is_dated_by_its_oldest_lane_read_never_now(stores, monkeypatch):
    import itertools
    clock = itertools.count(1_790_000_000.0)
    monkeypatch.setattr(th.time, "time", lambda: next(clock))
    out = th.history("NVDA", days=30)
    ok = [n for n, s in out["lanes"].items() if s["status"] == "ok"]
    assert ok, out["lanes"]                                  # non-vacuity: lanes answered
    assert out["as_of"] is not None
    stamp = datetime.fromisoformat(out["as_of"]).timestamp()
    # the OLDEST lane read (the fake clock's early ticks), never the wall clock's "now"
    assert 1_790_000_000 <= stamp < 1_790_000_000 + 10_000


def test_a_history_with_no_answering_lane_is_undated(stores, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("store gone")
    for name in th.LANES:
        monkeypatch.setitem(th._LANE_FNS, name, boom)
    out = th.history("NVDA", days=30)
    assert all(s["status"] != "ok" for s in out["lanes"].values())
    assert out["as_of"] is None


def test_the_wire_archive_warm_fills_the_memo_the_lane_reads(stores, monkeypatch):
    th._WIRE_DOC_MEMO.clear()
    got = th.warm_wire_archive()
    assert got["parsed"] == 2 and got["stopped"] is None, got
    from api.services import wire_archive
    reads = []
    real = wire_archive.read
    monkeypatch.setattr(wire_archive, "read", lambda ymd: (reads.append(ymd), real(ymd))[1])
    rows = _lane(th.history("NVDA", days=30), "wire")
    assert rows and reads == [], reads                       # the lane parsed nothing itself
    th._WIRE_DOC_MEMO.clear()


def test_the_wire_archive_warm_is_bounded_by_its_budget_and_the_memo_cap(stores, monkeypatch):
    th._WIRE_DOC_MEMO.clear()
    assert th.warm_wire_archive(budget_s=-1)["stopped"] == "budget"
    assert th._WIRE_DOC_MEMO == {}
    monkeypatch.setattr(th, "_WIRE_DOC_MEMO_MAX", 1)
    got = th.warm_wire_archive()
    assert got["parsed"] == 1 and got["stopped"] == "memo_cap", got
    th._WIRE_DOC_MEMO.clear()


def test_the_boot_warm_runs_the_wire_archive_warm(monkeypatch):
    import time as _time
    calls = []
    monkeypatch.setattr(th, "is_enabled", lambda: True)
    monkeypatch.setattr(th, "warm_wire_archive", lambda: calls.append(1) or {})
    for target in ("api.services.massive.get_movers", "api.services.engine.get_news",
                   "api.routers.theme_performance.get_theme_performance",
                   "api.services.earnings_preview_warm.warm_week_previews",
                   "api.services.earnings_preview_warm.warm_reported_analyses",
                   "api.services.screener.distribution.distributions"):
        monkeypatch.setattr(target, lambda *a, **k: None)
    monkeypatch.setattr("api.routers.breadth_monitor.get_breadth_history", lambda days=90: None)
    monkeypatch.setattr("api.services.breadth_live.warm", lambda: None)
    monkeypatch.setattr("api.routers.calendar.get_calendar", lambda week=None: None)
    monkeypatch.setattr("api.routers.calendar.get_enrichment_batch", lambda dates=None: {})
    monkeypatch.setattr("api.live_massive_router.warm_recent", lambda **kw: None)
    monkeypatch.setattr("api.live_massive_router.day_stats", lambda **kw: None)
    from api.main import _start_dashboard_warm_background
    _start_dashboard_warm_background(delay_seconds=0)
    for _ in range(200):
        if calls:
            break
        _time.sleep(0.05)
    assert calls, "the boot warm never warmed the HIS wire archive"


# ── 2026-10-07: a cold Entity Master held HIS for 108 s (entity=107827 ms) ──

def test_a_slow_entity_resolve_never_holds_the_request(monkeypatch):
    import threading as _th
    import time as _t
    gate = _th.Event()
    calls = []

    def slow_entity(s):
        calls.append(s)
        gate.wait(10)
        return ({"status": "resolved", "entity_id": "ent_x", "aliases": []}, [(s, None, None)])

    monkeypatch.setattr(th, "_entity_eras", slow_entity)
    monkeypatch.setattr(th, "ENTITY_WAIT_S", 0.2)
    monkeypatch.setattr(th, "_LANE_FNS", {n: (lambda *a: []) for n in th.LANES})
    monkeypatch.setattr(th, "_COVERAGE_FNS", {n: (lambda *a: (None, None)) for n in th.LANES})
    try:
        t0 = _t.monotonic()
        out = th.history("ZZEN", days=30)
        took = _t.monotonic() - t0
        assert took < 2.0, f"HIS waited {took:.1f}s on the entity step"
        assert out["entity"]["status"] == "pending"
        assert out["key"] == "ticker"
        assert out["lanes"], "the lanes still answered"
        # a second ask while the first resolve is still running joins it, never starts another
        th.history("ZZEN", days=30)
        assert calls == ["ZZEN"], calls
    finally:
        gate.set()


def test_a_fast_entity_resolve_is_used_as_before(monkeypatch):
    monkeypatch.setattr(th, "_entity_eras", lambda s: (
        {"status": "resolved", "entity_id": "ent_y", "aliases": []}, [(s, None, None)]))
    monkeypatch.setattr(th, "_LANE_FNS", {n: (lambda *a: []) for n in th.LANES})
    monkeypatch.setattr(th, "_COVERAGE_FNS", {n: (lambda *a: (None, None)) for n in th.LANES})
    out = th.history("ZZEF", days=30)
    assert out["entity"]["status"] == "resolved" and out["key"] == "entity"

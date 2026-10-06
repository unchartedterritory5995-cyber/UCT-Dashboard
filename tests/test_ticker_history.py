"""TERM-049 — the per-ticker history join: six citable lanes, counts-only room and flow,
entity ids across renames, dark route.

Every store is REAL and seeded in a tmp dir: the flow lane is read through the REAL
`/api/flow/ticker` and `/api/flow/dates` routes (flow_router, `require_flow_user`, the
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


def test_flow_lane_is_counts_only_and_asks_for_one_column(stores):
    """The tape holds premium, side, strike and expiry; the lane must never carry them. It
    asks for `CreatedDate` alone, and refuses a tape that answers with more."""
    out = th.history("NVDA", days=30)
    blob = json.dumps(_lane(out, "flow"))
    for paid in ("987654", "Premium", "CALL", "Strike", "150", "12/18/2026", "SWEEP"):
        assert paid not in blob
    tape_reads = [p for p, q in FLOW_REQUESTS[0] if p.startswith("/api/flow/ticker/")]
    assert tape_reads and all(q["cols"] == "CreatedDate" for p, q in FLOW_REQUESTS[0]
                              if p.startswith("/api/flow/ticker/"))


def test_a_tape_that_ignores_the_projection_is_unavailable(stores, monkeypatch):
    real = th._flow_request

    def wide(path, params):
        return real(path, {k: v for k, v in params.items() if k != "cols"})   # every column
    monkeypatch.setattr(th, "_flow_request", wide)
    out = th.history("NVDA", days=30)
    assert out["lanes"]["flow"] == {"status": "unavailable", "count": None}
    assert "987654" not in json.dumps(out)


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
    monkeypatch.setattr(th, "_member_journal", lambda uid: journal_reads.append(uid) or ([], []))
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
            th._flow_counts("ZZFL", "stocks")
    assert calls == ["stocks"]
    th._FLOW_MEMO.clear()

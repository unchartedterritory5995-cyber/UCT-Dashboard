"""Wave 13 lane 13C, phase 1 -- earnings prep (`api/services/journal_two/earnings_prep.py`,
`api/routers/notebook_earnings_prep.py`).

What each section proves:
  * THE GATE: both routes answer the one 404 while `NOTEBOOK_EARNINGS_PREP_ENABLED` is off,
    signed out or not -- the gate runs before the session is read. Paid plan required.
  * REPORTING SOON: the member's OWN sets (positions, watchlists, flagged; never UCT20) crossed
    with the calendar window, sorted, with timing from the calendar's already-built weeks and an
    Open link for a name already prepped.
  * SOURCE AND AS-OF ON EVERY CELL, and each source stubbed off yields a labelled missing cell
    (never a guess), while the draft still comes back whole.
  * THE CITATION: the member's own notes, cited by id -- and never another member's.
  * THE CAP: 20 drafts a member a day, durable, so it holds across a process restart; a failed
    draft is given back; the cap is per member.
  * NO ALPHAVANTAGE, NO MODEL CALL: the import graph (transitively) never reaches AlphaVantage,
    the transcript fetcher or the recap generator; and a runtime trap on every AlphaVantage door
    stays untripped through a draft whose recap is MISSING (the path that, through
    `call_recap`, would warm through AlphaVantage).
  * NO NOTE WITHOUT A CLICK: neither route writes a note.
  * THE SANDBOX CALENDAR is local-only.
"""
from __future__ import annotations

import ast
import importlib
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

ROOT = Path(__file__).resolve().parents[1]
FLAG = "NOTEBOOK_EARNINGS_PREP_ENABLED"
A, B = "user-prep-a", "user-prep-b"
PAID = {"plan": "pro"}
FREE = {"plan": "free"}
TODAY = "2026-10-02"

SERVICE = ROOT / "api" / "services" / "journal_two" / "earnings_prep.py"
ROUTER = ROOT / "api" / "routers" / "notebook_earnings_prep.py"

#: Every door to AlphaVantage, the transcript fetcher, and the recap generator.
FORBIDDEN_MODULES = {
    "api.services.alphavantage_client",
    "api.services.av_transcripts",
    "api.services.call_recap",
    "api.services.call_recap_warmer",
    "api.services.call_recap_grounded",
    "api.routers.earnings_intel",
    "api.routers.earnings",
}
#: Model clients and the modules that call one.
MODEL_MODULES = {"anthropic", "openai", "api.services.journal_two.writing_help",
                 "api.services.journal_two.note_ask", "api.services.call_recap",
                 "api.services.call_recap_grounded"}


# ── fixtures ────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid, email in ((A, "a@example.com"), (B, "b@example.com")):
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                     (uid, email, "x", uid, "member"))
    conn.commit()
    conn.close()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture(autouse=True)
def _no_vendor_lookup(monkeypatch):
    """The draft resolves the name's display identity through `ticker_meta.get_ticker_meta`
    (`ticker_research.py:48-49`: Yahoo, then FMP, then Finnhub). Nothing here replaced it, so on
    a cold cache this suite made live vendor requests. It is a fixed stand-in now, and every
    outbound connection is refused and recorded, so a NEW unreplaced source fails the test that
    reached it instead of quietly going to the network. Loopback stays open (the event loop's own
    wake-up pair uses it on Windows).

    Two doors are closed, because one is not enough: Python sockets (requests, httpx, urllib), and
    yfinance itself, which can go out through libcurl where a socket guard never sees it."""
    import socket
    from api.services import ticker_meta
    looked_up: list[str] = []
    monkeypatch.setattr(ticker_meta, "get_ticker_meta",
                        lambda symbol: looked_up.append(symbol) or {"name": f"{symbol} Corp"})
    attempts: list[str] = []
    real_connect, real_connect_ex = socket.socket.connect, socket.socket.connect_ex

    def _guard(real):
        def connect(self, address):
            host = str(address[0]) if isinstance(address, tuple) and address else str(address)
            if not host.startswith(("127.", "::1", "localhost", "0.0.0.0")):
                attempts.append(host)
                raise OSError(f"test_notebook_earnings_prep: outbound connection refused ({host})")
            return real(self, address)
        return connect

    monkeypatch.setattr(socket.socket, "connect", _guard(real_connect))
    monkeypatch.setattr(socket.socket, "connect_ex", _guard(real_connect_ex))
    import yfinance

    def _no_yahoo(*args, **kwargs):
        attempts.append(f"yfinance:{args[0] if args else '?'}")
        raise OSError("test_notebook_earnings_prep: outbound connection refused (yfinance)")
    monkeypatch.setattr(yfinance, "Ticker", _no_yahoo)
    monkeypatch.setattr(yfinance, "download", _no_yahoo)
    yield {"looked_up": looked_up, "attempts": attempts}
    assert attempts == [], f"this test tried to reach the network: {sorted(set(attempts))}"


def test_CONTROL_the_network_refusal_can_fire(_no_vendor_lookup):
    """The guard above is only worth having if it fires. TEST-NET-3 is never a real host."""
    import socket
    s = socket.socket()
    try:
        with pytest.raises(OSError, match="outbound connection refused"):
            s.connect(("203.0.113.7", 9))
    finally:
        s.close()
    import yfinance
    with pytest.raises(OSError, match="yfinance"):
        yfinance.Ticker("NVDA")
    assert _no_vendor_lookup["attempts"] == ["203.0.113.7", "yfinance:NVDA"]
    _no_vendor_lookup["attempts"].clear()          # the control's own attempts are not a leak


def test_the_draft_asks_for_the_names_identity_through_the_stand_in(client, app, gate_on, monkeypatch, stores,
                                                                    _no_vendor_lookup):
    """Non-vacuity for the stand-in: the draft path really does reach `get_ticker_meta`, so
    replacing it is what keeps this suite off the network."""
    _today(monkeypatch)
    _full_market(monkeypatch, stores)
    as_user(app, A)
    assert client.post("/api/j2/earnings-prep/NVDA/draft").status_code == 200
    assert "NVDA" in _no_vendor_lookup["looked_up"]


@pytest.fixture(autouse=True)
def _clean_cache():
    from api.services.cache import cache
    for prefix in ("notebook_earnings_prep_window", "calendar_week", "calendar_enrichment_"):
        cache.delete_prefix(prefix)
    cache.invalidate("calendar_weekly")
    yield
    for prefix in ("notebook_earnings_prep_window", "calendar_week", "calendar_enrichment_"):
        cache.delete_prefix(prefix)
    cache.invalidate("calendar_weekly")


@pytest.fixture
def gate_on(monkeypatch):
    monkeypatch.setenv(FLAG, "1")


@pytest.fixture
def stores(monkeypatch, tmp_path):
    """Point the two durable market stores at empty temp databases."""
    from api.services import call_recap_store, implied_store
    monkeypatch.setattr(call_recap_store, "DB_PATH", str(tmp_path / "recaps.db"))
    call_recap_store.init_db()
    monkeypatch.setattr(implied_store, "DB_PATH", str(tmp_path / "implied.db"))
    return call_recap_store, implied_store


@pytest.fixture
def app(db_path):
    from api.routers import notebook_earnings_prep
    fa = FastAPI()
    fa.include_router(notebook_earnings_prep.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def as_user(app, user_id: str, plan: dict = PAID) -> None:
    user = {"id": user_id, "role": "member", **plan}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def _sets(monkeypatch, sets_by_user: dict) -> None:
    from api.services import calendar_personalization
    monkeypatch.setattr(calendar_personalization, "get_user_ticker_sets",
                        lambda uid: {k: set(v) for k, v in sets_by_user.get(uid, {}).items()})


def _window(monkeypatch, window: dict, partial: bool = False) -> list:
    calls = []
    from api.services import calendar_alerts

    def fake(today, days):
        calls.append((today.isoformat(), days))
        return dict(window), partial
    monkeypatch.setattr(calendar_alerts, "collect_earnings_window", fake)
    return calls


def _intel(monkeypatch, payload) -> None:
    from api.services import earnings_intel
    if isinstance(payload, Exception):
        def boom(_sym):
            raise payload
        monkeypatch.setattr(earnings_intel, "get_earnings", boom)
    else:
        monkeypatch.setattr(earnings_intel, "get_earnings", lambda _sym: payload)


def _today(monkeypatch):
    from api.services.journal_two import calendar as j2cal
    monkeypatch.setattr(j2cal, "et_today", lambda: TODAY)


INTEL = {
    "ticker": "NVDA",
    "quarters": [
        {"fiscal_year": 2027, "fiscal_quarter": 2, "label": "FY2027 Q2", "report_date": "2026-08-26", "reported": True,
         "eps_actual": 1.05, "revenue_actual": 46e9, "eps_beat": True, "eps_surprise_pct": 4.2,
         "rev_beat": True, "rev_surprise_pct": 1.1},
        {"fiscal_year": 2027, "fiscal_quarter": 1, "label": "FY2027 Q1", "report_date": "2026-05-27", "reported": True,
         "eps_actual": 0.96, "revenue_actual": 44e9, "eps_beat": False, "eps_surprise_pct": -1.3,
         "rev_beat": None, "rev_surprise_pct": None},
        {"fiscal_year": 2026, "fiscal_quarter": 4, "label": "FY2026 Q4", "report_date": "2026-02-25", "reported": True,
         "eps_actual": 0.89, "revenue_actual": 39e9, "eps_beat": True, "eps_surprise_pct": 2.0,
         "rev_beat": True, "rev_surprise_pct": 0.5},
        {"fiscal_year": 2026, "fiscal_quarter": 3, "label": "FY2026 Q3", "report_date": "2025-11-19", "reported": True,
         "eps_actual": 0.81, "revenue_actual": 35.1e9, "eps_beat": True, "eps_surprise_pct": 3.0,
         "rev_beat": True, "rev_surprise_pct": 2.0},
        {"fiscal_year": 2026, "fiscal_quarter": 2, "label": "FY2026 Q2", "report_date": "2025-08-27", "reported": True,
         "eps_actual": 0.68, "revenue_actual": 30e9, "eps_beat": True, "eps_surprise_pct": 1.0,
         "rev_beat": True, "rev_surprise_pct": 1.0},
    ],
    "estimates": [
        {"fiscal_year": 2027, "fiscal_quarter": 4, "label": "FY2027 Q4", "report_date": "2027-02-24",
         "eps_estimate": 1.5, "revenue_estimate": 60e9, "eps_yoy_pct": 68.5, "rev_yoy_pct": 53.8},
        {"fiscal_year": 2027, "fiscal_quarter": 3, "label": "FY2027 Q3", "report_date": "2026-10-05",
         "eps_estimate": 1.31, "revenue_estimate": 54e9, "eps_yoy_pct": 61.7, "rev_yoy_pct": 53.8},
    ],
    "reaction": {"events": [
        {"quarter": "FY2026 Q3", "report_date": "2025-11-19", "reaction_pct": 1.0},
        {"quarter": "FY2026 Q4", "report_date": "2026-02-25", "reaction_pct": -8.5},
        {"quarter": "FY2027 Q1", "report_date": "2026-05-27", "reaction_pct": 2.4},
        {"quarter": "FY2027 Q2", "report_date": "2026-08-26", "reaction_pct": -3.1},
    ]},
    "summary": {"next_report_date": "2026-10-05"},
    "next_report_date": "2026-10-05",
    "meta": {"retrieved_at": 1790000000.0},
}


def _full_market(monkeypatch, stores):
    recap_store, implied_store = stores
    _sets(monkeypatch, {A: {"positions": {"NVDA"}, "watchlist": {"AMD"}, "flagged": set(), "uct20": {"META"}}})
    _window(monkeypatch, {"NVDA": "2026-10-05", "AMD": "2026-10-06", "META": "2026-10-03", "TSLA": "2026-10-04"})
    _intel(monkeypatch, INTEL)
    implied_store.record_implied("NVDA", "2026-10-05", {"pct": 6.5, "dollar": 12.4, "source": "test"},
                                 "2026-10-04T21:00:00Z")
    implied_store.record_implied("NVDA", "2026-08-26", {"pct": 6.9, "dollar": 11.0, "source": "test"},
                                 "2026-08-25T21:00:00Z")
    recap_store.put("NVDA", "Q2 2027", {"headline": "Data center carried it", "sentiment": "positive",
                                        "bullets": ["Blackwell ramp ahead of plan"], "guidance": "Raised"})


def _note(user_id: str, title: str, ticker: str, tags=None) -> str:
    from api.services.journal_two.notes import create_note
    n = create_note(user_id, {"title": title, "ticker": ticker, "tags": tags or []})
    return n["id"]


def _position(user_id: str, sym: str, *, closed: bool = False) -> None:
    from api.services.auth_db import get_connection
    conn = get_connection()
    conn.execute(
        "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, original_shares, entry_price,"
        " stop_price, context_at_entry, created_at, updated_at, closed_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (f"pos-{user_id}-{sym}", user_id, sym, "Long", "2026-09-15", 100, 100, 180.0, 170.0, "{}",
         "2026-09-15T14:00:00Z", "2026-09-15T14:00:00Z", "2026-09-20" if closed else None))
    conn.commit()
    conn.close()


def _trade(user_id: str, sym: str, tid: str) -> None:
    """A closed trade row: in at 100.00, out at 112.30, so +12.3%.

    ⛔ `pnl_percent` IS A FRACTION (0.123), the journal's own unit. This helper wrote 12.3 for
    months, a percent, and no test noticed. A fixture in the wrong unit is how the note's
    "+1230.0%" defect hid: the tests agreed with the fixture, not with the product."""
    from api.services.auth_db import get_connection
    conn = get_connection()
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date, exit_price,"
        " exit_date, original_stop, pnl_dollar, pnl_percent, r_multiple, hold_days, result, context_at_entry, created_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, user_id, f"pos-{tid}", sym, "Long", 10, 100.0, "2026-08-01", 112.3, "2026-08-20", 95.0, 123.0, 0.123,
         2.1, 19, "Win", "{}", "2026-08-20T20:00:00Z"))
    conn.commit()
    conn.close()


def _count_notes() -> int:
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        return conn.execute("SELECT COUNT(*) FROM j2_notes").fetchone()[0]
    finally:
        conn.close()


# ── the gate ────────────────────────────────────────────────────────────────────────────

ROUTES = [("get", "/api/j2/earnings-prep/soon"), ("post", "/api/j2/earnings-prep/NVDA/draft")]


@pytest.mark.parametrize("method,path", ROUTES)
def test_gate_off_answers_404_signed_in_or_out(client, app, monkeypatch, method, path):
    monkeypatch.delenv(FLAG, raising=False)
    assert getattr(client, method)(path).status_code == 404          # signed out: the gate ran first
    as_user(app, A)
    assert getattr(client, method)(path).status_code == 404
    monkeypatch.setenv(FLAG, "0")
    assert getattr(client, method)(path).status_code == 404


@pytest.mark.parametrize("method,path", ROUTES)
def test_gate_on_needs_a_session_and_a_paid_plan(client, app, gate_on, method, path):
    assert getattr(client, method)(path).status_code == 401
    as_user(app, A, FREE)
    r = getattr(client, method)(path)
    assert r.status_code == 402 and r.json()["detail"] == "Earnings prep requires a paid plan"


def test_the_flag_is_on_the_auth_payload_and_defaults_off(monkeypatch):
    from api.routers import auth as auth_router
    assert auth_router.NOTEBOOK_FLAGS["NOTEBOOK_EARNINGS_PREP_ENABLED"] is False
    monkeypatch.delenv(FLAG, raising=False)
    assert auth_router._access_payload({"role": "member"}, "pro")["notebook_earnings_prep_enabled"] is False
    monkeypatch.setenv(FLAG, "1")
    assert auth_router._access_payload({"role": "member"}, "pro")["notebook_earnings_prep_enabled"] is True


# ── reporting soon ──────────────────────────────────────────────────────────────────────

def test_reporting_soon_is_the_members_own_sets_crossed_with_the_window(client, app, gate_on, monkeypatch):
    _today(monkeypatch)
    _sets(monkeypatch, {A: {"positions": {"NVDA"}, "watchlist": {"AMD", "NVDA"}, "flagged": {"CRM"},
                            "uct20": {"META"}}})
    calls = _window(monkeypatch, {"NVDA": "2026-10-05", "AMD": "2026-10-02", "META": "2026-10-03",
                                  "CRM": "2026-10-09", "TSLA": "2026-10-04"})
    from api.services.cache import cache
    cache.set("calendar_weekly", {"days": {"2026-10-02": {"bmo": [{"sym": "AMD"}], "amc": []}}}, ttl=600)
    cache.set("calendar_week_2026-10-05", {"days": {"2026-10-05": {"amc": [{"sym": "NVDA"}]}}}, ttl=600)
    as_user(app, A)
    body = client.get("/api/j2/earnings-prep/soon").json()
    assert [i["symbol"] for i in body["items"]] == ["AMD", "NVDA", "CRM"]      # sorted by date; META (UCT20) and TSLA out
    by = {i["symbol"]: i for i in body["items"]}
    assert by["NVDA"]["sources"] == ["positions", "watchlist"]
    assert by["AMD"]["timing"] == "bmo" and by["NVDA"]["timing"] == "amc" and by["CRM"]["timing"] is None
    assert by["AMD"]["daysAway"] == 0 and by["CRM"]["daysAway"] == 7
    assert body["windowDays"] == 7 and body["source"] == "UCT earnings calendar" and body["asOf"]
    assert calls == [(TODAY, 7)]
    # one walk per window: a second read is served from the shared cache
    client.get("/api/j2/earnings-prep/soon")
    assert calls == [(TODAY, 7)]


def test_reporting_soon_offers_open_for_a_name_already_prepped(client, app, gate_on, monkeypatch):
    _today(monkeypatch)
    _sets(monkeypatch, {A: {"positions": {"NVDA"}, "watchlist": {"AMD"}}})
    _window(monkeypatch, {"NVDA": "2026-10-05", "AMD": "2026-10-06"})
    prep = _note(A, "Earnings Prep — NVDA", "NVDA", ["earnings", "earnings-prep"])
    _note(A, "AMD idea", "AMD", ["semis"])                                       # not a prep note
    _note(B, "Earnings Prep — AMD", "AMD", ["earnings-prep"])                    # another member's
    as_user(app, A)
    by = {i["symbol"]: i for i in client.get("/api/j2/earnings-prep/soon").json()["items"]}
    assert by["NVDA"]["prepNote"]["id"] == prep
    assert by["AMD"]["prepNote"] is None


def test_an_open_position_is_listed_through_the_journals_own_reader(client, app, gate_on, monkeypatch):
    """The walk's first run found it: the shared interest reader answers NO positions (it reads
    columns j2_positions does not have). The open position must still be listed, from the journal's
    own reader, while a closed one is not -- with the shared reader returning nothing at all."""
    _today(monkeypatch)
    _sets(monkeypatch, {A: {"positions": set(), "watchlist": set(), "flagged": set()}})
    _window(monkeypatch, {"NVDA": "2026-10-05", "AMD": "2026-10-06"})
    _position(A, "NVDA")
    _position(A, "AMD", closed=True)
    _position(B, "AMD")                                                          # another member's
    as_user(app, A)
    items = client.get("/api/j2/earnings-prep/soon").json()["items"]
    assert [(i["symbol"], i["sources"]) for i in items] == [("NVDA", ["positions"])]


def test_a_partial_window_is_reported_not_hidden(client, app, gate_on, monkeypatch):
    _today(monkeypatch)
    _sets(monkeypatch, {A: {"watchlist": {"NVDA"}}})
    _window(monkeypatch, {}, partial=True)
    as_user(app, A)
    body = client.get("/api/j2/earnings-prep/soon").json()
    assert body["items"] == [] and body["partial"] is True and body["watched"] == 1


# ── the draft: every cell sourced, every missing one labelled ──────────────────────────

def _assert_cell(c):
    assert set(c) == {"value", "source", "asOf", "missing"}, c
    assert c["source"], c
    if c["value"] is None:
        assert c["missing"] and c["asOf"] is None, c
    else:
        assert c["missing"] is None and c["asOf"], c


def _cells(draft):
    yield draft["report"]["date"]
    yield draft["report"]["timing"]
    yield draft["expectedMove"]
    for k in ("eps", "revenue", "epsYearAgo", "revenueYearAgo"):
        yield draft["street"][k]
    for k in ("reactions", "recap", "myNotes", "myTrades", "myPosition"):
        yield draft[k]


def test_a_full_draft_carries_source_and_as_of_on_every_cell(client, app, gate_on, monkeypatch, stores):
    _today(monkeypatch)
    _full_market(monkeypatch, stores)
    from api.services.cache import cache
    cache.set("calendar_week_2026-10-05", {"days": {"2026-10-05": {"amc": [{"sym": "NVDA"}]}}}, ttl=600)
    note_id = _note(A, "NVDA thesis", "NVDA")
    _position(A, "NVDA")
    _trade(A, "NVDA", "t-nvda-1")
    _trade(A, "NVDAX", "t-other")                    # the FilterSpec prefix match must not leak this in
    as_user(app, A)
    r = client.post("/api/j2/earnings-prep/nvda/draft")
    assert r.status_code == 200, r.text
    d = r.json()
    for c in _cells(d):
        _assert_cell(c)
        assert c["value"] is not None, c
    assert d["symbol"] == "NVDA" and d["frozenAt"]
    assert d["report"]["date"]["value"] == "2026-10-05" and d["report"]["timing"]["value"] == "amc"
    assert d["expectedMove"]["value"] == {"pct": 6.5, "dollar": 12.4}
    assert d["expectedMove"]["asOf"] == "2026-10-04T21:00:00Z"
    s = d["street"]
    assert s["quarter"] == "FY2027 Q3" and s["eps"]["value"] == 1.31 and s["revenue"]["value"] == 54e9
    assert s["epsYearAgo"]["value"] == 0.81 and s["revenueYearAgo"]["value"] == 35.1e9
    rows = d["reactions"]["value"]
    assert [x["quarter"] for x in rows] == ["FY2027 Q2", "FY2027 Q1", "FY2026 Q4", "FY2026 Q3"]
    assert rows[0]["reactionPct"] == -3.1 and rows[0]["impliedPct"] == 6.9 and rows[1]["impliedPct"] is None
    assert d["recap"]["value"]["headline"] == "Data center carried it" and d["recap"]["value"]["quarter"] == "Q2 2027"
    assert [n["id"] for n in d["myNotes"]["value"]] == [note_id]
    assert [t["id"] for t in d["myTrades"]["value"]] == ["t-nvda-1"]
    assert d["myTrades"]["value"][0]["pnlPercent"] == 0.123      # the journal's fraction, passed through
    assert d["myPosition"]["value"][0]["shares"] == 100
    assert d["usage"] == {"used": 1, "cap": 20}


MISSING_CASES = {
    "calendar": ("report.date", None),
    "intel": ("street.eps", None),
    "implied": ("expectedMove", None),
    "recap": ("recap", "No stored call recap for NVDA"),
    "notes": ("myNotes", "You have no notes on NVDA yet."),
    "trades": ("myTrades", "You have no closed trades in NVDA in your journal."),
    "position": ("myPosition", "You hold no open position in NVDA."),
}


def _get(d, path):
    for part in path.split("."):
        d = d[part]
    return d


@pytest.mark.parametrize("off", sorted(MISSING_CASES))
def test_each_source_stubbed_off_yields_a_labelled_missing_cell(client, app, gate_on, monkeypatch, stores, off):
    """One source at a time answers nothing; that cell reads missing WITH its sentence, and the
    rest of the draft still arrives."""
    _today(monkeypatch)
    _full_market(monkeypatch, stores)
    recap_store, implied_store = stores
    if off != "notes":
        _note(A, "NVDA thesis", "NVDA")
    if off != "position":
        _position(A, "NVDA")
    if off != "trades":
        _trade(A, "NVDA", "t1")
    if off == "calendar":
        _window(monkeypatch, {})
        bare = dict(INTEL, summary={}, next_report_date=None)
        _intel(monkeypatch, bare)
    elif off == "intel":
        _intel(monkeypatch, {"error": "ticker required"})
    elif off == "implied":
        monkeypatch.setattr(implied_store, "get_implied_history", lambda sym, limit=8: [])
    elif off == "recap":
        monkeypatch.setattr(recap_store, "get", lambda sym, quarter=None: None)
    as_user(app, A)
    d = client.post("/api/j2/earnings-prep/NVDA/draft").json()
    for c in _cells(d):
        _assert_cell(c)
    path, sentence = MISSING_CASES[off]
    target = _get(d, path)
    assert target["value"] is None and target["missing"], target
    if sentence:
        assert sentence in target["missing"]
    # every OTHER section still arrived (a missing source never blanks the draft)
    present = [c for c in _cells(d) if c["value"] is not None]
    assert len(present) >= 5, [c for c in _cells(d)]


def test_every_source_failing_still_returns_a_whole_draft(client, app, gate_on, monkeypatch, stores):
    """Each source RAISES; the draft is still whole, each cell missing with a sentence."""
    _today(monkeypatch)
    recap_store, implied_store = stores
    _sets(monkeypatch, {})
    from api.services import calendar_alerts
    from api.services.journal_two import ticker_research, trades, positions

    def boom(*a, **k):
        raise RuntimeError("source down")
    monkeypatch.setattr(calendar_alerts, "collect_earnings_window", boom)
    _intel(monkeypatch, RuntimeError("intel down"))
    monkeypatch.setattr(implied_store, "get_implied_history", boom)
    monkeypatch.setattr(recap_store, "get", boom)
    monkeypatch.setattr(ticker_research, "get_ticker_research_summary", boom)
    monkeypatch.setattr(trades, "list_trades_for_user", boom)
    monkeypatch.setattr(positions, "list_open_positions", boom)
    as_user(app, A)
    r = client.post("/api/j2/earnings-prep/NVDA/draft")
    assert r.status_code == 200, r.text
    for c in _cells(r.json()):
        _assert_cell(c)
        assert c["value"] is None


# ── the citation: the member's own notes, never another member's ───────────────────────

def test_the_draft_cites_the_members_own_notes_and_never_anothers(client, app, gate_on, monkeypatch, stores):
    _today(monkeypatch)
    _full_market(monkeypatch, stores)
    mine = [_note(A, "NVDA thesis", "NVDA"), _note(A, "NVDA after Q2", "NVDA")]
    _note(A, "AMD idea", "AMD")
    theirs = _note(B, "B's NVDA note", "NVDA")
    _trade(B, "NVDA", "t-b")
    _position(B, "NVDA")
    as_user(app, A)
    d = client.post("/api/j2/earnings-prep/NVDA/draft").json()
    cited = [n["id"] for n in d["myNotes"]["value"]]
    assert sorted(cited) == sorted(mine) and theirs not in cited
    assert all(n["title"] for n in d["myNotes"]["value"])
    assert d["myTrades"]["value"] is None and d["myPosition"]["value"] is None


# ── the cap ─────────────────────────────────────────────────────────────────────────────

def _quiet_market(monkeypatch, stores):
    _sets(monkeypatch, {})
    _window(monkeypatch, {})
    _intel(monkeypatch, {"error": "x"})


def test_the_cap_admits_twenty_then_refuses_with_a_sentence(client, app, gate_on, monkeypatch, stores):
    _today(monkeypatch)
    _quiet_market(monkeypatch, stores)
    as_user(app, A)
    for i in range(20):
        r = client.post("/api/j2/earnings-prep/NVDA/draft")
        assert r.status_code == 200, (i, r.text)
    assert r.json()["usage"] == {"used": 20, "cap": 20}
    r = client.post("/api/j2/earnings-prep/NVDA/draft")
    assert r.status_code == 429
    assert r.json()["detail"] == ("You've drafted 20 earnings prep notes today, the daily limit. "
                                  "It resets at midnight Eastern.")
    # per member: B is untouched by A's day
    as_user(app, B)
    assert client.post("/api/j2/earnings-prep/NVDA/draft").status_code == 200


def test_the_cap_holds_across_a_restart(db_path, gate_on, monkeypatch, stores):
    """The count lives in daily_usage_counters, not in the process: re-import the router and
    the counter module (what a deploy does) and the 21st draft is still refused."""
    _today(monkeypatch)
    _quiet_market(monkeypatch, stores)
    monkeypatch.setenv("NOTEBOOK_EARNINGS_PREP_DAILY_CAP", "3")

    def fresh_client():
        from api.services import daily_counters
        importlib.reload(daily_counters)
        from api.routers import notebook_earnings_prep
        importlib.reload(notebook_earnings_prep)
        fa = FastAPI()
        fa.include_router(notebook_earnings_prep.router)
        as_user(fa, A)
        return TestClient(fa)

    c1 = fresh_client()
    assert [c1.post("/api/j2/earnings-prep/NVDA/draft").status_code for _ in range(3)] == [200, 200, 200]
    c2 = fresh_client()                                  # "the restart"
    assert c2.post("/api/j2/earnings-prep/NVDA/draft").status_code == 429


def test_a_draft_that_fails_gives_its_charge_back(client, app, gate_on, monkeypatch, stores):
    _today(monkeypatch)
    _quiet_market(monkeypatch, stores)
    monkeypatch.setenv("NOTEBOOK_EARNINGS_PREP_DAILY_CAP", "1")
    from api.services.journal_two import earnings_prep

    def explode(*a, **k):
        raise RuntimeError("draft blew up")
    monkeypatch.setattr(earnings_prep, "draft", explode)
    as_user(app, A)
    with pytest.raises(RuntimeError):
        client.post("/api/j2/earnings-prep/NVDA/draft")
    from api.services import daily_counters
    assert daily_counters.value(TODAY, earnings_prep.DAILY_SCOPE, A) == 0


def test_a_bad_symbol_is_refused_before_the_cap_is_charged(client, app, gate_on, monkeypatch, stores):
    _today(monkeypatch)
    as_user(app, A)
    assert client.post("/api/j2/earnings-prep/12345678901/draft").status_code == 400
    from api.services import daily_counters
    from api.services.journal_two import earnings_prep
    assert daily_counters.value(TODAY, earnings_prep.DAILY_SCOPE, A) == 0


# ── no note without a click ─────────────────────────────────────────────────────────────

def test_neither_route_writes_a_note(client, app, gate_on, monkeypatch, stores):
    _today(monkeypatch)
    _full_market(monkeypatch, stores)
    _note(A, "NVDA thesis", "NVDA")
    before = _count_notes()
    as_user(app, A)
    client.get("/api/j2/earnings-prep/soon")
    client.post("/api/j2/earnings-prep/NVDA/draft")
    assert _count_notes() == before


def test_no_note_writer_is_imported_by_either_module():
    for path in (SERVICE, ROUTER):
        names = _imported_names(path)
        assert not names & {"create_note", "update_note", "put_note", "append_to_note"}, (path, names)


# ── no AlphaVantage, no model call ──────────────────────────────────────────────────────

def _module_path(mod: str) -> Path | None:
    p = ROOT / (mod.replace(".", "/") + ".py")
    if p.exists():
        return p
    p = ROOT / mod.replace(".", "/") / "__init__.py"
    return p if p.exists() else None


def _imports_of(mod: str) -> set[str]:
    """Every api.* module (and every top-level third-party name) `mod` imports, at module
    level OR inside a function -- an AST walk, never a grep."""
    path = _module_path(mod)
    if not path:
        return set()
    tree = ast.parse(path.read_text(encoding="utf-8"))
    pkg = mod if path.name == "__init__.py" else mod.rsplit(".", 1)[0]
    out: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names:
                out.add(a.name)
        elif isinstance(n, ast.ImportFrom):
            base = n.module or ""
            if n.level:
                parts = pkg.split(".")[: len(pkg.split(".")) - (n.level - 1)]
                base = ".".join(parts + ([base] if base else []))
            out.add(base)
            for a in n.names:
                if _module_path(f"{base}.{a.name}"):
                    out.add(f"{base}.{a.name}")
    return out


def _imported_names(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {a.asname or a.name for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) for a in n.names}


def _reach(start: list[str]) -> set[str]:
    seen: set[str] = set()
    stack = list(start)
    while stack:
        m = stack.pop()
        if m in seen:
            continue
        seen.add(m)
        stack.extend(x for x in _imports_of(m) if x.startswith("api") and _module_path(x))
    return seen


def test_the_import_graph_never_reaches_alphavantage_or_the_recap_generator():
    reached = _reach(["api.services.journal_two.earnings_prep", "api.routers.notebook_earnings_prep"])
    # non-vacuity: the walk really follows function-level imports into the services it reuses
    assert {"api.services.calendar_alerts", "api.services.earnings_intel", "api.services.implied_store",
            "api.services.call_recap_store", "api.services.journal_two.ticker_research"} <= reached
    assert not reached & FORBIDDEN_MODULES, sorted(reached & FORBIDDEN_MODULES)


def test_CONTROL_the_walk_finds_alphavantage_where_it_is_reachable():
    reached = _reach(["api.routers.earnings_intel"])
    assert {"api.services.av_transcripts", "api.services.alphavantage_client"} <= reached


def test_neither_module_imports_a_model_client_directly():
    for mod in ("api.services.journal_two.earnings_prep", "api.routers.notebook_earnings_prep"):
        direct = _imports_of(mod)
        assert "api.services.notebook_flags" in direct or mod.endswith("notebook_earnings_prep")
        assert not direct & MODEL_MODULES, (mod, direct & MODEL_MODULES)


def test_a_draft_never_reaches_alphavantage_at_runtime(client, app, gate_on, monkeypatch, stores):
    """Every AlphaVantage door, the transcript fetcher and the recap generator are TRAPPED, and a
    draft is run down the path that would reach them through `call_recap`: no stored recap."""
    tripped: list[str] = []

    def trap(name):
        def _t(*a, **k):
            tripped.append(name)
            raise AssertionError(f"{name} was reached")
        return _t

    from api.services import alphavantage_client, av_transcripts, call_recap, call_recap_warmer
    for name in ("av_get", "av_get_status", "av_take_token"):
        monkeypatch.setattr(alphavantage_client, name, trap(f"alphavantage_client.{name}"))
    monkeypatch.setattr(av_transcripts, "get_transcript", trap("av_transcripts.get_transcript"))
    for name in ("get_call_recap", "get_call_recap_with_status", "_trigger_background_warm", "_transcript_for"):
        monkeypatch.setattr(call_recap, name, trap(f"call_recap.{name}"))
    monkeypatch.setattr(call_recap_warmer, "warm_symbol", trap("call_recap_warmer.warm_symbol"))
    import requests
    real_request = requests.Session.request

    def guarded(self, method, url, *a, **k):
        if "alphavantage" in str(url):
            tripped.append(f"HTTP {url}")
            raise AssertionError("an AlphaVantage URL was requested")
        return real_request(self, method, url, *a, **k)
    monkeypatch.setattr(requests.Session, "request", guarded)

    _today(monkeypatch)
    _sets(monkeypatch, {A: {"watchlist": {"NVDA"}}})
    _window(monkeypatch, {"NVDA": "2026-10-05"})
    _intel(monkeypatch, INTEL)
    as_user(app, A)
    d = client.post("/api/j2/earnings-prep/NVDA/draft").json()
    assert d["recap"]["value"] is None and "No stored call recap" in d["recap"]["missing"]
    client.get("/api/j2/earnings-prep/soon")
    assert tripped == []


def test_CONTROL_the_trap_fires_when_the_recap_generator_is_called(monkeypatch):
    """The runtime rail can fail: the recap generator, called, trips the same trap."""
    tripped = []
    from api.services import call_recap
    monkeypatch.setattr(call_recap, "get_call_recap_with_status",
                        lambda *a, **k: tripped.append("hit") or (None, "unavailable"))
    call_recap.get_call_recap_with_status("NVDA")
    assert tripped == ["hit"]


# ── the sandbox calendar is local-only ──────────────────────────────────────────────────

def test_the_sandbox_calendar_is_read_only_off_railway_with_the_conftest(monkeypatch, tmp_path):
    from api.services.journal_two import earnings_prep
    f = tmp_path / "cal.json"
    f.write_text(json.dumps({"reporters": {"NVDA": {"date": "2026-10-05", "timing": "amc"}}, "asOf": "x"}))
    monkeypatch.setenv(earnings_prep.SANDBOX_CALENDAR_ENV, str(f))
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    assert earnings_prep.sandbox_calendar_active() is True
    window, timing, partial, as_of = earnings_prep._window(__import__("datetime").date(2026, 10, 2))
    assert window == {"NVDA": "2026-10-05"} and timing == {"NVDA": "amc"} and as_of == "x"
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    assert earnings_prep.sandbox_calendar_active() is False
    monkeypatch.delenv("RAILWAY_ENVIRONMENT")
    monkeypatch.delitem(sys.modules, "conftest", raising=False)
    assert earnings_prep.sandbox_calendar_active() is False


# ── the member's own closed trade, made through the journal's own doors (fin walk P4) ────

def _journal_app(db_path):
    """The prep router beside the journal's own router, so a trade is opened and closed the
    way a member does it, never by a row written straight into the table."""
    from api.routers import journal_two, notebook_earnings_prep
    fa = FastAPI()
    fa.include_router(journal_two.router)
    fa.include_router(notebook_earnings_prep.router)
    return fa


def _open_and_close(c, sym, *, shares, close_shares, entry, exit_, day="2026-10-07"):
    r = c.post("/api/j2/positions", json={"symbol": sym, "side": "Long", "shares": shares, "entryPrice": entry,
                                          "stopPrice": round(entry * 0.95, 2), "entryDate": day})
    assert r.status_code == 200, r.text
    r2 = c.post(f"/api/j2/positions/{r.json()['id']}/close",
                json={"shares": close_shares, "exitPrice": exit_, "exitDate": day})
    assert r2.status_code == 200, r2.text
    return r2.json()["trade"]["id"]


def test_a_trade_closed_through_the_journal_is_in_a_prep_note_built_after_it(db_path, gate_on, monkeypatch, stores):
    """The walk's P4 case as the product sees it: AMD long, in at 341.28, out at 514.93 the same
    day, which is +50.9%. A prep note built AFTER the close lists it, and the result is the
    journal's FRACTION (0.509), the shape the note's own formatter prints as "+50.9%"."""
    _today(monkeypatch)
    _intel(monkeypatch, INTEL)
    fa = _journal_app(db_path)
    as_user(fa, A)
    c = TestClient(fa)
    tid = _open_and_close(c, "AMD", shares=40, close_shares=40, entry=341.28, exit_=514.93)
    d = c.post("/api/j2/earnings-prep/AMD/draft").json()
    cell = d["myTrades"]
    assert cell["missing"] is None and cell["source"] == "Your trade journal", cell
    assert [t["id"] for t in cell["value"]] == [tid]
    t = cell["value"][0]
    assert round(t["pnlPercent"], 3) == 0.509, t          # a fraction, never 50.9
    assert t["side"] == "Long" and t["result"] == "Win" and t["exitDate"].startswith("2026-10-07")
    assert d["myPosition"]["value"] is None                # fully closed: no open position line


def test_a_prep_note_built_before_the_close_has_no_trade_and_says_so(db_path, gate_on, monkeypatch, stores):
    """The order the walk actually ran in: the note was built while AMD was still open, and the
    trade closed 38 seconds later. The honest answer then is the open position and the plain
    "no closed trades" sentence. The note is frozen, so it never gains the trade afterwards."""
    _today(monkeypatch)
    _intel(monkeypatch, INTEL)
    fa = _journal_app(db_path)
    as_user(fa, A)
    c = TestClient(fa)
    r = c.post("/api/j2/positions", json={"symbol": "AMD", "side": "Long", "shares": 40, "entryPrice": 341.28,
                                          "stopPrice": 320.0, "entryDate": "2026-10-07"})
    assert r.status_code == 200, r.text
    d = c.post("/api/j2/earnings-prep/AMD/draft").json()
    assert d["myTrades"]["value"] is None
    assert d["myTrades"]["missing"] == "You have no closed trades in AMD in your journal."
    assert d["myPosition"]["value"][0]["shares"] == 40


def test_a_part_close_lists_the_trade_and_the_shares_still_held(db_path, gate_on, monkeypatch, stores):
    _today(monkeypatch)
    _intel(monkeypatch, INTEL)
    fa = _journal_app(db_path)
    as_user(fa, A)
    c = TestClient(fa)
    tid = _open_and_close(c, "AMD", shares=100, close_shares=40, entry=341.28, exit_=514.93)
    d = c.post("/api/j2/earnings-prep/AMD/draft").json()
    assert [t["id"] for t in d["myTrades"]["value"]] == [tid]
    assert d["myPosition"]["value"][0]["shares"] == 60


def test_a_trade_in_a_second_account_is_still_the_members_trade(db_path, gate_on, monkeypatch, stores):
    """The prep note reads the member's journal, not one account of it."""
    _today(monkeypatch)
    _intel(monkeypatch, INTEL)
    fa = _journal_app(db_path)
    as_user(fa, A)
    c = TestClient(fa)
    from api.services.journal_two import accounts
    accounts.get_or_migrate_default_account(A)
    second = accounts.create_account(A, {"name": "Second", "color": "blue", "startingBalance": 25000})
    r = c.post("/api/j2/positions", json={"symbol": "AMD", "side": "Long", "shares": 10, "entryPrice": 100.0,
                                          "stopPrice": 95.0, "entryDate": "2026-10-07", "accountId": second["id"]})
    assert r.status_code == 200, r.text
    r2 = c.post(f"/api/j2/positions/{r.json()['id']}/close", json={"shares": 10, "exitPrice": 110.0, "exitDate": "2026-10-07"})
    assert r2.status_code == 200, r2.text
    d = c.post("/api/j2/earnings-prep/AMD/draft").json()
    assert [t["id"] for t in d["myTrades"]["value"]] == [r2.json()["trade"]["id"]]
    assert round(d["myTrades"]["value"][0]["pnlPercent"], 3) == 0.1

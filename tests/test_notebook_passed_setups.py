"""Wave 13 lane 13G-1 -- the passed-setups journal (`api/services/journal_two/passed_setups.py`,
`api/routers/notebook_research_capture.py` passed_router).

What each section proves:
  * THE GATE: every passed-setups route answers the one 404 while
    `NOTEBOOK_PASSED_SETUPS_ENABLED` is off, signed in or not; a paid plan is required.
  * FORWARD RETURNS PINNED on fixture bars in a real (temp) bars.db: +1, +5, +10, +20 sessions
    and the best move within 20, from the reference close the one rule picks (16:00 ET).
  * MISSING BARS ARE LABELLED, never a number: no_bars, missing (SPY had the sessions, the
    symbol's bars are not stored), pending (the sessions have not happened), unknown.
  * FROZEN: a filled horizon and the reference never move when the bars are later revised.
  * TRADED LEAVES THE LIST: a position opened within 10 sessions (or held across the save).
  * CANDIDATES: scanner and Screener captures in the member's notes and their own watchlist
    adds (never a prebuilt list, never another member's), one row per name per day, idempotent.
  * The nightly job is a no-op while off; the account purge takes the member's rows; nothing
    is fetched over the network.
"""
from __future__ import annotations

import datetime as dt
import importlib
import json
import os
import sqlite3
import tempfile
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

FLAG = "NOTEBOOK_PASSED_SETUPS_ENABLED"
A, B = "user-ps-a", "user-ps-b"
PAID = {"plan": "pro"}
FREE = {"plan": "free"}
ET = dt.timezone(dt.timedelta(hours=-4))          # EDT across the fixture weeks (Aug-Sep 2026)


def _sessions(start: str, n: int) -> list[str]:
    """`n` weekdays from `start` (inclusive), as YYYY-MM-DD."""
    d = dt.date.fromisoformat(start)
    out = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


#: Fri 2026-08-07 is the reference session; the 25 sessions after it start Mon 08-10.
BASE_DAY = "2026-08-07"
DAYS = _sessions("2026-08-03", 30)          # 08-03 .. ; index of BASE_DAY is 4
AFTER = DAYS[DAYS.index(BASE_DAY) + 1:]


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


@pytest.fixture
def bars(monkeypatch, tmp_path):
    """A real, empty bars.db in a temp dir; `put(sym, [(day, close)...])` writes daily bars."""
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()

    def put(sym, rows, high_pad=0.5):
        c = bars_sqlite._conn()
        for day, close in rows:
            c.execute("INSERT OR REPLACE INTO ohlcv (ticker, tf, ts, o, h, l, c, v) VALUES (?,?,?,?,?,?,?,?)",
                      (sym, "D", int(day.replace("-", "")), close, close + high_pad, close - 1, close, 1000))
        c.commit()
    yield put
    bars_sqlite.bump_db_epoch()


@pytest.fixture
def gate_on(monkeypatch):
    monkeypatch.setenv(FLAG, "1")


@pytest.fixture
def app(db_path):
    from api.routers import notebook_research_capture as r
    fa = FastAPI()
    fa.include_router(r.passed_router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def as_user(app, user_id: str, plan: dict = PAID) -> None:
    user = {"id": user_id, "role": "member", **plan}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def _conn():
    from api.services import auth_db
    from api.services.journal_two import passed_setups as ps
    c = auth_db.get_connection()
    ps.ensure_schema(c)
    return c


def _at(day: str, hh: int, mm: int = 0) -> dt.datetime:
    y, m, d = map(int, day.split("-"))
    return dt.datetime(y, m, d, hh, mm, tzinfo=ET).astimezone(dt.timezone.utc)


def _rising(n: int = 25, start: float = 100.0):
    """The reference close 100 on BASE_DAY, then 101, 102, ... one a session."""
    return [(BASE_DAY, start)] + [(AFTER[i], start + i + 1) for i in range(n)]


def _row(user_id, symbol):
    c = _conn()
    try:
        return dict(c.execute("SELECT * FROM j2_passed_setups WHERE user_id = ? AND symbol = ?",
                              (user_id, symbol)).fetchone())
    finally:
        c.close()


def _refresh(user_id, now):
    from api.services.journal_two import passed_setups as ps
    return ps.refresh(user_id, now=now)


def _manual(user_id, sym, saved_on, now):
    from api.services.journal_two import passed_setups as ps
    return ps.add_manual(user_id, sym, saved_on, now=now)


NOW = _at("2026-09-25", 20)          # well past +20 sessions of the fixture saves


# ── the gate ────────────────────────────────────────────────────────────────────────────

ROUTES = [("get", "/api/j2/research-capture/passed-setups"),
          ("post", "/api/j2/research-capture/passed-setups"),
          ("delete", "/api/j2/research-capture/passed-setups/x")]


@pytest.mark.parametrize("method,path", ROUTES)
def test_every_route_is_404_while_the_gate_is_off_signed_in_or_not(client, app, monkeypatch, method, path):
    monkeypatch.delenv(FLAG, raising=False)
    kw = {"json": {}} if method == "post" else {}
    assert getattr(client, method)(path, **kw).status_code == 404
    as_user(app, A)
    assert getattr(client, method)(path, **kw).status_code == 404


def test_CONTROL_the_list_answers_once_the_gate_is_on(client, app, gate_on, bars):
    as_user(app, A)
    r = client.get("/api/j2/research-capture/passed-setups")
    assert r.status_code == 200 and r.json()["items"] == []


def test_a_free_plan_is_refused(client, app, gate_on, bars):
    as_user(app, A, FREE)
    assert client.get("/api/j2/research-capture/passed-setups").status_code == 402


# ── the reference close ─────────────────────────────────────────────────────────────────

def test_the_reference_rule_is_the_16_00_ET_close():
    from api.services.journal_two import passed_setups as ps
    assert ps.base_rule(_at("2026-08-10", 15, 59)) == ("2026-08-10", 20260809)   # before: prior session
    assert ps.base_rule(_at("2026-08-10", 16, 0)) == ("2026-08-10", 20260810)    # at the close: that day
    assert ps.base_rule(_at("2026-08-10", 9, 30)) == ("2026-08-10", 20260809)


# ── forward returns, pinned ─────────────────────────────────────────────────────────────

def test_forward_returns_are_pinned_on_fixture_bars(db_path, bars):
    bars("SPY", _rising())
    bars("NVDA", _rising())
    out = _manual(A, "NVDA", BASE_DAY, NOW)            # a past day is taken as after its close
    item = out["item"]
    assert item["baseDate"] == BASE_DAY and item["baseClose"] == 100.0 and item["status"] == "scored"
    got = {o["key"]: o["pct"] for o in item["outcomes"]}
    assert got == {"r1": 1.0, "r5": 5.0, "r10": 10.0, "r20": 20.0, "best20": 20.5}
    assert all(o["missing"] is None for o in item["outcomes"])


def test_a_save_before_the_close_is_measured_from_the_previous_session(db_path, bars):
    """A watchlist add at 14:00 ET on Mon 08-10: the reference is Fri 08-07's close."""
    bars("SPY", _rising())
    bars("AMD", _rising(start=50.0))
    c = _conn()
    wl = uuid.uuid4().hex
    c.execute("INSERT INTO watchlists (id, user_id, name) VALUES (?,?,?)", (wl, A, "Breakouts"))
    c.execute("INSERT INTO watchlist_items (id, watchlist_id, sym, added_at) VALUES (?,?,?,?)",
              (uuid.uuid4().hex, wl, "AMD", _at("2026-08-10", 14).strftime("%Y-%m-%d %H:%M:%S")))
    c.commit()
    c.close()
    _refresh(A, NOW)
    r = _row(A, "AMD")
    assert (r["source"], r["source_ref"], r["base_date"], r["base_close"]) == ("watchlist", "Breakouts", BASE_DAY, 50.0)
    assert (r["r1"], r["r5"]) == (2.0, 10.0)          # 51/50, 55/50


# ── missing bars are labelled ───────────────────────────────────────────────────────────

def _labels(item):
    return {o["key"]: (o["pct"], o["missing"]) for o in item["outcomes"]}


def test_no_stored_bars_is_labelled_no_bars(db_path, bars):
    bars("SPY", _rising())
    item = _manual(A, "ZZZZ", BASE_DAY, NOW)["item"]
    assert item["status"] == "no_bars" and item["noBarsLabel"]
    assert all(pct is None and miss == "no_bars" for pct, miss in _labels(item).values())


def test_a_gap_in_the_store_is_missing_and_a_session_not_yet_had_is_pending(db_path, bars):
    bars("SPY", _rising(n=7))                            # the market has had 7 sessions
    bars("NVDA", _rising(n=3))                           # the store holds 3 of NVDA's
    item = _manual(A, "NVDA", BASE_DAY, NOW)["item"]
    lab = _labels(item)
    assert lab["r1"] == (1.0, None)
    assert lab["r5"] == (None, "missing")               # SPY had 5 sessions; NVDA's bars are not stored
    assert lab["r10"] == (None, "pending")              # 10 sessions have not happened (per the store)
    assert lab["r20"] == (None, "pending") and lab["best20"] == (None, "pending")
    assert item["status"] == "pending"
    assert {o["key"]: o["label"] for o in item["outcomes"]}["r5"] == "Bars missing from the store"


def test_no_calendar_after_the_reference_is_unknown_not_pending(db_path, bars):
    bars("NVDA", _rising(n=0))                           # the reference bar only; no SPY at all
    item = _manual(A, "NVDA", BASE_DAY, NOW)["item"]
    assert {miss for _, miss in _labels(item).values()} == {"unknown"}


# ── frozen ──────────────────────────────────────────────────────────────────────────────

def test_a_filled_horizon_and_the_reference_never_move(db_path, bars):
    bars("SPY", _rising(n=7))
    bars("NVDA", _rising(n=3))
    _manual(A, "NVDA", BASE_DAY, NOW)
    first = _row(A, "NVDA")
    # The vendor revises history: the reference and the first sessions change, more arrive.
    bars("NVDA", [(BASE_DAY, 90.0)] + [(AFTER[i], 200.0 + i) for i in range(25)])
    bars("SPY", _rising())
    _refresh(A, NOW)
    after = _row(A, "NVDA")
    assert (after["base_close"], after["r1"]) == (first["base_close"], first["r1"]) == (100.0, 1.0)
    assert after["r5"] is not None and after["r5"] == round((204.0 / 100.0 - 1) * 100, 4)
    assert after["status"] == "scored"
    # A scored row is never re-scored.
    bars("NVDA", [(AFTER[i], 1.0) for i in range(25)])
    _refresh(A, NOW)
    assert _row(A, "NVDA")["r20"] == after["r20"]


# ── traded leaves the list ──────────────────────────────────────────────────────────────

def _position(user_id, sym, entry_date, closed_at=None):
    c = _conn()
    now = "2026-08-01T00:00:00+00:00"
    c.execute(
        "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, original_shares,"
        " entry_price, stop_price, context_at_entry, created_at, updated_at, closed_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (uuid.uuid4().hex, user_id, sym, "Long", entry_date, 10, 10, 100, 95, "{}", now, now, closed_at))
    c.commit()
    c.close()


def test_a_name_traded_within_10_sessions_leaves_the_list(db_path, bars, monkeypatch):
    bars("SPY", _rising())
    bars("NVDA", _rising())
    bars("AMD", _rising())
    _position(A, "NVDA", AFTER[9])                       # the 10th session after the reference
    _position(A, "AMD", AFTER[10])                       # the 11th: not "within 10" -- CONTROL
    _manual(A, "NVDA", BASE_DAY, NOW)
    _manual(A, "AMD", BASE_DAY, NOW)
    from api.services.journal_two import passed_setups as ps
    listed = ps.list_items(A)
    assert [i["symbol"] for i in listed["items"]] == ["AMD"] and listed["tradedCount"] == 1
    assert _row(A, "NVDA")["traded_on"] == AFTER[9]


def test_a_name_held_across_the_save_is_traded(db_path, bars):
    bars("SPY", _rising())
    bars("NVDA", _rising())
    _position(A, "NVDA", "2026-07-20")                   # opened before, still open
    _manual(A, "NVDA", BASE_DAY, NOW)
    assert _row(A, "NVDA")["status"] == "traded"


def test_a_traded_name_leaves_the_list_even_with_no_stored_bars(db_path, bars):
    """Traded is decided before bars are: a name with nothing in the store is still not a pass
    if the member traded it (found by the walk's own design review, 13G-1)."""
    bars("SPY", _rising())
    _position(A, "ZZZZ", AFTER[1])
    _manual(A, "ZZZZ", BASE_DAY, NOW)
    r = _row(A, "ZZZZ")
    assert (r["status"], r["traded_on"]) == ("traded", AFTER[1])


def test_another_members_trade_does_not_count(db_path, bars):
    bars("SPY", _rising())
    bars("NVDA", _rising())
    _position(B, "NVDA", AFTER[2])
    _manual(A, "NVDA", BASE_DAY, NOW)
    assert _row(A, "NVDA")["status"] == "scored"


# ── candidates ──────────────────────────────────────────────────────────────────────────

def _note_with_embeds(user_id, embeds):
    from api.services.journal_two import notes
    body = {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": a} for a in embeds]}
    return notes.create_note(user_id, {"title": "scan", "bodyJson": body})["id"]


def test_candidates_come_from_scan_captures_and_own_watchlists_only(db_path, bars):
    bars("SPY", _rising())
    for s in ("NVDA", "AMD", "PLTR", "TSLA", "META"):
        bars(s, _rising())
    when = _at("2026-08-10", 17).isoformat()
    _note_with_embeds(A, [
        {"widgetId": "scanner", "capturedAt": when,
         "params": {"scanKey": "gainers", "rows": [{"sym": "NVDA"}, {"sym": "AMD"}]}},
        {"widgetId": "screener", "capturedAt": when,
         "params": {"name": "Tight bases", "asOf": "x", "columns": [], "total": 2,
                    "rows": [{"ticker": "AMD"}, {"ticker": "PLTR"}]}},
        {"widgetId": "chart", "capturedAt": when, "params": {"symbol": "TSLA", "tf": "D"}},   # not a scan
    ])
    _note_with_embeds(B, [{"widgetId": "scanner", "capturedAt": when,
                           "params": {"scanKey": "x", "rows": [{"sym": "META"}]}}])
    c = _conn()
    mine, prebuilt, theirs = (uuid.uuid4().hex for _ in range(3))
    c.execute("INSERT INTO watchlists (id, user_id, name) VALUES (?,?,?)", (mine, A, "Mine"))
    c.execute("INSERT INTO watchlists (id, user_id, name, is_prebuilt) VALUES (?,?,?,1)", (prebuilt, A, "S&P 500"))
    c.execute("INSERT INTO watchlists (id, user_id, name) VALUES (?,?,?)", (theirs, B, "Theirs"))
    stamp = _at("2026-08-11", 17).strftime("%Y-%m-%d %H:%M:%S")
    for wl, sym in ((mine, "TSLA"), (prebuilt, "META"), (theirs, "META")):
        c.execute("INSERT INTO watchlist_items (id, watchlist_id, sym, added_at) VALUES (?,?,?,?)",
                  (uuid.uuid4().hex, wl, sym, stamp))
    c.commit()
    c.close()
    first = _refresh(A, NOW)
    c = _conn()
    rows = c.execute("SELECT symbol, source, saved_day FROM j2_passed_setups WHERE user_id = ?"
                     " ORDER BY symbol", (A,)).fetchall()
    c.close()
    # AMD is in two captures of the same day: ONE pass. META is a prebuilt list's / B's: absent.
    assert [tuple(r) for r in rows] == [("AMD", "scanner", "2026-08-10"), ("NVDA", "scanner", "2026-08-10"),
                                        ("PLTR", "scanner", "2026-08-10"), ("TSLA", "watchlist", "2026-08-11")]
    assert first["added"] == 4
    assert _refresh(A, NOW)["added"] == 0                 # idempotent


def test_a_save_older_than_the_lookback_is_not_collected(db_path, bars):
    _note_with_embeds(A, [{"widgetId": "scanner", "capturedAt": _at("2026-06-01", 17).isoformat(),
                           "params": {"scanKey": "x", "rows": [{"sym": "NVDA"}]}}])
    assert _refresh(A, NOW)["added"] == 0


# ── manual add, dismiss, the router ─────────────────────────────────────────────────────

def test_manual_add_refuses_a_future_or_too_old_day(db_path, bars):
    from api.services.journal_two import passed_setups as ps
    with pytest.raises(ps.PassedSetupError):
        _manual(A, "NVDA", "2026-09-26", NOW)
    with pytest.raises(ps.PassedSetupError):
        _manual(A, "NVDA", "2026-07-01", NOW)
    with pytest.raises(ps.PassedSetupError):
        _manual(A, "not a ticker!", None, NOW)


def test_the_router_lists_and_dismisses_only_the_members_own(client, app, gate_on, bars):
    bars("SPY", _rising())
    bars("NVDA", _rising())
    mine = _manual(A, "NVDA", BASE_DAY, NOW)["item"]["id"]
    theirs = _manual(B, "NVDA", BASE_DAY, NOW)["item"]["id"]
    as_user(app, A)
    body = client.get("/api/j2/research-capture/passed-setups").json()
    assert [i["id"] for i in body["items"]] == [mine]
    assert body["horizons"] == [1, 5, 10, 20] and body["tradedWithin"] == 10
    assert client.delete(f"/api/j2/research-capture/passed-setups/{theirs}").status_code == 404
    assert client.delete(f"/api/j2/research-capture/passed-setups/{mine}").status_code == 200
    assert client.get("/api/j2/research-capture/passed-setups").json()["items"] == []
    assert _row(B, "NVDA")["dismissed_at"] is None


def test_the_router_refuses_a_bad_symbol(client, app, gate_on, bars):
    as_user(app, A)
    r = client.post("/api/j2/research-capture/passed-setups", json={"symbol": "<script>"})
    assert r.status_code == 400


# ── the nightly job, the purge, no network ──────────────────────────────────────────────

def test_the_nightly_job_is_a_no_op_while_off_and_refreshes_when_on(db_path, bars, monkeypatch):
    bars("SPY", _rising(n=3))
    bars("NVDA", _rising(n=3))
    _manual(A, "NVDA", BASE_DAY, NOW)
    bars("SPY", _rising())
    bars("NVDA", _rising())
    from api.services.journal_two import passed_setups as ps
    monkeypatch.delenv(FLAG, raising=False)
    ps.nightly_job()
    assert _row(A, "NVDA")["r20"] is None
    monkeypatch.setenv(FLAG, "1")
    ps.nightly_job()
    assert _row(A, "NVDA")["r20"] == 20.0


def test_the_account_purge_takes_the_members_rows(db_path, bars):
    bars("SPY", _rising())
    _manual(A, "NVDA", BASE_DAY, NOW)
    _manual(B, "NVDA", BASE_DAY, NOW)
    from api.services import auth_db
    from api.services.journal_two import account_purge
    c = auth_db.get_connection()
    try:
        assert account_purge.purge_user_data(A, c)["ok"] is True
        users = {r[0] for r in c.execute("SELECT user_id FROM j2_passed_setups").fetchall()}
    finally:
        c.close()
    assert users == {B}


def test_nothing_is_fetched_over_the_network(db_path, bars, monkeypatch):
    import requests
    tripped = []

    def guarded(self, method, url, *a, **k):
        tripped.append(url)
        raise AssertionError("an HTTP request was made")
    monkeypatch.setattr(requests.Session, "request", guarded)
    bars("SPY", _rising())
    _manual(A, "NVDA", BASE_DAY, NOW)
    _refresh(A, NOW)
    assert tripped == []


# ── fin-security M-4 (this file's half): the scan-embed walk is a loop ───────────────────────
#
# `_walk_scan_embeds` called itself once per level of nesting, so a very deeply nested note
# body raised RecursionError and the member's passed-setups page answered 500. Lane SEC fixed
# the chart walkers the same way (`chart_blocks.iter_chart_attrs`); this mirrors that fix.

from api.services.journal_two import passed_setups as ps  # noqa: E402


def _scan_embed(sym):
    return {"type": "widgetEmbed", "attrs": {"widgetId": "scanner", "capturedAt": NOW.isoformat(),
                                             "params": {"rows": [{"sym": sym}]}}}


def test_the_scan_walk_reads_a_very_deep_body_without_recursing():
    node = _scan_embed("DEEP")
    for _ in range(5000):
        node = {"type": "blockquote", "content": [node]}
    doc = {"type": "doc", "content": [_scan_embed("FIRST"), node, _scan_embed("LAST")]}
    found = []
    ps._walk_scan_embeds(doc, found)
    assert [a["params"]["rows"][0]["sym"] for a in found] == ["FIRST", "DEEP", "LAST"]   # document order


def test_a_body_too_deep_to_parse_is_a_note_with_no_scan_never_an_error():
    depth = 60_000
    too_deep = '{"type":"doc","content":[' + '{"type":"blockquote","content":[' * depth + "]}" * depth + "]}"
    with pytest.raises(RecursionError):
        json.loads(too_deep)                         # the control: it really is too deep
    assert ps._parse_body(too_deep) is None
    assert ps._parse_body("{not json") is None
    assert ps._parse_body('{"type":"doc"}') == {"type": "doc"}


# ── fin-security I-3 (this file's part): a list view never writes ───────────────────────────
#
# `GET /passed-setups` ran `refresh` on every call: collect, then an UPDATE for each open row
# (up to 300) inside ONE transaction that also did the bars reads. A list view could hold
# auth.db's write lock, whose other writers wait only three seconds.

def _writes(seen):
    verbs = ("INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE", "DROP", "ALTER")
    return [s for s in seen if s.lstrip().upper().startswith(verbs)
            and "IF NOT EXISTS" not in s.upper()]


def test_the_list_route_runs_no_refresh_inside_the_request(db_path, monkeypatch):
    from fastapi import BackgroundTasks
    from api.routers import notebook_research_capture as rc
    ps._reset_refresh_clock()
    calls = []
    monkeypatch.setattr(ps, "refresh", lambda *a, **k: calls.append(a) or {"added": 0, "scored": 0})
    tasks = BackgroundTasks()
    body = rc.list_passed(tasks, user={"id": A, "plan": "pro"})
    assert calls == [], "the list view refreshed (wrote) before answering"
    assert body["items"] == [] and body["refreshQueued"] is True
    assert len(tasks.tasks) == 1                      # queued for AFTER the response

    again = BackgroundTasks()
    body = rc.list_passed(again, user={"id": A, "plan": "pro"})
    assert again.tasks == [] and body["refreshQueued"] is False, "a second view inside the interval queued another refresh"


def test_reading_the_list_issues_no_write_statement(db_path, bars):
    _manual(A, "NVDA", BASE_DAY, NOW)
    conn = _conn()
    seen = []
    conn.set_trace_callback(seen.append)
    try:
        out = ps.list_items(A, conn=conn)
        assert conn.in_transaction is False
    finally:
        conn.set_trace_callback(None)
        conn.close()
    assert len(out["items"]) == 1
    assert _writes(seen) == []


def test_refresh_if_stale_runs_at_most_once_per_interval_per_member(monkeypatch):
    ps._reset_refresh_clock()
    calls = []
    monkeypatch.setattr(ps, "refresh", lambda uid, **k: calls.append(uid) or {"added": 0, "scored": 0})
    t0 = 1_000_000.0
    assert ps.refresh_if_stale(A, clock=lambda: t0) is True
    assert ps.refresh_if_stale(A, clock=lambda: t0 + ps.REFRESH_MIN_INTERVAL_S - 1) is False
    assert ps.refresh_if_stale(B, clock=lambda: t0 + 1) is True              # per member
    assert ps.refresh_if_stale(A, clock=lambda: t0 + ps.REFRESH_MIN_INTERVAL_S) is True
    assert calls == [A, B, A]


def test_a_refresh_that_fails_does_not_block_the_next_one_and_never_raises(monkeypatch):
    ps._reset_refresh_clock()
    monkeypatch.setattr(ps, "refresh", lambda uid, **k: (_ for _ in ()).throw(RuntimeError("bars down")))
    assert ps.refresh_if_stale(A, clock=lambda: 5.0) is False
    monkeypatch.setattr(ps, "refresh", lambda uid, **k: {"added": 0, "scored": 0})
    assert ps.refresh_if_stale(A, clock=lambda: 6.0) is True


def test_the_refresh_commits_row_by_row_so_no_one_transaction_spans_every_row(db_path, bars, monkeypatch):
    for sym in ("NVDA", "AMD", "TSLA"):
        _manual(A, sym, BASE_DAY, NOW)
    conn = _conn()
    conn.execute("UPDATE j2_passed_setups SET status = 'pending'")
    conn.commit()
    open_during = []
    real = ps.score_row

    def spy(c, row):
        open_during.append(c.in_transaction)      # is a write transaction already open?
        return real(c, row)

    monkeypatch.setattr(ps, "score_row", spy)
    ps.refresh(A, conn=conn, now=NOW)
    conn.close()
    assert len(open_during) == 3 and not any(open_during), (
        "a row was scored while an earlier row's write was still uncommitted")

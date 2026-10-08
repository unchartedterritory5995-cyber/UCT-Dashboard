"""Wave 13 lane 13J -- the active setups board (`setups_board.py`, `GET /api/j2/setups-board`).

  * THE MATHS: distance to trigger in % and R, the state, the days in setup -- pinned on fixture
    numbers with the arithmetic beside each.
  * THE ORDER: closest to entry first; the invalidated, then the blind, last.
  * THE ONE READER: every level on a card comes from `plan_extract.read_note_plan`. Swapping that
    function moves every number on the card, so the board cannot be parsing a note itself.
  * WHICH NOTES: drawn levels only; open only (a plan 13A froze against a trade, a review note,
    a trashed or archived note are not on the board); one card per (note, symbol).
  * THE ROUTE: 404 while the flag is off (before the session), member-scoped.

No bars store, vendor or model is reachable: prices come from a stub.
"""
from __future__ import annotations

import importlib
import json
import os
import sqlite3
import tempfile
from pathlib import Path

import pytest

from api.services.journal_two import notes, plan_extract, setups_board
from api.services.journal_two.db import ensure_schema

REPO = Path(__file__).resolve().parents[1]
TODAY = "2026-10-02"


def _chart(symbol, levels, embed_id=None, tag=None):
    anns = [plan_extract.plan_annotation(role, price, {"id": f"d-{role}", "type": "horizontal"})
            for role, price in levels]
    attrs = {"v": 1, "widgetId": "chart", "params": {"symbol": symbol, "tf": "D", "to": None},
             "capturedAt": "2026-09-28T15:00:00Z", "embedId": embed_id or f"e-{symbol}",
             "mode": "live", "annotations": anns}
    if tag:
        attrs["ta"] = {"setupTag": tag}
    return {"type": "widgetEmbed", "attrs": attrs}


def _para(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def _doc(*nodes):
    return {"type": "doc", "content": [_para("plan"), *nodes]}


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


def _note(c, uid, title, body, created="2026-09-28T15:00:00Z", ticker=None, tags=None):
    payload = {"title": title, "bodyJson": body}
    if ticker:
        payload["ticker"] = ticker
    if tags:
        payload["tags"] = tags
    n = notes.create_note(uid, payload, conn=c)
    c.execute("UPDATE j2_notes SET created_at = ? WHERE id = ?", (created, n["id"]))
    c.commit()
    return n


def prices(table):
    def read(symbols):
        return {s: {"price": table[s], "source": "close", "asOf": "2026-10-01"} for s in symbols if s in table}
    return read


# ── the maths ─────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("entry,stop,price,want", [
    # long 105 / stop 100, price 102: gap 105-102 = 3; 3/102 = 2.94%; R = 3/5 = 0.6
    (105, 100, 102, {"side": "long", "state": "waiting", "gap": 3.0, "pct": 2.94, "r": 0.6}),
    # through the entry: gap 105-106 = -1; -1/106 = -0.94%; R = -1/5 = -0.2
    (105, 100, 106, {"side": "long", "state": "triggered", "gap": -1.0, "pct": -0.94, "r": -0.2}),
    # at the stop: invalidated (gap 5, 5/100 = 5%, R 1)
    (105, 100, 100, {"side": "long", "state": "invalidated", "gap": 5.0, "pct": 5.0, "r": 1.0}),
    # short 50 / stop 55, price 52: gap 52-50 = 2; 2/52 = 3.85%; R = 2/5 = 0.4
    (50, 55, 52, {"side": "short", "state": "waiting", "gap": 2.0, "pct": 3.85, "r": 0.4}),
    # short through the entry: gap 49-50 = -1; -1/49 = -2.04%; R -0.2
    (50, 55, 49, {"side": "short", "state": "triggered", "gap": -1.0, "pct": -2.04, "r": -0.2}),
    # short at 56, above the stop: invalidated; gap 6, 6/56 = 10.71%, R 1.2
    (50, 55, 56, {"side": "short", "state": "invalidated", "gap": 6.0, "pct": 10.71, "r": 1.2}),
    # a watch line, no stop: unsigned gap |20-19| = 1; 1/19 = 5.26%; no R
    (20, None, 19, {"side": None, "state": "watching", "gap": 1.0, "pct": 5.26, "r": None}),
    (20, 18, None, {"side": "long", "state": "no_price", "gap": None, "pct": None, "r": None}),
])
def test_distance_to_trigger_on_fixtures(entry, stop, price, want):
    assert setups_board.distance_to_trigger(entry, stop, price) == want


def test_days_in_setup_counts_et_calendar_days():
    assert setups_board.days_in_setup("2026-09-28T15:00:00Z", TODAY) == 4
    # 02:00 UTC on the 29th is 22:00 ET on the 28th: still four days.
    assert setups_board.days_in_setup("2026-09-29T02:00:00Z", TODAY) == 4
    assert setups_board.days_in_setup("2026-10-02T13:00:00Z", TODAY) == 0
    assert setups_board.days_in_setup(None, TODAY) is None


def test_the_sort_is_closeness_to_entry_then_the_broken_then_the_blind():
    cards = [
        {"symbol": "D", "noteId": "4", "state": "no_price", "distancePct": None},
        {"symbol": "C", "noteId": "3", "state": "invalidated", "distancePct": 0.5},
        {"symbol": "B", "noteId": "2", "state": "waiting", "distancePct": 4.0},
        {"symbol": "A", "noteId": "1", "state": "triggered", "distancePct": -1.0},
        {"symbol": "E", "noteId": "5", "state": "watching", "distancePct": 1.0},
        {"symbol": "F", "noteId": "6", "state": "waiting", "distancePct": 1.0},
    ]
    assert [c["symbol"] for c in sorted(cards, key=setups_board.sort_key)] == ["A", "E", "F", "B", "C", "D"]


def test_page_size_is_the_grids_own_cell_cap():
    src = (REPO / "app/src/pages/charts/grid/gridLayouts.js").read_text(encoding="utf-8")
    assert f"export const GRID_MAX_CELLS = {setups_board.PAGE_SIZE}" in src


# ── the board ─────────────────────────────────────────────────────────────────────────────────

def test_four_drawn_plans_are_cards_sorted_by_distance_with_days(conn):
    _note(conn, "u1", "NVDA breakout", _doc(_chart("NVDA", [("entry", 105), ("stop", 100), ("target", 120)])),
          created="2026-09-28T15:00:00Z")
    _note(conn, "u1", "AMD pullback", _doc(_chart("AMD", [("entry", 150), ("stop", 140)])),
          created="2026-09-30T15:00:00Z")
    _note(conn, "u1", "TSLA short", _doc(_chart("TSLA", [("entry", 200), ("stop", 210)])),
          created="2026-09-21T15:00:00Z")
    _note(conn, "u1", "META watch", _doc(_chart("META", [("entry", 700)])), created="2026-10-02T13:00:00Z")
    out = setups_board.build_cards(conn, "u1", today=TODAY,
                                   prices=prices({"NVDA": 102.0, "AMD": 149.0, "TSLA": 205.0, "META": 650.0}))
    # NVDA 3/102 = 2.94%; AMD 1/149 = 0.67%; TSLA (short) 5/205 = 2.44%; META |700-650|/650 = 7.69%
    got = [(c["symbol"], c["distancePct"], c["distanceR"], c["daysInSetup"], c["state"]) for c in out["cards"]]
    assert got == [("AMD", 0.67, 0.1, 2, "waiting"), ("TSLA", 2.44, 0.5, 11, "waiting"),
                   ("NVDA", 2.94, 0.6, 4, "waiting"), ("META", 7.69, None, 0, "watching")]
    nvda = next(c for c in out["cards"] if c["symbol"] == "NVDA")
    assert (nvda["entry"], nvda["stop"], nvda["target"], nvda["levelShape"]) == (105.0, 100.0, 120.0, "chart")
    assert out["pageSize"] == 16 and out["count"] == 4 and out["capped"] is False


def test_the_board_reads_levels_only_through_plan_extract(conn, monkeypatch):
    """Swap THE reader: every number on the card follows it. A board that parsed the note itself
    would keep printing 105/100 here."""
    _note(conn, "u1", "NVDA", _doc(_chart("NVDA", [("entry", 105), ("stop", 100)])))
    calls = []

    def fake(body, props, defs, symbol):
        calls.append(symbol)
        return plan_extract.PlanReading(roles={
            "entry": plan_extract.RoleReading(plan_extract.STATE_OK, 77.0, "chart"),
            "stop": plan_extract.RoleReading(plan_extract.STATE_OK, 70.0, "chart"),
            "target": plan_extract.RoleReading(plan_extract.STATE_OK, 99.0, "chart"),
        }, setup="Fake")
    monkeypatch.setattr(plan_extract, "read_note_plan", fake)
    out = setups_board.build_cards(conn, "u1", today=TODAY, prices=prices({"NVDA": 70.0 + 0.0}))
    c = out["cards"][0]
    assert calls == ["NVDA"]
    assert (c["entry"], c["stop"], c["target"], c["setupTag"]) == (77.0, 70.0, 99.0, "Fake")
    assert c["state"] == "invalidated"            # 70 is AT the fake stop -- the fake's numbers
    # And the module holds no level parsing of its own: no annotation, role or regex read.
    src = (REPO / "api/services/journal_two/setups_board.py").read_text(encoding="utf-8")
    code = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("#"))
    body = code.split('"""', 2)[2]                # past the module docstring
    for needle in ('"annotations"', "'annotations'", '"role"', "'role'", "import re", '"levels"'):
        assert needle not in body, needle


def test_only_drawn_open_live_notes_are_on_the_board(conn):
    keep = _note(conn, "u1", "keep", _doc(_chart("NVDA", [("entry", 105), ("stop", 100)])))
    # levels written as TEXT beside a chart with no roles: not drawn
    _note(conn, "u1", "text only", _doc(_para("Entry: 50"), _para("Stop: 45"), _chart("AAPL", [])))
    # a plan review of a graded trade
    _note(conn, "u1", "review", _doc(_chart("MSFT", [("entry", 400), ("stop", 390)])), tags=["plan-review"])
    trashed = _note(conn, "u1", "trashed", _doc(_chart("AMZN", [("entry", 180), ("stop", 170)])))
    notes.delete_note("u1", trashed["id"], conn=conn)
    arch = _note(conn, "u1", "archived", _doc(_chart("GOOG", [("entry", 160), ("stop", 150)])))
    conn.execute("UPDATE j2_notes SET archived_at = '2026-10-01T00:00:00Z' WHERE id = ?", (arch["id"],))
    # a plan 13A already froze against a trade
    done = _note(conn, "u1", "done", _doc(_chart("CRM", [("entry", 250), ("stop", 240)])))
    conn.execute("INSERT INTO j2_trade_plan_links (user_id, trade_ref, symbol, source_kind, match_tier,"
                 " note_id, plan_json, matched_at) VALUES ('u1','ext:1','CRM','note','window',?,'{}','x')",
                 (done["id"],))
    # another member's plan
    _note(conn, "u2", "theirs", _doc(_chart("ORCL", [("entry", 300), ("stop", 290)])))
    conn.commit()
    out = setups_board.build_cards(conn, "u1", today=TODAY, prices=prices({}))
    assert [(c["noteId"], c["symbol"], c["state"]) for c in out["cards"]] == [(keep["id"], "NVDA", "no_price")]


def test_one_card_per_note_and_symbol_and_the_tagged_block_is_offered(conn):
    n = _note(conn, "u1", "two names", _doc(_chart("NVDA", [("entry", 105), ("stop", 100)], tag="VCP"),
                                            _chart("AMD", [("entry", 150), ("stop", 140)])))
    out = setups_board.build_cards(conn, "u1", today=TODAY, prices=prices({"NVDA": 104.0, "AMD": 140.5}))
    by = {c["symbol"]: c for c in out["cards"]}
    assert set(by) == {"NVDA", "AMD"} and {c["noteId"] for c in out["cards"]} == {n["id"]}
    assert by["NVDA"]["entry"] == 105.0 and by["AMD"]["entry"] == 150.0       # never crossed over
    assert by["NVDA"]["similarEmbedKey"] == "e-NVDA" and by["AMD"]["similarEmbedKey"] is None


def test_the_scan_is_capped_and_says_so(conn):
    for i in range(3):
        _note(conn, "u1", f"n{i}", _doc(_chart("NVDA", [("entry", 105), ("stop", 100)], embed_id=f"e{i}")))
    out = setups_board.build_cards(conn, "u1", today=TODAY, prices=prices({}), cap=2)
    assert out["scanned"] == 2 and out["capped"] is True and out["count"] == 2


def test_the_board_never_writes_a_note(conn):
    n = _note(conn, "u1", "a", _doc(_chart("NVDA", [("entry", 105), ("stop", 100)])))
    before = dict(conn.execute("SELECT body_json, updated_at FROM j2_notes WHERE id = ?", (n["id"],)).fetchone())
    setups_board.build_cards(conn, "u1", today=TODAY, prices=prices({"NVDA": 100.5}))
    after = dict(conn.execute("SELECT body_json, updated_at FROM j2_notes WHERE id = ?", (n["id"],)).fetchone())
    assert before == after


# ── the route ─────────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI                                 # noqa: E402
from fastapi.testclient import TestClient                   # noqa: E402

from api.middleware import auth_middleware as authmw        # noqa: E402


@pytest.fixture
def client(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    c = auth_db.get_connection()
    ensure_schema(c)
    c.close()
    monkeypatch.setattr(setups_board, "read_prices", prices({"NVDA": 102.0}))
    from api.routers import notebook_setups_board
    app = FastAPI()
    app.include_router(notebook_setups_board.router)
    tc = TestClient(app)
    tc.app_ = app
    yield tc
    app.dependency_overrides.clear()
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


def as_user(client, uid, plan="pro"):
    # A paid member by default: the board takes a paid plan (owner ruling 2026-10-02, I-7).
    user = {"id": uid, "role": "member", "plan": plan}
    client.app_.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    client.app_.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def test_the_board_route_needs_a_paid_plan(client, monkeypatch):
    monkeypatch.setenv(setups_board.FLAG, "1")
    as_user(client, "m1", plan="free")
    r = client.get("/api/j2/setups-board")
    assert r.status_code == 402 and "paid plan" in r.json()["detail"]


def test_the_board_route_is_404_while_off_even_signed_out(client, monkeypatch):
    monkeypatch.delenv(setups_board.FLAG, raising=False)
    assert client.get("/api/j2/setups-board").status_code == 404
    monkeypatch.setenv(setups_board.FLAG, "0")
    assert client.get("/api/j2/setups-board").status_code == 404


def test_the_board_route_serves_the_member_their_own_cards(client, monkeypatch):
    monkeypatch.setenv(setups_board.FLAG, "1")
    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        notes.create_note("m1", {"title": "NVDA", "bodyJson": _doc(_chart("NVDA", [("entry", 105), ("stop", 100)]))},
                          conn=c)
    finally:
        c.close()
    as_user(client, "m1")
    r = client.get("/api/j2/setups-board")
    assert r.status_code == 200
    body = r.json()
    assert [(x["symbol"], x["distancePct"], x["distanceR"]) for x in body["cards"]] == [("NVDA", 2.94, 0.6)]
    as_user(client, "m2")
    assert client.get("/api/j2/setups-board").json()["count"] == 0


# ── fin walk P7: the board says whether a plan can be drawn at all ──────────────────────────

def test_the_board_says_drawing_a_plan_is_unavailable_while_chart_plan_is_off(conn, monkeypatch):
    """The empty board tells the member to draw an entry line on a chart in a plan note. That
    is the chart plan panel. With it switched off the instruction points at nothing, so the
    payload says so and the client can word the empty state honestly."""
    monkeypatch.delenv("NOTEBOOK_CHART_PLAN_ENABLED", raising=False)
    out = setups_board.build_cards(conn, "u1", today=TODAY, prices=prices({}))
    assert out["count"] == 0
    assert out["planDrawing"] == {
        "available": False, "reason": "chart_plan_off",
        "sentence": "Drawing a plan on a chart is switched off, so no new setup can be added here yet.",
    }


def test_the_board_says_drawing_is_available_while_chart_plan_is_on(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_CHART_PLAN_ENABLED", "1")
    out = setups_board.build_cards(conn, "u1", today=TODAY, prices=prices({}))
    assert out["planDrawing"] == {"available": True, "reason": None, "sentence": None}

"""Filtered CSV/JSON trade export — GET /api/j2/trades/export (P3 Task A11).

Route-level via FastAPI TestClient (mirrors test_filters.py's `route_client`),
because the observable is the DOWNLOAD RESPONSE: the attachment header, the
Content-Type, and the SAME FilterSpec-filtered row set the on-screen list uses
(export == what's on screen).

Coverage:
  - format=csv&setups=VCP → text/csv, header row + only the VCP rows, correct
    Content-Disposition attachment filename.
  - CSV mistakeTags/emotionTags semicolon-joined; a member with a literal comma
    is safely quoted by the stdlib csv module (no fragile hand-joining).
  - format=json → application/json, the full filtered `list_trades_for_user`
    row list (dicts).
  - unknown format → 422.
  - route ordering: /trades/export resolves to the export handler, NOT the
    dynamic /trades/{trade_id} route.
"""
import csv
import io
import json
import re
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.journal_two import db as j2db


# NOTE: j2_trades has NOT NULL columns beyond the brief's sketch (pnl_dollar/
# pnl_percent/hold_days/result/context_at_entry) — supplied so the INSERT
# satisfies the live schema. mistake_tags/emotion_tags are TEXT JSON arrays.
def _insert(conn, tid, sym, side, setup, day, *, mistake=None, emotion=None):
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,"
        " entry_price, entry_date, exit_price, exit_date, original_stop,"
        " pnl_dollar, pnl_percent, hold_days, result, context_at_entry,"
        " created_at, setup, trading_day_et, mistake_tags, emotion_tags) VALUES"
        " (?, 'u1', 'p', ?, ?, 10, 100, ?, 110, ?, 95,"
        " 100, 10, 1, 'Win', '{}', '2026-01-01', ?, ?, ?, ?)",
        (tid, sym, side, day, day + "T15:00:00Z", setup, day, mistake, emotion),
    )


@pytest.fixture
def route_client(monkeypatch, tmp_path):
    """Minimal app mounting the real journal_two router, with get_current_user
    overridden and the service DB pointed at a seeded temp file."""
    from api.services import auth_db
    from api.middleware.auth_middleware import get_current_user
    from api.routers import journal_two

    db_path = str(tmp_path / "j2_export.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    _insert(conn, "t1", "NVDA", "Long", "VCP", "2026-04-19",
            mistake='["fomo","broke,rule"]', emotion='["calm"]')
    _insert(conn, "t2", "TSLA", "Short", "PEG", "2026-04-20")
    _insert(conn, "t3", "NVAX", "Long", "VCP", "2026-04-21")
    conn.commit()
    conn.close()

    # get_connection() reads the module-global _DB_PATH at call time.
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)

    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1"}
    return TestClient(app)


# ── CSV export ────────────────────────────────────────────────────────────────

def test_csv_export_filters_to_scope(route_client):
    r = route_client.get("/api/j2/trades/export?format=csv&setups=VCP")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    # Attachment filename: uct-journal-trades-YYYY-MM-DD.csv
    cd = r.headers["content-disposition"]
    assert cd.startswith('attachment; filename="uct-journal-trades-')
    assert re.search(r'uct-journal-trades-\d{4}-\d{2}-\d{2}\.csv"$', cd)

    rows = list(csv.reader(io.StringIO(r.text)))
    # Header row first + exactly the two VCP trades (t3 newest-entry first).
    assert rows[0] == [
        "symbol", "side", "entryDate", "entryTime", "exitDate", "exitTime",
        "shares", "entryPrice", "exitPrice", "pnlDollarNet", "rMultiple",
        "setup", "mistakeTags", "emotionTags", "source",
    ]
    data = rows[1:]
    symbols = [row[0] for row in data]
    assert symbols == ["NVAX", "NVDA"]  # both VCP, newest entry_date first
    assert "TSLA" not in symbols  # PEG filtered out


def test_csv_semicolon_join_and_safe_quoting(route_client):
    r = route_client.get("/api/j2/trades/export?format=csv&symbol=NVDA")
    assert r.status_code == 200
    rows = list(csv.reader(io.StringIO(r.text)))
    header, nvda = rows[0], rows[1]
    m_idx = header.index("mistakeTags")
    e_idx = header.index("emotionTags")
    # Semicolon-joined; the comma inside "broke,rule" survives (csv quoted it).
    assert nvda[m_idx] == "fomo;broke,rule"
    assert nvda[e_idx] == "calm"
    # The raw wire quotes the comma-bearing field (proves safe csv quoting).
    assert '"fomo;broke,rule"' in r.text


# ── JSON export ───────────────────────────────────────────────────────────────

def test_json_export_returns_row_list(route_client):
    r = route_client.get("/api/j2/trades/export?format=json")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    cd = r.headers["content-disposition"]
    assert re.search(r'uct-journal-trades-\d{4}-\d{2}-\d{2}\.json"$', cd)
    body = json.loads(r.text)
    assert isinstance(body, list)
    # Full unfiltered set (all 3), newest entry_date first, as row dicts.
    assert [t["symbol"] for t in body] == ["NVAX", "TSLA", "NVDA"]
    assert body[0]["setup"] == "VCP"


def test_json_export_honors_filter(route_client):
    r = route_client.get("/api/j2/trades/export?format=json&sides=Short")
    assert r.status_code == 200
    body = json.loads(r.text)
    assert [t["symbol"] for t in body] == ["TSLA"]


# ── errors + routing ──────────────────────────────────────────────────────────

def test_unknown_format_is_422(route_client):
    r = route_client.get("/api/j2/trades/export?format=xml")
    assert r.status_code == 422


def test_export_route_registered_before_dynamic_detail():
    """/trades/export must be a distinct static route, not swallowed by the
    dynamic /trades/{trade_id} route."""
    from api.routers.journal_two import router

    paths = [r.path for r in router.routes]
    assert "/api/j2/trades/export" in paths
    assert "/api/j2/trades/{trade_id}" in paths
    # The static export route is registered BEFORE the dynamic detail route.
    assert paths.index("/api/j2/trades/export") < paths.index(
        "/api/j2/trades/{trade_id}"
    )

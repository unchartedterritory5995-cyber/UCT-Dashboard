"""Your trading year (P2 Tier 3, Task 7): `wrapped.year_wrapped` and GET /api/j2/wrapped/{year}.

R-T3-9: best setups are `playbook_stats`' own expectancy R, top 3, each with its trade count and
`sample_size`'s band (R-T3-V5: too_few | thin | normal; a too_few setup cannot be ranked, so it only
fills a slot the ranked setups leave open). Tickers count a live note once per symbol over its
`ticker` and its `j2_note_mentions` rows. Discipline is twelve months; a month with trades and no
adherence record reads None. Lessons are the year's rule versions, newest first.
`available` is False for the current ET year before December 1, and for a year with no closed trade.

The route lives in its own router (R-T3-T7-R1, api/routers/notebook_wrapped.py): 404 with
JOURNAL_TIER3_ENABLED off (before the session or the plan), 401 signed out, 402 with its OWN
sentence, 400 for a year outside 2000 .. the current ET year.

The clock is pinned by patching the module's imported `et_today`, as test_interventions does.
"""
from __future__ import annotations

import importlib
import json
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services.journal_two import playbook_stats
from api.services.journal_two import wrapped

URL = "/api/j2/wrapped"
NOW = datetime.now(timezone.utc).isoformat()


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    c = sqlite3.connect(tmp.name)
    for uid in ("u1", "u2"):
        c.execute("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'pw')", (uid, f"{uid}@x.com"))
    c.commit()
    c.close()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def conn(db_path):
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    yield c
    c.close()


@pytest.fixture(autouse=True)
def pinned_clock(monkeypatch):
    """Default: mid-October 2026, so 2025 is a finished year and 2026 is not yet open."""
    monkeypatch.setattr(wrapped, "et_today", lambda: "2026-10-17")


# ── helpers ──────────────────────────────────────────────────────────────────

def _account(conn, user_id="u1"):
    aid = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO j2_accounts (id, user_id, name, color, broker, starting_balance,
               account_size, default_stop, position_closing, breakeven_range, setups,
               share_journal_data, created_at, updated_at)
           VALUES (?, ?, ?, 'blue', NULL, 100000, 100000, '{"mode":"custom"}', 'FIFO',
                   '{"enabled":false,"unit":"$","value":0}', '[]', 0, ?, ?)""",
        (aid, user_id, f"Account {aid[:8]}", NOW, NOW))
    conn.commit()
    return aid


def _trade(conn, aid, day, *, r=1.0, setup="VCP", user_id="u1", exit_iso=None, excluded=False):
    """A closed equity trade on ET day `day` (YYYY-MM-DD)."""
    tid = str(uuid.uuid4())
    exit_iso = exit_iso or f"{day}T18:00:00Z"
    pnl = 100.0 * r
    conn.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price,
               entry_date, exit_price, exit_date, original_stop, setup, notes, pnl_dollar,
               pnl_percent, r_multiple, hold_days, result, context_at_entry, account_id,
               created_at, trading_day_et, analytics_excluded)
           VALUES (?, ?, 'manual', 'NVDA', 'Long', 100, 500, ?, 510, ?, 490, ?, NULL, ?, 0.02, ?, 1,
                   ?, '{}', ?, ?, ?, ?)""",
        (tid, user_id, exit_iso, exit_iso, setup, pnl, r, "Win" if pnl > 0 else "Loss", aid,
         exit_iso, day, 1 if excluded else 0))
    conn.commit()
    return tid


def _adherence(conn, tid, pct, user_id="u1"):
    conn.execute(
        "INSERT OR REPLACE INTO j2_trade_adherence (user_id, trade_ref, setup, checked_rule_ids,"
        " total_rules, adherence_pct, updated_at) VALUES (?, ?, 'VCP', '[]', 4, ?, ?)",
        (user_id, f"id:{tid}", pct, NOW))
    conn.commit()


def _note(conn, *, created, ticker=None, mentions=(), aid=None, user_id="u1", trashed=False, archived=False):
    nid = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO j2_notes (id, user_id, account_id, title, ticker, created_at, updated_at,"
        " deleted_at, archived_at) VALUES (?, ?, ?, 'n', ?, ?, ?, ?, ?)",
        (nid, user_id, aid, ticker, created, created, NOW if trashed else None, NOW if archived else None))
    for sym in mentions:
        conn.execute("INSERT INTO j2_note_mentions (note_id, user_id, symbol, created_at) VALUES (?, ?, ?, ?)",
                     (nid, user_id, sym, created))
    conn.commit()
    return nid


def _rule(conn, aid, label, *, user_id="u1", status="active", created="2025-01-01T12:00:00Z"):
    rid = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO j2_journal_rules (id, user_id, account_id, label, status, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)", (rid, user_id, aid, label, status, created, created))
    conn.commit()
    return rid


def _version(conn, rid, version, label, changed_at, note=None, user_id="u1"):
    conn.execute(
        "INSERT INTO j2_journal_rule_versions (id, user_id, rule_id, version, label, evidence, changed_at,"
        " change_note) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
        (uuid.uuid4().hex, user_id, rid, version, label, changed_at, note))
    conn.commit()


def _setup_trades(conn, aid, setup, rs, *, month=3, user_id="u1"):
    for i, r in enumerate(rs):
        _trade(conn, aid, f"2025-{month:02d}-{(i % 27) + 1:02d}", r=r, setup=setup, user_id=user_id)


# ── 1. best setups ───────────────────────────────────────────────────────────

def test_the_top_three_setups_by_expectancy_with_counts_and_bands(conn):
    aid = _account(conn)
    _setup_trades(conn, aid, "A", [2.0] * 12)          # thin, best ranked
    _setup_trades(conn, aid, "B", [1.0] * 10)          # thin
    _setup_trades(conn, aid, "C", [0.5] * 30)          # normal
    _setup_trades(conn, aid, "D", [-0.5] * 11)         # thin, ranked fourth: off the list
    _trade(conn, aid, "2024-06-03", r=50.0, setup="C")  # the year before: never counted
    out = wrapped.year_wrapped(conn, "u1", 2025, None)
    assert out["available"] is True and out["year"] == 2025 and out["tradeCount"] == 63
    assert out["bestSetups"] == [
        {"setup": "A", "tradeCount": 12, "expectancyR": 2.0, "sample": "thin"},
        {"setup": "B", "tradeCount": 10, "expectancyR": 1.0, "sample": "thin"},
        {"setup": "C", "tradeCount": 30, "expectancyR": 0.5, "sample": "normal"},
    ]


def test_a_four_trade_setup_reads_too_few_and_is_not_ranked_above_a_sampled_one(conn):
    aid = _account(conn)
    _setup_trades(conn, aid, "A", [2.0] * 12)
    _setup_trades(conn, aid, "B", [5.0] * 4)           # the best expectancy, but too few to rank
    _setup_trades(conn, aid, "C", [1.0] * 10)
    best = wrapped.year_wrapped(conn, "u1", 2025, None)["bestSetups"]
    assert [(b["setup"], b["sample"]) for b in best] == [("A", "thin"), ("C", "thin"), ("B", "too_few")]
    assert best[2]["tradeCount"] == 4


def test_expectancy_is_playbook_stats_own_number_never_recomputed(conn, monkeypatch):
    aid = _account(conn)
    _setup_trades(conn, aid, "A", [2.0] * 12)
    real = playbook_stats.get_playbook_stats

    def doctored(*a, **k):
        recs = real(*a, **k)
        for r in recs:
            r["expectancyR"] = 9.25
        return recs

    monkeypatch.setattr(playbook_stats, "get_playbook_stats", doctored)
    assert wrapped.year_wrapped(conn, "u1", 2025, None)["bestSetups"][0]["expectancyR"] == 9.25


# ── 2. tickers ───────────────────────────────────────────────────────────────

def test_a_note_counts_once_per_symbol_and_trashed_and_archived_notes_count_nowhere(conn):
    aid = _account(conn)
    _trade(conn, aid, "2025-03-03")
    _note(conn, created="2025-02-01T15:00:00Z", ticker="NVDA", mentions=["NVDA"])  # $NVDA twice + ticker
    _note(conn, created="2025-03-01T15:00:00Z", mentions=["NVDA", "AMD"])
    _note(conn, created="2025-04-01T15:00:00Z", ticker="nvda")
    _note(conn, created="2025-05-01T15:00:00Z", ticker="NVDA", trashed=True)
    _note(conn, created="2025-05-02T15:00:00Z", mentions=["NVDA", "AMD"], archived=True)
    _note(conn, created="2024-12-30T15:00:00Z", ticker="NVDA")                      # the year before
    _note(conn, created="2025-06-01T15:00:00Z", ticker="NVDA", user_id="u2")         # another member
    assert wrapped.year_wrapped(conn, "u1", 2025, None)["tickers"] == [
        {"symbol": "NVDA", "noteCount": 3}, {"symbol": "AMD", "noteCount": 1}]


def test_a_note_is_in_the_year_of_its_et_day_and_the_list_stops_at_five(conn):
    aid = _account(conn)
    _trade(conn, aid, "2025-03-03")
    _note(conn, created="2026-01-01T03:00:00Z", ticker="LATE")   # 2025-12-31 22:00 ET
    _note(conn, created="2025-01-01T03:00:00Z", ticker="EARLY")  # 2024-12-31 22:00 ET: not this year
    for sym in ("AAA", "BBB", "CCC", "DDD", "EEE"):
        _note(conn, created="2025-07-01T15:00:00Z", ticker=sym)
        _note(conn, created="2025-07-02T15:00:00Z", ticker=sym)
    tickers = wrapped.year_wrapped(conn, "u1", 2025, None)["tickers"]
    assert [t["symbol"] for t in tickers] == ["AAA", "BBB", "CCC", "DDD", "EEE"]
    _note(conn, created="2025-07-03T15:00:00Z", ticker="LATE")
    _note(conn, created="2025-07-04T15:00:00Z", ticker="LATE")
    tickers = wrapped.year_wrapped(conn, "u1", 2025, None)["tickers"]
    assert tickers[0] == {"symbol": "LATE", "noteCount": 3} and len(tickers) == 5
    assert "EARLY" not in [t["symbol"] for t in tickers]


# ── 3. discipline ────────────────────────────────────────────────────────────

def test_twelve_months_and_a_month_without_adherence_reads_none_with_its_trade_count(conn):
    aid = _account(conn)
    t1 = _trade(conn, aid, "2025-03-04")
    t2 = _trade(conn, aid, "2025-03-05")
    _adherence(conn, t1, 0.5)
    _adherence(conn, t2, 1.0)
    april = [_trade(conn, aid, f"2025-04-0{d}") for d in (1, 2, 3)]
    _adherence(conn, april[0], 1.0, user_id="u2")       # another member's row on the same ref
    _trade(conn, aid, "2025-12-31", exit_iso="2026-01-01T03:00:00Z")  # the ET day decides
    disc = wrapped.year_wrapped(conn, "u1", 2025, None)["discipline"]
    assert [d["month"] for d in disc] == [f"2025-{m:02d}" for m in range(1, 13)]
    by = {d["month"]: d for d in disc}
    assert by["2025-03"] == {"month": "2025-03", "adherence": 0.75, "tradeCount": 2}
    assert by["2025-04"] == {"month": "2025-04", "adherence": None, "tradeCount": 3}
    assert by["2025-01"] == {"month": "2025-01", "adherence": None, "tradeCount": 0}
    assert by["2025-12"]["tradeCount"] == 1


def test_an_analytics_excluded_trade_counts_nowhere(conn):
    aid = _account(conn)
    _trade(conn, aid, "2025-03-04")
    _trade(conn, aid, "2025-03-05", excluded=True)
    out = wrapped.year_wrapped(conn, "u1", 2025, None)
    assert out["tradeCount"] == 1
    assert {d["month"]: d["tradeCount"] for d in out["discipline"]}["2025-03"] == 1


# ── 4. lessons ───────────────────────────────────────────────────────────────

def test_three_versions_in_the_year_and_one_before_read_three_newest_first(conn):
    aid = _account(conn)
    _trade(conn, aid, "2025-03-03")
    r1 = _rule(conn, aid, "Wait for the open")
    r2 = _rule(conn, aid, "No adds to losers")
    _version(conn, r1, 1, "Wait for the open", "2024-12-15T15:00:00Z")
    _version(conn, r1, 2, "Wait 15 minutes after the open", "2025-02-01T15:00:00Z", note="too early")
    _version(conn, r1, 3, "Wait 30 minutes after the open", "2025-06-01T15:00:00Z", note="still early")
    _version(conn, r2, 1, "No adds to losers", "2025-09-01T15:00:00Z")
    lessons = wrapped.year_wrapped(conn, "u1", 2025, None)["lessons"]
    assert lessons == [
        {"ruleId": r2, "label": "No adds to losers", "version": 1, "changeNote": None,
         "changedAt": "2025-09-01T15:00:00Z"},
        {"ruleId": r1, "label": "Wait 30 minutes after the open", "version": 3, "changeNote": "still early",
         "changedAt": "2025-06-01T15:00:00Z"},
        {"ruleId": r1, "label": "Wait 15 minutes after the open", "version": 2, "changeNote": "too early",
         "changedAt": "2025-02-01T15:00:00Z"},
    ]


def test_dismissed_rules_and_other_members_rules_teach_nothing_and_a_legacy_rule_reads_its_v1(conn):
    aid = _account(conn)
    _trade(conn, aid, "2025-03-03")
    gone = _rule(conn, aid, "Gone", status="dismissed")
    _version(conn, gone, 1, "Gone", "2025-03-01T15:00:00Z")
    other_aid = _account(conn, user_id="u2")
    theirs = _rule(conn, other_aid, "Theirs", user_id="u2")
    _version(conn, theirs, 1, "Theirs", "2025-03-01T15:00:00Z", user_id="u2")
    legacy = _rule(conn, aid, "Made before versions", created="2025-05-05T15:00:00Z")   # no version row
    _rule(conn, aid, "Older legacy", created="2024-05-05T15:00:00Z")
    lessons = wrapped.year_wrapped(conn, "u1", 2025, None)["lessons"]
    assert lessons == [{"ruleId": legacy, "label": "Made before versions", "version": 1,
                        "changeNote": None, "changedAt": "2025-05-05T15:00:00Z"}]
    assert conn.execute("SELECT COUNT(*) FROM j2_journal_rule_versions WHERE rule_id = ?",
                        (legacy,)).fetchone()[0] == 0          # the read wrote nothing


# ── 5. available ─────────────────────────────────────────────────────────────

def _full_year(conn, aid, year, user_id="u1"):
    _trade(conn, aid, f"{year}-03-03", user_id=user_id)
    _note(conn, created=f"{year}-03-03T15:00:00Z", ticker="NVDA", aid=aid, user_id=user_id)
    rid = _rule(conn, aid, "Rule", created=f"{year}-03-03T15:00:00Z", user_id=user_id)
    _version(conn, rid, 1, "Rule", f"{year}-03-03T15:00:00Z", user_id=user_id)


def test_the_current_year_is_not_ready_before_december_and_is_in_december(conn, monkeypatch):
    aid = _account(conn)
    _full_year(conn, aid, 2026)
    monkeypatch.setattr(wrapped, "et_today", lambda: "2026-11-30")
    out = wrapped.year_wrapped(conn, "u1", 2026, None)
    assert out == {"year": 2026, "tradeCount": 1, "bestSetups": [], "tickers": [], "discipline": [],
                   "lessons": [], "available": False}
    monkeypatch.setattr(wrapped, "et_today", lambda: "2026-12-01")
    out = wrapped.year_wrapped(conn, "u1", 2026, None)
    assert out["available"] is True and len(out["discipline"]) == 12
    assert out["tickers"] == [{"symbol": "NVDA", "noteCount": 1}] and len(out["lessons"]) == 1


def test_a_year_with_no_closed_trade_is_not_available_and_its_arrays_are_empty(conn):
    aid = _account(conn)
    _note(conn, created="2025-03-03T15:00:00Z", ticker="NVDA")
    rid = _rule(conn, aid, "Rule")
    _version(conn, rid, 1, "Rule", "2025-03-03T15:00:00Z")
    out = wrapped.year_wrapped(conn, "u1", 2025, None)
    assert out["available"] is False and out["tradeCount"] == 0
    assert out["tickers"] == out["lessons"] == out["discipline"] == out["bestSetups"] == []


# ── 6. account scope, 7. isolation ───────────────────────────────────────────

def test_the_account_scope_is_honoured_in_every_section(conn):
    a, b = _account(conn), _account(conn)
    _setup_trades(conn, a, "A", [1.0] * 10)
    _setup_trades(conn, b, "B", [2.0] * 10)
    _note(conn, created="2025-03-03T15:00:00Z", ticker="AAA", aid=a)
    _note(conn, created="2025-03-03T15:00:00Z", ticker="BBB", aid=b)
    ra = _rule(conn, a, "Rule A")
    _version(conn, ra, 1, "Rule A", "2025-03-03T15:00:00Z")
    rb = _rule(conn, b, "Rule B")
    _version(conn, rb, 1, "Rule B", "2025-03-04T15:00:00Z")
    out = wrapped.year_wrapped(conn, "u1", 2025, a)
    assert out["tradeCount"] == 10
    assert [s["setup"] for s in out["bestSetups"]] == ["A"]
    assert out["tickers"] == [{"symbol": "AAA", "noteCount": 1}]
    assert [l["ruleId"] for l in out["lessons"]] == [ra]
    every = wrapped.year_wrapped(conn, "u1", 2025, None)            # All Accounts: both
    assert every["tradeCount"] == 20 and len(every["lessons"]) == 2 and len(every["tickers"]) == 2


def test_another_members_rows_are_never_read_and_their_account_id_reads_nothing(conn):
    mine = _account(conn)
    _trade(conn, mine, "2025-03-03", setup="Mine")
    other = _account(conn, user_id="u2")
    _full_year(conn, other, 2025, user_id="u2")
    for _ in range(11):
        _trade(conn, other, "2025-04-04", setup="Theirs", user_id="u2")
    _note(conn, created="2025-03-03T15:00:00Z", mentions=["ZZZ"], aid=other, user_id="u2")
    rows = conn.execute("SELECT id FROM j2_trades WHERE user_id = 'u2'").fetchall()
    for r in rows:
        _adherence(conn, r["id"], 1.0, user_id="u2")
    assert wrapped.year_wrapped(conn, "u2", 2025, other)["tradeCount"] == 12   # control: u2 sees it
    out = wrapped.year_wrapped(conn, "u1", 2025, None)
    assert out["tradeCount"] == 1 and [s["setup"] for s in out["bestSetups"]] == ["Mine"]
    assert out["tickers"] == [] and out["lessons"] == []
    assert all(d["adherence"] is None for d in out["discipline"])
    named = wrapped.year_wrapped(conn, "u1", 2025, other)
    assert (named["tradeCount"], named["available"]) == (0, False)
    # Even with u1's own trade in scope, u2's notes and rules on that account id stay invisible.
    conn.execute("UPDATE j2_trades SET account_id = ? WHERE user_id = 'u1'", (other,))
    conn.commit()
    named = wrapped.year_wrapped(conn, "u1", 2025, other)
    assert named["available"] is True and named["tickers"] == [] and named["lessons"] == []


# ── 8. the route ─────────────────────────────────────────────────────────────

@pytest.fixture
def client(db_path, monkeypatch):
    monkeypatch.setenv(wrapped.FLAG, "1")
    from api.routers import notebook_wrapped
    app = FastAPI()
    app.include_router(notebook_wrapped.router)
    c = TestClient(app)
    c.app_ref = app
    yield c
    app.dependency_overrides.clear()


def _as(client, uid="u1", plan="pro"):
    user = {"id": uid, "role": "member", "plan": plan}
    client.app_ref.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    client.app_ref.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def test_the_route_answers_the_year_for_a_paid_member(client, conn):
    aid = _account(conn)
    _full_year(conn, aid, 2025)
    _as(client)
    r = client.get(f"{URL}/2025", params={"account_id": aid})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"year", "tradeCount", "bestSetups", "tickers", "discipline", "lessons", "available"}
    assert body["available"] is True and body["tradeCount"] == 1
    assert client.get(f"{URL}/2025").json()["tradeCount"] == 1        # All Accounts


def test_switch_off_is_the_one_404_before_the_session_or_the_plan(client, monkeypatch):
    _as(client)
    assert client.get(f"{URL}/2025").status_code == 200               # control: the route exists
    monkeypatch.setenv(wrapped.FLAG, "0")
    r = client.get(f"{URL}/2025")
    assert (r.status_code, r.json()) == (404, {"detail": "Not found"})
    _as(client, plan="free")
    assert client.get(f"{URL}/2025").status_code == 404
    client.app_ref.dependency_overrides.clear()
    monkeypatch.delenv(wrapped.FLAG, raising=False)
    assert client.get(f"{URL}/2025").status_code == 404               # signed out, unset: not a 401


def test_signed_out_is_401_and_an_unpaid_member_is_402_with_its_own_sentence(client):
    assert client.get(f"{URL}/2025").status_code == 401
    _as(client, plan="free")
    r = client.get(f"{URL}/2025")
    assert r.status_code == 402 and r.json()["detail"] == "Your trading year requires a paid plan"


def test_a_year_outside_2000_to_the_current_et_year_is_a_400(client, monkeypatch):
    _as(client)
    for year in (1999, 2027):
        r = client.get(f"{URL}/{year}")
        assert (r.status_code, r.json()) == (400, {"detail": "That year isn't available."}), year
    assert client.get(f"{URL}/2000").status_code == 200
    assert client.get(f"{URL}/2026").status_code == 200
    monkeypatch.setattr(wrapped, "et_today", lambda: "2027-01-01")     # the ET year moves the edge
    assert client.get(f"{URL}/2027").status_code == 200
    assert client.get(f"{URL}/abc").status_code == 422


def test_an_overlong_account_id_is_refused(client):
    _as(client)
    assert client.get(f"{URL}/2025", params={"account_id": "x" * 129}).status_code == 422


def test_journal_two_has_no_wrapped_route_and_keeps_its_ask_sentence(db_path):
    """R-T3-T7-R1: the route lives in its own router; journal_two's require_paid is untouched."""
    from fastapi import HTTPException
    from api.routers import journal_two
    with pytest.raises(HTTPException) as e:
        journal_two.require_paid({"id": "u1", "role": "member", "plan": "free"})
    assert (e.value.status_code, e.value.detail) == (402, "Notebook Ask requires a paid plan")
    assert not any(getattr(r, "path", "").startswith("/api/j2/wrapped") for r in journal_two.router.routes)


def test_the_switch_is_read_per_request(monkeypatch):
    monkeypatch.delenv(wrapped.FLAG, raising=False)
    assert wrapped.enabled() is False
    monkeypatch.setenv(wrapped.FLAG, "true")
    assert wrapped.enabled() is True

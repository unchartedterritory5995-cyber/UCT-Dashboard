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
    pnl = 100.0 * (1.0 if r is None else r)
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
        {"setup": "A", "tradeCount": 12, "expectancyR": 2.0, "sample": "thin", "sampleN": 12},
        {"setup": "B", "tradeCount": 10, "expectancyR": 1.0, "sample": "thin", "sampleN": 10},
        {"setup": "C", "tradeCount": 30, "expectancyR": 0.5, "sample": "normal", "sampleN": 30},
    ]


def test_a_four_trade_setup_reads_too_few_and_is_not_ranked_above_a_sampled_one(conn):
    aid = _account(conn)
    _setup_trades(conn, aid, "A", [2.0] * 12)
    _setup_trades(conn, aid, "B", [5.0] * 4)           # the best expectancy, but too few to rank
    _setup_trades(conn, aid, "C", [1.0] * 10)
    best = wrapped.year_wrapped(conn, "u1", 2025, None)["bestSetups"]
    assert [(b["setup"], b["sample"]) for b in best] == [("A", "thin"), ("C", "thin"), ("B", "too_few")]
    assert best[2]["tradeCount"] == 4


def test_the_band_follows_the_r_bearing_trades_so_two_r_values_in_thirty_cannot_rank_first(conn):
    """R-T3-T7-R5: expectancyR rests on the trades that carry an R, so its band is theirs."""
    aid = _account(conn)
    _setup_trades(conn, aid, "EP", [4.0, 4.0] + [None] * 28)    # 30 trades, 2 with an R
    _setup_trades(conn, aid, "VCP", [1.2] * 25)                  # 25 trades, all with an R
    best = wrapped.year_wrapped(conn, "u1", 2025, None)["bestSetups"]
    assert best == [
        {"setup": "VCP", "tradeCount": 25, "expectancyR": 1.2, "sample": "normal", "sampleN": 25},
        {"setup": "EP", "tradeCount": 30, "expectancyR": 4.0, "sample": "too_few", "sampleN": 2},
    ]


def test_an_expectancy_tie_goes_to_the_larger_r_bearing_count_not_the_larger_trade_count(conn):
    """N3: the tie-break follows the n the expectancy rests on (sampleN), like the band."""
    aid = _account(conn)
    _setup_trades(conn, aid, "X", [1.0] * 10 + [None] * 10)     # 20 trades, 10 with an R
    _setup_trades(conn, aid, "Y", [1.0] * 15)                   # 15 trades, 15 with an R
    best = wrapped.year_wrapped(conn, "u1", 2025, None)["bestSetups"]
    assert [(b["setup"], b["tradeCount"], b["sampleN"]) for b in best] == [("Y", 15, 15), ("X", 20, 10)]


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


def test_a_sample_notebook_note_is_never_a_note_the_member_wrote(conn):
    """fin-data I3: the sample's example notes name real tickers; they count nowhere."""
    from api.services.journal_two import sample_marker
    aid = _account(conn)
    _trade(conn, aid, "2025-03-03")
    sample = _note(conn, created="2025-02-01T15:00:00Z", ticker="NVDA", mentions=["AAPL"])
    conn.execute("UPDATE j2_notes SET import_source = ? WHERE id = ?", (sample_marker.SAMPLE_SOURCE, sample))
    _note(conn, created="2025-02-02T15:00:00Z", ticker="MSFT")                     # control: the member's own
    conn.commit()
    assert wrapped.year_wrapped(conn, "u1", 2025, None)["tickers"] == [{"symbol": "MSFT", "noteCount": 1}]
    conn.execute("UPDATE j2_notes SET import_source = 'file' WHERE id = ?", (sample,))  # same note, imported
    conn.commit()
    assert {t["symbol"] for t in wrapped.year_wrapped(conn, "u1", 2025, None)["tickers"]} == {"NVDA", "AAPL", "MSFT"}


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
    """R-T3-T7-R3: not in tradeCount, not in discipline, and not in bestSetups."""
    aid = _account(conn)
    for d in range(1, 11):
        _trade(conn, aid, f"2025-03-{d:02d}", r=1.0, setup="VCP")
    _trade(conn, aid, "2025-03-20", r=-9.0, setup="VCP", excluded=True)
    out = wrapped.year_wrapped(conn, "u1", 2025, None)
    assert out["tradeCount"] == 10
    assert {d["month"]: d["tradeCount"] for d in out["discipline"]}["2025-03"] == 10
    assert out["bestSetups"] == [{"setup": "VCP", "tradeCount": 10, "expectancyR": 1.0, "sample": "thin",
                                  "sampleN": 10}]
    assert sum(s["tradeCount"] for s in out["bestSetups"]) <= out["tradeCount"]


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
         "changedAt": "2025-09-01T15:00:00Z", "changedDay": "2025-09-01"},
        {"ruleId": r1, "label": "Wait 30 minutes after the open", "version": 3, "changeNote": "still early",
         "changedAt": "2025-06-01T15:00:00Z", "changedDay": "2025-06-01"},
        {"ruleId": r1, "label": "Wait 15 minutes after the open", "version": 2, "changeNote": "too early",
         "changedAt": "2025-02-01T15:00:00Z", "changedDay": "2025-02-01"},
    ]


def test_a_lesson_carries_the_et_day_that_put_it_in_the_year(conn):
    """Fix round 1, M4: 2026-01-01T01:30Z is 20:30 ET on Dec 31 2025, so it is a 2025 lesson and
    its day is 2025-12-31, never the UTC 2026-01-01."""
    aid = _account(conn)
    _trade(conn, aid, "2025-03-03")
    rid = _rule(conn, aid, "Rule")
    _version(conn, rid, 2, "Rule, edited late", "2026-01-01T01:30:00Z")
    lessons = wrapped.year_wrapped(conn, "u1", 2025, None)["lessons"]
    assert [(l["changedAt"], l["changedDay"]) for l in lessons] == [("2026-01-01T01:30:00Z", "2025-12-31")]


def test_lessons_stop_at_the_newest_twelve(conn):
    """R-T3-7: at most 12, newest first."""
    aid = _account(conn)
    _trade(conn, aid, "2025-03-03")
    rid = _rule(conn, aid, "Rule")
    for v in range(1, 14):                    # 13 versions, the 5th and 15th of Jan..Jul, in order
        _version(conn, rid, v, f"Rule v{v}", f"2025-{(v - 1) // 2 + 1:02d}-{(1 - v % 2) * 10 + 5:02d}T15:00:00Z")
    lessons = wrapped.year_wrapped(conn, "u1", 2025, None)["lessons"]
    assert wrapped.TOP_LESSONS == 12
    assert [l["version"] for l in lessons] == list(range(13, 1, -1))


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
                        "changeNote": None, "changedAt": "2025-05-05T15:00:00Z",
                        "changedDay": "2025-05-05"}]
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
    assert out == {"year": 2026, "tradeCount": 1, "bestSetups": [], "tickers": [], "tickersScope": "all",
                   "discipline": [], "lessons": [], "available": False, "unavailableReason": "not_ready"}
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
    assert out["unavailableReason"] == "no_trades"


# R-T3-T8-R3: the four corners of `unavailableReason`. The clock is the pinned ET day.
def test_corner_current_year_before_december_with_no_trades_is_not_ready(conn, monkeypatch):
    _account(conn)
    monkeypatch.setattr(wrapped, "et_today", lambda: "2026-11-30")
    out = wrapped.year_wrapped(conn, "u1", 2026, None)
    assert (out["available"], out["tradeCount"], out["unavailableReason"]) == (False, 0, "not_ready")


def test_corner_current_year_before_december_with_trades_is_not_ready(conn, monkeypatch):
    aid = _account(conn)
    _trade(conn, aid, "2026-03-03")
    _trade(conn, aid, "2026-04-04")
    monkeypatch.setattr(wrapped, "et_today", lambda: "2026-10-17")
    out = wrapped.year_wrapped(conn, "u1", 2026, None)
    assert (out["available"], out["tradeCount"], out["unavailableReason"]) == (False, 2, "not_ready")


def test_corner_a_past_year_with_no_trades_is_no_trades(conn, monkeypatch):
    aid = _account(conn)
    _trade(conn, aid, "2026-03-03")                                    # trades elsewhere: control
    monkeypatch.setattr(wrapped, "et_today", lambda: "2026-10-17")
    out = wrapped.year_wrapped(conn, "u1", 2024, None)
    assert (out["available"], out["tradeCount"], out["unavailableReason"]) == (False, 0, "no_trades")


def test_corner_current_year_in_december_with_no_trades_is_no_trades(conn, monkeypatch):
    _account(conn)
    monkeypatch.setattr(wrapped, "et_today", lambda: "2026-12-01")
    out = wrapped.year_wrapped(conn, "u1", 2026, None)
    assert (out["available"], out["tradeCount"], out["unavailableReason"]) == (False, 0, "no_trades")


def test_an_available_year_carries_no_unavailable_reason(conn):
    aid = _account(conn)
    _trade(conn, aid, "2025-03-03")
    out = wrapped.year_wrapped(conn, "u1", 2025, None)
    assert out["available"] is True and "unavailableReason" not in out


# ── 6. account scope, 7. isolation ───────────────────────────────────────────

def test_the_account_scope_is_honoured_in_every_section(conn):
    a, b = _account(conn), _account(conn)
    _setup_trades(conn, a, "A", [1.0] * 10)
    _setup_trades(conn, b, "B", [2.0] * 10)
    # Real notes carry no account (notes.create_note: payload accountId is never sent).
    _note(conn, created="2025-03-03T15:00:00Z", ticker="AAA")
    _note(conn, created="2025-03-03T15:00:00Z", ticker="BBB")
    ra = _rule(conn, a, "Rule A")
    _version(conn, ra, 1, "Rule A", "2025-03-03T15:00:00Z")
    rb = _rule(conn, b, "Rule B")
    _version(conn, rb, 1, "Rule B", "2025-03-04T15:00:00Z")
    out = wrapped.year_wrapped(conn, "u1", 2025, a)
    assert out["tradeCount"] == 10
    assert [s["setup"] for s in out["bestSetups"]] == ["A"]
    # R-T3-T7-R4: tickers are member-wide whatever the picker says, and the payload says so.
    assert out["tickers"] == [{"symbol": "AAA", "noteCount": 1}, {"symbol": "BBB", "noteCount": 1}]
    assert out["tickersScope"] == "all"
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
    assert set(body) == {"year", "tradeCount", "bestSetups", "tickers", "tickersScope", "discipline",
                         "lessons", "available"}
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


def test_the_pickers_all_accounts_value_means_no_account(client, conn):
    """R-T3-T7-R6: '_all_' (and empty) read as All Accounts, never as an account id."""
    a, b = _account(conn), _account(conn)
    _trade(conn, a, "2025-03-03")
    _trade(conn, b, "2025-03-04")
    _as(client)
    assert client.get(f"{URL}/2025", params={"account_id": a}).json()["tradeCount"] == 1  # control
    for value in ("_all_", ""):
        body = client.get(f"{URL}/2025", params={"account_id": value}).json()
        assert (body["tradeCount"], body["available"]) == (2, True), value


def test_the_one_all_accounts_helper_beside_the_sentinel():
    """N2: unified_coach.plain_account_id is the only copy; the routers and review_drafts import it."""
    from api.routers import notebook_winners_checklist, notebook_wrapped
    from api.services.journal_two import review_drafts, unified_coach
    f = unified_coach.plain_account_id
    assert [f(None), f(""), f(unified_coach.UNIFIED_ACCOUNT_ID), f("acct-1")] == [None, None, None, "acct-1"]
    assert notebook_wrapped.plain_account_id is f
    assert notebook_winners_checklist.plain_account_id is f
    assert review_drafts.plain_account_id is f and not hasattr(review_drafts, "_plain_account_id")


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


# ── 9. the years the page can open (Task 8, R-T3-V6) ─────────────────────────

def test_years_are_the_years_with_an_included_closed_trade_newest_first(conn):
    aid = _account(conn)
    _trade(conn, aid, "2023-05-05")
    _trade(conn, aid, "2025-03-03")
    _trade(conn, aid, "2025-07-07")                                    # two in one year: listed once
    _trade(conn, aid, "2024-12-31", exit_iso="2025-01-01T03:00:00Z")   # the ET day decides: 2024
    assert wrapped.years_with_trades(conn, "u1", None) == [2025, 2024, 2023]


def test_years_leave_out_an_excluded_trade_and_a_year_the_page_would_refuse(conn):
    aid = _account(conn)
    _trade(conn, aid, "2025-03-03")
    _trade(conn, aid, "2022-03-03", excluded=True)                     # analytics-excluded: no year
    _trade(conn, aid, "1999-03-03")                                    # before MIN_YEAR: a 400 page
    _trade(conn, aid, "2027-03-03")                                    # after the ET year: a 400 page
    assert wrapped.years_with_trades(conn, "u1", None) == [2025]
    conn.execute("UPDATE j2_trades SET analytics_excluded = 0")        # control: the rule is the filter
    conn.commit()
    assert wrapped.years_with_trades(conn, "u1", None) == [2025, 2022]


def test_years_honour_the_account_and_never_read_another_member(conn):
    a, b = _account(conn), _account(conn)
    _trade(conn, a, "2024-03-03")
    _trade(conn, b, "2025-03-03")
    other = _account(conn, user_id="u2")
    _trade(conn, other, "2021-03-03", user_id="u2")
    assert wrapped.years_with_trades(conn, "u2", None) == [2021]       # control: u2 sees its own
    assert wrapped.years_with_trades(conn, "u1", None) == [2025, 2024]
    assert wrapped.years_with_trades(conn, "u1", a) == [2024]
    assert wrapped.years_with_trades(conn, "u1", b) == [2025]
    assert wrapped.years_with_trades(conn, "u1", other) == []          # their account id reads nothing


def test_years_are_empty_with_no_trades_and_a_note_alone_opens_no_year(conn):
    _account(conn)
    _note(conn, created="2025-03-03T15:00:00Z", ticker="NVDA")
    assert wrapped.years_with_trades(conn, "u1", None) == []


def test_years_is_reached_and_not_swallowed_by_the_year_route(client, conn):
    """R-T3-T7-R1: `/years` is declared above `/{year}`. Declared below, `/{year}` takes the
    segment "years" and answers 422, so this rail is red the moment the order flips."""
    aid = _account(conn)
    _trade(conn, aid, "2024-03-03")
    _trade(conn, aid, "2025-03-03")
    _as(client)
    r = client.get(f"{URL}/years")
    assert (r.status_code, r.json()) == (200, {"years": [2025, 2024]})
    assert client.get(f"{URL}/years", params={"account_id": aid}).json() == {"years": [2025, 2024]}
    assert client.get(f"{URL}/years", params={"account_id": "_all_"}).json() == {"years": [2025, 2024]}
    assert client.get(f"{URL}/2025").status_code == 200                # control: the year route still answers


def test_years_takes_the_same_switch_paid_gate_and_account_bound(client, monkeypatch):
    assert client.get(f"{URL}/years").status_code == 401
    _as(client, plan="free")
    r = client.get(f"{URL}/years")
    assert r.status_code == 402 and r.json()["detail"] == "Your trading year requires a paid plan"
    _as(client)
    assert client.get(f"{URL}/years").json() == {"years": []}
    assert client.get(f"{URL}/years", params={"account_id": "x" * 129}).status_code == 422
    monkeypatch.setenv(wrapped.FLAG, "0")
    assert (client.get(f"{URL}/years").status_code, client.get(f"{URL}/years").json()) == (404, {"detail": "Not found"})


def test_the_door_and_the_server_open_the_current_year_on_the_same_day():
    """Task 8: the Report page door decides "from December 1 ET" with lib/wrappedLink.js's OPENS_ON.
    ONE fact in two files, so this reads the client file rather than restating the date."""
    import re
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "app" / "src" / "pages" / "journal-2-0" / "lib"
           / "wrappedLink.js").read_text(encoding="utf-8")
    found = re.findall(r"^export const OPENS_ON = '(\d\d-\d\d)'$", src, flags=re.M)
    assert len(found) == 1, found                  # non-vacuity: the client declares it exactly once
    assert found[0] == wrapped.OPENS_ON


def _wrapped_link_const(name):
    import re
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "app" / "src" / "pages" / "journal-2-0" / "lib"
           / "wrappedLink.js").read_text(encoding="utf-8")
    found = re.findall(rf'^export const {name} = "([^"]*)"$', src, flags=re.M)
    assert len(found) == 1, (name, found)
    return found[0]


def test_the_page_and_the_server_share_the_year_refusal_sentence():
    """Fix round 1, M8: the page shows this for a year it never asks about (not four digits) and
    for a 400 or 422, so the client holds the server's sentence; this reads it from the file."""
    assert _wrapped_link_const("YEAR_UNAVAILABLE") == wrapped.YEAR_UNAVAILABLE_SENTENCE


def test_the_door_encodes_all_accounts_with_the_servers_own_sentinel():
    """Fix round 1, I1: a door link says `?account_id=<sentinel>` for All Accounts, and the route's
    `plain_account_id` must read that value as no account."""
    from api.services.journal_two import unified_coach
    sentinel = _wrapped_link_const("ALL_ACCOUNTS_PARAM")
    assert sentinel == unified_coach.UNIFIED_ACCOUNT_ID
    assert unified_coach.plain_account_id(sentinel) is None


def test_the_switch_is_read_per_request(monkeypatch):
    monkeypatch.delenv(wrapped.FLAG, raising=False)
    assert wrapped.enabled() is False
    monkeypatch.setenv(wrapped.FLAG, "true")
    assert wrapped.enabled() is True

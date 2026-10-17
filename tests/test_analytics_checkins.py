"""The "By check-in" psychology view (P2 Tier 3, Task 5): `psychology.checkIns` in the analytics
payload, built by `analytics._checkin_section(conn, user_id, rows, ...)`.

R-T3-3: a check-in counts for the ET day in its `day` param. Several check-ins on one day take
the mean, rounded HALF UP to a whole level (ruling R-T3-T5-R1: never Python's `round()`, which
rounds half to even). Trades join on `trading_day_et`; a trade without one is `unjoined`.
R-T3-V3: trash and restore leave the sidecar alone, so a trashed note's check-in is excluded by
the `j2_notes.deleted_at IS NULL` join and counts again once the note is restored.
R-T3-T5-R2: a level with no trades reads `avgPnl: None` and `winRate: None`, never 0.

⛔ ONE FACT IN TWO FILES: `analytics.MOOD_WORDS` / `FOCUS_WORDS` and the client's
`lib/blocks/checkinWords.js`. The client's words are read by RUNNING that module through Node,
the way `test_journal_styles_store.py` reads `journalBlocks.js`, never retyped here.
"""
from __future__ import annotations

import importlib
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
CLIENT_WORDS = REPO / "app" / "src" / "pages" / "journal-2-0" / "lib" / "blocks" / "checkinWords.js"


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    c = sqlite3.connect(tmp.name)
    c.row_factory = sqlite3.Row
    for uid in ("u1", "u2"):
        c.execute("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'pw')",
                  (uid, f"{uid}@x.com"))
    c.commit()
    yield c
    c.close()
    os.unlink(tmp.name)


# ── helpers ──────────────────────────────────────────────────────────────────

def _account(conn, user_id="u1"):
    aid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO j2_accounts (id, user_id, name, color, broker, starting_balance,
               account_size, default_stop, position_closing, breakeven_range, setups,
               share_journal_data, created_at, updated_at)
           VALUES (?, ?, 'Default', 'blue', NULL, 100000, 100000, '{"mode":"custom"}', 'FIFO',
                   '{"enabled":false,"unit":"$","value":0}', '[]', 0, ?, ?)""",
        (aid, user_id, now, now))
    conn.commit()
    return aid


def _trade(conn, aid, day, *, pnl=100.0, fees=0.0, result="Win", user_id="u1",
           exit_iso=None, emotion_tags=None):
    """A closed equity trade. `day` is its trading_day_et (None for an unjoinable row); the exit
    stamp defaults to that day so the analytics date spine sees the same day."""
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    exit_iso = exit_iso or (f"{day}T18:00:00Z" if day else "2026-10-14T18:00:00Z")
    conn.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price,
               entry_date, exit_price, exit_date, original_stop, setup, notes, pnl_dollar,
               pnl_percent, r_multiple, hold_days, result, context_at_entry, account_id,
               created_at, trading_day_et, hour_et, fees, emotion_tags)
           VALUES (?, ?, 'manual', 'NVDA', 'Long', 100, 500, ?, 510, ?, 490, 'VCP', NULL, ?,
                   0.02, 1.5, 1, ?, '{}', ?, ?, ?, NULL, ?, ?)""",
        (tid, user_id, exit_iso, exit_iso, pnl, result, aid, now, day, fees,
         json.dumps(emotion_tags) if emotion_tags else None))
    conn.commit()
    return tid


def _checkin(mood="", focus="", day="", embed_id=None):
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "moodCheckIn", "embedId": embed_id or uuid.uuid4().hex,
        "mode": "snapshot", "params": {"mood": mood, "focus": focus, "day": day},
        "searchText": "[mood and focus check-in]",
    }}


def _note(conn, *nodes, user_id="u1", title="Day"):
    from api.services.journal_two import notes as svc
    n = svc.create_note(user_id, {"title": title, "bodyJson": {"type": "doc", "content": list(nodes)}},
                        conn=conn)
    conn.commit()
    return n


def _checkins(conn, aid, user_id="u1", **kw):
    from api.services.journal_two.analytics import get_analytics
    return get_analytics(user_id, account_id=aid, conn=conn, **kw)["psychology"]["checkIns"]


def _level(section, dim, level):
    rows = [r for r in section[dim] if r["level"] == level]
    assert len(rows) == 1, (dim, level, section[dim])
    return rows[0]


def _populated(section, dim):
    return {r["level"]: (r["days"], r["tradeCount"]) for r in section[dim] if r["days"] or r["tradeCount"]}


# ── 1. two check-ins on one day take the rounded mean ────────────────────────

def test_two_checkins_one_day_take_the_rounded_mean(conn):
    """Mood 2 and mood 5 on one day: the mean 3.5 rounds HALF UP, so the day reads 4 (Review
    Focus 3). The day's trade lands in level 4 and nowhere else."""
    aid = _account(conn)
    _note(conn, _checkin(mood="2", day="2026-10-14"), title="Morning")
    _note(conn, _checkin(mood="5", day="2026-10-14"), title="Plan")
    _trade(conn, aid, "2026-10-14", pnl=120.0)
    s = _checkins(conn, aid)
    assert s["checkInDays"] == 1
    assert _populated(s, "mood") == {4: (1, 1)}
    four = _level(s, "mood", 4)
    assert four["avgPnl"] == 120.0 and four["winRate"] == 1.0
    # No focus was picked on either check-in: the focus side has the day nowhere.
    assert _populated(s, "focus") == {}


def test_a_two_and_three_day_rounds_half_up_to_three_not_half_to_even(conn):
    """Ruling R-T3-T5-R1. Python's round(2.5) is 2 (half to even); the view must read 3. This
    case is the one a banker's-rounding implementation fails (2 and 5 alone cannot tell them
    apart: round(3.5) is 4 either way)."""
    aid = _account(conn)
    _note(conn, _checkin(mood="2", focus="1", day="2026-10-14"))
    _note(conn, _checkin(mood="3", focus="2", day="2026-10-14"))
    _trade(conn, aid, "2026-10-14")
    s = _checkins(conn, aid)
    assert _populated(s, "mood") == {3: (1, 1)}
    assert _populated(s, "focus") == {2: (1, 1)}          # 1.5 -> 2, half up again


def test_mood_and_focus_are_averaged_separately_and_a_missing_one_is_not_a_zero(conn):
    """A check-in with only a mood does not pull the day's focus toward zero: each dimension is
    the mean of the check-ins that picked it."""
    aid = _account(conn)
    _note(conn, _checkin(mood="1", day="2026-10-14"))
    _note(conn, _checkin(mood="1", focus="5", day="2026-10-14"))
    _trade(conn, aid, "2026-10-14")
    s = _checkins(conn, aid)
    assert _populated(s, "mood") == {1: (1, 1)}
    assert _populated(s, "focus") == {5: (1, 1)}


# ── 2. a trade on a day with no check-in is in no level ──────────────────────

def test_a_trade_on_a_day_with_no_checkin_is_not_in_any_level(conn):
    aid = _account(conn)
    _note(conn, _checkin(mood="4", focus="3", day="2026-10-14"))
    _trade(conn, aid, "2026-10-14", pnl=50.0)
    _trade(conn, aid, "2026-10-15", pnl=-999.0, result="Loss")     # no check-in that day
    s = _checkins(conn, aid)
    assert sum(r["tradeCount"] for r in s["mood"]) == 1
    assert sum(r["tradeCount"] for r in s["focus"]) == 1
    assert s["joinedTrades"] == 1
    assert s["unjoined"] == 0                  # it HAS a day; it just had no check-in
    assert _level(s, "mood", 4)["avgPnl"] == 50.0


# ── 3. a trade without trading_day_et is unjoined ────────────────────────────

def test_a_trade_with_no_trading_day_et_counts_in_unjoined(conn):
    aid = _account(conn)
    _note(conn, _checkin(mood="4", day="2026-10-14"))
    _trade(conn, aid, "2026-10-14")
    _trade(conn, aid, None, exit_iso="2026-10-14T18:00:00Z")      # same exit day, no ET day
    s = _checkins(conn, aid)
    assert s["unjoined"] == 1
    assert s["joinedTrades"] == 1
    assert sum(r["tradeCount"] for r in s["mood"]) == 1


# ── 4. a trashed note's check-in is ignored, and counts again on restore ─────

def test_a_trashed_notes_checkin_is_ignored(conn):
    from api.services.journal_two import notes as svc
    aid = _account(conn)
    kept = _note(conn, _checkin(mood="2", day="2026-10-14"), title="Kept")
    gone = _note(conn, _checkin(mood="5", day="2026-10-14"), title="Trashed")
    _trade(conn, aid, "2026-10-14")
    assert _populated(_checkins(conn, aid), "mood") == {4: (1, 1)}          # control: both count
    svc.delete_note("u1", gone["id"], conn=conn)
    conn.commit()
    s = _checkins(conn, aid)
    assert _populated(s, "mood") == {2: (1, 1)}
    assert s["checkInDays"] == 1
    # R-T3-V3: the sidecar row itself is still there; only the join leaves it out.
    assert conn.execute("SELECT COUNT(*) FROM j2_note_checkins WHERE note_id = ?",
                        (gone["id"],)).fetchone()[0] == 1
    assert kept["id"] != gone["id"]


def test_a_restored_notes_checkin_counts_again(conn):
    """R-T3-V3, moved here from Task 4: restore rebuilds nothing, and the same check-in is read
    again because the join sees a live note."""
    from api.services.journal_two import notes as svc
    aid = _account(conn)
    n = _note(conn, _checkin(mood="5", focus="5", day="2026-10-14"))
    _trade(conn, aid, "2026-10-14")
    svc.delete_note("u1", n["id"], conn=conn)
    conn.commit()
    trashed = _checkins(conn, aid)
    assert trashed["checkInDays"] == 0 and _populated(trashed, "mood") == {}
    svc.restore_note("u1", n["id"], conn=conn)
    conn.commit()
    s = _checkins(conn, aid)
    assert s["checkInDays"] == 1
    assert _populated(s, "mood") == {5: (1, 1)}
    assert _populated(s, "focus") == {5: (1, 1)}


# ── 5. another member's check-ins are never read ─────────────────────────────

def test_another_members_checkins_are_never_read(conn):
    aid = _account(conn)
    _account(conn, "u2")
    _note(conn, _checkin(mood="1", focus="1", day="2026-10-14"), user_id="u2")
    _trade(conn, aid, "2026-10-14")
    s = _checkins(conn, aid)
    assert s["checkInDays"] == 0
    assert _populated(s, "mood") == {} and _populated(s, "focus") == {}
    # Control: the same day with u1's own check-in IS read.
    _note(conn, _checkin(mood="3", day="2026-10-14"))
    assert _populated(_checkins(conn, aid), "mood") == {3: (1, 1)}


# ── 6. the words agree with checkinWords.js ──────────────────────────────────

def _client_words():
    node = shutil.which("node")
    assert node, "node is not on PATH"
    js = (f"import({json.dumps(CLIENT_WORDS.resolve().as_uri())}).then((m) => "
          "process.stdout.write(JSON.stringify({mood: m.MOOD_WORDS, focus: m.FOCUS_WORDS,"
          " levels: m.CHECKIN_LEVELS})))")
    r = subprocess.run([node, "--input-type=module", "-e", js], capture_output=True, timeout=120)
    assert r.returncode == 0, (r.stderr or b"").decode("utf-8", "replace")[:2000]
    return json.loads(r.stdout.decode("utf-8"))


def test_the_words_agree_with_checkinWords_js():
    from api.services.journal_two import analytics as an
    client = _client_words()
    assert client["mood"] and client["focus"]                              # non-vacuity
    levels = [int(v) for v in client["levels"]]
    assert levels == [1, 2, 3, 4, 5]
    assert tuple(client["mood"][str(i)] for i in levels) == an.MOOD_WORDS
    assert tuple(client["focus"][str(i)] for i in levels) == an.FOCUS_WORDS
    assert sorted(int(k) for k in client["mood"]) == levels
    assert sorted(int(k) for k in client["focus"]) == levels


def test_the_payload_carries_the_words(conn):
    from api.services.journal_two import analytics as an
    aid = _account(conn)
    s = _checkins(conn, aid)
    assert [r["word"] for r in s["mood"]] == list(an.MOOD_WORDS)
    assert [r["word"] for r in s["focus"]] == list(an.FOCUS_WORDS)


# ── the shape: every level, zero-trade levels null, the definitions ─────────

def test_every_level_is_returned_and_a_zero_trade_level_is_null_not_zero(conn):
    """R-T3-T5-R2. A level with days but no trades, and a level with neither, both read None."""
    aid = _account(conn)
    _note(conn, _checkin(mood="3", day="2026-10-13"))       # a day with no trades
    s = _checkins(conn, aid)
    for dim in ("mood", "focus"):
        assert [r["level"] for r in s[dim]] == [1, 2, 3, 4, 5]
        for r in s[dim]:
            assert set(r) == {"level", "word", "days", "tradeCount", "decisiveCount", "avgPnl",
                              "winRate"}
            assert r["tradeCount"] == 0 and r["decisiveCount"] == 0
            assert r["avgPnl"] is None and r["winRate"] is None
    assert _level(s, "mood", 3)["days"] == 1
    assert s["checkInDays"] == 1 and s["joinedTrades"] == 0 and s["unjoined"] == 0


def test_an_empty_book_has_the_whole_shape(conn):
    aid = _account(conn)
    s = _checkins(conn, aid)
    assert set(s) == {"checkInDays", "joinedTrades", "unjoined", "mood", "focus"}
    assert s["checkInDays"] == 0 and s["joinedTrades"] == 0 and s["unjoined"] == 0
    assert len(s["mood"]) == 5 and len(s["focus"]) == 5


def test_win_rate_and_avg_pnl_follow_the_psychology_definitions(conn):
    """NET P&L (fees out), and breakevens excluded from the win-rate denominator; an
    all-breakeven level reads None, like _psychology_section's emotions."""
    aid = _account(conn)
    _note(conn, _checkin(mood="4", focus="2", day="2026-10-14"))
    _trade(conn, aid, "2026-10-14", pnl=100.0, fees=10.0, result="Win")     # net 90
    _trade(conn, aid, "2026-10-14", pnl=-30.0, result="Loss")
    _trade(conn, aid, "2026-10-14", pnl=0.0, result="BE")
    s = _checkins(conn, aid)
    four = _level(s, "mood", 4)
    assert four["tradeCount"] == 3
    assert four["decisiveCount"] == 2                 # the win and the loss; the BE is not decisive
    assert four["avgPnl"] == 20.0                     # (90 - 30 + 0) / 3
    assert four["winRate"] == 0.5                     # 1 / (1 + 1), the BE left out

    _note(conn, _checkin(mood="1", day="2026-10-15"))
    _trade(conn, aid, "2026-10-15", pnl=0.0, result="BE")
    one = _level(_checkins(conn, aid), "mood", 1)
    assert one["tradeCount"] == 1 and one["avgPnl"] == 0.0 and one["winRate"] is None
    assert one["decisiveCount"] == 0


def test_decisive_count_is_the_rates_n_not_the_trade_count(conn):
    """Ruling R-T3-T5-R4: 12 trades, 11 breakevens and 1 win. The rate (100%) rests on ONE
    decisive trade, and decisiveCount says so while tradeCount stays 12."""
    aid = _account(conn)
    _note(conn, _checkin(mood="3", day="2026-10-14"))
    _trade(conn, aid, "2026-10-14", pnl=40.0, result="Win")
    for _ in range(11):
        _trade(conn, aid, "2026-10-14", pnl=0.0, result="BE")
    three = _level(_checkins(conn, aid), "mood", 3)
    assert three["tradeCount"] == 12
    assert three["decisiveCount"] == 1
    assert three["winRate"] == 1.0


def test_avg_pnl_rounds_each_trade_to_cents_first_like_the_emotion_panel(conn):
    """Review M1. Sub-cent broker fees: nets 0.006 and 0.000. The emotion panel rounds each
    trade's net to cents first (0.01, 0.00), then averages: 0.005, shown as 0.01. Averaging the
    raw nets first gives 0.003, shown as 0.0, a cent apart on the same section. The check-in
    level must read exactly what the emotion panel reads for the same trades."""
    from api.services.journal_two.analytics import get_analytics
    aid = _account(conn)
    _note(conn, _checkin(mood="2", day="2026-10-14"))
    _trade(conn, aid, "2026-10-14", pnl=1.0, fees=0.994, result="Win", emotion_tags=["calm"])
    _trade(conn, aid, "2026-10-14", pnl=0.0, fees=0.0, result="BE", emotion_tags=["calm"])
    psy = get_analytics("u1", account_id=aid, conn=conn)["psychology"]
    emotion = {e["emotion"]: e for e in psy["emotionOutcomes"]}["calm"]["avgPnl"]
    level = _level(psy["checkIns"], "mood", 2)["avgPnl"]
    assert emotion == 0.01                            # non-vacuity: the sub-cent case is live
    assert level == emotion


def test_days_count_distinct_days_and_trades_follow_their_own_day(conn):
    aid = _account(conn)
    _note(conn, _checkin(mood="4", day="2026-10-13"), _checkin(mood="4", day="2026-10-14"))
    _note(conn, _checkin(mood="2", day="2026-10-15"))
    for d in ("2026-10-13", "2026-10-14", "2026-10-14", "2026-10-15"):
        _trade(conn, aid, d)
    s = _checkins(conn, aid)
    assert s["checkInDays"] == 3
    assert _populated(s, "mood") == {4: (2, 3), 2: (1, 1)}
    assert s["joinedTrades"] == 4


def test_checkins_outside_the_analytics_date_range_are_not_read(conn):
    aid = _account(conn)
    _note(conn, _checkin(mood="4", day="2026-10-14"))
    _note(conn, _checkin(mood="1", day="2026-09-01"))
    _trade(conn, aid, "2026-10-14")
    s = _checkins(conn, aid, date_from="2026-10-01", date_to="2026-10-31")
    assert s["checkInDays"] == 1
    assert _populated(s, "mood") == {4: (1, 1)}
    # Control: with no range both days are read.
    assert _checkins(conn, aid)["checkInDays"] == 2


def test_the_rest_of_the_psychology_payload_is_untouched(conn):
    from api.services.journal_two.analytics import _psychology_section, _fetch_trades, get_analytics
    from api.services.journal_two.filters import FilterSpec
    aid = _account(conn)
    _trade(conn, aid, "2026-10-14")
    psy = get_analytics("u1", account_id=aid, conn=conn)["psychology"]
    rows = _fetch_trades(conn, "u1", account_id=aid, spec=FilterSpec())
    expected = _psychology_section(rows)
    assert {k: v for k, v in psy.items() if k != "checkIns"} == expected
    assert "checkIns" in psy

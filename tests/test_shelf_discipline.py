"""Task 10.10: the dedicated discipline builders (tilt check, revenge clean days, risk left today,
prop-firm rules).

Real auth.db schema (auth_db.init_db) in a tmp dir; trades, option strategies, positions and
accounts are seeded straight into their tables; `now` is injected. Dates are real 2026 sessions,
times are written in ET and stored as UTC instants (the way the broker and the app store them).
"""
from __future__ import annotations

import dataclasses
import math
import importlib
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

A, B = "u-disc-a", "u-disc-b"
ET = ZoneInfo("America/New_York")
STAMP = "2026-08-01T00:00:00Z"
#: Saturday 2026-10-24, noon ET.
NOW = datetime(2026, 10, 24, 16, 0, tzinfo=timezone.utc)
#: Friday 2026-10-23, 16:30 ET (after the close).
FRI = datetime(2026, 10, 23, 20, 30, tzinfo=timezone.utc)
#: Tuesday 2026-10-20, 16:00 ET exactly.
TUE = datetime(2026, 10, 20, 20, 0, tzinfo=timezone.utc)


@pytest.fixture
def S(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import shelf_discipline
    yield shelf_discipline
    importlib.reload(auth_db)


def _conn():
    from api.services import auth_db
    return auth_db.get_connection()


def et(day: str, hm: str) -> str:
    """'2026-10-20', '15:58' (ET) -> the UTC instant, ISO with Z."""
    h, m = (int(x) for x in hm.split(":"))
    d = date.fromisoformat(day)
    t = datetime(d.year, d.month, d.day, h, m, tzinfo=ET).astimezone(timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def trade(c, uid, *, day, pnl, entry=None, exit_=None, fees=0.0, result=None, symbol="NVDA",
          flagged=0, account=None, estimated=False, source=None):
    """A closed equity trade. `entry` / `exit_` are 'HH:MM' ET, an ISO string, or None for a
    date-only row (the bare day)."""
    result = result or ("Win" if pnl - fees > 0 else "Loss" if pnl - fees < 0 else "BE")

    def _iso(v):
        if v is None:
            return day
        if len(v) == 5 and v[2] == ":":
            return et(day, v)
        return v

    tid, pid = str(uuid.uuid4()), str(uuid.uuid4())
    if estimated:
        c.execute(
            "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares,"
            " original_shares, entry_price, stop_price, context_at_entry, created_at, updated_at,"
            " closed_at, entry_estimated) VALUES (?, ?, ?, 'Long', ?, 10, 10, 100, 95, '{}', ?, ?,"
            " ?, 1)", (pid, uid, symbol, _iso(entry), STAMP, STAMP, STAMP))
    c.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price,"
        " entry_date, exit_price, exit_date, original_stop, pnl_dollar, pnl_percent, hold_days,"
        " result, context_at_entry, created_at, trading_day_et, fees, analytics_excluded,"
        " account_id, source) VALUES (?, ?, ?, ?, 'Long', 10, 100, ?, 110, ?, 95, ?, 0.01, 0, ?,"
        " '{}', ?, ?, ?, ?, ?, ?)",
        (tid, uid, pid, symbol, _iso(entry), _iso(exit_), pnl, result, STAMP,
         day, fees, flagged, account, source))
    return tid


def strategy(c, uid, *, pnl, entry_iso, closed_iso, day=None, status="closed", account=None,
             underlying="SPY", result=None):
    sid = str(uuid.uuid4())
    result = result if result is not None else (
        ("Win" if pnl > 0 else "Loss" if pnl < 0 else "BE") if status != "open" else None)
    c.execute(
        "INSERT INTO j2_option_strategies (id, user_id, account_id, underlying, strategy_type,"
        " direction, net_entry, entry_date, status, closed_at, pnl_dollar, result, created_at,"
        " updated_at, trading_day_et) VALUES (?, ?, ?, ?, 'long_call', 'bullish', 100, ?, ?, ?, ?,"
        " ?, ?, ?, ?)",
        (sid, uid, account, underlying, entry_iso, status, closed_iso, pnl, result, STAMP, STAMP,
         day))
    return sid


def account(c, uid, aid, *, pct=None, size=10000.0, marked=1, name="Main"):
    c.execute(
        "INSERT INTO j2_accounts (id, user_id, name, color, starting_balance, account_size,"
        " created_at, updated_at, daily_loss_limit_pct, account_size_set)"
        " VALUES (?, ?, ?, '#fff', 10000, ?, ?, ?, ?, ?)",
        (aid, uid, name, size, STAMP, STAMP, pct, marked))


def position(c, uid, *, acc, symbol="AAPL", entry=100.0, stop=95.0, shares=50):
    c.execute(
        "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, original_shares,"
        " entry_price, stop_price, context_at_entry, created_at, updated_at, account_id)"
        " VALUES (?, ?, ?, 'Long', '2026-10-01T14:00:00Z', ?, ?, ?, ?, '{}', ?, ?, ?)",
        (str(uuid.uuid4()), uid, symbol, shares, shares, entry, stop, STAMP, STAMP, acc))


def strings(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from strings(v)
    elif isinstance(x, (list, tuple)):
        for v in x:
            yield from strings(v)


FORBIDDEN = ("$0", " 0 ", "0%", "0 of", "(0)")


def no_zero_strings(payload):
    bad = [s for s in strings(payload) if any(f in s for f in FORBIDDEN)]
    assert not bad, bad


# ── Tilt check ─────────────────────────────────────────────────────────────────────────────────

def test_reentry_within_30_min_after_loss_counted(S):
    with _conn() as c:
        # A loss closed at 15:58 ET; a different symbol entered at 16:20 ET is "after a loss".
        trade(c, A, day="2026-10-20", pnl=-80, entry="15:00", exit_="15:58", symbol="NVDA")
        trade(c, A, day="2026-10-20", pnl=40, entry="16:20", exit_="16:40", symbol="AMD")
        # 16:29 is 31 minutes after the 15:58 exit: not after (the 16:40 exit was a win).
        trade(c, A, day="2026-10-20", pnl=10, entry="16:29", exit_="16:50", symbol="TSLA")
        # Across midnight: a loss closed 23:50 ET, an entry at 00:10 ET the next day.
        trade(c, A, day="2026-10-21", pnl=-30, entry=et("2026-10-21", "23:00"),
              exit_=et("2026-10-21", "23:50"), symbol="META")
        trade(c, A, day="2026-10-22", pnl=25, entry=et("2026-10-22", "00:10"),
              exit_=et("2026-10-22", "09:45"), symbol="MSFT")
        c.commit()
    got = S.my_tilt_check(A, {}, NOW)
    assert got["after"]["n"] == 2          # AMD (16:20) and MSFT (00:10)
    assert got["other"]["n"] == 3          # NVDA, TSLA, META
    assert got["lines"] == [
        "Within 30 min after a loss: Not enough trades yet (2).",
        "Other trades: Not enough trades yet (3).",
        "A comparison, not proof.",
    ]
    assert got["after"]["winRate"] is None and got["after"]["avg"] is None


def _after_and_other(c, uid=A):
    """5 trades after a loss (40% win rate, -$20 average) and 6 others (67%, +$20)."""
    day = "2026-10-20"
    trade(c, uid, day=day, pnl=-30, entry="09:40", exit_="10:00", symbol="L")
    for i, pnl in enumerate((-50, -50, -50, 30, 20)):
        trade(c, uid, day=day, pnl=pnl, entry=f"10:{5 + 5 * i:02d}", exit_="13:00",
              symbol=f"A{i}")
    for i, pnl in enumerate((40, 40, 40, 40, -10)):
        d = ("2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19")[i]
        trade(c, uid, day=d, pnl=pnl, entry="14:00", exit_="14:30", symbol=f"O{i}")
    c.commit()


def test_win_rate_and_average_reuse_shared_measures(S, monkeypatch):
    with _conn() as c:
        _after_and_other(c)
    got = S.my_tilt_check(A, {}, NOW)
    assert got["lines"][:2] == [
        "Within 30 min after a loss: 5 trades, 40% win rate, −$20 average.",
        "Other trades: 6 trades, 67% win rate, +$20 average.",
    ]
    assert got["after"] == {"n": 5, "winRate": 0.4, "avg": -20.0, "net": -100.0,
                            "sample": "small",
                            "text": "5 trades, 40% win rate, −$20 average"}
    assert got["other"]["net"] == 120.0
    # The figures ARE the shared measures: replace them and the widget follows.
    from api.services.journal_two import measures
    for key, val in (("win_rate", 0.25), ("expectancy", 7.0)):
        m = measures.MEASURES[key]
        monkeypatch.setitem(measures.MEASURES, key, dataclasses.replace(
            m, fn=lambda rows, val=val: measures.MeasureValue(val, len(rows), None)))
    again = S.my_tilt_check(A, {}, NOW)
    assert again["after"]["winRate"] == 0.25 and again["after"]["avg"] == 7.0
    assert again["lines"][0] == "Within 30 min after a loss: 5 trades, 25% win rate, +$7 average."


def test_dates_only_excluded_and_counted(S):
    with _conn() as c:
        _after_and_other(c)
        trade(c, A, day="2026-10-21", pnl=-500)                     # date only
        trade(c, A, day="2026-10-21", pnl=900)                      # date only
        trade(c, A, day="2026-10-22", pnl=-70, entry="10:00", exit_="10:30", estimated=True)
        trade(c, A, day="2026-10-22", pnl=-999, entry="10:00", exit_="10:30", flagged=1)
        c.commit()
    got = S.my_tilt_check(A, {}, NOW)
    assert got["datesOnly"] == 2 and got["estimated"] == 1
    assert got["after"]["n"] == 5 and got["other"]["n"] == 6       # none of them counted
    assert got["lines"][2:] == [
        "A comparison, not proof.",
        "2 trades with dates only are not counted.",
        "1 trade with an estimated entry time is not counted.",
    ]


def test_options_losses_trigger_the_window(S):
    with _conn() as c:
        # An options strategy closed for a loss at 15:58 ET; a stock entered at 16:10 ET.
        strategy(c, A, pnl=-120, entry_iso=et("2026-10-20", "10:00"),
                 closed_iso=et("2026-10-20", "15:58"), day="2026-10-20")
        trade(c, A, day="2026-10-20", pnl=50, entry="16:10", exit_="16:30", symbol="AMD")
        c.commit()
    got = S.my_tilt_check(A, {}, NOW)
    assert got["after"]["n"] == 1                      # the stock
    assert got["other"]["n"] == 1                      # the strategy itself is a timed trade
    assert got["other"]["net"] == -120.0


def test_no_timed_trades_sentence(S):
    assert S.my_tilt_check(A, {}, NOW)["lines"] == ["No closed trades in this range."]
    with _conn() as c:
        trade(c, A, day="2026-10-21", pnl=-500)
        trade(c, A, day="2026-10-22", pnl=300)
        c.commit()
    got = S.my_tilt_check(A, {}, NOW)
    assert got["lines"] == ["Tilt check needs entry and exit times; your trades have dates only."]
    assert got["datesOnly"] == 2
    # Outside the range: none.
    got = S.my_tilt_check(A, {"from": "2026-01-01", "to": "2026-01-31"}, NOW)
    assert got["lines"] == ["No closed trades in this range."]


def test_small_group_not_enough_never_zero(S):
    with _conn() as c:
        trade(c, A, day="2026-10-20", pnl=-80, entry="10:00", exit_="10:10", symbol="X")
        for i in range(3):
            trade(c, A, day="2026-10-20", pnl=-10, entry=f"10:{11 + i}", exit_="12:00",
                  symbol=f"Y{i}")
        c.commit()
    got = S.my_tilt_check(A, {}, NOW)
    assert got["after"] == {"n": 3, "winRate": None, "avg": None, "net": -30.0,
                            "sample": "hide", "text": "Not enough trades yet (3)"}
    assert got["lines"][0] == "Within 30 min after a loss: Not enough trades yet (3)."
    no_zero_strings(got)
    # A group with no trades at all is "no trades", never "(0)".
    with _conn() as c:
        c.execute("DELETE FROM j2_trades WHERE symbol LIKE 'Y%'")
        c.commit()
    got = S.my_tilt_check(A, {}, NOW)
    assert got["after"]["n"] == 0 and got["after"]["text"] == "no trades"
    assert got["lines"][0] == "Within 30 min after a loss: no trades."
    no_zero_strings(got)


# ── Revenge trades ─────────────────────────────────────────────────────────────────────────────

def test_window_is_30_finished_sessions_across_thanksgiving(S):
    from api.services.journal_two import trading_days
    now = datetime(2026, 11, 30, 14, 0, tzinfo=timezone.utc)       # Monday 09:00 ET
    w = S.finished_sessions(now)
    assert len(w) == 30 and w[-1] == date(2026, 11, 27)
    assert date(2026, 11, 26) not in w and date(2026, 11, 30) not in w
    all_days = trading_days.sessions(date(2026, 9, 1), date(2026, 11, 27)).days
    assert w == all_days[-30:]
    got = S.my_revenge_clean_days(A, {}, now)
    assert got["from"] == w[0].isoformat() and got["to"] == "2026-11-27"


def test_today_counts_after_close(S):
    half = date(2026, 11, 27)
    assert S.finished_sessions(datetime(2026, 11, 27, 18, 30, tzinfo=timezone.utc))[-1] == half
    assert S.finished_sessions(
        datetime(2026, 11, 27, 17, 30, tzinfo=timezone.utc))[-1] == date(2026, 11, 25)
    assert S.finished_sessions(TUE)[-1] == date(2026, 10, 20)                 # 16:00 ET
    assert S.finished_sessions(TUE - timedelta(minutes=1))[-1] == date(2026, 10, 19)
    with _conn() as c:
        # Today, flagged, after the close: it is in the window.
        trade(c, A, day="2026-10-20", pnl=-50, entry="10:00", exit_="10:10")
        trade(c, A, day="2026-10-20", pnl=20, entry="10:20", exit_="10:40")
        c.commit()
    assert S.my_revenge_clean_days(A, {}, TUE)["flagged"][0]["day"] == "2026-10-20"
    assert S.my_revenge_clean_days(A, {}, TUE - timedelta(minutes=1))["flagged"] == []


def test_dates_only_day_not_checked_and_stated(S):
    with _conn() as c:
        trade(c, A, day="2026-10-21", pnl=-500)                                    # date only
        trade(c, A, day="2026-10-20", pnl=-50, entry="10:00", exit_="10:10")
        trade(c, A, day="2026-10-20", pnl=20, entry="10:30", exit_="10:40")        # revenge
        trade(c, A, day="2026-10-19", pnl=-50, entry="10:00", exit_="10:10")
        trade(c, A, day="2026-10-19", pnl=20, entry="10:30", exit_="10:40", symbol="AMD")
        c.commit()
    got = S.my_revenge_clean_days(A, {}, NOW)
    # W10-R54: the 27 sessions with no trades are neither clean nor checked.
    assert (got["clean"], got["checked"], got["notChecked"], got["noTrades"]) == (1, 2, 1, 27)
    assert got["flagged"] == [{"day": "2026-10-20", "symbol": "NVDA", "minutesApart": 20.0}]
    assert got["lines"] == ["1 of 2 clean (1 day with dates only was not checked)"]
    with _conn() as c:
        trade(c, A, day="2026-10-22", pnl=-500)
        c.commit()
    got = S.my_revenge_clean_days(A, {}, NOW)
    assert got["lines"] == ["1 of 2 clean (2 days with dates only were not checked)"]


def test_dismissed_pair_is_clean(S, monkeypatch):
    with _conn() as c:
        loss = trade(c, A, day="2026-10-20", pnl=-50, entry="10:00", exit_="10:10")
        again = trade(c, A, day="2026-10-20", pnl=20, entry="10:30", exit_="10:40")
        c.commit()
    assert S.my_revenge_clean_days(A, {}, NOW)["lines"] == [S.S_REVENGE_EVERY_DAY]   # W10-R54
    seen = []

    def _pairs(conn, uid):
        seen.append(uid)
        return frozenset({f"id:{loss}->id:{again}"})

    monkeypatch.setattr(S, "_dismissed_pairs", _pairs)
    got = S.my_revenge_clean_days(A, {}, NOW)
    assert seen == [A]
    assert got["flagged"] == [] and got["lines"] == ["1 of 1 clean"]


def test_line_exact_and_never_zero_of(S):
    window = S.finished_sessions(NOW)
    with _conn() as c:
        for d in window:
            k = d.isoformat()
            trade(c, A, day=k, pnl=-50, entry="10:00", exit_="10:10")
            trade(c, A, day=k, pnl=20, entry="10:30", exit_="10:40")
        c.commit()
    got = S.my_revenge_clean_days(A, {}, NOW)
    assert got["clean"] == 0 and got["checked"] == 30
    assert got["lines"] == [
        "Revenge re-entries on every checked day in the last 30 trading days."]
    assert len(got["flagged"]) == 30
    assert got["flagged"][0]["day"] == window[-1].isoformat()          # newest first
    no_zero_strings(got)
    # Every traded day date-only: nothing checked, said so, never "0 of 0".
    with _conn() as c:
        c.execute("DELETE FROM j2_trades")
        for d in window:
            trade(c, A, day=d.isoformat(), pnl=-50)
        c.commit()
    got = S.my_revenge_clean_days(A, {}, NOW)
    assert got["lines"] == ["None of the days you traded in the last 30 trading days could be checked; "
                            "your trades have dates only."]
    no_zero_strings(got)


def test_no_trades_sentence(S):
    got = S.my_revenge_clean_days(A, {}, NOW)
    assert got["lines"] == ["No trades in the last 30 trading days."]
    with _conn() as c:
        trade(c, A, day="2026-01-05", pnl=-50, entry="10:00", exit_="10:10")   # long before
        c.commit()
    assert S.my_revenge_clean_days(A, {}, NOW)["lines"] == ["No trades in the last 30 trading days."]


# ── Risk left today ────────────────────────────────────────────────────────────────────────────

def _one_account(c, uid=A, aid="acc-a", pct=5.0, size=10000.0):
    account(c, uid, aid, pct=pct, size=size)


def test_room_left_arithmetic_green_day_adds_no_room(S):
    with _conn() as c:
        _one_account(c)
        t = trade(c, A, day="2026-10-20", pnl=-190, fees=10, entry="10:00", exit_="10:30",
                  account="acc-a")
        trade(c, A, day="2026-10-19", pnl=-900, entry="10:00", exit_="10:30", account="acc-a")
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE)
    blk = got["accounts"][0]
    assert (blk["limit"], blk["net"], blk["used"], blk["left"]) == (500.0, -200.0, 200.0, 300.0)
    assert blk["lines"][0] == "Room left today: $300 of $500."
    assert blk["name"] == "Main"
    with _conn() as c:
        c.execute("UPDATE j2_trades SET pnl_dollar = 310, result = 'Win' WHERE id = ?", (t,))
        c.commit()
    blk = S.my_risk_left_today(A, {}, TUE)["accounts"][0]
    assert blk["left"] == 500.0 and blk["lines"][0] == "Room left today: $500 of $500."
    with _conn() as c:
        c.execute("UPDATE j2_trades SET pnl_dollar = -570, result = 'Loss' WHERE id = ?", (t,))
        c.commit()
    blk = S.my_risk_left_today(A, {}, TUE)["accounts"][0]
    assert blk["left"] == -80.0 and blk["lines"][0] == "Past your daily loss limit by $80."


def test_includes_closed_options_today(S):
    with _conn() as c:
        _one_account(c)
        trade(c, A, day="2026-10-20", pnl=-100, entry="10:00", exit_="10:30", account="acc-a")
        strategy(c, A, pnl=-150, entry_iso=et("2026-10-20", "09:45"),
                 closed_iso=et("2026-10-20", "11:00"), day="2026-10-20", account="acc-a")
        strategy(c, A, pnl=-999, entry_iso=et("2026-10-20", "09:45"), closed_iso=None,
                 status="open", account="acc-a")
        c.commit()
    blk = S.my_risk_left_today(A, {}, TUE)["accounts"][0]
    assert blk["net"] == -250.0 and blk["left"] == 250.0
    assert blk["lines"][0] == "Room left today: $250 of $500."
    assert "1 open options trade is not in the open risk." in blk["lines"]


def test_half_day_after_close_still_today(S):
    now = datetime(2026, 11, 27, 18, 30, tzinfo=timezone.utc)         # 13:30 ET, after 13:00
    with _conn() as c:
        _one_account(c)
        trade(c, A, day="2026-11-27", pnl=-100, entry="10:00", exit_="10:30", account="acc-a")
        # Closed 2026-11-27T00:30:00Z is 19:30 ET on Nov 26: yesterday, not today.
        strategy(c, A, pnl=-1000, entry_iso="2026-11-26T15:00:00Z",
                 closed_iso="2026-11-27T00:30:00Z", account="acc-a")
        c.commit()
    got = S.my_risk_left_today(A, {}, now)
    assert got["day"] == "2026-11-27"
    blk = got["accounts"][0]
    assert blk["net"] == -100.0 and blk["lines"][0] == "Room left today: $400 of $500."


def test_open_risk_from_portfolio_heat_placeholder_counted(S, monkeypatch):
    with _conn() as c:
        _one_account(c)
        position(c, A, acc="acc-a", symbol="AAPL", entry=100.0, stop=95.0, shares=50)  # $250
        position(c, A, acc="acc-a", symbol="MSFT", entry=200.0, stop=200.0)            # placeholder
        position(c, A, acc="acc-a", symbol="AMD", entry=150.0, stop=150.0)             # placeholder
        c.commit()
    from api.services import portfolio_heat
    calls = []
    real = portfolio_heat.portfolio_heat

    def spy(*a, **k):
        calls.append((a, k))
        return real(*a, **k)

    monkeypatch.setattr(portfolio_heat, "portfolio_heat", spy)
    blk = S.my_risk_left_today(A, {}, TUE)["accounts"][0]
    assert len(calls) == 1 and calls[0][0][:2] == (A, "acc-a")
    assert blk["openRisk"] == 250.0 and blk["noStop"] == 2 and blk["afterStops"] == 250.0
    assert blk["lines"] == [
        "Room left today: $500 of $500.",
        "Open risk to stops: $250.",
        "If every stop is hit: $250 left.",
        "2 positions have no stop set and are not in the open risk.",
    ]
    with _conn() as c:
        position(c, A, acc="acc-a", symbol="NVDA", entry=100.0, stop=93.0, shares=100)  # $700
        c.commit()
    blk = S.my_risk_left_today(A, {}, TUE)["accounts"][0]
    assert blk["openRisk"] == 950.0
    assert "If every stop is hit: $450 past your limit." in blk["lines"]


def test_no_limit_and_no_size_sentences(S):
    got = S.my_risk_left_today(A, {}, TUE)
    assert got["lines"] == ["Set a daily loss limit in your account settings to see room left."]
    assert got["accounts"] == []
    with _conn() as c:
        account(c, A, "acc-a", pct=None)
        c.commit()
    assert S.my_risk_left_today(A, {}, TUE)["lines"] == [
        "Set a daily loss limit in your account settings to see room left."]
    with _conn() as c:
        # The migrated placeholder size, never set by the member: not their size.
        c.execute("UPDATE j2_accounts SET daily_loss_limit_pct = 5, account_size = 100000,"
                  " account_size_set = NULL WHERE id = 'acc-a'")
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE)
    assert got["lines"] == ["Set your account size to turn your daily loss limit into dollars."]
    assert got["accounts"][0]["limit"] is None and got["accounts"][0]["left"] is None
    no_zero_strings(got)


# ── Prop-firm rules ────────────────────────────────────────────────────────────────────────────

def _days(c, uid, pairs, account=None):
    for d, pnl in pairs:
        trade(c, uid, day=d, pnl=pnl, entry="10:00", exit_="10:30", account=account)
    c.commit()


def test_trailing_drawdown_from_running_peak(S):
    with _conn() as c:
        _days(c, A, [("2026-10-19", 500), ("2026-10-20", 1000), ("2026-10-21", -300),
                     ("2026-10-22", -1150)])
    got = S.my_prop_firm(A, {"maxDrawdown": 2500, "since": "2026-10-01"}, FRI)
    assert got["trailing"] == {"limit": 2500.0, "peak": 1500.0, "current": 50.0,
                               "drawdown": 1450.0, "left": 1050.0}
    assert got["lines"] == ["Max drawdown: $1,450 below your peak; $1,050 left."]
    assert got["daily"] is None
    # The peak never goes below 0: a losing start is a drawdown from the starting line.
    with _conn() as c:
        c.execute("DELETE FROM j2_trades")
        _days(c, A, [("2026-10-19", -200), ("2026-10-20", -100)])
    got = S.my_prop_firm(A, {"maxDrawdown": 250, "since": "2026-10-01"}, FRI)
    assert got["trailing"]["peak"] == 0.0 and got["trailing"]["drawdown"] == 300.0
    assert got["lines"] == ["Past your max drawdown by $50."]
    # At the peak.
    with _conn() as c:
        c.execute("DELETE FROM j2_trades")
        _days(c, A, [("2026-10-19", 200), ("2026-10-20", 100)])
    got = S.my_prop_firm(A, {"maxDrawdown": 2500, "since": "2026-10-01"}, FRI)
    assert got["lines"] == ["Max drawdown: at your peak; $2,500 left."]


def test_daily_room_and_breach_lines(S):
    with _conn() as c:
        _days(c, A, [("2026-10-22", 400)])
        t = trade(c, A, day="2026-10-23", pnl=-220, entry="10:00", exit_="10:30")
        strategy(c, A, pnl=-100, entry_iso=et("2026-10-23", "10:00"),
                 closed_iso=et("2026-10-23", "11:00"), day="2026-10-23")
        c.commit()
    params = {"dailyLoss": 1000, "since": "2026-10-01"}
    got = S.my_prop_firm(A, params, FRI)
    assert got["daily"] == {"limit": 1000.0, "todayNet": -320.0, "used": 320.0, "left": 680.0}
    assert got["lines"] == ["Daily loss: $320 of $1,000 used; $680 left."]
    with _conn() as c:
        c.execute("UPDATE j2_trades SET pnl_dollar = 200, result = 'Win' WHERE id = ?", (t,))
        c.commit()
    assert S.my_prop_firm(A, params, FRI)["lines"] == ["Daily loss: none used today; $1,000 left."]
    with _conn() as c:
        c.execute("UPDATE j2_trades SET pnl_dollar = -980, result = 'Loss' WHERE id = ?", (t,))
        c.commit()
    assert S.my_prop_firm(A, params, FRI)["lines"] == ["Past your daily loss limit by $80."]


def test_missing_limits_sentence_each_half(S):
    with _conn() as c:
        _days(c, A, [("2026-10-22", 400), ("2026-10-23", -300)])
    base = {"since": "2026-10-01"}
    assert S.my_prop_firm(A, base, FRI)["lines"] == [
        "Enter your daily loss limit and max drawdown to see room left."]
    only_daily = S.my_prop_firm(A, {**base, "dailyLoss": 1000}, FRI)
    assert only_daily["lines"] == ["Daily loss: $300 of $1,000 used; $700 left."]
    assert only_daily["trailing"] is None
    only_dd = S.my_prop_firm(A, {**base, "maxDrawdown": 1000}, FRI)
    assert only_dd["lines"] == ["Max drawdown: $300 below your peak; $700 left."]
    assert only_dd["daily"] is None
    # No trades since `since`: its own sentence (the default `since` is the month's first session).
    got = S.my_prop_firm(B, {"dailyLoss": 1000}, FRI)
    assert got["since"] == "2026-10-01"
    assert got["lines"] == ["No trades since Oct 1."]


def test_since_clipped_to_horizon(S):
    from api.services.journal_two import trading_days
    with _conn() as c:
        _days(c, A, [("2026-10-22", 400)])
    got = S.my_prop_firm(A, {"since": "1990-01-01", "maxDrawdown": 1000}, FRI)
    today = date(2026, 10, 23)
    floor = today - timedelta(days=5500)
    expect = trading_days.sessions(floor, today).days[-S.MAX_SESSIONS:][0]
    assert got["countingFrom"] == expect.isoformat()
    label = f"{expect.strftime('%b')} {expect.day}, {expect.year}"
    assert got["lines"][0] == f"Counting from {label}, the oldest day this widget reads."
    assert got["lines"][1] == "Max drawdown: at your peak; $1,000 left."
    # A recent since is not clipped.
    got = S.my_prop_firm(A, {"since": "2026-10-01", "maxDrawdown": 1000}, FRI)
    assert not got["lines"][0].startswith("Counting from")


def test_clean_params_refusals_exact(S):
    from api.services.journal_two import tool_errors

    def refused(kind, raw):
        with pytest.raises(S.ParamError) as e:
            S.clean_params(kind, raw)
        assert isinstance(e.value, tool_errors.ToolError)
        assert e.value.status == 400 and e.value.code == S.ParamError.code
        return e.value.sentence

    for bad in ("10/24/2026", "2026-02-30", "2026-1-5", 20261024, " 2026-10-24"):
        assert refused("myTiltCheck", {"from": bad}) == "Dates need to look like 2026-10-24."
        assert refused("myPropFirm", {"since": bad}) == "Dates need to look like 2026-10-24."
    for bad in (0, -5, "abc", "100", True, float("nan")):
        assert refused("myPropFirm", {"dailyLoss": bad}) == "Enter an amount above $0."
        assert refused("myPropFirm", {"maxDrawdown": bad}) == "Enter an amount above $0."
    for bad in (10_000_000.01, 1e9, float("inf")):
        assert refused("myPropFirm", {"dailyLoss": bad}) == "An amount can be at most $10,000,000."
    assert refused("myTiltCheck", {"from": "2026-10-24", "to": "2026-10-01"}) == (
        "The start date is after the end date.")
    assert S.clean_params("myPropFirm", {"dailyLoss": 10_000_000, "maxDrawdown": 0.5,
                                         "junk": 1, "accountId": "x"}) == {
        "dailyLoss": 10_000_000.0, "maxDrawdown": 0.5, "accountId": "x"}
    assert S.clean_params("myRevengeClean", {"from": "nonsense"}) == {}
    assert S.PARAMS == {"myTiltCheck": ("from", "to"), "myRevengeClean": (),
                        "myRiskLeftToday": (), "myPropFirm": ("dailyLoss", "maxDrawdown",
                                                              "since", "accountId")}
    # A builder refuses the same way.
    with pytest.raises(S.ParamError):
        S.my_prop_firm(A, {"dailyLoss": -1}, FRI)


def test_foreign_account_reads_all_with_notice(S):
    with _conn() as c:
        account(c, A, "acc-a1", name="One")
        account(c, A, "acc-a2", name="Two")
        account(c, B, "acc-b1", name="Theirs")
        _days(c, A, [("2026-10-22", 400)], account="acc-a1")
        _days(c, A, [("2026-10-22", -100)], account="acc-a2")
    p = {"since": "2026-10-01", "maxDrawdown": 1000}
    all_ = S.my_prop_firm(A, p, FRI)
    assert all_["trailing"]["current"] == 300.0 and "notices" not in all_
    own = S.my_prop_firm(A, {**p, "accountId": "acc-a1"}, FRI)
    assert own["trailing"]["current"] == 400.0 and own["accountId"] == "acc-a1"
    for foreign in ("acc-b1", "nope"):
        got = S.my_prop_firm(A, {**p, "accountId": foreign}, FRI)
        assert got["notices"] == [
            "That account is no longer in your Journal; showing all accounts."]
        assert got["accountId"] is None
        assert got["trailing"] == all_["trailing"] and got["lines"] == all_["lines"]


# ── every builder ──────────────────────────────────────────────────────────────────────────────

def test_payload_has_as_of_source_and_no_zero_strings(S):
    for kind, build in S.BUILDERS.items():
        got = build(A, {}, NOW)
        assert got["asOf"] == "2026-10-24T16:00:00Z", kind
        assert got["source"] in ("broker", "manual", "mixed"), kind
        assert got["lines"], kind
        no_zero_strings(got)
    assert S.my_prop_firm(A, {}, NOW)["lines"] == [
        "No trades since Oct 1.",
        "Enter your daily loss limit and max drawdown to see room left."]
    assert S.TITLES == {"myTiltCheck": "Tilt check", "myRevengeClean": "Revenge trades",
                        "myRiskLeftToday": "Risk left today", "myPropFirm": "Prop-firm rules"}
    # source follows the rows: a broker-imported trade reads "broker", with a hand-logged one "mixed"
    with _conn() as c:
        trade(c, A, day="2026-10-20", pnl=-50, entry="10:00", exit_="10:10", source="broker")
        c.commit()
    assert S.my_tilt_check(A, {}, NOW)["source"] == "broker"
    with _conn() as c:
        trade(c, A, day="2026-10-21", pnl=50, entry="10:00", exit_="10:10")
        c.commit()
    assert S.my_tilt_check(A, {}, NOW)["source"] == "mixed"


def test_budget_check_called_in_loops(S, monkeypatch):
    with _conn() as c:
        for i in range(600):
            d = ("2026-10-19", "2026-10-20", "2026-10-21")[i % 3]
            trade(c, A, day=d, pnl=-5 if i % 2 else 5, entry="10:00", exit_="10:30",
                  symbol=f"S{i}")
        c.commit()
    counted = []
    monkeypatch.setattr(S, "_check", lambda: counted.append(1))
    S.my_tilt_check(A, {}, NOW)
    # 600 rows walked three times (events, the in-range pass, the timed pass): at least 3 x 3.
    assert len(counted) >= 9
    counted.clear()
    S.my_revenge_clean_days(A, {}, NOW)
    assert len(counted) >= 600          # 600 one-trade symbol buckets, each asks the budget
    counted.clear()
    S.my_prop_firm(A, {"since": "2026-01-01"}, NOW)
    assert len(counted) >= 1
    # Past the budget, a builder answers EngineTooLong, never a half-made widget.
    from api.services.journal_two.widget_engine import compile as wcompile
    from api.services.journal_two.widget_engine import run as wrun

    def late():
        raise wcompile.ScanTooLong()

    monkeypatch.setattr(S, "_check", late)
    for build in (S.my_tilt_check, S.my_revenge_clean_days, S.my_prop_firm):
        with pytest.raises(wrun.EngineTooLong):
            build(A, {}, NOW)


# ── fix round 1 (review of 30c4905102) ─────────────────────────────────────────────────────────

FRI_R = datetime(2026, 10, 23, 20, 30, tzinfo=timezone.utc)      # Fri 16:30 ET
TUE_R = datetime(2026, 10, 20, 18, 0, tzinfo=timezone.utc)       # Tue 14:00 ET


def test_unlinked_position_counts_in_total_risk(S):
    with _conn() as c:
        account(c, A, "acc-a", pct=5.0, size=10000.0)
        position(c, A, acc="acc-a", symbol="AAPL", entry=100.0, stop=95.0, shares=20)   # $100
        position(c, A, acc=None, symbol="TSLA", entry=200.0, stop=190.0, shares=40)     # $400
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE_R)
    main, unlinked = got["accounts"]
    assert got["openRisk"] == 500.0
    assert main["openRisk"] == 100.0 and main["afterStops"] == 0.0
    assert main["lines"] == [
        "Room left today: $500 of $500.",
        "Open risk to stops: $100.",
        "If every stop is hit, including positions not linked to an account: no room left.",
    ]
    assert unlinked["accountId"] is None and unlinked["name"] == "Not linked to an account"
    assert unlinked["openRisk"] == 400.0 and unlinked["lines"] == ["Open risk to stops: $400."]
    assert got["lines"] == [
        "Open risk to stops in total: $500 (Main $100, Not linked to an account $400)."]
    # A position on an account that no longer exists is unlinked too.
    with _conn() as c:
        position(c, A, acc="acc-gone", symbol="AMD", entry=50.0, stop=49.0, shares=100)  # $100
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE_R)
    assert got["accounts"][1]["openRisk"] == 500.0 and got["openRisk"] == 600.0


def test_unlinked_with_two_accounts_never_says_no_open_positions(S):
    with _conn() as c:
        account(c, A, "acc-a", pct=5.0, size=10000.0)
        account(c, A, "acc-b2", pct=None, size=10000.0, name="Other")
        position(c, A, acc=None, symbol="TSLA", entry=200.0, stop=190.0, shares=40)
        strategy(c, A, pnl=-5, entry_iso=et("2026-10-20", "09:45"), closed_iso=None,
                 status="open", account=None)
        trade(c, A, day="2026-10-20", pnl=-300, entry="10:00", exit_="10:10", account=None)
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE_R)
    every = list(strings(got))
    assert not any("No open positions" in s for s in every), every
    unlinked = got["accounts"][-1]
    assert unlinked["openRisk"] == 400.0 and unlinked["openOptions"] == 1
    assert "Some of today's trades have no account and are not counted." in got["lines"]
    assert "Open risk to stops in total: $400 (Not linked to an account $400)." in got["lines"]
    # Nothing open anywhere: then, and only then, "No open positions."
    with _conn() as c:
        c.execute("DELETE FROM j2_positions")
        c.execute("DELETE FROM j2_option_strategies")
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE_R)
    assert got["accounts"][0]["lines"][-1] == "No open positions."
    assert len(got["accounts"]) == 1


def test_revenge_reentry_held_into_a_later_session(S):
    with _conn() as c:
        trade(c, A, day="2026-10-20", pnl=-80, entry="09:40", exit_="10:00", symbol="NVDA")
        trade(c, A, day="2026-10-22", pnl=50, entry=et("2026-10-20", "10:15"), exit_="11:00",
              symbol="NVDA")
        # p4: a late loss and a re-entry exiting the next session; a loss across midnight.
        trade(c, A, day="2026-10-19", pnl=-80, entry="15:00", exit_="15:58", symbol="AMD")
        trade(c, A, day="2026-10-20", pnl=30, entry=et("2026-10-19", "16:20"), exit_="09:45",
              symbol="AMD")
        trade(c, A, day="2026-10-21", pnl=-60, entry="23:00", exit_="23:50", symbol="QQQ")
        trade(c, A, day="2026-10-22", pnl=10, entry="00:10", exit_="00:30", symbol="QQQ")
        c.commit()
    got = S.my_revenge_clean_days(A, {}, FRI_R)
    assert sorted((f["day"], f["symbol"]) for f in got["flagged"]) == [
        ("2026-10-20", "AMD"), ("2026-10-22", "NVDA"), ("2026-10-22", "QQQ")]


def test_revenge_reentry_entered_before_the_read_finds_the_older_loss(S):
    window = S.finished_sessions(FRI_R)
    from api.services.journal_two import trading_days
    old = trading_days.session_on_or_before(window[0] - timedelta(days=5)).isoformat()
    with _conn() as c:
        trade(c, A, day=old, pnl=-80, entry="09:40", exit_="10:00", symbol="NVDA")
        trade(c, A, day="2026-10-21", pnl=50, entry=et(old, "10:15"), exit_="11:00",
              symbol="NVDA")
        c.commit()
    got = S.my_revenge_clean_days(A, {}, FRI_R)
    assert got["flagged"] == [{"day": "2026-10-21", "symbol": "NVDA", "minutesApart": 15.0}]


def test_revenge_flag_day_is_a_counted_session(S):
    with _conn() as c:
        # Exits stamped on Saturday Oct 17 fold onto Friday Oct 16, the scan's fold.
        trade(c, A, day="2026-10-17", pnl=-80, entry=et("2026-10-17", "09:00"),
              exit_=et("2026-10-17", "09:30"), symbol="BTC")
        trade(c, A, day="2026-10-17", pnl=10, entry=et("2026-10-17", "09:40"),
              exit_=et("2026-10-17", "09:50"), symbol="BTC")
        c.commit()
    got = S.my_revenge_clean_days(A, {}, FRI_R)
    assert got["flagged"][0]["day"] == "2026-10-16"
    assert "2026-10-16" in [d.isoformat() for d in S.finished_sessions(FRI_R)]
    assert (got["clean"], got["checked"]) == (0, 1)                       # W10-R54
    assert {d["day"]: d["state"] for d in got["days"]}["2026-10-16"] == "flagged"


def test_noon_anchor_exit_is_date_only(S):
    from api.services.journal_two import options
    assert options.exit_is_date_only({"status": "expired", "closed_at": et("2026-10-20", "15:00")})
    assert options.exit_is_date_only({"status": "closed", "closed_at": et("2026-10-20", "12:00")})
    assert not options.exit_is_date_only({"status": "closed",
                                          "closed_at": et("2026-10-20", "12:01")})
    assert options.exit_is_date_only({"status": "closed", "closed_at": None})
    with _conn() as c:
        # An expired SPY strategy (closed_at = the 12:00 ET anchor), then a stock at 12:10 ET.
        strategy(c, A, pnl=-200, entry_iso=et("2026-10-13", "10:00"),
                 closed_iso=et("2026-10-20", "12:00"), day="2026-10-20", status="expired",
                 underlying="SPY")
        trade(c, A, day="2026-10-20", pnl=40, entry="12:10", exit_="12:40", symbol="SPY")
        c.commit()
    tilt = S.my_tilt_check(A, {}, NOW)
    assert tilt["after"]["n"] == 0 and tilt["other"]["n"] == 1
    assert tilt["datesOnly"] == 1                       # the strategy is not timed
    rev = S.my_revenge_clean_days(A, {}, NOW)
    assert rev["flagged"] == []


def test_capped_read_never_fabricates_clean(S, monkeypatch):
    with _conn() as c:
        trade(c, A, day="2026-10-13", pnl=-80, entry="10:00", exit_="10:10", symbol="NVDA")
        trade(c, A, day="2026-10-13", pnl=20, entry="10:20", exit_="10:40", symbol="NVDA")
        for d in ("2026-10-21", "2026-10-22", "2026-10-23"):
            trade(c, A, day=d, pnl=10, entry="10:00", exit_="10:10", symbol="MSFT")
        c.commit()
    assert S.my_revenge_clean_days(A, {}, FRI_R)["lines"] == ["3 of 4 clean"]   # W10-R54
    monkeypatch.setattr(S, "READ_LIMIT", 3)
    cut = S.my_revenge_clean_days(A, {}, FRI_R)
    assert cut["notRead"] == 28 and cut["clean"] == 2 and cut["checked"] == 2
    assert cut["lines"] == ["2 of 2 clean",
                            "28 days were not checked: this widget reads your newest 2 trades."]
    tilt = S.my_tilt_check(A, {}, FRI_R)
    assert tilt["lines"][0] == "Counting the newest 2 trades, from Oct 22."
    assert tilt["capped"] is True


def test_manually_flagged_trade_counts_in_money_widgets(S):
    with _conn() as c:
        account(c, A, "acc-a", pct=5.0, size=10000.0)
        trade(c, A, day="2026-10-20", pnl=-400, entry="10:00", exit_="10:10", account="acc-a",
              flagged=1)
        c.commit()
    blk = S.my_risk_left_today(A, {}, TUE_R)["accounts"][0]
    assert blk["left"] == 100.0
    assert blk["lines"][0] == "Room left today: $100 of $500."
    assert "Includes 1 trade you excluded from analytics." in blk["lines"]
    prop = S.my_prop_firm(A, {"since": "2026-10-01", "dailyLoss": 500}, TUE_R)
    assert prop["daily"]["used"] == 400.0
    assert prop["lines"] == ["Daily loss: $400 of $500 used; $100 left.",
                             "Includes 1 trade you excluded from analytics."]
    # Tilt keeps its exclusion.
    assert S.my_tilt_check(A, {}, NOW)["lines"] == ["No closed trades in this range."]
    # A data-error flag stays out of the money widgets; a 'manual' one stays in.
    with _conn() as c:
        c.execute("UPDATE j2_trades SET analytics_excluded_reason = 'phantom_short'")
        c.commit()
    blk = S.my_risk_left_today(A, {}, TUE_R)["accounts"][0]
    assert blk["left"] == 500.0 and not any("excluded" in s for s in blk["lines"])
    with _conn() as c:
        c.execute("UPDATE j2_trades SET analytics_excluded_reason = 'manual'")
        c.commit()
    assert S.my_risk_left_today(A, {}, TUE_R)["accounts"][0]["left"] == 100.0


def test_tilt_estimated_entries_only_sentence(S):
    with _conn() as c:
        trade(c, A, day="2026-10-20", pnl=-80, entry="10:00", exit_="10:10", estimated=True)
        trade(c, A, day="2026-10-20", pnl=20, entry="10:20", exit_="10:40", estimated=True)
        c.commit()
    assert S.my_tilt_check(A, {}, FRI_R)["lines"] == [
        "Tilt check needs real entry times; your entries are estimated."]


def test_room_left_reads_today_from_the_trading_days_scan(S):
    """Saturday: the session today is counted on is Friday, and a trade stamped on the weekend
    folds onto it, exactly as the trading-days scan folds it (the one authority)."""
    with _conn() as c:
        _one_account(c)
        trade(c, A, day="2026-10-23", pnl=-100, entry="10:00", exit_="10:30", account="acc-a")
        trade(c, A, day="2026-10-24", pnl=-50, entry="10:00", exit_="10:30", account="acc-a")
        trade(c, A, day="2026-10-22", pnl=-900, entry="10:00", exit_="10:30", account="acc-a")
        c.commit()
    got = S.my_risk_left_today(A, {}, NOW)                  # Saturday Oct 24
    assert got["session"] == "2026-10-23" and got["day"] == "2026-10-24"
    blk = got["accounts"][0]
    with _conn() as c:
        scan = S._day_nets(c, A, None, date(2026, 10, 23), date(2026, 10, 24))
    row = next(r for r in scan.rows if r["day"] == "2026-10-23")
    assert row["net"] == -150.0 and blk["net"] == row["net"]
    assert blk["lines"][0] == "Room left today: $350 of $500."
    # A holiday: Thanksgiving's trades fold onto Wednesday, never onto Black Friday.
    with _conn() as c:
        trade(c, A, day="2026-11-26", pnl=-300, entry="10:00", exit_="10:30", account="acc-a")
        c.commit()
    fri = S.my_risk_left_today(A, {}, datetime(2026, 11, 27, 18, 30, tzinfo=timezone.utc))
    assert fri["accounts"][0]["net"] == 0.0


def test_no_result_strategy_is_not_a_breakeven(S):
    with _conn() as c:
        _one_account(c)
        strategy(c, A, pnl=None, result="", entry_iso=et("2026-10-20", "09:45"),
                 closed_iso=et("2026-10-20", "11:00"), day="2026-10-20", account="acc-a")
        trade(c, A, day="2026-10-20", pnl=-100, entry="10:00", exit_="10:30", account="acc-a")
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE)
    assert got["accounts"][0]["net"] == -100.0
    assert "1 options trade with no result recorded is not counted." in got["lines"]
    tilt = S.my_tilt_check(A, {}, NOW)
    assert tilt["noResult"] == 1 and tilt["other"]["n"] == 1
    assert tilt["lines"][-1] == "1 options trade with no result recorded is not counted."


def test_revenge_bucket_cap_reads_as_not_checked(S, monkeypatch):
    with _conn() as c:
        trade(c, A, day="2026-10-20", pnl=-50, entry="10:00", exit_="10:10")
        trade(c, A, day="2026-10-20", pnl=20, entry="10:30", exit_="10:40")
        c.commit()
    monkeypatch.setattr(S, "MAX_BUCKET", 1)
    got = S.my_revenge_clean_days(A, {}, NOW)
    assert got["flagged"] == [] and got["tooMany"] == 1
    assert (got["clean"], got["checked"], got["noTrades"]) == (0, 0, 29)   # W10-R54
    assert got["lines"] == ["1 day was not checked: too many trades in one symbol to check."]


def test_prop_firm_keeps_the_scans_notices(S, monkeypatch):
    from api.services.journal_two.widget_engine import sources as wsources
    real = wsources.scan_days

    def with_notice(*a, **k):
        scan = real(*a, **k)
        scan.notices.append("That routine isn't available.")
        return scan

    monkeypatch.setattr(wsources, "scan_days", with_notice)
    got = S.my_prop_firm(A, {"since": "2026-10-01"}, FRI_R)
    assert got["notices"] == ["That routine isn't available."]


# ── fix round 2 (review of 0d4fe4f542) ─────────────────────────────────────────────────────────

def test_total_risk_includes_accounts_without_a_limit(S):
    with _conn() as c:
        account(c, A, "acc-a", pct=5.0, size=10000.0)
        account(c, A, "acc-b2", pct=None, size=10000.0, name="Other")
        position(c, A, acc="acc-a", symbol="AAPL", entry=100.0, stop=95.0, shares=20)   # $100
        position(c, A, acc="acc-b2", symbol="MSFT", entry=100.0, stop=90.0, shares=30)  # $300
        position(c, A, acc=None, symbol="TSLA", entry=200.0, stop=190.0, shares=40)     # $400
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE_R)
    assert got["openRisk"] == 800.0
    assert got["lines"][-1] == ("Open risk to stops in total: $800 (Main $100, Other $300, "
                                "Not linked to an account $400).")
    other = next(b for b in got["accounts"] if b["accountId"] == "acc-b2")
    assert other["openRisk"] == 300.0 and other["left"] is None and other["limit"] is None
    assert other["lines"] == ["Open risk to stops: $300."]           # risk only, no room left


def test_total_risk_includes_a_limited_account_without_size(S):
    with _conn() as c:
        account(c, A, "acc-a", pct=5.0, size=100000.0, marked=None)
        position(c, A, acc="acc-a", symbol="AAPL", entry=100.0, stop=95.0, shares=20)   # $100
        position(c, A, acc=None, symbol="TSLA", entry=200.0, stop=190.0, shares=40)     # $400
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE_R)
    assert got["openRisk"] == 500.0
    main = got["accounts"][0]
    assert main["openRisk"] == 100.0 and main["left"] is None
    assert main["lines"] == ["Set your account size to turn your daily loss limit into dollars.",
                             "Open risk to stops: $100."]
    assert got["lines"][-1] == ("Open risk to stops in total: $500 (Main $100, "
                                "Not linked to an account $400).")


def test_total_risk_includes_accounts_past_the_cap(S):
    with _conn() as c:
        for i in range(45):
            account(c, A, f"acc-{i:02d}", pct=None, size=10000.0, name=f"Acct {i:02d}")
            position(c, A, acc=f"acc-{i:02d}", symbol="AAPL", entry=100.0, stop=99.0, shares=10)
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE_R)
    assert len(got["accounts"]) == 40 and got["truncated"] == 5
    assert got["openRisk"] == 450.0
    assert "5 more accounts: $50 at risk." in got["lines"]
    assert got["lines"][-1].startswith("Open risk to stops in total: $450 (")
    assert got["lines"][-1].endswith(", and 38 others).")       # 40 blocks + "5 more accounts"


def test_placeholder_only_open_risk_is_unknown_never_zero(S):
    with _conn() as c:
        account(c, A, "acc-a", pct=5.0, size=10000.0)
        position(c, A, acc="acc-a", symbol="AAPL", entry=100.0, stop=100.0, shares=20)
        position(c, A, acc=None, symbol="TSLA", entry=200.0, stop=200.0, shares=40)
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE_R)
    main, unlinked = got["accounts"]
    assert got["openRisk"] is None and unlinked["openRisk"] is None and main["openRisk"] is None
    assert main["afterStops"] is None
    assert main["lines"] == ["Room left today: $500 of $500.",
                             "1 position has no stop set and is not in the open risk."]
    assert unlinked["lines"] == ["1 position has no stop set and is not in the open risk."]
    assert not any(ln.startswith("Open risk to stops") for ln in got["lines"])
    from api.services import portfolio_heat
    assert S._risk_of(portfolio_heat.portfolio_heat(
        A, None, 1.0, positions_fn=lambda _u, _a: [], regime_fn=lambda: {},
        cap_fn=lambda: None))["risk"] is None
    assert S._known_sum([None, None]) is None and S._known_sum([None, 2.0, 3.0]) == 5.0


def test_deleted_account_lines_in_order(S):
    with _conn() as c:
        account(c, A, "acc-a", pct=5.0, size=10000.0)
        position(c, A, acc="acc-gone", symbol="TSLA", entry=200.0, stop=190.0, shares=40)  # $400
        strategy(c, A, pnl=-5, entry_iso=et("2026-10-20", "09:45"), closed_iso=None,
                 status="open", account="acc-gone")
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE_R)
    main, unlinked = got["accounts"]
    assert main["lines"] == [
        "Room left today: $500 of $500.",
        "This account holds nothing open.",
        "If every stop is hit, including positions not linked to an account: $100 left.",
    ]
    assert unlinked["openOptions"] == 1 and unlinked["openRisk"] == 400.0


def test_unreadable_positions_say_so(S, monkeypatch):
    with _conn() as c:
        account(c, A, "acc-a", pct=5.0, size=10000.0)
        c.commit()
    from api.services.journal_two import positions as j2_positions

    def boom(*a, **k):
        raise RuntimeError("database is locked")

    monkeypatch.setattr(j2_positions, "list_open_positions", boom)
    got = S.my_risk_left_today(A, {}, TUE_R)
    assert got["lines"][0] == "Your open positions couldn't be read right now."
    assert got["openRisk"] is None
    assert got["accounts"][0]["lines"] == ["Room left today: $500 of $500."]
    assert got["accounts"][0]["openRisk"] is None


def test_older_exit_lookup_nearest_first_options_and_overflow(S, monkeypatch):
    window = S.finished_sessions(FRI_R)
    read_lo = S.trading_days.session_on_or_before(window[0] - timedelta(days=1))
    old = S.trading_days.session_on_or_before(read_lo - timedelta(days=20)).isoformat()
    with _conn() as c:
        # An options LOSS long before the window, and a re-entry in the same underlying 15 minutes
        # later, held into the window.
        strategy(c, A, pnl=-120, entry_iso=et(old, "09:30"), closed_iso=et(old, "10:00"),
                 day=old, underlying="NVDA")
        trade(c, A, day="2026-10-21", pnl=50, entry=et(old, "10:15"), exit_="11:00",
              symbol="NVDA")
        # Newer NVDA trades between the entry and the window: a newest-first read would spend
        # its rows on these and never reach the loss.
        for k in (3, 6, 9):
            d = S.trading_days.session_on_or_before(read_lo - timedelta(days=k)).isoformat()
            trade(c, A, day=d, pnl=5, entry="13:00", exit_="13:30", symbol="NVDA")
        c.commit()
    monkeypatch.setattr(S, "READ_LIMIT", 3)
    got = S.my_revenge_clean_days(A, {}, FRI_R)
    assert got["flagged"] == [{"day": "2026-10-21", "symbol": "NVDA", "minutesApart": 15.0}]
    assert got["olderNotRead"] == 0
    # Overflow right at the entry: said so, and never counted clean.
    with _conn() as c:
        for i in range(3):
            trade(c, A, day=old, pnl=5, entry="13:00", exit_="13:30", symbol="NVDA")
        c.commit()
    cut = S.my_revenge_clean_days(A, {}, FRI_R)
    assert cut["olderNotRead"] == 1
    assert cut["lines"][-1] == ("1 day was not checked: too many older trades to look back "
                                "over.")


def test_flagged_by_hand_overflow_and_no_result_by_et_day(S, monkeypatch):
    with _conn() as c:
        account(c, A, "acc-a", pct=5.0, size=10000.0)
        for i in range(3):
            trade(c, A, day="2026-10-20", pnl=-10, entry="10:00", exit_="10:10",
                  account="acc-a", flagged=1, symbol=f"F{i}")
        # Closed 2026-10-21T00:30Z with no spine stamp: 20:30 ET on Oct 20 (today).
        strategy(c, A, pnl=None, result="", entry_iso=et("2026-10-20", "09:45"),
                 closed_iso="2026-10-21T00:30:00Z", account="acc-a")
        # Closed 2026-10-20T00:30Z: 20:30 ET on Oct 19 (not today).
        strategy(c, A, pnl=None, result="", entry_iso=et("2026-10-19", "09:45"),
                 closed_iso="2026-10-20T00:30:00Z", account="acc-a")
        c.commit()
    got = S.my_risk_left_today(A, {}, datetime(2026, 10, 21, 1, 0, tzinfo=timezone.utc))
    assert "1 options trade with no result recorded is not counted." in got["lines"]
    monkeypatch.setattr(S, "READ_LIMIT", 3)
    got = S.my_risk_left_today(A, {}, TUE_R)
    assert "Only your newest 2 trades excluded from analytics are counted." in got["lines"]
    assert "Includes 2 trades you excluded from analytics." in got["accounts"][0]["lines"]



# ── round 3 ────────────────────────────────────────────────────────────────────────────────────

def test_an_unreadable_group_makes_the_total_unknown(S, monkeypatch):
    with _conn() as c:
        account(c, A, "acc-a", pct=5.0, size=10000.0)
        position(c, A, acc="acc-a", symbol="AAPL", entry=100.0, stop=95.0, shares=20)   # $100
        position(c, A, acc=None, symbol="TSLA", entry=200.0, stop=190.0, shares=40)     # $400
        c.commit()
    real = S._heat

    def heat(user_id, account_id, size, positions):
        return {"ok": False} if account_id is None else real(user_id, account_id, size, positions)

    monkeypatch.setattr(S, "_heat", heat)
    got = S.my_risk_left_today(A, {}, TUE_R)
    assert got["openRisk"] is None
    assert got["lines"][0] == "Your open positions couldn't be read right now."
    assert not any(ln.startswith("Open risk to stops in total") for ln in got["lines"])
    main, unlinked = got["accounts"]
    assert main["openRisk"] == 100.0                     # a readable block keeps its own number
    assert unlinked["openRisk"] is None
    assert unlinked["lines"] == ["Your open positions couldn't be read right now."]


def test_a_position_heat_skips_is_counted(S):
    with _conn() as c:
        account(c, A, "acc-a", pct=5.0, size=10000.0)
        position(c, A, acc="acc-a", symbol="AAPL", entry=100.0, stop=95.0, shares=20)   # $100
        position(c, A, acc="acc-a", symbol="", entry=100.0, stop=95.0, shares=20)       # skipped
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE_R)
    main = got["accounts"][0]
    assert main["openRisk"] == 100.0
    assert "1 position couldn't be read and is not in the open risk." in main["lines"]
    assert "1 position couldn't be read and is not in the open risk." in got["lines"]


def test_a_block_holding_only_unreadable_positions_is_not_called_empty(S):
    # A position heat cannot read is still open: the block says it couldn't be read and never
    # also says it holds nothing.
    with _conn() as c:
        account(c, A, "acc-a", pct=5.0, size=10000.0)
        position(c, A, acc="acc-a", symbol="", entry=100.0, stop=95.0, shares=20)       # skipped
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE_R)
    main = got["accounts"][0]
    assert main["openRisk"] is None
    assert "1 position couldn't be read and is not in the open risk." in main["lines"]
    for empty in (S.S_RISK_NO_POSITIONS, S.S_RISK_NONE_HERE):
        assert empty not in main["lines"]
        assert empty not in got["lines"]


def test_total_line_names_the_largest_three(S):
    with _conn() as c:
        account(c, A, "acc-a", pct=5.0, size=10000.0, name="Main")
        account(c, A, "acc-s", pct=None, size=10000.0, name="Swing")
        position(c, A, acc="acc-a", symbol="AAPL", entry=100.0, stop=70.0, shares=100)   # $3,000
        position(c, A, acc="acc-s", symbol="MSFT", entry=100.0, stop=75.0, shares=100)   # $2,500
        position(c, A, acc=None, symbol="TSLA", entry=200.0, stop=190.0, shares=40)      # $400
        for i in range(37):            # 39 accounts + unlinked: 40 blocks, none past the cap
            account(c, A, f"acc-{i:02d}", pct=None, size=10000.0, name=f"Small {i:02d}")
            position(c, A, acc=f"acc-{i:02d}", symbol="AMD", entry=100.0, stop=99.0,
                     shares=108 if i < 20 else 107)
        c.commit()
    got = S.my_risk_left_today(A, {}, TUE_R)
    small = math.fsum(108.0 if i < 20 else 107.0 for i in range(37))
    assert got["openRisk"] == 3000.0 + 2500.0 + 400.0 + small
    assert got["lines"][-1] == (
        f"Open risk to stops in total: ${int(5900 + small):,} (Main $3,000, Swing $2,500, "
        "Not linked to an account $400, and 37 others).")
    # Every block still carries its own number.
    assert "truncated" not in got
    assert math.fsum(b["openRisk"] for b in got["accounts"]) == got["openRisk"]


# -- W10-R54: the per-day list ------------------------------------------------------------------

def _check_days(S, got):
    """The four invariants between `days` and the counts, and the closed vocabulary."""
    days = got["days"]
    assert len(days) == got["window"] == S.WINDOW
    assert {d["state"] for d in days} <= set(S.DAY_STATES)
    by = {s: sum(1 for d in days if d["state"] == s) for s in S.DAY_STATES}
    assert by["clean"] == got["clean"]
    assert by["flagged"] == got["checked"] - got["clean"]
    assert by["no_trades"] == got["noTrades"]
    assert by["not_checked"] == (got["notChecked"] + got["notRead"] + got["tooMany"]
                                 + got["olderNotRead"])
    state = {d["day"]: d["state"] for d in days}
    for f in got["flagged"]:
        assert state[f["day"]] == "flagged"


def test_revenge_days_are_the_window_oldest_first(S):
    window = [d.isoformat() for d in S.finished_sessions(NOW)]
    got = S.my_revenge_clean_days(A, {}, NOW)
    assert [d["day"] for d in got["days"]] == window
    assert window == sorted(window) and got["days"][0]["day"] == got["from"]
    assert got["days"][-1]["day"] == got["to"]
    _check_days(S, got)


def test_revenge_brand_new_member_has_no_clean_day(S):
    got = S.my_revenge_clean_days("u-brand-new", {}, NOW)
    assert [d["state"] for d in got["days"]] == ["no_trades"] * 30
    assert (got["clean"], got["checked"], got["noTrades"]) == (0, 0, 30)
    assert got["lines"] == [S.S_REVENGE_NO_TRADES]
    no_zero_strings({k: v for k, v in got.items() if k != "days"})
    _check_days(S, got)


def test_revenge_days_hold_all_four_states(S):
    window = [d.isoformat() for d in S.finished_sessions(NOW)]
    clean_day, flag_day, dates_day = window[-1], window[-2], window[-3]
    with _conn() as c:
        trade(c, A, day=clean_day, pnl=40, entry="10:00", exit_="10:30")
        trade(c, A, day=flag_day, pnl=-50, entry="10:00", exit_="10:10")
        trade(c, A, day=flag_day, pnl=20, entry="10:30", exit_="10:40")
        trade(c, A, day=dates_day, pnl=-50)
        c.commit()
    got = S.my_revenge_clean_days(A, {}, NOW)
    state = {d["day"]: d["state"] for d in got["days"]}
    assert state[clean_day] == "clean" and state[flag_day] == "flagged"
    assert state[dates_day] == "not_checked" and state[window[0]] == "no_trades"
    assert (got["clean"], got["checked"], got["notChecked"], got["noTrades"]) == (1, 2, 1, 27)
    assert got["lines"] == ["1 of 2 clean (1 day with dates only was not checked)"]
    _check_days(S, got)


def test_revenge_one_dates_only_day_says_only_the_days_traded(S):
    """W10-R57: one dates-only day and 29 days with no trades: the sentence speaks of the days traded only."""
    window = [d.isoformat() for d in S.finished_sessions(NOW)]
    with _conn() as c:
        trade(c, A, day=window[-1], pnl=-50)
        c.commit()
    got = S.my_revenge_clean_days(A, {}, NOW)
    assert (got["noTrades"], got["notChecked"], got["checked"]) == (29, 1, 0)
    assert got["lines"] == ["None of the days you traded in the last 30 trading days could be checked; "
                            "your trades have dates only."]
    assert got["lines"] == [S.S_REVENGE_NONE_CHECKED]
    _check_days(S, got)


def test_revenge_dates_only_day_is_said_beside_a_crowded_day(S, monkeypatch):
    """N-3: checked == 0 with a crowded day present still says the dates-only day, never the
    "none of the days you traded" sentence (not every traded day is dates-only)."""
    window = [d.isoformat() for d in S.finished_sessions(NOW)]
    with _conn() as c:
        trade(c, A, day=window[-1], pnl=-50)                                       # dates only
        trade(c, A, day=window[-2], pnl=-50, entry="10:00", exit_="10:10")
        trade(c, A, day=window[-2], pnl=20, entry="10:30", exit_="10:40")
        c.commit()
    monkeypatch.setattr(S, "MAX_BUCKET", 1)
    got = S.my_revenge_clean_days(A, {}, NOW)
    assert (got["checked"], got["notChecked"], got["tooMany"]) == (0, 1, 1)
    assert got["lines"] == ["1 day with dates only was not checked.",
                            "1 day was not checked: too many trades in one symbol to check."]
    _check_days(S, got)


def test_revenge_capped_list_says_how_many_are_not_shown(S, monkeypatch):
    """N-2: the re-entries list is capped; the server says how many it left out."""
    window = [d.isoformat() for d in S.finished_sessions(NOW)]
    with _conn() as c:
        for k in window[-3:]:
            trade(c, A, day=k, pnl=-50, entry="10:00", exit_="10:10")
            trade(c, A, day=k, pnl=20, entry="10:30", exit_="10:40")
        c.commit()
    monkeypatch.setattr(S, "ROW_CAP", 1)
    got = S.my_revenge_clean_days(A, {}, NOW)
    assert len(got["flagged"]) == 1 and got["truncated"] == 2
    assert got["lines"][-1] == "2 more re-entries not shown."
    monkeypatch.setattr(S, "ROW_CAP", 2)
    assert S.my_revenge_clean_days(A, {}, NOW)["lines"][-1] == "1 more re-entry not shown."
    monkeypatch.setattr(S, "ROW_CAP", 40)
    full = S.my_revenge_clean_days(A, {}, NOW)
    assert "truncated" not in full and not any("not shown" in ln for ln in full["lines"])


def test_revenge_dates_only_days_are_said_beside_every_day_flagged(S):
    """Round 3: clean == 0 and checked > 0 with dates-only days: S_REVENGE_EVERY_DAY, and the dates-only days too."""
    window = [d.isoformat() for d in S.finished_sessions(NOW)]
    with _conn() as c:
        trade(c, A, day=window[-1], pnl=-50, entry="10:00", exit_="10:10")
        trade(c, A, day=window[-1], pnl=20, entry="10:30", exit_="10:40")        # a re-entry
        trade(c, A, day=window[-2], pnl=-50)                                       # dates only
        trade(c, A, day=window[-3], pnl=-40)                                       # dates only
        c.commit()
    got = S.my_revenge_clean_days(A, {}, NOW)
    assert (got["clean"], got["checked"], got["notChecked"]) == (0, 1, 2)
    assert got["lines"] == [S.S_REVENGE_EVERY_DAY, "2 days with dates only were not checked."]
    _check_days(S, got)


def test_revenge_no_dates_only_line_without_dates_only_days(S):
    """CONTROL: every day flagged and no dates-only day: the headline alone."""
    window = [d.isoformat() for d in S.finished_sessions(NOW)]
    with _conn() as c:
        trade(c, A, day=window[-1], pnl=-50, entry="10:00", exit_="10:10")
        trade(c, A, day=window[-1], pnl=20, entry="10:30", exit_="10:40")
        c.commit()
    got = S.my_revenge_clean_days(A, {}, NOW)
    assert got["notChecked"] == 0
    assert got["lines"] == [S.S_REVENGE_EVERY_DAY]
    assert not any("dates only" in ln for ln in got["lines"])

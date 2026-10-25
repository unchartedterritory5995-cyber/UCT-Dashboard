"""Task 10.10: the dedicated discipline builders (tilt check, revenge clean days, risk left today,
prop-firm rules).

Real auth.db schema (auth_db.init_db) in a tmp dir; trades, option strategies, positions and
accounts are seeded straight into their tables; `now` is injected. Dates are real 2026 sessions,
times are written in ET and stored as UTC instants (the way the broker and the app store them).
"""
from __future__ import annotations

import dataclasses
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
    assert (got["clean"], got["checked"], got["notChecked"]) == (28, 29, 1)
    assert got["flagged"] == [{"day": "2026-10-20", "symbol": "NVDA", "minutesApart": 20.0}]
    assert got["lines"] == ["28 of 29 clean (1 day with dates only was not checked)"]
    with _conn() as c:
        trade(c, A, day="2026-10-22", pnl=-500)
        c.commit()
    got = S.my_revenge_clean_days(A, {}, NOW)
    assert got["lines"] == ["27 of 28 clean (2 days with dates only were not checked)"]


def test_dismissed_pair_is_clean(S, monkeypatch):
    with _conn() as c:
        loss = trade(c, A, day="2026-10-20", pnl=-50, entry="10:00", exit_="10:10")
        again = trade(c, A, day="2026-10-20", pnl=20, entry="10:30", exit_="10:40")
        c.commit()
    assert S.my_revenge_clean_days(A, {}, NOW)["lines"] == ["29 of 30 clean"]
    seen = []

    def _pairs(conn, uid):
        seen.append(uid)
        return frozenset({f"id:{loss}->id:{again}"})

    monkeypatch.setattr(S, "_dismissed_pairs", _pairs)
    got = S.my_revenge_clean_days(A, {}, NOW)
    assert seen == [A]
    assert got["flagged"] == [] and got["lines"] == ["30 of 30 clean"]


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
    assert got["lines"] == ["None of the last 30 trading days could be checked; "
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
    assert len(counted) >= 6
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

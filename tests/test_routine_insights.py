"""Task 9.7: "vs P&L" comparisons and suggestions from the member's own trades.

Real auth.db schema (auth_db.init_db) in a tmp dir; trades, option strategies and ticks are seeded
straight into their tables; `now` is injected (the router never passes it). Dates are real 2026
sessions (ET).
"""
from __future__ import annotations

import importlib
import uuid
from datetime import date, datetime, timezone

import pytest

A, B = "u-ins-a", "u-ins-b"
#: Wednesday 2026-10-28, noon ET: every seeded day below is finished.
NOW = datetime(2026, 10, 28, 16, 0, tzinfo=timezone.utc)
CREATED = datetime(2026, 8, 3, 16, 0, tzinfo=timezone.utc)
STAMP = "2026-08-01T00:00:00Z"


@pytest.fixture
def I(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import routine_insights
    yield routine_insights
    importlib.reload(auth_db)


def _conn():
    from api.services import auth_db
    return auth_db.get_connection()


def sessions(n, lo="2026-08-04"):
    from api.services.journal_two import trading_days
    days = trading_days.sessions(date.fromisoformat(lo), date(2026, 10, 27)).days
    return [d.isoformat() for d in days[:n]]


def trade(c, uid, *, day, pnl, fees=0.0, result=None, entry="T14:00:00Z", exit_="T15:00:00Z",
          stop=95.0, entry_price=100.0, symbol="NVDA", flagged=0, account=None):
    result = result or ("Win" if pnl > 0 else "Loss" if pnl < 0 else "BE")
    entry_iso = day + entry if entry.startswith("T") else entry
    exit_iso = day + exit_ if exit_.startswith("T") else exit_
    c.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price,"
        " entry_date, exit_price, exit_date, original_stop, pnl_dollar, pnl_percent, hold_days,"
        " result, context_at_entry, created_at, trading_day_et, fees, analytics_excluded,"
        " account_id) VALUES (?, ?, ?, ?, 'Long', 10, ?, ?, 110, ?, ?, ?, 0.01, 0, ?, '{}', ?,"
        " ?, ?, ?, ?)",
        (str(uuid.uuid4()), uid, str(uuid.uuid4()), symbol, entry_price, entry_iso, exit_iso,
         stop, pnl, result, STAMP, day, fees, flagged, account))


def strategy(c, uid, *, day, pnl, result="Win"):
    c.execute(
        "INSERT INTO j2_option_strategies (id, user_id, underlying, strategy_type, direction,"
        " net_entry, entry_date, status, closed_at, pnl_dollar, result, created_at, updated_at,"
        " trading_day_et) VALUES (?, ?, 'SPY', 'long_call', 'bullish', 100, ?, 'closed', ?, ?,"
        " ?, ?, ?, ?)",
        (str(uuid.uuid4()), uid, f"{day}T14:00:00Z", f"{day}T19:00:00Z", pnl, result, STAMP,
         STAMP, day))


def routine(uid=A, *, items=None, now=CREATED, schedule=None):
    from api.services.journal_two import routines
    return routines.create(uid, name="Morning", items=items or [{"text": "Read the wire"}],
                           schedule=schedule or {"kind": "every"}, now=now)


def tick_all(c, uid, r, day):
    for it in r["items"]:
        c.execute("INSERT INTO j2_routine_ticks (user_id, routine_id, day, item_id, ticked,"
                  " updated_at) VALUES (?, ?, ?, ?, 1, ?)", (uid, r["id"], day, it["id"], STAMP))


def skip(c, uid, r, day):
    c.execute("INSERT INTO j2_routine_days (user_id, routine_id, day, skipped, updated_at)"
              " VALUES (?, ?, ?, 1, ?)", (uid, r["id"], day, STAMP))


def seed_done_other(c, r, *, done=22, other=9, done_pnl=95.0, other_pnl=-40.0):
    days = sessions(done + other)
    for d in days[:done]:
        tick_all(c, A, r, d)
        trade(c, A, day=d, pnl=done_pnl)
    for i, d in enumerate(days[done:]):
        if i % 3 == 0:
            skip(c, A, r, d)           # skipped counts as "other"
        trade(c, A, day=d, pnl=other_pnl)
    c.commit()
    return days


# ── money ──────────────────────────────────────────────────────────────────────────────────────

def test_money_whole_dollars_and_minus_sign(I):
    assert I.money(95) == "+$95"
    assert I.money(-40) == "−$40"
    assert I.money(0) == "$0" and I.money(0.4) == "$0" and I.money(-0.4) == "$0"
    assert I.money(94.5) == "+$95" and I.money(-2.5) == "−$3"
    assert I.money(1250.2) == "+$1,250"
    assert I.money(float("nan")) == "$0"


# ── routine vs P&L ─────────────────────────────────────────────────────────────────────────────

def test_sentence_exact_and_caveat_always(I):
    r = routine()
    with _conn() as c:
        seed_done_other(c, r)
    got = I.routine_vs_pnl(A, r["id"], now=NOW)
    assert got["sentence"] == ("On days you finished it: +$95 average (22 days). "
                               "Other days: −$40 (9 days). A comparison, not proof.")
    assert got["done"] == {"avg": 95.0, "n": 22, "sample": "", "text": "+$95 average (22 days)"}
    assert got["other"]["n"] == 9 and got["other"]["avg"] == -40.0
    assert got["other"]["sample"] == "small"
    assert got["sentence"].endswith(I.CAVEAT)
    # a routine with no days at all still ends with the caveat
    empty = routine(now=NOW)
    e = I.routine_vs_pnl(A, empty["id"], now=NOW)
    assert e["sentence"] == "No days with trades yet. A comparison, not proof."


def test_counts_only_days_with_trades_and_includes_options(I):
    r = routine()
    days = sessions(8)
    with _conn() as c:
        for d in days[:6]:
            tick_all(c, A, r, d)
        for d in days[:5]:
            trade(c, A, day=d, pnl=100.0, fees=10.0)        # net of fees: 90
        strategy(c, A, day=days[0], pnl=50.0)               # day 0: 90 + 50 = 140
        # days[5] is done with no trades; days[6], days[7] are not done with no trades
        trade(c, A, day=days[1], pnl=-1000.0, flagged=1)    # flagged: left out
        c.commit()
    got = I.routine_vs_pnl(A, r["id"], now=NOW)
    assert got["done"]["n"] == 5
    assert got["done"]["avg"] == pytest.approx((140 + 90 * 4) / 5)
    assert got["other"]["n"] == 0 and got["other"]["text"] == I.S_NO_DAYS


def test_under_5_not_enough_with_count_and_zero_says_no_days(I):
    r = routine()
    days = sessions(4)
    with _conn() as c:
        for d in days[:3]:
            tick_all(c, A, r, d)
            trade(c, A, day=d, pnl=50.0)
        c.commit()
    got = I.routine_vs_pnl(A, r["id"], now=NOW)
    assert got["done"] == {"avg": None, "n": 3, "sample": "hide",
                           "text": "Not enough days yet (3)"}
    assert got["other"] == {"avg": None, "n": 0, "sample": "hide", "text": I.S_NO_DAYS}
    assert got["sentence"] == ("On days you finished it: Not enough days yet (3). "
                               "Other days: No days with trades yet. A comparison, not proof.")
    assert "(0)" not in got["sentence"] and "$0" not in got["sentence"]


def test_small_badge_under_20(I):
    r = routine()
    with _conn() as c:
        seed_done_other(c, r, done=19, other=20)
    got = I.routine_vs_pnl(A, r["id"], now=NOW)
    assert (got["done"]["n"], got["done"]["sample"]) == (19, "small")
    assert (got["other"]["n"], got["other"]["sample"]) == (20, "")
    assert got["done"]["avg"] == 95.0


def test_win_rate_excludes_breakeven(I):
    r = routine()
    days = sessions(6)
    with _conn() as c:
        for d in days[:5]:
            tick_all(c, A, r, d)
            trade(c, A, day=d, pnl=100.0)
            trade(c, A, day=d, pnl=0.0)                      # breakeven: not decisive
        trade(c, A, day=days[0], pnl=-10.0)                  # day 0: 1 win, 1 loss
        trade(c, A, day=days[5], pnl=0.0)                    # an all-breakeven other day
        c.commit()
    got = I.routine_vs_pnl(A, r["id"], now=NOW)
    wr = got["winRate"]["done"]
    assert wr["n"] == 5 and wr["avg"] == pytest.approx(5 / 6)
    assert wr["text"] == "83% win rate (5 days)"
    # the breakeven-only day had trades (it counts for P&L) but no decisive trade
    assert got["other"]["n"] == 1 and got["winRate"]["other"]["n"] == 0


def test_foreign_and_deleted_routine_is_none(I):
    from api.services.journal_two import routines
    mine = routine()
    theirs = routine(B)
    assert I.routine_vs_pnl(A, theirs["id"], now=NOW) is None
    assert I.routine_vs_pnl(B, mine["id"], now=NOW) is None
    assert I.routine_vs_pnl(A, "nope", now=NOW) is None
    routines.archive(A, mine["id"], now=NOW)
    assert I.routine_vs_pnl(A, mine["id"], now=NOW) is not None      # archived keeps history
    routines.soft_delete(A, mine["id"], typed_name="Morning", now=NOW)
    assert I.routine_vs_pnl(A, mine["id"], now=NOW) is None


def test_only_the_members_trades(I):
    r = routine()
    with _conn() as c:
        seed_done_other(c, r, done=6, other=0)
        for d in sessions(6):
            trade(c, B, day=d, pnl=-5000.0)                  # someone else's book
        c.commit()
    got = I.routine_vs_pnl(A, r["id"], now=NOW)
    assert got["done"]["avg"] == 95.0 and got["done"]["n"] == 6


def test_today_is_not_counted_yet(I):
    """W9-R13: as of the last finished day; today's done day waits for tomorrow."""
    r = routine()
    today = "2026-10-28"
    with _conn() as c:
        seed_done_other(c, r, done=5, other=0)
        tick_all(c, A, r, today)
        trade(c, A, day=today, pnl=5000.0)
        c.commit()
    assert I.routine_vs_pnl(A, r["id"], now=NOW)["done"]["avg"] == 95.0


def test_history_agrees_with_the_built_widgets_routine_done(I):
    """The states the comparison reads are the ones a built widget split by `routine_done` reads."""
    from api.services.journal_two import routines
    from api.services.journal_two.widget_engine import plan as wplan
    from api.services.journal_two.widget_engine import run as wrun
    from api.services.journal_two.widget_engine import sources as wsources
    r = routine()
    with _conn() as c:
        seed_done_other(c, r, done=7, other=6)
        today = date(2026, 10, 28)
        hist = routines.history_for(c, A, r["id"], date(2026, 10, 27), today)[r["id"]]
        plan = dict(wrun._cover_plan("trading_days"))
        plan["split"] = {"by": "routine_done", "ref": r["id"]}
        rows = wsources.scan_days(c, plan, {"accountId": None},
                                  wplan.ResolvedRange(None, "2026-10-27", None, "all", "all"),
                                  A, today=today).rows
    words = {s.day: wsources.STATE_WORDS[s.state] for s in hist.states
             if s.state in wsources.STATE_WORDS}
    seen = {x["day"]: x["routine_done"] for x in rows if x["routine_done"]}
    assert seen and seen == {d: w for d, w in words.items() if d in seen}
    assert sum(1 for w in seen.values() if w == "Done") == 7


def test_history_for_public_door_owned_only(I):
    from api.services.journal_two import routines
    mine, theirs = routine(), routine(B)
    with _conn() as c:
        got = routines.history_for(c, A, [mine["id"], theirs["id"], "nope"],
                                   date(2026, 8, 10), date(2026, 10, 28))
    assert list(got) == [mine["id"]]
    h = got[mine["id"]]
    assert h.name == "Morning" and h.created == date(2026, 8, 3)
    assert [s.day for s in h.states][-1] == "2026-08-10"
    assert {s.state for s in h.states} <= {"not_done", "off"}


# ── tracker vs P&L ─────────────────────────────────────────────────────────────────────────────

def _tracker(uid=A, name="Sleep", kind="duration"):
    from api.services.journal_two import trackers
    return trackers.create(uid, name=name, kind=kind, now=CREATED)


def _value(c, uid, tid, day, v):
    c.execute("INSERT INTO j2_tracker_values (user_id, tracker_id, day, value, updated_at)"
              " VALUES (?, ?, ?, ?, ?)", (uid, tid, day, v, STAMP))


def test_tracker_buckets_sentence(I):
    t = _tracker()
    days = sessions(32)
    with _conn() as c:
        for d in days[:9]:
            _value(c, A, t["id"], d, 300)            # 5h: under 6h
            trade(c, A, day=d, pnl=-210.0)
        for d in days[9:31]:
            _value(c, A, t["id"], d, 360)            # 6h
            trade(c, A, day=d, pnl=95.0)
        _value(c, A, t["id"], days[31], 480)         # 8h, a day with no trades
        _value(c, A, t["id"], "2026-10-28", 100)     # today: not counted (W9-R13)
        trade(c, A, day="2026-10-28", pnl=9999.0)
        c.commit()
    got = I.tracker_vs_pnl(A, t["id"], now=NOW)
    assert got["sentence"] == ("Sleep under 6h: avg day −$210 (9 days); 6h-8h: +$95 "
                               "(22 days). A comparison, not proof.")
    assert [b["label"] for b in got["buckets"]] == ["Under 6h", "6h-8h", "8h or more"]
    assert got["buckets"][2] == {"label": "8h or more", "avg": None, "n": 0, "sample": "hide",
                                 "text": I.S_NO_DAYS}
    assert got["buckets"][0]["sample"] == "small" and got["buckets"][1]["sample"] == ""


def test_tracker_not_enough_and_no_days_and_foreign(I):
    t = _tracker(name="Walk", kind="yesno")
    assert I.tracker_vs_pnl(A, t["id"], now=NOW)["sentence"] == \
        "No days with trades yet. A comparison, not proof."
    with _conn() as c:
        for d in sessions(3):
            _value(c, A, t["id"], d, 1)
            trade(c, A, day=d, pnl=10.0)
        c.commit()
    got = I.tracker_vs_pnl(A, t["id"], now=NOW)
    assert got["sentence"] == "Walk yes: Not enough days yet (3). A comparison, not proof."
    assert I.tracker_vs_pnl(B, t["id"], now=NOW) is None
    assert I.tracker_vs_pnl(A, "nope", now=NOW) is None
    assert I.tracker_vs_pnl(A, "checkin:mood", now=NOW)["sentence"].endswith(I.CAVEAT)


# ── suggestions ────────────────────────────────────────────────────────────────────────────────

RULES = [
    {"text": "Stop on every trade", "suggest": {"rule": "stop_every_trade"}},
    {"text": "Max 3 trades", "suggest": {"rule": "max_trades", "n": 3}},
    {"text": "Under my loss limit", "suggest": {"rule": "under_daily_loss_limit"}},
    {"text": "No trade within 10 min of a loss", "negative": True,
     "suggest": {"rule": "no_trade_after_loss", "n": 10}},
    {"text": "No revenge trades", "negative": True, "suggest": {"rule": "no_revenge"}},
    {"text": "Read the wire"},
]
OCT20 = datetime(2026, 10, 20, 16, 0, tzinfo=timezone.utc)


def _rules_routine():
    r = routine(items=RULES, now=OCT20)
    return r, {i["text"]: i["id"] for i in r["items"]}


def _read(rid, days, now):
    from api.services.journal_two import routines
    out = routines.read_days(A, [rid], days, now=now)
    return {d: e["suggested"] for d, e in out["routines"][rid]["days"].items()}


def test_suggestion_never_written(I):
    r, ids = _rules_routine()
    with _conn() as c:
        trade(c, A, day="2026-10-26", pnl=50.0)
        c.commit()
        before = [c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                  for t in ("j2_routine_ticks", "j2_routine_days")]
    got = _read(r["id"], ["2026-10-26"], NOW)
    assert ids["Stop on every trade"] in got["2026-10-26"]       # non-vacuity: it suggested
    with _conn() as c:
        after = [c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                 for t in ("j2_routine_ticks", "j2_routine_days")]
    assert before == after == [0, 0]
    from api.services.journal_two import routines
    entry = routines.read_days(A, [r["id"]], ["2026-10-26"], now=NOW)["routines"][r["id"]]
    assert entry["days"]["2026-10-26"]["state"] == "not_done"    # a suggestion is not a tick


def test_suggestion_only_after_close_and_with_trades(I):
    r, ids = _rules_routine()
    with _conn() as c:
        trade(c, A, day="2026-10-27", pnl=50.0)
        c.commit()
    at_3pm = datetime(2026, 10, 27, 19, 0, tzinfo=timezone.utc)       # 15:00 ET
    at_401 = datetime(2026, 10, 27, 20, 1, tzinfo=timezone.utc)       # 16:01 ET
    assert _read(r["id"], ["2026-10-27", "2026-10-26"], at_3pm) == {"2026-10-27": [],
                                                                    "2026-10-26": []}
    after = _read(r["id"], ["2026-10-27", "2026-10-26"], at_401)
    assert set(after["2026-10-27"]) == {ids[k] for k in (
        "Stop on every trade", "Max 3 trades", "No trade within 10 min of a loss",
        "No revenge trades")}
    assert after["2026-10-26"] == []                                   # a no-trade day: none
    assert ids["Read the wire"] not in after["2026-10-27"]            # not opted in


def _sug(I, rule_items, day, now=NOW):
    from api.services.journal_two import routine_days
    items = routine_days.parse_items([{**it, "id": f"i{n}", "from": "2026-01-01"}
                                      for n, it in enumerate(rule_items)])
    with _conn() as c:
        return I.suggestions(c, A, items, [day], now=now)[day]


def test_stop_every_trade_placeholder_fails(I):
    item = [{"text": "Stops", "suggest": {"rule": "stop_every_trade"}}]
    with _conn() as c:
        trade(c, A, day="2026-10-26", pnl=10.0, stop=95.0)
        trade(c, A, day="2026-10-26", pnl=10.0, stop=0.0, flagged=1)   # flagged: not read
        c.commit()
    assert _sug(I, item, "2026-10-26") == ["i0"]
    with _conn() as c:
        trade(c, A, day="2026-10-26", pnl=10.0, stop=100.0, entry_price=100.0)  # placeholder
        c.commit()
    assert _sug(I, item, "2026-10-26") == []


def test_max_trades_three(I):
    item = [{"text": "Max 3", "suggest": {"rule": "max_trades", "n": 3}}]
    with _conn() as c:
        trade(c, A, day="2026-10-26", pnl=10.0)
        trade(c, A, day="2026-10-26", pnl=10.0)
        strategy(c, A, day="2026-10-26", pnl=5.0)                        # options count too
        c.commit()
    assert _sug(I, item, "2026-10-26") == ["i0"]
    with _conn() as c:
        trade(c, A, day="2026-10-26", pnl=10.0)
        c.commit()
    assert _sug(I, item, "2026-10-26") == []
    bad = [{"text": "Max 30", "suggest": {"rule": "max_trades", "n": 30}}]      # out of 1-20
    assert _sug(I, bad, "2026-10-26") == []


def _account(c, uid, *, size, pct, marked=1):
    aid = str(uuid.uuid4())
    c.execute("INSERT INTO j2_accounts (id, user_id, name, color, starting_balance, account_size,"
              " account_size_set, daily_loss_limit_pct, created_at, updated_at)"
              " VALUES (?, ?, ?, '#fff', 0, ?, ?, ?, ?, ?)",
              (aid, uid, f"acct-{aid[:6]}", size, marked, pct, STAMP, STAMP))
    return aid


def test_daily_loss_limit_uses_own_account_size(I):
    item = [{"text": "Limit", "suggest": {"rule": "under_daily_loss_limit"}}]
    with _conn() as c:
        trade(c, A, day="2026-10-26", pnl=-140.0, fees=10.0)            # net -150
        c.commit()
    assert _sug(I, item, "2026-10-26") == []                            # no account has a limit
    with _conn() as c:
        acc = _account(c, A, size=10000.0, pct=2.0)                     # limit $200
        c.execute("UPDATE j2_trades SET account_id = ?", (acc,))
        c.commit()
    assert _sug(I, item, "2026-10-26") == ["i0"]
    assert _sug(I, item, "2026-10-23") == []                            # a no-trade day: none
    with _conn() as c:
        trade(c, A, day="2026-10-26", pnl=-100.0, account=acc)          # net -250
        c.commit()
    assert _sug(I, item, "2026-10-26") == []
    with _conn() as c:                                                  # the unset placeholder
        c.execute("UPDATE j2_accounts SET account_size = 100000, account_size_set = NULL")
        c.commit()
    assert _sug(I, item, "2026-10-26") == []


def test_no_trade_after_loss_ten_minutes_and_date_only_gives_none(I):
    item = [{"text": "Cool off", "suggest": {"rule": "no_trade_after_loss", "n": 10}}]
    d = "2026-10-26"
    with _conn() as c:
        trade(c, A, day=d, pnl=-50.0, entry="T14:00:00Z", exit_="T14:30:00Z", symbol="AMD")
        trade(c, A, day=d, pnl=20.0, entry="T14:45:00Z", exit_="T15:00:00Z")   # 15 min later
        c.commit()
    assert _sug(I, item, d) == ["i0"]
    with _conn() as c:
        trade(c, A, day=d, pnl=20.0, entry="T14:38:00Z", exit_="T15:10:00Z")   # 8 min later
        c.commit()
    assert _sug(I, item, d) == []
    d2 = "2026-10-23"
    with _conn() as c:
        trade(c, A, day=d2, pnl=20.0, entry="T14:00:00Z", exit_="T15:00:00Z")
        c.commit()
    assert _sug(I, item, d2) == ["i0"]
    with _conn() as c:
        trade(c, A, day=d2, pnl=20.0, entry=d2, exit_=d2)                      # date-only
        c.commit()
    assert _sug(I, item, d2) == []
    default = [{"text": "Cool off", "suggest": {"rule": "no_trade_after_loss"}}]
    assert _sug(I, default, d) == []                                   # 10 minutes by default


def test_no_revenge_uses_detector(I, monkeypatch):
    item = [{"text": "No revenge", "suggest": {"rule": "no_revenge"}}]
    d = "2026-10-26"
    with _conn() as c:
        trade(c, A, day=d, pnl=-50.0, entry="T14:00:00Z", exit_="T14:30:00Z", symbol="TSLA")
        trade(c, A, day=d, pnl=20.0, entry="T15:00:00Z", exit_="T15:20:00Z", symbol="AAPL")
        c.commit()
    assert _sug(I, item, d) == ["i0"]
    calls = []
    real = I.revenge_detect.detect

    def spy(rows, *a, **k):
        calls.append(len(rows))
        return {"flags": [{"pairKey": "x->y"}], "timeComponentCoverage": {}}
    monkeypatch.setattr(I.revenge_detect, "detect", spy)
    assert _sug(I, item, d) == [] and calls == [2]
    monkeypatch.setattr(I.revenge_detect, "detect", real)
    with _conn() as c:                                                  # a real re-entry
        trade(c, A, day=d, pnl=10.0, entry="T14:40:00Z", exit_="T14:50:00Z", symbol="TSLA")
        c.commit()
    assert _sug(I, item, d) == []


def test_suggestions_only_the_members_trades(I):
    item = [{"text": "Max 1", "suggest": {"rule": "max_trades", "n": 1}}]
    with _conn() as c:
        trade(c, A, day="2026-10-26", pnl=10.0)
        for _ in range(5):
            trade(c, B, day="2026-10-26", pnl=10.0)
        c.commit()
    assert _sug(I, item, "2026-10-26") == ["i0"]


# ── fix round 1 ────────────────────────────────────────────────────────────────────────────────

def strategy_at(c, uid, *, day, pnl, entry, closed=None, account=None, status="closed"):
    sid = str(uuid.uuid4())
    c.execute(
        "INSERT INTO j2_option_strategies (id, user_id, account_id, underlying, strategy_type,"
        " direction, net_entry, entry_date, status, closed_at, pnl_dollar, result, created_at,"
        " updated_at, trading_day_et) VALUES (?, ?, ?, 'NVDA', 'long_call', 'bullish', 100, ?, ?,"
        " ?, ?, ?, ?, ?, ?)",
        (sid, uid, account, entry, status, closed, pnl, "Win" if pnl > 0 else "Loss", STAMP,
         STAMP, day if status != "open" else None))
    return sid


LIMIT = [{"text": "Limit", "suggest": {"rule": "under_daily_loss_limit"}}]
COOL = [{"text": "Cool off", "suggest": {"rule": "no_trade_after_loss", "n": 10}}]
REVENGE = [{"text": "No revenge", "suggest": {"rule": "no_revenge"}}]


def test_i1_two_accounts_and_a_trade_without_one_gives_no_limit_suggestion(I):
    d = "2026-10-26"
    with _conn() as c:
        acc = _account(c, A, size=10000.0, pct=2.0)
        _account(c, A, size=5000.0, pct=None)
        trade(c, A, day=d, pnl=-50.0, account=acc)
        c.commit()
    assert _sug(I, LIMIT, d) == ["i0"]                      # non-vacuity: attributed, holds
    with _conn() as c:
        trade(c, A, day=d, pnl=-10.0)                       # no account, two accounts: unknown
        c.commit()
    assert _sug(I, LIMIT, d) == []


def test_i1_single_account_takes_the_trades_without_an_account(I):
    d = "2026-10-26"
    with _conn() as c:
        _account(c, A, size=10000.0, pct=2.0)               # the member's only account
        trade(c, A, day=d, pnl=-150.0)                      # no account id
        c.commit()
    assert _sug(I, LIMIT, d) == ["i0"]
    with _conn() as c:
        trade(c, A, day=d, pnl=-100.0)                      # -250 in the only account
        c.commit()
    assert _sug(I, LIMIT, d) == []


def test_m7_loss_limit_counts_options_too(I):
    d = "2026-10-26"
    with _conn() as c:
        acc = _account(c, A, size=10000.0, pct=2.0)         # limit $200
        trade(c, A, day=d, pnl=-150.0, account=acc)
        c.commit()
    assert _sug(I, LIMIT, d) == ["i0"]
    with _conn() as c:
        strategy_at(c, A, day=d, pnl=-100.0, entry=f"{d}T14:00:00Z",
                    closed=f"{d}T19:00:00Z", account=acc)   # the day is -250 incl. options
        c.commit()
    assert _sug(I, LIMIT, d) == []
    assert "incl. options" in I.RULE_TEXT["under_daily_loss_limit"]
    assert set(I.RULE_TEXT) == set(I.SUGGEST_RULES)


def test_i2_an_option_opened_two_minutes_after_a_loss(I):
    d = "2026-10-26"
    with _conn() as c:
        trade(c, A, day=d, pnl=-50.0, entry="T14:00:00Z", exit_="T14:30:00Z")
        c.commit()
    assert _sug(I, COOL, d) == ["i0"]
    with _conn() as c:
        strategy_at(c, A, day=d, pnl=20.0, entry=f"{d}T14:32:00Z", closed=f"{d}T15:30:00Z")
        c.commit()
    assert _sug(I, COOL, d) == []


def test_i2_a_date_only_option_gives_no_timing_suggestion(I):
    d = "2026-10-26"
    with _conn() as c:
        trade(c, A, day=d, pnl=20.0, entry="T14:00:00Z", exit_="T14:30:00Z")
        c.commit()
    assert _sug(I, COOL, d) == ["i0"] and _sug(I, REVENGE, d) == ["i0"]
    with _conn() as c:
        strategy_at(c, A, day=d, pnl=20.0, entry=d, closed=f"{d}T19:00:00Z")
        c.commit()
    assert _sug(I, COOL, d) == [] and _sug(I, REVENGE, d) == []


def test_i2_an_option_loss_then_a_same_symbol_reentry_is_revenge(I):
    d = "2026-10-26"
    with _conn() as c:
        strategy_at(c, A, day=d, pnl=-80.0, entry=f"{d}T14:00:00Z", closed=f"{d}T14:30:00Z")
        trade(c, A, day=d, pnl=20.0, entry="T15:40:00Z", exit_="T16:00:00Z", symbol="NVDA")
        c.commit()
    assert _sug(I, REVENGE, d) == ["i0"]                     # 70 minutes later: outside 60
    with _conn() as c:
        trade(c, A, day=d, pnl=20.0, entry="T14:50:00Z", exit_="T15:00:00Z", symbol="NVDA")
        c.commit()
    assert _sug(I, REVENGE, d) == []


def test_i3_an_estimated_entry_reads_as_date_only(I):
    d = "2026-10-26"
    with _conn() as c:
        trade(c, A, day=d, pnl=20.0, entry="T14:00:00Z", exit_="T14:30:00Z")
        c.commit()
    assert _sug(I, COOL, d) == ["i0"]
    pid = str(uuid.uuid4())
    with _conn() as c:
        c.execute(
            "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares,"
            " original_shares, entry_price, stop_price, context_at_entry, created_at, updated_at,"
            " closed_at, entry_estimated) VALUES (?, ?, 'AMD', 'Long', ?, 5, 5, 100, 95, '{}',"
            " ?, ?, ?, 1)", (pid, A, f"{d}T14:40:00Z", STAMP, STAMP, f"{d}T15:30:00Z"))
        trade(c, A, day=d, pnl=20.0, entry="T14:40:00Z", exit_="T15:30:00Z", symbol="AMD")
        c.execute("UPDATE j2_trades SET position_id = ? WHERE symbol = 'AMD'", (pid,))
        c.commit()
    assert _sug(I, COOL, d) == [] and _sug(I, REVENGE, d) == []
    stop = [{"text": "Stops", "suggest": {"rule": "stop_every_trade"}}]
    assert _sug(I, stop, d) == ["i0"]                        # only the timing rules refuse


def test_i4_win_rate_no_decided_trades_sentence(I):
    r = routine()
    with _conn() as c:
        for d in sessions(6):
            tick_all(c, A, r, d)
            trade(c, A, day=d, pnl=0.0)                      # breakeven only
        c.commit()
    got = I.routine_vs_pnl(A, r["id"], now=NOW)
    assert got["done"]["n"] == 6
    assert got["winRate"]["done"]["text"] == "No decided trades yet."
    assert got["winRate"]["done"]["avg"] is None and got["winRate"]["done"]["n"] == 0
    assert got["winRate"]["other"]["text"] == "No days with trades yet."


def test_i5_the_comparison_equals_a_built_widget_split_by_routine_done(I, monkeypatch):
    from api.services.journal_two import notebook_widgets as nw
    from api.services.journal_two.widget_engine import run as wrun
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-ins-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    wrun._reset_state()
    r = routine()
    days = sessions(12)
    nets = [95.0, 13.5, -40.0, 210.25, 7.0, -3.0, 120.0, 55.5, -80.0, 33.0, 1.0, 18.0]
    with _conn() as c:
        for i, (d, p) in enumerate(zip(days, nets)):
            if i % 2 == 0:
                tick_all(c, A, r, d)
            trade(c, A, day=d, pnl=p)
        # a Friday that is done, with a Saturday-stamped trade the scan folds into it
        tick_all(c, A, r, "2026-10-23")
        trade(c, A, day="2026-10-23", pnl=40.0)
        trade(c, A, day="2026-10-24", pnl=-17.0)
        c.commit()
    ours = I.routine_vs_pnl(A, r["id"], now=NOW)
    raw = {"v": 2, "source": "trading_days", "measures": [{"key": "avg_day_pnl"}],
           "split": {"by": "routine_done", "ref": r["id"]},
           "range": {"from": days[0], "to": "2026-10-27"}}
    out = wrun.run_plan(A, raw, {}, lane="run", now=NOW)
    wrun._reset_state()
    done = [p for i, p in enumerate(nets) if i % 2 == 0] + [40.0 - 17.0]
    assert ours["done"]["avg"] == pytest.approx(sum(done) / len(done))
    groups = {g["label"]: g for g in out["rows"]}
    assert groups["Done"]["v1"] == pytest.approx(ours["done"]["avg"])
    assert groups["Done"]["n1"] == ours["done"]["n"] == 7
    assert out["footnotes"]                          # the weekend trade was folded into Friday


def test_i6_history_for_since_bounds_the_build_and_names_archived_day(I):
    from api.services.journal_two import routines, trading_days
    r = routine()
    since = date(2026, 10, 20)
    calls = []
    real = routines.routine_days.history

    def spy(**kw):
        calls.append(kw["created"])
        return real(**kw)
    with _conn() as c:
        full = routines.history_for(c, A, r["id"], date(2026, 10, 27), date(2026, 10, 28))
        routines.routine_days.history = spy
        try:
            got = routines.history_for(c, A, r["id"], date(2026, 10, 27), date(2026, 10, 28),
                                       since=since)
        finally:
            routines.routine_days.history = real
    floor = trading_days.nth_session_before(since, routines.HISTORY_SINCE_LOOKBACK)
    assert calls == [floor] and floor > date(2026, 8, 3)
    h = got[r["id"]]
    assert h.states[0].day == floor.isoformat()
    assert full[r["id"]].states[0].day == "2026-08-03"
    tail = {s.day: s.state for s in full[r["id"]].states if s.day >= floor.isoformat()}
    assert {s.day: s.state for s in h.states} == tail
    assert h.archived_at is None
    routines.archive(A, r["id"], now=datetime(2026, 10, 22, 2, 0, tzinfo=timezone.utc))
    with _conn() as c:
        h2 = routines.history_for(c, A, r["id"], date(2026, 10, 27), date(2026, 10, 28))
    assert h2[r["id"]].archived_at == date(2026, 10, 21)       # 22:00 ET on the 21st


def test_m1_a_ticks_answer_equals_read_days_with_suggestions(I):
    from api.services.journal_two import routines
    r, ids = _rules_routine()
    d = "2026-10-26"
    with _conn() as c:
        trade(c, A, day=d, pnl=50.0)
        c.commit()
    ans = routines.set_tick(A, r["id"], d, ids["Read the wire"], True, now=NOW)
    read = routines.read_days(A, [r["id"]], [d], now=NOW)["routines"][r["id"]]["days"][d]
    assert ans["suggested"] and ans == read


def test_m2_a_rule_is_read_once_per_day(I, monkeypatch):
    calls = []
    real = I._holds
    monkeypatch.setattr(I, "_holds", lambda *a, **k: (calls.append(a[:2]), real(*a, **k))[1])
    two = [{"text": "Stops", "suggest": {"rule": "stop_every_trade"}},
           {"text": "Stops again", "suggest": {"rule": "stop_every_trade"}},
           {"text": "Max 3", "suggest": {"rule": "max_trades", "n": 3}}]
    with _conn() as c:
        trade(c, A, day="2026-10-26", pnl=10.0)
        c.commit()
    assert _sug(I, two, "2026-10-26") == ["i0", "i1", "i2"]
    assert calls == [("stop_every_trade", None), ("max_trades", 3)]


def test_m3_facts_read_the_wanted_days_only(I):
    seen = []
    with _conn() as c:
        trade(c, A, day="2026-09-15", pnl=10.0)
        c.commit()
        c.set_trace_callback(seen.append)
        got = I.day_facts(c, A, ["2026-08-04", "2026-10-26"], now=NOW)
        c.set_trace_callback(None)
    assert got == {"2026-08-04": None, "2026-10-26": None}
    trades_sql = [s for s in seen if "FROM j2_trades" in s]
    assert trades_sql and all("BETWEEN" not in s and " IN (" in s for s in trades_sql)


def test_m4_no_suggestion_on_an_off_or_skipped_day_or_for_a_ticked_item(I):
    from api.services.journal_two import routines
    r, ids = _rules_routine()
    stop = ids["Stop on every trade"]
    with _conn() as c:
        for d in ("2026-10-23", "2026-10-26", "2026-10-25"):     # Fri, Mon, a Sunday
            trade(c, A, day=d, pnl=10.0)
        c.commit()
    got = _read(r["id"], ["2026-10-23", "2026-10-26", "2026-10-25"], NOW)
    assert stop in got["2026-10-23"] and stop in got["2026-10-26"]   # non-vacuity
    assert got["2026-10-25"] == []                                    # off: not a session
    routines.set_skipped(A, r["id"], "2026-10-23", True, now=NOW)
    routines.set_tick(A, r["id"], "2026-10-26", stop, True, now=NOW)
    got = _read(r["id"], ["2026-10-23", "2026-10-26"], NOW)
    assert got["2026-10-23"] == []                                    # skipped
    assert stop not in got["2026-10-26"] and got["2026-10-26"]        # ticked: not suggested


def test_m5_a_dismissed_revenge_pair_is_honoured(I):
    from api.services.journal_two import routine_days
    d = "2026-10-26"
    with _conn() as c:
        trade(c, A, day=d, pnl=-50.0, entry="T14:00:00Z", exit_="T14:30:00Z", symbol="TSLA")
        trade(c, A, day=d, pnl=10.0, entry="T14:50:00Z", exit_="T15:00:00Z", symbol="TSLA")
        c.commit()
        refs = [f"id:{x}" for (x,) in c.execute(
            "SELECT id FROM j2_trades ORDER BY entry_date")]
    assert _sug(I, REVENGE, d) == []
    items = routine_days.parse_items([{**REVENGE[0], "id": "i0", "from": "2026-01-01"}])
    with _conn() as c:
        got = I.suggestions(c, A, items, [d], now=NOW,
                            suppressed_pairs={f"{refs[0]}->{refs[1]}"})
    assert got[d] == ["i0"]


def test_m6_a_deleted_tracker_is_none(I):
    from api.services.journal_two import trackers
    t = _tracker()
    assert I.tracker_vs_pnl(A, t["id"], now=NOW) is not None
    trackers.archive(A, t["id"], now=NOW)
    trackers.soft_delete(A, t["id"], typed_name="Sleep", now=NOW)
    assert I.tracker_vs_pnl(A, t["id"], now=NOW) is None

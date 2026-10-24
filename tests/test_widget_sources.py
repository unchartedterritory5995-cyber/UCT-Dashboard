"""Task 8.5 -- the widget engine's sources, whitelist compiler and aggregator.

Seeded through `auth_db.init_db` (which runs `journal_two.db.ensure_schema`) on a temp sqlite
file; nothing here reaches `C:\\data`.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from api.services import auth_db
from api.services.journal_two import calendar as j2_calendar
from api.services.journal_two.widget_engine import aggregate, plan, sources
from api.services.journal_two.widget_engine import compile as wcompile

UID = "u-wsrc-1"
TODAY = date(2026, 10, 24)          # a Saturday
NOW = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc).isoformat()


# ── fixtures and seeding ─────────────────────────────────────────────────────────────────────

@pytest.fixture
def conn(monkeypatch, tmp_path):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "wsrc.db"))
    auth_db.init_db()
    c = auth_db.get_connection()
    add_user(c, UID)
    try:
        yield c
    finally:
        c.close()


def add_user(c, uid):
    c.execute("INSERT INTO users (id, email, password_hash, display_name, role)"
              " VALUES (?, ?, 'x', 'x', 'member')", (uid, f"{uid}@example.test"))
    c.commit()


def add_account(c, uid, name="Main", *, size=None, aid=None):
    aid = aid or str(uuid.uuid4())
    c.execute(
        "INSERT INTO j2_accounts (id, user_id, name, color, starting_balance, account_size,"
        " account_size_set, created_at, updated_at) VALUES (?, ?, ?, '#fff', 0, ?, ?, ?, ?)",
        (aid, uid, name, size or 0, 1 if size else None, NOW, NOW))
    c.commit()
    return aid


def add_trade(c, uid, *, day, pnl=100.0, fees=0.0, result=None, r=None, symbol="NVDA",
              setup=None, side="Long", entry=100.0, stop=95.0, shares=10, exit_iso=None,
              entry_iso=None, hour=10, excluded=0, mistakes=None, emotions=None, account=None,
              source=None, external_id=None, hold=1, pct=0.02, regime=None, commit=True):
    tid = str(uuid.uuid4())
    result = result or ("Win" if pnl > 0 else "Loss" if pnl < 0 else "BE")
    exit_iso = exit_iso or f"{day}T18:00:00Z"
    entry_iso = entry_iso or f"{day}T14:00:00Z"
    c.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price,
               entry_date, exit_price, exit_date, original_stop, setup, notes, pnl_dollar,
               pnl_percent, r_multiple, hold_days, result, context_at_entry, account_id,
               created_at, trading_day_et, hour_et, fees, analytics_excluded, mistake_tags,
               emotion_tags, source, external_id, regime)
           VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, 110, ?, ?, ?, NULL, ?, ?, ?, ?, ?, '{}', ?, ?,
                   ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (tid, uid, symbol, side, shares, entry, entry_iso, exit_iso, stop, setup, pnl, pct, r,
         hold, result, account, NOW, day, hour, fees, excluded,
         None if mistakes is None else __import__("json").dumps(mistakes),
         None if emotions is None else __import__("json").dumps(emotions), source, external_id,
         regime))
    if commit:
        c.commit()
    return tid


def add_position(c, uid, *, symbol="AAPL", side="Long", entry=100.0, stop=95.0, shares=10,
                 entry_iso="2026-10-14T14:00:00Z", estimated=0, mark=None, setup=None,
                 account=None):
    pid = str(uuid.uuid4())
    c.execute(
        """INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares,
               original_shares, entry_price, stop_price, setup, context_at_entry, created_at,
               updated_at, entry_estimated, broker_price, account_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)""",
        (pid, uid, symbol, side, entry_iso, shares, shares, entry, stop, setup, NOW, NOW,
         estimated, mark, account))
    c.commit()
    return pid


def add_strategy(c, uid, *, day, pnl, result="Win", account=None):
    sid = str(uuid.uuid4())
    c.execute(
        """INSERT INTO j2_option_strategies (id, user_id, account_id, underlying, strategy_type,
               direction, net_entry, entry_date, status, closed_at, pnl_dollar, result,
               created_at, updated_at, trading_day_et)
           VALUES (?, ?, ?, 'SPY', 'long_call', 'bullish', 100, ?, 'closed', ?, ?, ?, ?, ?, ?)""",
        (sid, uid, account, f"{day}T14:00:00Z", f"{day}T19:00:00Z", pnl, result, NOW, NOW, day))
    c.commit()
    return sid


def add_note(c, uid, *, updated_at, deleted_at=None, import_source=None):
    nid = str(uuid.uuid4())
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, created_at, updated_at, deleted_at,"
        " import_source) VALUES (?, ?, 'n', ?, ?, ?, ?)",
        (nid, uid, updated_at, updated_at, deleted_at, import_source))
    c.commit()
    return nid


def add_checkin(c, uid, note_id, *, day, mood=None, focus=None):
    c.execute(
        "INSERT INTO j2_note_checkins (note_id, user_id, embed_id, day, mood, focus, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)", (note_id, uid, uuid.uuid4().hex, day, mood, focus, NOW))
    c.commit()


def raw_plan(source="closed_trades", measures=("net_pnl",), **kw):
    p = {"v": 1, "source": source, "measures": [{"key": m} for m in measures],
         "range": kw.pop("range", {"token": "all"})}
    p.update(kw)
    return p


def run(c, raw, *, uid=UID, settings=None, today=TODAY):
    p = plan.validate_plan(raw, sources.CATALOG)
    rng = plan.resolve_range(p["range"], today)
    sc = sources.scan(c, p, settings or {}, rng, uid, today=today)
    return sc, aggregate.evaluate(sc.rows, p, sources.CATALOG)


def total(res, i=0):
    return res.total.cells[i].value


# ── closed trades ────────────────────────────────────────────────────────────────────────────

def test_closed_trades_net_is_pnl_minus_fees(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=100.0, fees=2.5)
    add_trade(conn, UID, day="2026-10-21", pnl=-50.0, fees=1.0)
    sc, res = run(conn, raw_plan(measures=("net_pnl", "gross_pnl", "fees")))
    assert sorted(r["net"] for r in sc.rows) == [-51.0, 97.5]
    assert total(res, 0) == pytest.approx(46.5)
    assert total(res, 1) == pytest.approx(50.0)
    assert total(res, 2) == pytest.approx(3.5)


def test_flagged_excluded_from_aggregate_listed_in_list_view(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=100.0, symbol="AAA")
    add_trade(conn, UID, day="2026-10-21", pnl=900.0, symbol="ZZZ", excluded=1)
    _sc, res = run(conn, raw_plan(measures=("trades", "net_pnl")))
    assert total(res, 0) == 1 and total(res, 1) == pytest.approx(100.0)

    sc, res = run(conn, raw_plan(view={"type": "list"}))
    assert {g.label: g.flagged for g in res.groups} == {"AAA": False, "ZZZ": True}
    flagged = next(g for g in res.groups if g.flagged)
    assert flagged.values.cells[0].value is None and flagged.values.n == 0
    assert total(res) == pytest.approx(100.0) and res.count == 1
    assert any(r["flagged"] for r in sc.rows)


def test_list_view_sql_keeps_flagged_and_other_views_drop_them():
    p = plan.validate_plan(raw_plan(view={"type": "list"}), sources.CATALOG)
    rng = plan.resolve_range(p["range"], TODAY)
    sql, _ = wcompile.compile_scan(sources.CLOSED, p, {}, rng, UID)
    assert "analytics_excluded IS NULL" not in sql and "t.analytics_excluded" in sql
    p2 = plan.validate_plan(raw_plan(), sources.CATALOG)
    sql2, _ = wcompile.compile_scan(sources.CLOSED, p2, {}, rng, UID)
    assert "t.analytics_excluded IS NULL OR t.analytics_excluded = 0" in sql2


def test_hour_split_excludes_date_only_and_counts_them(conn):
    for _ in range(2):
        add_trade(conn, UID, day="2026-10-20", hour=10)
    for _ in range(3):
        add_trade(conn, UID, day="2026-10-21", hour=None, entry_iso="2026-10-20",
                  exit_iso="2026-10-21")
    _sc, res = run(conn, raw_plan(measures=("trades",), split={"by": "hour_et"}))
    assert [(g.key, g.label, g.values.n) for g in res.groups] == [("10", "10:00 ET", 2)]
    assert "3 trades have no time and are not in this split." in res.footnotes
    # The total still counts all five: only the split leaves them out.
    assert total(res) == 5


def test_hold_minutes_needs_times_sentence(conn):
    for d in ("2026-10-20", "2026-10-21"):
        add_trade(conn, UID, day=d, hour=None, entry_iso="2026-10-19", exit_iso=d)
    _sc, res = run(conn, raw_plan(measures=("trades",), filters=[
        {"field": "hold_minutes", "op": "gt", "values": [5]}]))
    assert ("Hold time in minutes needs entry and exit times; your trades have dates only"
            in res.footnotes)
    assert total(res) == 0


def test_hold_minutes_computed_when_both_times_exist(conn):
    add_trade(conn, UID, day="2026-10-20", entry_iso="2026-10-20T14:00:00Z",
              exit_iso="2026-10-20T15:30:00Z")
    sc, res = run(conn, raw_plan(measures=("trades",), filters=[
        {"field": "hold_minutes", "op": "gte", "values": [90]}]))
    assert sc.rows[0]["hold_minutes"] == 90.0 and total(res) == 1 and res.footnotes == []


def test_placeholder_stop_risk_is_none_and_had_stop_false(conn):
    add_trade(conn, UID, day="2026-10-20", entry=100.0, stop=100.0, symbol="PH")
    add_trade(conn, UID, day="2026-10-21", entry=100.0, stop=95.0, shares=10, symbol="OK")
    sc, _res = run(conn, raw_plan())
    by = {r["symbol"]: r for r in sc.rows}
    assert by["PH"]["risk_dollars"] is None and by["PH"]["had_stop"] is False
    assert by["OK"]["risk_dollars"] == 50.0 and by["OK"]["had_stop"] is True
    _sc, res = run(conn, raw_plan(measures=("trades",), split={"by": "had_stop"}))
    assert {g.label: g.values.n for g in res.groups} == {"No stop set": 1, "Had a stop": 1}


def test_effective_r_falls_back_to_true_r(conn):
    t1 = add_trade(conn, UID, day="2026-10-20", r=None, stop=100.0)
    t2 = add_trade(conn, UID, day="2026-10-21", r=2.0)
    for tid, tr in ((t1, 1.5), (t2, 0.3)):
        conn.execute("INSERT INTO j2_trade_excursions (user_id, trade_ref, symbol, true_r,"
                     " computed_at) VALUES (?, ?, 'NVDA', ?, ?)", (UID, f"id:{tid}", tr, NOW))
    conn.commit()
    sc, res = run(conn, raw_plan(measures=("total_r",)))
    assert sorted(r["r"] for r in sc.rows) == [1.5, 2.0]
    assert total(res) == pytest.approx(3.5)
    assert res.coverage[0] == aggregate.Coverage(2, 2, None)


def test_r_coverage_hint_when_under_half_known(conn):
    add_trade(conn, UID, day="2026-10-20", r=1.0)
    for d in ("2026-10-21", "2026-10-22", "2026-10-23"):
        add_trade(conn, UID, day=d, r=None, stop=100.0)
    _sc, res = run(conn, raw_plan(measures=("expectancy_r",), split={"by": "r_bucket"}))
    assert res.coverage[0] == aggregate.Coverage(1, 4, "Add stops to see R for more trades")
    # Never a 0R bar: the R-less trades leave the split, counted.
    assert [g.label for g in res.groups] == ["1R to 2R"]
    assert "3 trades have no R and are not in this split." in res.footnotes


def test_tag_filter_matches_exact_member_text(conn):
    add_trade(conn, UID, day="2026-10-20", mistakes=["it's", "50% off"], symbol="A1")
    add_trade(conn, UID, day="2026-10-21", mistakes=["it"], symbol="A2")
    add_trade(conn, UID, day="2026-10-22", mistakes=["a_b"], symbol="A3")
    add_trade(conn, UID, day="2026-10-23", symbol="A4")
    for value, want in (("it's", {"A1"}), ("it", {"A2"}), ("50% off", {"A1"}), ("a_b", {"A3"}),
                        ("50", set()), ("a b", set())):
        sc, res = run(conn, raw_plan(view={"type": "list"}, filters=[
            {"field": "mistake", "op": "has_any", "values": [value]}]))
        assert {r["symbol"] for r in sc.rows} == want, value
        assert {g.label for g in res.groups} == want, value


def test_group_labels_clipped_at_60(conn):
    long_a = "A" * 59 + "x" + "1" * 140
    long_b = "A" * 59 + "x" + "2" * 140
    add_trade(conn, UID, day="2026-10-20", setup=long_a)
    add_trade(conn, UID, day="2026-10-21", setup=long_b)
    add_trade(conn, UID, day="2026-10-22", setup="__proto__")
    _sc, res = run(conn, raw_plan(measures=("trades",), split={"by": "setup"}))
    labels = sorted(g.label for g in res.groups)
    assert len(res.groups) == 3, "two setups that clip alike are still two groups"
    assert all(len(lbl) <= 60 for lbl in labels)
    assert sum(1 for lbl in labels if lbl.endswith("…") and len(lbl) == 60) == 2
    assert "__proto__" in labels


def test_scan_is_descending_limit_5001_and_caps(conn):
    start = date(2024, 1, 1)
    rows = []
    for i in range(5200):
        day = (start + timedelta(days=i // 10)).isoformat()
        rows.append((str(uuid.uuid4()), UID, day, day + "T18:00:00Z", day))
    conn.executemany(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price,
               entry_date, exit_price, exit_date, original_stop, pnl_dollar, pnl_percent,
               hold_days, result, context_at_entry, created_at, trading_day_et, fees)
           VALUES (?, ?, 'm', 'NVDA', 'Long', 1, 10, ?, 11, ?, 9, 1, 0.1, 0, 'Win', '{}', 'x', ?,
                   0)""", [(a, b, c2, d, e) for a, b, c2, d, e in rows])
    conn.commit()
    p = plan.validate_plan(raw_plan(measures=("trades",)), sources.CATALOG)
    rng = plan.resolve_range(p["range"], TODAY)
    sql, _ = wcompile.compile_scan(sources.CLOSED, p, {}, rng, UID)
    assert sql.endswith("DESC, t.id DESC LIMIT 5001")
    sc = sources.scan(conn, p, {}, rng, UID)
    assert sc.count == 5000 and len(sc.rows) == 5000 and sc.capped is True
    newest = sorted(rows, key=lambda r: (r[4], r[0]), reverse=True)
    assert sc.earliest_day == newest[4999][4]
    res = aggregate.evaluate(sc.rows, p, sources.CATALOG)
    assert total(res) == 5000


def test_last_n_trades_uses_limit_n(conn):
    for i in range(12):
        add_trade(conn, UID, day=f"2026-10-{i + 1:02d}")
    p = plan.validate_plan(raw_plan(measures=("trades",), range={"token": "last_100_trades"}),
                           sources.CATALOG)
    rng = plan.resolve_range(p["range"], TODAY)
    sql, _ = wcompile.compile_scan(sources.CLOSED, p, {}, rng, UID)
    assert sql.endswith("LIMIT 100")
    sc = sources.scan(conn, p, {}, rng, UID)
    assert sc.count == 12 and sc.capped is False


def test_contains_escapes_like_wildcards(conn):
    add_trade(conn, UID, day="2026-10-20", symbol="A_B")
    add_trade(conn, UID, day="2026-10-21", symbol="AXB")
    sc, _res = run(conn, raw_plan(view={"type": "list"}, filters=[
        {"field": "symbol", "op": "contains", "values": ["_"]}]))
    assert {r["symbol"] for r in sc.rows} == {"A_B"}


def test_streak_order_follows_exit_time_within_a_day(conn):
    # Same ET day: a loss at 15:00 then a win at 19:00. The current streak is +1 (the win).
    add_trade(conn, UID, day="2026-10-20", pnl=50, exit_iso="2026-10-20T19:00:00Z")
    add_trade(conn, UID, day="2026-10-20", pnl=-50, exit_iso="2026-10-20T15:00:00Z")
    _sc, res = run(conn, raw_plan(measures=("current_streak",)))
    assert total(res) == 1.0


def test_no_trade_id_in_result(conn):
    tid = add_trade(conn, UID, day="2026-10-20", setup="VCP")
    for view, split in (("list", None), ("bar", {"by": "setup"}), ("number", None)):
        raw = raw_plan(view={"type": view}, **({"split": split} if split else {}))
        _sc, res = run(conn, raw)
        assert tid not in repr(res), view


# ── open positions ───────────────────────────────────────────────────────────────────────────

def test_positions_entry_estimated_excluded_from_days_open_and_counted(conn):
    add_position(conn, UID, symbol="AAA", entry_iso="2026-10-14T14:00:00Z")
    add_position(conn, UID, symbol="EST", entry_iso="2026-10-24T14:00:00Z", estimated=1)
    sc, res = run(conn, raw_plan(source="open_positions", measures=("avg_days_open",)))
    by = {r["symbol"]: r for r in sc.rows}
    assert by["AAA"]["days_open"] == 10.0 and by["EST"]["days_open"] is None
    assert total(res) == 10.0 and res.total.cells[0].have == 1
    assert ("1 position has an estimated entry date and is not counted in days open."
            in res.footnotes)


def test_positions_unrealised_none_without_broker_mark(conn):
    add_position(conn, UID, symbol="MRK", mark=110.0)
    add_position(conn, UID, symbol="NOM", mark=None)
    add_position(conn, UID, symbol="SHT", side="Short", entry=100.0, stop=105.0, mark=90.0)
    sc, res = run(conn, raw_plan(source="open_positions", measures=("unrealised_pnl",)))
    by = {r["symbol"]: r for r in sc.rows}
    assert by["MRK"]["unrealised"] == 100.0 and by["NOM"]["unrealised"] is None
    assert by["SHT"]["unrealised"] == 100.0
    assert total(res) == 200.0 and res.coverage[0].have == 2 and res.coverage[0].total == 3


def test_positions_risk_and_account_share_use_the_members_size(conn):
    aid = add_account(conn, UID, "Main", size=10_000)
    add_position(conn, UID, symbol="R1", entry=100.0, stop=95.0, shares=10, account=aid)
    add_position(conn, UID, symbol="PH", entry=100.0, stop=100.0, shares=10, account=aid)
    sc, res = run(conn, raw_plan(source="open_positions", measures=("open_risk",)))
    by = {r["symbol"]: r for r in sc.rows}
    assert by["R1"]["risk_dollars"] == 50.0 and by["R1"]["risk_pct_account"] == 0.5
    assert by["R1"]["pct_account"] == 10.0
    assert by["PH"]["risk_dollars"] is None and by["PH"]["risk_pct_account"] is None
    assert by["PH"]["had_stop"] is False
    assert total(res) == 50.0


# ── trading days ─────────────────────────────────────────────────────────────────────────────

def test_trading_days_includes_sessions_without_trades(conn):
    add_trade(conn, UID, day="2026-10-21", pnl=40.0)
    sc, res = run(conn, raw_plan(source="trading_days", measures=("avg_day_pnl",),
                                 range={"from": "2026-10-19", "to": "2026-10-25"}))
    assert [r["day"] for r in sc.rows] == ["2026-10-23", "2026-10-22", "2026-10-21",
                                           "2026-10-20", "2026-10-19"]
    assert [r["trade_count"] for r in sc.rows] == [0, 0, 1, 0, 0]
    assert next(r for r in sc.rows if r["day"] == "2026-10-20")["day_net"] is None
    # The day measure counts only the day with trades.
    assert total(res) == 40.0 and res.total.cells[0].n == 1


def test_trading_days_day_net_includes_options_and_matches_calendar(conn):
    add_trade(conn, UID, day="2026-09-02", pnl=120.0, fees=2.0)
    add_trade(conn, UID, day="2026-09-02", pnl=-30.0, fees=1.0)
    add_trade(conn, UID, day="2026-09-10", pnl=-75.5, fees=0.5)
    add_trade(conn, UID, day="2026-09-15", pnl=10.0, excluded=1)
    add_strategy(conn, UID, day="2026-09-02", pnl=55.0)
    add_strategy(conn, UID, day="2026-09-17", pnl=-20.0, result="Loss")
    sc, _res = run(conn, raw_plan(source="trading_days", measures=("green_day_pct",),
                                  range={"from": "2026-09-01", "to": "2026-09-30"}))
    cal = j2_calendar.get_calendar(UID, view="month", year=2026, month=9, conn=conn)
    cal_days = {d["date"]: d for d in cal["days"]}
    rows = {r["day"]: r for r in sc.rows}
    assert set(cal_days) == {"2026-09-02", "2026-09-10", "2026-09-17"}
    for day, cd in cal_days.items():
        assert rows[day]["day_net"] == pytest.approx(cd["pnlDollar"]), day
        assert rows[day]["trade_count"] == cd["tradeCount"], day
    assert rows["2026-09-02"]["day_net"] == pytest.approx(142.0)        # 118 - 31 + 55
    assert rows["2026-09-17"]["day_net"] == pytest.approx(-20.0)
    assert rows["2026-09-02"]["best_trade"] == pytest.approx(118.0)
    assert sources.DAY_FIELDS["day_net"].label == "Day net P&L (incl. options)"


def test_checkin_latest_by_note_updated_at_and_trashed_gone(conn):
    day = "2026-10-21"
    add_trade(conn, UID, day=day)
    n_old = add_note(conn, UID, updated_at="2026-10-21T10:00:00Z")
    n_new = add_note(conn, UID, updated_at="2026-10-21T11:00:00Z")
    n_trash = add_note(conn, UID, updated_at="2026-10-21T12:00:00Z",
                       deleted_at="2026-10-22T00:00:00Z")
    n_sample = add_note(conn, UID, updated_at="2026-10-21T13:00:00Z", import_source="sample")
    add_checkin(conn, UID, n_new, day=day, mood=4)              # inserted first, updated later
    add_checkin(conn, UID, n_old, day=day, mood=2, focus=3)
    add_checkin(conn, UID, n_trash, day=day, mood=1, focus=1)
    add_checkin(conn, UID, n_sample, day=day, mood=5, focus=5)
    sc, _res = run(conn, raw_plan(source="trading_days", measures=("avg_day_pnl",),
                                  range={"from": day, "to": day}))
    row = sc.rows[0]
    assert row["mood"] == 4.0, "the note updated last wins"
    assert row["focus"] == 3.0, "a dimension the latest check-in left blank keeps the earlier one"
    # Restoring the trashed note brings its check-in back (it is now the newest note).
    conn.execute("UPDATE j2_notes SET deleted_at = NULL WHERE id = ?", (n_trash,))
    conn.commit()
    sc, _res = run(conn, raw_plan(source="trading_days", measures=("avg_day_pnl",),
                                  range={"from": day, "to": day}))
    assert sc.rows[0]["mood"] == 1.0 and sc.rows[0]["focus"] == 1.0


def test_trading_days_all_range_starts_at_first_trade_day(conn):
    add_trade(conn, UID, day="2026-10-20")
    sc, _res = run(conn, raw_plan(source="trading_days", measures=("avg_day_pnl",)))
    assert sc.rows[-1]["day"] == "2026-10-20" and sc.rows[0]["day"] == "2026-10-23"
    sc, _res = run(conn, raw_plan(source="trading_days", measures=("avg_day_pnl",)),
                   uid="nobody")
    assert sc.rows == []


def test_trading_days_caps_at_3700_sessions(conn):
    add_trade(conn, UID, day="1995-01-03")
    sc, _res = run(conn, raw_plan(source="trading_days", measures=("avg_day_pnl",)))
    assert sc.capped is True and sc.count <= sources.MAX_SESSIONS


# ── views and the catalog ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,sentence", [
    (raw_plan(view={"type": "bar"}), sources.S_VIEW_BAR),
    (raw_plan(split={"by": "setup"}, view={"type": "line"}), sources.S_VIEW_LINE),
    (raw_plan(split={"by": "month"}, view={"type": "heat"}), sources.S_VIEW_HEAT),
    (raw_plan(view={"type": "scatter"}), sources.S_VIEW_SCATTER),
    (raw_plan(source="trading_days", measures=("avg_day_pnl", "green_day_pct"),
              view={"type": "scatter"}), sources.S_VIEW_SCATTER_TRADES),
    (raw_plan(split={"by": "setup"}, view={"type": "list"}), sources.S_VIEW_LIST),
    (raw_plan(view={"type": "progress"}), sources.S_VIEW_PROGRESS),
    (raw_plan(split={"by": "net"}), sources.S_SPLIT_FIELD),
    (raw_plan(view={"type": "compare"}), plan.S_NO_EARLIER),
])
def test_view_disabled_reasons(raw, sentence):
    with pytest.raises(plan.PlanError) as e:
        plan.validate_plan(raw, sources.CATALOG)
    assert e.value.sentence == sentence


def test_every_field_is_typed_with_ops_for_its_type():
    for src in sources.SOURCES.values():
        for k, f in src.fields.items():
            assert f.key == k and f.type in plan.FIELD_TYPES, (src.key, k)
            assert f.ops and set(f.ops) <= set(plan.DEFAULT_OPS), (src.key, k)
            assert f.py is not None and f.label, (src.key, k)


def test_every_source_has_a_measure_and_the_catalog_satisfies_the_plan_protocol():
    for key in plan.SOURCES:
        assert sources.CATALOG.measures_for(key), key
    assert "avg_true_r" not in sources.CATALOG.measures
    assert sources.CATALOG.accents[0] == "gold"
    p = plan.validate_plan(raw_plan(split={"by": "setup"}), sources.CATALOG)
    assert plan.summary(p, sources.CATALOG, 3, "trades") == (
        "Net P&L, split by setup, for closed trades over all time, all accounts. 3 trades.")


def test_end_to_end_validated_plan_compiles_scans_and_aggregates(conn):
    aid = add_account(conn, UID, "Swing")
    for i, (setup, pnl) in enumerate([("VCP", 200), ("VCP", -50), ("Flag", 80), ("Flag", 20),
                                      (None, -10)]):
        add_trade(conn, UID, day=f"2026-10-{19 + i:02d}", pnl=pnl, setup=setup, account=aid)
    raw = {"v": 1, "source": "closed_trades", "accounts": {"id": aid},
           "range": {"token": "last_30d"},
           "filters": [{"field": "side", "op": "in", "values": ["Long"]}],
           "measures": [{"key": "net_pnl"}, {"key": "win_rate"}],
           "split": {"by": "setup"}, "sort": {"measure": 0, "dir": "desc", "top": 2}}
    p = plan.validate_plan(raw, sources.CATALOG)
    rng = plan.resolve_range(p["range"], TODAY)
    sql, params = wcompile.compile_scan(sources.CLOSED, p, {}, rng, UID)
    assert params[0] == UID and "Long" in params and aid in params
    sc = sources.scan(conn, p, {}, rng, UID)
    assert sc.count == 5 and sc.account_id == aid
    res = aggregate.evaluate(sc.rows, p, sources.CATALOG)
    assert [(g.label, g.values.cells[0].value) for g in res.groups] == [("VCP", 150.0),
                                                                        ("Flag", 100.0)]
    assert total(res, 0) == pytest.approx(240.0)
    assert res.groups[0].values.cells[1].value == 0.5
    assert res.groups[0].values.cells[1].sample == "hide"     # 2 decisive trades < min_n 5


# ── fix round 1 ──────────────────────────────────────────────────────────────────────────────

def test_open_positions_are_right_now_never_a_range():
    p = plan.validate_plan(raw_plan(source="open_positions", measures=("open_positions",),
                                    range={"token": "last_30d"}), sources.CATALOG)
    assert plan.summary(p, sources.CATALOG, 2, "positions") == (
        "Open positions for open positions right now, all accounts. 2 positions.")
    assert plan.default_name(p, sources.CATALOG) == "Open positions, right now"
    rng = plan.resolve_range(p["range"], TODAY)
    assert plan.range_label_for(p, rng) == "Right now"
    p2 = plan.validate_plan(raw_plan(range={"token": "last_30d"}), sources.CATALOG)
    assert plan.range_label_for(p2, plan.resolve_range(p2["range"], TODAY)) == "last 30 days"


@pytest.mark.parametrize("extra", [{"view": {"type": "compare"}}, {"compare": {"mode": "previous"}},
                                   {"compare": {"mode": "all"}}])
def test_open_positions_refuse_compare(extra):
    with pytest.raises(plan.PlanError) as e:
        plan.validate_plan(raw_plan(source="open_positions", measures=("open_positions",),
                                    range={"token": "last_30d"}, **extra), sources.CATALOG)
    assert e.value.sentence == sources.S_POSITIONS_NO_COMPARE


def test_estimated_footnote_counts_only_positions_that_pass_the_filters(conn):
    add_position(conn, UID, symbol="EST", estimated=1, stop=100.0)       # placeholder stop
    add_position(conn, UID, symbol="EST2", estimated=1)
    add_position(conn, UID, symbol="OK")
    _sc, res = run(conn, raw_plan(source="open_positions", measures=("avg_days_open",),
                                  filters=[{"field": "had_stop", "op": "is", "values": [True]}]))
    assert ("1 position has an estimated entry date and is not counted in days open."
            in res.footnotes)
    _sc, res = run(conn, raw_plan(source="open_positions", measures=("avg_days_open",),
                                  filters=[{"field": "symbol", "op": "in", "values": ["OK"]}]))
    assert not any("estimated" in n for n in res.footnotes)


def test_hour_filter_leaves_out_date_only_and_counts_them(conn):
    for d in ("2026-10-19", "2026-10-20", "2026-10-21"):
        add_trade(conn, UID, day=d, hour=None, entry_iso=d, exit_iso=d)
    add_trade(conn, UID, day="2026-10-22", hour=10)
    _sc, res = run(conn, raw_plan(measures=("trades",), filters=[
        {"field": "hour_et", "op": "between", "values": [9, 11]}]))
    assert total(res) == 1
    assert "3 trades have no time and are left out." in res.footnotes


def test_trading_days_fold_weekend_stamps_into_the_session_before(conn):
    add_trade(conn, UID, day="2026-10-16", pnl=10.0)                     # Friday
    add_trade(conn, UID, day="2026-10-17", pnl=50.0)                     # Saturday stamp
    add_strategy(conn, UID, day="2026-10-18", pnl=-5.0, result="Loss")   # Sunday close
    add_trade(conn, UID, day="2026-10-20", pnl=7.0)
    sc, res = run(conn, raw_plan(source="trading_days", measures=("avg_day_pnl",),
                                 range={"from": "2026-10-01", "to": "2026-10-31"}))
    rows = {r["day"]: r for r in sc.rows}
    assert "2026-10-17" not in rows and "2026-10-18" not in rows
    assert rows["2026-10-16"]["day_net"] == pytest.approx(55.0)
    assert rows["2026-10-16"]["trade_count"] == 3
    cal = j2_calendar.get_calendar(UID, view="month", year=2026, month=10, conn=conn)
    cal_total = sum(d["pnlDollar"] for d in cal["days"])
    assert sum(r["day_net"] or 0 for r in sc.rows) == pytest.approx(cal_total)
    assert "2 trades dated on a weekend or holiday are counted on the session before." in sc.footnotes


def test_last_n_with_a_python_only_filter_keeps_the_newest_n_after_filtering(conn):
    for i in range(30):                                   # 30 trades with R > 1, newest first...
        add_trade(conn, UID, day=(date(2026, 8, 1) + timedelta(days=i)).isoformat(), r=2.0,
                  commit=False)
    for i in range(30):                                   # ...buried under 30 newer with R < 1
        add_trade(conn, UID, day=(date(2026, 9, 5) + timedelta(days=i)).isoformat(), r=0.5,
                  commit=False)
    conn.commit()
    raw = raw_plan(measures=("trades",), range={"token": "last_20_trades"},
                   filters=[{"field": "r", "op": "gt", "values": [1]}])
    p = plan.validate_plan(raw, sources.CATALOG)
    sql, _ = wcompile.compile_scan(sources.CLOSED, p, {}, plan.resolve_range(p["range"], TODAY), UID)
    assert sql.endswith("LIMIT 5001")
    sc, res = run(conn, raw)
    assert total(res) == 20 and len(sc.rows) == 20
    assert min(r["day"] for r in sc.rows) == "2026-08-11"      # the newest 20 of the 30


def test_last_n_list_view_flagged_rows_do_not_use_up_n(conn):
    for i in range(12):
        add_trade(conn, UID, day=f"2026-10-{i + 1:02d}", excluded=1 if i % 3 == 0 else 0)
    sc, res = run(conn, raw_plan(view={"type": "list"}, range={"token": "last_20_trades"}))
    assert sum(1 for g in res.groups if not g.flagged) == 8 and len(res.groups) == 12
    for i in range(30):
        add_trade(conn, UID, day=(date(2026, 9, 1) + timedelta(days=i)).isoformat(), commit=False)
    conn.commit()
    sc, res = run(conn, raw_plan(view={"type": "list"}, range={"token": "last_20_trades"}))
    assert sum(1 for g in res.groups if not g.flagged) == 20
    assert sum(1 for g in res.groups if g.flagged) == 4


def test_open_risk_is_zero_for_a_stop_on_the_profit_side(conn):
    add_position(conn, UID, symbol="LNG", side="Long", entry=100.0, stop=105.0, shares=10)
    add_position(conn, UID, symbol="SHT", side="Short", entry=100.0, stop=95.0, shares=10)
    add_position(conn, UID, symbol="RSK", side="Long", entry=100.0, stop=90.0, shares=10)
    sc, res = run(conn, raw_plan(source="open_positions", measures=("open_risk",)))
    by = {r["symbol"]: r for r in sc.rows}
    assert by["LNG"]["risk_dollars"] == 0.0 and by["SHT"]["risk_dollars"] == 0.0
    assert by["LNG"]["had_stop"] is True
    assert total(res) == 100.0

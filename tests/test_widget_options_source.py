"""Task 10.6 -- the Options strategies widget source.

Seeded through `auth_db.init_db` (the Task 8.5 fixtures in `tests.test_widget_sources`) on a temp
sqlite file; nothing here reaches `C:\\data`.

Facts it pins (W10-R6 and the brief): the ET day a strategy closed comes from `trading_day_et`, else
`timeutil.compute_trading_day_et(closed_at)` (never the UTC date); an open strategy is listed (and
counted by the "Strategies" measure) but never measured; the measures are the SHARED functions
(`measures.MEASURES`), widened, never copied; a stored result other than Win / Loss / BE is shown as
stored and never counted as decisive; options strategies never read the sample book.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from api.services.journal_two import measures as M
from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two.widget_engine import aggregate, payload as wpayload, plan, sources
from api.services.journal_two.widget_engine import measures as wmeasures
from api.services.journal_two.widget_engine import run as wrun
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    NOW, TODAY, UID, add_account, add_strategy, add_trade, add_user, conn,
)

RUN_NOW = datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)      # ET day = TODAY


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-wopt-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    wrun._reset_state()
    yield
    wrun._reset_state()


def add_opt(c, uid, *, entry="2026-10-20T14:00:00Z", closed_at="2026-10-21T19:00:00Z",
            status="closed", pnl=100.0, r=None, result=None, underlying="SPY",
            strategy_type="long_call", direction="bullish", setup=None, account=None,
            stamp=True, legs=(), source=None, commit=True, sid=None):
    """One strategy. `stamp`: write `trading_day_et` the way the close path does (True), leave it
    NULL (False, a legacy row), or write the given day (a str). `legs`: leg expirations."""
    sid = sid or str(uuid.uuid4())
    if status == "open":
        closed_at, pnl, r, result = None, None, None, None
    elif result is None:
        result = "Win" if pnl > 0.01 else "Loss" if pnl < -0.01 else "BE"
    if stamp is True:
        tday = sources.timeutil.compute_trading_day_et(closed_at) if closed_at else None
    else:
        tday = stamp or None
    c.execute(
        """INSERT INTO j2_option_strategies (id, user_id, account_id, underlying, strategy_type,
               direction, net_entry, entry_date, setup, status, closed_at, pnl_dollar, r_multiple,
               result, created_at, updated_at, trading_day_et, source)
           VALUES (?, ?, ?, ?, ?, ?, 100, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (sid, uid, account, underlying, strategy_type, direction, entry, setup, status, closed_at,
         pnl, r, result, NOW, NOW, tday, source))
    for i, exp in enumerate(legs):
        c.execute("INSERT INTO j2_option_legs (id, strategy_id, leg_index, side, contract_type,"
                  " strike, expiration, qty, entry_price) VALUES (?, ?, ?, 'buy', 'call', 100,"
                  " ?, 1, 1.0)", (str(uuid.uuid4()), sid, i, exp))
    if commit:
        c.commit()
    return sid


def raw(measures=("net_pnl",), **kw):
    p = {"v": 1, "source": "options_strategies", "measures": [{"key": m} for m in measures],
         "range": kw.pop("range", {"token": "all"})}
    p.update(kw)
    return p


def scan_eval(c, r, *, uid=UID, today=TODAY, settings=None):
    p = plan.validate_plan(r, sources.CATALOG)
    rng = plan.resolve_range(p["range"], today)
    sc = sources.scan(c, p, settings or {}, rng, uid, today=today)
    return p, sc, aggregate.evaluate(sc.rows, p, sources.CATALOG)


def run_out(r, *, lane="run", sample=False, uid=UID, now=RUN_NOW):
    return wrun.run_plan(uid, r, {}, lane=lane, now=now, sample=sample)


# -- the scan ------------------------------------------------------------------------------------

def test_options_rows_newest_first_and_capped_at_5000(conn):
    start = date(2010, 1, 4)
    rows = []
    for i in range(5001):
        d = start + timedelta(days=i)
        closed = f"{d.isoformat()}T19:00:00Z"
        rows.append((str(uuid.uuid4()), UID, f"{d.isoformat()}T14:00:00Z", closed, 10.0, "Win",
                     NOW, NOW, d.isoformat()))
    conn.executemany(
        """INSERT INTO j2_option_strategies (id, user_id, underlying, strategy_type, direction,
               net_entry, entry_date, status, closed_at, pnl_dollar, result, created_at,
               updated_at, trading_day_et)
           VALUES (?, ?, 'SPY', 'long_call', 'bullish', 100, ?, 'closed', ?, ?, ?, ?, ?, ?)""",
        rows)
    conn.commit()
    p, sc, res = scan_eval(conn, raw(measures=("strategies",)))
    assert sc.capped is True and len(sc.rows) == 5000 == sc.count
    days = [r["day"] for r in sc.rows]
    assert days == sorted(days, reverse=True)
    newest = (start + timedelta(days=5000)).isoformat()
    assert days[0] == newest and days[-1] == (start + timedelta(days=1)).isoformat()
    out = run_out(raw(measures=("strategies",)))
    assert out["capped"] is True and out["count"] == 5000
    assert out["notice"].startswith("Based on your newest 5,000 strategies")
    assert out["value"]["v1"] == 5000.0


def test_closed_day_from_et_not_utc(conn):
    today = date(2026, 12, 1)
    # 00:30 UTC on Nov 27 is 19:30 ET on Nov 26 (Thanksgiving): a legacy row with no stamped day
    add_opt(conn, UID, entry="2026-11-25T15:00:00Z", closed_at="2026-11-27T00:30:00Z",
            pnl=40.0, stamp=False)
    _p, sc, _res = scan_eval(conn, raw(), today=today)
    assert [r["day"] for r in sc.rows] == ["2026-11-26"]
    assert sc.rows[0]["weekday"] == "Thursday" and sc.rows[0]["month"] == "2026-11"
    on = scan_eval(conn, raw(range={"from": "2026-11-26", "to": "2026-11-26"}), today=today)[2]
    assert on.count == 1 and on.total.cells[0].value == 40.0
    after = scan_eval(conn, raw(range={"from": "2026-11-27", "to": "2026-11-30"}), today=today)[2]
    assert after.count == 0
    # a stamped day wins over the timestamp
    add_opt(conn, UID, entry="2026-11-25T15:00:00Z", closed_at="2026-11-27T00:30:00Z",
            pnl=5.0, stamp="2026-11-25")
    _p, sc, _res = scan_eval(conn, raw(), today=today)
    assert sorted(r["day"] for r in sc.rows) == ["2026-11-25", "2026-11-26"]


def test_open_strategy_day_is_its_entry_et_day(conn):
    add_opt(conn, UID, status="open", entry="2026-10-21T01:30:00Z")      # 21:30 ET on Oct 20
    _p, sc, _res = scan_eval(conn, raw(view={"type": "list"}))
    assert [(r["day"], r["open"]) for r in sc.rows] == [("2026-10-20", True)]


def test_open_strategies_listed_not_measured(conn):
    add_opt(conn, UID, closed_at="2026-10-20T19:00:00Z", pnl=100.0, r=2.0, underlying="AAA")
    add_opt(conn, UID, closed_at="2026-10-21T19:00:00Z", pnl=-50.0, r=-1.0, underlying="BBB")
    add_opt(conn, UID, status="open", entry="2026-10-22T14:00:00Z", underlying="OPEN")
    _p, sc, res = scan_eval(conn, raw(measures=("net_pnl",), view={"type": "list"}))
    assert [g.label for g in res.groups] == ["OPEN", "BBB", "AAA"]          # listed, newest first
    assert res.groups[0].values.cells[0].value is None                     # never measured
    assert res.count == 3 and res.total.cells[0].value == 50.0
    _p, _sc, res = scan_eval(conn, raw(measures=("strategies", "wins", "win_rate")))
    assert [c.value for c in res.total.cells] == [3.0, 1.0, 0.5]
    assert [c.n for c in res.total.cells] == [3, 2, 2]
    # coverage of the count is every strategy; a closed-only measure's is the closed ones
    assert (res.coverage[0].have, res.coverage[0].total) == (3, 3)
    assert (res.coverage[1].have, res.coverage[1].total) == (2, 2)
    _p, _sc, res = scan_eval(conn, raw(measures=("net_pnl", "total_r")))
    assert [c.value for c in res.total.cells] == [50.0, 1.0]
    assert (res.coverage[1].have, res.coverage[1].total) == (2, 2)
    # a filter on status narrows what is counted (open strategies appear in filters too)
    _p, _sc, res = scan_eval(conn, raw(measures=("strategies",), filters=[
        {"field": "status", "op": "in", "values": ["open"]}]))
    assert res.total.cells[0].value == 1.0
    # an open-only set is counted but measures nothing and shows no zero ("no data")
    _p, _sc, res = scan_eval(conn, raw(measures=("strategies", "net_pnl", "wins"), filters=[
        {"field": "status", "op": "in", "values": ["open"]}]))
    assert [c.value for c in res.total.cells] == [1.0, None, None]
    assert wmeasures.measure_input("options_strategies", sc.rows) == [
        r for r in sc.rows if not r["open"]]


def test_open_rows_carry_no_net_or_r_even_if_stored(conn):
    sid = add_opt(conn, UID, status="open")
    conn.execute("UPDATE j2_option_strategies SET pnl_dollar = 999, r_multiple = 9 WHERE id = ?",
                 (sid,))
    conn.commit()
    _p, sc, res = scan_eval(conn, raw(measures=("strategies", "net_pnl")))
    assert sc.rows[0]["net"] is None and sc.rows[0]["r"] is None
    # a net filter never keeps an open strategy: the SQL may read it (a stored figure), Python's
    # twin of the filter drops it, as it drops every None
    _p, sc, res = scan_eval(conn, raw(measures=("strategies",), filters=[
        {"field": "net", "op": "gt", "values": [0]}]))
    assert res.count == 0 and res.total.cells[0].value == 0.0


def test_dte_entry_from_earliest_leg(conn):
    add_opt(conn, UID, entry="2026-10-20T14:00:00Z", legs=("2026-11-20", "2026-11-13"))
    # 01:00 UTC on Oct 21 is Oct 20 ET: the entry ET day, never the UTC date
    add_opt(conn, UID, entry="2026-10-21T01:00:00Z", legs=("2026-10-30",))
    _p, sc, res = scan_eval(conn, raw(measures=("strategies",)))
    assert sorted(r["dte_entry"] for r in sc.rows) == [10.0, 24.0]
    _p, _sc, res = scan_eval(conn, raw(measures=("strategies",), filters=[
        {"field": "dte_entry", "op": "lte", "values": [14]}]))
    assert res.total.cells[0].value == 1.0


def test_no_legs_no_dte(conn):
    add_opt(conn, UID)
    _p, sc, _res = scan_eval(conn, raw(measures=("strategies",)))
    assert sc.rows[0]["dte_entry"] is None
    _p, _sc, res = scan_eval(conn, raw(measures=("strategies",), filters=[
        {"field": "dte_entry", "op": "gte", "values": [0]}]))
    assert res.count == 0


def test_legs_read_in_chunks_of_500_for_scanned_ids_only(conn):
    ids = [add_opt(conn, UID, legs=("2026-11-20",), commit=False) for _ in range(1203)]
    conn.commit()
    seen: list[str] = []
    conn.set_trace_callback(seen.append)
    try:
        _p, sc, _res = scan_eval(conn, raw(measures=("strategies",)))
    finally:
        conn.set_trace_callback(None)
    legs = [s for s in seen if "j2_option_legs" in s]
    assert len(legs) == 3                                   # 500 + 500 + 203
    named = set()
    for s in legs:
        found = {i for i in ids if i in s}
        assert len(found) <= 500
        named |= found
    assert named == set(ids) == {r["_tid"] for r in sc.rows}
    assert all(r["dte_entry"] is not None for r in sc.rows)


# -- the measures --------------------------------------------------------------------------------

def test_measures_reuse_shared_functions(conn):
    cat = sources.CATALOG.measures
    for k in wmeasures.OPTION_WIDENED:
        assert "options_strategies" in cat[k].sources, k
        assert cat[k].fn is M.MEASURES[k].fn, k                     # the shared function itself
        assert M.MEASURES[k].sources == cat[k].sources - {"options_strategies"}, k
    offered = set(wmeasures.measures_for("options_strategies"))
    assert offered == set(wmeasures.OPTION_WIDENED) | {"strategies"}
    assert "options_strategies" not in M.MEASURES["net_pnl"].sources   # the shared module unchanged
    for pnl in (600.0, 300.0, -100.0, 0.0):
        add_opt(conn, UID, pnl=pnl)
    _p, sc, res = scan_eval(conn, raw(measures=("win_rate", "profit_factor")))
    closed = [r for r in sc.rows if not r["open"]]
    assert res.total.cells[0].value == M.MEASURES["win_rate"].fn(closed).value == 2 / 3
    assert res.total.cells[1].value == M.MEASURES["profit_factor"].fn(closed).value == M.PF_CAP
    out = run_out(raw(measures=("win_rate", "profit_factor")))
    assert out["measures"][1]["fmt"] == "ratio" and out["value"]["v2"] == 5.0   # the client's "5+"
    assert [m["unit"] for m in out["measures"]] == ["strategies", "strategies"]
    assert wpayload.MEASURE_FMT["strategies"] == "count"


def test_not_enough_strategies_unit(conn):
    for pnl in (10.0, -5.0, 20.0):
        add_opt(conn, UID, pnl=pnl)
    out = run_out(raw(measures=("win_rate",)))
    assert out["measures"][0]["unit"] == "strategies"
    assert out["measures"][0]["kind"] == "rate"
    assert out["value"]["v1"] is None or out["value"].get("s1") == "hide"


def test_unknown_result_shown_as_stored_never_decisive(conn):
    add_opt(conn, UID, pnl=50.0)
    add_opt(conn, UID, pnl=-20.0)
    add_opt(conn, UID, pnl=0.0, result="Scratch")
    _p, _sc, res = scan_eval(conn, raw(measures=("wins", "losses", "win_rate"),
                                       split={"by": "result"}, view={"type": "bar"}))
    assert [g.label for g in res.groups] == ["Win", "Loss", "Scratch"]
    assert res.count == 3                                       # Scratch is listed and counted
    assert [c.value for c in res.total.cells] == [1.0, 1.0, 0.5]
    assert res.total.cells[2].n == 2                            # Scratch is not decisive


def test_options_net_matches_trading_days_options_part(conn):
    rng = {"from": "2026-10-05", "to": "2026-10-23"}
    add_trade(conn, UID, day="2026-10-06", pnl=100.0, fees=1.0)
    add_trade(conn, UID, day="2026-10-14", pnl=-40.0)
    add_trade(conn, UID, day="2026-09-30", pnl=999.0)             # outside the range
    add_opt(conn, UID, closed_at="2026-10-07T18:00:00Z", pnl=55.0)
    add_opt(conn, UID, closed_at="2026-10-10T18:00:00Z", pnl=-12.5)       # a Saturday
    add_opt(conn, UID, closed_at="2026-10-16T00:30:00Z", pnl=7.25, stamp=False)   # Oct 15 ET
    add_opt(conn, UID, closed_at="2026-10-24T00:30:00Z", pnl=3.0, stamp=False)    # Oct 23 ET
    add_opt(conn, UID, closed_at="2026-10-05T03:00:00Z", pnl=11.0, stamp=False)   # Oct 4 ET: out
    # W10-R52: the shapes where compute_trading_day_et and calendar.to_et_date disagree -- an
    # unstamped close at exactly UTC midnight (both spellings) and a bare date. All Oct 15.
    add_opt(conn, UID, closed_at="2026-10-15T00:00:00Z", pnl=70.0, stamp=False)
    add_opt(conn, UID, closed_at="2026-10-15T00:00:00+00:00", pnl=30.0, stamp=False)
    add_opt(conn, UID, closed_at="2026-10-15", pnl=20.0, stamp=False)
    add_opt(conn, UID, status="open", entry="2026-10-08T14:00:00Z")
    add_opt(conn, UID, closed_at="2026-09-29T18:00:00Z", pnl=500.0)       # outside the range
    opts = scan_eval(conn, raw(range=rng))[2].total.cells[0].value
    equity = scan_eval(conn, {"v": 1, "source": "closed_trades", "range": rng,
                              "measures": [{"key": "net_pnl"}]})[2].total.cells[0].value
    _p, sc, _res = scan_eval(conn, {"v": 1, "source": "trading_days", "range": rng,
                                    "measures": [{"key": "avg_day_pnl"}]})
    day_total = round(sum(r["net"] for r in sc.rows), 6)
    assert opts == round(55.0 - 12.5 + 7.25 + 3.0 + 70.0 + 30.0 + 20.0, 2)
    assert round(day_total - equity, 6) == opts
    # ... and on the day itself, for every shape (a fold one day back would show Oct 14)
    one = {"from": "2026-10-15", "to": "2026-10-15"}
    o15 = scan_eval(conn, raw(range=one))[2].total.cells[0].value
    _p, d15, _res = scan_eval(conn, {"v": 1, "source": "trading_days", "range": one,
                                     "measures": [{"key": "avg_day_pnl"}]})
    assert o15 == 7.25 + 70.0 + 30.0 + 20.0
    assert [(r["day"], r["net"]) for r in d15.rows] == [("2026-10-15", o15)]


def test_split_by_strategy_direction_status_in_bucket_order(conn):
    for d, st, typ in (("neutral", "closed", "iron_condor"), ("bearish", "expired", "long_put"),
                       ("bullish", "open", "long_call"), ("bearish", "rolled", "long_put"),
                       ("bullish", "assigned", "vertical_credit_put"),
                       ("neutral", "closed", "iron_condor")):
        add_opt(conn, UID, direction=d, status=st, strategy_type=typ, pnl=10.0)
    _p, _sc, res = scan_eval(conn, raw(measures=("strategies",), split={"by": "direction"},
                                       view={"type": "bar"}))
    assert [(g.label, g.values.cells[0].value) for g in res.groups] == [
        ("Bullish", 2.0), ("Bearish", 2.0), ("Neutral", 2.0)]
    _p, _sc, res = scan_eval(conn, raw(measures=("strategies",), split={"by": "status"},
                                       view={"type": "bar"}))
    assert [g.label for g in res.groups] == ["Open", "Closed", "Expired", "Assigned", "Rolled"]
    _p, _sc, res = scan_eval(conn, raw(measures=("strategies",), split={"by": "strategy"},
                                       view={"type": "bar"}))
    assert {g.label: g.values.cells[0].value for g in res.groups} == {
        "Iron Condor": 2.0, "Long Put": 2.0, "Long Call": 1.0, "Put Credit Spread": 1.0}
    _p, _sc, res = scan_eval(conn, raw(measures=("strategies",), split={"by": "underlying"},
                                       view={"type": "bar"}))
    assert [g.label for g in res.groups] == ["SPY"]


def test_account_and_setup_none_labels(conn):
    acc = add_account(conn, UID, "Main")
    add_opt(conn, UID, account=acc, setup="Wheel")
    add_opt(conn, UID)
    _p, _sc, res = scan_eval(conn, raw(measures=("strategies",), split={"by": "account"},
                                       view={"type": "bar"}))
    assert sorted(g.label for g in res.groups) == ["Main", "No account"]
    _p, _sc, res = scan_eval(conn, raw(measures=("strategies",), split={"by": "setup"},
                                       view={"type": "bar"}))
    assert sorted(g.label for g in res.groups) == ["No setup", "Wheel"]
    _p, sc, res = scan_eval(conn, raw(measures=("strategies",)), settings={"accountId": acc})
    assert res.count == 1 and sc.account_id == acc


def test_never_sample(conn):
    for pnl in (10.0, -5.0, 20.0):
        add_opt(conn, UID, pnl=pnl)
    assert wrun.wants_sample(conn, UID)                      # 0 trades: other sources would
    out = run_out(raw(measures=("strategies", "net_pnl")), lane="preview", sample=True)
    assert out["sample"] is False and out["count"] == 3
    assert out["value"]["v1"] == 3.0 and out["value"]["v2"] == 25.0
    with pytest.raises(ValueError):
        wrun.sample_rows("options_strategies")


def test_empty_sentence_exact(conn):
    out = run_out(raw(measures=("strategies",)))
    assert out["count"] == 0
    assert out["empty"] == "No options strategies in this range."


def test_formulas_filters_and_splits_on_options(conn):
    for pnl, d in ((100.0, "bullish"), (-30.0, "bearish"), (5.0, "bullish")):
        add_opt(conn, UID, pnl=pnl, direction=d)
    add_opt(conn, UID, status="open")
    f = [{"id": "f1", "name": "Green", "expr": "[net] > 0"},
         {"id": "f2", "name": "Dir", "expr": "[direction]"}]
    out = run_out(raw(measures=("strategies",)) | {
        "formulas": f, "filters": [{"field": "formula:f1", "op": "is", "values": [True]}]})
    assert out["value"]["v1"] == 2.0
    out = run_out(raw(measures=("net_pnl",)) | {"formulas": f, "split": {"by": "formula:f2"},
                                                 "view": {"type": "bar"}})
    assert {r["label"]: r["v1"] for r in out["rows"]} == {"bullish": 105.0, "bearish": -30.0}


def test_list_rows_label_underlying_and_strategy(conn):
    add_opt(conn, UID, underlying="QQQ", strategy_type="vertical_debit_call")
    out = run_out(raw(measures=("net_pnl",), view={"type": "list"}))
    assert out["rows"][0]["label"] == "QQQ" and out["rows"][0]["label2"] == "Call Debit Spread"


def test_vocabulary_hides_options_while_wave10_is_off():
    """Global constraint: with wave 10 off the vocabulary lists no new source or measure. The
    options source joined the catalog in Task 10.6, so the static vocabulary hides it (and the
    measure only it offers, and its key in a widened shared measure's sources) until wave 10."""
    import api.routers.notebook_widget_definitions as wdr
    for tools in (False, True):
        off = wdr._static_vocabulary(tools, False)
        assert "options_strategies" not in {s["key"] for s in off["sources"]}
        assert "strategies" not in {m["key"] for m in off["measures"]}
        assert all("options_strategies" not in m["sources"] for m in off["measures"])
        net = next(m for m in off["measures"] if m["key"] == "net_pnl")
        assert net["sources"] == ["closed_trades"]
        on = wdr._static_vocabulary(tools, True)                 # control: on, it is listed
        assert "options_strategies" in {s["key"] for s in on["sources"]}
        assert "options_strategies" in next(m for m in on["measures"]
                                            if m["key"] == "net_pnl")["sources"]


def test_rows_ordered_by_et_day_not_the_sql_day(conn):
    """The SQL orders by the stamped day else the UTC date; a legacy row closed 00:30 UTC on Oct 21
    is Oct 20 ET, so it must sort AFTER a stamped Oct 21 strategy, whatever their ids."""
    late = add_opt(conn, UID, closed_at="2026-10-21T00:30:00Z", pnl=5.0, stamp=False, sid="zzz")
    newer = add_opt(conn, UID, closed_at="2026-10-21T19:00:00Z", pnl=5.0, sid="aaa")
    _p, sc, _res = scan_eval(conn, raw(measures=("strategies",)))
    assert [(r["_tid"], r["day"]) for r in sc.rows] == [(newer, "2026-10-21"), (late, "2026-10-20")]


# -- fix round 1 ------------------------------------------------------------------------------

def _bulk(conn, days_pnl, *, stamp=True):
    rows = []
    for i, (d, pnl) in enumerate(days_pnl):
        rows.append((f"bulk-{i:06d}", UID, f"{d}T14:00:00Z", f"{d}T19:00:00Z", pnl,
                     "Win" if pnl > 0 else "Loss", NOW, NOW, d if stamp else None))
    conn.executemany(
        """INSERT INTO j2_option_strategies (id, user_id, underlying, strategy_type, direction,
               net_entry, entry_date, status, closed_at, pnl_dollar, result, created_at,
               updated_at, trading_day_et)
           VALUES (?, ?, 'SPY', 'long_call', 'bullish', 100, ?, 'closed', ?, ?, ?, ?, ?, ?)""",
        rows)
    conn.commit()


def test_a_full_read_whose_extra_rows_are_out_of_range_is_not_capped(conn):
    """m-1: 4,998 strategies in Oct 2-31 plus 3 stamped Oct 1 fill the 5,001-row read, yet every
    in-range strategy was read: not capped, no notice, the true count."""
    days = [f"2026-10-{2 + i % 30:02d}" for i in range(4998)] + ["2026-10-01"] * 3
    _bulk(conn, [(d, 1.0) for d in days])
    rng = {"from": "2026-10-02", "to": "2026-10-31"}
    _p, sc, _res = scan_eval(conn, raw(measures=("strategies",), range=rng), today=date(2026, 11, 2))
    assert sc.capped is False and sc.count == 4998


def test_a_capped_read_states_the_strategies_it_kept(conn):
    """m-1: past the cap, the notice names the strategies actually kept (the ET-day cut can
    leave fewer than the cap), and a path-dependent measure carries the footnote (m-3)."""
    # 3,000 stamped Oct 20 closes, then 3,000 legacy closes at 02:00 UTC Oct 11 (Oct 10 ET; the
    # SQL orders them by their UTC day, Oct 11). The read stops inside the legacy block, so the
    # honest newest set is the 3,000 Oct 20 closes: unread ones are Oct 10 too.
    _bulk(conn, [("2026-10-20", 1.0 if i % 3 else -2.0) for i in range(3000)])
    legacy = [(f"legacy-{i:05d}", UID, "2026-10-10T14:00:00Z", "2026-10-11T02:00:00Z", 1.0,
               "Win", NOW, NOW) for i in range(3000)]
    conn.executemany(
        """INSERT INTO j2_option_strategies (id, user_id, underlying, strategy_type, direction,
               net_entry, entry_date, status, closed_at, pnl_dollar, result, created_at,
               updated_at) VALUES (?, ?, 'SPY', 'long_call', 'bullish', 100, ?, 'closed', ?, ?,
               ?, ?, ?)""", legacy)
    conn.commit()
    out = run_out(raw(measures=("max_drawdown",)))
    assert out["capped"] is True
    n = out["count"]
    assert n == 3000
    assert out["notice"].startswith(f"Based on your newest {n:,} strategies")
    assert f"Max drawdown: within your newest {n:,} strategies." in out["footnotes"]


def test_a_closed_strategy_with_no_close_day_is_listed_on_its_entry_day(conn):
    """m-4: the SQL COALESCE keeps it (closed_at, then entry); Python keeps it too."""
    sid = add_opt(conn, UID, entry="2026-10-21T01:00:00Z", pnl=15.0, stamp=False)
    conn.execute("UPDATE j2_option_strategies SET closed_at = NULL WHERE id = ?", (sid,))
    conn.commit()
    _p, sc, res = scan_eval(conn, raw(measures=("strategies",)))
    assert [(r["_tid"], r["day"]) for r in sc.rows] == [(sid, "2026-10-20")]
    assert res.total.cells[0].value == 1.0

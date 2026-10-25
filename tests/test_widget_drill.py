"""Task 8.11 (ruling R-23) -- drill-down: the rows behind one cell of a built widget.

Seeded through `auth_db.init_db` (the Task 8.5 fixtures in `tests.test_widget_sources`) on a temp
sqlite file; nothing here reaches `C:\\data`.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two.widget_engine import drill as wdrill
from api.services.journal_two.widget_engine import run
from api.services.journal_two.widget_engine import sources as wsources
from api.services.journal_two.widget_engine.plan import PlanError
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    UID, add_position, add_trade, add_user, conn, raw_plan,
)

NOW = datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)
OTHER = "u-wsrc-other"


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-widget-drill-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    run._reset_state()
    yield
    run._reset_state()


def _drill(plan, cell=None, *, settings=None, uid=UID, **kw):
    return wdrill.drill(uid, plan, settings or {}, cell if cell is not None else {}, now=NOW, **kw)


def test_all_rows_capped_at_40_with_more(conn):
    for i in range(45):
        add_trade(conn, UID, day=f"2026-10-{1 + i % 20:02d}", pnl=10 + i, commit=False)
    conn.commit()
    out = _drill(raw_plan())
    assert len(out["rows"]) == wdrill.MAX_ROWS == 40
    assert out["more"] == 5 and out["count"] == 45
    assert set(out["rows"][0]) == {"id", "symbol", "side", "day", "net", "r", "setup", "flagged"}
    days = [r["day"] for r in out["rows"]]
    assert days == sorted(days, reverse=True)                  # newest first


def test_group_found_by_its_clipped_label(conn):
    long_setup = "Breakout " + "x" * 120 + " __proto__ ' % ; --"
    add_trade(conn, UID, day="2026-10-20", setup=long_setup, symbol="AAA")
    add_trade(conn, UID, day="2026-10-21", setup="Flag", symbol="BBB")
    plan = raw_plan(split={"by": "setup"}, view={"type": "bar"})
    clipped = nw._clip(long_setup, 60)
    out = _drill(plan, {"label": clipped})
    assert [r["symbol"] for r in out["rows"]] == ["AAA"]
    assert _drill(plan, {"label": long_setup})["rows"] == []   # the unclipped text is not a label
    assert [r["symbol"] for r in _drill(plan, {"label": "Flag"})["rows"]] == ["BBB"]


def test_flagged_trades_listed_and_labelled_but_not_counted(conn):
    add_trade(conn, UID, day="2026-10-20", setup="Flag", symbol="OK1")
    add_trade(conn, UID, day="2026-10-21", setup="Flag", symbol="FLG", excluded=1)
    plan = raw_plan(split={"by": "setup"}, view={"type": "bar"})
    out = _drill(plan, {"label": "Flag"})
    by_sym = {r["symbol"]: r["flagged"] for r in out["rows"]}
    assert by_sym == {"OK1": False, "FLG": True}
    assert out["count"] == 1                                   # what the aggregate counted


def test_two_way_split_uses_label2(conn):
    add_trade(conn, UID, day="2026-10-20", setup="Flag", side="Long", symbol="L1")
    add_trade(conn, UID, day="2026-10-21", setup="Flag", side="Short", symbol="S1")
    plan = raw_plan(split={"by": "setup", "then": "side"}, view={"type": "table"})
    assert [r["symbol"] for r in _drill(plan, {"label": "Flag", "label2": "Short"})["rows"]] == ["S1"]
    assert len(_drill(plan, {"label": "Flag"})["rows"]) == 2


def test_scatter_point(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=100, r=2.0, symbol="P1")
    add_trade(conn, UID, day="2026-10-20", pnl=-50, r=-1.0, symbol="P2")
    plan = raw_plan(measures=("net_pnl", "total_r"), view={"type": "scatter"})
    out = _drill(plan, {"d": "2026-10-20", "x": 100.0, "y": 2.0})
    assert [r["symbol"] for r in out["rows"]] == ["P1"]


def test_tag_split_matches_any_of_the_rows_tags(conn):
    add_trade(conn, UID, day="2026-10-20", mistakes=["FOMO", "it's 50%"], symbol="T1")
    add_trade(conn, UID, day="2026-10-21", mistakes=["Late"], symbol="T2")
    plan = raw_plan(split={"by": "mistake"}, view={"type": "bar"})
    assert [r["symbol"] for r in _drill(plan, {"label": "it's 50%"})["rows"]] == ["T1"]


def test_never_another_members_rows(conn, monkeypatch):
    add_user(conn, OTHER)
    mine = add_trade(conn, UID, day="2026-10-20", symbol="MINE")
    theirs = add_trade(conn, OTHER, day="2026-10-20", symbol="THEIRS")
    out = _drill(raw_plan())
    assert [r["id"] for r in out["rows"]] == [mine]

    # Defence in depth: even a scan that somehow handed back another member's row drops it.
    real = wsources.scan

    def leaky(c, plan, settings, rng, user_id, *, today=None):
        sc = real(c, plan, settings, rng, user_id, today=today)
        other = real(c, plan, settings, rng, OTHER, today=today)
        return wsources.Scan(sc.source, sc.rows + other.rows, sc.capped, sc.earliest_day,
                             sc.count + other.count, sc.account_id)

    monkeypatch.setattr(wsources, "scan", leaky)
    ids = [r["id"] for r in _drill(raw_plan())["rows"]]
    assert ids == [mine] and theirs not in ids


def test_foreign_account_is_treated_as_all_accounts(conn):
    add_user(conn, OTHER)
    add_trade(conn, UID, day="2026-10-20", symbol="MINE")
    add_trade(conn, OTHER, day="2026-10-20", symbol="THEIRS")
    out = _drill(raw_plan(), settings={"accountId": "not-mine"})
    assert [r["symbol"] for r in out["rows"]] == ["MINE"]
    assert out["note"] == run.S_ACCOUNT_GONE
    both = _drill(raw_plan(), settings={"accountId": "not-mine"}, snapshot_count=9,
                  snapshot_at="2026-10-20")
    assert both["note"] == run.S_ACCOUNT_GONE + " Live data; the snapshot was taken on Oct 20"
    assert _drill(raw_plan())["note"] is None


def test_live_note_when_count_differs(conn):
    for d in ("2026-10-20", "2026-10-21", "2026-10-22"):
        add_trade(conn, UID, day=d)
    same = _drill(raw_plan(), snapshot_count=3, snapshot_at="2026-10-20T15:00:00Z")
    assert same["live"] is False and same["note"] is None
    moved = _drill(raw_plan(), snapshot_count=2, snapshot_at="2026-10-20T15:00:00Z")
    assert moved["live"] is True
    assert moved["note"] == "Live data; the snapshot was taken on Oct 20"
    assert _drill(raw_plan())["live"] is False                 # no snapshot count: nothing to compare


def test_not_cached(conn):
    add_trade(conn, UID, day="2026-10-20")
    assert len(_drill(raw_plan())["rows"]) == 1
    add_trade(conn, UID, day="2026-10-21")
    assert len(_drill(raw_plan())["rows"]) == 2


def test_runs_under_the_drill_lane(conn):
    add_trade(conn, UID, day="2026-10-20")
    with run.admit(UID, "run"), run.admit(UID, "run"):
        with pytest.raises(run.EngineBusy):
            _drill(raw_plan())
    assert run._GATES.member == {}


def test_days_and_positions_row_shapes(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=40)
    out = _drill(raw_plan(source="trading_days", measures=("avg_day_pnl",),
                          range={"token": "last_7d"}), {"label": "2026-10-20"})
    assert out["rows"] == [{"day": "2026-10-20", "net": 40.0, "trades": 1}]
    days = _drill(raw_plan(source="trading_days", measures=("avg_day_pnl",),
                           range={"token": "last_7d"}))["rows"]
    assert {"day": "2026-10-20", "net": 40.0, "trades": 1} in days
    add_position(conn, UID, symbol="AAPL")
    pos = _drill(raw_plan(source="open_positions", measures=("open_positions",)))["rows"]
    assert pos and pos[0]["symbol"] == "AAPL" and "id" in pos[0] and pos[0]["flagged"] is False


@pytest.mark.parametrize("cell", [
    {"label": 3}, {"nope": 1}, {"d": "2026-10-20", "x": 1}, {"label2": "x"}, "label",
    {"d": "2026-10-20", "x": float("inf"), "y": 1},
])
def test_bad_cell_is_a_sentence(conn, cell):
    with pytest.raises(PlanError) as e:
        _drill(raw_plan(), cell)
    assert e.value.sentence == wdrill.S_BAD_CELL


def test_scatter_point_never_matches_a_flagged_trade(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=100, r=2.0, symbol="P1")
    add_trade(conn, UID, day="2026-10-20", pnl=100, r=2.0, symbol="FLG", excluded=1)
    plan = raw_plan(measures=("net_pnl", "total_r"), view={"type": "scatter"})
    out = _drill(plan, {"d": "2026-10-20", "x": 100.0, "y": 2.0})
    assert [r["symbol"] for r in out["rows"]] == ["P1"] and out["count"] == 1


# -- wave 10 (Task 10.6): options strategies and formulas at the drill door ------------------------

def test_options_drill_rows_and_owned_ids(conn, monkeypatch):
    from tests.test_widget_options_source import add_opt
    add_user(conn, OTHER)
    s1 = add_opt(conn, UID, closed_at="2026-10-20T19:00:00Z", pnl=120.0, r=1.5,
                 underlying="QQQ", strategy_type="iron_condor")
    s2 = add_opt(conn, UID, status="open", entry="2026-10-21T14:00:00Z", underlying="SPY")
    theirs = add_opt(conn, OTHER, closed_at="2026-10-20T19:00:00Z", pnl=7000.0, underlying="QQQ")
    plan = {"v": 1, "source": "options_strategies", "measures": [{"key": "strategies"}],
            "range": {"token": "all"}}
    out = _drill(plan)
    assert out["count"] == 2 and out["more"] == 0
    assert out["rows"] == [
        {"day": "2026-10-21", "label": "SPY", "label2": "Long Call", "net": None, "r": None,
         "result": None, "open": True, "strategyId": s2},
        {"day": "2026-10-20", "label": "QQQ", "label2": "Iron Condor", "net": 120.0, "r": 1.5,
         "result": "Win", "open": False, "strategyId": s1},
    ]
    # W10-R65: the open flag is the scan's own (status "open"), each way on its own row.
    by_id = {r["strategyId"]: r for r in out["rows"]}
    assert by_id[s2]["open"] is True and by_id[s1]["open"] is False
    split = dict(plan, split={"by": "strategy"}, view={"type": "bar"})
    assert [r["strategyId"] for r in _drill(split, {"label": "Iron Condor"})["rows"]] == [s1]

    # Defence in depth: a scan that somehow handed back another member's strategy drops it.
    real = wsources.scan

    def leaky(c, p, settings, rng, user_id, *, today=None):
        sc = real(c, p, settings, rng, user_id, today=today)
        other = real(c, p, settings, rng, OTHER, today=today)
        return wsources.Scan(sc.source, sc.rows + other.rows, sc.capped, sc.earliest_day,
                             sc.count + other.count, sc.account_id)

    monkeypatch.setattr(wsources, "scan", leaky)
    ids = [r["strategyId"] for r in _drill(plan)["rows"]]
    assert sorted(ids) == sorted([s1, s2]) and theirs not in ids
    assert wdrill._OWN_TABLE["options_strategies"] == "j2_option_strategies"


def _fp(**kw):
    p = {"v": 1, "source": "closed_trades", "range": {"token": "all"},
         "formulas": [{"id": "f1", "name": "Green", "expr": "[net] > 0"},
                      {"id": "f2", "name": "My side", "expr": "[side]"},
                      {"id": "f3", "name": "Double", "expr": "[net] * 2", "format": "money"},
                      {"id": "f4", "name": "Twice R", "expr": "[r] * 2", "format": "r"}],
         "measures": [{"key": "net_pnl"}]}
    p.update(kw)
    return p


def test_formula_split_filter_and_scatter_drill(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=100, r=2.0, symbol="W1", side="Long")
    add_trade(conn, UID, day="2026-10-20", pnl=-50, r=-1.0, symbol="L1", side="Short")
    add_trade(conn, UID, day="2026-10-21", pnl=30, r=0.5, symbol="W2", side="Short")
    by_bool = _fp(split={"by": "formula:f1"}, view={"type": "bar"})
    assert sorted(r["symbol"] for r in _drill(by_bool, {"label": "Yes"})["rows"]) == ["W1", "W2"]
    assert [r["symbol"] for r in _drill(by_bool, {"label": "No"})["rows"]] == ["L1"]
    by_text = _fp(split={"by": "formula:f2"}, view={"type": "bar"})
    assert sorted(r["symbol"] for r in _drill(by_text, {"label": "Short"})["rows"]) == ["L1", "W2"]
    two_way = _fp(split={"by": "setup", "then": "formula:f1"}, view={"type": "table"})
    assert sorted(r["symbol"] for r in _drill(two_way, {"label": "No setup",
                                                         "label2": "Yes"})["rows"]) == ["W1", "W2"]
    filtered = _fp(filters=[{"field": "formula:f1", "op": "is", "values": [True]}])
    out = _drill(filtered)
    assert sorted(r["symbol"] for r in out["rows"]) == ["W1", "W2"] and out["count"] == 2
    # a scatter point on two FORMULA measures (the 10.5 sweep's 500): the trade whose plotted
    # values they are, and only it
    pts = _fp(measures=[{"formula": "f3", "agg": "sum"}, {"formula": "f4", "agg": "sum"}],
              view={"type": "scatter"})
    assert [r["symbol"] for r in _drill(pts, {"d": "2026-10-20", "x": 200.0, "y": 4.0})["rows"]] \
        == ["W1"]
    assert [r["symbol"] for r in _drill(pts, {"d": "2026-10-20", "x": -100.0, "y": -2.0})["rows"]] \
        == ["L1"]
    assert _drill(pts, {"d": "2026-10-21", "x": 200.0, "y": 4.0})["rows"] == []
    # a formula point and a catalog measure point agree on the same trade
    mixed = _fp(measures=[{"key": "net_pnl"}, {"formula": "f4", "agg": "sum"}],
                view={"type": "scatter"})
    assert [r["symbol"] for r in _drill(mixed, {"d": "2026-10-21", "x": 30.0, "y": 1.0})["rows"]] \
        == ["W2"]


def test_scatter_point_needs_both_values_and_ignores_the_sort_trim(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=100, r=2.0, symbol="A1")
    add_trade(conn, UID, day="2026-10-20", pnl=100, r=3.0, symbol="A2")    # same x, other y
    add_trade(conn, UID, day="2026-10-20", pnl=500, r=9.0, symbol="BIG")
    pts = _fp(measures=[{"formula": "f3", "agg": "sum"}, {"formula": "f4", "agg": "sum"}],
              view={"type": "scatter"})
    assert [r["symbol"] for r in _drill(pts, {"d": "2026-10-20", "x": 200.0, "y": 6.0})["rows"]] \
        == ["A2"]
    # a plan sorted to its top 1 still drills any point it drew (the trim is the widget's, the
    # drill reads every row of the day)
    top1 = dict(pts, sort={"measure": 0, "dir": "desc", "top": 1})
    assert [r["symbol"] for r in _drill(top1, {"d": "2026-10-20", "x": 200.0, "y": 4.0})["rows"]] \
        == ["A1"]


# -- wave 10 (Task 10.7): notes at the drill door --------------------------------------------------

def test_notes_drill_rows_open_the_note_and_owned_ids(conn, monkeypatch):
    from tests.test_widget_notes_source import add_folder, add_n
    add_user(conn, OTHER)
    ideas = add_folder(conn, UID, "Ideas")
    long_title = "An earnings plan " + "x" * 80
    n1 = add_n(conn, UID, created="2026-10-22T03:30:00Z", title=long_title, folder=ideas)
    n2 = add_n(conn, UID, created="2026-10-20T15:00:00Z", title="Monday prep")
    theirs = add_n(conn, OTHER, created="2026-10-20T15:00:00Z", title="THEIRS", folder=ideas)
    plan = {"v": 1, "source": "notes", "measures": [{"key": "notes"}], "range": {"token": "all"}}
    out = _drill(plan)
    assert out["count"] == 2 and out["more"] == 0
    assert out["rows"] == [
        {"day": "2026-10-21", "label": nw._clip(long_title, 60), "noteId": n1},
        {"day": "2026-10-20", "label": "Monday prep", "noteId": n2},
    ]
    assert len(out["rows"][0]["label"]) <= 60
    split = dict(plan, split={"by": "folder"}, view={"type": "bar"})
    assert [r["noteId"] for r in _drill(split, {"label": "Ideas"})["rows"]] == [n1]
    assert [r["noteId"] for r in _drill(split, {"label": "No folder"})["rows"]] == [n2]
    assert wdrill._OWN_TABLE["notes"] == "j2_notes"

    # Defence in depth: a scan that somehow handed back another member's note drops it, and its
    # title is never read.
    real = wsources.scan

    def leaky(c, p, settings, rng, user_id, *, today=None):
        sc = real(c, p, settings, rng, user_id, today=today)
        other = real(c, p, settings, rng, OTHER, today=today)
        return wsources.Scan(sc.source, sc.rows + other.rows, sc.capped, sc.earliest_day,
                             sc.count + other.count, sc.account_id)

    monkeypatch.setattr(wsources, "scan", leaky)
    rows = _drill(plan)["rows"]
    assert sorted(r["noteId"] for r in rows) == sorted([n1, n2]) and theirs not in str(rows)
    assert "THEIRS" not in str(rows)

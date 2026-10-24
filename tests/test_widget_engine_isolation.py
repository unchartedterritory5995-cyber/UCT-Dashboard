"""Task 8.5 isolation rail: a widget run reads the session member's rows and nothing else.

Two members share symbols, setups, days and tags. Member B's numbers are distinctive (7,777 and
up) so any leak shows in A's totals. For every source and each of a split, a filter, and
`accounts={"id": <B's account>}`: A's result holds no row, count or label of B's, and B's account
id gives exactly A's "all my accounts" result (absent, never B's).
"""
from __future__ import annotations

import pytest

from tests.test_widget_sources import (
    add_account, add_checkin, add_note, add_position, add_strategy, add_trade, add_user,
    raw_plan, run,
)
from api.services import auth_db

A, B = "u-iso-A", "u-iso-B"
DAYS = ("2026-10-19", "2026-10-20", "2026-10-21")
RANGE = {"from": "2026-10-19", "to": "2026-10-23"}


@pytest.fixture
def two(monkeypatch, tmp_path):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "iso.db"))
    auth_db.init_db()
    c = auth_db.get_connection()
    add_user(c, A)
    add_user(c, B)
    acc_a = add_account(c, A, "Main", size=10_000)
    acc_b = add_account(c, B, "Main", size=10_000)           # same name, B's own id
    a_tids = []
    for i, d in enumerate(DAYS):
        a_tids.append(add_trade(c, A, day=d, pnl=100.0 + i, setup="Shared", symbol="NVDA",
                                mistakes=["chased"], account=acc_a, r=None, stop=100.0))
        add_trade(c, B, day=d, pnl=7777.0 + i, setup="Shared", symbol="NVDA",
                  mistakes=["chased"], account=acc_b)
        add_trade(c, B, day=d, pnl=8888.0, setup="B only", symbol="BONLY", account=acc_b)
    # A child row of B's keyed on A's trade ref must never reach A.
    c.execute("INSERT INTO j2_trade_excursions (user_id, trade_ref, symbol, true_r, computed_at)"
              " VALUES (?, ?, 'NVDA', 99.0, 'x')", (B, f"id:{a_tids[0]}"))
    c.execute("INSERT INTO j2_trade_plan_links (user_id, trade_ref, symbol, source_kind,"
              " match_tier, plan_json, matched_at) VALUES (?, ?, 'NVDA', 'note', 'exact', '{}', 'x')",
              (B, f"id:{a_tids[0]}"))
    c.commit()
    add_position(c, A, symbol="NVDA", setup="Shared", mark=110.0, account=acc_a)
    add_position(c, B, symbol="NVDA", setup="Shared", mark=9000.0, account=acc_b)
    add_position(c, B, symbol="BONLY", setup="B only", mark=9000.0, account=acc_b)
    add_strategy(c, B, day=DAYS[0], pnl=7000.0, account=acc_b)
    add_strategy(c, B, day="2026-10-22", pnl=7000.0, account=acc_b)
    n_a = add_note(c, A, updated_at="2026-10-19T10:00:00Z")
    n_b = add_note(c, B, updated_at="2026-10-19T11:00:00Z")
    add_checkin(c, A, n_a, day=DAYS[0], mood=2, focus=2)
    add_checkin(c, B, n_b, day=DAYS[0], mood=5, focus=5)
    add_checkin(c, B, n_b, day="2026-10-22", mood=5, focus=5)
    c.execute("INSERT INTO j2_day_notes (id, user_id, date, created_at, updated_at)"
              " VALUES ('dn-b', ?, '2026-10-23', 'x', 'x')", (B,))
    c.commit()
    try:
        yield c, acc_a, acc_b
    finally:
        c.close()


def digest(res):
    return ([(g.key, g.label, g.key2, g.label2, g.flagged, g.values.n,
              tuple((x.value, x.n, x.have) for x in g.values.cells)) for g in res.groups],
            tuple((x.value, x.n, x.have) for x in res.total.cells), res.count, res.footnotes,
            [(cv.have, cv.total, cv.hint) for cv in res.coverage])


CASES = {
    "closed_trades": dict(
        measures=("net_pnl", "trades", "total_r"),
        split={"by": "setup"},
        filter=[{"field": "mistake", "op": "has_any", "values": ["chased"]}],
        a_total=303.0, a_labels={"Shared"}),
    "open_positions": dict(
        measures=("open_positions", "unrealised_pnl"),
        split={"by": "symbol"},
        filter=[{"field": "setup", "op": "in", "values": ["Shared"]}],
        a_total=1.0, a_labels={"NVDA"}),
    "trading_days": dict(
        measures=("avg_day_pnl", "green_day_pct"),
        split={"by": "weekday"},
        filter=[{"field": "trade_count", "op": "gte", "values": [1]}],
        # quiet sessions are rows too; B's Thursday option close must not make one active
        a_total=101.0, a_labels={"Monday", "Tuesday", "Wednesday", "Thursday", "Friday"}),
}


@pytest.mark.parametrize("source", sorted(CASES))
@pytest.mark.parametrize("mode", ["split", "filter", "accounts"])
def test_member_a_never_sees_member_b(two, source, mode):
    c, acc_a, acc_b = two
    case = CASES[source]
    base = dict(source=source, measures=case["measures"], range=RANGE)
    if mode == "split":
        base["split"] = case["split"]
    elif mode == "filter":
        base["filters"] = case["filter"]
    sc_all, res_all = run(c, raw_plan(**base), uid=A)

    # Nothing of B's in A's rows, labels or totals.
    assert all(r.get("symbol") != "BONLY" for r in sc_all.rows)
    assert all((g.label or "") != "B only" for g in res_all.groups)
    assert res_all.total.cells[0].value == pytest.approx(case["a_total"])
    if mode == "split":
        assert {g.label for g in res_all.groups} == case["a_labels"]
        if source == "trading_days":
            thu = next(g for g in res_all.groups if g.label == "Thursday")
            assert thu.values.cells[0].value is None and thu.values.cells[0].n == 0
    for r in sc_all.rows:
        for k in ("net", "day_net", "unrealised", "best_trade"):
            v = r.get(k)
            assert v is None or abs(v) < 7000, (k, v)
    if source == "closed_trades":
        first = next(r for r in sc_all.rows if r["day"] == DAYS[0])
        assert first["r"] is None and first["plan_linked"] is False, "B's child rows reached A"
    if source == "trading_days":
        by_day = {r["day"]: r for r in sc_all.rows}
        assert by_day[DAYS[0]]["mood"] == 2.0 and by_day["2026-10-22"]["mood"] is None
        assert by_day["2026-10-22"]["trade_count"] == 0
        assert by_day["2026-10-23"]["had_day_note"] is False

    # B's account id reads as absent: exactly A's "all my accounts" result.
    raw_b = raw_plan(**base, accounts={"id": acc_b})
    sc_b, res_b = run(c, raw_b, uid=A)
    assert digest(res_b) == digest(res_all)
    assert sc_b.account_id is None and len(sc_b.rows) == len(sc_all.rows)
    # And through the viewer setting too.
    sc_s, res_s = run(c, raw_plan(**base), uid=A, settings={"accountId": acc_b})
    assert digest(res_s) == digest(res_all) and sc_s.account_id is None
    # A's own account narrows (here: to the same rows, every A row is in it).
    sc_a, res_a = run(c, raw_plan(**base, accounts={"id": acc_a}), uid=A)
    assert sc_a.account_id == acc_a and digest(res_a) == digest(res_all)


def test_filtering_on_b_account_id_gives_a_nothing(two):
    c, _acc_a, acc_b = two
    sc, res = run(c, raw_plan(measures=("trades",), range=RANGE, filters=[
        {"field": "account", "op": "in", "values": [acc_b]}]), uid=A)
    assert sc.rows == [] and res.total.cells[0].value == 0


def test_b_sees_only_b(two):
    c, _acc_a, _acc_b = two
    _sc, res = run(c, raw_plan(measures=("net_pnl",), range=RANGE, split={"by": "setup"}), uid=B)
    assert {g.label for g in res.groups} == {"Shared", "B only"}
    assert res.total.cells[0].value == pytest.approx(7777 * 3 + 3 + 8888 * 3)

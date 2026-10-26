"""Task 10.11 isolation: member B's plan links, trades, positions and fires never reach member A.

B is seeded with a LARGER book than A after A's answers are read once; every answer A gets must be
unchanged (W9-R18: another member's row is absent, never read).
"""
from __future__ import annotations

from tests.test_shelf_compose import (  # noqa: F401  (S is a fixture)
    A, B, MON, S, _conn, _earn, _prep, _wire, et_epoch, ind_fire, link, open_strategy, position,
    price_fire, s7_fire, trade,
)


def _answers(S, a_trade):
    def strip(p):
        p = dict(p)
        p.pop("asOf", None)
        return p
    return (strip(S.my_plan_vs_actual(A, {"tradeId": a_trade}, MON)),
            strip(S.my_game_plan(A, {}, MON)),
            strip(S.my_alerts_fired(A, {}, MON)))


def test_member_b_never_reaches_a(S, monkeypatch):
    _prep(monkeypatch, _wire(), _earn())
    with _conn() as c:
        a_trade = trade(c, A, entry=100.5, stop=95.0, r=1.0)
        link(c, A, a_trade, {"entry": 100.0, "stop": 96.0, "target": 110.0, "shares": 10})
        position(c, A, symbol="AAPL", entry=100.0, stop=98.0, shares=10)
    ind_fire(A, at=et_epoch("2026-10-23", "16:30"), sym="AIND")
    before = _answers(S, a_trade)
    assert before[0]["rows"] and before[1]["risk"]["openRisk"] == 20.0
    assert [r["symbol"] for r in before[2]["rows"]] == ["AIND"]

    with _conn() as c:
        for i in range(5):
            b_trade = trade(c, B, entry=50.0 + i, stop=40.0, symbol=f"B{i}")
            link(c, B, b_trade, {"entry": 50.0, "stop": 45.0, "target": 70.0, "shares": 100})
            position(c, B, symbol=f"B{i}", entry=500.0, stop=400.0, shares=1000)
            position(c, B, acc=None, symbol=f"BN{i}", entry=500.0, stop=500.0, shares=1000)
            open_strategy(c, B)
    for i in range(60):
        ind_fire(B, at=et_epoch("2026-10-23", "17:00") + i, sym=f"BI{i}")
        s7_fire(B, at=et_epoch("2026-10-23", "17:00") + i, sym=f"BS{i}")
        price_fire(B, at=et_epoch("2026-10-23", "17:00") + i, sym=f"BP{i}")   # fix 2 M-4
    after = _answers(S, a_trade)
    assert after == before
    # B's own trade, asked for by A, is absent with its one notice.
    assert S.my_plan_vs_actual(A, {"tradeId": b_trade}, MON)["lines"] == ["Not available."]
    # CONTROL: B does see B's book.
    assert S.my_game_plan(B, {}, MON)["risk"]["openPositions"] == 10
    assert len(S.my_alerts_fired(B, {}, MON)["rows"]) == 40

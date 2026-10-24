"""Task 8.3 -- the shared measure module (`api/services/journal_two/measures.py`).

Parity is proved against the REAL definitions, not a copy of them: the registry side is a
`metrics_registry` `Ctx` built by `_build_ctx` over a seeded temp sqlite, and the measure side is
the same fetched rows mapped to the plain row dicts the builder consumes (`net, gross, fees,
result, r, hold_days, day`). The database is a temp file (`auth_db._DB_PATH`); nothing here
reaches `C:\\data`.
"""
from __future__ import annotations

import math
import uuid
from datetime import date, timedelta, datetime, timezone

import pytest

from api.services import auth_db
from api.services.journal_two import accounts, analytics, metrics_registry, measures
from api.services.journal_two.filters import FilterSpec
from api.services.journal_two.measures import MEASURES, MeasureValue, PF_CAP, small_sample

UID = "u-measures-1"


# ── fixtures ────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def conn(monkeypatch, tmp_path):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "measures.db"))
    auth_db.init_db()
    c = auth_db.get_connection()
    c.execute("INSERT INTO users (id, email, password_hash, display_name, role)"
              " VALUES (?, ?, 'x', 'x', 'member')", (UID, f"{UID}@example.test"))
    c.commit()
    aid = accounts.get_or_migrate_default_account(UID, conn=c)["id"]
    c.commit()
    try:
        yield c, aid
    finally:
        c.close()


def _insert(c, aid, day: str, *, pnl: float, fees: float, result: str,
            r: float | None, hold: int) -> None:
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    exit_iso = f"{day}T18:00:00Z"
    c.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price,
               entry_date, exit_price, exit_date, original_stop, setup, notes, pnl_dollar,
               pnl_percent, r_multiple, hold_days, result, context_at_entry, account_id,
               created_at, trading_day_et, hour_et, fees)
           VALUES (?, ?, 'manual', 'NVDA', 'Long', 100, 500, ?, 510, ?, 490, 'VCP', NULL, ?,
                   0.02, ?, ?, ?, '{}', ?, ?, ?, NULL, ?)""",
        (tid, UID, exit_iso, exit_iso, pnl, r, hold, result, aid, now, day, fees))


def _seed(c, aid, trades) -> None:
    for t in trades:
        _insert(c, aid, *t[:1], **t[1])
    c.commit()


def _days(n: int) -> list[str]:
    start = date(2026, 3, 2)
    return [(start + timedelta(days=i)).isoformat() for i in range(n)]


def _fixture_30(with_fees: bool):
    """30 trades over 12 days: wins, losses, breakevens, R missing on some, one Win whose fee
    eats its gross (net < 0, so it is a Win in the count but not in the PF numerator)."""
    days = _days(12)
    pnls = [420.5, -180.25, 0.0, 95.0, -310.0, 260.75, 12.0, -45.5, 0.0, 700.0,
            -220.0, 150.25, 88.0, -95.0, 33.3, -410.0, 510.0, 0.0, -60.0, 140.0,
            75.5, -130.0, 240.0, -15.0, 365.0, 2.0, -290.0, 180.0, 55.0, -70.25]
    out = []
    for i, p in enumerate(pnls):
        result = "Win" if p > 0 else ("Loss" if p < 0 else "BE")
        fee = (1.5 + (i % 4) * 0.75) if with_fees else 0.0
        if with_fees and i == 25:          # a Win of $2.00 gross with a $4.25 fee -> net < 0
            fee = 4.25
        r = None if i % 3 == 0 else round(p / 200.0, 3)
        out.append((days[i % 12], dict(pnl=p, fees=fee, result=result, r=r, hold=i % 7)))
    return out


def _ctx_and_rows(c):
    ctx = metrics_registry._build_ctx(c, UID, None, FilterSpec())
    rows = [{
        "id": r["id"],
        "net": float(r["pnl_dollar"] or 0) - float(r["fees"] or 0),
        "gross": float(r["pnl_dollar"] or 0),
        "fees": float(r["fees"] or 0),
        "result": r["result"],
        "r": ctx.r_map.get(r["id"]),
        "hold_days": r["hold_days"],
        "day": metrics_registry._day(r),
    } for r in ctx.rows]
    return ctx, rows


def _row(net=0.0, result="Win", day="2026-03-02", r=None, hold_days=1, rid=None, fees=0.0):
    return {"id": rid or uuid.uuid4().hex, "net": net, "gross": net + fees, "fees": fees,
            "result": result, "r": r, "hold_days": hold_days, "day": day}


# ── parity with the registry and analytics ────────────────────────────────────────────────────

def test_vocabulary_parity(conn):
    c, aid = conn
    _seed(c, aid, _fixture_30(with_fees=True))
    ctx, rows = _ctx_and_rows(c)
    assert len(rows) == 30
    vocab = metrics_registry.build_vocabulary(ctx)
    assert set(metrics_registry.VOCABULARY_KEYS) <= set(MEASURES)
    checked = 0
    for k in metrics_registry.VOCABULARY_KEYS:
        if k == "profit_factor":
            continue
        assert vocab[k] is not None, f"fixture leaves {k} null; parity would be vacuous"
        got = MEASURES[k].fn(rows).value
        assert got == pytest.approx(vocab[k]), k
        checked += 1
    assert checked == 15


def test_pf_capped_and_equals_registry_under_cap(conn):
    c, aid = conn
    # PF 2.3: wins 230, losses 100 (net, zero fees so gross == net)
    _seed(c, aid, [("2026-03-02", dict(pnl=130.0, fees=0.0, result="Win", r=1.0, hold=1)),
                   ("2026-03-03", dict(pnl=100.0, fees=0.0, result="Win", r=1.0, hold=1)),
                   ("2026-03-04", dict(pnl=-100.0, fees=0.0, result="Loss", r=-1.0, hold=1))])
    ctx, rows = _ctx_and_rows(c)
    reg = metrics_registry.build_vocabulary(ctx)["profit_factor"]
    assert reg == pytest.approx(2.3)
    assert MEASURES["profit_factor"].fn(rows).value == pytest.approx(reg)

    assert PF_CAP == 5.0
    big = [_row(710.0), _row(-100.0, "Loss")]
    assert MEASURES["profit_factor"].fn(big).value == 5.0
    all_wins = [_row(50.0), _row(20.0)]
    assert MEASURES["profit_factor"].fn(all_wins).value == 5.0
    # the registry has no number for an all-wins book; the builder caps it
    ctx.rows[:] = [r for r in ctx.rows if r["result"] == "Win"]
    assert metrics_registry.build_vocabulary(ctx)["profit_factor"] is None
    assert MEASURES["profit_factor"].fn([]).value is None


def test_pf_parity_with_analytics(conn):
    c, aid = conn
    _seed(c, aid, _fixture_30(with_fees=False))
    _ctx, rows = _ctx_and_rows(c)
    a = analytics.get_analytics(UID, conn=c)["edgeScore"]["components"]["profitFactor"]
    pf = MEASURES["profit_factor"].fn(rows).value
    assert 1.0 < pf < PF_CAP          # under the cap, so the comparison means something
    assert pf == pytest.approx(a, abs=1e-3)   # analytics rounds to 3 places


def test_pf_with_fees_is_net():
    """The builder's profit factor is on NET (pnl - fees). Analytics' edge score computes its
    PF from gross `pnl_dollar` (analytics._edge_score), so with fees the two DIVERGE by design;
    the builder follows metrics_registry (net), which is the definition the member's other
    net-P&L measures use."""
    rows = [_row(200.0, fees=10.0), _row(-100.0, "Loss", fees=10.0)]
    # net wins 200, net losses 100 -> 2.0; gross would be 210 / 90 = 2.333
    assert MEASURES["profit_factor"].fn(rows).value == pytest.approx(2.0)


# ── unit, needs and coverage ─────────────────────────────────────────────────────────────────

def test_win_rate_counts_decisive_only():
    rows = ([_row(10.0)] * 6 + [_row(-10.0, "Loss")] * 4 + [_row(0.0, "BE")] * 3)
    mv = MEASURES["win_rate"].fn(rows)
    assert mv.value == pytest.approx(0.6)
    assert mv.n == 10
    assert MEASURES["win_rate"].unit == "decisive" and MEASURES["payoff"].unit == "decisive"


def test_r_measures_count_have():
    rows = [_row(10.0, r=(0.5 if i < 9 else None)) for i in range(47)]
    for k in ("avg_true_r", "expectancy_r", "total_r"):
        m = MEASURES[k]
        assert m.needs == ("r",) and m.unit == "trades", k
        mv = m.fn(rows)
        assert (mv.have, mv.n) == (9, 47), k
    assert MEASURES["total_r"].fn(rows).value == pytest.approx(4.5)
    assert MEASURES["avg_true_r"].fn(rows).value == pytest.approx(0.5)
    # a measure without needs reports have=None
    assert MEASURES["net_pnl"].fn(rows).have is None
    # no R anywhere: the value is absent, never a 0R
    none_r = [_row(10.0) for _ in range(47)]
    mv = MEASURES["expectancy_r"].fn(none_r)
    assert mv.value is None and mv.have == 0 and mv.n == 47


def test_small_sample_hide_and_badge():
    m = MEASURES["win_rate"]
    assert m.min_n == 5
    assert small_sample(m, MeasureValue(0.5, 3, None)) == "hide"
    assert small_sample(m, MeasureValue(0.5, 12, None)) == "small"
    assert small_sample(m, MeasureValue(0.5, 25, None)) == ""
    s = MEASURES["net_pnl"]
    assert s.kind == "sum"
    assert small_sample(s, MeasureValue(10.0, 1, None)) == ""
    assert small_sample(MEASURES["best_trade"], MeasureValue(10.0, 1, None)) == ""
    # needs-measures count `have`, not `n`
    r = MEASURES["avg_true_r"]
    assert small_sample(r, MeasureValue(0.4, 47, 3)) == "hide"
    assert small_sample(r, MeasureValue(0.4, 47, 12)) == "small"
    # payoff's own minimum is the registry's decisive gate
    p = MEASURES["payoff"]
    assert p.min_n == metrics_registry._MIN_DECISIVE == 20
    assert small_sample(p, MeasureValue(1.5, 19, None)) == "hide"
    assert small_sample(p, MeasureValue(1.5, 20, None)) == ""
    assert all(MEASURES[k].min_n == 5 for k in MEASURES if k != "payoff")


def test_streaks():
    seq = ["Win", "Win", "Loss", "Loss", "Loss", "Win"]
    # given out of order: the measure orders by day, then id
    rows = [_row(10.0 if res == "Win" else -10.0, res, day=f"2026-03-0{i + 1}", rid=f"t{i}")
            for i, res in enumerate(seq)]
    rows = list(reversed(rows))
    assert MEASURES["max_win_streak"].fn(rows).value == 2
    assert MEASURES["max_loss_streak"].fn(rows).value == 3
    assert MEASURES["current_streak"].fn(rows).value == 1
    # same day: id breaks the tie; a run of two losses at the end is -2
    same_day = [_row(-1.0, "Loss", day="2026-03-09", rid="b"),
                _row(1.0, "Win", day="2026-03-09", rid="a"),
                _row(-1.0, "Loss", day="2026-03-09", rid="c")]
    assert MEASURES["current_streak"].fn(same_day).value == -2
    # a breakeven ends the run it interrupts; ending on one leaves no open run (None, never 0)
    be = [_row(1.0, "Win", day="2026-03-02"), _row(1.0, "Win", day="2026-03-03"),
          _row(0.0, "BE", day="2026-03-04"), _row(1.0, "Win", day="2026-03-05")]
    assert MEASURES["max_win_streak"].fn(be).value == 2
    assert MEASURES["current_streak"].fn(be).value == 1
    assert MEASURES["current_streak"].fn(be[:3]).value is None


def test_day_measures_count_only_days_with_trades():
    rows = [_row(100.0, day="2026-03-02"), _row(-30.0, "Loss", day="2026-03-02"),
            _row(-50.0, "Loss", day="2026-03-05"), _row(20.0, day="2026-03-09")]
    for k in ("days_traded", "profitable_days", "profitable_days_pct", "avg_day_pnl",
              "green_day_pct"):
        assert MEASURES[k].unit == "days", k
        assert MEASURES[k].fn(rows).n == 3, k   # 3 days with trades, not the 6 sessions between
    assert MEASURES["days_traded"].fn(rows).value == 3
    assert MEASURES["profitable_days"].fn(rows).value == 2
    assert MEASURES["profitable_days_pct"].fn(rows).value == pytest.approx(2 / 3)
    assert MEASURES["green_day_pct"].fn(rows).value == pytest.approx(2 / 3)
    assert MEASURES["avg_day_pnl"].fn(rows).value == pytest.approx(40.0 / 3)


def test_nan_becomes_none():
    rows = [_row(10.0), _row(float("nan")), _row(-5.0, "Loss")]
    for k, m in MEASURES.items():
        v = m.fn(rows).value
        assert v is None or math.isfinite(v), k
    for k in ("net_pnl", "best_trade", "worst_trade", "avg_win", "expectancy",
              "max_drawdown", "avg_day_pnl", "profitable_days"):
        assert MEASURES[k].fn(rows).value is None, k
    inf = [_row(float("inf"))]
    assert MEASURES["net_pnl"].fn(inf).value is None


def test_every_measure_is_well_formed():
    assert len(MEASURES) == 27
    for k, m in MEASURES.items():
        assert m.key == k and m.label and m.meaning
        assert m.theme in ("results", "winloss", "risk", "time", "process")
        assert m.unit in ("trades", "decisive", "days", "entries")
        assert m.kind in ("sum", "count", "rate", "average", "extreme")
        assert m.sources and isinstance(m.sources, frozenset)
        mv = m.fn([])
        assert isinstance(mv, MeasureValue) and mv.n == 0
    assert measures.PF_CAP == PF_CAP

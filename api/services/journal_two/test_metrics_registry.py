"""Metrics registry — hand-worked card expectations + evaluator safety.

Same `:memory:` + ensure_schema fixture as the sibling suites.
"""
import sqlite3

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two.filters import FilterSpec
from api.services.journal_two.metrics_registry import (
    METRICS, compute_metrics, eval_kpi_expr, registry_listing,
)


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


def _trade(conn, tid, *, day, pnl, result, fees=0.0, hour=None, hold=1,
           r=None, stop=95.0, entry=100.0, shares=10,
           symbol="NVDA", side="Long", user_id="u1"):
    exit_p = entry + (pnl / shares) * (1 if side == "Long" else -1)
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            account_id, created_at, trading_day_et, hour_et, fees
        ) VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?,
                  ?, 'VCP', NULL, ?, 0, ?, ?, ?, '{}',
                  'a1', '2026-01-01T00:00:00', ?, ?, ?)
        """,
        (tid, user_id, symbol, side, shares, entry, day, exit_p, day,
         stop, pnl, r, hold, result, day, hour, fees),
    )
    conn.commit()


def _out(conn, keys, kpis=None):
    return compute_metrics("u1", keys, kpis=kpis, spec=FilterSpec(), conn=conn)


# ── consistency ──────────────────────────────────────────────────────────────

def test_consistency_hand_worked():
    conn = _conn()
    _trade(conn, "t1", day="2026-03-02", pnl=300, result="Win")
    _trade(conn, "t2", day="2026-03-03", pnl=-100, result="Loss")
    _trade(conn, "t3", day="2026-03-04", pnl=100, result="Win")
    _trade(conn, "t4", day="2026-03-04", pnl=100, result="Win")  # same day: 200
    c = _out(conn, ["consistency"])["metrics"]["consistency"]
    assert c["tradingDays"] == 3
    assert c["profitableDayPct"] == pytest.approx(2 / 3, abs=1e-3)
    # gross winning-day profit = 300 + 200 = 500; best day 300 → 60%
    assert c["largestDayShare"] == pytest.approx(0.6)
    assert c["bestDay"] == {"date": "2026-03-02", "pnl": 300.0}
    assert c["worstDay"] == {"date": "2026-03-03", "pnl": -100.0}


def test_consistency_all_losing_days_share_is_null():
    conn = _conn()
    _trade(conn, "t1", day="2026-03-02", pnl=-50, result="Loss")
    c = _out(conn, ["consistency"])["metrics"]["consistency"]
    assert c["largestDayShare"] is None  # no winning day — nothing to depend on


# ── risk_ratios ──────────────────────────────────────────────────────────────

def test_risk_ratios_gate_below_min_days():
    conn = _conn()
    for i in range(5):
        _trade(conn, f"t{i}", day=f"2026-03-{i + 2:02d}", pnl=100, result="Win")
    r = _out(conn, ["risk_ratios"])["metrics"]["risk_ratios"]
    assert r["tradingDays"] == 5
    assert r["sharpe"] is None and r["sortino"] is None and r["calmar"] is None


def test_risk_ratios_compute_with_enough_days():
    conn = _conn()
    # 25 alternating days: +200 / -100 (account default 100k)
    for i in range(25):
        _trade(conn, f"t{i}", day=f"2026-{(i // 28) + 3:02d}-{(i % 28) + 1:02d}",
               pnl=200 if i % 2 == 0 else -100,
               result="Win" if i % 2 == 0 else "Loss")
    r = _out(conn, ["risk_ratios"])["metrics"]["risk_ratios"]
    assert r["tradingDays"] == 25
    assert r["sharpe"] is not None and r["sharpe"] > 0
    assert r["sortino"] is not None
    assert r["maxDrawdownPct"] is not None and r["maxDrawdownPct"] <= 0


# ── payoff_kelly ─────────────────────────────────────────────────────────────

def test_payoff_kelly_hand_worked():
    conn = _conn()
    # 12 wins of +200, 8 losses of -100 → WR .6, payoff 2, kelly .6-.4/2 = .4
    for i in range(12):
        _trade(conn, f"w{i}", day=f"2026-03-{i + 1:02d}", pnl=200, result="Win")
    for i in range(8):
        _trade(conn, f"l{i}", day=f"2026-04-{i + 1:02d}", pnl=-100, result="Loss")
    k = _out(conn, ["payoff_kelly"])["metrics"]["payoff_kelly"]
    assert k["winRate"] == pytest.approx(0.6)
    assert k["avgWin"] == 200.0 and k["avgLoss"] == 100.0
    assert k["payoff"] == pytest.approx(2.0)
    assert k["kelly"] == pytest.approx(0.4)
    assert k["halfKelly"] == pytest.approx(0.2)


def test_kelly_gated_below_min_decisive():
    conn = _conn()
    for i in range(5):
        _trade(conn, f"t{i}", day=f"2026-03-{i + 1:02d}", pnl=200, result="Win")
    k = _out(conn, ["payoff_kelly"])["metrics"]["payoff_kelly"]
    assert k["winRate"] == 1.0     # descriptive stats still shown
    assert k["kelly"] is None      # the sizing ratio is gated


# ── time_intel ───────────────────────────────────────────────────────────────

def test_time_intel_hour_weekday_holds():
    conn = _conn()
    # 2026-03-02 is a Monday
    _trade(conn, "t1", day="2026-03-02", pnl=100, result="Win", hour=9, hold=0)
    _trade(conn, "t2", day="2026-03-02", pnl=-50, result="Loss", hour=9, hold=0)
    _trade(conn, "t3", day="2026-03-03", pnl=80, result="Win", hour=14, hold=5)
    _trade(conn, "t4", day="2026-03-04", pnl=20, result="Win", hour=None, hold=2)
    t = _out(conn, ["time_intel"])["metrics"]["time_intel"]
    nine = next(b for b in t["byHour"] if b["hour"] == 9)
    assert nine["trades"] == 2 and nine["pnl"] == 50.0
    assert nine["winRate"] == pytest.approx(0.5)
    assert t["hourUnknown"] == 1
    mon = next(b for b in t["byWeekday"] if b["weekday"] == "Mon")
    assert mon["trades"] == 2
    same_day = next(b for b in t["holdBuckets"] if b["bucket"] == "same day")
    assert same_day["trades"] == 2


# ── risk_per_trade ───────────────────────────────────────────────────────────

def test_risk_per_trade_stop_and_trueR_sources():
    conn = _conn()
    # real stop: entry 100 stop 95 x 10 shares = $50 risk
    _trade(conn, "t1", day="2026-03-02", pnl=100, result="Win",
           stop=95.0, entry=100.0, shares=10)
    # placeholder stop (stop == entry) + a true_r excursion → trueR-implied
    _trade(conn, "t2", day="2026-03-03", pnl=90, result="Win",
           stop=100.0, entry=100.0, shares=10)
    from api.services.journal_two.excursions_store import upsert_excursion
    upsert_excursion("u1", "id:t2", {
        "symbol": "NVDA", "mfe_price": 112.0, "mae_price": 97.0,
        "mfe_r": None, "mae_r": None, "mfe_ts": 1, "mae_ts": 1,
        "exit_efficiency": 0.5, "missed_r": None, "true_r": 3.0,
        "bar_resolution": "D", "data_quality": "daily",
    }, conn)
    # no stop, no excursion → unknown
    _trade(conn, "t3", day="2026-03-04", pnl=10, result="Win",
           stop=50.0, entry=50.0, shares=10)
    r = _out(conn, ["risk_per_trade"])["metrics"]["risk_per_trade"]
    assert r["sources"] == {"stop": 1, "trueR": 1, "unknown": 1}
    # risks: $50 (stop) and 90/3 = $30 (trueR) → mean 40, max 50
    assert r["mean"] == 40.0
    assert r["max"] == 50.0


# ── period_compare ───────────────────────────────────────────────────────────

def test_period_compare_ignores_scope_dates():
    conn = _conn()
    _trade(conn, "t1", day="2020-01-06", pnl=100, result="Win")
    spec = FilterSpec(date_from="2020-01-01", date_to="2020-12-31")
    out = compute_metrics("u1", ["period_compare"], spec=spec, conn=conn)
    pc = out["metrics"]["period_compare"]
    # the comparison card exists and carries every period slot regardless of
    # the scoped (ancient) date facet
    for k in ("thisMonth", "lastMonth", "thisQuarter", "lastQuarter",
              "ytd", "priorYtd"):
        assert k in pc and "netPnl" in pc[k]


# ── custom KPI evaluator ─────────────────────────────────────────────────────

def test_kpi_arithmetic_and_vocabulary():
    conn = _conn()
    _trade(conn, "t1", day="2026-03-02", pnl=300, result="Win", fees=5.0)
    _trade(conn, "t2", day="2026-03-03", pnl=-100, result="Loss")
    out = _out(conn, [], kpis=[("edge", "net_pnl / trades"),
                               ("wr2", "win_rate * 2")])
    by = {c["name"]: c for c in out["custom"]}
    assert by["edge"]["value"] == pytest.approx((300 - 5 - 100) / 2)
    assert by["wr2"]["value"] == pytest.approx(1.0)


def test_kpi_rejects_calls_attributes_unknowns():
    assert eval_kpi_expr("__import__('os')", {})["error"]
    assert eval_kpi_expr("(1).bit_length()", {})["error"]  # attribute call rejected
    assert "unknown variable" in eval_kpi_expr("evil_var + 1", {"net_pnl": 1})["error"]
    assert eval_kpi_expr("a" * 300, {})["error"].startswith("expression longer")


def test_kpi_null_variable_and_div_zero_yield_null_not_error():
    assert eval_kpi_expr("win_rate * 2", {"win_rate": None}) == {"value": None, "error": None}
    assert eval_kpi_expr("1 / losses", {"losses": 0.0}) == {"value": None, "error": None}


# ── registry hygiene ─────────────────────────────────────────────────────────

def test_unknown_keys_reported_never_dropped():
    conn = _conn()
    out = _out(conn, ["consistency", "not_a_card"])
    assert out["unknownKeys"] == ["not_a_card"]
    assert "consistency" in out["metrics"]


def test_registry_listing_covers_every_card_plus_custom():
    keys = {e["key"] for e in registry_listing()}
    assert keys == set(METRICS.keys()) | {"custom"}


# ── fees_drag ────────────────────────────────────────────────────────────────

def test_fees_drag_hand_worked():
    conn = _conn()
    _trade(conn, "t1", day="2026-03-02", pnl=300, result="Win", fees=3.0)
    _trade(conn, "t2", day="2026-03-03", pnl=-100, result="Loss", fees=2.0)
    f = _out(conn, ["fees_drag"])["metrics"]["fees_drag"]
    assert f["totalFees"] == 5.0
    assert f["feesPerTrade"] == 2.5
    assert f["feesVsGrossProfit"] == pytest.approx(5 / 300, abs=1e-4)  # rounded 4dp
    assert f["netPnl"] == 195.0 and f["feeFreePnl"] == 200.0


# ── size_buckets ─────────────────────────────────────────────────────────────

def test_size_buckets_quartiles_and_gate():
    conn = _conn()
    # 8 trades, notionals 10*100..10*800 → quartiles split 2/2/2/2
    for i in range(8):
        _trade(conn, f"t{i}", day=f"2026-03-{i + 1:02d}",
               pnl=100 if i % 2 == 0 else -50,
               result="Win" if i % 2 == 0 else "Loss",
               entry=(i + 1) * 100.0, shares=10)
    b = _out(conn, ["size_buckets"])["metrics"]["size_buckets"]
    assert b["trades"] == 8
    assert len(b["buckets"]) == 4
    assert sum(x["trades"] for x in b["buckets"]) == 8
    # under 4 sized trades → empty buckets, never fabricated quartiles
    conn2 = _conn()
    _trade(conn2, "only", day="2026-03-02", pnl=10, result="Win")
    b2 = _out(conn2, ["size_buckets"])["metrics"]["size_buckets"]
    assert b2["buckets"] == []


# ── monte_carlo ──────────────────────────────────────────────────────────────

def test_monte_carlo_gated_below_30_trades():
    conn = _conn()
    for i in range(5):
        _trade(conn, f"t{i}", day=f"2026-03-{i + 1:02d}", pnl=100, result="Win")
    m = _out(conn, ["monte_carlo"])["metrics"]["monte_carlo"]
    assert m["terminal"] is None and m["trades"] == 5


def test_monte_carlo_deterministic_and_sane():
    conn = _conn()
    for i in range(30):
        _trade(conn, f"t{i}", day=f"2026-{(i // 28) + 3:02d}-{(i % 28) + 1:02d}",
               pnl=200 if i % 2 == 0 else -100,
               result="Win" if i % 2 == 0 else "Loss")
    a = _out(conn, ["monte_carlo"])["metrics"]["monte_carlo"]
    b = _out(conn, ["monte_carlo"])["metrics"]["monte_carlo"]
    assert a == b  # fixed seed → same book, same projection, no flicker
    assert a["terminal"]["p5"] <= a["terminal"]["p50"] <= a["terminal"]["p95"]
    # EV per trade = +50 → median terminal of 100 trades should be positive
    assert a["terminal"]["p50"] > 0
    assert a["maxDrawdown"]["p50"] <= 0
    assert 0 <= a["probDown10"] <= 1


# ── dividends ────────────────────────────────────────────────────────────────

def _cash_activity(conn, aid, *, typ, amount, symbol=None, when="2026-06-15",
                   user_id="u1", broker_account="ba1"):
    import json
    conn.execute(
        "INSERT INTO j2_broker_activities (id, user_id, broker_account_id, "
        "external_id, activity_type, symbol, occurred_at, raw_json, processed, "
        "created_at) VALUES (?,?,?,?,?,?,?,?,1,'2026-06-15T00:00:00')",
        (aid, user_id, broker_account, aid, "cash", symbol, when,
         json.dumps({"type": typ, "amount": amount})),
    )
    conn.commit()


def test_dividends_card_hand_worked():
    conn = _conn()
    _cash_activity(conn, "d1", typ="DIVIDEND", amount=12.5, symbol="SCHD",
                   when="2026-05-10")
    _cash_activity(conn, "d2", typ="DIVIDEND", amount=7.5, symbol="SCHD",
                   when="2026-06-10")
    _cash_activity(conn, "d3", typ="STOCK_DIVIDEND", amount=3.0, symbol="O",
                   when="2026-06-12")
    _cash_activity(conn, "i1", typ="INTEREST", amount=1.25, when="2026-06-30")
    _cash_activity(conn, "x1", typ="WITHDRAWAL", amount=500.0)   # not income
    d = _out(conn, ["dividends"])["metrics"]["dividends"]
    assert d["dividendsTotal"] == 23.0
    assert d["interestTotal"] == 1.25
    assert d["count"] == 4 and d["unparsed"] == 0
    assert {m["month"]: m["amount"] for m in d["byMonth"]} == {
        "2026-05": 12.5, "2026-06": 10.5}
    assert d["topSymbols"][0] == {"symbol": "SCHD", "amount": 20.0}


def test_dividends_empty_book_is_honest_zero():
    conn = _conn()
    d = _out(conn, ["dividends"])["metrics"]["dividends"]
    assert d == {"dividendsTotal": 0.0, "interestTotal": 0.0, "count": 0,
                 "unparsed": 0, "byMonth": [], "topSymbols": []}


# ── safe functions + per-period cards/KPIs (2026-08-22) ─────────────────────

def test_kpi_safe_functions():
    v = {"net_pnl": -250.0, "avg_win": 200.0, "avg_loss": 100.0}
    assert eval_kpi_expr("abs(net_pnl)", v)["value"] == 250.0
    assert eval_kpi_expr("max(avg_win, avg_loss)", v)["value"] == 200.0
    assert eval_kpi_expr("min(avg_win, avg_loss) / 2", v)["value"] == 50.0
    assert eval_kpi_expr("round(avg_win / 3)", v)["value"] == pytest.approx(67.0)
    # non-whitelisted calls still rejected BY NAME
    assert eval_kpi_expr("pow(2, 10)", {})["error"]
    assert eval_kpi_expr("abs()", {})["error"]


def test_per_card_period_overrides_scope():
    conn = _conn()
    _trade(conn, "old", day="2020-01-06", pnl=1000, result="Win")
    _trade(conn, "new", day="2026-08-04", pnl=100, result="Win")
    out = _out(conn, ["consistency", "consistency@30d"])
    assert out["metrics"]["consistency"]["tradingDays"] == 2       # whole book
    recent = out["metrics"]["consistency@30d"]
    assert recent["tradingDays"] == 1                              # 30d window
    assert recent["period"] == "30d"


def test_per_kpi_period_and_unknown_period():
    conn = _conn()
    _trade(conn, "old", day="2020-01-06", pnl=1000, result="Win")
    _trade(conn, "new", day="2026-08-04", pnl=100, result="Win")
    out = _out(conn, [], kpis=[("all_pnl", "net_pnl"),
                               ("recent_pnl@30d", "net_pnl"),
                               ("bad@2weeks", "net_pnl")])
    by = {c["name"]: c for c in out["custom"]}
    assert by["all_pnl"]["value"] == 1100.0
    assert by["recent_pnl@30d"]["value"] == 100.0
    assert "unknown period" in by["bad@2weeks"]["error"]


def test_unknown_period_on_card_reported():
    conn = _conn()
    out = _out(conn, ["consistency@fortnight"])
    assert out["unknownKeys"] == ["consistency@fortnight"]

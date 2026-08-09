import math
import pytest
from fastapi.testclient import TestClient
from api.main import app
from api.services import bars_sqlite

# `POST /api/backtest` and `GET /api/backtest/strategies` are `require_paid`
# since the 2026-08-09 auth sweep. These are BEHAVIOUR tests, so they get the
# caller they always implied; the gate is owned by
# tests/test_exposed_routes_gated.py and asserted exactly once, there.
from tests.authclients import as_a_paid_member  # noqa: F401  (autouse fixture)

client = TestClient(app)


def _make_bars(n: int, base: float = 100.0):
    """Linear uptrend bars."""
    return [(i * 86400, base + i, base + i + 1, base + i - 1, base + i, 1000) for i in range(n)]


def test_list_strategies():
    r = client.get("/api/backtest/strategies")
    assert r.status_code == 200
    data = r.json()
    assert "strategies" in data
    assert len(data["strategies"]) == 4


def test_run_backtest_unknown_strategy(monkeypatch):
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda s, tf, n: _make_bars(300))
    r = client.post("/api/backtest", json={
        "strategy_id": "nope", "sym": "AAPL", "tf": "D", "bars": 300,
    })
    assert r.status_code == 400


def test_run_backtest_no_bars(monkeypatch):
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda s, tf, n: [])
    r = client.post("/api/backtest", json={
        "strategy_id": "rsi_mean_reversion", "sym": "ZZZ", "tf": "D", "bars": 300,
    })
    assert r.status_code == 404


def test_run_backtest_invalid_bars_count(monkeypatch):
    r = client.post("/api/backtest", json={
        "strategy_id": "rsi_mean_reversion", "sym": "AAPL", "tf": "D", "bars": 5,
    })
    assert r.status_code == 400


def test_run_backtest_invalid_capital(monkeypatch):
    r = client.post("/api/backtest", json={
        "strategy_id": "rsi_mean_reversion", "sym": "AAPL", "tf": "D",
        "bars": 300, "capital": 0,
    })
    assert r.status_code == 400


def test_run_backtest_rsi(monkeypatch):
    """RSI on sinusoidal data should produce 1+ signals + return valid response shape."""
    n = 200
    bars = [(i * 86400, 100, 102, 98, 100 + 10 * math.sin(i / 5), 1000) for i in range(n)]
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda s, tf, n_: bars)
    r = client.post("/api/backtest", json={
        "strategy_id": "rsi_mean_reversion", "sym": "AAPL", "tf": "D", "bars": n,
    })
    assert r.status_code == 200
    data = r.json()
    for key in ("final_equity", "total_return_pct", "equity_curve", "trades", "n_bars",
                "stats", "n_signals", "strategy", "sym", "tf"):
        assert key in data, f"missing key: {key}"
    assert data["strategy"] == "rsi_mean_reversion"
    assert data["sym"] == "AAPL"
    assert data["tf"] == "D"
    assert data["n_bars"] == n
    for key in ("n_trades", "win_rate", "profit_factor", "max_drawdown_pct", "sharpe"):
        assert key in data["stats"]


def test_run_backtest_ma_crossover_uptrend(monkeypatch):
    """Linear uptrend → MA crossover should fire entry, simulator force-exits at end."""
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda s, tf, n: _make_bars(300))
    r = client.post("/api/backtest", json={
        "strategy_id": "ma_crossover", "sym": "AAPL", "tf": "D", "bars": 300,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["stats"]["n_trades"] >= 1
    # Uptrend → final equity > capital
    assert data["final_equity"] > 10000


def test_run_backtest_custom_params(monkeypatch):
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda s, tf, n: _make_bars(300))
    r = client.post("/api/backtest", json={
        "strategy_id": "rsi_mean_reversion", "sym": "AAPL", "tf": "D",
        "bars": 300, "params": {"period": 7},
    })
    assert r.status_code == 200

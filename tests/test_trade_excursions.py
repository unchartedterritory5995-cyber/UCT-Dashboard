"""True Risk Engine (journal_two/excursions.py) — MAE/MFE from our own bars.

Every dollar expectation hand-worked exactly. The engine's promise: a
broker-imported trade with NO stop still gets a real risk profile —
True R = P&L / |MAE$|, efficiency = share of MFE captured.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import excursions as exc


def _bar(iso, h, l):
    ts = datetime.fromisoformat(iso).replace(tzinfo=timezone.utc)
    return {"t": int(ts.timestamp() * 1000), "h": h, "l": l}


# ── pure math ────────────────────────────────────────────────────────────────

def test_long_trade_excursions_hand_worked():
    """Long 100 @ 50. Window low 47, high 56, exited +$400 (54).
      MAE = (47−50)×100 = −300 (−6%);  MFE = (56−50)×100 = 600 (+12%)
      efficiency = 400/600 = 66.67%;   True R = 400/300 = 1.333"""
    out = exc.compute_excursions("Long", 50.0, 100, 400.0,
                                 [_bar("2026-08-10", 52, 47), _bar("2026-08-11", 56, 51)])
    assert out["mae_dollar"] == -300.00 and out["mae_pct"] == -6.0
    assert out["mfe_dollar"] == 600.00 and out["mfe_pct"] == 12.0
    assert out["efficiency_pct"] == 66.67
    assert out["true_r"] == 1.333


def test_short_trade_excursions_mirror():
    """Short 50 @ 40. High 43 (hurts), low 36 (helps), exited +$100.
      MAE = (40−43)×50 = −150;  MFE = (40−36)×50 = 200
      efficiency = 100/200 = 50%;  True R = 100/150 = 0.667"""
    out = exc.compute_excursions("Short", 40.0, 50, 100.0,
                                 [_bar("2026-08-10", 43, 36)])
    assert out["mae_dollar"] == -150.00
    assert out["mfe_dollar"] == 200.00
    assert out["efficiency_pct"] == 50.0
    assert out["true_r"] == 0.667


def test_a_trade_that_never_went_against_has_no_true_r():
    """MAE 0 → True R undefined (never rendered as a fake number)."""
    out = exc.compute_excursions("Long", 50.0, 100, 200.0,
                                 [_bar("2026-08-10", 53, 50)])
    assert out["mae_dollar"] == 0.0
    assert out["true_r"] is None
    assert out["efficiency_pct"] is not None


def test_degenerate_inputs_return_none():
    assert exc.compute_excursions("Long", 0, 100, 10, [_bar("2026-08-10", 1, 1)]) is None
    assert exc.compute_excursions("Long", 50, 100, 10, []) is None


# ── backfill pipeline ────────────────────────────────────────────────────────

@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    return {}


def _seed_trade(tid, sym, side, shares, entry, entry_date, exit_date, pnl, user="u1"):
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, "
        "entry_price, exit_price, entry_date, exit_date, original_stop, "
        "pnl_dollar, pnl_percent, hold_days, result, context_at_entry, created_at) "
        "VALUES (?, ?, '', ?, ?, ?, ?, 0, ?, ?, 0, ?, 0, 1, 'Win', '{}', 'now')",
        (tid, user, sym, side, shares, entry, entry_date, exit_date, pnl),
    )
    conn.commit()
    conn.close()


def test_backfill_computes_and_is_idempotent(env, monkeypatch):
    _seed_trade("t1", "BA", "Long", 100, 50.0,
                "2026-08-10T14:00:00Z", "2026-08-11T18:00:00Z", 400.0)
    calls = []

    def fake_daily(sym, lo, hi, **kw):
        calls.append((sym, lo, hi))
        return [_bar("2026-08-10", 52, 47), _bar("2026-08-11", 56, 51)]

    monkeypatch.setattr(exc.massive, "get_daily_agg", fake_daily)
    monkeypatch.setattr(exc.massive, "get_minute_agg", lambda *a, **k: [])

    out1 = exc.backfill_user("u1")
    assert out1["computed"] == 1
    out2 = exc.backfill_user("u1")
    assert out2["computed"] == 0          # idempotent — already computed
    assert len(calls) == 1                # one fetch per symbol, not per trade

    m = exc.excursions_map("u1")
    assert m["t1"]["trueR"] == 1.333
    assert m["t1"]["efficiencyPct"] == 66.67


def test_same_day_trade_uses_clipped_minute_bars(env, monkeypatch):
    _seed_trade("t2", "NVDA", "Long", 10, 500.0,
                "2026-08-11T14:30:00Z", "2026-08-11T15:30:00Z", 50.0)
    # Minute bars: one INSIDE the hold (low 495), one far after (low 480 —
    # must NOT count against the trade).
    inside = _bar("2026-08-11T15:00:00", 506, 495)
    after = _bar("2026-08-11T19:00:00", 510, 480)
    monkeypatch.setattr(exc.massive, "get_minute_agg", lambda *a, **k: [inside, after])
    monkeypatch.setattr(exc.massive, "get_daily_agg", lambda *a, **k: [])

    exc.backfill_user("u1")
    m = exc.excursions_map("u1")
    assert m["t2"]["maeDollar"] == -50.0   # (495−500)×10 — the 480 is excluded
    assert m["t2"]["mfeDollar"] == 60.0


def test_routes_are_mounted():
    from api.routers import journal_two as router_mod
    paths = {r.path for r in router_mod.router.routes}
    assert "/api/j2/trades/excursions" in paths
    assert "/api/j2/trades/excursions/backfill" in paths
    assert "/api/j2/trades" in paths       # control sibling


def test_sync_wiring_calls_the_engine():
    import ast, inspect
    from api.services.journal_two.broker import sync as sync_mod
    tree = ast.parse(inspect.getsource(sync_mod))
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.AsyncFunctionDef) and n.name == "_do_sync")
    called = {n.func.attr for n in ast.walk(fn)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert "maybe_backfill_after_sync" in called
    assert "run_mirror_check" in called    # control sibling

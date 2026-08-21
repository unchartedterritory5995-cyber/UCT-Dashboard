"""Mirror-drift sentinel (broker/mirror_check.py) — the journal proves itself
equal to the broker after every sync, so divergence is DETECTED for every
member instead of eyeballed by the owner.

Severity contract under test:
- position/option parity failing post-reconcile = code defect → alert NOW.
- equity drift = often T+1 settlement → alert only on 2 consecutive syncs.
- a missing payload is inert; the sentinel never raises into a sync.
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import mirror_check as mc
from api.services.journal_two.broker import option_reconstruct as oro


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    mc._reset_dedup_for_tests()
    acct = accounts_service.create_account(
        "u1", {"name": "Broker", "color": "blue", "startingBalance": 1.0}
    )
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_accounts SET broker_cash = -9869.87 WHERE id = ?", (acct["id"],))
    conn.commit()
    conn.close()
    alerts: list[tuple] = []
    monkeypatch.setattr(mc, "_spawn_alert", lambda t, d: alerts.append((t, d)))
    return {
        "j2": acct["id"],
        "ba": {"id": "bk1", "j2AccountId": acct["id"],
               "brokerageName": "Robinhood", "accountNumberMasked": "••2364"},
        "alerts": alerts,
    }


def _seed_position(env, sym, side, shares, broker_price):
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, "
        "original_shares, entry_price, stop_price, raise_to_breakeven, "
        "context_at_entry, created_at, updated_at, account_id, source, "
        "external_id, entry_estimated, broker_price) "
        "VALUES (lower(hex(randomblob(8))), 'u1', ?, ?, '2026-07-21', ?, ?, 100, 100, 0, "
        "'{}', '2026-08-20', '2026-08-20', ?, 'broker', "
        "'bkpos:bk1:' || ? || ':' || ?, 0, ?)",
        (sym, side, shares, shares, env["j2"], sym, side, broker_price),
    )
    conn.commit()
    conn.close()


def _seed_strategy(env, *, ext, qty, bcv, underlying="BA", strike=250.0,
                   expiration="2027-01-15", side="buy"):
    conn = auth_db.get_connection()
    try:
        stype = oro._strategy_type(side, "call")
        s = {"underlying": underlying, "strike": strike, "expiration": expiration,
             "contractType": "call", "side": side, "strategy_type": stype,
             "direction": oro._direction(stype), "qty": qty, "entry_price": 11.5,
             "entry_date": "2026-08-17T19:01:49Z", "entry_fee": 0.0,
             "exit_price": None, "closed_at": None, "status": "open"}
        conn.execute("BEGIN")
        oro._insert_strategy(conn, "u1", env["j2"], s, ext)
        conn.commit()
        conn.execute("UPDATE j2_option_strategies SET broker_current_value = ? "
                     "WHERE user_id = 'u1' AND external_id = ?", (bcv, ext))
        conn.commit()
    finally:
        conn.close()


def _raw_pos(sym, units, price):
    return {"symbol": {"symbol": sym}, "units": units, "price": price,
            "average_purchase_price": 100.0}


def _raw_opt(*, units, price, underlying="BA", strike=250.0,
             expiration="2027-01-15"):
    return {
        "symbol": {"option_symbol": {
            "ticker": f"{underlying} 270115C00250000",
            "strike_price": strike, "expiration_date": expiration,
            "option_type": "CALL",
            "underlying_symbol": {"symbol": underlying},
            "is_mini_option": False,
        }},
        "units": units, "price": price,
        "average_purchase_price": 1150.0,
        "currency": {"code": "USD"},
    }


def _mirror_book(env):
    """Seed a journal that EXACTLY mirrors the standard raw payloads below."""
    _seed_position(env, "ORCL", "Long", 100, 142.06)
    _seed_strategy(env, ext="bkopt:ba", qty=3, bcv=2100.0)


RAW_POS = [_raw_pos("ORCL", 100, 142.06)]
RAW_OPT = [_raw_opt(units=3, price=7.0)]
# cash −9,869.87 + 100×142.06 + 2,100 = 6,436.13
TRUE_TOTAL = 6436.13


def _set_stored_equity(env, value):
    """The equity write_balances stored — the sentinel's parity target (raw
    `balance.total` lags a day on Robinhood; comparing against it paged three
    false drifts on 8/21)."""
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_accounts SET broker_total_equity = ? WHERE id = ?",
                 (value, env["j2"]))
    conn.commit(); conn.close()


def test_a_faithful_mirror_verifies_and_persists(env):
    _mirror_book(env)
    _set_stored_equity(env, TRUE_TOTAL)
    out = mc.run_mirror_check("u1", env["ba"], RAW_POS, RAW_OPT, TRUE_TOTAL)
    assert out["ok"] is True and out["structuralOk"] and out["equityOk"]
    assert out["driftDollar"] == 0.0
    assert env["alerts"] == []
    v = mc.latest_verdicts("u1")["bk1"]
    assert v["ok"] is True and v["consecutiveDrifts"] == 0


def test_a_missing_position_is_structural_and_alerts_immediately(env):
    _seed_strategy(env, ext="bkopt:ba", qty=3, bcv=2100.0)  # ORCL row absent
    out = mc.run_mirror_check("u1", env["ba"], RAW_POS, RAW_OPT, TRUE_TOTAL)
    assert out["ok"] is False and out["structuralOk"] is False
    assert any("ORCL" in m for m in out["detail"]["positions"])
    assert len(env["alerts"]) == 1     # first sync, structural → page NOW


def test_the_2026_08_20_double_count_shape_is_caught(env):
    """Two lots summing past the held qty + double-stamped value — exactly the
    defect this campaign fixed. The sentinel must flag it structurally so a
    regression can never sit silent in a member's account."""
    _seed_position(env, "ORCL", "Long", 100, 142.06)
    _seed_strategy(env, ext="bkopt:ba1", qty=3, bcv=2100.0)
    _seed_strategy(env, ext="bkopt:ba2", qty=3, bcv=2100.0)
    out = mc.run_mirror_check("u1", env["ba"], RAW_POS, RAW_OPT, TRUE_TOTAL)
    assert out["structuralOk"] is False
    assert any("6" in m and "3" in m for m in out["detail"]["options"])
    assert len(env["alerts"]) == 1


def test_equity_drift_alerts_only_when_persistent(env):
    """Stored equity disagreeing with the journal-derived value = OUR write
    path is internally inconsistent — page after two consecutive syncs."""
    _mirror_book(env)
    _set_stored_equity(env, TRUE_TOTAL - 500.0)
    wrong_total = TRUE_TOTAL - 500.0
    out1 = mc.run_mirror_check("u1", env["ba"], RAW_POS, RAW_OPT, wrong_total)
    assert out1["structuralOk"] is True and out1["equityOk"] is False
    assert out1["consecutiveDrifts"] == 1
    assert env["alerts"] == []          # settlement window — hold fire
    out2 = mc.run_mirror_check("u1", env["ba"], RAW_POS, RAW_OPT, wrong_total)
    assert out2["consecutiveDrifts"] == 2
    assert len(env["alerts"]) == 1      # persistent → page


def test_small_equity_diffs_inside_tolerance_pass(env):
    _mirror_book(env)
    _set_stored_equity(env, TRUE_TOTAL + 4.0)
    out = mc.run_mirror_check("u1", env["ba"], RAW_POS, RAW_OPT, TRUE_TOTAL + 4.0)
    assert out["ok"] is True


def test_a_lagging_provider_total_is_reported_never_paged(env):
    """SnapTrade's raw balance.total lagging the stored live value is the
    PROVIDER'S inconsistency — measured as totalLagDollar, never a drift."""
    _mirror_book(env)
    _set_stored_equity(env, TRUE_TOTAL)
    out = mc.run_mirror_check("u1", env["ba"], RAW_POS, RAW_OPT, TRUE_TOTAL - 266.37)
    assert out["ok"] is True
    assert out["totalLagDollar"] == 266.37
    assert env["alerts"] == []


def test_recovery_resets_the_drift_streak(env):
    _mirror_book(env)
    _set_stored_equity(env, TRUE_TOTAL - 500.0)
    mc.run_mirror_check("u1", env["ba"], RAW_POS, RAW_OPT, TRUE_TOTAL - 500.0)
    _set_stored_equity(env, TRUE_TOTAL)
    out = mc.run_mirror_check("u1", env["ba"], RAW_POS, RAW_OPT, TRUE_TOTAL)
    assert out["ok"] is True and out["consecutiveDrifts"] == 0


def test_missing_payloads_are_inert(env):
    _mirror_book(env)
    out = mc.run_mirror_check("u1", env["ba"], None, RAW_OPT, TRUE_TOTAL)
    assert out["ok"] is None
    assert mc.latest_verdicts("u1") == {}   # nothing persisted, nothing paged
    assert env["alerts"] == []


def test_the_sentinel_never_raises_into_a_sync(env):
    out = mc.run_mirror_check("u1", {"broken": "dict"}, RAW_POS, RAW_OPT, 1.0)
    assert out["ok"] is None and "error" in out


def test_sync_wiring_calls_the_sentinel_and_the_auto_backfill():
    """Derived from sync.py's AST (never a grep): _do_sync must call
    run_mirror_check AND maybe_backfill_after_initial_sync, with a control
    proving the walker sees a known sibling call."""
    import ast, inspect
    from api.services.journal_two.broker import sync as sync_mod

    tree = ast.parse(inspect.getsource(sync_mod))
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.AsyncFunctionDef) and n.name == "_do_sync")
    called = {n.func.attr for n in ast.walk(fn)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert "reconcile_option_holdings" in called          # control sibling
    assert "run_mirror_check" in called
    assert "maybe_backfill_after_initial_sync" in called


def test_trust_summary_carries_the_verdict(env):
    """The Sync Trust panel is the member-facing surface — the verdict must
    survive into its payload."""
    import inspect
    from api.services.journal_two.broker import service as svc
    src = inspect.getsource(svc.trust_summary)
    assert "latest_verdicts" in src and '"mirror"' in src

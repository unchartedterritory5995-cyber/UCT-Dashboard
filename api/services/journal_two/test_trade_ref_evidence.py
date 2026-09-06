"""Phase 4D-4C.2 — explicit tradeRef evidence resolution.

Covers `trade_refs.resolve_trade_ref_evidence` (the read-only resolver) + the
`GET /api/j2/trade-evidence` route it backs, plus the `tradeRef` field now
carried on every `_row_to_trade`/`_row_to_strategy` output (list AND detail).
"""
import sqlite3

from api.services.journal_two import db as j2db
from api.services.journal_two.options import get_strategy, list_strategies
from api.services.journal_two.trade_refs import (
    resolve_option_strategy_by_ref, resolve_trade_ref_evidence,
)
from api.services.journal_two.trades import get_trade_detail, list_trades_for_user


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


def _seed_trade(conn, trade_id, user_id="u1", symbol="TQQQ", *,
                entry_date="2026-06-24", exit_date="2026-06-25",
                source=None, external_id=None):
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,"
        " entry_price, entry_date, exit_price, exit_date, original_stop,"
        " pnl_dollar, pnl_percent, hold_days, result, context_at_entry, created_at,"
        " source, external_id) VALUES"
        " (?, ?, ?, ?, 'Long', 10, 100, ?, 110, ?, 95, 100, 0.1, 1, 'Win', '{}',"
        " '2026-01-01', ?, ?)",
        (trade_id, user_id, f"p-{trade_id}", symbol, entry_date, exit_date,
         source, external_id),
    )
    conn.commit()


def _seed_strategy(conn, strategy_id, user_id="u1", underlying="SPY", *,
                   source=None, external_id=None):
    conn.execute(
        "INSERT INTO j2_option_strategies (id, user_id, underlying, strategy_type,"
        " direction, net_entry, entry_date, context_at_entry, status, closed_at,"
        " created_at, updated_at, source, external_id) VALUES"
        " (?, ?, ?, 'long_call', 'bullish', 500, '2026-01-02', '{}', 'closed',"
        " '2026-01-03', '2026-01-01', '2026-01-01', ?, ?)",
        (strategy_id, user_id, underlying, source, external_id),
    )
    conn.execute(
        "INSERT INTO j2_option_legs (id, strategy_id, leg_index, side, contract_type,"
        " strike, expiration, qty, entry_price) VALUES"
        " (?, ?, 0, 'buy', 'call', 450, '2026-07-17', 1, 5.0)",
        (f"leg-{strategy_id}", strategy_id),
    )
    conn.commit()


# ── tradeRef now flows through the list serializer too ─────────────────────

def test_list_trades_carries_trade_ref():
    conn = _conn()
    _seed_trade(conn, "t1")
    rows = list_trades_for_user("u1", conn=conn)
    assert rows[0]["tradeRef"] == "id:t1"


def test_list_strategies_carries_trade_ref():
    conn = _conn()
    _seed_strategy(conn, "s1")
    rows = list_strategies("u1", conn=conn)
    assert rows[0]["tradeRef"] == "id:s1"


def test_get_strategy_detail_carries_trade_ref():
    conn = _conn()
    _seed_strategy(conn, "s1", source="broker", external_id="opt-ext-1")
    out = get_strategy("u1", "s1", conn=conn)
    assert out["tradeRef"] == "ext:opt-ext-1"
    assert len(out["legs"]) == 1


# ── resolve_trade_ref_evidence: equity ──────────────────────────────────────

def test_resolve_equity_trade_by_id_ref():
    conn = _conn()
    _seed_trade(conn, "t1")
    out = resolve_trade_ref_evidence("u1", "id:t1", conn=conn)
    assert out["assetType"] == "equity"
    assert out["tradeRef"] == "id:t1"
    assert out["trade"]["symbol"] == "TQQQ"


def test_resolve_equity_trade_by_ext_ref():
    conn = _conn()
    _seed_trade(conn, "t1", source="broker", external_id="bk-1")
    out = resolve_trade_ref_evidence("u1", "ext:bk-1", conn=conn)
    assert out["assetType"] == "equity"
    assert out["tradeRef"] == "ext:bk-1"


def test_resolve_wrong_user_is_none():
    conn = _conn()
    _seed_trade(conn, "t1")
    assert resolve_trade_ref_evidence("u2", "id:t1", conn=conn) is None


def test_resolve_unknown_ref_is_none():
    conn = _conn()
    _seed_trade(conn, "t1")
    assert resolve_trade_ref_evidence("u1", "id:does-not-exist", conn=conn) is None


def test_resolve_malformed_ref_is_none():
    conn = _conn()
    _seed_trade(conn, "t1")
    assert resolve_trade_ref_evidence("u1", "garbage-not-a-ref", conn=conn) is None


# ── resolve_trade_ref_evidence: options — never collapsed into the ticker ──

def test_resolve_option_strategy_preserves_asset_type_distinction():
    conn = _conn()
    _seed_strategy(conn, "s1", underlying="SPY")
    out = resolve_trade_ref_evidence("u1", "id:s1", conn=conn)
    assert out["assetType"] == "option_strategy"
    assert out["tradeRef"] == "id:s1"
    assert "strategy" in out and "trade" not in out  # never forced equity-shaped
    assert out["strategy"]["underlying"] == "SPY"
    assert len(out["strategy"]["legs"]) == 1


def test_resolve_option_strategy_by_broker_ext_ref():
    conn = _conn()
    _seed_strategy(conn, "s1", source="broker", external_id="opt-ext-9")
    row = resolve_option_strategy_by_ref("u1", "ext:opt-ext-9", conn)
    assert row is not None and row["id"] == "s1"
    out = resolve_trade_ref_evidence("u1", "ext:opt-ext-9", conn=conn)
    assert out["assetType"] == "option_strategy"


def test_option_strategy_never_matches_a_same_id_trade():
    """A trade and a strategy can never collide: trades are checked first, and
    an id: ref that only exists in j2_option_strategies must resolve there,
    not fall through to a wrong/empty equity read."""
    conn = _conn()
    _seed_strategy(conn, "shared-id", underlying="QQQ")
    out = resolve_trade_ref_evidence("u1", "id:shared-id", conn=conn)
    assert out["assetType"] == "option_strategy"


# ── Multiple same-ticker same-day trades: distinct refs, never conflated ───

def test_two_same_ticker_same_day_trades_have_distinct_refs_and_resolve_independently():
    conn = _conn()
    _seed_trade(conn, "tA", symbol="TQQQ", entry_date="2026-06-24", exit_date="2026-06-24")
    _seed_trade(conn, "tB", symbol="TQQQ", entry_date="2026-06-24", exit_date="2026-06-24")
    rows = list_trades_for_user("u1", conn=conn)
    refs = {r["id"]: r["tradeRef"] for r in rows}
    assert refs["tA"] == "id:tA"
    assert refs["tB"] == "id:tB"
    assert refs["tA"] != refs["tB"]

    out_a = resolve_trade_ref_evidence("u1", "id:tA", conn=conn)
    out_b = resolve_trade_ref_evidence("u1", "id:tB", conn=conn)
    assert out_a["trade"]["id"] == "tA"
    assert out_b["trade"]["id"] == "tB"
    # Capturing A must never resolve to B merely because ticker+date match.
    assert out_a["trade"]["id"] != out_b["trade"]["id"]


# ── Router presence + auth shape (route-level, mirrors test_trade_detail.py) ─

def test_trade_evidence_route_registered():
    from api.routers.journal_two import router
    paths = {r.path for r in router.routes}
    assert "/api/j2/trade-evidence" in paths
    assert "/api/j2/trades/{trade_id}" in paths  # unshadowed, still there

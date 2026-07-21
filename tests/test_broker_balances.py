"""Tests for broker balances + holdings-as-truth position reconciliation."""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import balances


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    acct = accounts_service.create_account(
        "u1", {"name": "Broker", "color": "blue", "startingBalance": 1.0}
    )
    return {"ba": {"id": "ba1", "j2AccountId": acct["id"]}, "acct_id": acct["id"]}


def _pos(sym, units, price, avg_cost):
    return {"symbol": {"symbol": sym}, "units": units, "price": price,
            "average_purchase_price": avg_cost}


def _positions(user="u1"):
    conn = auth_db.get_connection()
    try:
        return conn.execute(
            "SELECT symbol, side, shares, entry_price, entry_estimated, stop_price, source "
            "FROM j2_positions WHERE user_id=? ORDER BY symbol", (user,)
        ).fetchall()
    finally:
        conn.close()


# ── balances ─────────────────────────────────────────────────────────────────

def test_market_value_signed():
    # long 10@150 = +1500, short 5@40 = -200 → net 1300
    mv = balances.market_value([_pos("AAPL", 10, 150, 100), _pos("TSLA", -5, 40, 50)])
    assert mv == 1300.0


def test_usd_cash_buying_power_filters_currency():
    raw = [{"currency": {"code": "USD"}, "cash": 5000, "buying_power": 10000},
           {"currency": {"code": "CAD"}, "cash": 999, "buying_power": 999}]
    cash, bp = balances.usd_cash_buying_power(raw)
    assert cash == 5000 and bp == 10000


def test_write_balances_syncs_account_size_to_equity_with_margin(env):
    # % invested / risk% / position sizing all divide by account_size; for a
    # broker account that MUST be the real net-liq equity, not the static seed.
    # Margin: a negative cash (debit balance) correctly reduces equity below MV.
    raw_bal = [{"currency": "USD", "cash": -12053.04, "buying_power": 9470.11}]
    raw_pos = [_pos("AAPL", 200, 100, 90)]  # MV 20000 → equity = -12053.04 + 20000
    out = balances.write_balances("u1", env["ba"], raw_bal, raw_pos)
    assert out["equity"] == 7946.96            # net-liq nets the margin debt
    conn = auth_db.get_connection()
    try:
        acct_size = conn.execute(
            "SELECT account_size FROM j2_accounts WHERE id=?", (env["acct_id"],)
        ).fetchone()["account_size"]
    finally:
        conn.close()
    assert acct_size == 7946.96                # synced to real balance, not seed


def test_account_total_usd_extracts_amount():
    assert balances._account_total_usd(
        {"balance": {"total": {"amount": 8731.52, "currency": "USD"}}}) == 8731.52
    assert balances._account_total_usd(
        {"balance": {"total": {"amount": 100, "currency": {"code": "USD"}}}}) == 100.0
    assert balances._account_total_usd(
        {"balance": {"total": {"amount": 50, "currency": "CAD"}}}) is None
    assert balances._account_total_usd({}) is None


def test_write_balances_prefers_broker_reported_total(env):
    # Broker reports its own total ($8,731.52) — use it verbatim, NOT the derived
    # cash + MV ($-12053.04 + 200×100 = $7,946.96).
    raw_bal = [{"currency": "USD", "cash": -12053.04, "buying_power": 9470.11}]
    raw_pos = [_pos("AAPL", 200, 100, 90)]
    out = balances.write_balances("u1", env["ba"], raw_bal, raw_pos, broker_total=8731.52)
    assert out["equity"] == 8731.52
    conn = auth_db.get_connection()
    try:
        sz = conn.execute("SELECT account_size FROM j2_accounts WHERE id=?",
                          (env["acct_id"],)).fetchone()["account_size"]
    finally:
        conn.close()
    assert sz == 8731.52     # account_size synced to the broker's real total


def test_write_balances_sets_account_fields(env):
    raw_bal = [{"currency": "USD", "cash": 8000, "buying_power": 16000}]
    raw_pos = [_pos("AAPL", 10, 150, 100)]  # mv 1500
    out = balances.write_balances("u1", env["ba"], raw_bal, raw_pos)
    assert out["equity"] == 9500.0 and out["cash"] == 8000 and out["marketValue"] == 1500.0
    acct = accounts_service.get_account("u1", env["acct_id"])
    assert acct["balanceSource"] == "broker"
    assert acct["brokerTotalEquity"] == 9500.0
    assert acct["brokerBuyingPower"] == 16000.0


def test_write_balances_floors_untrustworthy_derived_equity(env):
    # INV-4: no broker_total + a full margin debit against a PARTIAL positions
    # feed derives an implausible <= 0 net-liq (the −$17,774 class). It must NOT
    # be persisted as equity / account_size / an equity-curve point — the prior
    # last-good equity is preserved while the component balances still refresh.
    # 1) establish a good equity.
    balances.write_balances(
        "u1", env["ba"],
        [{"currency": "USD", "cash": 5000, "buying_power": 10000}],
        [_pos("AAPL", 100, 100, 90)],   # MV 10000 → derived 15000 (>0, trusted)
    )
    # 2) bad derived: -22447.21 cash + only ~4673 MV materialized → derived < 0.
    out = balances.write_balances(
        "u1", env["ba"],
        [{"currency": "USD", "cash": -22447.21, "buying_power": 6464.36}],
        [_pos("XYZ", 50, 93.46, 90)],   # MV 4673 → derived ≈ -17774
    )
    assert out["equity"] is None and out["equityTrustworthy"] is False
    conn = auth_db.get_connection()
    try:
        row = conn.execute(
            "SELECT broker_total_equity, account_size, broker_cash, broker_market_value "
            "FROM j2_accounts WHERE id=?", (env["acct_id"],)
        ).fetchone()
        snap_eq = conn.execute(
            "SELECT total_equity FROM j2_broker_equity_snapshots WHERE user_id='u1'"
        ).fetchone()
    finally:
        conn.close()
    # Prior good equity + account_size preserved (NOT the -17774 garbage).
    assert row["broker_total_equity"] == 15000.0
    assert row["account_size"] == 15000.0
    # Component balances DID refresh (individually broker-reported, trustworthy).
    assert row["broker_cash"] == -22447.21
    assert row["broker_market_value"] == 4673.0
    # Equity-curve point NOT poisoned by the bad sync.
    assert snap_eq["total_equity"] == 15000.0


def test_write_balances_rejects_non_finite_broker_total(env):
    # NaN/Inf broker_total (Python's json parses these) must NOT short-circuit
    # the finiteness guard into account_size / the equity curve.
    import math
    balances.write_balances(  # establish a good equity first
        "u1", env["ba"],
        [{"currency": "USD", "cash": 5000, "buying_power": 10000}],
        [_pos("AAPL", 100, 100, 90)],   # derived 15000
    )
    for bad in (float("nan"), float("inf")):
        out = balances.write_balances(
            "u1", env["ba"],
            [{"currency": "USD", "cash": 100, "buying_power": 100}],
            [_pos("AAPL", 1, 100, 90)], broker_total=bad,
        )
        assert out["equityTrustworthy"] is False
    conn = auth_db.get_connection()
    try:
        row = conn.execute(
            "SELECT broker_total_equity, account_size FROM j2_accounts WHERE id=?",
            (env["acct_id"],)
        ).fetchone()
    finally:
        conn.close()
    assert row["broker_total_equity"] == 15000.0            # prior good preserved
    assert math.isfinite(row["account_size"]) and row["account_size"] == 15000.0


def test_write_balances_mirrors_broker_reported_negative_equity(env):
    # A broker that reports its own negative total (genuine margin debt) is
    # TRUTH — persist it verbatim; the sanity floor only guards the DERIVED path.
    out = balances.write_balances(
        "u1", env["ba"],
        [{"currency": "USD", "cash": -5000, "buying_power": 0}],
        [_pos("AAPL", 10, 100, 90)],
        broker_total=-1200.0,
    )
    assert out["equity"] == -1200.0 and out["equityTrustworthy"] is True


# ── holdings reconciliation ──────────────────────────────────────────────────

def test_carried_in_position_uses_cost_basis_estimated(env):
    # No FIFO history → entry seeded from avg cost, flagged estimated.
    raw_pos = [_pos("AAPL", 10, 150, 100)]
    res = balances.reconcile_positions("u1", env["ba"], raw_pos, fifo_open_positions=[])
    assert res["upserted"] == 1
    rows = _positions()
    assert len(rows) == 1
    r = rows[0]
    assert r["side"] == "Long" and r["shares"] == 10
    assert r["entry_price"] == 100      # cost basis seed
    assert r["entry_estimated"] == 1
    assert r["stop_price"] == 100       # unknown stop → = entry (R null)
    assert r["source"] == "broker"


def test_reconcile_captures_and_refreshes_broker_price(env):
    """The broker's current per-share mark is stored + surfaced as brokerPrice,
    and refreshed on re-sync — so equity rows show a real price after hours."""
    from api.services.journal_two import positions as positions_service

    balances.reconcile_positions("u1", env["ba"], [_pos("AAPL", 10, 175.0, 150.0)], [])
    aapl = next(p for p in positions_service.list_open_positions("u1") if p["symbol"] == "AAPL")
    assert aapl["brokerPrice"] == 175.0

    # Re-sync with a new mark updates the stored broker price.
    balances.reconcile_positions("u1", env["ba"], [_pos("AAPL", 10, 181.5, 150.0)], [])
    aapl = next(p for p in positions_service.list_open_positions("u1") if p["symbol"] == "AAPL")
    assert aapl["brokerPrice"] == 181.5


def test_fifo_match_uses_real_entry(env):
    raw_pos = [_pos("AAPL", 10, 150, 100)]
    fifo = [{"symbol": "AAPL", "side": "Long", "shares": 10,
             "entryPrice": 98.5, "entryDate": "2026-01-02T00:00:00Z"}]
    balances.reconcile_positions("u1", env["ba"], raw_pos, fifo)
    r = _positions()[0]
    assert r["entry_price"] == 98.5      # real fill, not cost basis
    assert r["entry_estimated"] == 0


def test_short_holding_negative_units(env):
    raw_pos = [_pos("TSLA", -5, 40, 50)]
    balances.reconcile_positions("u1", env["ba"], raw_pos, [])
    r = _positions()[0]
    assert r["side"] == "Short" and r["shares"] == 5


def test_resync_updates_shares_preserves_enrichment(env):
    # First sync: carried-in 10 shares.
    balances.reconcile_positions("u1", env["ba"], [_pos("AAPL", 10, 150, 100)], [])
    # User enriches: set a stop + setup.
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_positions SET stop_price=90, setup='VCP' WHERE user_id='u1'")
    conn.commit(); conn.close()
    # Second sync: now 15 shares.
    balances.reconcile_positions("u1", env["ba"], [_pos("AAPL", 15, 150, 100)], [])
    conn = auth_db.get_connection()
    r = conn.execute("SELECT shares, stop_price, setup FROM j2_positions WHERE user_id='u1'").fetchone()
    conn.close()
    assert r["shares"] == 15            # broker fact updated
    assert r["stop_price"] == 90        # user enrichment preserved
    assert r["setup"] == "VCP"


def test_resync_refreshes_avg_entry_on_real_fills(env):
    # Regression: adding to a broker position must update the average entry.
    # First sync — real FIFO entry (entry_estimated=0), like TLN reconstructed
    # exactly from fills.
    balances.reconcile_positions(
        "u1", env["ba"], [_pos("TLN", 10, 200, 100)],
        [{"symbol": "TLN", "side": "Long", "shares": 10,
          "entryPrice": 98.5, "entryDate": "2026-01-02T00:00:00Z"}],
    )
    r = _positions()[0]
    assert r["entry_price"] == 98.5 and r["entry_estimated"] == 0
    # User buys 1 more share at a higher price. On re-sync, FIFO recomputes the
    # weighted-average entry across all open lots → 102.3, and broker holds 11.
    balances.reconcile_positions(
        "u1", env["ba"], [_pos("TLN", 11, 210, 110)],
        [{"symbol": "TLN", "side": "Long", "shares": 11,
          "entryPrice": 102.3, "entryDate": "2026-01-02T00:00:00Z"}],
    )
    r = _positions()[0]
    assert r["shares"] == 11             # broker share count updated
    assert r["entry_price"] == 102.3     # average entry refreshed (was the bug)
    assert r["entry_estimated"] == 0


def test_resync_reseeds_avg_when_shares_change_before_backfill(env):
    # Real add whose fill hasn't backfilled to the activity feed yet: broker
    # holds 11 but FIFO can still only reconstruct 10. The average MUST still
    # refresh — reseed from the broker's reported cost, flagged estimated, so it
    # tracks the current holding instead of freezing at the 10-share basis.
    balances.reconcile_positions(
        "u1", env["ba"], [_pos("TLN", 10, 200, 100)],
        [{"symbol": "TLN", "side": "Long", "shares": 10,
          "entryPrice": 98.5, "entryDate": "2026-01-02T00:00:00Z"}],
    )
    assert _positions()[0]["entry_estimated"] == 0
    balances.reconcile_positions(
        "u1", env["ba"], [_pos("TLN", 11, 210, 105)],   # broker avg cost 105
        [{"symbol": "TLN", "side": "Long", "shares": 10,   # FIFO lags at 10
          "entryPrice": 98.5, "entryDate": "2026-01-02T00:00:00Z"}],
    )
    r = _positions()[0]
    assert r["shares"] == 11             # broker share count wins
    assert r["entry_price"] == 105       # average refreshed from broker cost
    assert r["entry_estimated"] == 1     # flagged until FIFO catches up


def test_resync_unchanged_holding_keeps_real_basis(env):
    # Holding UNCHANGED (broker still 10) but FIFO transiently can't reconstruct
    # it this sync (heal window) → must NOT downgrade the real basis.
    balances.reconcile_positions(
        "u1", env["ba"], [_pos("TLN", 10, 200, 100)],
        [{"symbol": "TLN", "side": "Long", "shares": 10,
          "entryPrice": 98.5, "entryDate": "2026-01-02T00:00:00Z"}],
    )
    balances.reconcile_positions(
        "u1", env["ba"], [_pos("TLN", 10, 210, 110)],
        [{"symbol": "TLN", "side": "Long", "shares": 9,   # transient FIFO divergence
          "entryPrice": 97.0, "entryDate": "2026-01-02T00:00:00Z"}],
    )
    r = _positions()[0]
    assert r["shares"] == 10             # unchanged
    assert r["entry_price"] == 98.5      # real basis preserved, not downgraded
    assert r["entry_estimated"] == 0


def test_closed_holding_removed(env):
    balances.reconcile_positions("u1", env["ba"], [_pos("AAPL", 10, 150, 100)], [])
    assert len(_positions()) == 1
    # AAPL no longer held → removed.
    res = balances.reconcile_positions("u1", env["ba"], [], [])
    assert res["closed"] == 1
    assert _positions() == []


def test_share_discrepancy_flagged(env):
    raw_pos = [_pos("AAPL", 10, 150, 100)]
    fifo = [{"symbol": "AAPL", "side": "Long", "shares": 7,  # broker says 10, FIFO says 7
             "entryPrice": 98.5, "entryDate": "2026-01-02T00:00:00Z"}]
    res = balances.reconcile_positions("u1", env["ba"], raw_pos, fifo)
    assert len(res["discrepancies"]) == 1
    # Broker wins: stored shares = 10.
    assert _positions()[0]["shares"] == 10

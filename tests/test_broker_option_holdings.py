"""Holdings-as-truth for OPEN options — the SnapTrade unit conventions.

`reconcile_option_holdings` / `_holding_contract` had ZERO test coverage
repo-wide (audit D-2) while carrying a factor-of-100 normalisation and, on a
mini option, disagreeing with `balances._opt_contract_multiplier` by 10×
(audit D-3). A factor of 100 with no test is the most dangerous shape in a
trading product: it is off by 10,000% and every internal consistency check
still passes.

The member-visible number these tests pin is the one rendered by
`OptionStrategiesSection.jsx`:

    open P&L = brokerCurrentValue - netEntry

so every expectation below is hand-worked against that formula and asserted
EXACTLY (never pytest.approx — an approx window is how a real defect hides).
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import balances
from api.services.journal_two.broker import option_reconstruct as oro


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
    return {"j2": acct["id"], "ba": {"id": "ba1", "j2AccountId": acct["id"]}}


def _holding(*, units, avg_purchase_price, price, mini=False,
             underlying="AAPL", strike=200.0, expiration="2026-06-19",
             option_type="CALL"):
    """A SnapTrade option holding.

    THE QUIRK UNDER TEST: `price` is PER-SHARE (the premium quote a member
    sees, e.g. 7.25) while `average_purchase_price` is PER-CONTRACT (premium
    x contract size, e.g. 550.00). They are NOT in the same unit.
    """
    return {
        "symbol": {"option_symbol": {
            "ticker": f"{underlying} 260619C00200000",
            "strike_price": strike,
            "expiration_date": expiration,
            "option_type": option_type,
            "underlying_symbol": {"symbol": underlying},
            "is_mini_option": mini,
        }},
        "units": units,
        "price": price,
        "average_purchase_price": avg_purchase_price,
        "currency": {"code": "USD"},
    }


def _open_rows(user="u1"):
    conn = auth_db.get_connection()
    try:
        return conn.execute(
            "SELECT s.strategy_type, s.direction, s.status, s.net_entry, "
            "       s.broker_current_value, s.external_id, "
            "       l.side, l.qty, l.entry_price "
            "FROM j2_option_strategies s JOIN j2_option_legs l "
            "  ON l.strategy_id = s.id "
            "WHERE s.user_id = ? ORDER BY s.created_at", (user,),
        ).fetchall()
    finally:
        conn.close()


# ── D-2 · the x100 normalisation, on a STANDARD (100-share) contract ────────

def test_average_purchase_price_is_per_contract_and_normalises_to_per_share():
    """`average_purchase_price` 550.00 is the PER-CONTRACT cost of a 5.50
    premium. leg.entry_price is per-share, so it must read 5.50 — not 550.00
    (no normalisation) and not 0.055 (inverted)."""
    c = oro._holding_contract(_holding(units=2, avg_purchase_price=550.0, price=7.25))
    assert c is not None
    assert c["entry_price"] == 5.50
    assert c["mark"] == 7.25          # `price` is already per-share — never divided
    assert c["multiplier"] == 100


def test_standard_contract_open_pnl_is_exact(env):
    # Hand-worked: 2 contracts, premium paid 5.50/share, mark now 7.25/share.
    #   net_entry            = +1 x 2 x 5.50 x 100 = 1100.00
    #   brokerCurrentValue   =      2 x 7.25 x 100 = 1450.00
    #   member P&L           = 1450.00 - 1100.00   =  350.00
    out = oro.reconcile_option_holdings(
        "u1", env["ba"], [_holding(units=2, avg_purchase_price=550.0, price=7.25)])
    assert out["created"] == 1 and out["valued"] == 1

    r = _open_rows()[0]
    assert r["entry_price"] == 5.50
    assert r["qty"] == 2
    assert r["net_entry"] == 1100.00
    assert r["broker_current_value"] == 1450.00
    assert r["broker_current_value"] - r["net_entry"] == 350.00


# ── D-3 · mini options: 10 shares/contract, ONE authority over that value ───

def test_mini_option_open_pnl_is_exact(env):
    """A mini option is 10 shares/contract. `balances._opt_contract_multiplier`
    already knew this; `option_reconstruct` hardcoded 100 in three places, so
    the member saw an entry price 10x too low and a current value 10x too high
    on the same screen where `balances.option_market_value` got it right.

    Hand-worked: 3 mini contracts, premium paid 5.50/share, mark now 7.25/share.
      average_purchase_price = 5.50 x 10        =   55.00  (PER-CONTRACT)
      net_entry              = +1 x 3 x 5.50 x 10 = 165.00
      brokerCurrentValue     =      3 x 7.25 x 10 = 217.50
      member P&L             = 217.50 - 165.00    =  52.50

    Before the fix this rendered 2175.00 - 165.00 = 2010.00.
    """
    out = oro.reconcile_option_holdings(
        "u1", env["ba"],
        [_holding(units=3, avg_purchase_price=55.0, price=7.25, mini=True)])
    assert out["created"] == 1

    r = _open_rows()[0]
    assert r["entry_price"] == 5.50
    assert r["net_entry"] == 165.00
    assert r["broker_current_value"] == 217.50
    assert r["broker_current_value"] - r["net_entry"] == 52.50


def test_mini_option_current_value_agrees_with_the_balances_sibling(env):
    """The two modules read the SAME `raw_option_holdings` payload. Their
    marks must agree to the cent — a second authority over one value is this
    repo's most-repeated defect, and here it sat on a money number."""
    h = _holding(units=3, avg_purchase_price=55.0, price=7.25, mini=True)
    oro.reconcile_option_holdings("u1", env["ba"], [h])

    assert _open_rows()[0]["broker_current_value"] == balances.option_market_value([h])


def test_the_multiplier_is_read_from_balances_not_reimplemented(env, monkeypatch):
    """The WIRE test. Both modules can be individually correct while the wire
    between them is cut — so redefine contract size at the authority and prove
    option_reconstruct moves with it. Reimplement `10 if mini else 100` locally
    and this goes RED while every other test here stays green."""
    monkeypatch.setattr(balances, "_opt_contract_multiplier", lambda o: 7)

    oro.reconcile_option_holdings(
        "u1", env["ba"], [_holding(units=1, avg_purchase_price=700.0, price=9.0)])

    r = _open_rows()[0]
    assert r["entry_price"] == 100.0          # 700.00 / 7
    assert r["net_entry"] == 700.00           # 1 x 100.00 x 7
    assert r["broker_current_value"] == 63.00  # 1 x 9.00 x 7


# ── D-4 · a sign flip must not leave the row disagreeing with itself ────────

def test_a_flip_to_short_reseeds_side_strategy_type_and_net_entry(env):
    """`held` is keyed on (underlying, strike, expiration, contractType) —
    side excluded — so a long -> short flip (e.g. assignment) matches the
    existing row and skips the create branch. Holdings-as-truth already
    corrects quantity there; it must correct SIDE the same way, or net_entry
    keeps its debit sign while broker_current_value goes negative and the
    member's P&L is wrong by twice the position.

    Hand-worked, 1 contract, 5.00 premium, mark now 3.00:
      short net_entry          = -1 x 1 x 5.00 x 100 = -500.00
      short brokerCurrentValue = -1     x 3.00 x 100 = -300.00
      member P&L               = -300.00 - -500.00   = +200.00

    Before the fix: strategy stayed long_call with net_entry +500.00, so the
    screen read -300.00 - 500.00 = -800.00.
    """
    oro.reconcile_option_holdings(
        "u1", env["ba"], [_holding(units=1, avg_purchase_price=500.0, price=6.0)])
    assert _open_rows()[0]["strategy_type"] == "long_call"

    # Same contract, now held SHORT at the same 5.00 basis, marked 3.00.
    oro.reconcile_option_holdings(
        "u1", env["ba"], [_holding(units=-1, avg_purchase_price=500.0, price=3.0)])

    rows = _open_rows()
    assert len(rows) == 1, "a flip must reseed the row, never fork a second one"
    r = rows[0]
    assert r["side"] == "sell"
    assert r["strategy_type"] == "short_call"
    assert r["direction"] == "bearish"
    assert r["net_entry"] == -500.00
    assert r["broker_current_value"] == -300.00
    assert r["broker_current_value"] - r["net_entry"] == 200.00


# ── idempotency · a stable external_id means re-sync = 0 dupes ──────────────

def test_re_syncing_the_same_holdings_creates_no_duplicates(env):
    h = [_holding(units=2, avg_purchase_price=550.0, price=7.25),
         _holding(units=1, avg_purchase_price=55.0, price=7.25, mini=True,
                  underlying="MSFT", strike=410.0)]

    first = oro.reconcile_option_holdings("u1", env["ba"], h)
    second = oro.reconcile_option_holdings("u1", env["ba"], h)

    assert first["created"] == 2
    assert second["created"] == 0 and second["removed"] == 0
    assert second["valued"] == 2
    assert len(_open_rows()) == 2
    assert all(r["external_id"].startswith("bkoptpos:") for r in _open_rows())


def test_a_contract_no_longer_held_is_removed(env):
    h = _holding(units=2, avg_purchase_price=550.0, price=7.25)
    oro.reconcile_option_holdings("u1", env["ba"], [h])
    out = oro.reconcile_option_holdings("u1", env["ba"], [])

    assert out["removed"] == 1
    assert _open_rows() == []

"""Per-broker GOLDEN FIXTURES — the fool-proof correctness gate.

Recorded SnapTrade-shaped payloads (balances + positions + reported total) for
each broker shape run through the REAL pipeline (`write_balances` →
`resolve_equity`, i.e. exactly what the account overview / hero reads) and assert
the rendered equity is ALWAYS broker truth — never a reconstructed number.

The RED fixture (`red_divergence_partial_feed`) reproduces the live incident
(full −$22,447 margin cash paired with only a partial positions feed → a derived
−$17,774) and proves the sanity guard FIRES: equity resolves to "pending", never
the fabricated negative. Today's audit oracle compared our writes to our writes
(self-consistent-but-wrong passes green); these fixtures pin the RENDERED value
against a broker-authoritative expectation.

A passing fixture is the intended gate to enable a NEW brokerage: add its
recorded payload shape here with the broker-reported expectation and it must go
green before the broker is turned on.
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import balances
from api.services.journal_two.broker.balance_resolver import resolve_equity


@pytest.fixture
def acct(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    a = accounts_service.create_account(
        "u1", {"name": "B", "color": "blue", "startingBalance": 1.0}
    )
    return {"ba": {"id": "ba1", "j2AccountId": a["id"]}, "acct_id": a["id"]}


def _pos(sym, units, price):
    return {"symbol": {"symbol": sym}, "units": units, "price": price,
            "average_purchase_price": price}


def _rendered_equity(acct):
    # Precisely what the account overview + hero resolve for this account.
    account = accounts_service.get_account("u1", acct["acct_id"])
    return resolve_equity(account)


# (label, raw_balances, raw_positions, broker_total, expect_equity, expect_pending)
GOLDEN = [
    # Robinhood margin — the incident account, corrected: the broker's own
    # reported total wins over any derived cash+MV, so the hero shows +$9,588.17.
    ("robinhood_margin_broker_total_wins",
     [{"currency": "USD", "cash": -22447.21, "buying_power": 6464.36}],
     [_pos("NVDA", 100, 46.73)],            # partial MV — must be IGNORED
     9588.17, 9588.17, False),

    # Schwab cash account — broker reports no total → derive cash + MV (positive).
    ("schwab_cash_derived_positive",
     [{"currency": "USD", "cash": 5000, "buying_power": 5000}],
     [_pos("AAPL", 50, 200)],               # MV 10000 → derived 15000
     None, 15000.0, False),

    # RED — the live bug: full margin debit + only a partial positions feed and
    # NO broker total → derived ≈ −$17,774. The guard MUST keep equity pending.
    ("red_divergence_partial_feed",
     [{"currency": "USD", "cash": -22447.21, "buying_power": 6464.36}],
     [_pos("XYZ", 50, 93.46)],              # MV 4673 → derived ≈ -17774
     None, None, True),

    # A broker that reports its own NEGATIVE total (genuine margin debt) — TRUTH,
    # mirror it verbatim (the sanity floor only guards the DERIVED path).
    ("negative_reported_is_truth",
     [{"currency": "USD", "cash": -5000, "buying_power": 0}],
     [_pos("AAPL", 10, 100)],
     -1200.0, -1200.0, False),
]


@pytest.mark.parametrize(
    "label,bal,pos,total,exp_eq,exp_pending", GOLDEN, ids=[g[0] for g in GOLDEN]
)
def test_golden_broker_equity(acct, label, bal, pos, total, exp_eq, exp_pending):
    balances.write_balances("u1", acct["ba"], bal, pos, broker_total=total)
    out = _rendered_equity(acct)
    assert out["source"] == "broker", label
    assert out.get("pending", False) is exp_pending, label
    assert out["equity"] == exp_eq, label


def test_red_fixture_never_persists_negative_into_account_size(acct):
    # Belt-and-suspenders on the RED case: the fabricated equity must never reach
    # account_size (the sizing / risk% / heat% denominator) or the equity curve.
    balances.write_balances(
        "u1", acct["ba"],
        [{"currency": "USD", "cash": -22447.21, "buying_power": 6464.36}],
        [_pos("XYZ", 50, 93.46)], broker_total=None,
    )
    conn = auth_db.get_connection()
    try:
        row = conn.execute(
            "SELECT broker_total_equity, account_size FROM j2_accounts WHERE id=?",
            (acct["acct_id"],),
        ).fetchone()
        snaps = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_broker_equity_snapshots WHERE user_id='u1'"
        ).fetchone()["n"]
    finally:
        conn.close()
    assert row["broker_total_equity"] is None       # no fabricated equity stored
    assert row["account_size"] != -17774.21          # sizing denominator not poisoned
    assert snaps == 0                                # no garbage equity-curve point

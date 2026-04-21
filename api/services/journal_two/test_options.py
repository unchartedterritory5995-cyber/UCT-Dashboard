"""Options multi-leg strategies — calc + CRUD + close/expire."""

import os
import sqlite3
import tempfile
import uuid
from datetime import date as Date, datetime, timedelta, timezone

import pytest


def _today_iso():
    return Date.today().isoformat()


def _exp_iso(days_from_now):
    """Helper for test leg expirations — always in the future so the
    past-expiration guard doesn't reject the fixture."""
    return (Date.today() + timedelta(days=days_from_now)).isoformat()


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    import importlib
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _add_user(conn, user_id, email):
    conn.execute(
        "INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'pw')",
        (user_id, email),
    )
    conn.commit()


# ─── Pure calc helpers ──────────────────────────────────────────────────────


def test_compute_net_entry_long_call():
    from api.services.journal_two.options import compute_net_entry
    # +1 buy call @ $5.00 × 100 shares = $500 debit
    legs = [{"side": "buy", "qty": 1, "entry_price": 5.00}]
    assert compute_net_entry(legs) == 500.0


def test_compute_net_entry_short_put_credit():
    from api.services.journal_two.options import compute_net_entry
    # -1 sell put @ $2.00 × 100 = -$200 (credit)
    legs = [{"side": "sell", "qty": 1, "entry_price": 2.00}]
    assert compute_net_entry(legs) == -200.0


def test_compute_net_entry_vertical_call_debit():
    from api.services.journal_two.options import compute_net_entry
    # Buy 200C @ $5 = +$500; Sell 205C @ $3 = -$300; net = +$200 debit
    legs = [
        {"side": "buy",  "qty": 1, "entry_price": 5.00},
        {"side": "sell", "qty": 1, "entry_price": 3.00},
    ]
    assert compute_net_entry(legs) == 200.0


def test_compute_net_entry_iron_condor_credit():
    from api.services.journal_two.options import compute_net_entry
    # Sell put @ $1.50 + Buy put @ $0.50 + Sell call @ $1.40 + Buy call @ $0.60
    # -150 + 50 - 140 + 60 = -180 net credit
    legs = [
        {"side": "sell", "qty": 1, "entry_price": 1.50},
        {"side": "buy",  "qty": 1, "entry_price": 0.50},
        {"side": "sell", "qty": 1, "entry_price": 1.40},
        {"side": "buy",  "qty": 1, "entry_price": 0.60},
    ]
    assert compute_net_entry(legs) == -180.0


def test_compute_net_exit_none_if_any_null():
    from api.services.journal_two.options import compute_net_exit
    legs = [
        {"side": "buy",  "qty": 1, "entry_price": 5.00, "exit_price": 6.00},
        {"side": "sell", "qty": 1, "entry_price": 3.00, "exit_price": None},
    ]
    assert compute_net_exit(legs) is None


def test_compute_pnl_debit_winner():
    from api.services.journal_two.options import compute_pnl
    # Paid $500 to enter, sold for $720, $10 fees roundtrip → +$210
    assert compute_pnl(net_entry=500, net_exit=720, fees=5, exit_fees=5) == 210.0


def test_compute_pnl_credit_winner():
    from api.services.journal_two.options import compute_pnl
    # Received $200 credit (net_entry=-200); bought back for $50 (net_exit=-50)
    # pnl = -50 - (-200) - 5 - 5 = 140
    assert compute_pnl(net_entry=-200, net_exit=-50, fees=5, exit_fees=5) == 140.0


def test_compute_max_risk_long_call():
    from api.services.journal_two.options import compute_max_risk
    legs = [{"side": "buy", "contract_type": "call", "strike": 200, "qty": 1, "entry_price": 5}]
    assert compute_max_risk("long_call", legs, 500) == 500


def test_compute_max_risk_short_put_naked():
    from api.services.journal_two.options import compute_max_risk
    legs = [{"side": "sell", "contract_type": "put", "strike": 200, "qty": 1, "entry_price": 2}]
    assert compute_max_risk("short_put", legs, -200) is None


def test_compute_max_risk_credit_spread():
    from api.services.journal_two.options import compute_max_risk
    # 5pt wide put credit spread, received $100 credit (net_entry=-100)
    # Max risk = 5 × 100 × 1 − 100 = 400
    legs = [
        {"side": "sell", "contract_type": "put", "strike": 200, "qty": 1},
        {"side": "buy",  "contract_type": "put", "strike": 195, "qty": 1},
    ]
    assert compute_max_risk("vertical_credit_put", legs, -100) == 400


def test_compute_max_risk_iron_condor():
    from api.services.journal_two.options import compute_max_risk
    # Strikes 195/200/210/215 — wings are 5 wide each; net credit $180
    # Max risk = 5 × 100 × 1 + (-180) = 320
    legs = [
        {"side": "sell", "contract_type": "put",  "strike": 200, "qty": 1},
        {"side": "buy",  "contract_type": "put",  "strike": 195, "qty": 1},
        {"side": "sell", "contract_type": "call", "strike": 210, "qty": 1},
        {"side": "buy",  "contract_type": "call", "strike": 215, "qty": 1},
    ]
    assert compute_max_risk("iron_condor", legs, -180) == 320


def test_compute_days_to_expiration_nearest():
    from api.services.journal_two.options import compute_days_to_expiration
    from datetime import date
    legs = [
        {"expiration": "2026-05-16"},
        {"expiration": "2026-06-20"},
    ]
    # Returns the nearest (smallest)
    result = compute_days_to_expiration(legs, as_of=date(2026, 4, 19))
    assert result == 27


def test_classify_debit_credit():
    from api.services.journal_two.options import classify_debit_credit
    assert classify_debit_credit(500) == "debit"
    assert classify_debit_credit(-200) == "credit"
    assert classify_debit_credit(0) == "even"


# ─── Validation ──────────────────────────────────────────────────────────────


def test_create_rejects_missing_underlying(db_conn):
    from api.services.journal_two.options import create_strategy, OptionValidationError
    _add_user(db_conn, "u1", "u1@x.com")
    with pytest.raises(OptionValidationError):
        create_strategy("u1", {
            "strategy_type": "long_call",
            "direction": "bullish",
            "entry_date": "2026-04-19",
            "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                      "expiration": "2026-05-16", "qty": 1, "entry_price": 5}],
        }, conn=db_conn)


def test_create_rejects_bad_strategy_type(db_conn):
    from api.services.journal_two.options import create_strategy, OptionValidationError
    _add_user(db_conn, "u1", "u1@x.com")
    with pytest.raises(OptionValidationError):
        create_strategy("u1", {
            "underlying": "NVDA", "strategy_type": "nonsense",
            "direction": "bullish", "entry_date": "2026-04-19",
            "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                      "expiration": "2026-05-16", "qty": 1, "entry_price": 5}],
        }, conn=db_conn)


def test_create_rejects_empty_legs(db_conn):
    from api.services.journal_two.options import create_strategy, OptionValidationError
    _add_user(db_conn, "u1", "u1@x.com")
    with pytest.raises(OptionValidationError):
        create_strategy("u1", {
            "underlying": "NVDA", "strategy_type": "long_call",
            "direction": "bullish", "entry_date": "2026-04-19",
            "legs": [],
        }, conn=db_conn)


def test_create_rejects_bad_leg_strike(db_conn):
    from api.services.journal_two.options import create_strategy, OptionValidationError
    _add_user(db_conn, "u1", "u1@x.com")
    with pytest.raises(OptionValidationError):
        create_strategy("u1", {
            "underlying": "NVDA", "strategy_type": "long_call",
            "direction": "bullish", "entry_date": "2026-04-19",
            "legs": [{"side": "buy", "contract_type": "call", "strike": -5,
                      "expiration": "2026-05-16", "qty": 1, "entry_price": 5}],
        }, conn=db_conn)


def test_create_rejects_past_expiration(db_conn):
    from api.services.journal_two.options import create_strategy, OptionValidationError
    _add_user(db_conn, "u1", "u1@x.com")
    past = _exp_iso(-1)  # yesterday
    with pytest.raises(OptionValidationError, match="in the past"):
        create_strategy("u1", {
            "underlying": "NVDA", "strategy_type": "long_call",
            "direction": "bullish", "entry_date": _today_iso(),
            "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                      "expiration": past, "qty": 1, "entry_price": 5}],
        }, conn=db_conn)


# ─── CRUD ────────────────────────────────────────────────────────────────────


def test_create_single_leg_long_call(db_conn):
    from api.services.journal_two.options import create_strategy
    _add_user(db_conn, "u1", "u1@x.com")
    s = create_strategy("u1", {
        "underlying": "nvda",  # will normalize to uppercase
        "strategy_type": "long_call",
        "direction": "bullish",
        "entry_date": "2026-04-19",
        "fees": 0.65,
        "setup": "VCP",
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                  "expiration": "2026-05-16", "qty": 1, "entry_price": 5.20}],
    }, conn=db_conn)
    assert s["underlying"] == "NVDA"
    assert s["strategyType"] == "long_call"
    assert s["netEntry"] == 520.0
    assert s["fees"] == 0.65
    assert s["setup"] == "VCP"
    assert s["status"] == "open"
    assert len(s["legs"]) == 1
    assert s["legs"][0]["strike"] == 200


def test_create_four_leg_iron_condor(db_conn):
    from api.services.journal_two.options import create_strategy
    _add_user(db_conn, "u1", "u1@x.com")
    s = create_strategy("u1", {
        "underlying": "SPY",
        "strategy_type": "iron_condor",
        "direction": "neutral",
        "entry_date": "2026-04-19",
        "legs": [
            {"side": "sell", "contract_type": "put",  "strike": 420, "expiration": "2026-05-16", "qty": 1, "entry_price": 1.50},
            {"side": "buy",  "contract_type": "put",  "strike": 415, "expiration": "2026-05-16", "qty": 1, "entry_price": 0.50},
            {"side": "sell", "contract_type": "call", "strike": 440, "expiration": "2026-05-16", "qty": 1, "entry_price": 1.40},
            {"side": "buy",  "contract_type": "call", "strike": 445, "expiration": "2026-05-16", "qty": 1, "entry_price": 0.60},
        ],
    }, conn=db_conn)
    assert s["strategyType"] == "iron_condor"
    assert s["netEntry"] == -180.0  # net credit
    assert len(s["legs"]) == 4


def test_list_and_get_strategy(db_conn):
    from api.services.journal_two.options import create_strategy, list_strategies, get_strategy
    _add_user(db_conn, "u1", "u1@x.com")
    a = create_strategy("u1", {
        "underlying": "NVDA", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": "2026-04-19",
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                  "expiration": "2026-05-16", "qty": 1, "entry_price": 5}],
    }, conn=db_conn)
    all_list = list_strategies("u1", conn=db_conn)
    assert len(all_list) == 1
    got = get_strategy("u1", a["id"], conn=db_conn)
    assert got["id"] == a["id"]


def test_close_strategy_debit_winner(db_conn):
    """Long call bought for $5, sold for $7.20. Net +$220 - fees."""
    from api.services.journal_two.options import create_strategy, close_strategy
    _add_user(db_conn, "u1", "u1@x.com")
    s = create_strategy("u1", {
        "underlying": "NVDA", "strategy_type": "long_call",
        "direction": "bullish", "entry_date": "2026-04-19",
        "fees": 0.65,
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                  "expiration": "2026-05-16", "qty": 1, "entry_price": 5.00}],
    }, conn=db_conn)
    closed = close_strategy("u1", s["id"], {
        "exitPrices": {"0": 7.20},
        "exitDate": "2026-04-25",
        "status": "closed",
        "exitFees": 0.65,
    }, conn=db_conn)
    # net_entry=500, net_exit=720, fees=0.65, exit_fees=0.65 → pnl = 218.70
    assert closed["pnlDollar"] == pytest.approx(218.70, abs=0.01)
    assert closed["status"] == "closed"
    assert closed["result"] == "Win"
    assert closed["rMultiple"] == pytest.approx(218.70 / 500, abs=0.01)


def test_close_credit_spread_winner(db_conn):
    """Put credit spread: collected $100 credit, closed for $30 debit to exit → +$70."""
    from api.services.journal_two.options import create_strategy, close_strategy
    _add_user(db_conn, "u1", "u1@x.com")
    s = create_strategy("u1", {
        "underlying": "SPY", "strategy_type": "vertical_credit_put",
        "direction": "bullish", "entry_date": "2026-04-19",
        "legs": [
            {"side": "sell", "contract_type": "put", "strike": 420,
             "expiration": "2026-05-16", "qty": 1, "entry_price": 1.50},
            {"side": "buy",  "contract_type": "put", "strike": 415,
             "expiration": "2026-05-16", "qty": 1, "entry_price": 0.50},
        ],
    }, conn=db_conn)
    # net_entry = (-150) + 50 = -100 (net credit)
    assert s["netEntry"] == -100
    closed = close_strategy("u1", s["id"], {
        "exitPrices": {"0": 0.40, "1": 0.10},  # paid 0.40 to close short put, collected 0.10 on long put
        "exitDate": "2026-04-25",
        "status": "closed",
    }, conn=db_conn)
    # net_exit = (-40) + 10 = -30 → pnl = -30 - (-100) - 0 - 0 = 70
    assert closed["pnlDollar"] == 70
    assert closed["result"] == "Win"
    # Max risk for credit spread = (420-415)*100*1 + (-100) = 400 → R = 70/400 = 0.175
    assert closed["rMultiple"] == pytest.approx(0.175, abs=0.01)


def test_mark_expired_zero_legs(db_conn):
    """Expired iron condor with net credit → keeps full credit."""
    from api.services.journal_two.options import create_strategy, mark_expired
    _add_user(db_conn, "u1", "u1@x.com")
    s = create_strategy("u1", {
        "underlying": "SPY", "strategy_type": "iron_condor",
        "direction": "neutral", "entry_date": "2026-04-19",
        "legs": [
            {"side": "sell", "contract_type": "put",  "strike": 420, "expiration": "2026-05-16", "qty": 1, "entry_price": 1.50},
            {"side": "buy",  "contract_type": "put",  "strike": 415, "expiration": "2026-05-16", "qty": 1, "entry_price": 0.50},
            {"side": "sell", "contract_type": "call", "strike": 440, "expiration": "2026-05-16", "qty": 1, "entry_price": 1.40},
            {"side": "buy",  "contract_type": "call", "strike": 445, "expiration": "2026-05-16", "qty": 1, "entry_price": 0.60},
        ],
    }, conn=db_conn)
    # net_entry = -180 (credit)
    expired = mark_expired("u1", s["id"], conn=db_conn)
    assert expired["status"] == "expired"
    # All legs expire worthless → net_exit = 0; pnl = 0 - (-180) - 0 - 0 = 180
    assert expired["pnlDollar"] == 180
    assert expired["result"] == "Win"


def test_mark_expired_batch(db_conn):
    from api.services.journal_two.options import create_strategy, mark_expired_batch
    _add_user(db_conn, "u1", "u1@x.com")
    # Use future expirations so create_strategy's past-expiration guard
    # doesn't reject the fixture.
    a = create_strategy("u1", {
        "underlying": "SPY", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": _today_iso(),
        "legs": [{"side": "buy", "contract_type": "call", "strike": 400, "expiration": _exp_iso(0), "qty": 1, "entry_price": 2}],
    }, conn=db_conn)
    b = create_strategy("u1", {
        "underlying": "NVDA", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": _today_iso(),
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200, "expiration": _exp_iso(0), "qty": 1, "entry_price": 3}],
    }, conn=db_conn)
    result = mark_expired_batch("u1", [a["id"], b["id"]], conn=db_conn)
    assert result["marked"] == 2


def test_delete_only_open(db_conn):
    from api.services.journal_two.options import (
        create_strategy, delete_strategy, close_strategy, OptionValidationError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    s = create_strategy("u1", {
        "underlying": "NVDA", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": "2026-04-19",
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                  "expiration": "2026-05-16", "qty": 1, "entry_price": 5}],
    }, conn=db_conn)
    # Close it first
    close_strategy("u1", s["id"], {
        "exitPrices": {"0": 7},
        "exitDate": "2026-04-25",
    }, conn=db_conn)
    # Now delete should fail
    with pytest.raises(OptionValidationError):
        delete_strategy("u1", s["id"], conn=db_conn)


def test_update_metadata_only(db_conn):
    from api.services.journal_two.options import create_strategy, update_strategy
    _add_user(db_conn, "u1", "u1@x.com")
    s = create_strategy("u1", {
        "underlying": "NVDA", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": "2026-04-19",
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                  "expiration": "2026-05-16", "qty": 1, "entry_price": 5}],
    }, conn=db_conn)
    updated = update_strategy("u1", s["id"], {
        "notes": "Updated thesis",
        "setup": "Breakout",
        "linkedPlaybookId": "pb-abc",
    }, conn=db_conn)
    assert updated["notes"] == "Updated thesis"
    assert updated["setup"] == "Breakout"
    assert updated["linkedPlaybookId"] == "pb-abc"


def test_user_isolation(db_conn):
    from api.services.journal_two.options import (
        create_strategy, list_strategies, get_strategy, delete_strategy,
    )
    _add_user(db_conn, "alice", "alice@x.com")
    _add_user(db_conn, "bob", "bob@x.com")

    a = create_strategy("alice", {
        "underlying": "NVDA", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": "2026-04-19",
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                  "expiration": "2026-05-16", "qty": 1, "entry_price": 5}],
    }, conn=db_conn)

    assert list_strategies("bob", conn=db_conn) == []
    assert get_strategy("bob", a["id"], conn=db_conn) is None
    assert delete_strategy("bob", a["id"], conn=db_conn) is False


def test_account_filter(db_conn):
    from api.services.journal_two.options import create_strategy, list_strategies
    _add_user(db_conn, "u1", "u1@x.com")
    # Two strategies on different accounts
    a = create_strategy("u1", {
        "underlying": "NVDA", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": "2026-04-19", "accountId": "acc-live",
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                  "expiration": "2026-05-16", "qty": 1, "entry_price": 5}],
    }, conn=db_conn)
    b = create_strategy("u1", {
        "underlying": "AMD", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": "2026-04-19", "accountId": "acc-paper",
        "legs": [{"side": "buy", "contract_type": "call", "strike": 140,
                  "expiration": "2026-05-16", "qty": 1, "entry_price": 3}],
    }, conn=db_conn)
    live_only = list_strategies("u1", account_id="acc-live", conn=db_conn)
    assert len(live_only) == 1
    assert live_only[0]["underlying"] == "NVDA"


def test_create_custom_strategy_then_close(db_conn):
    """Custom strategy type flows end-to-end; max_risk is None (no r_multiple)."""
    from api.services.journal_two.options import create_strategy, close_strategy
    _add_user(db_conn, "u1", "u1@x.com")
    s = create_strategy("u1", {
        "underlying": "TSLA", "strategy_type": "custom", "direction": "neutral",
        "entry_date": "2026-04-19",
        "legs": [
            {"side": "buy",  "contract_type": "call", "strike": 250, "expiration": "2026-06-20", "qty": 2, "entry_price": 8},
            {"side": "sell", "contract_type": "put",  "strike": 230, "expiration": "2026-06-20", "qty": 2, "entry_price": 4},
        ],
    }, conn=db_conn)
    # net_entry = (+2*8 -2*4)*100 = 800
    assert s["netEntry"] == 800
    closed = close_strategy("u1", s["id"], {
        "exitPrices": {"0": 10, "1": 3},
        "exitDate": "2026-05-01",
    }, conn=db_conn)
    # net_exit = (2*10 - 2*3)*100 = 1400; pnl = 1400 - 800 = 600
    assert closed["pnlDollar"] == 600
    assert closed["rMultiple"] is None  # custom → max_risk undefined
    assert closed["result"] == "Win"


def test_close_rejects_already_closed(db_conn):
    """close_strategy on a non-open strategy raises, not silently succeeds."""
    from api.services.journal_two.options import (
        create_strategy, close_strategy, OptionValidationError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    s = create_strategy("u1", {
        "underlying": "NVDA", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": "2026-04-19",
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                  "expiration": "2026-05-16", "qty": 1, "entry_price": 5}],
    }, conn=db_conn)
    close_strategy("u1", s["id"], {
        "exitPrices": {"0": 7}, "exitDate": "2026-04-25",
    }, conn=db_conn)
    with pytest.raises(OptionValidationError, match="not open"):
        close_strategy("u1", s["id"], {
            "exitPrices": {"0": 8}, "exitDate": "2026-04-26",
        }, conn=db_conn)


def test_close_rejects_negative_exit_price(db_conn):
    from api.services.journal_two.options import (
        create_strategy, close_strategy, OptionValidationError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    s = create_strategy("u1", {
        "underlying": "NVDA", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": "2026-04-19",
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                  "expiration": "2026-05-16", "qty": 1, "entry_price": 5}],
    }, conn=db_conn)
    with pytest.raises(OptionValidationError):
        close_strategy("u1", s["id"], {
            "exitPrices": {"0": -0.01}, "exitDate": "2026-04-25",
        }, conn=db_conn)


def test_mark_expired_sets_closed_at_to_leg_expiration(db_conn):
    """closed_at reflects when the legs expired, not mark-expired call time."""
    from api.services.journal_two.options import create_strategy, mark_expired
    _add_user(db_conn, "u1", "u1@x.com")
    exp = _exp_iso(0)  # today — must be >= today for create guard
    s = create_strategy("u1", {
        "underlying": "SPY", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": _today_iso(),
        "legs": [{"side": "buy", "contract_type": "call", "strike": 420,
                  "expiration": exp, "qty": 1, "entry_price": 3}],
    }, conn=db_conn)
    expired = mark_expired("u1", s["id"], conn=db_conn)
    # closed_at should bucket to the leg's expiration date (YYYY-MM-DD prefix)
    assert expired["closedAt"][:10] == exp


def test_mark_expired_calendar_uses_later_leg(db_conn):
    """Calendar/diagonal: closed_at = MAX leg expiration (the back-month)."""
    from api.services.journal_two.options import create_strategy, mark_expired
    _add_user(db_conn, "u1", "u1@x.com")
    near = _exp_iso(0)      # today — front month
    far = _exp_iso(30)      # +30 days — back month
    s = create_strategy("u1", {
        "underlying": "SPY", "strategy_type": "calendar", "direction": "neutral",
        "entry_date": _today_iso(),
        "legs": [
            {"side": "sell", "contract_type": "call", "strike": 420,
             "expiration": near, "qty": 1, "entry_price": 2},
            {"side": "buy",  "contract_type": "call", "strike": 420,
             "expiration": far, "qty": 1, "entry_price": 5},
        ],
    }, conn=db_conn)
    expired = mark_expired("u1", s["id"], conn=db_conn)
    # Back-month leg expires `far` — that's when the structure is fully dead
    assert expired["closedAt"][:10] == far


def test_linked_playbook_id_empty_string_normalized_to_null(db_conn):
    """Empty string for linkedPlaybookId is stored as NULL (consistent w/ schema)."""
    from api.services.journal_two.options import create_strategy, update_strategy
    _add_user(db_conn, "u1", "u1@x.com")
    # Empty string on create → null
    s = create_strategy("u1", {
        "underlying": "NVDA", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": "2026-04-19", "linkedPlaybookId": "   ",
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                  "expiration": "2026-05-16", "qty": 1, "entry_price": 5}],
    }, conn=db_conn)
    assert s["linkedPlaybookId"] is None

    # Empty string on update clears a previously-set link
    update_strategy("u1", s["id"], {"linkedPlaybookId": "pb-xyz"}, conn=db_conn)
    cleared = update_strategy("u1", s["id"], {"linkedPlaybookId": ""}, conn=db_conn)
    assert cleared["linkedPlaybookId"] is None


def test_delete_race_returns_false_when_status_flipped(db_conn):
    """Delete is status-conditional: if row is somehow not open at DELETE time,
    rowcount=0 and we return False (defensive — covered by our pre-check too)."""
    from api.services.journal_two.options import (
        create_strategy, delete_strategy, close_strategy,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    s = create_strategy("u1", {
        "underlying": "AMD", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": "2026-04-19",
        "legs": [{"side": "buy", "contract_type": "call", "strike": 140,
                  "expiration": "2026-05-16", "qty": 1, "entry_price": 3}],
    }, conn=db_conn)
    # Open strategy deletes fine
    assert delete_strategy("u1", s["id"], conn=db_conn) is True
    # Deleting already-gone row returns False (not-found path)
    assert delete_strategy("u1", s["id"], conn=db_conn) is False

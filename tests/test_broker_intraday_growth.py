"""Intraday position growth — an equity fill appears in the served book in
minutes, not at the next daily sync.

The 2026-08-26 gap: the fills rail captured a 2000-share SNAP buy at 14:54Z
into the ledger, but nothing could CREATE a served position row until the
overnight sync — the fast path only ever shrank or closed. The growth pass
creates/grows rows from the post-fill FIFO for EXACTLY the symbols this poll
filled (never carried history, never FIFO-error symbols), marked with a
`bkprov:` external id so holdings-as-truth can supersede them. Cash derives
forward over the same fills (live_cash), so book and cash finally move from
the same ledger rows in the same minute — the conservation law's happy path.
"""

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


def _fifo(sym, side, shares, entry, entry_date):
    return {"symbol": sym, "side": side, "shares": shares,
            "entryPrice": entry, "entryDate": entry_date}


def _rows(user="u1"):
    conn = auth_db.get_connection()
    try:
        return {r["symbol"]: dict(r) for r in conn.execute(
            "SELECT symbol, side, shares, entry_price, entry_date, stop_price, "
            "       entry_estimated, source, external_id, broker_price "
            "FROM j2_positions WHERE user_id = ? AND closed_at IS NULL", (user,)
        )}
    finally:
        conn.close()


def _seed_bkpos(env, sym, shares, entry, *, estimated=0):
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date,"
        " shares, original_shares, entry_price, stop_price, breakeven_stop,"
        " raise_to_breakeven, setup, notes, context_at_entry, created_at,"
        " updated_at, closed_at, account_id, source, external_id,"
        " entry_estimated, broker_price)"
        " VALUES (?, 'u1', ?, 'Long', '2026-08-01', ?, ?, ?, ?, NULL, 0,"
        " NULL, NULL, '{}', '2026-08-01', '2026-08-01', NULL, ?, 'broker',"
        " ?, ?, ?)",
        (f"row-{sym}", sym, shares, shares, entry, entry, env["acct_id"],
         f"bkpos:{env['ba']['id']}:{sym}:Long", estimated, entry),
    )
    conn.commit()
    conn.close()


FILL_TS = "2026-08-26T14:54:24.358000Z"
TRADED = {"SNAP": FILL_TS}


def test_new_symbol_fill_creates_a_provisional_row(env):
    out = balances.apply_intraday_growth(
        "u1", env["ba"], [_fifo("SNAP", "Long", 2000.0, 5.495, FILL_TS)],
        traded_symbols=TRADED,
    )
    assert out["created"] == 1
    row = _rows()["SNAP"]
    assert row["shares"] == 2000.0
    assert row["entry_price"] == 5.495
    assert row["entry_date"] == FILL_TS          # real fill, not a placeholder
    assert row["entry_estimated"] == 0
    assert row["source"] == "broker"
    assert row["external_id"] == f"bkprov:{env['ba']['id']}:SNAP:Long"
    assert row["stop_price"] == 5.495            # placeholder-stop convention
    assert row["broker_price"] == 5.495          # fill = initial mark


def test_carried_history_is_never_materialized(env):
    # FIFO says the position originates BEFORE this poll's fill — carried
    # lots are the holdings sync's job (their FIFO count may be meaningless).
    out = balances.apply_intraday_growth(
        "u1", env["ba"], [_fifo("SNAP", "Long", 2000.0, 5.495,
                                "2026-08-20T10:00:00Z")],
        traded_symbols=TRADED,
    )
    assert out == {"created": 0, "grown": 0}
    assert _rows() == {}


def test_untraded_symbols_are_untouched(env):
    # The ledger's FIFO carries dust/garbage for symbols with incomplete
    # history (phantom shorts) — only THIS poll's fills may materialize.
    out = balances.apply_intraday_growth(
        "u1", env["ba"], [
            _fifo("SNAP", "Long", 2000.0, 5.495, FILL_TS),
            _fifo("PSEC", "Short", 1.0, 5.425, "2020-12-07T20:10:27Z"),
        ],
        traded_symbols=TRADED,
    )
    assert out["created"] == 1
    assert "PSEC" not in _rows()


def test_add_grows_a_ledger_complete_row(env):
    _seed_bkpos(env, "NEXA", 750.0, 15.01)
    out = balances.apply_intraday_growth(
        "u1", env["ba"], [_fifo("NEXA", "Long", 1000.0, 15.20, FILL_TS)],
        traded_symbols={"NEXA": FILL_TS},
    )
    assert out["grown"] == 1
    row = _rows()["NEXA"]
    assert row["shares"] == 1000.0
    assert row["entry_price"] == 15.20           # FIFO's new weighted average
    assert row["stop_price"] == 15.20            # placeholder stays in lockstep
    assert row["external_id"].startswith("bkpos:")  # real row keeps identity


def test_estimated_rows_are_never_grown(env):
    _seed_bkpos(env, "DELL", 5.0, 132.726, estimated=1)
    out = balances.apply_intraday_growth(
        "u1", env["ba"], [_fifo("DELL", "Long", 10.0, 140.0, FILL_TS)],
        traded_symbols={"DELL": FILL_TS},
    )
    assert out == {"created": 0, "grown": 0}
    assert _rows()["DELL"]["shares"] == 5.0


def test_fifo_error_symbols_are_skipped(env):
    out = balances.apply_intraday_growth(
        "u1", env["ba"], [_fifo("SNAP", "Long", 2000.0, 5.495, FILL_TS)],
        traded_symbols=TRADED, fifo_errors=[{"symbol": "SNAP"}],
    )
    assert out == {"created": 0, "grown": 0}


def test_a_real_stop_is_never_clobbered_by_growth(env):
    _seed_bkpos(env, "NEXA", 750.0, 15.01)
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_positions SET stop_price = 14.20 "
                 "WHERE symbol = 'NEXA'")
    conn.commit()
    conn.close()
    balances.apply_intraday_growth(
        "u1", env["ba"], [_fifo("NEXA", "Long", 1000.0, 15.20, FILL_TS)],
        traded_symbols={"NEXA": FILL_TS},
    )
    assert _rows()["NEXA"]["stop_price"] == 14.20


# ── the fast path's shrink/close must manage provisional rows too ────────────

def test_intraday_shrink_and_close_cover_provisional_rows(env):
    balances.apply_intraday_growth(
        "u1", env["ba"], [_fifo("SNAP", "Long", 2000.0, 5.495, FILL_TS)],
        traded_symbols=TRADED,
    )
    out = balances.apply_intraday_fifo_to_open_positions(
        "u1", env["ba"], [_fifo("SNAP", "Long", 1200.0, 5.495, FILL_TS)])
    assert out["trimmed"] == 1
    assert _rows()["SNAP"]["shares"] == 1200.0
    out = balances.apply_intraday_fifo_to_open_positions("u1", env["ba"], [])
    assert out["closed"] == 1
    assert "SNAP" not in _rows()


# ── holdings-as-truth supersedes / keeps / expires provisional rows ──────────

def _reconcile(env, raw_positions, fifo=()):
    return balances.reconcile_positions("u1", env["ba"], raw_positions,
                                        list(fifo))


def _raw(sym, units, price, avg):
    return {"symbol": {"symbol": sym}, "units": units, "price": price,
            "average_purchase_price": avg}


def test_holdings_supersede_the_provisional_row(env):
    balances.apply_intraday_growth(
        "u1", env["ba"], [_fifo("SNAP", "Long", 2000.0, 5.495, FILL_TS)],
        traded_symbols=TRADED,
    )
    _reconcile(env, [_raw("SNAP", 2000, 5.415, 5.495)],
               fifo=[_fifo("SNAP", "Long", 2000.0, 5.495, FILL_TS)])
    rows = _rows()
    assert list(rows) == ["SNAP"]                    # exactly one row survives
    assert rows["SNAP"]["external_id"].startswith("bkpos:")


def test_fresh_provisional_survives_a_stale_holdings_payload(env):
    # SnapTrade's holdings cache can lag the fill by hours — deleting the
    # provisional row would make a REAL position vanish again.
    balances.apply_intraday_growth(
        "u1", env["ba"], [_fifo("SNAP", "Long", 2000.0, 5.495, FILL_TS)],
        traded_symbols=TRADED,
    )
    _reconcile(env, [])                              # payload doesn't know yet
    assert "SNAP" in _rows()


def test_an_aged_provisional_row_expires(env):
    balances.apply_intraday_growth(
        "u1", env["ba"], [_fifo("SNAP", "Long", 2000.0, 5.495, FILL_TS)],
        traded_symbols=TRADED,
    )
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_positions SET updated_at = '2026-08-20T00:00:00Z' "
                 "WHERE external_id LIKE 'bkprov:%'")
    conn.commit()
    conn.close()
    _reconcile(env, [])
    assert "SNAP" not in _rows()                     # 2-day staleness cap


def test_served_shape_carries_the_provisional_flag(env):
    from api.services.journal_two import positions as positions_service
    balances.apply_intraday_growth(
        "u1", env["ba"], [_fifo("SNAP", "Long", 2000.0, 5.495, FILL_TS)],
        traded_symbols=TRADED,
    )
    served = positions_service.list_open_positions("u1")
    assert len(served) == 1
    assert served[0]["provisional"] is True
    assert served[0]["source"] == "broker"

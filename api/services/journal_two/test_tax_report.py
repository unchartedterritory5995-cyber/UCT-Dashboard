"""Tax book-of-record — 8949-style lines, term split, same-symbol wash flags.

Same `:memory:` + ensure_schema(conn) pattern as test_excursions_store.py.
"""
import sqlite3

from api.services.journal_two import db as j2db
from api.services.journal_two.tax_report import get_tax_report


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


def _trade(conn, tid, *, symbol="NVDA", side="Long", shares=100,
           entry=100.0, entry_date="2026-03-01", exit_p=110.0,
           exit_date="2026-03-10", hold_days=9, result="Win",
           fees=None, user_id="u1", account_id="a1"):
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            account_id, created_at
        ) VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?,
                  ?, NULL, NULL, 0, 0, NULL, ?, ?, '{}', ?, '2026-01-01T00:00:00')
        """,
        (tid, user_id, symbol, side, shares, entry, entry_date, exit_p,
         exit_date, entry, hold_days, result, account_id),
    )
    if fees is not None:
        conn.execute("UPDATE j2_trades SET fees = ? WHERE id = ?", (fees, tid))
    conn.commit()


def test_basic_line_and_short_term_total():
    conn = _conn()
    _trade(conn, "t1", entry=100.0, exit_p=110.0, shares=100)
    out = get_tax_report("u1", 2026, conn=conn)
    assert out["coverage"] == {
        "eligible": 1, "reported": 1, "notComputable": 0, "optionsExcluded": 0,
    }
    line = out["lines"][0]
    assert line["proceeds"] == 11000.0
    assert line["basis"] == 10000.0
    assert line["gain"] == 1000.0
    assert line["term"] == "short"
    assert line["washSale"] is None
    assert out["totals"]["shortTermGain"] == 1000.0
    assert out["totals"]["longTermGain"] == 0.0
    assert out["disclaimer"]  # the honesty contract ships with the payload


def test_long_term_split_over_365_days():
    conn = _conn()
    _trade(conn, "t1", entry_date="2025-01-02", exit_date="2026-06-01",
           hold_days=515)
    out = get_tax_report("u1", 2026, conn=conn)
    assert out["lines"][0]["term"] == "long"
    assert out["totals"]["longTermGain"] == 1000.0
    assert out["totals"]["shortTermGain"] == 0.0


def test_short_side_gain_sign():
    conn = _conn()
    # Short 100 @ 50, cover @ 45 => +$500
    _trade(conn, "t1", side="Short", entry=50.0, exit_p=45.0, shares=100)
    out = get_tax_report("u1", 2026, conn=conn)
    assert out["lines"][0]["gain"] == 500.0


def test_wash_sale_flagged_when_rebuy_within_30_days():
    conn = _conn()
    # Loss sold 3/10; re-entry 3/25 (15 days later) in the same symbol.
    _trade(conn, "loss", entry=100.0, exit_p=90.0, shares=100,
           exit_date="2026-03-10", result="Loss")
    _trade(conn, "rebuy", entry=91.0, entry_date="2026-03-25",
           exit_p=95.0, exit_date="2026-05-01")
    out = get_tax_report("u1", 2026, conn=conn)
    loss_line = next(l for l in out["lines"] if l["gain"] < 0)
    assert loss_line["washSale"] is not None
    # full replacement (100 sh vs 100 sh) => full $1,000 loss disallowed
    assert loss_line["washSale"]["disallowedEstimate"] == 1000.0
    assert out["totals"]["washDisallowedEstimate"] == 1000.0


def test_wash_prorated_by_replacement_shares():
    conn = _conn()
    _trade(conn, "loss", entry=100.0, exit_p=90.0, shares=100,
           exit_date="2026-03-10", result="Loss")
    _trade(conn, "rebuy", entry=91.0, entry_date="2026-03-20", shares=40,
           exit_p=95.0, exit_date="2026-05-01")
    out = get_tax_report("u1", 2026, conn=conn)
    loss_line = next(l for l in out["lines"] if l["gain"] < 0)
    assert loss_line["washSale"]["disallowedEstimate"] == 400.0  # 40/100 of $1k


def test_no_wash_outside_window_or_other_symbol():
    conn = _conn()
    _trade(conn, "loss", entry=100.0, exit_p=90.0, shares=100,
           exit_date="2026-03-10", result="Loss")
    _trade(conn, "late", entry=91.0, entry_date="2026-05-15",   # 66 days later
           exit_p=95.0, exit_date="2026-06-01")
    _trade(conn, "other", symbol="AMD", entry=91.0, entry_date="2026-03-12",
           exit_p=95.0, exit_date="2026-06-01")
    out = get_tax_report("u1", 2026, conn=conn)
    loss_line = next(l for l in out["lines"] if l["gain"] < 0)
    assert loss_line["washSale"] is None
    assert out["totals"]["washDisallowedEstimate"] == 0.0


def test_open_position_rebuy_triggers_wash():
    conn = _conn()
    _trade(conn, "loss", entry=100.0, exit_p=90.0, shares=100,
           exit_date="2026-03-10", result="Loss")
    conn.execute(
        """
        INSERT INTO j2_positions (
            id, user_id, symbol, side, entry_date, shares, original_shares,
            entry_price, stop_price, context_at_entry, account_id,
            created_at, updated_at
        ) VALUES ('p1', 'u1', 'NVDA', 'Long', '2026-03-15', 50, 50,
                  92.0, 88.0, '{}', 'a1',
                  '2026-03-15T00:00:00', '2026-03-15T00:00:00')
        """,
    )
    conn.commit()
    out = get_tax_report("u1", 2026, conn=conn)
    loss_line = next(l for l in out["lines"] if l["gain"] < 0)
    assert loss_line["washSale"] is not None
    assert loss_line["washSale"]["disallowedEstimate"] == 500.0  # 50/100 of $1k


def test_year_scoping_and_account_filter():
    conn = _conn()
    _trade(conn, "in26", exit_date="2026-03-10")
    _trade(conn, "in25", entry_date="2025-02-01", exit_date="2025-03-10")
    _trade(conn, "acct2", exit_date="2026-04-10", account_id="a2")
    out = get_tax_report("u1", 2026, account_id="a1", conn=conn)
    assert out["coverage"]["eligible"] == 1
    out_all = get_tax_report("u1", 2026, conn=conn)
    assert out_all["coverage"]["eligible"] == 2

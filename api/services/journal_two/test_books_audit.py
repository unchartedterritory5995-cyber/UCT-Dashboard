"""Books audit — the cross-foot must PASS on a consistent book and FAIL on a
corrupted one (a gate nobody has seen fire is not a gate)."""
import sqlite3

from api.services.journal_two import db as j2db
from api.services.journal_two.books_audit import run_books_audit


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


def _trade(conn, tid, *, symbol="NVDA", side="Long", shares=100,
           entry=100.0, entry_date="2026-03-02", exit_p=110.0,
           exit_date="2026-03-05", fees=2.0, result="Win",
           excluded=0, user_id="u1", account_id="a1"):
    pnl = (exit_p - entry) * shares * (1 if side == "Long" else -1)
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            account_id, created_at, trading_day_et, fees, analytics_excluded
        ) VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?,
                  ?, 'VCP', NULL, ?, 0, 1.5, 3, ?, '{}',
                  ?, '2026-01-01T00:00:00', ?, ?, ?)
        """,
        (tid, user_id, symbol, side, shares, entry, entry_date, exit_p,
         exit_date, entry - 5, pnl, result, account_id,
         exit_date[:10], fees, excluded),
    )
    conn.commit()


def _strategy(conn, sid, *, pnl=150.0, user_id="u1", account_id="a1",
              closed="2026-03-04"):
    conn.execute(
        "INSERT INTO j2_option_strategies (id, user_id, account_id, underlying, "
        "strategy_type, direction, net_entry, entry_date, context_at_entry, "
        "status, closed_at, pnl_dollar, created_at, updated_at, trading_day_et) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (sid, user_id, account_id, "CRWV", "long_call", "bullish", 500.0,
         "2026-03-02T14:30:00+00:00", "{}", "closed",
         f"{closed}T19:00:00+00:00", pnl,
         "2026-03-02T00:00:00Z", "2026-03-02T00:00:00Z", closed),
    )
    conn.commit()


def _seed_book(conn):
    _trade(conn, "t1", exit_p=110.0, exit_date="2026-03-05")            # +1000 gross
    _trade(conn, "t2", symbol="AMD", side="Short", entry=50.0,
           exit_p=45.0, exit_date="2026-03-06", result="Win")           # +500 gross
    _trade(conn, "t3", symbol="TTD", exit_p=95.0, exit_date="2026-03-09",
           result="Loss")                                               # -500 gross
    _trade(conn, "tx", symbol="GHOST", exit_p=120.0, exit_date="2026-03-10",
           excluded=1)                                                  # excluded lens
    _strategy(conn, "s1", pnl=150.0)


def test_consistent_book_passes_every_check():
    conn = _conn()
    _seed_book(conn)
    out = run_books_audit("u1", conn=conn)
    failed = [c["name"] for c in out["checks"] if not c["pass"]]
    assert out["ok"], f"failed checks: {failed}: {out['checks']}"
    assert out["scope"]["includedTrades"] == 3
    assert out["scope"]["excludedTrades"] == 1
    assert out["scope"]["closedStrategies"] == 1


def test_corrupted_stored_pnl_fails_tax_parity():
    """Mutation control: stored pnl_dollar diverging from price*shares MUST
    trip tax_price_parity, with the line NAMED."""
    conn = _conn()
    _seed_book(conn)
    conn.execute("UPDATE j2_trades SET pnl_dollar = pnl_dollar + 123.45 WHERE id = 't1'")
    conn.commit()
    out = run_books_audit("u1", conn=conn)
    tax = next(c for c in out["checks"] if c["name"] == "tax_price_parity")
    assert not tax["pass"]
    assert any(m["symbol"] == "NVDA" for m in tax["mismatches"])
    assert not out["ok"]


def test_lying_calendar_lens_fails_closure(monkeypatch):
    """Mutation control: the closure catches a LENS serving different trades
    than the raw book (the code-drift class it exists for). Both lenses read
    the same columns in-process, so simulate the drift directly: a calendar
    that silently drops a day."""
    from api.services.journal_two import books_audit as ba
    conn = _conn()
    _seed_book(conn)
    real = ba.calendar_service.get_calendar

    def lying(*a, **k):
        out = real(*a, **k)
        out["days"] = [d for d in out.get("days", []) if d.get("date") != "2026-03-06"]
        return out

    monkeypatch.setattr(ba.calendar_service, "get_calendar", lying)
    out = run_books_audit("u1", conn=conn)
    cal = next(c for c in out["checks"] if c["name"] == "calendar_closure")
    assert not cal["pass"]
    assert not out["ok"]


def test_strategy_only_year_is_swept():
    """A year with ONLY option strategies must still enter the calendar sweep
    (years derive from trades UNION strategies)."""
    conn = _conn()
    _seed_book(conn)
    _strategy(conn, "s2", pnl=75.0, closed="2025-06-10")
    out = run_books_audit("u1", conn=conn)
    assert "2025" in out["scope"]["years"]
    cal = next(c for c in out["checks"] if c["name"] == "calendar_closure")
    assert cal["pass"], cal

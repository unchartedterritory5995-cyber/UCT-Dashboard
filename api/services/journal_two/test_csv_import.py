"""CSV import — sanitization, format detection, pre-matched parsing."""

import os
import sqlite3
import tempfile
from io import BytesIO

import pytest

from api.services.journal_two import csv_import as imp
from api.services.journal_two.csv_import import (
    sanitize_cell,
    decode_bytes,
    detect_format,
    parse_csv,
    parse_pre_matched,
    ParseResult,
)


# ══ Sanitization (§15.9) ═════════════════════════════════════════════════════

class TestSanitize:
    def test_prefixes_equals(self):
        assert sanitize_cell("=SUM(A1:A10)") == "'=SUM(A1:A10)"

    def test_prefixes_at(self):
        assert sanitize_cell("@cmd") == "'@cmd"

    def test_prefixes_tab(self):
        assert sanitize_cell("\tmalicious") == "'\tmalicious"

    def test_prefixes_cr(self):
        assert sanitize_cell("\rmalicious") == "'\rmalicious"

    def test_prefixes_plus_non_number(self):
        assert sanitize_cell("+cmd|calc") == "'+cmd|calc"

    def test_prefixes_minus_non_number(self):
        assert sanitize_cell("-cmd") == "'-cmd"

    def test_preserves_negative_number(self):
        assert sanitize_cell("-100") == "-100"
        assert sanitize_cell("-0.5") == "-0.5"

    def test_preserves_positive_number_with_plus(self):
        assert sanitize_cell("+100") == "+100"

    def test_leaves_normal_cells_alone(self):
        assert sanitize_cell("NVDA") == "NVDA"
        assert sanitize_cell("100") == "100"
        assert sanitize_cell("") == ""

    def test_handles_non_string(self):
        assert sanitize_cell(None) is None
        assert sanitize_cell(42) == 42

    def test_single_minus_alone(self):
        assert sanitize_cell("-") == "-"


# ══ Decoding ═════════════════════════════════════════════════════════════════

class TestDecode:
    def test_utf8_happy(self):
        assert decode_bytes(b"hello") == "hello"

    def test_strips_utf8_bom(self):
        assert decode_bytes(b"\xef\xbb\xbfhello") == "hello"

    def test_windows_1252_fallback(self):
        # 0x93 is "curly open quote" in CP-1252; invalid standalone UTF-8
        got = decode_bytes(b"\x93hello\x94")
        assert "hello" in got

    def test_normalizes_crlf(self):
        assert decode_bytes(b"a\r\nb\r\nc") == "a\nb\nc"

    def test_normalizes_cr_only(self):
        assert decode_bytes(b"a\rb\rc") == "a\nb\nc"

    def test_rejects_binary(self):
        # Mostly null bytes — clearly binary
        with pytest.raises(ValueError):
            decode_bytes(b"\x00" * 100 + b"text")


# ══ Format detection ═════════════════════════════════════════════════════════

class TestDetectFormat:
    def test_pre_matched_canonical(self):
        headers = ["symbol", "side", "shares", "entry_price", "entry_date",
                   "exit_price", "exit_date"]
        assert detect_format(headers) == "pre_matched"

    def test_pre_matched_with_optional_columns(self):
        headers = ["symbol", "side", "shares", "entry_price", "entry_date",
                   "exit_price", "exit_date", "setup", "notes"]
        assert detect_format(headers) == "pre_matched"

    def test_pre_matched_case_insensitive(self):
        headers = ["Symbol", "Side", "Shares", "Entry Price", "Entry Date",
                   "Exit Price", "Exit Date"]
        assert detect_format(headers) == "pre_matched"

    def test_schwab_signature(self):
        headers = ["Date", "Action", "Symbol", "Description", "Quantity",
                   "Price", "Fees & Comm", "Amount"]
        assert detect_format(headers) == "schwab"

    def test_ibkr_signature(self):
        headers = ["Symbol", "DateTime", "Quantity", "TradePrice",
                   "IBCommission"]
        assert detect_format(headers) == "ibkr"

    def test_etrade_signature(self):
        headers = ["TransactionDate", "TransactionType", "SecurityType",
                   "Symbol", "Quantity", "Amount"]
        assert detect_format(headers) == "etrade"

    def test_unknown_format(self):
        headers = ["Foo", "Bar", "Baz"]
        assert detect_format(headers) == "unknown"

    def test_empty_headers(self):
        assert detect_format([]) == "unknown"


# ══ Pre-matched parser ═══════════════════════════════════════════════════════

PREMATCHED_HAPPY = b"""symbol,side,shares,entry_price,entry_date,exit_price,exit_date,setup,notes
NVDA,Long,100,500,2026-04-01,520,2026-04-02,VCP,
AAPL,Long,50,190.50,2026-04-01,195.25,2026-04-02,Breakout,scaled out
TSLA,Short,10,250,2026-04-01,240,2026-04-03,,
"""


class TestPreMatched:
    def test_happy_path(self):
        result = parse_csv(PREMATCHED_HAPPY)
        assert result.format == "pre_matched"
        assert len(result.trades) == 3
        assert result.errors == []

    def test_trade_shape(self):
        result = parse_csv(PREMATCHED_HAPPY)
        t = result.trades[0]
        assert t["symbol"] == "NVDA"
        assert t["side"] == "Long"
        assert t["shares"] == 100.0
        assert t["entryPrice"] == 500.0
        assert t["entryDate"] == "2026-04-01T00:00:00Z"
        assert t["exitPrice"] == 520.0
        assert t["exitDate"] == "2026-04-02T00:00:00Z"
        assert t["setup"] == "VCP"
        assert t["notes"] is None  # empty string in CSV → None
        assert t["originalStop"] is None

    def test_short_side_accepted(self):
        result = parse_csv(PREMATCHED_HAPPY)
        short = next(t for t in result.trades if t["symbol"] == "TSLA")
        assert short["side"] == "Short"

    def test_empty_rows_skipped(self):
        csv = b"""symbol,side,shares,entry_price,entry_date,exit_price,exit_date
NVDA,Long,100,500,2026-04-01,520,2026-04-02
,,,,,,
AAPL,Long,50,190,2026-04-01,195,2026-04-02
"""
        result = parse_csv(csv)
        assert len(result.trades) == 2
        assert result.errors == []

    def test_missing_required_field_becomes_error(self):
        csv = b"""symbol,side,shares,entry_price,entry_date,exit_price,exit_date
NVDA,Long,100,500,2026-04-01,520,2026-04-02
,Long,50,190,2026-04-01,195,2026-04-02
"""
        result = parse_csv(csv)
        assert len(result.trades) == 1  # second row skipped
        assert len(result.errors) == 1
        assert result.errors[0].row == 3
        assert "symbol is required" in result.errors[0].message

    def test_invalid_side_becomes_error(self):
        csv = b"""symbol,side,shares,entry_price,entry_date,exit_price,exit_date
NVDA,Sideways,100,500,2026-04-01,520,2026-04-02
"""
        result = parse_csv(csv)
        assert len(result.trades) == 0
        assert len(result.errors) == 1
        assert "must be Long or Short" in result.errors[0].message

    def test_non_iso_date_rejected(self):
        csv = b"""symbol,side,shares,entry_price,entry_date,exit_price,exit_date
NVDA,Long,100,500,04/01/2026,520,2026-04-02
"""
        result = parse_csv(csv)
        assert len(result.trades) == 0
        assert any("ISO date" in e.message for e in result.errors)

    def test_exit_before_entry_rejected(self):
        csv = b"""symbol,side,shares,entry_price,entry_date,exit_price,exit_date
NVDA,Long,100,500,2026-04-05,520,2026-04-01
"""
        result = parse_csv(csv)
        assert any("cannot be before" in e.message for e in result.errors)

    def test_negative_shares_rejected(self):
        csv = b"""symbol,side,shares,entry_price,entry_date,exit_price,exit_date
NVDA,Long,-100,500,2026-04-01,520,2026-04-02
"""
        result = parse_csv(csv)
        assert any("shares must be > 0" in e.message for e in result.errors)

    def test_with_original_stop(self):
        csv = b"""symbol,side,shares,entry_price,entry_date,exit_price,exit_date,original_stop
NVDA,Long,100,500,2026-04-01,520,2026-04-02,490
"""
        result = parse_csv(csv)
        assert result.trades[0]["originalStop"] == 490.0

    def test_dollar_signs_in_prices_tolerated(self):
        csv = b"""symbol,side,shares,entry_price,entry_date,exit_price,exit_date
NVDA,Long,100,$500.00,2026-04-01,"$1,520.50",2026-04-02
"""
        result = parse_csv(csv)
        assert result.trades[0]["entryPrice"] == 500.00
        assert result.trades[0]["exitPrice"] == 1520.50


# ══ File size + empty ════════════════════════════════════════════════════════

class TestEntrypointLimits:
    def test_empty_file_raises(self):
        with pytest.raises(ValueError):
            parse_csv(b"")

    def test_oversize_file_raises(self):
        big = b"x" * (11 * 1024 * 1024)
        with pytest.raises(ValueError):
            parse_csv(big)


# ══ Unknown format ═══════════════════════════════════════════════════════════

class TestUnknownFormat:
    def test_returns_unknown_with_preview(self):
        csv = b"""foo,bar,baz
1,2,3
4,5,6
"""
        result = parse_csv(csv)
        assert result.format == "unknown"
        assert result.headers == ["foo", "bar", "baz"]
        assert len(result.raw_rows) == 2
        assert len(result.warnings) > 0


# ══ Sanitization applied end-to-end ══════════════════════════════════════════

class TestEndToEndSanitization:
    def test_formula_injection_blocked_in_preview(self):
        csv = b"""symbol,side,shares,entry_price,entry_date,exit_price,exit_date,notes
=CMD(),Long,100,500,2026-04-01,520,2026-04-02,=HACK()
"""
        result = parse_csv(csv)
        # The symbol got sanitized → no longer starts with '=', but the
        # prefix + original text is now "'=CMD()" which isn't a valid
        # symbol after the parser's upper() but IS stored. Important: the
        # parser normalizes the already-sanitized symbol and checks it's
        # non-empty; it will pass a non-empty check.
        # More importantly: if this ever lands in a downstream CSV export,
        # it won't trigger a formula in a user's spreadsheet.
        assert len(result.trades) == 1
        # The notes field retains the sanitized prefix
        assert result.trades[0]["notes"].startswith("'=")


# ══ bulk_insert_trades integration ═══════════════════════════════════════════

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


class TestBulkInsert:
    SETTINGS = {
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
    }

    def test_bulk_insert_happy_path(self, db_conn):
        from api.services.journal_two import trades as svc
        result = parse_csv(PREMATCHED_HAPPY)
        out = svc.bulk_insert_trades("u1", result.trades, self.SETTINGS, conn=db_conn)
        assert out["imported"] == 3

        got = svc.list_trades_for_user("u1", conn=db_conn)
        assert len(got) == 3
        symbols = {t["symbol"] for t in got}
        assert symbols == {"NVDA", "AAPL", "TSLA"}

    def test_bulk_insert_uses_manual_position_id_sentinel(self, db_conn):
        from api.services.journal_two import trades as svc
        result = parse_csv(PREMATCHED_HAPPY)
        svc.bulk_insert_trades("u1", result.trades, self.SETTINGS, conn=db_conn)

        got = svc.list_trades_for_user("u1", conn=db_conn)
        for t in got:
            assert t["positionId"].startswith("manual-")

    def test_bulk_insert_computes_derived_from_current_settings(self, db_conn):
        from api.services.journal_two import trades as svc
        settings_be = {
            "breakevenRange": {"enabled": True, "unit": "$", "value": 100_000},
        }
        # Huge BE threshold → every tiny-P&L trade classified as BE
        result = parse_csv(PREMATCHED_HAPPY)
        svc.bulk_insert_trades("u1", result.trades, settings_be, conn=db_conn)

        got = svc.list_trades_for_user("u1", conn=db_conn)
        assert all(t["result"] == "BE" for t in got)

    def test_bulk_insert_originalStop_defaults_to_entry_when_missing(self, db_conn):
        from api.services.journal_two import trades as svc
        result = parse_csv(PREMATCHED_HAPPY)  # originalStop not provided
        svc.bulk_insert_trades("u1", result.trades, self.SETTINGS, conn=db_conn)
        got = svc.list_trades_for_user("u1", conn=db_conn)
        for t in got:
            assert t["originalStop"] == t["entryPrice"]
            assert t["rMultiple"] is None  # entry == stop → null per §14.5

    def test_bulk_insert_empty_list_is_noop(self, db_conn):
        from api.services.journal_two import trades as svc
        out = svc.bulk_insert_trades("u1", [], self.SETTINGS, conn=db_conn)
        assert out["imported"] == 0

    def test_bulk_insert_rolls_back_on_error(self, db_conn):
        """If any insert fails, the whole batch rolls back."""
        from api.services.journal_two import trades as svc
        # Inject a broken trade (bad side → CHECK constraint violation)
        broken = [
            {
                "symbol": "NVDA", "side": "Long", "shares": 100,
                "entryPrice": 500, "entryDate": "2026-04-01T00:00:00Z",
                "exitPrice": 520, "exitDate": "2026-04-02T00:00:00Z",
                "originalStop": None, "setup": None, "notes": None,
            },
            {
                "symbol": "AAPL", "side": "WRONG", "shares": 50,  # bad side
                "entryPrice": 190, "entryDate": "2026-04-01T00:00:00Z",
                "exitPrice": 195, "exitDate": "2026-04-02T00:00:00Z",
                "originalStop": None, "setup": None, "notes": None,
            },
        ]
        with pytest.raises(Exception):
            svc.bulk_insert_trades("u1", broken, self.SETTINGS, conn=db_conn)

        # Neither row landed
        got = svc.list_trades_for_user("u1", conn=db_conn)
        assert len(got) == 0


# ══ FIFO reconstruction ══════════════════════════════════════════════════════

class TestFIFO:
    def _run(self, fills):
        from api.services.journal_two.fifo import reconstruct_trades
        return reconstruct_trades(fills)

    def _fill(self, **kw):
        from api.services.journal_two.fifo import Fill
        defaults = dict(row=1, symbol="NVDA", action="Buy", shares=100,
                        price=500, date="2026-04-01T00:00:00Z")
        defaults.update(kw)
        return Fill(**defaults)

    def test_single_round_trip(self):
        fills = [
            self._fill(row=2, action="Buy", shares=100, price=500, date="2026-04-01T00:00:00Z"),
            self._fill(row=3, action="Sell", shares=100, price=520, date="2026-04-03T00:00:00Z"),
        ]
        out = self._run(fills)
        assert out["errors"] == []
        assert len(out["trades"]) == 1
        t = out["trades"][0]
        assert t["shares"] == 100
        assert t["entryPrice"] == 500
        assert t["exitPrice"] == 520
        assert t["entryDate"] == "2026-04-01T00:00:00Z"
        assert t["exitDate"] == "2026-04-03T00:00:00Z"
        assert t["side"] == "Long"

    def test_scale_in_then_single_sell_produces_one_trade_with_vwap(self):
        # Buy 100@10, buy 50@11, sell 150@15 → one trade, VWAP = (1000+550)/150 = 10.33
        fills = [
            self._fill(row=2, action="Buy", shares=100, price=10, date="2026-04-01T00:00:00Z"),
            self._fill(row=3, action="Buy", shares=50, price=11, date="2026-04-02T00:00:00Z"),
            self._fill(row=4, action="Sell", shares=150, price=15, date="2026-04-03T00:00:00Z"),
        ]
        out = self._run(fills)
        assert out["errors"] == []
        assert len(out["trades"]) == 1
        t = out["trades"][0]
        assert t["shares"] == 150
        assert t["entryPrice"] == pytest.approx(10.33, abs=0.01)
        assert t["entryDate"] == "2026-04-01T00:00:00Z"  # earliest
        assert t["exitDate"] == "2026-04-03T00:00:00Z"

    def test_scale_out_produces_multiple_trades(self):
        # Buy 100@10, sell 50@15, sell 50@20 → two trades
        fills = [
            self._fill(row=2, action="Buy", shares=100, price=10, date="2026-04-01T00:00:00Z"),
            self._fill(row=3, action="Sell", shares=50, price=15, date="2026-04-02T00:00:00Z"),
            self._fill(row=4, action="Sell", shares=50, price=20, date="2026-04-03T00:00:00Z"),
        ]
        out = self._run(fills)
        assert out["errors"] == []
        assert len(out["trades"]) == 2
        # First trade: 50 @ 10 → 50 @ 15
        assert out["trades"][0]["shares"] == 50
        assert out["trades"][0]["entryPrice"] == 10
        assert out["trades"][0]["exitPrice"] == 15
        # Second trade: 50 @ 10 → 50 @ 20
        assert out["trades"][1]["shares"] == 50
        assert out["trades"][1]["entryPrice"] == 10
        assert out["trades"][1]["exitPrice"] == 20

    def test_multiple_symbols_independent(self):
        fills = [
            self._fill(row=2, symbol="NVDA", action="Buy", shares=100, price=500, date="2026-04-01T00:00:00Z"),
            self._fill(row=3, symbol="AAPL", action="Buy", shares=50, price=190, date="2026-04-01T00:00:00Z"),
            self._fill(row=4, symbol="NVDA", action="Sell", shares=100, price=520, date="2026-04-02T00:00:00Z"),
            self._fill(row=5, symbol="AAPL", action="Sell", shares=50, price=195, date="2026-04-03T00:00:00Z"),
        ]
        out = self._run(fills)
        assert len(out["trades"]) == 2
        symbols = {t["symbol"] for t in out["trades"]}
        assert symbols == {"NVDA", "AAPL"}

    def test_sell_without_prior_buy_is_short_error(self):
        fills = [
            self._fill(row=2, action="Sell", shares=100, price=500, date="2026-04-01T00:00:00Z"),
        ]
        out = self._run(fills)
        assert len(out["trades"]) == 0
        assert len(out["errors"]) == 1
        assert "short-sell not supported" in out["errors"][0]["message"]

    def test_oversell_flagged_as_error(self):
        # Buy 100, sell 150 → oversell (100 filled + 50 would be short)
        fills = [
            self._fill(row=2, action="Buy", shares=100, price=10, date="2026-04-01T00:00:00Z"),
            self._fill(row=3, action="Sell", shares=150, price=15, date="2026-04-02T00:00:00Z"),
        ]
        out = self._run(fills)
        # Either the partial fill emits a trade and the residual is an error,
        # OR the whole sell is rejected. Our implementation: reject the
        # sell entirely if it would go short. So NO trades, 1 error.
        assert len(out["trades"]) == 0
        assert len(out["errors"]) == 1
        assert "exceeds held" in out["errors"][0]["message"]

    def test_open_position_emits_no_trade(self):
        """Buy with no sell — still-open position; no Trade row."""
        fills = [
            self._fill(row=2, action="Buy", shares=100, price=500, date="2026-04-01T00:00:00Z"),
        ]
        out = self._run(fills)
        assert out["trades"] == []
        assert out["errors"] == []

    def test_chronological_order_enforced_regardless_of_csv_row_order(self):
        # User CSV has sell before buy in row order, but sell's date is later
        fills = [
            self._fill(row=2, action="Sell", shares=100, price=520, date="2026-04-03T00:00:00Z"),
            self._fill(row=3, action="Buy", shares=100, price=500, date="2026-04-01T00:00:00Z"),
        ]
        out = self._run(fills)
        # After sorting by date: Buy first (04-01), then Sell (04-03) → 1 trade
        assert len(out["trades"]) == 1
        assert out["errors"] == []


# ══ Broker adapters (signature + happy path) ═════════════════════════════════

SCHWAB_SAMPLE = b"""Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount
04/01/2026,Buy,NVDA,NVIDIA CORP,100,$500.00,$0.65,-$50000.65
04/02/2026,Reinvest Dividend,NVDA,NVIDIA CORP,0.5,$505.00,$0.00,$0.00
04/03/2026,Sell,NVDA,NVIDIA CORP,100,$520.00,$0.65,$51999.35
"""


class TestSchwab:
    def test_detects_schwab(self):
        result = parse_csv(SCHWAB_SAMPLE)
        assert result.format == "schwab"

    def test_schwab_single_round_trip(self):
        result = parse_csv(SCHWAB_SAMPLE)
        assert len(result.trades) == 1
        t = result.trades[0]
        assert t["symbol"] == "NVDA"
        assert t["shares"] == 100
        assert t["entryPrice"] == 500
        assert t["exitPrice"] == 520
        # Dividend row silently ignored

    def test_schwab_ignores_non_trade_actions(self):
        # Only the dividend row — should produce no trades and no errors
        dividend_only = b"""Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount
04/02/2026,Reinvest Dividend,NVDA,NVIDIA CORP,0.5,$505.00,$0.00,$0.00
"""
        result = parse_csv(dividend_only)
        assert result.trades == []
        assert result.errors == []


ETRADE_SAMPLE = b"""TransactionDate,TransactionType,SecurityType,Symbol,Quantity,Amount,Price
04/01/2026,Bought,EQ,NVDA,100,-50000,500.00
04/03/2026,Sold,EQ,NVDA,-100,52000,520.00
04/05/2026,Dividend,EQ,NVDA,0,25.00,0
"""


class TestEtrade:
    def test_detects_etrade(self):
        result = parse_csv(ETRADE_SAMPLE)
        assert result.format == "etrade"

    def test_etrade_single_round_trip(self):
        result = parse_csv(ETRADE_SAMPLE)
        assert len(result.trades) == 1
        t = result.trades[0]
        assert t["symbol"] == "NVDA"
        assert t["shares"] == 100
        assert t["entryPrice"] == 500
        assert t["exitPrice"] == 520


IBKR_SAMPLE = b"""Symbol,DateTime,Quantity,TradePrice,IBCommission,AssetClass
NVDA,2026-04-01 09:35:15,100,500.00,-0.35,STK
NVDA,2026-04-03 15:58:42,-100,520.00,-0.35,STK
"""


class TestIbkr:
    def test_detects_ibkr(self):
        result = parse_csv(IBKR_SAMPLE)
        assert result.format == "ibkr"

    def test_ibkr_signed_quantity_mapping(self):
        result = parse_csv(IBKR_SAMPLE)
        assert len(result.trades) == 1
        t = result.trades[0]
        assert t["symbol"] == "NVDA"
        assert t["shares"] == 100
        assert t["side"] == "Long"

    def test_ibkr_skips_non_stock_asset_classes(self):
        ibkr_options = b"""Symbol,DateTime,Quantity,TradePrice,IBCommission,AssetClass
SPY250620C450,2026-04-01 09:30:00,1,2.50,-0.65,OPT
"""
        result = parse_csv(ibkr_options)
        # Option row filtered; no buys → no trades, no errors
        assert result.trades == []


# ══ Column-mapping wizard ════════════════════════════════════════════════════

class TestMapping:
    def test_translates_arbitrary_columns_to_pre_matched(self):
        from api.services.journal_two.csv_import import parse_with_mapping

        headers = ["Ticker", "Direction", "Count", "Buy", "BuyDate",
                   "Sell", "SellDate"]
        rows = [
            ["NVDA", "Long", "100", "500", "2026-04-01",
             "520", "2026-04-02"],
        ]
        mapping = {
            "symbol": "Ticker",
            "side": "Direction",
            "shares": "Count",
            "entry_price": "Buy",
            "entry_date": "BuyDate",
            "exit_price": "Sell",
            "exit_date": "SellDate",
        }
        result = parse_with_mapping(headers, rows, mapping)
        assert result.format == "mapped"
        assert len(result.trades) == 1
        assert result.trades[0]["symbol"] == "NVDA"

    def test_missing_required_fields_rejected(self):
        from api.services.journal_two.csv_import import parse_with_mapping

        headers = ["A", "B"]
        mapping = {"symbol": "A"}  # missing required fields
        result = parse_with_mapping(headers, [], mapping)
        assert len(result.errors) > 0
        assert "missing required fields" in result.errors[0].message

"""Tests for the SnapTrade activity adapter — classification, equity-fill
conversion, symbol normalization, option-event normalization, and batch
partitioning. Uses representative activity fixtures."""

from __future__ import annotations

from api.services.journal_two.broker import snaptrade_adapter as ad


def _equity(typ, ticker="AAPL", units=10, price=100.0, date="2026-04-01", aid="a1"):
    return {"id": aid, "type": typ, "units": units, "price": price, "fee": 1.0,
            "currency": {"code": "USD"}, "symbol": {"symbol": ticker},
            "trade_date": date}


def _option(option_type, underlying="AAPL", strike=200, cp="CALL", units=2,
            price=3.5, date="2026-04-01", aid="o1", typ="BUY"):
    return {
        "id": aid, "type": typ, "option_type": option_type, "units": units,
        "price": price, "fee": 0.65, "currency": "USD", "trade_date": date,
        "option_symbol": {
            "underlying_symbol": {"symbol": underlying},
            "strike_price": strike, "expiration_date": f"2026-06-19",
            "option_type": cp,
        },
    }


# ── symbol normalization ─────────────────────────────────────────────────────

def test_normalize_symbol_class_share():
    assert ad.normalize_symbol("brk.b") == "BRK-B"
    assert ad.normalize_symbol("BF.B") == "BF-B"
    assert ad.normalize_symbol("aapl") == "AAPL"
    assert ad.normalize_symbol(" msft ") == "MSFT"
    assert ad.normalize_symbol("") is None


def test_normalize_date_variants():
    assert ad.normalize_date({"trade_date": "2026-04-01"}) == "2026-04-01T00:00:00Z"
    assert ad.normalize_date({"trade_date": "2026-04-01T13:30:00Z"}) == "2026-04-01T13:30:00Z"
    assert ad.normalize_date({"trade_date": "2026-04-01T13:30:00"}) == "2026-04-01T13:30:00Z"
    assert ad.normalize_date({"settlement_date": "2026-04-03"}) == "2026-04-03T00:00:00Z"
    assert ad.normalize_date({}) is None


# ── classification ───────────────────────────────────────────────────────────

def test_classify_buckets():
    assert ad.classify(_equity("BUY")) == "equity_trade"
    assert ad.classify(_equity("SELL")) == "equity_trade"
    assert ad.classify(_option("BUY_TO_OPEN")) == "option_trade"
    assert ad.classify({"type": "OPTIONEXPIRATION", "option_symbol": {}}) == "option_expiration"
    assert ad.classify({"type": "OPTIONASSIGNMENT"}) == "option_assignment"
    assert ad.classify({"type": "DIVIDEND"}) == "cash"
    assert ad.classify({"type": "INTEREST"}) == "cash"
    assert ad.classify({"type": "INTERNAL_ASSET_TRANSFER_IN"}) == "transfer"
    assert ad.classify({"type": "WEIRD"}) == "unknown"


# ── equity fills ─────────────────────────────────────────────────────────────

def test_to_equity_fill_buy_sell():
    f = ad.to_equity_fill(_equity("BUY", units=10, price=100), 5)
    assert f.action == "Buy" and f.shares == 10 and f.price == 100
    assert f.symbol == "AAPL" and f.row == 5 and f.date == "2026-04-01T00:00:00Z"
    s = ad.to_equity_fill(_equity("SELL", units=10, price=110), 6)
    assert s.action == "Sell"


def test_to_equity_fill_abs_units():
    f = ad.to_equity_fill(_equity("SELL", units=-10, price=110), 1)
    assert f.shares == 10  # sign comes from type, magnitude from abs(units)


def test_to_equity_fill_missing_fields_returns_none():
    assert ad.to_equity_fill(_equity("BUY", price=0), 1) is None      # bad price
    assert ad.to_equity_fill({"type": "BUY", "units": 5}, 1) is None  # no symbol/price/date
    assert ad.to_equity_fill(_equity("DIVIDEND"), 1) is None          # not a trade


def test_bare_string_symbol():
    act = {"id": "x", "type": "BUY", "units": 1, "price": 5, "symbol": "tsla", "trade_date": "2026-04-01"}
    f = ad.to_equity_fill(act, 1)
    assert f.symbol == "TSLA"


# ── option events ────────────────────────────────────────────────────────────

def test_option_trade_open():
    ev = ad.to_option_event(_option("BUY_TO_OPEN", strike=200, cp="CALL", units=2, price=3.5), 3)
    assert ev["eventKind"] == "option_trade"
    assert ev["side"] == "buy" and ev["openClose"] == "open"
    assert ev["underlying"] == "AAPL" and ev["strike"] == 200
    assert ev["contractType"] == "call" and ev["contracts"] == 2
    assert ev["expiration"] == "2026-06-19"


def test_option_trade_sell_to_close():
    ev = ad.to_option_event(_option("SELL_TO_CLOSE", cp="PUT"), 1)
    assert ev["side"] == "sell" and ev["openClose"] == "close"
    assert ev["contractType"] == "put"


def test_option_expiration_event():
    act = {"id": "e1", "type": "OPTIONEXPIRATION", "units": 1, "trade_date": "2026-06-19",
           "option_symbol": {"underlying_symbol": {"symbol": "AAPL"}, "strike_price": 200,
                             "expiration_date": "2026-06-19", "option_type": "CALL"}}
    ev = ad.to_option_event(act, 1)
    assert ev["eventKind"] == "option_expiration"
    assert ev["side"] is None and ev["openClose"] is None


# ── partition ────────────────────────────────────────────────────────────────

def test_partition_mixed_batch():
    acts = [
        _equity("BUY", aid="e1"),
        _equity("SELL", aid="e2"),
        _option("BUY_TO_OPEN", aid="o1"),
        {"type": "DIVIDEND", "id": "d1"},
        {"type": "INTERNAL_ASSET_TRANSFER_IN", "id": "t1"},
        {"type": "BUY", "id": "bad"},  # missing fields → skipped
        "not-an-object",
    ]
    out = ad.partition(acts)
    assert len(out["equity_fills"]) == 2
    assert len(out["option_events"]) == 1
    assert len(out["cash"]) == 1
    assert len(out["transfers"]) == 1
    assert len(out["skipped"]) == 2  # the bad BUY + the non-object


# ── Share adjustments (SPLIT / JRNLSEC / share TRANSFER) ────────────────────

def _special(typ, ticker="FIVN", units=None, price=None, date="2026-04-01", aid="s1"):
    act = {"id": aid, "type": typ, "trade_date": date,
           "symbol": {"symbol": ticker}}
    if units is not None:
        act["units"] = units
    if price is not None:
        act["price"] = price
    return act


def test_classify_share_adjustment_types():
    assert ad.classify(_special("SPLIT", units=900)) == "share_adjustment"
    assert ad.classify(_special("JRNLSEC", units=-2000)) == "share_adjustment"
    assert ad.classify(_special("TRANSFER", units=2000)) == "transfer"


def test_to_share_adjustment_split():
    adj = ad.to_share_adjustment(_special("SPLIT", units=900), 3)
    assert adj["kind"] == "split" and adj["delta"] == 900
    assert adj["symbol"] == "FIVN" and adj["price"] is None


def test_to_share_adjustment_transfer_with_price():
    adj = ad.to_share_adjustment(_special("JRNLSEC", units=2000, price=21.5), 4)
    assert adj["kind"] == "transfer" and adj["delta"] == 2000 and adj["price"] == 21.5


def test_to_share_adjustment_rejects_cash_and_options():
    assert ad.to_share_adjustment(_special("TRANSFER"), 1) is None  # no units
    act = _special("JRNLSEC", units=1)
    act["option_symbol"] = {"ticker": "X"}
    assert ad.to_share_adjustment(act, 1) is None


def test_partition_share_adjustments_bucket():
    acts = [
        _special("SPLIT", units=900, aid="p1"),
        _special("JRNLSEC", units=-2000, aid="p2"),
        _special("TRANSFER", units=2000, price=21.0, aid="p3"),
        _special("TRANSFER", aid="p4"),  # cash transfer — no units
    ]
    part = ad.partition(acts)
    assert len(part["share_adjustments"]) == 3
    # Share-bearing TRANSFER stays in the cash-flow bucket too.
    assert len(part["transfers"]) == 2
    assert part["skipped"] == []


def test_sweeps_are_cash_not_unknown():
    for typ in ("SWEEP_IN", "SWEEP_OUT"):
        assert ad.classify({"type": typ, "amount": 5.0}) == "cash"

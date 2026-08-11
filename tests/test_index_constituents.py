"""Rails for the 'UCT Index Components' prebuilt section + the breadth de-prefix."""
from api.services import index_constituents as ic
from api.services import watchlist_prebuilt as wp


def test_us_ticker_filter_keeps_class_shares_drops_foreign_and_blank():
    for good in ("NVDA", "BRK-B", "MOG-A", "A"):
        assert ic._looks_us(good), good
    for bad in ("BIPC.TO", "0VAG.L", "RIGN.SW", "", "TOOLONGX", "1ABC"):
        assert not ic._looks_us(bad), bad


def test_fetch_one_reads_the_right_field_and_filters(monkeypatch):
    # Constituent endpoints carry the ticker in `symbol`.
    monkeypatch.setattr(ic, "_get", lambda url: [{"symbol": "AAPL"}, {"symbol": "BRK-B"}, {"symbol": ""}])
    assert ic._fetch_one("constituent", "/stable/sp500-constituent", "k") == ["AAPL", "BRK-B"]
    # ETF holdings carry the ETF in `symbol` and the HOLDING in `asset` (+ dedup + foreign drop).
    monkeypatch.setattr(ic, "_get", lambda url: [
        {"asset": "MSFT", "symbol": "IWM"}, {"asset": "BIPC.TO"}, {"asset": "MSFT"},
    ])
    assert ic._fetch_one("holdings", "IWM", "k") == ["MSFT"]


def test_fetch_index_lists_drops_below_floor(monkeypatch):
    # Dow 30 floor is 25 — a 2-row response must be omitted (never a truncated list).
    monkeypatch.setattr(ic, "_fetch_one", lambda kind, source, key: ["AAA", "BBB"])
    out = ic.fetch_index_lists("k")
    assert "Dow 30" not in out and "S&P 500" not in out


def test_category_order_places_index_between_etf_and_breadth():
    order = wp.category_order()
    assert order.index("UCT ETF Lists") < order.index("UCT Index Components") < order.index("UCT Breadth Indicators")


def test_index_section_is_seeded_in_the_committed_config():
    names = {l["name"] for l in wp._load_committed() if l["category"] == "UCT Index Components"}
    assert {"S&P 500", "Nasdaq 100", "Dow 30", "Russell 2000",
            "S&P 100", "S&P MidCap 400", "S&P SmallCap 600"} <= names


def test_overlay_replaces_index_membership_and_prunes_delisted(monkeypatch):
    monkeypatch.setattr(wp, "_read_overlay", lambda: {
        "index_constituents": {"dow 30": ["AAA", "BBB", "DEAD"]},
        "delisted": ["DEAD"],
    })
    lists = [{"name": "Dow 30", "desc": "", "category": "UCT Index Components", "tickers": ["OLD1", "OLD2"]}]
    out = wp._apply_overlay(lists)
    assert out[0]["tickers"] == ["AAA", "BBB"]  # replaced from overlay, delisted pruned


def test_breadth_lists_dropped_the_uct_prefix():
    names = [l["name"] for l in wp._breadth_lists()]
    assert names and all(not n.startswith("UCT ") for n in names)
    assert "MA Breadth" in names and "Highs & Lows" in names

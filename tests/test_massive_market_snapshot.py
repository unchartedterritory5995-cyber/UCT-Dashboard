"""`get_full_market_snapshot`'s parse contract.

⚠️ THIS FILE EXISTS BECAUSE THE PARSER HAD NO DIRECT TEST. It was covered only
indirectly, through the five scan suites that consume it — which means a change
to what it EMITS was only ever caught if a consumer happened to read the field
that broke. The day-OHL widening for the screener's live candle made that gap
worth closing rather than widening.
"""
from api.services import massive


def _client():
    c = massive._MassiveRestClient.__new__(massive._MassiveRestClient)
    c._api_key = "test"
    return c


def _payload(**day):
    d = {"o": 10.0, "h": 12.0, "l": 9.5, "c": 11.0, "v": 500_000}
    d.update(day)
    return {"tickers": [{
        "ticker": "AAA",
        "day": d,
        "prevDay": {"c": 10.5, "v": 900_000},
        "lastTrade": {"p": 11.25},
    }]}


def _snap(monkeypatch, payload):
    c = _client()
    monkeypatch.setattr(c, "_get", lambda url: payload)
    return c.get_full_market_snapshot()


def test_the_day_ohl_is_emitted(monkeypatch):
    """⭐ THE FIELDS WERE ALWAYS IN THE PAYLOAD. This parse read `day.c` and
    `day.v` and threw `o`, `h` and `l` away — three keys short of a candle, on a
    response the pod already fetches for the whole market every ~30s."""
    out = _snap(monkeypatch, _payload())["AAA"]
    assert out["day_open"] == 10.0
    assert out["day_high"] == 12.0
    assert out["day_low"] == 9.5
    # and the fields it always emitted are untouched
    assert out["last_price"] == 11.25
    assert out["prev_close"] == 10.5
    assert out["today_vol"] == 500_000
    assert out["prev_vol"] == 900_000


def test_a_session_that_has_not_printed_yields_None_not_zero(monkeypatch):
    """⛔ `or None`, NEVER `or 0.0`. The provider emits 0 before a regular
    session prints. A 0 here would read as a real price of zero — it sorts, it
    filters, and every candle fraction derived from it would be nonsense
    (body/range on a 0-high bar is not small, it is undefined)."""
    out = _snap(monkeypatch, _payload(o=0, h=0, l=0))["AAA"]
    for f in ("day_open", "day_high", "day_low"):
        assert out[f] is None, f


def test_a_missing_day_object_is_absent_not_zero(monkeypatch):
    payload = {"tickers": [{"ticker": "AAA", "prevDay": {"c": 10.5, "v": 900},
                            "lastTrade": {"p": 11.25}}]}
    out = _snap(monkeypatch, payload)["AAA"]
    for f in ("day_open", "day_high", "day_low"):
        assert out[f] is None, f


def test_a_junk_value_is_refused_rather_than_coerced(monkeypatch):
    out = _snap(monkeypatch, _payload(o="n/a", h=None, l=-3.0))["AAA"]
    for f in ("day_open", "day_high", "day_low"):
        assert out[f] is None, f


def test_a_provider_failure_is_an_empty_market_not_a_partial_one(monkeypatch):
    c = _client()

    def _boom(url):
        raise RuntimeError("provider down")

    monkeypatch.setattr(c, "_get", _boom)
    assert c.get_full_market_snapshot() == {}


def test_a_ticker_with_no_symbol_is_skipped(monkeypatch):
    payload = {"tickers": [{"ticker": "", "day": {"c": 1.0}},
                           {"ticker": "AAA", "day": {"o": 1.0, "h": 2.0,
                                                     "l": 0.5, "c": 1.5,
                                                     "v": 10},
                            "prevDay": {"c": 1.0, "v": 20},
                            "lastTrade": {"p": 1.5}}]}
    out = _snap(monkeypatch, payload)
    assert set(out) == {"AAA"}


def test_every_consumer_of_this_parse_gets_the_same_key_set(monkeypatch):
    """⛔ The screener live tier reads `day_low`; the scan family reads
    `last_price`/`prev_close`/`today_vol`/`prev_vol`. One parse serves both, so
    a key silently dropped here breaks a caller that never mentions this file."""
    out = _snap(monkeypatch, _payload())["AAA"]
    assert set(out) == {"last_price", "prev_close", "today_vol", "prev_vol",
                        "day_open", "day_high", "day_low"}

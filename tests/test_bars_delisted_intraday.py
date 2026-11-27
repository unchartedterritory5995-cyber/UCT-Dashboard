"""A delisted name's intraday chart says "no data". It does not answer an empty chart that looks live.

MEASURED ON PRODUCTION 2026-11-27: CPRX (Catalyst Pharmaceuticals, acquired by Angelini Pharma, last
trade 2026-07-14, listed in `api/data/delisted_tickers_bulk.json` with delisted_date 2026-07-16)
answered every intraday timeframe (1/5/15/30/60) with **200 `{"bars": []}`**: no `no_data`, no
reason, `Server-Timing: bars;desc="entry"`, every rev null. D served 2,000 frozen rows.

The empty answer is not a cache entry. `desc="entry"` is the label `_serve_bars_impl` RESETS at
entry; the delisted branch (`bars_fetch._get_delisted_bars_response`) never marks a layer, so the
reset label is what the header reports, and the phase sub-metrics after it (`get_bars;dur=39.3`...)
were the PREVIOUS request's on that worker thread (`_time_reset` ran only inside `_get_bars_inner`).
Both together read like "an empty answer served from an in-memory entry cache" and are neither.

The defect is the shape: the delisted branch returns a bare empty list for every intraday tf, so
the client cannot tell "this entity has no intraday series" from "a live chart with nothing yet",
and paints a blank chart. The honest shape already exists (`routers/bars._no_data_response`):
200, an empty list, `no_data: true`, and the reason.

⚠️ EVERY CASE DRIVES THE REAL `serve_bars` HANDLER, with only the registry lookup and the store
planted, so the rail goes red if the branch, its label, or the entry reset is removed.
"""
import orjson
import pytest

from api.routers import bars
from api.services import bars_fetch, delisted_registry

_CPRX = {"ticker": "CPRX", "provider_symbol": "CPRX", "name": "Catalyst Pharmaceutical  Inc.",
         "delisted_date": "2026-07-16", "last_date": "2026-07-16"}


@pytest.fixture(autouse=True)
def cprx_is_delisted(monkeypatch):
    monkeypatch.setattr(delisted_registry, "resolve",
                        lambda s: dict(_CPRX) if (s or "").strip().upper() == "CPRX" else None)
    # A provider call here would be a test talking to the network: fail loudly instead.
    import api.services.massive as _massive

    def _no_network(*a, **k):
        raise AssertionError("the delisted intraday branch must not ask the provider")
    monkeypatch.setattr(_massive, "get_agg_bars", _no_network)
    # Each test starts with an empty process cache for the delisted keys it touches.
    bars_fetch.cache.delete_prefix("delisted_bars_CPRX_")
    yield
    bars_fetch.cache.delete_prefix("delisted_bars_CPRX_")


def _body(resp):
    return orjson.loads(resp.body)


def _plant_stale_marks():
    """What the PREVIOUS request on this worker thread left behind (a live `_get_bars_inner`)."""
    bars_fetch._time_reset()
    bars_fetch._time_ck("get_bars")
    bars_fetch._time_ck("live_cov")
    bars_fetch._mark_serve("sqlite")


@pytest.mark.parametrize("tf", ["1", "5", "15", "30", "60"])
def test_a_DELISTED_intraday_ask_answers_no_data_not_a_bare_empty_chart(tf):
    r = bars.serve_bars("CPRX", tf=tf, bars=200, since="", to="")
    assert r.status_code == 200
    body = _body(r)
    assert body["bars"] == [], "never a fabricated intraday series for a dead entity"
    assert body.get("no_data") is True, (
        f"tf={tf}: a bare empty list is a blank chart that looks live; the client only stops "
        f"and says 'no data' on `no_data: true` (barStore/network.js). body={body}")
    assert body.get("reason") == "delisted", body
    assert r.headers.get("Retry-After") is None, "an answer that will never change must not ask for a retry"


def test_the_ETH_hourly_grid_carries_the_same_no_data():
    """tf=60 session=eth is derived from the 15m serve (`_serve_eth_hourly`): the flag must survive it."""
    r = bars.serve_bars("CPRX", tf="60", bars=200, since="", to="", session="eth")
    body = _body(r)
    assert r.status_code == 200 and body["bars"] == []
    assert body.get("no_data") is True and body.get("reason") == "delisted", body


def test_the_serve_layer_NAMES_the_delisted_branch_and_carries_no_stale_phase_marks():
    """`desc="entry"` with another request's `get_bars;dur=` after it is how this read as a cache hit."""
    _plant_stale_marks()
    r = bars.serve_bars("CPRX", tf="5", bars=200, since="", to="")
    st = r.headers.get("Server-Timing") or ""
    assert 'desc="delisted' in st, f"the serve layer must name the branch that answered: {st!r}"
    assert "get_bars" not in st and "live_cov" not in st, (
        f"phase marks from a previous request on this thread leaked into this answer: {st!r}")


def test_a_DELISTED_daily_ask_still_serves_its_frozen_rows(monkeypatch):
    """The narrowness: only intraday changes. D keeps serving the stored frozen series."""
    rows = [(20260710, 31.47, 31.48, 31.47, 31.47, 1346672),
            (20260713, 31.48, 31.49, 31.47, 31.48, 3386053),
            (20260714, 31.48, 31.505, 31.48, 31.49, 15513864)]
    monkeypatch.setattr(bars_fetch._sqlite, "get_bars", lambda t, tf, n: list(rows))
    monkeypatch.setattr(bars, "_augment_daily_with_today", lambda resp, t: resp)
    r = bars.serve_bars("CPRX", tf="D", bars=2000, since="", to="")
    body = _body(r)
    assert r.status_code == 200
    assert len(body["bars"]) == 3 and not body.get("no_data"), body
    assert 'desc="delisted' in (r.headers.get("Server-Timing") or "")


def test_a_LIVE_symbol_never_takes_the_delisted_no_data(monkeypatch):
    """A live name (not in the registry) must reach the live path, never this answer."""
    seen = []

    def inner(t, tf, n):
        seen.append((t, tf))
        from fastapi.responses import ORJSONResponse
        return ORJSONResponse(content={"ticker": t.upper(), "tf": tf, "bars": [
            {"t": 1764000000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]})
    monkeypatch.setattr(bars, "_get_bars_inner", inner)
    r = bars.serve_bars("ACAD", tf="5", bars=200, since="", to="")
    body = _body(r)
    assert seen == [("ACAD", "5")]
    assert not body.get("no_data") and len(body["bars"]) == 1, body

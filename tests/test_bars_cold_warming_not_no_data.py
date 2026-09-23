"""A cold ticker whose fetch is ALREADY RUNNING must not be told it does not exist.

⛔⛔ THE DEFECT, MEASURED ON PRODUCTION 2026-09-23. `BFRG` (Bullfrog AI, NASDAQ,
$0.68) charted fine on 1D and answered, on 5m:

    {"bars":[],"no_data":true,"reason":"symbol_not_carried"}

which the member reads as "The data provider doesn't carry this symbol." It was
not true. `bars_fetch` never blocks a request on a cold provider fetch — for an
unseen ticker/tf it kicks a bounded BACKGROUND fetch, marks the serve `cold-bg`
and returns 503 `{"error": "warming"}` + `Retry-After: 3`, expecting the client
to re-poll and collect the rows. `serve_bars` was downgrading that 503 to a
permanent `no_data`, which both lies about coverage AND cancels the retry that
would have picked up the data the background fetch was at that moment writing.

⭐ THE PROOF IS THE SECOND ASK. Each of BFRG / GRRR / CNEY / VRME answered
`symbol_not_carried`, then served 120-300 REAL bars from `sqlite` in ~2 ms after
ONE spaced re-request — BFRG covering four sessions to within a minute of the
request, 0 OHLC violations. `SNGX` was caught red-handed: the same response
carried `no_data:symbol_not_carried` AND `Server-Timing: bars;desc="cold-bg"`.
Nothing was missing but the second ask.

⚠️ THIS IS NOT THE UNIVERSE BUG AGAIN. `test_bars_dead_ticker` fixed the same
SYMPTOM for searchable ETFs by widening the membership reference. That cannot
reach BFRG: the member's `/api/bars` door is the BARS-API TIER (an edge route
forwards `/api/bars/{ticker}` verbatim — `X-Bars-Edge: tier` on the wire), and
`bars_api_main` never builds the search index, so "searchable ⇒ carried" is
structurally dead exactly where it is needed. Hence the rule here is about the
CLAIM the 503 makes, not about who is in which list.
"""
import pytest

from api.routers import bars


def _resp(status, content):
    from fastapi.responses import ORJSONResponse
    r = ORJSONResponse(status_code=status, content=content)
    if status == 503:
        r.headers["Retry-After"] = "3"
    return r


@pytest.fixture(autouse=True)
def not_carried_anywhere(monkeypatch):
    """BFRG is in no list we hold — the exact production state. The fix must not
    depend on fixing that, because on the serving tier it cannot be fixed."""
    monkeypatch.setattr(bars, "_CARRIED", frozenset({"AAPL", "XYZ"}))
    from api.services import ticker_search_index as tsi
    monkeypatch.setattr(tsi, "contains", lambda s: False)
    monkeypatch.setattr(tsi, "ready", lambda: False, raising=False)
    from api.services import delisted_registry as dr
    monkeypatch.setattr(dr, "resolve", lambda s: None)
    yield


@pytest.fixture
def warming(monkeypatch):
    """`_cold_shed`: a background fetch for this ticker/tf was just kicked."""
    monkeypatch.setattr(bars, "_get_bars_inner", lambda t, tf, n: _resp(
        503, {"ticker": t.upper(), "tf": tf, "bars": [], "error": "warming"}))


@pytest.fixture
def warm_pool_shed(monkeypatch):
    """The `warm=1` prefetch shed shape — a different key, same claim."""
    monkeypatch.setattr(bars, "_get_bars_inner", lambda t, tf, n: _resp(
        503, {"ticker": t.upper(), "tf": tf, "bars": [], "warming": True}))


def _get(ticker, tf="5"):
    return bars.serve_bars(ticker, tf=tf, bars=600, since="", to="")


def test_a_cold_uncarried_ticker_keeps_its_warming_503(warming):
    """⛔ THE RELEASE BLOCKER. This is BFRG."""
    r = _get("BFRG")
    assert r.status_code == 503, (
        "the warming signal was destroyed — the client stops retrying and never "
        "collects the bars the background fetch is writing")
    assert r.headers.get("Retry-After") == "3", (
        "a symbol whose data is ON ITS WAY must ask the client to come back")
    body = r.body.decode()
    assert "symbol_not_carried" not in body, body
    assert '"no_data"' not in body, body


def test_the_warm_pool_shed_shape_is_also_exempt(warm_pool_shed):
    assert _get("BFRG").status_code == 503


def test_every_intraday_timeframe_is_exempt(warming):
    """The member hit this on 5m; 1/15/30/60 share the one cold-fetch path."""
    for tf in ("1", "5", "15", "30", "60"):
        assert _get("BFRG", tf=tf).status_code == 503, f"tf={tf} lost its retry"


def test_daily_is_exempt_too(warming):
    """BFRG's 1D happened to be warm. A cold DAILY microcap is the same defect."""
    assert _get("BFRG", tf="D").status_code == 503


def test_a_RETIRED_ticker_still_downgrades(monkeypatch):
    """⚠️⚠️ THE NARROWNESS IS THE WHOLE FIX. `SQ` (retired to `XYZ`) trips the
    no-blank guard with the breaker open and answers `transient` — "we looked
    everywhere and found nothing", NOT "we have started looking". Exempting that
    too would have the frontend retry a symbol that will never answer, which is
    the defect `test_bars_dead_ticker` exists to prevent. `warming` and
    `transient` are different claims and only the first one is in flight."""
    monkeypatch.setattr(bars, "_get_bars_inner", lambda t, tf, n: _resp(
        503, {"ticker": t.upper(), "tf": tf, "bars": [], "error": "transient"}))
    r = _get("SQ")
    assert r.status_code == 200, "the dead-ticker downgrade was broken"
    assert "symbol_not_carried" in r.body.decode()


def test_a_carried_symbol_is_unaffected_either_way(warming):
    assert _get("AAPL").status_code == 503


def test_a_genuinely_empty_200_is_left_alone(monkeypatch):
    """⭐ A healthy source with no trades already answers 200+[] and never enters
    the downgrade. It must keep saying so — no fabricated bar, no invented flag."""
    monkeypatch.setattr(bars, "_get_bars_inner", lambda t, tf, n: _resp(
        200, {"ticker": t.upper(), "tf": tf, "bars": []}))
    r = _get("BFRG")
    assert r.status_code == 200
    assert '"bars":[]' in r.body.decode()


def test_an_unreadable_body_does_not_invent_an_exemption(monkeypatch):
    """A 503 we cannot parse is not evidence of an in-flight fetch; the existing
    membership rule stays in charge rather than a guess widening the exemption."""
    class _Opaque:
        status_code = 503
        body = b"<html>502 upstream</html>"
        headers: dict = {}
    monkeypatch.setattr(bars, "_get_bars_inner", lambda t, tf, n: _Opaque())
    assert _get("BFRG").status_code == 200

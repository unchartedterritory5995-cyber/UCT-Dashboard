"""Today-pack — the whole-market developing daily bar the client seeds from.

The gap it fills: `barspack` never builds mid-session (partial-bar guard), so a
symbol the browser has never opened has no local copy of today's bar and today's
candle cannot paint until /api/bars returns — measured 300-500ms of pure network
around 0.8ms of server compute.
"""
import orjson
import pytest

from api.routers import bars
from api.services import massive, todaypack


def _snap(**rows):
    return rows


@pytest.fixture(autouse=True)
def _fresh_memo():
    """`build_today_pack` memoizes for ~15s. Without a reset between tests, the
    second test to build silently gets the FIRST test's snapshot back and passes
    while exercising nothing."""
    todaypack._reset_for_test()
    yield
    todaypack._reset_for_test()


@pytest.fixture
def session_open(monkeypatch):
    monkeypatch.setattr(massive, "_regular_session_has_opened_today", lambda: True)


def test_empty_pack_before_the_session_opens(monkeypatch):
    """⛔ THE DUPLICATE-CANDLE CLASS, MOVED INTO THE CLIENT. Before the open the
    provider's `day` object still holds the PRIOR session; seeding from it would
    paint the duplicate the 09-04/09-11 fixes removed, where no server guard sees
    it. Must be empty, and must not even read the snapshot."""
    monkeypatch.setattr(massive, "_regular_session_has_opened_today", lambda: False)
    called = {"n": 0}

    def _boom(ttl=0):
        called["n"] += 1
        return {"AAPL": {"day_open": 1, "day_high": 2, "day_low": 1, "last_price": 2, "today_vol": 5}}
    monkeypatch.setattr(massive, "get_full_market_snapshot_hl_cached", _boom)

    pack = todaypack.build_today_pack()
    assert pack == {"d": "", "n": 0, "bars": {}}
    assert called["n"] == 0, "must refuse before reading the snapshot at all"


def test_projects_todays_ohlcv(monkeypatch, session_open):
    monkeypatch.setattr(massive, "get_full_market_snapshot_hl_cached", lambda ttl=0: _snap(
        AAPL={"day_open": 100.0, "day_high": 105.0, "day_low": 99.0,
              "last_price": 104.0, "today_vol": 1234},
    ))
    pack = todaypack.build_today_pack()
    assert pack["n"] == 1
    assert pack["bars"]["AAPL"] == [100.0, 105.0, 99.0, 104.0, 1234]
    assert pack["d"]


def test_zero_is_absent_not_a_price(monkeypatch, session_open):
    """The provider returns zeros for a name with no regular-session print yet.
    A zero-open bar would paint a candle at the axis floor."""
    monkeypatch.setattr(massive, "get_full_market_snapshot_hl_cached", lambda ttl=0: _snap(
        GOOD={"day_open": 10.0, "day_high": 11.0, "day_low": 9.0, "last_price": 10.5, "today_vol": 7},
        NOPRINT={"day_open": 0, "day_high": 0, "day_low": 0, "last_price": 0, "today_vol": 0},
        HALFZERO={"day_open": 10.0, "day_high": 0, "day_low": 9.0, "last_price": 10.0, "today_vol": 1},
    ))
    assert set(todaypack.build_today_pack()["bars"]) == {"GOOD"}


def test_live_close_widens_the_running_range(monkeypatch, session_open):
    """The close is the LIVE price; at the edge of a print it can sit a tick outside
    the running day range. Widen rather than emit a self-contradicting OHLC."""
    monkeypatch.setattr(massive, "get_full_market_snapshot_hl_cached", lambda ttl=0: _snap(
        UP={"day_open": 10.0, "day_high": 11.0, "day_low": 9.0, "last_price": 11.5, "today_vol": 1},
        DOWN={"day_open": 10.0, "day_high": 11.0, "day_low": 9.0, "last_price": 8.5, "today_vol": 1},
    ))
    b = todaypack.build_today_pack()["bars"]
    assert b["UP"][1] == 11.5 and b["UP"][3] == 11.5      # high widened to the live price
    assert b["DOWN"][2] == 8.5 and b["DOWN"][3] == 8.5    # low widened


def test_class_shares_come_back_in_the_apps_hyphen_form(monkeypatch, session_open):
    """The snapshot speaks provider form (BRK.B); the client looks up the app's
    canonical form (BRK-B). Getting this wrong means dual-class names silently
    never seed — the exact class of bug `to_polygon_symbol` exists for."""
    monkeypatch.setattr(massive, "get_full_market_snapshot_hl_cached", lambda ttl=0: _snap(
        **{"BRK.B": {"day_open": 1.0, "day_high": 2.0, "day_low": 1.0,
                     "last_price": 2.0, "today_vol": 3}}))
    bars_ = todaypack.build_today_pack()["bars"]
    assert "BRK-B" in bars_ and "BRK.B" not in bars_
    assert massive.to_polygon_symbol("BRK-B") == "BRK.B", "round-trips with the boundary mapper"


def test_a_snapshot_failure_degrades_to_empty_never_raises(monkeypatch, session_open):
    def _raise(ttl=0):
        raise RuntimeError("provider down")
    monkeypatch.setattr(massive, "get_full_market_snapshot_hl_cached", _raise)
    assert todaypack.build_today_pack() == {"d": "", "n": 0, "bars": {}}


def test_route_is_a_sibling_path_not_captured_by_the_ticker_route():
    """⚠️ FastAPI matches in declaration order: `/api/bars/today-pack` would be
    served as ticker='today-pack' by the route right below it."""
    paths = [r.path for r in bars.router.routes]
    assert "/api/bars-today-pack" in paths
    assert paths.index("/api/bars-today-pack") < paths.index("/api/bars/{ticker}")


def test_route_is_edge_cacheable(monkeypatch, session_open):
    """200+ members polling this must land on Cloudflare, not the pod."""
    monkeypatch.setattr(massive, "get_full_market_snapshot_hl_cached", lambda ttl=0: _snap(
        AAPL={"day_open": 1.0, "day_high": 2.0, "day_low": 1.0, "last_price": 2.0, "today_vol": 3}))
    r = bars.get_today_pack()
    assert "public" in r.headers["Cache-Control"] and "max-age" in r.headers["Cache-Control"]
    assert orjson.loads(r.body)["bars"]["AAPL"]


# ── the built-pack memo ──────────────────────────────────────────────────────
# The edge should absorb nearly every request, but "should" is not a design: a
# missing Cache Rule, a cookie, or an eviction puts them all on the pod, where the
# projection is ~11k iterations and ~630KB of serialize.

def test_a_second_request_inside_the_window_does_not_rebuild(monkeypatch, session_open):
    builds = {"n": 0}

    def _snapshot(ttl=0):
        builds["n"] += 1
        return _snap(AAPL={"day_open": 1.0, "day_high": 2.0, "day_low": 1.0,
                           "last_price": 2.0, "today_vol": 3})
    monkeypatch.setattr(massive, "get_full_market_snapshot_hl_cached", _snapshot)

    a = todaypack.build_today_pack()
    b = todaypack.build_today_pack()
    assert builds["n"] == 1, "a cache MISS must cost a dict reference, not a rebuild"
    assert a is b


def test_an_empty_pre_open_pack_is_not_pinned_across_the_open(monkeypatch):
    """⛔ THE EDGE CASE THE MEMO COULD CREATE. An empty pack cached for the full
    window at 09:29:58 would answer the first post-open requests with "no bars".
    Empty results get a deliberately near-expired stamp so the open is picked up."""
    monkeypatch.setattr(massive, "_regular_session_has_opened_today", lambda: False)
    monkeypatch.setattr(massive, "get_full_market_snapshot_hl_cached", lambda ttl=0: {})
    pre = todaypack.build_today_pack()
    assert pre["bars"] == {}
    # the stamp on an empty result must already be near expiry, not fresh
    age = __import__("time").time() - todaypack._built["ts"]
    assert age > todaypack._BUILD_TTL - 5, "an empty pack must not hold the window"

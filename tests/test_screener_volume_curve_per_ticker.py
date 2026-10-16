"""APPROACH B — per-stock time-of-day volume curves behind "volume vs usual by now".

Design: docs/superpowers/specs/2026-10-15-screener-live-relative-volume-design.md.

What these pin, each with the case that would go the other way:
  * a liquid name with >= PER_TICKER_MIN_SESSIONS complete sessions gets its OWN
    79-knot curve, built by the SAME median/monotonic/pinned code as the market's;
    a thinner name gets none and reads the market curve;
  * a short sample is BLENDED toward the market by sessions/SESSIONS, so one odd day
    cannot dominate, and a full sample is the ticker's own curve exactly;
  * the knot read suppresses the first 15 minutes and scales an early close exactly
    like the market read, and agrees with it on the expanded curve;
  * the whole universe's per-ticker shares come from ONE query;
  * only the newest build's per-ticker rows are ever read (and older ones pruned);
  * the client payload serves the asked symbols' knots, from the cache.

Every fixture is a tmp screener.db and in-memory bars; nothing reads C:\\data.
"""
from datetime import date, datetime

import pytest

from api.services.screener import snapshot_db, volume_curve as vc
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
N = vc.BARS_PER_SESSION
LINEAR = [m / 390 for m in range(391)]
U_SHAPE = [30 if k < 6 else 25 if k > N - 7 else 10 for k in range(N)]
FRONT = [200 if k < 6 else 5 for k in range(N)]          # a name that trades early


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    vc._PAYLOAD_CACHE.clear()
    snapshot_db.init_db()
    return tmp_path


def _bars_for(d, vols):
    t0 = int(datetime(d.year, d.month, d.day, 9, 30, tzinfo=ET).timestamp())
    return [(t0 + k * 300, 1, 1, 1, 1, v) for k, v in enumerate(vols)]


def _source(sessions, plan):
    """``plan[ticker] = (vols, n_sessions)``: the newest ``n_sessions`` sessions carry
    complete bars, older ones are missing (a ticker with a short history)."""
    def get_bars_since(ticker, tf, since):
        vols, n = plan[ticker]
        out = []
        for d in sessions[len(sessions) - n:]:
            out.extend(_bars_for(d, vols))
        return [b for b in out if b[0] > since]
    return get_bars_since


def _front_knots():
    return vc.build_knots([vc.session_shares(FRONT)])


# --------------------------------------------------------------------------- #
# the nightly
# --------------------------------------------------------------------------- #

def test_a_liquid_name_gets_its_own_curve_and_a_thin_one_reads_the_market(db,
                                                                          monkeypatch):
    monkeypatch.setattr(vc, "MIN_SAMPLES", 40)
    today = date(2026, 8, 25)
    sessions = vc.full_sessions_before(today, vc.SESSIONS)
    plan = {"AAA": (U_SHAPE, 20), "BBB": (FRONT, 20), "CCC": (FRONT, 14)}
    r = vc.build_nightly(today, tickers=list(plan), get_bars_since=_source(sessions, plan))
    assert r["stored"] is True and r["ticker_curves"] == 2
    got = vc.ticker_knots()
    assert set(got) == {"AAA", "BBB"}                 # CCC: 14 < 15 sessions
    assert len(got["BBB"]) == N + 1
    # BBB is front-loaded: by 10:00 it has done far more of its day than U-shaped AAA,
    # and each full-history name reads exactly its own curve (weight 20/20)
    assert got["BBB"][6] > got["AAA"][6] + 0.2
    assert got["AAA"] == pytest.approx(vc.build_knots([vc.session_shares(U_SHAPE)]),
                                       abs=1e-6)
    # control: the threshold is what excluded CCC — at 14 it is admitted
    vc._PAYLOAD_CACHE.clear()
    monkeypatch.setattr(vc, "PER_TICKER_MIN_SESSIONS", 14)
    vc.build_nightly(today, tickers=list(plan), get_bars_since=_source(sessions, plan))
    assert "CCC" in vc.ticker_knots()


def test_the_per_ticker_curve_is_the_SAME_median_monotonic_pinned_build():
    """One odd session in twenty cannot move a per-ticker median either."""
    own = [vc.session_shares(FRONT)] * 19 + [vc.session_shares([1000] + [1] * (N - 1))]
    market = vc.build_knots([vc.session_shares(U_SHAPE)])
    rows = vc.ticker_curves_from_samples({"BBB": own}, market)
    assert [(t, n) for t, n, _ in rows] == [("BBB", 20)]
    assert rows[0][2] == pytest.approx(vc.build_knots(own), abs=1e-6)
    k = rows[0][2]
    assert k[0] == 0.0 and k[-1] == 1.0 and all(b >= a for a, b in zip(k, k[1:]))
    assert k[1] == pytest.approx(vc.session_shares(FRONT)[1], abs=1e-6)


def test_a_thin_sample_is_blended_toward_the_market():
    own_s = [vc.session_shares(FRONT)]
    market = vc.build_knots([vc.session_shares(U_SHAPE)])
    own = vc.build_knots(own_s)
    rows = dict((t, k) for t, _, k in
                vc.ticker_curves_from_samples({"T15": own_s * 15, "T20": own_s * 20},
                                              market))
    w = 15 / vc.SESSIONS
    assert rows["T15"][6] == pytest.approx(w * own[6] + (1 - w) * market[6], abs=1e-6)
    assert rows["T20"][6] == pytest.approx(own[6], abs=1e-6)          # full weight
    # strictly between the two, never the raw ticker curve
    assert market[6] < rows["T15"][6] < own[6]
    assert rows["T15"][0] == 0.0 and rows["T15"][-1] == 1.0


def test_blend_weight_is_capped_and_floored():
    a, b = [0.0, 0.8, 1.0], [0.0, 0.2, 1.0]
    assert vc.blend_knots(a, b, 40) == [0.0, 0.8, 1.0]
    assert vc.blend_knots(a, b, 0) == [0.0, 0.2, 1.0]
    assert vc.blend_knots(a, b, 10) == [0.0, 0.5, 1.0]


# --------------------------------------------------------------------------- #
# the knot read
# --------------------------------------------------------------------------- #

def test_the_knot_read_matches_the_minute_read_and_suppresses_and_scales():
    knots = _front_knots()
    curve = vc.knots_to_curve(knots)
    for m in (15, 17, 42, 72, 150, 389, 390, 500):
        assert vc.knot_share_at(knots, m) == pytest.approx(vc.share_at(curve, m),
                                                           abs=2e-6), m
    assert vc.knot_share_at(knots, 14.9) is None
    # half-day: minute 105 of 210 reads knot position 195/5
    lin = [k / N for k in range(N + 1)]
    assert vc.knot_share_at(lin, 105, 210) == pytest.approx(195 / 390)
    assert vc.knot_share_at(lin, 500, 210) == pytest.approx(1.0)
    assert vc.knot_share_at(None, 60) is None and vc.knot_share_at(lin[:-1], 60) is None


def test_ticker_live_shares_read_the_same_clock_and_scale_a_half_day(db):
    lin = [k / N for k in range(N + 1)]
    vc.store(LINEAR, first_session=1, last_session=2, sessions=20, tickers=1,
             samples=999, ticker_curves=[("AAA", 20, lin)])
    assert vc.ticker_live_shares(datetime(2026, 8, 24, 10, 42, tzinfo=ET)) == \
        {"AAA": pytest.approx(72 / 390)}
    assert vc.ticker_live_shares(datetime(2026, 8, 24, 9, 44, tzinfo=ET)) == {}
    assert vc.ticker_live_shares(datetime(2026, 8, 22, 11, 0, tzinfo=ET)) == {}
    # half-day 2025-11-28 (13:00 close): 12:00 is minute 150 of 210
    got = vc.ticker_live_shares(datetime(2025, 11, 28, 12, 0, tzinfo=ET))
    assert got["AAA"] == pytest.approx(150 / 210)
    assert got["AAA"] != pytest.approx(150 / 390)                       # control


# --------------------------------------------------------------------------- #
# storage: one query, newest build only
# --------------------------------------------------------------------------- #

def test_the_whole_universes_ticker_shares_come_from_ONE_query(db, monkeypatch):
    knots = _front_knots()
    vc.store(LINEAR, first_session=1, last_session=2, sessions=20, tickers=300,
             samples=6000, ticker_curves=[(f"T{i}", 20, knots) for i in range(300)])
    selects = []
    real = snapshot_db.connect

    def traced(*a, **k):
        conn = real(*a, **k)
        conn.set_trace_callback(
            lambda sql: selects.append(sql) if sql.lstrip().upper().startswith("SELECT")
            else None)
        return conn
    monkeypatch.setattr(snapshot_db, "connect", traced)
    got = vc.ticker_live_shares(datetime(2026, 8, 24, 10, 42, tzinfo=ET))
    assert len(got) == 300
    assert len(selects) == 1, selects
    # control: the tracer sees a second read when one is made
    vc.ticker_knots()
    assert len(selects) == 2


def test_only_the_newest_builds_ticker_rows_are_read_and_older_ones_pruned(db):
    knots = _front_knots()
    b1 = vc.store(LINEAR, first_session=1, last_session=2, sessions=20, tickers=1,
                  samples=999, ticker_curves=[("AAA", 20, knots)])
    assert set(vc.ticker_knots()) == {"AAA"}
    b2 = vc.store(LINEAR, first_session=1, last_session=2, sessions=20, tickers=1,
                  samples=999, ticker_curves=[("BBB", 20, knots)])
    assert b2 > b1 and set(vc.ticker_knots()) == {"BBB"}
    vc.store(LINEAR, first_session=1, last_session=2, sessions=20, tickers=1, samples=999)
    assert vc.ticker_knots() == {}                    # a night with none: market for all
    with snapshot_db.connect() as conn:
        assert conn.execute(f"SELECT COUNT(*) FROM {vc.TICKER_TABLE}").fetchone()[0] == 0


def test_no_table_reads_as_no_ticker_curves(db):
    assert vc.ticker_knots() == {}
    assert vc.ticker_live_shares(datetime(2026, 8, 24, 10, 42, tzinfo=ET)) == {}


# --------------------------------------------------------------------------- #
# the client payload and the endpoint
# --------------------------------------------------------------------------- #

def test_the_payload_serves_the_asked_symbols_knots_from_the_cache(db, monkeypatch):
    knots = _front_knots()
    vc.store(LINEAR, first_session=1, last_session=2, sessions=20, tickers=2,
             samples=999, ticker_curves=[("AAA", 20, knots), ("BBB", 18, knots)])
    now = datetime(2026, 8, 24, 11, 0, tzinfo=ET)
    p = vc.client_payload(now, tickers=["aaa", "ZZZ", "AAA"])
    assert set(p["ticker_knots"]) == {"AAA"}          # ZZZ has none: market curve
    assert p["ticker_knots"]["AAA"] == [round(x, 4) for x in knots]
    assert len(p["curve"]) == 391 and p["bar_min"] == 5 and p["build_id"]
    assert vc.client_payload(now)["ticker_knots"] == {}
    reads = []
    monkeypatch.setattr(vc, "ticker_knots", lambda: reads.append(1) or {})
    assert set(vc.client_payload(now, tickers=["BBB"])["ticker_knots"]) == {"BBB"}
    assert reads == []                                 # served from the cache
    vc._PAYLOAD_CACHE.clear()
    vc.client_payload(now, tickers=["BBB"])
    assert reads == [1]                                # control: a cold read reads


def test_no_market_curve_means_no_ticker_knots_either(db, monkeypatch):
    vc.store(LINEAR, first_session=1, last_session=2, sessions=20, tickers=1,
             samples=999, ticker_curves=[("AAA", 20, _front_knots())])
    monkeypatch.setattr(vc, "latest", lambda: None)
    p = vc.client_payload(datetime(2026, 8, 24, 11, 0, tzinfo=ET), tickers=["AAA"])
    assert p["curve"] is None and p["ticker_knots"] == {}


def test_the_endpoint_takes_a_ticker_or_a_batch(db):
    from api.routers import screener as router
    knots = _front_knots()
    vc.store(LINEAR, first_session=1, last_session=2, sessions=20, tickers=2,
             samples=999, ticker_curves=[("AAA", 20, knots), ("BBB", 20, knots)])
    one = router.screener_volume_curve(ticker="aaa", tickers=None, user={"id": "u"})
    assert set(one["ticker_knots"]) == {"AAA"}
    many = router.screener_volume_curve(ticker=None, tickers="AAA, BBB,,CCC",
                                        user={"id": "u"})
    assert set(many["ticker_knots"]) == {"AAA", "BBB"}
    none = router.screener_volume_curve(ticker=None, tickers=None, user={"id": "u"})
    assert none["ticker_knots"] == {} and len(none["curve"]) == 391


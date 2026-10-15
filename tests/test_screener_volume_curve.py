"""The market-wide TIME-OF-DAY VOLUME CURVE behind the live `rvol_live` column.

Design: docs/superpowers/specs/2026-10-15-screener-live-relative-volume-design.md.

What these pin, each with the case that would go the other way:
  * the curve is a MEDIAN per slot (one wild session cannot move it), monotonic,
    0 at the open and exactly 1.0 at the close;
  * only FULL regular sessions are sampled: half-days and holidays are skipped,
    a session missing any 5-minute bar is dropped, extended-hours bars are ignored,
    and the bar timestamps are read as ET bar STARTS across both DST regimes;
  * the live share is blank before 09:45 ET and an early-close day is scaled to its
    own length;
  * a thin night stores NOTHING and the previous curve stands;
  * the nightly job is wired after the snapshot build and cannot cost it.

Every fixture is a tmp screener.db and in-memory bars; nothing reads C:\\data.
"""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from api.services.screener import snapshot_db, volume_curve as vc

ET = ZoneInfo("America/New_York")
N = vc.BARS_PER_SESSION


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    vc._PAYLOAD_CACHE.clear()
    snapshot_db.init_db()
    return tmp_path


def _bars_for(d: date, vols, *, extended=True, skip=()):
    """5-minute bars (ts, o, h, l, c, v) for one session, ET bar starts in unix seconds."""
    t0 = int(datetime(d.year, d.month, d.day, 9, 30, tzinfo=ET).timestamp())
    out = []
    if extended:   # premarket and after-hours prints that must NOT enter the sample
        out.append((t0 - 3600, 1, 1, 1, 1, 9_999_999))
        out.append((t0 + 390 * 60, 1, 1, 1, 1, 9_999_999))
    for k, v in enumerate(vols):
        if k in skip:
            continue
        out.append((t0 + k * 300, 1, 1, 1, 1, v))
    return sorted(out)


U_SHAPE = [30 if k < 6 else 25 if k > N - 7 else 10 for k in range(N)]


# --------------------------------------------------------------------------- #
# the arithmetic
# --------------------------------------------------------------------------- #

def test_the_curve_is_monotonic_pinned_and_391_minutes_long():
    curve = vc.build_curve([vc.session_shares(U_SHAPE)] * 3)
    assert len(curve) == 391
    assert curve[0] == 0.0 and curve[-1] == 1.0
    assert all(b >= a for a, b in zip(curve, curve[1:]))
    # a U-shaped day has done far more than 30/390 of its volume by 10:00
    assert curve[30] > 30 / 390 + 0.05


def test_the_curve_is_a_MEDIAN_one_wild_session_cannot_move_it():
    calm = vc.session_shares([10] * N)
    wild = vc.session_shares([1000] + [1] * (N - 1))     # everything in the first bar
    curve = vc.build_curve([calm, calm, wild])
    assert curve[5] == pytest.approx(1 / N, abs=1e-6)       # the calm answer
    # control: a MEAN would have been dragged far up by the one wild session
    mean_k1 = (calm[1] * 2 + wild[1]) / 3
    assert mean_k1 > curve[5] + 0.2


def test_a_session_with_the_wrong_bar_count_or_no_volume_is_refused():
    assert vc.session_shares([10] * (N - 1)) is None
    assert vc.session_shares([0] * N) is None
    assert vc.build_curve([]) is None


def test_share_at_suppresses_the_first_15_minutes_and_scales_an_early_close():
    curve = [m / 390 for m in range(391)]                    # linear, easy to read
    assert vc.share_at(curve, 14.9) is None
    assert vc.share_at(curve, 15) == pytest.approx(15 / 390)
    # half-day: minute 105 of a 210-minute session reads the curve at 195 of 390
    assert vc.share_at(curve, 105, 210) == pytest.approx(195 / 390)
    # after the close it holds at the close, never past 1.0
    assert vc.share_at(curve, 500, 210) == pytest.approx(1.0)
    assert vc.share_at(None, 60) is None and vc.share_at(curve[:-1], 60) is None


def test_rvol_refuses_a_missing_or_non_positive_input():
    assert vc.rvol(1_000_000, 2_000_000, 0.25) == 2.0
    for args in ((0, 1, 0.5), (1, 0, 0.5), (1, 1, 0), (None, 1, 0.5), (1, "x", 0.5)):
        assert vc.rvol(*args) is None, args


# --------------------------------------------------------------------------- #
# the session clock — the repo's calendar, never a second one
# --------------------------------------------------------------------------- #

def test_full_sessions_skip_half_days_and_holidays():
    got = vc.full_sessions_before(date(2025, 12, 2), 5)
    assert date(2025, 11, 28) not in got        # half-day after Thanksgiving
    assert date(2025, 11, 27) not in got        # Thanksgiving
    assert got == [date(2025, 11, 21), date(2025, 11, 24), date(2025, 11, 25),
                   date(2025, 11, 26), date(2025, 12, 1)]
    assert date(2025, 12, 2) not in vc.full_sessions_before(date(2025, 12, 2), 30)


def test_live_share_reads_the_ET_clock_and_scales_a_half_day():
    curve = [m / 390 for m in range(391)]
    # a regular Monday, 10:42 EDT = 72 minutes in
    assert vc.live_share(datetime(2026, 8, 24, 10, 42, tzinfo=ET), curve) == \
        pytest.approx(72 / 390)
    # the SAME instant handed in as UTC reads the same
    utc = datetime(2026, 8, 24, 14, 42, tzinfo=ZoneInfo("UTC"))
    assert vc.live_share(utc, curve) == pytest.approx(72 / 390)
    # before 09:45 it is blank, not tiny
    assert vc.live_share(datetime(2026, 8, 24, 9, 40, tzinfo=ET), curve) is None
    # half-day 2025-11-28 closes 13:00: 12:00 is minute 150 of 210
    assert vc.live_share(datetime(2025, 11, 28, 12, 0, tzinfo=ET), curve) == \
        pytest.approx(150 * 390 / 210 / 390)
    # a holiday and a weekend have no session
    assert vc.live_share(datetime(2025, 11, 27, 11, 0, tzinfo=ET), curve) is None
    assert vc.live_share(datetime(2026, 8, 22, 11, 0, tzinfo=ET), curve) is None


# --------------------------------------------------------------------------- #
# sampling bars
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("d", [date(2026, 1, 15), date(2026, 7, 15)])   # EST and EDT
def test_samples_read_ET_bar_starts_and_ignore_extended_hours(d):
    got = vc.samples_from_bars(_bars_for(d, U_SHAPE), [d])
    assert got == [vc.session_shares(U_SHAPE)]


def test_a_partial_session_is_dropped_never_padded():
    d = date(2026, 7, 15)
    assert vc.samples_from_bars(_bars_for(d, U_SHAPE, skip={40}), [d]) == []
    # control: the same session complete is kept
    assert len(vc.samples_from_bars(_bars_for(d, U_SHAPE), [d])) == 1


# --------------------------------------------------------------------------- #
# the nightly, and storage
# --------------------------------------------------------------------------- #

def _bars_source(sessions, vols_by_ticker):
    def get_bars_since(ticker, tf, since):
        assert tf == "5"
        out = []
        for d in sessions:
            out.extend(_bars_for(d, vols_by_ticker[ticker]))
        return [b for b in out if b[0] > since]
    return get_bars_since


def test_a_thin_night_stores_nothing_and_the_previous_curve_stands(db, monkeypatch):
    today = date(2026, 8, 25)
    sessions = vc.full_sessions_before(today, vc.SESSIONS)
    prev = [m / 390 for m in range(391)]
    vc.store(prev, first_session=1, last_session=2, sessions=1, tickers=1, samples=999)

    thin = vc.build_nightly(today, tickers=["AAA"],
                            get_bars_since=_bars_source(sessions, {"AAA": U_SHAPE}))
    assert thin["stored"] is False and thin["samples"] == len(sessions)
    assert thin["reason"].startswith("too_few_samples")
    assert vc.latest()["curve"] == pytest.approx(prev)


def test_an_adequate_night_stores_the_curve_with_its_provenance(db, monkeypatch):
    monkeypatch.setattr(vc, "MIN_SAMPLES", 40)
    today = date(2026, 8, 25)
    sessions = vc.full_sessions_before(today, vc.SESSIONS)
    names = ["AAA", "BBB", "CCC"]
    r = vc.build_nightly(today, tickers=names,
                         get_bars_since=_bars_source(sessions, {t: U_SHAPE for t in names}))
    assert r["stored"] is True
    rec = vc.latest()
    assert rec["samples"] == 3 * len(sessions) == r["samples"]
    assert rec["tickers"] == 3 and rec["sessions"] == len(sessions)
    assert rec["first_session"] == int(sessions[0].strftime("%Y%m%d"))
    assert rec["last_session"] == int(sessions[-1].strftime("%Y%m%d"))
    assert rec["curve"][-1] == 1.0
    assert rec["curve"] == pytest.approx(vc.build_curve([vc.session_shares(U_SHAPE)]))


def test_the_liquid_set_is_the_top_non_ETF_names_by_dollar_volume(db):
    rows = [{"ticker": t, "dollar_vol_30d": dv, "is_etf": etf}
            for t, dv, etf in (("BIG", 9e9, 0), ("ETF", 8e9, 1), ("MID", 5e9, 0),
                               ("NONE", None, 0))]
    snapshot_db.upsert_rows(rows)
    assert vc.liquid_tickers(10) == ["BIG", "MID"]
    assert vc.liquid_tickers(1) == ["BIG"]


def test_no_table_reads_as_no_curve(db):
    assert vc.latest() is None and vc.latest_curve() is None


def test_the_client_payload_carries_the_curve_and_todays_window(db):
    vc.store([m / 390 for m in range(391)], first_session=20260801, last_session=20260824,
             sessions=20, tickers=300, samples=6000)
    p = vc.client_payload(datetime(2025, 11, 28, 11, 0, tzinfo=ET))
    assert len(p["curve"]) == 391 and p["samples"] == 6000
    assert p["session"] == {"date": "2025-11-28", "open_min": 570, "close_min": 780}
    assert p["suppress_first_min"] == vc.SUPPRESS_FIRST_MIN
    vc._PAYLOAD_CACHE.clear()
    assert vc.client_payload(datetime(2026, 8, 22, 11, 0, tzinfo=ET))["session"] is None


# --------------------------------------------------------------------------- #
# the wiring
# --------------------------------------------------------------------------- #

def _nightly_job(monkeypatch):
    import api.main as main
    jobs = {}

    class _Fake:
        def add_job(self, func, **kw):
            jobs[kw.get("id")] = func
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    assert main.register_screener_jobs(_Fake()) is True
    return jobs["screener_snapshot_nightly"]


def _completed_build(monkeypatch):
    from api.services.screener import distribution, snapshot_builder
    monkeypatch.setattr(snapshot_builder, "run_build", lambda *a, **k: {
        "built": 5, "skipped": 0, "errors": 0, "targets": 5})
    monkeypatch.setattr(distribution, "distributions", lambda *a, **k: None)
    import api.main as main
    alerts = []
    monkeypatch.setattr(main, "_alert_if_nightly_short", lambda s: alerts.append(s))
    return alerts


def test_the_nightly_builds_the_curve_after_a_completed_snapshot(monkeypatch, capsys):
    alerts = _completed_build(monkeypatch)
    calls = []
    monkeypatch.setattr(vc, "nightly_job", lambda: calls.append(1) or {
        "stored": True, "samples": 6000, "reason": None})
    _nightly_job(monkeypatch)()
    assert calls == [1]
    assert "screener volume curve: stored=True samples=6000" in capsys.readouterr().out
    assert len(alerts) == 1


def test_a_curve_failure_cannot_cost_the_nightly_its_alert(monkeypatch, capsys):
    alerts = _completed_build(monkeypatch)

    def boom():
        raise RuntimeError("bars.db gone")
    monkeypatch.setattr(vc, "nightly_job", boom)
    _nightly_job(monkeypatch)()
    assert "screener volume curve error: bars.db gone" in capsys.readouterr().out
    assert len(alerts) == 1


def test_a_REFUSED_build_does_not_build_a_curve(monkeypatch):
    from api.services.screener import snapshot_builder
    _completed_build(monkeypatch)
    monkeypatch.setattr(snapshot_builder, "run_build",
                        lambda *a, **k: {"skipped_reason": "already in flight"})
    calls = []
    monkeypatch.setattr(vc, "nightly_job", lambda: calls.append(1) or {})
    _nightly_job(monkeypatch)()
    assert calls == []


def test_the_endpoint_serves_the_payload(db, monkeypatch):
    from api.routers import screener as router
    vc.store([m / 390 for m in range(391)], first_session=1, last_session=2,
             sessions=20, tickers=300, samples=6000)
    out = router.screener_volume_curve(user={"id": "u"})
    assert out["samples"] == 6000 and len(out["curve"]) == 391
    paths = {getattr(r, "path", None) for r in router.router.routes}
    assert "/api/screener/volume-curve" in paths
    assert "/api/screener/snapshot-status" in paths          # control: the probe sees routes


# --------------------------------------------------------------------------- #
# the chart header divides by the SAME 30-session level the screener does
# --------------------------------------------------------------------------- #

def test_snapshot_batch_serves_a_30_session_average_beside_the_20(monkeypatch):
    from api.routers import research as r
    from api.services import bars_sqlite
    monkeypatch.setattr(r, "get_snapshot", lambda s: {"name": s})
    calls = []

    def fake_avg(tickers, sessions=20, before_ymd=None):
        calls.append((sessions, before_ymd))
        return {t: sessions * 1000 for t in tickers}
    monkeypatch.setattr(bars_sqlite, "avg_daily_volume", fake_avg)
    monkeypatch.setattr(bars_sqlite, "first_trade_dates", lambda *a, **k: {})
    out = r.research_snapshot_batch(tickers=["NVDA"], session=False)
    assert out["NVDA"]["avg_vol_30d"] == 30_000 and out["NVDA"]["avg_vol_20d"] == 20_000
    today = int(datetime.now(ET).strftime("%Y%m%d"))
    assert (30, today) in calls          # completed sessions only: today is excluded


def test_bulk_meta_serves_the_screeners_own_avg_volume_30d_as_avg_vol_30d(monkeypatch):
    from api.routers import watchlists as w
    assert w._BULK_META_COLS["avg_vol_30d"] == "avg_volume_30d"
    monkeypatch.setattr(snapshot_db, "get_projected", lambda tickers, columns: {
        "NVDA": {c: (123.0 if c == "avg_volume_30d" else None) for c in columns}})
    out = w.bulk_meta(w.BulkMetaRequest(tickers=["NVDA"]), user={"id": "u"})
    assert out["results"]["NVDA"]["avg_vol_30d"] == 123.0

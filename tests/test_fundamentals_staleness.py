"""Staleness of the REPORTED half of the fundamentals quarterly strip.

The widget's completeness guard only ever asked whether there were ZERO
reported quarters, so a table whose newest "reported" quarter was two
quarters old passed as complete, was cached for the full TTL, persisted to
the snapshot store, and served to members as if it were current.

Measured 2026-09-12 on live data: FMP's earnings feed for MMC stops at
2026-01-29, Finnhub returns nothing for it, and Yahoo's record stops earlier
still — so the widget showed 2025 Q4 as MMC's latest quarter with no
indication that two reported quarters were missing. ~2.3% of the universe
(BK, HOLX, ATGE, HUBG, NBTX, ASGN, BYON in a 300-name sample) is in the same
state.

These cover the pure label arithmetic that makes that condition detectable.
"""
import datetime


def _ts(y, m, d):
    return datetime.datetime(y, m, d, tzinfo=datetime.timezone.utc).timestamp()


# ── what SHOULD be the newest reported quarter at a given moment ──────────────
def test_expected_label_mid_september_is_the_june_quarter():
    from api.services.earnings_table import expected_latest_reported_label
    # 2026-09-12: the Sep-30 quarter has not ended; the Jun-30 one reported in
    # July/August. A filer that has not yet reported Q2 is genuinely late.
    assert expected_latest_reported_label(now=_ts(2026, 9, 12)) == "2026 Q2"


def test_expected_label_mid_january_is_the_september_quarter():
    from api.services.earnings_table import expected_latest_reported_label
    # Q4 ends Dec 31 and reports late Jan-Feb, so on Jan 15 the newest quarter
    # anyone is expected to have reported is still Q3.
    assert expected_latest_reported_label(now=_ts(2026, 1, 15)) == "2025 Q3"


def test_expected_label_early_march_is_the_december_quarter():
    from api.services.earnings_table import expected_latest_reported_label
    assert expected_latest_reported_label(now=_ts(2026, 3, 1)) == "2025 Q4"


# ── how far behind a payload's newest reported quarter is ─────────────────────
def test_current_strip_is_not_stale():
    from api.services.earnings_table import reported_staleness
    q = [{"label": "2026 Q1", "reported": True}, {"label": "2026 Q2", "reported": True},
         {"label": "2026 Q3", "reported": False}]
    assert reported_staleness(q, now=_ts(2026, 9, 12)) == 0


def test_one_quarter_behind_is_tolerated_as_a_late_filer():
    from api.services.earnings_table import reported_staleness
    q = [{"label": "2026 Q1", "reported": True}, {"label": "2026 Q2", "reported": False}]
    assert reported_staleness(q, now=_ts(2026, 9, 12)) == 1


def test_the_mmc_shape_is_two_quarters_behind():
    from api.services.earnings_table import reported_staleness
    # Exactly what prod served for MMC on 2026-09-11: reported ends 2025 Q4,
    # estimates resume at 2026 Q2, and the two quarters between are gone.
    q = [{"label": "2025 Q3", "reported": True}, {"label": "2025 Q4", "reported": True},
         {"label": "2026 Q2", "reported": False}, {"label": "2026 Q3", "reported": False}]
    assert reported_staleness(q, now=_ts(2026, 9, 12)) == 2


def test_no_reported_rows_is_not_scored_as_stale():
    from api.services.earnings_table import reported_staleness
    # A forward-only calendar is a DIFFERENT defect, already caught by the
    # partial-payload guard in _build_and_cache. Scoring it here too would
    # double-report it and, for a genuinely pre-revenue name, invent one.
    q = [{"label": "2026 Q3", "reported": False}]
    assert reported_staleness(q, now=_ts(2026, 9, 12)) == 0


def test_unparseable_label_is_not_scored_as_stale():
    from api.services.earnings_table import reported_staleness
    assert reported_staleness([{"label": "FY2026", "reported": True}], now=_ts(2026, 9, 12)) == 0


def test_a_quarter_ahead_of_expectation_is_not_negative():
    from api.services.earnings_table import reported_staleness
    # A fast filer can be AHEAD of the generic expectation; that is not a defect
    # and must never read as a negative staleness.
    q = [{"label": "2026 Q3", "reported": True}]
    assert reported_staleness(q, now=_ts(2026, 9, 12)) == 0


# ── the payload members receive must carry the verdict ────────────────────────
def _et(monkeypatch, tmp_path):
    import importlib
    import api.services.earnings_table as et
    importlib.reload(et)
    monkeypatch.setattr(et.snap_store, "get", lambda *a, **kw: None)
    monkeypatch.setattr(et.snap_store, "put", lambda *a, **kw: None)
    monkeypatch.setattr(et, "_is_fresh_window", lambda t, now: False)
    monkeypatch.setattr(et, "get_annual_financials_fn", lambda t, now: [{"year": 2025}])
    return et


def test_payload_reports_a_stale_strip(monkeypatch, tmp_path):
    et = _et(monkeypatch, tmp_path)
    monkeypatch.setattr(et, "_build_quarterly", lambda t, now, fresh=False: [
        {"label": "2025 Q4", "reported": True},
        {"label": "2026 Q2", "reported": False},
    ])
    out, _ = et._build("MMC", _ts(2026, 9, 12))
    assert out["reported_through"] == "2025 Q4"
    assert out["stale_quarters"] == 2


def test_payload_marks_a_current_strip_as_not_stale(monkeypatch, tmp_path):
    et = _et(monkeypatch, tmp_path)
    monkeypatch.setattr(et, "_build_quarterly", lambda t, now, fresh=False: [
        {"label": "2026 Q2", "reported": True},
        {"label": "2026 Q3", "reported": False},
    ])
    out, _ = et._build("OK", _ts(2026, 9, 12))
    assert out["reported_through"] == "2026 Q2"
    assert out["stale_quarters"] == 0

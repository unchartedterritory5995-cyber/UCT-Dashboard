"""`GET /api/calendar/wire-coverage` — "did every reporter make the feed?"

The owner's ask (2026-08-11, after 38 already-reported names were invisible):
*"I need to be able to reliably check this and know that every notable company
that reported earnings I can see the headline numbers in the feed."* This
endpoint IS that check: provider truth for the session (FMP one-day chunk +
Finnhub, in-universe) diffed against the wire store, with each miss classified
by WHERE it was lost — absent from the calendar roster (the 8/11 defect class)
vs on the roster but not yet detected/upgraded (detector lag).

Denominator rules follow the provider-coverage lessons: a reporter without
published actuals has not reported — it is never "missing". A double provider
failure yields `measured: false`, never a fabricated clean-or-zero reading
(a monitor that cannot measure must say so, not invent a number).
"""
from unittest import mock

from fastapi.testclient import TestClient

from api.main import app
from api.services.wire import coverage

client = TestClient(app)

MD = "2026-08-11"


def _prow(sym, eps_act=0.71, rev_act=228_189_000, date=MD):
    """A provider calendar row (FMP shape; Finnhub rows are normalized to it)."""
    return {"symbol": sym, "date": date, "epsActual": eps_act,
            "epsEstimated": 0.69, "revenueActual": rev_act,
            "revenueEstimated": 227_992_300}


def _wrow(sym, eps_act=1.0):
    return {"sym": sym, "market_date": MD, "eps_act": eps_act,
            "rev_act": 100.0, "first_seen_at": 1000.0}


CAP = {"SLAB", "SE", "CAH", "BGS", "IHS", "NUE"}


# ── the pure assessment ───────────────────────────────────────────────────────

def test_a_reported_name_absent_from_the_feed_is_missing_and_classified():
    """SLAB at its real 8/11 shape: actuals published, on neither the wire nor
    the calendar roster — a roster gap, not detector lag."""
    out = coverage.assess(
        provider={"SLAB": _prow("SLAB"), "SE": _prow("SE")},
        wire_rows=[_wrow("SE")],
        roster_syms={"SE"},
    )
    assert out["reported"] == 2
    assert out["on_feed_with_numbers"] == 1
    assert out["missing_from_feed"] == ["SLAB"]
    assert out["missing_not_on_roster"] == ["SLAB"]
    assert out["missing_on_roster"] == []
    assert out["ok"] is False


def test_a_roster_name_the_detector_has_not_written_is_detector_lag():
    out = coverage.assess(
        provider={"BGS": _prow("BGS")},
        wire_rows=[],
        roster_syms={"BGS"},
    )
    assert out["missing_from_feed"] == ["BGS"]
    assert out["missing_on_roster"] == ["BGS"]
    assert out["missing_not_on_roster"] == []


def test_a_feed_row_still_pending_while_the_provider_has_numbers():
    """On the wire, but the reader sees 'numbers pending…' although the
    provider already published — the upgrade path is what's lagging."""
    out = coverage.assess(
        provider={"CAH": _prow("CAH")},
        wire_rows=[_wrow("CAH", eps_act=None)],
        roster_syms={"CAH"},
    )
    assert out["missing_from_feed"] == []
    assert out["numbers_pending_on_feed"] == ["CAH"]
    assert out["ok"] is False


def test_a_revenue_only_reporter_showing_its_revenue_is_complete():
    """KOPN, 2026-08-11 (+22.6% on a revenue beat): the provider published
    revenue with NO EPS actual, and the feed row carried that revenue. An
    eps-null check called it pending FOREVER — nightly alert noise about a
    name showing everything there was to show. Pending must mean the feed
    lacks a figure the provider PUBLISHED, field by field."""
    out = coverage.assess(
        provider={"KOPN": _prow("KOPN", eps_act=None, rev_act=12_700_000)},
        wire_rows=[{"sym": "KOPN", "eps_act": None, "rev_act": 12.7,
                    "first_seen_at": 1000.0}],
        roster_syms={"KOPN"},
    )
    assert out["numbers_pending_on_feed"] == []
    assert out["on_feed_with_numbers"] == 1
    assert out["ok"] is True


def test_a_feed_row_lacking_only_the_published_revenue_is_still_pending():
    out = coverage.assess(
        provider={"CAH": _prow("CAH")},                     # eps AND rev published
        wire_rows=[_wrow("CAH", eps_act=1.0) | {"rev_act": None}],
        roster_syms={"CAH"},
    )
    assert out["numbers_pending_on_feed"] == ["CAH"]


def test_a_scheduled_reporter_without_actuals_is_not_missing():
    """No published actuals ⇒ it has not reported yet. Never in the denominator."""
    out = coverage.assess(
        provider={"NUE": _prow("NUE", eps_act=None, rev_act=None)},
        wire_rows=[],
        roster_syms={"NUE"},
    )
    assert out["reported"] == 0
    assert out["missing_from_feed"] == []
    assert out["scheduled_not_reported"] == 1
    assert out["ok"] is True


def test_everything_on_feed_reads_ok():
    out = coverage.assess(
        provider={"SE": _prow("SE"), "CAH": _prow("CAH")},
        wire_rows=[_wrow("SE"), _wrow("CAH")],
        roster_syms={"SE", "CAH"},
    )
    assert out["ok"] is True
    assert out["missing_from_feed"] == []
    assert out["numbers_pending_on_feed"] == []


# ── the I/O builder ───────────────────────────────────────────────────────────

def test_build_merges_both_provider_legs_and_applies_the_universe_gate(monkeypatch):
    import api.routers.calendar as cal
    monkeypatch.setattr(cal, "_load_cap_universe", lambda: CAP)
    # Finnhub knows BGS (with hour), FMP knows SLAB + an out-of-universe name.
    monkeypatch.setattr(cal, "_fh_get_month", lambda a, b: {"earningsCalendar": [
        {"symbol": "BGS", "date": MD, "hour": "amc",
         "epsActual": 0.5, "revenueActual": 1_000_000},
    ]})
    monkeypatch.setattr(cal, "_fmp_range_week",
                        lambda a, b: [_prow("SLAB"), _prow("600641.SS")])
    monkeypatch.setattr("api.services.wire.store.get_prints", lambda md: [_wrow("BGS")])
    monkeypatch.setattr("api.services.wire.detector.todays_reporters",
                        lambda md: [{"sym": "BGS"}])

    out = coverage.build_coverage(MD)

    assert out["measured"] is True
    assert out["reported"] == 2                      # BGS + SLAB, .SS gated out
    assert out["missing_from_feed"] == ["SLAB"]
    assert out["missing_not_on_roster"] == ["SLAB"]


def test_a_double_provider_failure_is_not_measured_and_invents_nothing(monkeypatch):
    import api.routers.calendar as cal
    monkeypatch.setattr(cal, "_load_cap_universe", lambda: CAP)
    monkeypatch.setattr(cal, "_fh_get_month", lambda a, b: None)
    monkeypatch.setattr(cal, "_fmp_range_week", lambda a, b: None)
    monkeypatch.setattr("api.services.wire.store.get_prints", lambda md: [_wrow("SE")])
    monkeypatch.setattr("api.services.wire.detector.todays_reporters", lambda md: [])

    out = coverage.build_coverage(MD)

    assert out["measured"] is False
    assert out["missing_from_feed"] == []
    assert "reported" not in out or out["reported"] is None


# ── the endpoint ──────────────────────────────────────────────────────────────

def test_endpoint_serves_the_assessment(monkeypatch):
    from api.routers import wire as wire_router
    wire_router._COVERAGE_STALE._slots.clear()
    wire_router.cache.invalidate(f"wire_coverage_{MD}")
    monkeypatch.setattr(coverage, "build_coverage",
                        lambda md: {"market_date": md, "measured": True, "ok": True,
                                    "reported": 0, "missing_from_feed": []})
    r = client.get(f"/api/calendar/wire-coverage?date={MD}")
    assert r.status_code == 200
    body = r.json()
    assert body["market_date"] == MD
    assert body["ok"] is True


def test_endpoint_rejects_a_malformed_date_without_a_provider_call(monkeypatch):
    from api.routers import wire as wire_router
    called = mock.Mock()
    monkeypatch.setattr(coverage, "build_coverage", called)
    r = client.get("/api/calendar/wire-coverage?date=nonsense")
    assert r.status_code == 200
    assert r.json()["measured"] is False
    called.assert_not_called()


def test_a_provider_zero_revenue_placeholder_is_not_a_published_figure():
    """TSHA, 2026-08-11: Finnhub coded 'no revenue figure' as
    `revenueActual: 0` beside a real EPS print. The repo-wide convention
    (`if rev_a:` on every provider leg) treats falsy revenue as absent —
    the check must too, or the name reads pending forever against a number
    that does not exist. An EPS of exactly 0.00 stays a real print."""
    out = coverage.assess(
        provider={"TSHA": _prow("TSHA", eps_act=-0.13, rev_act=0)},
        wire_rows=[{"sym": "TSHA", "eps_act": -0.13, "rev_act": None,
                    "first_seen_at": 1000.0}],
        roster_syms={"TSHA"},
    )
    assert out["numbers_pending_on_feed"] == []
    assert out["on_feed_with_numbers"] == 1
    assert out["ok"] is True

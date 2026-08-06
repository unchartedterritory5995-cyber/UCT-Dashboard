"""An unanswered history provider must never be reported as "no history".

Live defect (2026-08-06): the JAZZ earnings modal rendered "No reported
quarters yet" — a statement about the company — while Finnhub returned four
real quarters for it on a direct call seconds later. The enrichment fan-out
(3 Finnhub calls × up to 80 symbols into a ~55/min budget SHARED with live
member traffic) had shed that ticker's history call, and an empty
`beat_history` is indistinguishable from a genuine absence once it reaches
the client.

The short-TTL work already stops such a result from being SERVED for hours.
These tests cover the other half: it must not be STATED. `history_answered`
(service) → `history_unresolved` (enrichment payload) carries the difference.
"""
from unittest import mock

from api.routers import calendar as cal_mod
from api.services import earnings_estimates as ee


# ── the service-level signal ────────────────────────────────────────────────

def _intel_with(eps_raw):
    """Run get_earnings_intel with ONLY the Finnhub earnings leg scripted.

    The other two legs deliberately SUCCEED. That is both the real-world shape
    of this defect (JAZZ's consensus and price target were fine; only the
    history call was shed) and what keeps these tests non-vacuous: when all
    three legs fail, `get_earnings_intel` returns None via the negative-cache
    path, and an assertion guarded by `if intel is not None` would never run.
    Verified: with all legs failing this helper returns None.
    """
    def fake_fh(path, params=None):
        if path == "/stock/earnings":
            return eps_raw
        if path == "/stock/recommendation":
            return [{"buy": 12, "hold": 3, "sell": 0, "strongBuy": 5,
                     "strongSell": 0, "period": "2026-08-01"}]
        if path == "/stock/price-target":
            return {"targetHigh": 300, "targetLow": 200, "targetMean": 262,
                    "targetMedian": 260, "lastUpdated": "2026-08-01"}
        return None

    with mock.patch.object(ee, "_fh_get", side_effect=fake_fh), \
         mock.patch.object(ee, "cache") as c:
        c.get.return_value = None
        intel = ee.get_earnings_intel("TEST")
    assert intel is not None, (
        "helper returned None — the assertions below would be vacuous"
    )
    return intel


def test_a_list_from_finnhub_counts_as_an_answer_even_when_empty():
    """An empty LIST is the provider saying "nothing here" — a real answer.

    This is the case that must keep its honest "No reported quarters yet":
    a genuine pre-IPO / never-reported name. If this flipped to unresolved,
    the fix would just trade one wrong message for another.
    """
    assert _intel_with([])["history_answered"] is True


def test_real_quarters_are_an_answer():
    intel = _intel_with([
        {"period": "2026-06-30", "actual": 5.71, "estimate": 6.2986,
         "surprisePercent": -9.34},
    ])
    assert intel is not None
    assert intel["history_answered"] is True
    assert len(intel["beat_history"]) == 1


def test_a_shed_call_is_NOT_an_answer():
    """`_fh_get` returns None when the call was shed/failed — a shrug.

    This is the JAZZ case: beat_history comes back empty, but not because
    the company never reported.
    """
    assert _intel_with(None)["history_answered"] is False


# ── the payload the client actually reads ───────────────────────────────────

def _day(syms):
    return {"bmo": [{"sym": s} for s in syms], "amc": [], "tbd": []}


def _enrichment_payload(intel_return):
    """Build one day's enrichment with the intel leg scripted; return the dict
    that would be cached (i.e. what the client receives)."""
    with mock.patch("api.routers.calendar.cache") as mock_cache, \
         mock.patch.object(cal_mod, "_days_for_date", return_value=_day(["JAZZ"])), \
         mock.patch("api.services.earnings_estimates.get_earnings_intel",
                    return_value=intel_return), \
         mock.patch("api.services.earnings_estimates.fh_budget_denied_total",
                    return_value=0), \
         mock.patch("api.services.engine._fetch_quarterly_history", return_value=[]), \
         mock.patch("api.services.earnings_enrichment.get_historical_earnings_moves",
                    return_value=None):
        mock_cache.get.return_value = None
        out = cal_mod._build_enrichment_for_date(cal_mod._today_et().isoformat())
    return out or {}


def test_payload_flags_a_symbol_whose_history_leg_went_quiet():
    payload = _enrichment_payload({"beat_history": [], "consensus": None,
                                   "price_target": None,
                                   "history_answered": False})
    assert payload.get("JAZZ", {}).get("history_unresolved") is True


def test_payload_flags_a_symbol_whose_intel_failed_entirely():
    """`get_earnings_intel` returning None = all three legs failed."""
    payload = _enrichment_payload(None)
    assert payload.get("JAZZ", {}).get("history_unresolved") is True


def test_payload_does_not_flag_a_symbol_the_provider_answered():
    payload = _enrichment_payload({"beat_history": [], "consensus": None,
                                   "price_target": None,
                                   "history_answered": True})
    assert payload.get("JAZZ", {}).get("history_unresolved") is False


def test_an_older_cached_intel_without_the_key_is_read_as_answered():
    """Back-compat: `earnings_intel_*` entries written before this key existed
    are still in the cache for up to 6h. Treating a missing key as unresolved
    would paint "unavailable" across every symbol for a whole cache generation.
    """
    payload = _enrichment_payload({"beat_history": [{"period": "2026-06-30"}],
                                   "consensus": None, "price_target": None})
    assert payload.get("JAZZ", {}).get("history_unresolved") is False

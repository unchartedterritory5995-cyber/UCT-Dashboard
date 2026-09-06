"""Watchlist Intelligence V1 (owner authorization, Watchlist Intelligence
Convergence program). Deterministic facts composed from already-trusted
per-symbol services -- these tests pin: each source's fact fires/doesn't fire
correctly, a source failure degrades `status` honestly (never a silent "ok"
with facts quietly missing), `notable` is a plain OR over fired facts, missing
data never renders as a fabricated zero/delta, and the module never reaches
into S7 (alert_taxonomy) or pattern_vision, which this program does not touch.
"""
import ast
from pathlib import Path
from unittest import mock

import pytest

from api.services import watchlist_intelligence as wi


def _patch(target, **kw):
    return mock.patch(target, **kw)


class TestPriceMoveFact:
    def test_a_move_at_or_above_the_movers_threshold_fires(self):
        out = wi.get_intelligence_for_symbols(["NVDA"], {"NVDA": 3.0})
        kinds = [f["kind"] for f in out["NVDA"]["facts"]]
        assert "price_move" in kinds

    def test_a_move_below_the_threshold_does_not_fire(self):
        out = wi.get_intelligence_for_symbols(["NVDA"], {"NVDA": 1.5})
        kinds = [f["kind"] for f in out["NVDA"]["facts"]]
        assert "price_move" not in kinds

    def test_no_change_supplied_does_not_fire_and_does_not_crash(self):
        out = wi.get_intelligence_for_symbols(["NVDA"], {})
        assert out["NVDA"]["facts"] == [] or all(f["kind"] != "price_move" for f in out["NVDA"]["facts"])


class TestAnalystFact:
    def test_a_recent_action_fires_with_evidence_date_from_the_action_itself(self):
        with _patch("api.services.research.analyst_ratings.get_analyst_ratings", return_value={
            "recent_actions": {"items": [{"firm": "Piper Sandler", "action": "Upgrade to Overweight",
                                           "date": "2026-09-01"}],
                                "_meta": {"vendor": "FMP", "freshnessClass": "fresh"}},
        }):
            out = wi.get_intelligence_for_symbols(["NVDA"])
        facts = [f for f in out["NVDA"]["facts"] if f["kind"] == "analyst_action"]
        assert len(facts) == 1
        assert facts[0]["as_of"] == "2026-09-01"
        assert facts[0]["source"] == "FMP"
        assert facts[0]["freshness"] == "fresh"

    def test_no_recent_actions_does_not_fire(self):
        with _patch("api.services.research.analyst_ratings.get_analyst_ratings",
                    return_value={"recent_actions": {"items": [], "_meta": None}}):
            out = wi.get_intelligence_for_symbols(["NVDA"])
        assert all(f["kind"] != "analyst_action" for f in out["NVDA"]["facts"])

    def test_a_failure_degrades_status_and_does_not_crash_the_batch(self):
        with _patch("api.services.research.analyst_ratings.get_analyst_ratings",
                    side_effect=RuntimeError("boom")):
            out = wi.get_intelligence_for_symbols(["NVDA"])
        assert out["NVDA"]["status"] in ("partial", "unavailable")
        assert all(f["kind"] != "analyst_action" for f in out["NVDA"]["facts"])

    def test_an_outage_flavored_miss_degrades_status_not_a_silent_ok(self):
        """S9 (2026-09-06): before this fix, a total analyst-provider outage
        collapsed to the exact same {"items": [], ...} shape as a ticker with
        genuinely no analyst coverage -- no exception, so `sources_failed`
        never incremented and `status` stayed "ok". `get_analyst_ratings`
        now reports this via its `outage_out` side channel."""
        def _outage_flavored(sym, *, outage_out=None):
            if outage_out is not None:
                outage_out["outage"] = True
            return {"recent_actions": {"items": [], "_meta": None}}

        with _patch("api.services.research.analyst_ratings.get_analyst_ratings",
                    side_effect=_outage_flavored):
            out = wi.get_intelligence_for_symbols(["NVDA"])
        assert out["NVDA"]["status"] in ("partial", "unavailable")
        assert all(f["kind"] != "analyst_action" for f in out["NVDA"]["facts"])

    def test_a_genuine_no_coverage_miss_stays_ok(self):
        """The counterpart to the outage test above -- `outage_out` reporting
        False (or never being populated) must NOT degrade status; this is
        the existing `test_no_recent_actions_does_not_fire` scenario,
        reconfirmed against the new outage-aware code path."""
        def _no_coverage(sym, *, outage_out=None):
            if outage_out is not None:
                outage_out["outage"] = False
            return {"recent_actions": {"items": [], "_meta": None}}

        with _patch("api.services.research.analyst_ratings.get_analyst_ratings",
                    side_effect=_no_coverage):
            out = wi.get_intelligence_for_symbols(["NVDA"])
        assert out["NVDA"]["status"] == "ok"
        assert all(f["kind"] != "analyst_action" for f in out["NVDA"]["facts"])


class TestFilingFact:
    def test_a_filing_within_the_recency_window_fires(self):
        import datetime
        recent = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
        with _patch("api.services.sec_filings.recent_filings",
                    return_value={"filings": [{"form": "8-K", "filed": recent, "accession": "x"}]}):
            out = wi.get_intelligence_for_symbols(["NVDA"])
        facts = [f for f in out["NVDA"]["facts"] if f["kind"] == "new_filing"]
        assert len(facts) == 1
        assert facts[0]["as_of"] == recent

    def test_an_old_filing_does_not_fire(self):
        import datetime
        old = (datetime.date.today() - datetime.timedelta(days=90)).isoformat()
        with _patch("api.services.sec_filings.recent_filings",
                    return_value={"filings": [{"form": "10-K", "filed": old, "accession": "x"}]}):
            out = wi.get_intelligence_for_symbols(["NVDA"])
        assert all(f["kind"] != "new_filing" for f in out["NVDA"]["facts"])

    def test_a_provider_error_dict_is_treated_as_a_failure_not_a_silent_empty(self):
        with _patch("api.services.sec_filings.recent_filings",
                    return_value={"error": "ticker not found"}):
            out = wi.get_intelligence_for_symbols(["ZZZZ"])
        assert out["ZZZZ"]["status"] in ("partial", "unavailable")
        assert all(f["kind"] != "new_filing" for f in out["ZZZZ"]["facts"])


class TestEarningsProximityFact:
    def test_reporting_tomorrow_fires_with_the_actual_report_date(self):
        import datetime
        today = datetime.date.today()
        tomorrow = today + datetime.timedelta(days=1)

        def fake_reporters(date_str):
            return ({"NVDA"}, True) if date_str == tomorrow.isoformat() else (set(), True)

        with _patch("api.services.calendar_alerts._get_reporters_for_date_with_status", side_effect=fake_reporters):
            out = wi.get_intelligence_for_symbols(["NVDA"])
        facts = [f for f in out["NVDA"]["facts"] if f["kind"] == "earnings_proximity"]
        assert len(facts) == 1
        assert facts[0]["as_of"] == tomorrow.isoformat()

    def test_reporting_outside_the_proximity_window_does_not_fire(self):
        import datetime
        far = datetime.date.today() + datetime.timedelta(days=wi._EARNINGS_PROXIMITY_DAYS + 5)

        def fake_reporters(date_str):
            return ({"NVDA"}, True) if date_str == far.isoformat() else (set(), True)

        with _patch("api.services.calendar_alerts._get_reporters_for_date_with_status", side_effect=fake_reporters):
            out = wi.get_intelligence_for_symbols(["NVDA"])
        assert all(f["kind"] != "earnings_proximity" for f in out["NVDA"]["facts"])


class TestEarningsSourceIntegrity:
    """S9 (2026-09-06): `_get_reporters_for_date`'s 3-leg fallback (cache ->
    Finnhub -> FMP) never raises by design, so `_earnings_facts()`'s own
    try/except around it was unreachable dead code -- a total outage on any
    window day was indistinguishable from a genuinely quiet week, and
    `status` never degraded. These pin the fix: a day whose lookup could not
    be trusted must degrade every requested symbol's status, and a day that
    ran cleanly (even with an empty answer) must not."""

    def test_a_failed_window_day_degrades_every_requested_symbol(self):
        def fake_reporters(date_str):
            return set(), False  # every day: leg ran, but not trustworthily

        with _patch("api.services.research.analyst_ratings.get_analyst_ratings",
                    return_value={"recent_actions": {"items": [], "_meta": None}}), \
             _patch("api.services.sec_filings.recent_filings", return_value={"filings": []}), \
             _patch("api.services.calendar_alerts._get_reporters_for_date_with_status",
                    side_effect=fake_reporters):
            out = wi.get_intelligence_for_symbols(["NVDA", "AAPL"])
        for sym in ("NVDA", "AAPL"):
            # Analyst and filing legs above are stubbed healthy-empty, so
            # ANY degradation here is provably attributable to the earnings
            # leg alone -- the fact this fix specifically addresses.
            assert out[sym]["status"] == "partial", sym
            assert all(f["kind"] != "earnings_proximity" for f in out[sym]["facts"]), sym

    def test_a_genuinely_quiet_week_stays_ok(self):
        def fake_reporters(date_str):
            return set(), True  # every day: leg ran cleanly, legitimately empty

        with _patch("api.services.research.analyst_ratings.get_analyst_ratings",
                    return_value={"recent_actions": {"items": [], "_meta": None}}), \
             _patch("api.services.sec_filings.recent_filings", return_value={"filings": []}), \
             _patch("api.services.calendar_alerts._get_reporters_for_date_with_status",
                    side_effect=fake_reporters):
            out = wi.get_intelligence_for_symbols(["NVDA"])
        assert out["NVDA"]["status"] == "ok"


class TestNotableIsAPlainOr:
    def test_notable_true_iff_any_fact_fired(self):
        with _patch("api.services.research.analyst_ratings.get_analyst_ratings",
                    return_value={"recent_actions": {"items": [], "_meta": None}}), \
             _patch("api.services.sec_filings.recent_filings", return_value={"filings": []}), \
             _patch("api.services.calendar_alerts._get_reporters_for_date_with_status", return_value=(set(), True)):
            out = wi.get_intelligence_for_symbols(["NVDA"], {"NVDA": 0.1})
        assert out["NVDA"]["notable"] is False
        assert out["NVDA"]["facts"] == []

        out2 = wi.get_intelligence_for_symbols(["NVDA"], {"NVDA": 5.0})
        assert out2["NVDA"]["notable"] is True
        assert len(out2["NVDA"]["facts"]) >= 1


class TestMissingDataNeverBecomesZero:
    def test_a_missing_rating_or_rs_rank_stays_none_never_zero(self):
        with _patch("api.services.research.ratings.get_ratings", return_value={}), \
             _patch("api.services.rs_ranking.get_rs_for_ticker", return_value=None):
            out = wi.get_intelligence_for_symbols(["NVDA"])
        assert out["NVDA"]["context"]["composite_rating"] is None
        assert out["NVDA"]["context"]["rs_rank"] is None

    def test_a_context_source_failure_never_crashes_or_fabricates_a_value(self):
        with _patch("api.services.research.ratings.get_ratings", side_effect=RuntimeError("boom")):
            out = wi.get_intelligence_for_symbols(["NVDA"])
        assert out["NVDA"]["context"]["composite_rating"] is None


class TestBatchShape:
    def test_empty_input_returns_empty_dict(self):
        assert wi.get_intelligence_for_symbols([]) == {}

    def test_dedupes_and_uppercases_symbols(self):
        with _patch("api.services.research.analyst_ratings.get_analyst_ratings",
                    return_value={"recent_actions": {"items": [], "_meta": None}}), \
             _patch("api.services.sec_filings.recent_filings", return_value={"filings": []}), \
             _patch("api.services.calendar_alerts._get_reporters_for_date_with_status", return_value=(set(), True)):
            out = wi.get_intelligence_for_symbols(["nvda", "NVDA", " nvda "])
        assert list(out.keys()) == ["NVDA"]


class TestNoS7OrPatternVisionImport:
    """Watchlist Intelligence must be independently shippable: it reads
    sec_filings.py directly (a shared read-only module S7 also happens to
    use), but must never import S7's own predicate/evaluator machinery or
    pattern_vision, both of which this program is explicitly forbidden from
    touching."""

    def test_module_source_never_imports_alert_taxonomy_or_pattern_vision(self):
        src = Path(wi.__file__).read_text(encoding="utf-8")
        tree = ast.parse(src)
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(a.name for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module)
        offenders = [m for m in imported if "alert_taxonomy" in m or "pattern_vision" in m]
        assert offenders == [], f"forbidden import(s) found: {offenders}"

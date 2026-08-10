"""`analyst_actions` measured a market fact, not a coverage fact.

The monitor exists because two Finnhub endpoints returned 403 on EVERY call for
months — a provider silently answering nothing. But `_analyst_actions_rate`
asked `finnhub_recent_action(sym)`, which is "did this ticker get RE-RATED in
the last 36h" (day-granular via FMP: ~2 calendar days), and graded 8 megacaps
against a 50% floor.

Live probe of FMP `stable/grades`, 2026-08-09 (a Sunday), 8 megacaps: every one
answered with real rows (488–1784 of them), and the newest grade was 6, 9, 9,
10, 17, 26, 33 and 68 days old. Zero fell inside the window. The provider was
perfectly healthy and the field read 0%, which is why it alerted at 22:07 and
again at 22:16 — and would have alerted every weekend forever.

Requiring 4 of 8 megacaps to be re-rated within ~2 calendar days is not
satisfiable on any normal day, let alone a Saturday. A monitor that cannot
report green is as broken as one that cannot report red: it trains the reader
to ignore the channel, and tonight it did — it shipped alongside the REAL
`avg_vol` hole in the same embed.

So the field now measures what actually regressed in the incident: does a
provider return a usable grades payload AT ALL. Recency of the newest rating
action is market activity, not data coverage, and nothing in this repo controls
it.
"""
import importlib

import pytest


def _mod():
    import api.services.provider_coverage_monitor as pcm
    importlib.reload(pcm)
    return pcm


# ── the unit: reachability, deliberately independent of recency ──────────────
class TestAnalystGradesAvailable:
    def _aa(self):
        import api.services.catalyst.analyst_actions as aa
        return aa

    def test_a_years_old_grade_still_counts_as_the_provider_answering(self, monkeypatch):
        """META's newest grade was 68 days old on the night this fired. The
        provider answered with 488 rows — that is coverage. Treating it as a
        miss is the false positive."""
        aa = self._aa()
        monkeypatch.setattr(aa, "_fmp_get",
                            lambda path, params, timeout=None: [{"date": "2026-06-02",
                                                                 "gradingCompany": "Arete"}])
        assert aa.analyst_grades_available("META") is True

    def test_empty_fmp_falls_through_to_finnhub(self, monkeypatch):
        aa = self._aa()
        monkeypatch.setattr(aa, "_fmp_get", lambda path, params, timeout=None: [])
        monkeypatch.setattr(aa, "fh_get",
                            lambda path, params, timeout=None: [{"gradeTime": 1}])
        assert aa.analyst_grades_available("AAPL") is True

    def test_both_providers_silent_is_false(self, monkeypatch):
        """The 2026-08-05 incident shape: every call answers with nothing."""
        aa = self._aa()
        monkeypatch.setattr(aa, "_fmp_get", lambda path, params, timeout=None: None)
        monkeypatch.setattr(aa, "fh_get", lambda path, params, timeout=None: None)
        assert aa.analyst_grades_available("AAPL") is False

    def test_blank_ticker_is_false_without_calling_a_provider(self, monkeypatch):
        aa = self._aa()
        called = []
        monkeypatch.setattr(aa, "_fmp_get",
                            lambda *a, **kw: called.append(1) or [])
        assert aa.analyst_grades_available("") is False
        assert called == []


# ── the rate the monitor grades ──────────────────────────────────────────────
class TestAnalystActionsRate:
    def test_a_quiet_tape_with_a_live_provider_reads_full_coverage(self, monkeypatch):
        """The weekend case. Nothing was re-rated; every provider answered."""
        pcm = _mod()
        import api.services.catalyst.analyst_actions as aa
        monkeypatch.setattr(aa, "analyst_grades_available", lambda t: True)
        monkeypatch.setattr(aa, "finnhub_recent_action", lambda t, **kw: None)

        r = pcm._analyst_actions_rate(["AAPL", "NVDA", "MSFT"])

        assert r["observed"] == 1.0
        assert r["sample"] == 3
        assert pcm._evaluate_field("analyst_actions", r["observed"], r["sample"],
                                   baseline=None, provider_moved=False) is None

    def test_a_dead_provider_still_reads_zero_and_is_still_a_defect(self, monkeypatch):
        """CONTROL — the whole point of the field. Loosening it must not make
        it unable to fail (`lesson_gate_that_cannot_fail`): the exact incident
        it was built for has to still fire."""
        pcm = _mod()
        import api.services.catalyst.analyst_actions as aa
        monkeypatch.setattr(aa, "analyst_grades_available", lambda t: False)

        r = pcm._analyst_actions_rate(["AAPL", "NVDA", "MSFT"])

        assert r["observed"] == 0.0
        d = pcm._evaluate_field("analyst_actions", r["observed"], r["sample"],
                                baseline=None, provider_moved=False)
        assert d is not None and d["kind"] == "blank"

    def test_a_partial_provider_outage_breaches_the_floor(self, monkeypatch):
        """Half the sample unanswered is a real degradation, not a quiet tape."""
        pcm = _mod()
        import api.services.catalyst.analyst_actions as aa
        alive = {"AAPL", "NVDA"}
        monkeypatch.setattr(aa, "analyst_grades_available", lambda t: t in alive)

        r = pcm._analyst_actions_rate(["AAPL", "NVDA", "MSFT", "AMZN"])

        assert r["observed"] == 0.5
        d = pcm._evaluate_field("analyst_actions", r["observed"], r["sample"],
                                baseline=None, provider_moved=False)
        assert d is not None and d["kind"] == "floor_breach"

    def test_the_field_no_longer_grades_recency(self, monkeypatch):
        """Derived, not typed: the rate function must not reach for
        `finnhub_recent_action` at all — that call is what made a Sunday look
        like an outage. Asserted on the bytecode's referenced names so a
        mention in a comment or docstring cannot pass this."""
        pcm = _mod()
        assert "finnhub_recent_action" not in pcm._analyst_actions_rate.__code__.co_names
        assert "analyst_grades_available" in pcm._analyst_actions_rate.__code__.co_names

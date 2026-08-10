"""A refusal is the bound working — it must not read as a provider outage.

`implied_move` keeps a closed, three-word vocabulary and its `outcome_kind`
docstring says why: `refused` is "we could not price this", `unavailable` is
"we did not get to try", and the two are "the same distinction the coverage
work draws between `dropped` and `not_computable`".

The calendar honours that. Its collapse detector is
`em_collapsed = (not is_past) and len(syms) > 0 and with_em == 0 and em_refused == 0`
— a day whose zero is explained by refusals is NOT a collapse, and live it
reports `em_collapsed: false` on every upcoming date. The comment beside it
states the rule outright:

    "any monitor that alerts on fewer rows than reporters needs to read
     `refused` before it fires"

`provider_coverage_monitor._enrichment_with_em_rate` was that monitor and did
not read it. It computed `with_em / total`, so a day where the pricing bound
correctly declined 52 of 58 names reported ~0% and tripped the blank detector.
Live on 2026-08-10: 58/50/44 reporters with 52/47/39 refusals — the field read
0% while nothing was broken.

This is the THIRD field in one night graded on something other than "did we
fetch it" (see `analyst_actions` recency, and the paged-week session decay).
Refusals therefore leave the DENOMINATOR entirely: coverage is measured over
the names we actually tried to price.
"""
import importlib

import pytest


def _mod():
    import api.services.provider_coverage_monitor as pcm
    importlib.reload(pcm)
    return pcm


def _stats(monkeypatch, pcm, dates):
    monkeypatch.setattr(
        "api.routers.calendar.calendar_enrichment_status",
        lambda: {"dates": dates},
    )
    return pcm._enrichment_with_em_rate()


class TestRefusalsLeaveTheDenominator:
    def test_a_day_the_bound_declined_is_not_a_blank(self, monkeypatch):
        """The live shape: 58 reporters, 52 refused, 1 priced. Only 6 were
        actually attempted, so coverage is 1/6 — not 1/58, and emphatically
        not a 'blank' that alerts."""
        pcm = _mod()
        r = _stats(monkeypatch, pcm,
                   {"2026-08-11": {"total": 58, "with_em": 1, "em_refused": 52}})
        assert r["sample"] == 6
        assert r["observed"] == pytest.approx(1 / 6)

    def test_an_all_refused_day_is_NOT_MEASURED_rather_than_zero(self, monkeypatch):
        """Every name declined leaves nothing to judge. That must read as
        'not measured' (sample 0), which `_evaluate_field` already treats as a
        non-defect — never as a fabricated 0%."""
        pcm = _mod()
        r = _stats(monkeypatch, pcm,
                   {"2026-08-13": {"total": 44, "with_em": 0, "em_refused": 44}})
        assert r["sample"] == 0
        assert r["observed"] is None
        assert pcm._evaluate_field("enrichment_with_em", r["observed"], r["sample"],
                                   baseline=None, provider_moved=False) is None

    def test_a_REAL_universe_wide_outage_still_reads_zero_and_alerts(self, monkeypatch):
        """CONTROL — the whole point of the field. With no refusals to explain
        it, every name unpriced is exactly the yfinance option-chain collapse
        this was built to catch, and it must still fire."""
        pcm = _mod()
        r = _stats(monkeypatch, pcm,
                   {"2026-08-13": {"total": 44, "with_em": 0, "em_refused": 0}})
        assert r["sample"] == 44
        assert r["observed"] == 0.0
        d = pcm._evaluate_field("enrichment_with_em", r["observed"], r["sample"],
                                baseline=None, provider_moved=False)
        assert d is not None and d["kind"] == "blank"

    def test_a_partial_outage_beside_refusals_is_still_visible(self, monkeypatch):
        """Refusals must not become a blanket excuse: 20 attempted, 2 priced is
        a real 10% that the drop detector can still act on."""
        pcm = _mod()
        r = _stats(monkeypatch, pcm,
                   {"2026-08-13": {"total": 50, "with_em": 2, "em_refused": 30}})
        assert r["sample"] == 20
        assert r["observed"] == pytest.approx(0.1)

    def test_a_missing_refusal_count_degrades_to_the_old_reading(self, monkeypatch):
        """Older cached stats predate the `em_refused` key. Absent it, fall
        back to total — never treat a missing count as 'everything refused',
        which would silently switch the field off."""
        pcm = _mod()
        r = _stats(monkeypatch, pcm, {"2026-08-13": {"total": 40, "with_em": 4}})
        assert r["sample"] == 40
        assert r["observed"] == pytest.approx(0.1)

    def test_refusals_are_read_from_the_stats_not_recomputed(self):
        """Derived, not restated: the count comes from the payload the calendar
        publishes. Re-deriving it here would put a second authority on 'what
        counts as a refusal' — the defect this repo keeps paying for."""
        pcm = _mod()
        names = pcm._enrichment_with_em_rate.__code__.co_names
        assert "em_refused" in pcm._enrichment_with_em_rate.__code__.co_consts + names, \
            "the rate must read the published em_refused key"
        assert "REFUSAL_REASONS" not in names, "must not re-derive refusal semantics"

"""The warm ranks candidates by (is-tracked, market-cap) and then hands them to a
3-worker FIFO pool — so SUBMIT ORDER, not the sorted list, is what decides who is
warm when a reader clicks.

Until 2026-08-23 `_run` queued EVERY preview and only then looped again for the
companions (Profile + Catalysts). The #1-ranked reporter's Profile therefore sat
behind up to `top_n` preview generations; at ~30s each across 3 workers that is
~30 minutes before the biggest name on the board even STARTED its Profile. The
ranking was computed correctly and discarded by the queue — invisible to every
test, because each piece worked.

Also pinned here: a sub-$300M reporter is DEMOTED, not dropped (owner call —
"every reporter you can see"), since a visible tile that opens to a 30s spinner
is the reported complaint.
"""
from unittest import mock

import pytest

from api.services import earnings_preview_warm as warm


@pytest.fixture
def submissions(monkeypatch):
    """Record what gets submitted to the pool, in order, without running it."""
    calls = []

    class _Pool:
        def submit(self, fn, *a, **kw):
            if fn is warm._safe_companions:
                calls.append(("companions", a[0]))
            else:
                calls.append(("preview", a[1]))     # (_safe_gen, generator, sym, row)
            return mock.Mock()

    monkeypatch.setattr(warm, "_POOL", _Pool())
    monkeypatch.setenv("EARNINGS_WARM_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(warm.earnings_ai_store, "age", lambda kind, sym: None)
    monkeypatch.setattr(warm, "_needs_companion", lambda sym: True)
    return calls


def _ranked(*syms):
    return [{"sym": s, "mc_b": float(1000 - i), "_is_tracked": False}
            for i, s in enumerate(syms)]


class TestSubmitOrderPreservesRank:
    def test_a_names_companions_are_queued_before_the_next_names_preview(
        self, monkeypatch, submissions
    ):
        monkeypatch.setattr(warm, "_rank", lambda *a, **k: _ranked("NVDA", "CRM", "OKTA"))
        monkeypatch.setattr(warm, "_tracked_union", set)
        warm._run("preview", lambda *a, **k: None, reported=False)

        # NVDA's three jobs must all precede anything for CRM.
        first_crm = next(i for i, (_, s) in enumerate(submissions) if s == "CRM")
        nvda_jobs = [i for i, (_, s) in enumerate(submissions) if s == "NVDA"]
        assert nvda_jobs, "the top-ranked name was never submitted"
        assert max(nvda_jobs) < first_crm, (
            f"NVDA's companions queue AFTER CRM's work: {submissions} — "
            "rank is computed and then thrown away by the queue"
        )

    def test_every_chosen_name_gets_both_a_preview_and_its_companions(
        self, monkeypatch, submissions
    ):
        monkeypatch.setattr(warm, "_rank", lambda *a, **k: _ranked("NVDA", "CRM"))
        monkeypatch.setattr(warm, "_tracked_union", set)
        warm._run("preview", lambda *a, **k: None, reported=False)

        for sym in ("NVDA", "CRM"):
            kinds = {k for k, s in submissions if s == sym}
            assert kinds == {"preview", "companions"}, f"{sym} got only {kinds}"

    def test_a_fresh_preview_still_lets_its_companions_through(
        self, monkeypatch, submissions
    ):
        """Skip-if-stable applies to the PREVIEW only. A name whose preview is
        fresh can still have a cold Profile — that pairing is what left the
        biggest names' companion tabs cold for hours."""
        monkeypatch.setattr(warm, "_rank", lambda *a, **k: _ranked("NVDA"))
        monkeypatch.setattr(warm, "_tracked_union", set)
        monkeypatch.setattr(warm.earnings_ai_store, "age", lambda kind, sym: 0)  # very fresh
        res = warm._run("preview", lambda *a, **k: None, reported=False)

        assert res["recent"] == 1 and res["submitted"] == 0
        assert ("companions", "NVDA") in submissions


class TestSubFloorNamesAreDemotedNotDropped:
    def _rank_with(self, monkeypatch, entries, tracked=frozenset()):
        """Drive the real `_rank` over a stubbed one-day calendar."""
        import datetime as dt
        monkeypatch.setattr(warm, "_MIN_MC_B", 0.3)
        cal = {"days": {"2026-08-26": {"bmo": entries, "amc": [], "tbd": []}}}
        with mock.patch("api.routers.calendar.get_calendar", return_value=cal), \
             mock.patch("api.routers.calendar.get_day_metrics", return_value={}), \
             mock.patch("api.routers.calendar._week_dates",
                        return_value=[dt.date(2026, 8, 24)]):
            return warm._rank(1, reported=False, tracked=set(tracked))

    def test_a_microcap_reporter_is_still_warmed(self, monkeypatch):
        monkeypatch.delenv("EARNINGS_WARM_DROP_BELOW_FLOOR", raising=False)
        rows = self._rank_with(monkeypatch, [
            {"sym": "NVDA", "eps_est": 2.0, "mc_b": 5000.0},
            {"sym": "TINY", "eps_est": 0.1, "mc_b": 0.05},
        ])
        syms = [r["sym"] for r in rows]
        assert "TINY" in syms, "a visible tile was dropped from the warm set"

    def test_the_microcap_ranks_last(self, monkeypatch):
        monkeypatch.delenv("EARNINGS_WARM_DROP_BELOW_FLOOR", raising=False)
        rows = self._rank_with(monkeypatch, [
            {"sym": "TINY", "eps_est": 0.1, "mc_b": 0.05},
            {"sym": "NVDA", "eps_est": 2.0, "mc_b": 5000.0},
        ])
        assert [r["sym"] for r in rows] == ["NVDA", "TINY"]

    def test_the_old_hard_drop_is_restorable_by_env(self, monkeypatch):
        monkeypatch.setenv("EARNINGS_WARM_DROP_BELOW_FLOOR", "1")
        rows = self._rank_with(monkeypatch, [
            {"sym": "NVDA", "eps_est": 2.0, "mc_b": 5000.0},
            {"sym": "TINY", "eps_est": 0.1, "mc_b": 0.05},
        ])
        assert [r["sym"] for r in rows] == ["NVDA"]

    def test_a_tracked_microcap_outranks_an_untracked_megacap(self, monkeypatch):
        rows = self._rank_with(monkeypatch, [
            {"sym": "NVDA", "eps_est": 2.0, "mc_b": 5000.0},
            {"sym": "TINY", "eps_est": 0.1, "mc_b": 0.05},
        ], tracked={"TINY"})
        assert [r["sym"] for r in rows] == ["TINY", "NVDA"]

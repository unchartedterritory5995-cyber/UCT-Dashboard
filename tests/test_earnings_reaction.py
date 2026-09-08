"""Earnings-day reaction — the Company Panel's reaction strip had no backend.

The strip reads `intel.reaction` and `/api/earnings-intel/{sym}` never carried
the key, so it rendered nothing for every symbol since it shipped.
"""
import pytest

from api.services import earnings_reaction as er


def _bars(rows):
    """rows: [(date, open, close)] -> the bar shape bars_fetch returns."""
    return [{"t": d, "o": o, "h": max(o, c), "l": min(o, c), "c": c, "v": 1}
            for d, o, c in rows]


@pytest.fixture()
def patched(monkeypatch):
    def use(rows):
        monkeypatch.setattr(er, "_daily_bars", lambda sym, since: _bars(rows))
    return use


def _q(label, day, **kw):
    return {"label": label, "report_date": day, "reported": True,
            "eps_actual": kw.get("eps_actual", 1.0),
            "eps_estimate": kw.get("eps_estimate", 0.9)}


class TestDefinition:
    def test_takes_the_larger_magnitude_move_when_timing_is_unknown(self, patched):
        # prior close 100 -> report open 105  = +5%   (pre-market reading)
        # report close 100 -> next open 90    = -10%  (post-market reading)
        patched([("2026-01-01", 100, 100),
                 ("2026-01-02", 105, 100),
                 ("2026-01-03", 90, 90)])
        out = er.reaction_for("X", [_q("Q1", "2026-01-02")], min_computed=1)
        assert out["events"][0]["reaction_pct"] == pytest.approx(-10.0, abs=0.01)

    def test_uses_the_pre_market_reading_when_it_is_the_larger(self, patched):
        patched([("2026-01-01", 100, 100),
                 ("2026-01-02", 120, 100),
                 ("2026-01-03", 101, 101)])
        out = er.reaction_for("X", [_q("Q1", "2026-01-02")], min_computed=1)
        assert out["events"][0]["reaction_pct"] == pytest.approx(20.0, abs=0.01)

    def test_a_report_on_a_weekend_uses_the_NEXT_session(self, patched):
        """Providers report the filing date, not a session. The reaction belongs
        to the first session that could price the news, never the one before."""
        patched([("2026-01-02", 100, 100),      # Fri
                 ("2026-01-05", 110, 110)])     # Mon
        out = er.reaction_for("X", [_q("Q1", "2026-01-03")], min_computed=1)   # Sat
        assert out["events"][0]["reaction_pct"] == pytest.approx(10.0, abs=0.01)


class TestGapsAndAlignment:
    def test_an_uncomputable_quarter_keeps_its_slot(self, patched):
        """Dropping it would compact the list and re-pair every older quarter
        with a newer quarter's move."""
        patched([("2026-01-01", 100, 100),
                 ("2026-01-02", 110, 100),
                 ("2026-01-03", 100, 100)])
        qs = [_q("Q2", "2026-01-02"), _q("Q1", "2020-01-01")]   # Q1 out of frame
        out = er.reaction_for("X", qs, min_computed=1)
        assert len(out["events"]) == 2
        assert out["events"][0]["quarter"] == "Q1"       # newest LAST
        assert out["events"][0]["reaction_pct"] is None  # the gap kept its slot
        assert out["events"][1]["reaction_pct"] is not None

    def test_events_are_newest_last_so_the_strip_reads_in_time(self, patched):
        patched([("2026-01-01", 100, 100), ("2026-01-02", 110, 100),
                 ("2026-01-03", 100, 100), ("2026-01-06", 120, 100)])
        out = er.reaction_for("X", [_q("Q2", "2026-01-06"), _q("Q1", "2026-01-02")], min_computed=1)
        assert [e["quarter"] for e in out["events"]] == ["Q1", "Q2"]

    def test_average_ignores_gaps_rather_than_counting_them_as_zero(self, patched):
        patched([("2026-01-01", 100, 100),
                 ("2026-01-02", 110, 100),
                 ("2026-01-03", 100, 100)])
        out = er.reaction_for("X", [_q("Q2", "2026-01-02"), _q("Q1", "2019-01-01")], min_computed=1)
        assert out["n_quarters"] == 1
        assert out["avg_abs_move_pct"] == pytest.approx(10.0, abs=0.01)


class TestSurvivability:
    def test_no_reported_quarters_returns_none(self, patched):
        patched([("2026-01-01", 100, 100)])
        assert er.reaction_for("X", []) is None
        assert er.reaction_for("X", [{"reported": False, "report_date": "2026-01-02"}]) is None

    def test_no_bars_returns_none_rather_than_raising(self, monkeypatch):
        monkeypatch.setattr(er, "_daily_bars", lambda sym, since: [])
        assert er.reaction_for("X", [_q("Q1", "2026-01-02")], min_computed=1) is None

    def test_a_bars_failure_returns_empty_instead_of_raising(self, monkeypatch):
        """The REAL _daily_bars must swallow a bars-path failure. One block of
        the Earnings tab going missing is acceptable; taking the whole payload
        down with it is not."""
        import sys, types
        fake = types.ModuleType("api.services.bars_fetch")
        fake.daily_bars_needed_since = lambda *a, **k: 500

        def boom(*a, **k):
            raise RuntimeError("bars are down")
        fake._get_bars_inner = boom
        monkeypatch.setitem(sys.modules, "api.services.bars_fetch", fake)

        assert er._daily_bars("X", "2026-01-01") == []
        assert er.reaction_for("X", [_q("Q1", "2026-01-02")], min_computed=1) is None

    def test_intel_survives_a_reaction_failure(self):
        """earnings_intel wraps the call so a raise there cannot blank the tab."""
        import inspect
        from api.services import earnings_intel
        src = inspect.getsource(earnings_intel)
        i = src.index("earnings_reaction as _er")
        window = src[i - 200:i + 400]
        assert "try:" in window and "except Exception" in window
        assert "reaction = None" in window

    def test_zero_prior_close_does_not_divide_by_zero(self, patched):
        patched([("2026-01-01", 0, 0), ("2026-01-02", 5, 5)])
        out = er.reaction_for("X", [_q("Q1", "2026-01-02")], min_computed=1)
        assert out is None or out["events"][0]["reaction_pct"] is None

    def test_window_is_capped(self, patched):
        patched([(f"2026-01-{d:02d}", 100, 100) for d in range(1, 29)])
        qs = [_q(f"Q{i}", f"2026-01-{i:02d}") for i in range(2, 20)]
        out = er.reaction_for("X", qs, limit=8)
        assert len(out["events"]) == 8


class TestSampleSizeFloor:
    """Gaps are honest; a strip that is MOSTLY gaps is not.

    NVDA measured 2 computed moves of 8 in production -- its cached daily
    history only reached 2025-12, so six earnings dates sat outside the price
    frame. Two bars and six holes still reads as a pattern to a viewer.
    """

    def test_withdraws_the_strip_when_too_few_quarters_compute(self, patched):
        patched([("2026-01-01", 100, 100),
                 ("2026-01-02", 110, 100),
                 ("2026-01-03", 100, 100)])
        qs = [_q("Q1", "2026-01-02")] + [_q(f"Q{i}", f"2019-01-{i:02d}")
                                         for i in range(2, 9)]
        assert er.reaction_for("X", qs) is None      # 1 of 8 computed

    def test_shows_the_strip_once_enough_quarters_compute(self, patched):
        rows, qs = [], []
        for i in range(1, 12):
            rows.append((f"2026-01-{i:02d}", 100 + i, 100))
        patched(rows)
        for i in range(2, 8):
            qs.append(_q(f"Q{i}", f"2026-01-{i:02d}"))
        out = er.reaction_for("X", qs)
        assert out is not None
        assert out["n_quarters"] >= er.MIN_COMPUTED

    def test_the_floor_is_four(self):
        assert er.MIN_COMPUTED == 4


class TestCacheVersion:
    def test_kind_was_bumped_for_the_new_field(self):
        """A shape change must invalidate persisted snapshots, or every cached
        v7 payload keeps serving without `reaction` for its whole TTL."""
        from api.services import earnings_intel
        assert earnings_intel._KIND == "earnings_intel_v8"

    def test_payload_carries_the_reaction_key(self):
        import inspect
        from api.services import earnings_intel
        src = inspect.getsource(earnings_intel)
        assert '"reaction": reaction,' in src

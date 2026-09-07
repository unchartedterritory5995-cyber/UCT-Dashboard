"""The normalized earnings model — assembly, joins and the audit's backend bugs.

Providers are stubbed so these are deterministic and offline: the point is the
NORMALIZATION (fiscal identity, the tier join, growth semantics, acceleration,
beat streaks, cache freshness), not whether FMP answered.

Every fixture uses Micron's real fiscal calendar — a 52/53-week August year end —
because that is the shape the previous calendar-quarter assumption got wrong.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from api.services import earnings_intel as ei
from api.services.fiscal_calendar import FiscalCalendar


# ── fixtures ────────────────────────────────────────────────────────────────
MU_ANNUAL = ["2025-08-28", "2024-08-29", "2023-08-31"]        # newest first
MU_QUARTERS = ["2026-05-28", "2026-02-26", "2025-11-27", "2025-08-28",
               "2025-05-29", "2025-02-27", "2024-11-28", "2024-08-29"]


def _statements(annual=MU_ANNUAL, quarters=MU_QUARTERS, values=None):
    """A financial_statements-shaped payload.

    Quarters not named in `values` still carry a token revenue: a period with no
    revenue AND no EPS is dropped as an empty row (yfinance returns such columns
    — Walmart's 2025-01-31), so a blank default would silently empty the fixture.
    """
    values = values or {}
    return {
        "income": {
            "annual": [{"period": p, "values": {}} for p in annual],
            "quarterly": [{"period": p, "values": values.get(p, _q(p, revenue=1.0))}
                          for p in quarters],
        },
        "meta": {"fiscal_year_end": "08-28"},
    }


def _q(period, revenue=None, net_income=None, eps=None):
    return {"revenue": revenue, "net_income": net_income, "eps_diluted": eps}


@pytest.fixture
def stub(monkeypatch):
    """Install stubbed providers; returns a knob object the test can set."""
    class Knobs:
        statements = _statements()
        year_earnings: dict = {}
        forward: list = []
        annual: list = []

    k = Knobs()
    monkeypatch.setattr("api.services.financial_statements.get_statements",
                        lambda sym: k.statements)
    import api.services.earnings_estimates as ee
    monkeypatch.setattr(ee, "get_year_earnings",
                        lambda sym, year, **kw: k.year_earnings.get(year, []))
    import api.services.earnings_table as et
    monkeypatch.setattr(et, "_forward_quarters", lambda sym, limit, *a, **kw: k.forward)
    import api.services.annual_financials as af
    monkeypatch.setattr(af, "get_annual_financials", lambda sym, **kw: k.annual)
    return k


# ── fiscal identity end to end ──────────────────────────────────────────────
class TestFiscalIdentity:
    def test_statement_quarters_get_the_companys_own_fiscal_labels(self, stub):
        out = ei._build("MU")
        labels = [q["label"] for q in out["quarters"][:4]]
        assert labels == ["FY2026 Q3", "FY2026 Q2", "FY2026 Q1", "FY2025 Q4"]

    def test_consensus_rows_placed_by_report_date_not_calendar_quarter(self, stub):
        # Micron reports its quarter ending 28 May 2026 in late June. The old
        # calendar-derived label for a June report was Q1; it is Q3.
        stub.year_earnings = {2026: [
            {"date": "2026-06-25", "eps_actual": 3.1, "eps_estimate": 2.9,
             "revenue_actual": 9.9e9, "revenue_estimate": 9.5e9},
        ]}
        out = ei._build("MU")
        row = next(q for q in out["quarters"] if q["report_date"] == "2026-06-25")
        assert row["label"] == "FY2026 Q3"
        assert row["fiscal_year"] == 2026 and row["fiscal_quarter"] == 3

    def test_no_calendar_means_no_label_rather_than_a_guess(self, stub):
        stub.statements = {"income": {"annual": [], "quarterly": []}}
        stub.year_earnings = {2026: [
            {"date": "2026-06-25", "eps_actual": 3.1, "eps_estimate": 2.9},
        ]}
        out = ei._build("MU")
        assert out["quarters"] == []
        assert out["meta"]["fiscal_calendar"]["known"] is False
        assert "left unlabelled" in out["meta"]["fiscal_method"]


# ── the tier-1 / tier-2 join ────────────────────────────────────────────────
class TestTierJoin:
    def test_consensus_and_statement_rows_merge_on_one_fiscal_identity(self, stub):
        stub.statements = _statements(values={
            "2026-05-28": _q("2026-05-28", revenue=1.0e10, net_income=2.5e9, eps=2.20),
        })
        stub.year_earnings = {2026: [
            {"date": "2026-06-25", "eps_actual": 2.35, "eps_estimate": 2.10,
             "revenue_actual": 1.0e10, "revenue_estimate": 9.6e9},
        ]}
        out = ei._build("MU")
        q3 = next(q for q in out["quarters"] if q["label"] == "FY2026 Q3")
        # Tier 1 owns the consensus-comparable actual and the estimate...
        assert q3["eps_actual"] == 2.35
        assert q3["eps_estimate"] == 2.10
        assert q3["eps_basis"] == "consensus_comparable"
        # ...tier 2 contributes the margin and the filed period end. Before the
        # join was fixed both of these were permanently unreachable.
        assert q3["net_margin_pct"] == pytest.approx(25.0)
        assert q3["period_end"] == "2026-05-28"

    def test_net_margin_populates_with_consensus_present(self, stub):
        """The exact regression: net margin was tier-2-only and the tier-1 rows
        had no period_end to join on, so it never rendered in production."""
        stub.statements = _statements(values={
            "2026-05-28": _q("2026-05-28", revenue=8.0e9, net_income=1.6e9, eps=1.4),
        })
        stub.year_earnings = {2026: [
            {"date": "2026-06-25", "eps_actual": 1.5, "eps_estimate": 1.4},
        ]}
        out = ei._build("MU")
        q3 = next(q for q in out["quarters"] if q["label"] == "FY2026 Q3")
        assert q3["net_margin_pct"] == pytest.approx(20.0)

    def test_statement_actual_fills_a_gap_in_consensus_data(self, stub):
        stub.statements = _statements(values={
            "2026-05-28": _q("2026-05-28", revenue=8.0e9, net_income=1.0e9, eps=1.1),
        })
        stub.year_earnings = {2026: [
            {"date": "2026-06-25", "eps_actual": 1.5, "eps_estimate": 1.4,
             "revenue_actual": None, "revenue_estimate": 7.8e9},
        ]}
        out = ei._build("MU")
        q3 = next(q for q in out["quarters"] if q["label"] == "FY2026 Q3")
        assert q3["revenue_actual"] == 8.0e9      # filled from the statement

    def test_two_reports_on_one_fiscal_quarter_do_not_fuse(self, stub):
        """A duplicate provider row must not merge its values into the other."""
        stub.year_earnings = {2026: [
            {"date": "2026-06-25", "eps_actual": 2.35, "eps_estimate": 2.10},
            {"date": "2026-06-26", "eps_actual": 9.99, "eps_estimate": None},
        ]}
        out = ei._build("MU")
        q3 = [q for q in out["quarters"] if q["label"] == "FY2026 Q3"]
        assert len(q3) == 1
        # The row bearing a real consensus wins; the other is discarded whole.
        assert q3[0]["eps_actual"] == 2.35
        assert q3[0]["eps_estimate"] == 2.10


# ── growth semantics ────────────────────────────────────────────────────────
class TestYoY:
    def test_compares_the_same_fiscal_quarter_a_year_earlier(self, stub):
        stub.statements = _statements(values={
            "2026-05-28": _q("2026-05-28", revenue=1.0e10, eps=2.00),
            "2025-05-29": _q("2025-05-29", revenue=5.0e9, eps=1.00),
            "2026-02-26": _q("2026-02-26", revenue=9.0e9, eps=1.80),
        })
        out = ei._build("MU")
        q3 = next(q for q in out["quarters"] if q["label"] == "FY2026 Q3")
        assert q3["eps_yoy_pct"] == pytest.approx(100.0)
        assert q3["rev_yoy_pct"] == pytest.approx(100.0)

    def test_loss_to_profit_is_a_state_not_a_percentage(self, stub):
        stub.statements = _statements(values={
            "2026-05-28": _q("2026-05-28", revenue=1.0e10, eps=1.50),
            "2025-05-29": _q("2025-05-29", revenue=5.0e9, eps=-0.80),
        })
        out = ei._build("MU")
        q3 = next(q for q in out["quarters"] if q["label"] == "FY2026 Q3")
        assert q3["eps_yoy_pct"] is None
        assert q3["eps_yoy_note"] == "turned_profitable"

    def test_profit_to_loss_is_a_state_not_a_percentage(self, stub):
        stub.statements = _statements(values={
            "2026-05-28": _q("2026-05-28", revenue=1.0e10, eps=-0.40),
            "2025-05-29": _q("2025-05-29", revenue=5.0e9, eps=1.20),
        })
        out = ei._build("MU")
        q3 = next(q for q in out["quarters"] if q["label"] == "FY2026 Q3")
        assert q3["eps_yoy_pct"] is None
        assert q3["eps_yoy_note"] == "turned_negative"

    def test_a_narrowing_loss_is_an_improvement_on_magnitudes(self, stub):
        stub.statements = _statements(values={
            "2026-05-28": _q("2026-05-28", revenue=1.0e10, eps=-0.50),
            "2025-05-29": _q("2025-05-29", revenue=5.0e9, eps=-2.00),
        })
        out = ei._build("MU")
        q3 = next(q for q in out["quarters"] if q["label"] == "FY2026 Q3")
        assert q3["eps_yoy_pct"] == pytest.approx(75.0)
        assert q3["eps_yoy_note"] == "loss_narrowing"

    def test_triple_digit_growth_flagged_on_each_metric(self, stub):
        stub.statements = _statements(values={
            "2026-05-28": _q("2026-05-28", revenue=1.2e10, eps=3.00),
            "2025-05-29": _q("2025-05-29", revenue=4.0e9, eps=1.00),
        })
        out = ei._build("MU")
        q3 = next(q for q in out["quarters"] if q["label"] == "FY2026 Q3")
        assert q3["eps_triple"] and q3["rev_triple"] and q3["double_triple"]


class TestSurprise:
    def test_basis_mismatch_never_manufactures_a_surprise(self, stub):
        """A GAAP statement actual against a consensus estimate is not a
        surprise, however tempting the arithmetic."""
        stub.statements = _statements(values={
            "2026-05-28": _q("2026-05-28", revenue=1.0e10, eps=2.00),
        })
        stub.year_earnings = {}                     # no consensus tier at all
        out = ei._build("MU")
        q3 = next(q for q in out["quarters"] if q["label"] == "FY2026 Q3")
        assert q3["eps_basis"] == "gaap_diluted"
        assert q3["eps_surprise_pct"] is None
        assert q3["eps_surprise_note"] == "no_comparable_estimate"
        assert q3["eps_beat"] is None

    def test_near_zero_estimate_reports_an_absolute_surprise(self, stub):
        stub.year_earnings = {2026: [
            {"date": "2026-06-25", "eps_actual": 0.03, "eps_estimate": 0.01},
        ]}
        out = ei._build("MU")
        q3 = next(q for q in out["quarters"] if q["label"] == "FY2026 Q3")
        assert q3["eps_surprise_pct"] is None          # never "+200%"
        assert q3["eps_surprise_abs"] == pytest.approx(0.02)
        assert q3["eps_surprise_note"] == "near_zero_estimate"
        assert q3["eps_beat"] is True

    def test_ordinary_surprise_is_a_percentage(self, stub):
        stub.year_earnings = {2026: [
            {"date": "2026-06-25", "eps_actual": 2.20, "eps_estimate": 2.00},
        ]}
        out = ei._build("MU")
        q3 = next(q for q in out["quarters"] if q["label"] == "FY2026 Q3")
        assert q3["eps_surprise_pct"] == pytest.approx(10.0)


# ── acceleration: the gap bug ───────────────────────────────────────────────
class TestAcceleration:
    def _with_yoy(self, stub, series):
        """series: newest-first EPS YoY percentages, built from real quarters."""
        vals = {}
        ends = MU_QUARTERS[:len(series) + 4]
        for i, pct in enumerate(series):
            cur, prior = ends[i], ends[i + 4]
            vals[prior] = _q(prior, revenue=1e9, eps=1.0)
            vals[cur] = _q(cur, revenue=1e9, eps=1.0 * (1 + pct / 100.0))
        stub.statements = _statements(values=vals)
        return ei._build("MU")

    def test_counts_consecutive_quarters_of_rising_growth(self, stub):
        out = self._with_yoy(stub, [80, 60, 40, 20])     # newest fastest
        assert out["summary"]["eps_accel_quarters"] == 3
        assert out["summary"]["eps_trend"] == "accelerating"

    def test_counts_deceleration(self, stub):
        out = self._with_yoy(stub, [20, 40, 60, 80])
        assert out["summary"]["eps_accel_quarters"] == 3
        assert out["summary"]["eps_trend"] == "decelerating"

    def test_a_missing_quarter_ends_the_run_instead_of_being_skipped(self, stub):
        """The regression: nulls were filtered out and the survivors compared as
        if adjacent, so a run could be measured straight across a hole."""
        vals = {
            "2026-05-28": _q("2026-05-28", revenue=1e9, eps=2.0),   # FY26 Q3
            "2025-05-29": _q("2025-05-29", revenue=1e9, eps=1.0),
            # FY26 Q2 deliberately absent from the statement
            "2025-11-27": _q("2025-11-27", revenue=1e9, eps=1.5),   # FY26 Q1
            "2024-11-28": _q("2024-11-28", revenue=1e9, eps=1.0),
        }
        stub.statements = _statements(
            quarters=["2026-05-28", "2025-11-27", "2025-05-29", "2024-11-28"],
            values=vals)
        out = ei._build("MU")
        # Q3 (100%) vs Q1 (50%) would read as one quarter of acceleration if the
        # missing Q2 were skipped. Fiscally they are not adjacent, so: no run.
        assert out["summary"]["eps_accel_quarters"] is None

    def test_a_sign_swing_interrupts_rather_than_vanishing(self, stub):
        vals = {
            "2026-05-28": _q("2026-05-28", revenue=1e9, eps=2.0),
            "2025-05-29": _q("2025-05-29", revenue=1e9, eps=1.0),      # +100%
            "2026-02-26": _q("2026-02-26", revenue=1e9, eps=0.5),
            "2025-02-27": _q("2025-02-27", revenue=1e9, eps=-0.5),     # turned profitable → no rate
            "2025-11-27": _q("2025-11-27", revenue=1e9, eps=1.2),
            "2024-11-28": _q("2024-11-28", revenue=1e9, eps=1.0),      # +20%
        }
        stub.statements = _statements(values=vals)
        out = ei._build("MU")
        # The run stops AT the non-comparable quarter; it does not reach past it.
        assert out["summary"]["eps_accel_quarters"] is None

    def test_flat_growth_is_not_a_run(self, stub):
        out = self._with_yoy(stub, [50, 50, 50])
        assert out["summary"]["eps_accel_quarters"] is None
        assert out["summary"]["eps_trend"] is None


# ── beat streak: missing ≠ miss ─────────────────────────────────────────────
class TestBeatStreak:
    def test_missing_revenue_consensus_is_not_scored_as_a_miss(self, stub):
        """`bool(None and True)` is False, which made an unscorable quarter look
        like a miss and truncated every streak behind it."""
        stub.year_earnings = {2026: [
            {"date": "2026-06-25", "eps_actual": 2.2, "eps_estimate": 2.0,
             "revenue_actual": None, "revenue_estimate": None},
        ]}
        out = ei._build("MU")
        q3 = next(q for q in out["quarters"] if q["label"] == "FY2026 Q3")
        assert q3["eps_beat"] is True
        assert q3["rev_beat"] is None
        assert q3["double_beat"] is None          # not scored, not a miss
        assert out["summary"]["double_beat_streak"] is None
        assert out["summary"]["double_beat_scored"] is None

    def test_a_real_double_beat_streak_counts(self, stub):
        stub.year_earnings = {2026: [
            {"date": "2026-06-25", "eps_actual": 2.2, "eps_estimate": 2.0,
             "revenue_actual": 1.1e10, "revenue_estimate": 1.0e10},
            {"date": "2026-03-25", "eps_actual": 1.9, "eps_estimate": 1.8,
             "revenue_actual": 9.5e9, "revenue_estimate": 9.0e9},
        ]}
        out = ei._build("MU")
        assert out["summary"]["double_beat_streak"] == 2

    def test_a_genuine_miss_ends_the_streak(self, stub):
        stub.year_earnings = {2026: [
            {"date": "2026-06-25", "eps_actual": 2.2, "eps_estimate": 2.0,
             "revenue_actual": 1.1e10, "revenue_estimate": 1.0e10},
            {"date": "2026-03-25", "eps_actual": 1.7, "eps_estimate": 1.8,
             "revenue_actual": 9.5e9, "revenue_estimate": 9.0e9},
        ]}
        out = ei._build("MU")
        assert out["summary"]["double_beat_streak"] == 1


# ── forward estimates ───────────────────────────────────────────────────────
class TestForwardQuarters:
    def test_forward_rows_are_labelled_and_grow_against_the_year_ago_actual(self, stub):
        stub.statements = _statements(values={
            "2025-08-28": _q("2025-08-28", revenue=5.0e9, eps=1.00),   # FY25 Q4
        })
        stub.forward = [
            {"period_end": "2026-08-27", "eps_estimate": 2.00, "rev_estimate": 1.0e10,
             "report_date": "2026-09-24"},
        ]
        out = ei._build("MU")
        assert len(out["estimates"]) == 1
        e = out["estimates"][0]
        assert e["label"] == "FY2026 Q4"
        assert e["reported"] is False
        assert e["eps_yoy_pct"] == pytest.approx(100.0)     # 2.00 vs 1.00 actual
        assert e["rev_yoy_pct"] == pytest.approx(100.0)
        assert e["yoy_basis"] == "vs_actual"

    def test_a_forward_row_for_an_already_reported_quarter_is_dropped(self, stub):
        stub.statements = _statements(values={
            "2026-05-28": _q("2026-05-28", revenue=1e10, eps=2.0),
        })
        stub.forward = [
            {"period_end": "2026-05-28", "eps_estimate": 1.9, "rev_estimate": 9.9e9},
        ]
        out = ei._build("MU")
        assert out["estimates"] == []

    def test_an_unplaceable_forward_row_is_dropped_not_sequence_labelled(self, stub):
        stub.forward = [{"period_end": None, "report_date": None,
                         "eps_estimate": 2.0, "rev_estimate": 1e10}]
        out = ei._build("MU")
        assert out["estimates"] == []

    def test_next_report_reaches_the_summary(self, stub):
        stub.forward = [
            {"period_end": "2026-08-27", "eps_estimate": 2.0, "rev_estimate": 1e10,
             "report_date": "2026-09-24"},
        ]
        out = ei._build("MU")
        assert out["summary"]["next_report_date"] == "2026-09-24"
        assert out["summary"]["next_report_label"] == "FY2026 Q4"
        assert out["summary"]["next_eps_estimate"] == 2.0


# ── annual ──────────────────────────────────────────────────────────────────
class TestAnnual:
    def test_reported_and_estimate_years_are_separated_and_grown(self, stub):
        stub.annual = [
            {"year": 2024, "eps": 1.00, "sales": 1.0e10, "estimate": False},
            {"year": 2025, "eps": 2.00, "sales": 1.5e10, "estimate": False},
            {"year": 2026, "eps": 3.00, "sales": 2.0e10, "estimate": True},
            {"year": 2027, "eps": 4.50, "sales": 2.5e10, "estimate": True},
        ]
        out = ei._build("MU")
        rep, est = out["annual"]["reported"], out["annual"]["estimates"]
        assert [r["label"] for r in rep] == ["FY2025", "FY2024"]
        assert [r["label"] for r in est] == ["FY2027", "FY2026"]
        assert rep[0]["eps_yoy_pct"] == pytest.approx(100.0)

    def test_estimate_over_estimate_growth_is_flagged(self, stub):
        """FY+2's growth is consensus over consensus and must never be presented
        as measured history."""
        stub.annual = [
            {"year": 2025, "eps": 2.00, "sales": 1.5e10, "estimate": False},
            {"year": 2026, "eps": 3.00, "sales": 2.0e10, "estimate": True},
            {"year": 2027, "eps": 4.50, "sales": 2.5e10, "estimate": True},
        ]
        out = ei._build("MU")
        by_year = {r["fiscal_year"]: r for r in out["annual"]["estimates"]}
        assert by_year[2026]["yoy_basis"] == "vs_actual"      # first est vs real FY25
        assert by_year[2027]["yoy_basis"] == "vs_estimate"    # est vs est

    def test_annual_loss_to_profit_uses_the_semantic_note(self, stub):
        stub.annual = [
            {"year": 2024, "eps": -1.00, "sales": 5.0e9, "estimate": False},
            {"year": 2025, "eps": 2.00, "sales": 1.0e10, "estimate": False},
        ]
        out = ei._build("MU")
        fy25 = out["annual"]["reported"][0]
        assert fy25["eps_yoy_pct"] is None
        assert fy25["eps_yoy_note"] == "turned_profitable"


# ── cache freshness ─────────────────────────────────────────────────────────
class TestCacheFreshness:
    def test_next_report_date_is_actually_written(self, stub):
        """The bug: _ttl_for read this key and _build never set it, so every
        payload silently took the 24-hour branch."""
        stub.forward = [{"period_end": "2026-08-27", "eps_estimate": 2.0,
                         "rev_estimate": 1e10, "report_date": "2026-09-24"}]
        out = ei._build("MU")
        assert out["next_report_date"] == "2026-09-24"

    @pytest.mark.parametrize("delta_days,expected", [
        (60, ei._TTL_FAR),        # far out
        (11, ei._TTL_FAR),        # just outside the near window
        (7, ei._TTL_NEAR),        # approaching
        (1, ei._TTL_WINDOW),      # tomorrow
        (0, ei._TTL_WINDOW),      # today
        (-1, ei._TTL_WINDOW),     # just reported
        (-30, ei._TTL_FAR),       # long past
    ])
    def test_ttl_tightens_around_the_report(self, delta_days, expected):
        when = (date.today() + timedelta(days=delta_days)).isoformat()
        assert ei._ttl_for({"next_report_date": when}) == expected

    def test_no_known_report_date_uses_the_long_ttl(self):
        assert ei._ttl_for({}) == ei._TTL_FAR
        assert ei._ttl_for({"next_report_date": "not-a-date"}) == ei._TTL_FAR


# ── degradation ─────────────────────────────────────────────────────────────
class TestDegradation:
    def test_a_security_with_no_statements_returns_an_empty_but_valid_payload(self, stub):
        stub.statements = {}
        out = ei._build("SPY")
        assert out["quarters"] == []
        assert out["estimates"] == []
        assert out["annual"] == {"reported": [], "estimates": []}
        assert ei._has_content(out) is False

    def test_actuals_only_mode_reports_no_consensus_available(self, stub):
        stub.statements = _statements(values={
            "2026-05-28": _q("2026-05-28", revenue=1e10, eps=2.0),
        })
        stub.year_earnings = {}
        out = ei._build("MU")
        assert out["meta"]["estimates_available"] is False
        assert out["meta"]["actuals_source"] == "yfinance-statement"
        assert out["quarters"][0]["eps_actual"] == 2.0

    def test_provider_failure_does_not_break_the_payload(self, stub, monkeypatch):
        import api.services.earnings_estimates as ee
        monkeypatch.setattr(ee, "get_year_earnings",
                            lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("boom")))
        out = ei._build("MU")
        assert isinstance(out["quarters"], list)     # statements still carried it
        assert out["meta"]["estimates_available"] is False

    def test_history_is_capped_but_yoy_can_still_reach_past_the_cap(self, stub):
        """The YoY partner for the oldest returned quarter lives outside the 12
        we serve, so the index must span the full merge."""
        ends = ["2026-05-28", "2026-02-26", "2025-11-27", "2025-08-28",
                "2025-05-29", "2025-02-27", "2024-11-28", "2024-08-29",
                "2024-05-30", "2024-02-29", "2023-11-30", "2023-08-31",
                "2023-06-01", "2023-03-02"]
        vals = {p: _q(p, revenue=1e9, eps=1.0) for p in ends}
        # FY2024 Q3 is inside the returned 12; its year-ago partner FY2023 Q3
        # (2023-06-01) is the 13th row, outside the cap.
        vals["2024-05-30"] = _q("2024-05-30", revenue=1e9, eps=2.0)
        vals["2023-06-01"] = _q("2023-06-01", revenue=1e9, eps=1.0)
        stub.statements = _statements(quarters=ends, values=vals)
        out = ei._build("MU")
        assert len(out["quarters"]) == ei._QUARTERS_BACK
        labels = [q["label"] for q in out["quarters"]]
        assert "FY2024 Q3" in labels and "FY2023 Q3" not in labels
        q3_24 = next(q for q in out["quarters"] if q["label"] == "FY2024 Q3")
        assert q3_24["eps_yoy_pct"] == pytest.approx(100.0)

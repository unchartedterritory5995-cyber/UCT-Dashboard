"""Tests for Cross-Security Comparison V1 (api/services/research/comparison.py)
and the compare_fundamentals silent-drop-on-failure fix it depends on."""
import api.services.research.comparison as comp
from api.services.fundamentals import compare_fundamentals


# ── compare_fundamentals bug fix ─────────────────────────────────────────────

class TestCompareFundamentalsSurfacesFailures:
    def test_a_failed_ticker_is_surfaced_not_silently_dropped(self, monkeypatch):
        def fake_get_fundamentals(sym):
            if sym == "AAPL":
                return {"ticker": "AAPL", "pe_trailing": 30.0}
            return {"ticker": sym, "error": "no fundamentals available"}

        monkeypatch.setattr(
            "api.services.fundamentals.get_fundamentals", fake_get_fundamentals
        )
        out = compare_fundamentals(["AAPL", "NOTATICKERXYZ"])
        assert out["tickers"] == ["AAPL"]
        assert out["failed"] == ["NOTATICKERXYZ"], (
            "a failed comparator ticker must be surfaced in `failed`, not silently "
            "dropped from a response that then reads as fully successful"
        )

    def test_two_ok_tickers_report_an_empty_failed_list(self, monkeypatch):
        monkeypatch.setattr(
            "api.services.fundamentals.get_fundamentals",
            lambda sym: {"ticker": sym, "pe_trailing": 20.0},
        )
        out = compare_fundamentals(["AAPL", "MSFT"])
        assert out["failed"] == []
        assert set(out["tickers"]) == {"AAPL", "MSFT"}

    def test_all_tickers_failing_reports_which_ones(self, monkeypatch):
        monkeypatch.setattr(
            "api.services.fundamentals.get_fundamentals",
            lambda sym: {"ticker": sym, "error": "no fundamentals available"},
        )
        out = compare_fundamentals(["AAPL", "NOTATICKERXYZ"])
        assert "error" in out
        assert set(out["failed"]) == {"AAPL", "NOTATICKERXYZ"}


# ── comparison composer ──────────────────────────────────────────────────────

def _entity(status="resolved", entity_id="ent_x"):
    return {"status": status, "entityId": entity_id}


def _patch_all_ok(monkeypatch, fund_a=None, fund_b=None):
    monkeypatch.setattr(comp, "resolve_entity", lambda sym: (_entity(entity_id=f"ent_{sym}"), sym))
    fund_by_sym = {"AAPL": fund_a or {"ticker": "AAPL", "pe_trailing": 30.0, "sector": "Technology"},
                   "MSFT": fund_b or {"ticker": "MSFT", "pe_trailing": 32.0, "sector": "Technology"}}
    monkeypatch.setattr(comp, "get_fundamentals", lambda sym: fund_by_sym.get(sym, {"ticker": sym, "error": "no data"}))
    monkeypatch.setattr(comp, "get_estimates", lambda sym: {
        "sym": sym, "entity": _entity(),
        "forward": [
            {"period": "Current Qtr", "eps_avg": 1.5 if sym == "AAPL" else 2.1},
            {"period": "Next Yr", "eps_avg": 6.0 if sym == "AAPL" else 9.0},
        ],
    })
    monkeypatch.setattr(comp, "get_ratings", lambda sym: {
        "sym": sym, "composite": 88 if sym == "AAPL" else 75,
        "components": {"eps": 90, "rs": 80}, "price_as_of": "2026-09-04",
    })
    monkeypatch.setattr(comp, "get_analyst_ratings", lambda sym: {
        "sym": sym,
        "consensus": {"label": "Buy", "_meta": {"freshnessClass": "fresh"}},
        "price_target": {"consensus": 250.0, "_meta": {"freshnessClass": "fresh"}},
    })


class TestGetComparisonRequestValidation:
    def test_blank_symbol_is_a_structural_error(self):
        assert "error" in comp.get_comparison("AAPL", "")
        assert "error" in comp.get_comparison("", "MSFT")

    def test_identical_symbols_is_a_structural_error(self):
        out = comp.get_comparison("AAPL", "aapl")
        assert "error" in out


class TestGetComparisonShape(object):
    def test_aapl_vs_msft_full_shape(self, monkeypatch):
        _patch_all_ok(monkeypatch)
        out = comp.get_comparison("AAPL", "MSFT")
        assert out["a"]["sym"] == "AAPL"
        assert out["b"]["sym"] == "MSFT"
        assert out["a"]["ratings"]["composite"] == 88
        assert out["b"]["ratings"]["composite"] == 75
        assert out["a"]["analyst"]["consensus"]["label"] == "Buy"
        assert "fundamentals_period_note" in out and out["fundamentals_period_note"]

    def test_nvda_vs_amd_symbol_case_is_normalized(self, monkeypatch):
        monkeypatch.setattr(comp, "resolve_entity", lambda sym: (_entity(entity_id=f"ent_{sym}"), sym))
        monkeypatch.setattr(comp, "get_fundamentals", lambda sym: {"ticker": sym})
        monkeypatch.setattr(comp, "get_estimates", lambda sym: {"forward": []})
        monkeypatch.setattr(comp, "get_ratings", lambda sym: {"composite": None, "components": {}})
        monkeypatch.setattr(comp, "get_analyst_ratings", lambda sym: {"consensus": None, "price_target": None})
        out = comp.get_comparison("nvda", "amd")
        assert out["a"]["sym"] == "NVDA"
        assert out["b"]["sym"] == "AMD"

    def test_class_share_symbol_passes_through_unchanged(self, monkeypatch):
        """BRK-B (canonical hyphen form) must reach resolve_entity/get_fundamentals
        as-is -- no dot-notation guessing in this module (Phase A finding: provider
        symbol conversion belongs in adapters, never here)."""
        seen = []
        monkeypatch.setattr(comp, "resolve_entity", lambda sym: (seen.append(sym) or _entity(), sym))
        monkeypatch.setattr(comp, "get_fundamentals", lambda sym: {"ticker": sym})
        monkeypatch.setattr(comp, "get_estimates", lambda sym: {"forward": []})
        monkeypatch.setattr(comp, "get_ratings", lambda sym: {"composite": None, "components": {}})
        monkeypatch.setattr(comp, "get_analyst_ratings", lambda sym: {"consensus": None, "price_target": None})
        out = comp.get_comparison("BRK-B", "JPM")
        assert out["a"]["sym"] == "BRK-B"
        assert "BRK-B" in seen and "BRK.B" not in seen

    def test_missing_field_on_one_side_is_null_not_zero_filled(self, monkeypatch):
        _patch_all_ok(monkeypatch, fund_b={"ticker": "MSFT", "error": "no fundamentals available"})
        out = comp.get_comparison("AAPL", "MSFT")
        assert out["a"]["fundamentals"].get("pe_trailing") == 30.0
        assert out["b"]["fundamentals"] == {"error": "no fundamentals available"}

    def test_invalid_comparator_still_returns_a_shape_not_an_error(self, monkeypatch):
        """An unresolved second symbol is a real, common outcome -- not a
        request error. The response must render 'no data for X', not fail."""
        def fake_resolve(sym):
            if sym == "NOTATICKERXYZ":
                return {"status": "not_found", "entityId": None}, sym
            return _entity(), sym
        monkeypatch.setattr(comp, "resolve_entity", fake_resolve)
        monkeypatch.setattr(comp, "get_fundamentals", lambda sym: (
            {"ticker": sym, "error": "no fundamentals available"} if sym == "NOTATICKERXYZ"
            else {"ticker": sym, "pe_trailing": 30.0}
        ))
        monkeypatch.setattr(comp, "get_estimates", lambda sym: {"forward": []})
        monkeypatch.setattr(comp, "get_ratings", lambda sym: {"composite": None, "components": {}})
        monkeypatch.setattr(comp, "get_analyst_ratings", lambda sym: {"consensus": None, "price_target": None})

        out = comp.get_comparison("AAPL", "NOTATICKERXYZ")
        assert "error" not in out
        assert out["b"]["entity"]["status"] == "not_found"
        assert "error" in out["b"]["fundamentals"]


class TestEstimatesAlignment:
    def test_estimates_align_by_period_label_not_position(self, monkeypatch):
        monkeypatch.setattr(comp, "resolve_entity", lambda sym: (_entity(), sym))
        monkeypatch.setattr(comp, "get_fundamentals", lambda sym: {"ticker": sym})
        monkeypatch.setattr(comp, "get_ratings", lambda sym: {"composite": None, "components": {}})
        monkeypatch.setattr(comp, "get_analyst_ratings", lambda sym: {"consensus": None, "price_target": None})

        def fake_estimates(sym):
            if sym == "AAPL":
                # AAPL is missing "Current Qtr" entirely -- a naive positional
                # zip would misalign every subsequent row against B.
                return {"forward": [{"period": "Next Qtr", "eps_avg": 1.6},
                                     {"period": "Next Yr", "eps_avg": 6.5}]}
            return {"forward": [{"period": "Current Qtr", "eps_avg": 2.0},
                                 {"period": "Next Qtr", "eps_avg": 2.1},
                                 {"period": "Next Yr", "eps_avg": 9.0}]}
        monkeypatch.setattr(comp, "get_estimates", fake_estimates)

        out = comp.get_comparison("AAPL", "MSFT")
        by_period = {row["period"]: row for row in out["estimates_aligned"]}
        assert by_period["Current Qtr"]["a"] is None
        assert by_period["Current Qtr"]["b"]["eps_avg"] == 2.0
        assert by_period["Next Qtr"]["a"]["eps_avg"] == 1.6
        assert by_period["Next Qtr"]["b"]["eps_avg"] == 2.1
        assert by_period["Next Yr"]["a"]["eps_avg"] == 6.5
        assert by_period["Next Yr"]["b"]["eps_avg"] == 9.0

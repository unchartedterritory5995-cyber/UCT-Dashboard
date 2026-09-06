"""Tests for Cross-Security Comparison AI V1
(api/services/research/comparison_ai_adapter.py) -- Shared Multi-Security
Grounding Architecture, Phase B. Covers: per-side evidence builders derived
from get_comparison()'s own output, id stamping, the reused
ticker_explain._grounding_flags gate (confirmed still a no-op on its two
domain-specific rating/earnings extensions), the NEW sym/side attribution
check this surface adds, and the full orchestration including
retry-then-refuse and cost-cap behavior."""
import json
from types import SimpleNamespace

from api.services.research import comparison_ai_adapter as cai
from api.services import ticker_explain as te


# ── Evidence builders ────────────────────────────────────────────────────────

class TestFundamentalsComparisonEvidence:
    def test_builds_one_tagged_item_from_a_populated_leg(self):
        fund = {"market_cap": "$1.23T", "pe_trailing": 30.5, "roe_pct": 45.0}
        out = cai._fundamentals_comparison_evidence("AAPL", "a", fund)
        assert len(out) == 1
        item = out[0]
        assert item["sym"] == "AAPL"
        assert item["side"] == "a"
        assert item["type"] == "comparison_fundamentals"
        assert "AAPL:" in item["text"]
        assert "$1.23T" in item["text"]
        assert "30.5" in item["text"]

    def test_an_error_leg_produces_no_evidence_not_a_crash(self):
        assert cai._fundamentals_comparison_evidence("XYZ", "b", {"error": "no fundamentals available"}) == []

    def test_an_empty_leg_produces_no_evidence(self):
        assert cai._fundamentals_comparison_evidence("XYZ", "b", {}) == []


class TestRatingsComparisonEvidence:
    def test_composite_and_components_each_produce_a_tagged_item(self):
        ratings = {"composite": 88, "components": {"eps": 90, "rs": 80}, "price_as_of": "2026-09-04"}
        out = cai._ratings_comparison_evidence("NVDA", "a", ratings)
        assert len(out) == 2
        assert all(i["sym"] == "NVDA" and i["side"] == "a" for i in out)
        composite_item = next(i for i in out if i["type"] == "comparison_rating")
        assert "88" in composite_item["text"]
        assert composite_item["date"] == "2026-09-04"

    def test_no_rating_field_is_ever_set_so_the_single_security_gate_never_fires(self):
        # ticker_explain._rating_grounding_flags gates strictly on a truthy
        # `rating_field` key -- this adapter must never accidentally set one.
        ratings = {"composite": 88, "components": {"eps": 90}, "price_as_of": "2026-09-04"}
        out = cai._ratings_comparison_evidence("NVDA", "a", ratings)
        assert all("rating_field" not in i for i in out)

    def test_missing_composite_and_components_produces_no_evidence(self):
        assert cai._ratings_comparison_evidence("XYZ", "a", {}) == []


class TestAnalystComparisonEvidence:
    def test_consensus_and_price_target_each_produce_a_tagged_item(self):
        analyst = {
            "consensus": {"label": "Buy", "total": 25},
            "consensus_meta": {"vendor": "FMP", "sourceObservedAt": "2026-09-03"},
            "price_target": {"consensus": 250.0, "low": 200.0, "high": 300.0},
            "price_target_meta": {"vendor": "FMP", "fetchedAt": "2026-09-04"},
        }
        out = cai._analyst_comparison_evidence("AMD", "b", analyst)
        assert len(out) == 2
        assert all(i["sym"] == "AMD" and i["side"] == "b" for i in out)
        con = next(i for i in out if i["type"] == "comparison_analyst_consensus")
        assert "Buy" in con["text"] and "25 analysts" in con["text"]
        assert con["date"] == "2026-09-03"
        pt = next(i for i in out if i["type"] == "comparison_price_target")
        assert "$250" in pt["text"] and "$200-$300" in pt["text"]

    def test_no_earnings_field_is_ever_set_so_the_single_security_gate_never_fires(self):
        analyst = {"consensus": {"label": "Buy", "total": 5}}
        out = cai._analyst_comparison_evidence("AMD", "b", analyst)
        assert all("earnings_field" not in i for i in out)

    def test_missing_legs_produce_no_evidence(self):
        assert cai._analyst_comparison_evidence("XYZ", "a", {}) == []


class TestEstimatesComparisonEvidence:
    def test_emits_one_item_per_security_per_populated_period(self):
        aligned = [
            {"period": "Current Qtr", "a": {"eps_avg": 1.5, "num_analysts": 20}, "b": {"eps_avg": 2.1}},
            {"period": "Next Yr", "a": None, "b": {"eps_avg": 9.0}},
        ]
        out = cai._estimates_comparison_evidence("AAPL", "MSFT", aligned)
        assert len(out) == 3  # a/Current Qtr, b/Current Qtr, b/Next Yr (a/Next Yr is None)
        aapl_item = next(i for i in out if i["sym"] == "AAPL")
        assert aapl_item["side"] == "a"
        assert "1.5" in aapl_item["text"]
        assert "20 analysts" in aapl_item["text"]
        msft_items = [i for i in out if i["sym"] == "MSFT"]
        assert len(msft_items) == 2

    def test_empty_aligned_list_produces_no_evidence(self):
        assert cai._estimates_comparison_evidence("AAPL", "MSFT", []) == []


# ── build_comparison_evidence ────────────────────────────────────────────────

class TestBuildComparisonEvidence:
    def test_a_structural_error_from_get_comparison_propagates_with_no_evidence(self, monkeypatch):
        monkeypatch.setattr(cai, "get_comparison", lambda a, b: {"error": "choose two different securities to compare"})
        entity_a, entity_b, evidence, err = cai.build_comparison_evidence("AAPL", "AAPL")
        assert entity_a is None and entity_b is None
        assert evidence == []
        assert err == "choose two different securities to compare"

    def test_ids_are_stamped_centrally_and_sequentially(self, monkeypatch):
        monkeypatch.setattr(cai, "get_comparison", lambda a, b: {
            "a": {"sym": "AAPL", "entity": {"status": "resolved"}, "fundamentals": {"pe_trailing": 30.0},
                 "ratings": {}, "analyst": {}},
            "b": {"sym": "MSFT", "entity": {"status": "resolved"}, "fundamentals": {"pe_trailing": 32.0},
                 "ratings": {}, "analyst": {}},
            "estimates_aligned": [],
        })
        entity_a, entity_b, evidence, err = cai.build_comparison_evidence("AAPL", "MSFT")
        assert err is None
        assert entity_a == {"status": "resolved"} and entity_b == {"status": "resolved"}
        assert [e["id"] for e in evidence] == [f"E{i}" for i in range(1, len(evidence) + 1)]
        assert {e["sym"] for e in evidence} == {"AAPL", "MSFT"}

    def test_a_fully_empty_comparison_yields_no_evidence_not_a_crash(self, monkeypatch):
        monkeypatch.setattr(cai, "get_comparison", lambda a, b: {
            "a": {"sym": "ZZZZ", "entity": {"status": "not_found"}, "fundamentals": {}, "ratings": {}, "analyst": {}},
            "b": {"sym": "YYYY", "entity": {"status": "not_found"}, "fundamentals": {}, "ratings": {}, "analyst": {}},
            "estimates_aligned": [],
        })
        _, _, evidence, err = cai.build_comparison_evidence("ZZZZ", "YYYY")
        assert err is None
        assert evidence == []


# ── The new sym/side attribution check ──────────────────────────────────────

class TestAttributionFlags:
    _EVIDENCE = [
        {"id": "E1", "type": "comparison_fundamentals", "date": "current snapshot",
         "source": "UCT Fundamentals", "text": "NVDA: trailing P/E 45.0.", "url": None,
         "sym": "NVDA", "side": "a"},
        {"id": "E2", "type": "comparison_fundamentals", "date": "current snapshot",
         "source": "UCT Fundamentals", "text": "AMD: trailing P/E 30.0.", "url": None,
         "sym": "AMD", "side": "b"},
    ]

    def test_a_key_fact_correctly_attributed_to_its_own_security_passes(self):
        data = {"key_facts": [{"statement": "NVDA trades at 45x.", "evidence_id": "E1", "sym": "NVDA"}]}
        assert cai._attribution_flags(data, self._EVIDENCE) == []

    def test_a_key_fact_citing_the_wrong_securitys_evidence_is_flagged(self):
        # The exact failure class this check exists to catch: a real
        # evidence_id (E1, genuinely about NVDA) attached to a statement
        # whose declared sym is the OTHER security.
        data = {"key_facts": [{"statement": "AMD trades at 45x.", "evidence_id": "E1", "sym": "AMD"}]}
        flags = cai._attribution_flags(data, self._EVIDENCE)
        assert len(flags) == 1
        assert "E1" in flags[0] and "AMD" in flags[0] and "NVDA" in flags[0]

    def test_an_already_invalid_evidence_id_is_left_to_the_evidence_id_check(self):
        # _grounding_flags's own evidence_id-validity check owns this case;
        # _attribution_flags must not double-report or crash on a miss.
        data = {"key_facts": [{"statement": "x", "evidence_id": "E999", "sym": "NVDA"}]}
        assert cai._attribution_flags(data, self._EVIDENCE) == []

    def test_reused_grounding_flags_also_catches_the_same_misattributed_fact_via_id_validity_when_bogus(self):
        # Sanity: the reused ticker_explain._grounding_flags still does its
        # own job (evidence_id validity) unmodified alongside the new check.
        data = {"response_state": "answer", "summary": "", "interpretation": "",
                "caveat": "", "clarification_question": "", "refusal_reason": "",
                "key_facts": [{"statement": "x", "evidence_id": "BOGUS", "sym": "NVDA"}]}
        flags = te._grounding_flags(data, self._EVIDENCE)
        assert any("unverified evidence_id" in f for f in flags)


# ── Full orchestration ───────────────────────────────────────────────────────

def _fake_resp(payload: dict, stop_reason="end_turn"):
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=json.dumps(payload))],
        stop_reason=stop_reason,
        usage=SimpleNamespace(input_tokens=100, output_tokens=50,
                              cache_read_input_tokens=0, cache_creation_input_tokens=0,
                              server_tool_use=None),
    )


def _payload(**overrides) -> dict:
    data = {"response_state": "answer", "summary": "", "key_facts": [], "interpretation": "",
           "caveat": "", "clarification_question": "", "refusal_reason": ""}
    data.update(overrides)
    return data


_SAMPLE_EVIDENCE = [
    {"id": "E1", "type": "comparison_fundamentals", "date": "current snapshot",
     "source": "UCT Fundamentals", "text": "NVDA: trailing P/E 45.0.", "url": None,
     "sym": "NVDA", "side": "a"},
    {"id": "E2", "type": "comparison_fundamentals", "date": "current snapshot",
     "source": "UCT Fundamentals", "text": "AMD: trailing P/E 30.0.", "url": None,
     "sym": "AMD", "side": "b"},
]


class TestExplainComparison:
    def _mock_evidence(self, monkeypatch):
        monkeypatch.setattr(cai, "build_comparison_evidence", lambda a, b: (
            {"status": "resolved", "entityId": "e_nvda"},
            {"status": "resolved", "entityId": "e_amd"},
            _SAMPLE_EVIDENCE,
            None,
        ))

    def test_blank_symbols_or_question_is_insufficient_not_an_error(self):
        out = cai.explain_comparison("", "AMD", "compare them")
        assert out["insufficient_evidence"] is True
        assert out["response_state"] == "refuse"
        out2 = cai.explain_comparison("NVDA", "AMD", "")
        assert out2["insufficient_evidence"] is True

    def test_a_structural_error_from_build_evidence_is_an_honest_refuse(self, monkeypatch):
        monkeypatch.setattr(cai, "build_comparison_evidence", lambda a, b: (None, None, [], "choose two different securities to compare"))
        out = cai.explain_comparison("NVDA", "NVDA", "compare them")
        assert out["response_state"] == "refuse"
        assert out["error"] is None  # this is a normal refuse, not an internal error
        assert "different securities" in out["insufficient_evidence_reason"]

    def test_no_evidence_at_all_is_an_honest_insufficient_result(self, monkeypatch):
        monkeypatch.setattr(cai, "build_comparison_evidence", lambda a, b: (
            {"status": "not_found"}, {"status": "not_found"}, [], None))
        out = cai.explain_comparison("ZZZZ", "YYYY", "compare them")
        assert out["insufficient_evidence"] is True
        assert "No recent UCT-verified" in out["insufficient_evidence_reason"]

    def test_over_cost_budget_refuses_honestly_without_calling_the_model(self, monkeypatch):
        self._mock_evidence(monkeypatch)
        monkeypatch.setattr("api.services.narrative_cost_guard.over_budget", lambda *a, **kw: True)
        called = []
        monkeypatch.setattr(cai, "_call_model", lambda *a, **kw: called.append(1))
        out = cai.explain_comparison("NVDA", "AMD", "compare them")
        assert out["insufficient_evidence"] is True
        assert "usage limit" in out["insufficient_evidence_reason"]
        assert not called

    def test_a_grounded_answer_is_returned_with_per_security_citations(self, monkeypatch):
        self._mock_evidence(monkeypatch)
        monkeypatch.setattr("api.services.narrative_cost_guard.over_budget", lambda *a, **kw: False)
        monkeypatch.setattr("api.services.narrative_cost_guard.record_from_response", lambda *a, **kw: 0.01)
        payload = _payload(
            summary="NVDA trades at a higher multiple than AMD.",
            key_facts=[
                {"statement": "NVDA trades at 45x trailing earnings.", "evidence_id": "E1", "sym": "NVDA"},
                {"statement": "AMD trades at 30x trailing earnings.", "evidence_id": "E2", "sym": "AMD"},
            ],
        )
        monkeypatch.setattr(cai, "_call_model", lambda *a, **kw: _fake_resp(payload))
        out = cai.explain_comparison("NVDA", "AMD", "how do their valuations compare?")
        assert out["insufficient_evidence"] is False
        assert out["response_state"] == "answer"
        assert len(out["citations"]) == 2
        assert {c["sym"] for c in out["citations"]} == {"NVDA", "AMD"}

    def test_a_misattributed_key_fact_is_rejected_then_honestly_refused(self, monkeypatch):
        # The end-to-end proof that the new attribution check is actually
        # wired into the blocking gate, not just unit-tested in isolation.
        self._mock_evidence(monkeypatch)
        monkeypatch.setattr("api.services.narrative_cost_guard.over_budget", lambda *a, **kw: False)
        monkeypatch.setattr("api.services.narrative_cost_guard.record_from_response", lambda *a, **kw: 0.01)
        bad = _payload(
            summary="AMD trades at a rich multiple.",
            key_facts=[{"statement": "AMD trades at 45x.", "evidence_id": "E1", "sym": "AMD"}],
        )
        monkeypatch.setattr(cai, "_call_model", lambda *a, **kw: _fake_resp(bad))
        out = cai.explain_comparison("NVDA", "AMD", "how rich is AMD's multiple?")
        assert out["response_state"] == "refuse"
        assert out["insufficient_evidence"] is True

    def test_retry_then_success_recovers_from_a_first_rejected_draft(self, monkeypatch):
        self._mock_evidence(monkeypatch)
        monkeypatch.setattr("api.services.narrative_cost_guard.over_budget", lambda *a, **kw: False)
        monkeypatch.setattr("api.services.narrative_cost_guard.record_from_response", lambda *a, **kw: 0.01)
        bad = _payload(key_facts=[{"statement": "AMD trades at 45x.", "evidence_id": "E1", "sym": "AMD"}])
        good = _payload(
            summary="NVDA trades richer than AMD.",
            key_facts=[{"statement": "NVDA trades at 45x.", "evidence_id": "E1", "sym": "NVDA"}],
        )
        responses = [_fake_resp(bad), _fake_resp(good)]
        monkeypatch.setattr(cai, "_call_model", lambda *a, **kw: responses.pop(0))
        out = cai.explain_comparison("NVDA", "AMD", "compare valuations")
        assert out["response_state"] == "answer"
        assert out["summary"] == "NVDA trades richer than AMD."

    def test_a_model_stop_reason_refusal_is_honest_not_a_crash(self, monkeypatch):
        self._mock_evidence(monkeypatch)
        monkeypatch.setattr("api.services.narrative_cost_guard.over_budget", lambda *a, **kw: False)
        monkeypatch.setattr(cai, "_call_model", lambda *a, **kw: _fake_resp({}, stop_reason="refusal"))
        out = cai.explain_comparison("NVDA", "AMD", "compare them")
        assert out["response_state"] == "refuse"
        assert "declined" in out["insufficient_evidence_reason"]

    def test_a_model_call_exception_is_an_honest_refuse_not_a_500(self, monkeypatch):
        self._mock_evidence(monkeypatch)
        monkeypatch.setattr("api.services.narrative_cost_guard.over_budget", lambda *a, **kw: False)

        def _boom(*a, **kw):
            raise RuntimeError("network blip")

        monkeypatch.setattr(cai, "_call_model", _boom)
        out = cai.explain_comparison("NVDA", "AMD", "compare them")
        assert out["response_state"] == "refuse"
        assert "temporarily unavailable" in out["insufficient_evidence_reason"]

    def test_unparseable_model_output_is_an_honest_refuse(self, monkeypatch):
        self._mock_evidence(monkeypatch)
        monkeypatch.setattr("api.services.narrative_cost_guard.over_budget", lambda *a, **kw: False)
        garbage_resp = SimpleNamespace(
            content=[SimpleNamespace(type="text", text="not json")],
            stop_reason="end_turn",
            usage=SimpleNamespace(input_tokens=1, output_tokens=1,
                                  cache_read_input_tokens=0, cache_creation_input_tokens=0,
                                  server_tool_use=None),
        )
        monkeypatch.setattr(cai, "_call_model", lambda *a, **kw: garbage_resp)
        out = cai.explain_comparison("NVDA", "AMD", "compare them")
        assert out["response_state"] == "refuse"

    def test_decisive_verdict_language_is_rejected_by_the_reused_gate(self, monkeypatch):
        # Proves ticker_explain._grounding_flags's decisive-language ban
        # (reused unchanged) still applies to comparison answers.
        self._mock_evidence(monkeypatch)
        monkeypatch.setattr("api.services.narrative_cost_guard.over_budget", lambda *a, **kw: False)
        monkeypatch.setattr("api.services.narrative_cost_guard.record_from_response", lambda *a, **kw: 0.01)
        bad = _payload(summary="You should buy NVDA over AMD.",
                       key_facts=[{"statement": "NVDA trades at 45x.", "evidence_id": "E1", "sym": "NVDA"}])
        monkeypatch.setattr(cai, "_call_model", lambda *a, **kw: _fake_resp(bad))
        out = cai.explain_comparison("NVDA", "AMD", "which should I buy?")
        assert out["response_state"] == "refuse"


# ── Route ────────────────────────────────────────────────────────────────────

class TestRoute:
    def _client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        return TestClient(app)

    def _login(self, client, monkeypatch):
        monkeypatch.setattr(
            "api.middleware.auth_middleware.validate_session",
            lambda token: {"id": "u1", "email": "t@test.com", "role": "user"},
        )

    def test_requires_auth(self):
        r = self._client().post("/api/research/compare/NVDA/AMD/explain",
                                json={"question": "how do they compare?"})
        assert r.status_code == 401

    def test_route_shape_when_authenticated(self, monkeypatch):
        import api.routers.research as research_router
        client = self._client()
        self._login(client, monkeypatch)
        monkeypatch.setattr(research_router, "explain_comparison", lambda sym, comparator, q: {
            "sym_a": sym.upper(), "sym_b": comparator.upper(), "entity_a": None, "entity_b": None,
            "response_state": "answer", "summary": "s", "key_facts": [], "interpretation": "",
            "caveat": "", "clarification_question": "", "citations": [],
            "insufficient_evidence": False, "insufficient_evidence_reason": "",
            "model": "claude-sonnet-5", "error": None,
        })
        r = client.post("/api/research/compare/NVDA/AMD/explain",
                        json={"question": "how do they compare?"}, cookies={"uct_session": "x"})
        assert r.status_code == 200
        body = r.json()
        assert body["sym_a"] == "NVDA" and body["sym_b"] == "AMD"

    def test_route_degrades_safely_on_an_exception(self, monkeypatch):
        import api.routers.research as research_router
        client = self._client()
        self._login(client, monkeypatch)

        def _boom(sym, comparator, q):
            raise RuntimeError("boom")

        monkeypatch.setattr(research_router, "explain_comparison", _boom)
        r = client.post("/api/research/compare/NVDA/AMD/explain",
                        json={"question": "how do they compare?"}, cookies={"uct_session": "x"})
        assert r.status_code == 200
        body = r.json()
        assert body["insufficient_evidence"] is True
        assert body["error"] == "internal error"

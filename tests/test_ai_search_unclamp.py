"""Phase-1 "un-clamp" rails (2026-08-29).

Born from a measured complaint: raw Perplexity and raw Claude both gave better
answers than our wrapper AROUND them. The prod capture log (50 asks / 30 days,
pulled 2026-08-29) named the mechanisms:

  * two REAL asks 80s apart were REFUSED with the scope line -- "find me an
    example of an exhaustion extension in the charts" -- the firm's own candle
    vocabulary, answered as though it were off-topic. 0 citations, 952ms.
  * both classified question_type "other", which _BRAIN_ELIGIBLE excludes, so
    the 9,569-entry playbook KB was locked out of the one question it exists for.
  * by_freshness was time_sensitive 50/50 -- because a `quote` pack rides along
    with EVERY ticker ask and `quote` counted as perishable, so the grounding we
    add is what disqualifies the answer from Phase-2 memory. Memory has been fed
    zero rows since launch.
  * every answer asked the provider for 700 tokens; every query was pinned to an
    18-domain allowlist, 4 of them hard paywalls.

Each test below names the production change that would make it fail. Controls
are marked -- a fixture that cannot distinguish is not a rail
(lesson_a_fixture_that_cannot_distinguish_is_not_a_rail).
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.ai_search as ai
import api.services.ai_search_log as log
import api.services.perplexity_search as pplx
from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
)

# The two questions a real trader actually typed, verbatim from the prod log.
REFUSED_IN_PROD = [
    "find me an example of an exhaustion extension in the charts",
    "find me a good example of an exhaustion extension and a reversal extension",
]


# -- 1. the playbook becomes reachable ---------------------------------------
@pytest.mark.parametrize("q", REFUSED_IN_PROD)
def test_chart_craft_questions_are_not_classified_other(q):
    """Fails if classify_question_type still drops house chart vocabulary into
    "other". The live cause was `chart` (singular) never matching "charts"."""
    assert log.classify_question_type(q) != "other"


@pytest.mark.parametrize("q", REFUSED_IN_PROD)
def test_chart_craft_questions_can_reach_the_playbook(q):
    """The end-to-end point of the classifier fix: whatever type these land in
    must be a type the brain-KB block will actually load for."""
    assert log.classify_question_type(q) in ai._BRAIN_ELIGIBLE


def test_brain_eligible_keeps_other_as_a_backstop():
    """Belt-and-braces: the NEXT classifier miss must still reach the KB rather
    than silently losing it the way "exhaustion extension" did."""
    assert "other" in ai._BRAIN_ELIGIBLE


def test_a_craft_free_ask_is_not_swept_into_the_craft_bucket():
    """CONTROL -- proves the classifier tests above discriminate rather than
    passing because everything became setup-technical."""
    assert log.classify_question_type("what is the best recipe for sourdough") \
        not in ("setup-technical", "options-flow", "why-move")


# -- 2. stop poisoning the memory input --------------------------------------
def test_evergreen_question_survives_an_ambient_quote():
    """Fails while a tag-along `quote` pack forces time_sensitive. This single
    gate is why Phase-2 memory has been fed zero rows since launch."""
    assert log.classify_freshness(
        "what is CRM's business model", None, ["regime", "quote"]) == "evergreen"


def test_truly_perishable_sources_still_force_time_sensitive():
    """CONTROL -- the discriminating half. Loosening `quote` must NOT loosen the
    packs that really do go stale, or we poison the brain instead of starving it."""
    for src in ("movers", "flow", "tape", "patterns"):
        assert log.classify_freshness("what is a moving average", None, [src]) \
            == "time_sensitive", src


def test_explicit_day_recency_still_forces_time_sensitive():
    """CONTROL -- recency must keep outranking an evergreen-looking phrasing."""
    assert log.classify_freshness("what is NVDA doing today", "day", []) == "time_sensitive"


def test_a_non_evergreen_ask_with_only_a_quote_stays_time_sensitive():
    """CONTROL -- dropping `quote` from the perishable set must not flip asks
    that carry NO positive evergreen signal; those still default conservative."""
    assert log.classify_freshness("nvda setup into the close", None, ["quote"]) \
        == "time_sensitive"


# -- 3. answers stop arriving as stubs ---------------------------------------
def _client(user_id=1, role="user", plan="pro"):
    app = FastAPI()
    app.include_router(ai.router)
    who = {"id": user_id, "role": role, "plan": plan}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
    return TestClient(app)


def test_member_answers_request_more_than_a_stub_budget(monkeypatch):
    """Fails at max_tokens=700. 700 tokens is roughly 500 words -- the wrapper
    was asking the same model raw Perplexity uses for a fraction of the answer."""
    seen = {}

    def _capture(query, **kw):
        seen.update(kw)
        return {"answer": "ok", "citations": [], "mode": "fast", "model": "sonar-pro"}

    monkeypatch.setattr(ai.perplexity_search, "web_search", _capture)
    r = _client().post("/api/ai-search", json={"query": "what is the setup on NVDA"})
    assert r.status_code == 200, r.text
    assert seen.get("max_tokens", 0) >= 1500, f"still a stub budget: {seen.get('max_tokens')}"


# -- 4. stop amputating the web ----------------------------------------------
def _capture_payload(monkeypatch):
    box = {}

    class _Resp:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"choices": [{"message": {"content": "ok"}}], "citations": []}

    def _post(url, **kw):
        box.update(kw.get("json") or {})
        return _Resp()

    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    monkeypatch.setattr(pplx.requests, "post", _post)
    return box


def test_finance_pack_does_not_pin_the_search_to_an_allowlist(monkeypatch):
    """Fails while domain_pack='finance' sends search_domain_filter. Perplexity
    treats that as a HARD allowlist: 18 sites, 4 of them paywalled -- no IR
    pages, no SEC full text, no transcripts. Raw Perplexity searches the web."""
    box = _capture_payload(monkeypatch)
    pplx._SEARCH_CACHE.clear()
    pplx.web_search("nbis catalyst", domain_pack="finance", cache_salt="t1")
    assert "search_domain_filter" not in box, \
        f"still allowlisted to {box.get('search_domain_filter')}"


def test_the_allowlist_is_restorable_without_a_deploy(monkeypatch):
    """CONTROL + rollback rail: the constant and the plumbing must survive so
    recovery is a Railway var, not a code change."""
    box = _capture_payload(monkeypatch)
    monkeypatch.setenv("AI_SEARCH_DOMAIN_FILTER", "1")
    pplx._SEARCH_CACHE.clear()
    pplx.web_search("nbis catalyst", domain_pack="finance", cache_salt="t2")
    assert box.get("search_domain_filter") == pplx._FINANCE_DOMAINS


def test_an_explicit_domain_list_is_still_honoured(monkeypatch):
    """CONTROL -- callers that pass `domains=` deliberately (COT, definitions)
    must keep their filter regardless of the new default."""
    box = _capture_payload(monkeypatch)
    pplx._SEARCH_CACHE.clear()
    pplx.web_search("cot report", domains=["cftc.gov"], cache_salt="t3")
    assert box.get("search_domain_filter") == ["cftc.gov"]


# -- 5. the scope guard stops eating the craft -------------------------------
def test_scope_block_names_the_craft_as_in_scope():
    """Fails while SCOPE lists only instruments. The refusal fired on chart
    patterns because technical analysis was never named as in-scope."""
    s = ai._WIDGET_SYSTEM.lower()
    for term in ("technical analysis", "chart pattern", "risk"):
        assert term in s, f"scope block never names {term!r}"


def test_scope_block_still_refuses_clearly_offtopic_work():
    """CONTROL -- the other artifact of a refusal. Widening scope must not delete
    the guard (lesson_rail_the_sentence_not_just_the_guard)."""
    s = ai._WIDGET_SYSTEM
    assert "I'm the UCT research desk" in s
    assert "never write code" in s.lower()


def test_manipulation_refusal_survives_the_scope_rewrite():
    """CONTROL -- the hard refusal is a separate paragraph from SCOPE and must
    be untouched by widening what counts as on-topic."""
    s = ai._WIDGET_SYSTEM.lower()
    assert "manipulation" in s and "material non-public" in s


def test_scope_widening_reaches_the_personal_synthesis_prompt():
    """_SAFETY_BLOCKS is the ONE source of truth for both prompts; a fix that
    lands in only one lane is the mirrored-lane defect
    (lesson_rail_the_mirror_not_just_the_lane)."""
    from api.services import ai_search_personal
    built = ai_search_personal.SYNTH_SYSTEM("PERSONAL CONTEXT: none", "DESK: none")
    assert "technical analysis" in built.lower()
    # …and the guard half still rides along in the mirrored lane.
    assert "I'm the UCT research desk" in built


# -- 6. the craft vocabulary is DERIVED, not typed ---------------------------
# lesson_probe_names_must_be_derived_not_typed: a hand-typed alternation is
# exactly how "exhaustion extension" went missing for months. The registry in
# patterns.py is the product's OWN list of what it can talk about, so the
# classifier must be answerable to it rather than to my spelling.
def _registry_names():
    from api.routers.patterns import _PATTERN_METADATA
    return {k: (v.get("name") or k) for k, v in _PATTERN_METADATA.items()}


def test_every_documented_pattern_reaches_the_playbook():
    """Fails for any pattern this product documents by name that the classifier
    would still hand to the open web instead of the firm's own KB. Asserts the
    INVARIANT (a craft type the playbook loads for), not one exact label —
    'what is a bull flag' is legitimately concept-education."""
    missed = []
    for key, name in _registry_names().items():
        got = log.classify_question_type(f"show me an example of a {name}")
        if got not in log._PLAYBOOK_REACHABLE:
            missed.append((key, name, got))
    assert not missed, f"{len(missed)} documented patterns strand the playbook: {missed[:8]}"


def test_the_playbook_reachable_mirror_cannot_drift_from_the_router():
    """`_PLAYBOOK_REACHABLE` is a copy of the router's `_BRAIN_ELIGIBLE` (minus
    its 'other' backstop) because the router imports the log module, not the
    other way round. A mirrored constant needs a guard or it becomes the second
    authority this repo keeps paying for (lesson_a_second_authority_over_one_value)."""
    assert set(log._PLAYBOOK_REACHABLE) | {"other"} == set(ai._BRAIN_ELIGIBLE)


def test_the_registry_rail_is_not_vacuous():
    """CONTROL — proves the test above is measuring something. If the registry
    ever imports empty, the loop passes by iterating nothing."""
    assert len(_registry_names()) >= 30


def test_a_single_word_pattern_name_never_outranks_a_real_intent():
    """CONTROL for the strong/weak split. Registry names like 'gap up' or 'flag'
    are short and generic; promoting them ahead of the keyword regexes would
    steal 'why did NVDA gap up today' from why-move. Proves the split is
    load-bearing rather than decorative."""
    assert log.classify_question_type("why did NVDA gap up today") == "why-move"
    assert log.classify_question_type("any news on the golden cross") == "setup-technical"

"""Ask-AI "UCT SAID" block — adapters/askai.py and its hook in api/routers/ai_search.py.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. any change to _grounded_system's output while the flag is off (byte-identical), or
   wisdom.db / auth.db touched while it is off (kill switch must be read first).
2. a block for an asker outside the wisdom-askai cohort, or with no asker at all.
3. a fired block without the 'wisdom' source key, the salt suffix, the provisional
   label, or valid interim S8 locators.
4. an endpoint that does not carry the asker into _grounded_system — the sync path AND
   the stream path's executor thread (run_in_executor does not copy contextvars).
5. a grounding source appended inside _grounded_system that is neither mapped in
   runner._PACK_TOOL_ALIAS nor declared in the fast-lane exam's no_twin.
6. 'wisdom' missing from _LIVE_SOURCES (dated calls indexed as evergreen memory) or
   from the widget's GROUNDING_LABELS (a silent chip).
"""
from __future__ import annotations

import ast
import asyncio
import pathlib
import re

import pytest

import api.routers.ai_search as ai
from api.services.wisdom.core import store
from api.services.wisdom.publish import retrieval
from api.services.wisdom.publish.adapters import common
from tests.test_wisdom_publish_adapters_store import adapters_db, seeded  # noqa: F401

REPO = pathlib.Path(__file__).resolve().parents[1]
QUESTION = "what did they say about NVDA"


def _stub_router(monkeypatch, *, tickers=("NVDA",), question_type="other"):
    from api.services import ai_search_dossier, ai_search_log, ai_search_memory

    def uct(q):
        meta = ai._empty_meta()
        meta["query_tickers"] = list(tickers)
        return "CTX", "salt0", meta

    monkeypatch.setattr(ai, "_uct_context", uct)
    monkeypatch.setattr(ai, "_brain_context", lambda q, t, v: "")
    monkeypatch.setattr(ai_search_memory, "retrieve_context", lambda *a, **k: "")
    monkeypatch.setattr(ai_search_dossier, "maybe_run", lambda: None)
    monkeypatch.setattr(ai_search_log, "classify_question_type", lambda q: question_type)


def _grounded_as(user_id, query=QUESTION):
    tok = ai._WISDOM_ASKER.set(user_id)
    try:
        return ai._grounded_system(query)
    finally:
        ai._WISDOM_ASKER.reset(tok)


def _baseline(monkeypatch, query=QUESTION):
    """The router with the Wisdom block removed entirely: what 'unchanged' means."""
    with monkeypatch.context() as m:
        m.setattr(ai, "_wisdom_context", lambda q, meta: ("", []))
        return _grounded_as("member-1", query)


@pytest.fixture
def cohort(monkeypatch):
    from api.services import rollout

    calls: list = []
    members = {"member-1"}

    def includes(user_id, name, *, conn=None):
        calls.append((user_id, name))
        return user_id in members

    monkeypatch.setattr(rollout, "includes", includes)
    return calls


def test_flag_off_is_byte_identical_and_reads_no_store(seeded, monkeypatch, cohort):
    _stub_router(monkeypatch)
    retrieval.refresh(force=True)
    monkeypatch.delenv("ASKAI_WISDOM_RETRIEVAL_ENABLED", raising=False)
    touched: list = []
    real_connect = store.connect
    monkeypatch.setattr(store, "connect", lambda *a, **k: touched.append(1) or real_connect(*a, **k))
    got = _grounded_as("member-1")
    assert touched == [] and cohort == []  # kill switch first: neither wisdom.db nor the cohort read
    assert got == _baseline(monkeypatch)
    assert "wisdom" not in got[2]["grounding_sources"] and got[1] == "salt0"


def test_flag_on_for_a_cohort_member_adds_a_cited_labelled_block(seeded, monkeypatch, cohort):
    _stub_router(monkeypatch)
    retrieval.refresh(force=True)
    monkeypatch.setenv("ASKAI_WISDOM_RETRIEVAL_ENABLED", "1")
    system, salt, meta = _grounded_as("member-1")
    base_system, base_salt, _ = _baseline(monkeypatch)
    assert system.startswith(base_system) and system != base_system
    block = system[len(base_system):]
    assert block.startswith("\n\nUCT SAID")
    assert "[TSDR · 2026-09-08 · provisional]" in block and "· confirmed]" in block
    assert meta["grounding_sources"].count("wisdom") == 1
    assert salt == base_salt + "|wisdom"
    cites = meta["wisdom_citations"]
    assert cites and all(common.LOCATOR_RE.match(c["locator"]) for c in cites)
    assert all(f"(cite: {c['locator']})" in block for c in cites)
    assert ("member-1", "wisdom-askai") in cohort
    # guests never appear as "UCT said"
    assert "Guest" not in block and "momentum bursts" not in block.lower()


def test_outside_the_cohort_or_without_an_asker_nothing_changes(seeded, monkeypatch, cohort):
    _stub_router(monkeypatch)
    retrieval.refresh(force=True)
    monkeypatch.setenv("ASKAI_WISDOM_RETRIEVAL_ENABLED", "1")
    base = _baseline(monkeypatch)
    assert _grounded_as("member-2") == base
    before = len(cohort)
    assert _grounded_as(None) == base
    assert len(cohort) == before  # no asker: the cohort is not even asked
    # control: the member IS in the cohort and does get the block
    assert _grounded_as("member-1") != base


def test_an_ineligible_question_with_no_ticker_gets_no_block(seeded, monkeypatch, cohort):
    _stub_router(monkeypatch, tickers=(), question_type="earnings-date")
    retrieval.refresh(force=True)
    monkeypatch.setenv("ASKAI_WISDOM_RETRIEVAL_ENABLED", "1")
    q = "when does the flat base pivot report"
    assert _grounded_as("member-1", q) == _baseline(monkeypatch, q)


class _Stop(Exception):
    pass


def _stub_endpoint(monkeypatch, seen):
    def grounded(q):  # ONE argument, like the existing monkeypatches of _grounded_system
        seen.append(ai._WISDOM_ASKER.get())
        raise _Stop()

    monkeypatch.setattr(ai, "_grounded_system", grounded)
    monkeypatch.setattr(ai, "_personal_enabled", lambda: False)
    monkeypatch.setattr(ai, "_wants_agent", lambda q, m: False)
    monkeypatch.setattr(ai, "_reserve", lambda *a, **k: None)
    monkeypatch.setattr(ai, "_record_request", lambda *a, **k: None)


def test_the_sync_endpoint_carries_the_asker_and_resets_it(monkeypatch):
    seen: list = []
    _stub_endpoint(monkeypatch, seen)
    with pytest.raises(_Stop):
        ai.ai_search(ai.AiSearchIn(query=QUESTION), {"id": "member-7"})
    assert seen == ["member-7"]
    assert ai._WISDOM_ASKER.get() is None


def test_the_stream_endpoint_carries_the_asker_into_its_executor_thread(monkeypatch):
    seen: list = []
    _stub_endpoint(monkeypatch, seen)
    with pytest.raises(_Stop):
        asyncio.run(ai.ai_search_stream(ai.AiSearchIn(query=QUESTION), {"id": "member-8"}))
    assert seen == ["member-8"]
    assert ai._WISDOM_ASKER.get() is None


def test_every_source_appended_in_grounded_system_is_mapped_or_declared_no_twin():
    tree = ast.parse((REPO / "api" / "routers" / "ai_search.py").read_text(encoding="utf-8"))
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_grounded_system")
    appended = set()
    for node in ast.walk(fn):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "append"
                and isinstance(node.func.value, ast.Subscript)
                and isinstance(node.func.value.slice, ast.Constant)
                and node.func.value.slice.value == "grounding_sources"
                and node.args and isinstance(node.args[0], ast.Constant)):
            appended.add(node.args[0].value)
    assert {"playbook", "wisdom"} <= appended  # non-vacuity: the walk sees both direct appends
    exam = ast.parse((REPO / "tests" / "test_ai_search_fast_lane_exam.py").read_text(encoding="utf-8"))
    no_twin = next(ast.literal_eval(n.value) for n in ast.walk(exam)
                   if isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "no_twin" for t in n.targets))
    from api.services.ai_search_eval import runner

    unmapped = sorted(appended - set(runner._PACK_TOOL_ALIAS) - set(no_twin))
    assert not unmapped, f"grounding sources with no tool alias and no no_twin exemption: {unmapped}"


def test_wisdom_answers_are_time_sensitive_and_have_a_chip_label():
    from api.services import ai_search_log

    assert "wisdom" in ai_search_log._LIVE_SOURCES
    assert ai_search_log.classify_freshness("what is a flat base", None, ["wisdom"]) == "time_sensitive"
    # control: the same question grounded on an ambient source only stays evergreen-eligible
    assert ai_search_log.classify_freshness("what is a flat base", None, ["regime"]) != "time_sensitive"
    widget = (REPO / "app" / "src" / "pages" / "charts" / "widgets" / "AiSearchWidget.jsx").read_text(encoding="utf-8")
    labels = re.search(r"const GROUNDING_LABELS = \{(.*?)\n\}", widget, re.S).group(1)
    assert re.search(r"\bplaybook: 'UCT playbook'", labels)  # control: the parse sees real entries
    assert re.search(r"\bwisdom: 'UCT said'", labels)

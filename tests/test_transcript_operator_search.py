"""BRK-09: Boolean / NEAR / synonym operators over the transcript corpus,
through the filing-search operator module (NO second parser). Dark:
TRANSCRIPT_OPERATOR_SEARCH_ENABLED."""
from __future__ import annotations

import ast
import importlib
import pathlib

import pytest

from api.services import filing_search

_REPO = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture
def ix(tmp_path, monkeypatch):
    monkeypatch.setenv("TRANSCRIPT_INDEX_DB_PATH", str(tmp_path / "t.db"))
    import api.services.transcript_index as m
    importlib.reload(m)
    m.init_db()
    monkeypatch.setenv(m.OPERATORS_ENV, "1")
    m.put("AAPL", 2026, 3, "2026-08-01",
          "We are seeing tariff pressure on components from China. Pricing power remains strong.")
    m.put("MSFT", 2026, 4, "2026-08-02",
          "Artificial intelligence demand accelerated. No tariff impact this quarter.")
    m.put("F", 2026, 2, "2026-05-01", "Layoffs concluded and margins recovered after duties eased.")
    m.put("GM", 2026, 2, "2026-05-02",
          "Tariffs were discussed at length. Much later in the call, China was mentioned once "
          "in a completely different context about a supplier we do not use anymore at all.")
    return m


def _syms(r):
    return {h["symbol"] for h in r["hits"]}


def test_OR_widens(ix):
    assert _syms(ix.search("layoffs OR intelligence")) == {"F", "MSFT"}


def test_NOT_excludes(ix):
    # F matches through the "duties" synonym and never mentions China.
    assert _syms(ix.search("tariff NOT china")) == {"MSFT", "F"}


def test_NEAR_is_proximity_not_mere_co_occurrence(ix):
    r = ix.search("tariff NEAR/6 china")
    assert "AAPL" in _syms(r) and "GM" not in _syms(r)
    # CONTROL: the same two words ANDed DO co-occur in GM's call.
    assert "GM" in _syms(ix.search("tariff china"))


def test_synonyms_expand_and_are_reported(ix):
    r = ix.search("tariff")
    assert "F" in _syms(r)                        # "duties" is a curated synonym
    assert "tariff" in r["expanded"] and r["operators"] is True
    # =exact turns the synonym off.
    assert "F" not in _syms(ix.search("=tariff"))


def test_an_exact_word_is_rechecked_against_the_call_text(ix):
    # FTS matches "tariffs" stemmed (AAPL, MSFT, GM); only GM says "Tariffs".
    r = ix.search("=tariffs")
    assert _syms(r) == {"GM"}
    assert any("checked against the call text" in n for n in r["notes"])


def test_a_filing_scope_is_refused_with_a_sentence_never_ignored(ix):
    r = ix.search("tariff section:risk")
    assert r["query_error"] is True and "section" in r["error"] and r["hits"] == []
    assert ix.trend("tariff form:10-K")["query_error"] is True


def test_a_malformed_query_is_a_sentence_never_a_500(ix):
    r = ix.search("(tariff OR")
    assert r["query_error"] is True and r["error"]


def test_trend_uses_the_same_operators(ix):
    out = ix.trend("layoffs OR intelligence", months=36)
    assert out["total"] == 2


def test_dark_is_todays_quoted_AND_search(ix, monkeypatch):
    monkeypatch.delenv(ix.OPERATORS_ENV)
    r = ix.search("tariff OR layoffs")            # OR is just a word when dark
    assert r["total"] == 0 and "operators" not in r
    assert ix.search("tariff")["total"] == 3      # tariff/tariffs stem, no synonyms


def test_no_second_parser_the_operator_path_calls_filing_search():
    src = (_REPO / "api/services/transcript_index.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    calls = {n.func.attr for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert "compile_query" in calls and "passes" in calls
    # No grammar of its own: no tokenizer or parser lives in this module.
    assert "_Parser" not in src and "def _tokens" not in src and "re.compile" not in src
    assert not any(isinstance(n, ast.ClassDef) for n in ast.walk(tree))


def test_filings_keep_their_scopes():
    q = filing_search.compile_query("tariff section:risk form:10-K")
    assert q["section"] and q["form"] == "10-K"

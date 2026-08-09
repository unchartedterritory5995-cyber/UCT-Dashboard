"""Cross-company transcript search.

The feature is "who said X this quarter", so what these pin is: a search finds
the right calls, a hostile query cannot 500, and the corpus does not fill with
the same company under two tickers.
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture
def ix(tmp_path, monkeypatch):
    monkeypatch.setenv("TRANSCRIPT_INDEX_DB_PATH", str(tmp_path / "t.db"))
    import api.services.transcript_index as m
    importlib.reload(m)
    m.init_db()
    return m


def _seed(ix):
    ix.put("AAPL", 2026, 3, "2026-08-01",
           "We are seeing tariff pressure on components. Pricing power remains strong.")
    ix.put("MSFT", 2026, 4, "2026-08-02",
           "Artificial intelligence demand accelerated. No tariff impact this quarter.")
    ix.put("F", 2026, 2, "2026-05-01",
           "Layoffs concluded and margins recovered.")


class TestSearchFindsTheRightCalls:
    def test_finds_a_term_across_companies(self, ix):
        _seed(ix)
        r = ix.search("tariff")
        assert r["total"] == 2
        assert {h["symbol"] for h in r["hits"]} == {"AAPL", "MSFT"}

    def test_snippet_marks_the_match_so_the_reader_sees_why_it_hit(self, ix):
        _seed(ix)
        hit = ix.search("tariff", symbol="AAPL")["hits"][0]
        assert "<mark>tariff</mark>" in hit["snippet"]

    def test_stemming_finds_the_word_the_speaker_actually_used(self, ix):
        # A reader searches "layoffs"; the transcript says "Layoffs". Porter
        # stemming is why plural/singular does not lose the hit.
        _seed(ix)
        assert ix.search("layoff")["total"] == 1
        assert ix.search("layoffs")["total"] == 1

    def test_phrase_search_is_not_two_loose_words(self, ix):
        ix.put("X", 2026, 1, "2026-08-03", "pricing power is strong")
        ix.put("Y", 2026, 1, "2026-08-03", "power pricing was discussed separately")
        r = ix.search('"pricing power"')
        assert [h["symbol"] for h in r["hits"]] == ["X"]

    def test_filters_by_symbol_and_by_date(self, ix):
        _seed(ix)
        assert ix.search("tariff", symbol="MSFT")["total"] == 1
        # F's call is in May; the others are August.
        assert ix.search("margins", since="2026-06-01")["total"] == 0
        assert ix.search("margins")["total"] == 1


class TestAHostileQueryCannotBreakSearch:
    @pytest.mark.parametrize("q", [
        'AT&T', 'Q3:', 'unbalanced "quote', 'trailing-', '*', '(((', 'a OR b',
        'NEAR(', '""', '-', '^caret',
    ])
    def test_bare_user_text_never_raises(self, ix, q):
        # FTS5 MATCH has its own grammar: each of these is a syntax error as a
        # raw query and would surface as a 500 on an ordinary search box.
        _seed(ix)
        out = ix.search(q)
        assert isinstance(out["hits"], list)

    def test_an_empty_query_returns_nothing_rather_than_everything(self, ix):
        _seed(ix)
        for q in ("", "   ", None):
            assert ix.search(q)["total"] == 0

    def test_punctuation_still_matches_the_word_inside_it(self, ix):
        _seed(ix)
        assert ix.search("tariff!")["total"] == 2


class TestCorpusHousekeeping:
    def test_reindexing_a_call_REPLACES_it_rather_than_duplicating(self, ix):
        # FTS5 has no upsert. Without an explicit delete the same call returns
        # twice in every search that matches it.
        ix.put("AAPL", 2026, 3, "2026-08-01", "first version mentions widgets")
        ix.put("AAPL", 2026, 3, "2026-08-01", "second version mentions widgets")
        r = ix.search("widgets")
        assert r["total"] == 1
        assert "second" in r["hits"][0]["snippet"]

    def test_has_is_true_only_for_an_indexed_call(self, ix):
        ix.put("AAPL", 2026, 3, "2026-08-01", "x")
        assert ix.has("AAPL", 2026, 3) is True
        assert ix.has("AAPL", 2026, 2) is False
        assert ix.has("NOPE", 2026, 3) is False

    def test_prune_drops_only_calls_past_the_window(self, ix):
        ix.put("OLD", 2020, 1, "2020-01-01", "ancient")
        ix.put("NEW", 2026, 3, "2026-08-01", "recent")
        assert ix.prune(days=365) == 1
        assert ix.search("ancient")["total"] == 0
        assert ix.search("recent")["total"] == 1

    def test_stats_report_the_corpus_not_merely_that_it_ran(self, ix):
        _seed(ix)
        s = ix.stats()
        assert s["transcripts"] == 3 and s["symbols"] == 3
        assert s["newest"] == "2026-08-02" and s["oldest"] == "2026-05-01"

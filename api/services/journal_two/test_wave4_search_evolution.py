"""Wave 4 (Search Evolution I) — date-range filter, relevance ranking,
query-aware snippets, entity-anchored (sector/theme) retrieval, and the
$NVDA ticker-field correctness fix.

Same in-memory-schema fixture pattern as test_notes_fts.py — these tests
exercise the real trigger-maintained FTS5 index, not a mock.
"""
import sqlite3

from api.services.journal_two.db import ensure_schema


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    return c


def _insert_note(c, note_id, user_id="u1", title="", body_plain="",
                  created_at="2026-01-01T00:00:00+00:00", ticker=None, tags="[]"):
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
        " ticker, tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (note_id, user_id, title, '{"type":"doc","content":[]}', body_plain,
         ticker, tags, created_at, created_at),
    )
    c.commit()


def _insert_mention(c, note_id, user_id, symbol):
    c.execute(
        "INSERT INTO j2_note_mentions (note_id, user_id, symbol, created_at)"
        " VALUES (?, ?, ?, ?)",
        (note_id, user_id, symbol, "2026-01-01T00:00:00+00:00"),
    )
    c.commit()


# ── Slice 1: date-range filter ──────────────────────────────────────────────

def test_index_exists():
    """idx_j2_notes_user_created must exist after ensure_schema -- the whole
    point of Slice 1 is removing the temp-B-tree sort a date-range query
    would otherwise need."""
    c = _conn()
    names = {r["name"] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='j2_notes'")}
    assert "idx_j2_notes_user_created" in names


def test_date_from_includes_boundary_day():
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", created_at="2026-03-01T00:00:00+00:00")
    _insert_note(c, "n2", created_at="2026-02-28T23:59:59+00:00")
    ids = {r["id"] for r in list_notes("u1", date_from="2026-03-01", conn=c)}
    assert ids == {"n1"}


def test_date_to_includes_the_whole_boundary_day():
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", created_at="2026-03-31T23:00:00+00:00")
    _insert_note(c, "n2", created_at="2026-04-01T00:00:01+00:00")
    ids = {r["id"] for r in list_notes("u1", date_to="2026-03-31", conn=c)}
    assert ids == {"n1"}


def test_date_range_composes_with_keyword_search():
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", body_plain="semiconductor capex", created_at="2026-03-15T00:00:00+00:00")
    _insert_note(c, "n2", body_plain="semiconductor capex", created_at="2026-05-01T00:00:00+00:00")
    ids = {r["id"] for r in list_notes(
        "u1", q="semiconductor", date_from="2026-03-01", date_to="2026-03-31", conn=c)}
    assert ids == {"n1"}


def test_date_range_composes_with_zero_query_filters_only():
    """The combined-search contract explicitly supports a filters-only
    search (no keyword at all)."""
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", created_at="2026-03-15T00:00:00+00:00")
    _insert_note(c, "n2", created_at="2026-06-01T00:00:00+00:00")
    ids = {r["id"] for r in list_notes("u1", date_from="2026-03-01", date_to="2026-03-31", conn=c)}
    assert ids == {"n1"}


def test_date_filter_never_leaks_across_tenants():
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", user_id="u1", created_at="2026-03-15T00:00:00+00:00")
    _insert_note(c, "n2", user_id="u2", created_at="2026-03-15T00:00:00+00:00")
    ids = {r["id"] for r in list_notes("u1", date_from="2026-03-01", date_to="2026-03-31", conn=c)}
    assert ids == {"n1"}


def test_date_filter_excludes_trashed_notes_by_default():
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", created_at="2026-03-15T00:00:00+00:00")
    c.execute("UPDATE j2_notes SET deleted_at = '2026-04-01T00:00:00Z' WHERE id = 'n1'")
    c.commit()
    ids = {r["id"] for r in list_notes("u1", date_from="2026-03-01", date_to="2026-03-31", conn=c)}
    assert ids == set()


def test_count_notes_agrees_with_list_notes_on_date_filter():
    """Same discipline as the pre-existing count/list agreement tests --
    built from the SAME predicate, so they can never silently disagree."""
    from api.services.journal_two.notes import list_notes, count_notes
    c = _conn()
    _insert_note(c, "n1", created_at="2026-03-15T00:00:00+00:00")
    _insert_note(c, "n2", created_at="2026-03-20T00:00:00+00:00")
    _insert_note(c, "n3", created_at="2026-06-01T00:00:00+00:00")
    rows = list_notes("u1", date_from="2026-03-01", date_to="2026-03-31", conn=c)
    total = count_notes("u1", date_from="2026-03-01", date_to="2026-03-31", conn=c)
    assert len(rows) == total == 2


# ── Slice 2: relevance ranking + snippets ───────────────────────────────────

def test_relevance_sort_is_opt_in_default_stays_updated_desc():
    """Every pre-Wave-4 caller (sort="updated", the default) must see
    byte-identical ordering -- relevance ranking must never apply itself
    silently."""
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "old_but_recently_touched", body_plain="guidance guidance guidance",
                 created_at="2026-01-01T00:00:00+00:00")
    c.execute("UPDATE j2_notes SET updated_at = '2026-06-01T00:00:00+00:00' WHERE id = 'old_but_recently_touched'")
    _insert_note(c, "sparse_match", body_plain="a note that mentions guidance once",
                 created_at="2026-01-02T00:00:00+00:00")
    c.execute("UPDATE j2_notes SET updated_at = '2026-01-02T00:00:00+00:00' WHERE id = 'sparse_match'")
    c.commit()
    ids = [r["id"] for r in list_notes("u1", q="guidance", conn=c)]  # sort defaults to "updated"
    assert ids[0] == "old_but_recently_touched", "default sort must stay recency, not relevance"


def test_relevance_sort_ranks_the_stronger_text_match_first():
    from api.services.journal_two.notes import list_notes
    c = _conn()
    # Weaker match, touched more recently.
    _insert_note(c, "weak_but_recent", body_plain="a note that mentions guidance once in passing",
                 created_at="2026-01-01T00:00:00+00:00")
    c.execute("UPDATE j2_notes SET updated_at = '2026-06-01T00:00:00+00:00' WHERE id = 'weak_but_recent'")
    # Stronger match (denser term usage), touched long ago.
    _insert_note(c, "strong_but_old",
                 body_plain="guidance guidance guidance guidance was the whole subject of this note about guidance",
                 created_at="2026-01-02T00:00:00+00:00")
    c.execute("UPDATE j2_notes SET updated_at = '2026-01-02T00:00:00+00:00' WHERE id = 'strong_but_old'")
    c.commit()
    ids = [r["id"] for r in list_notes("u1", q="guidance", sort="relevance", conn=c)]
    assert ids[0] == "strong_but_old", f"expected the denser text match to rank first, got {ids}"


def test_relevance_sort_ranks_an_exact_ticker_match_above_a_fuzzy_text_hit():
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "exact_ticker", ticker="NVDA", body_plain="thesis with no text mention of the ticker",
                 created_at="2026-01-01T00:00:00+00:00")
    _insert_note(c, "text_mention_only", body_plain="a long note that happens to mention nvda once",
                 created_at="2026-01-02T00:00:00+00:00")
    ids = [r["id"] for r in list_notes("u1", q="NVDA", sort="relevance", conn=c)]
    assert ids[0] == "exact_ticker"


def test_relevance_sort_with_no_query_falls_back_to_updated_desc():
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", created_at="2026-01-01T00:00:00+00:00")
    c.execute("UPDATE j2_notes SET updated_at = '2026-01-01T00:00:00+00:00' WHERE id='n1'")
    _insert_note(c, "n2", created_at="2026-01-02T00:00:00+00:00")
    c.execute("UPDATE j2_notes SET updated_at = '2026-06-01T00:00:00+00:00' WHERE id='n2'")
    c.commit()
    ids = [r["id"] for r in list_notes("u1", sort="relevance", conn=c)]  # no q at all
    assert ids == ["n2", "n1"]


def test_snippet_highlights_the_matched_term_in_body():
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", body_plain="the thesis centers on semiconductor capex accelerating")
    rows = list_notes("u1", q="capex", conn=c)
    assert len(rows) == 1
    assert "<mark>capex</mark>" in rows[0]["bodySnippet"]


def test_snippet_absent_when_no_query():
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", body_plain="anything")
    rows = list_notes("u1", conn=c)
    assert "bodySnippet" not in rows[0]


def test_tag_only_match_gets_no_snippet_not_a_blank_one():
    """A tag-only match never went through FTS5 at all -- j2_notes_fts has no
    row keyed to a match for this query, so the two-pass snippet fetch must
    correctly produce nothing for it, not an empty-but-present string that
    could be mistaken for a real (if short) match."""
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", body_plain="totally unrelated content", tags='["quote"]')
    rows = list_notes("u1", q="quote", conn=c)
    assert len(rows) == 1
    assert "bodySnippet" not in rows[0]


def test_title_and_body_snippets_are_independent_columns():
    """highlight()/snippet() only mark matches within the SPECIFIC column
    requested -- a body-only match must not report a title snippet, and
    vice versa."""
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "body_hit", title="Unrelated title", body_plain="mentions capex here")
    _insert_note(c, "title_hit", title="Capex outlook", body_plain="unrelated body text")
    rows = {r["id"]: r for r in list_notes("u1", q="capex", conn=c)}
    assert "<mark>capex</mark>" in rows["body_hit"]["bodySnippet"]
    assert rows["body_hit"].get("titleSnippet", "") == ""
    assert "<mark>Capex</mark>" in rows["title_hit"]["titleSnippet"]


def test_snippet_scoped_to_the_returned_page_only():
    """Cost must stay bounded by what's actually rendered -- the snippet
    query must never be asked to compute across the whole match set when
    only one page is returned."""
    from api.services.journal_two.notes import list_notes
    c = _conn()
    for i in range(5):
        _insert_note(c, f"n{i}", body_plain="guidance revenue outlook")
    rows = list_notes("u1", q="guidance", limit=2, conn=c)
    assert len(rows) == 2
    assert all("bodySnippet" in r for r in rows)


# ── Slice 3: entity-anchored (sector/theme) retrieval ───────────────────────

def _stub_ticker_meta(monkeypatch, table):
    def fake(sym):
        return table.get(sym, {"sector": None, "industry": None, "theme": None})
    monkeypatch.setattr("api.services.ticker_meta.get_ticker_meta", fake)


def test_resolve_sector_theme_symbols_returns_none_when_neither_requested():
    from api.services.journal_two.notes import resolve_sector_theme_symbols
    c = _conn()
    assert resolve_sector_theme_symbols("u1", conn=c) is None


def test_resolve_sector_theme_symbols_scoped_to_the_members_own_vocabulary(monkeypatch):
    from api.services.journal_two.notes import resolve_sector_theme_symbols
    c = _conn()
    _insert_note(c, "n1", user_id="u1")
    _insert_mention(c, "n1", "u1", "NVDA")
    _insert_note(c, "n2", user_id="u1")
    _insert_mention(c, "n2", "u1", "JPM")
    _stub_ticker_meta(monkeypatch, {
        "NVDA": {"sector": "Technology", "industry": "Semiconductors", "theme": "AI Infrastructure"},
        "JPM": {"sector": "Financials", "industry": "Banks", "theme": None},
    })
    matched = resolve_sector_theme_symbols("u1", sector="Technology", conn=c)
    assert matched == ["NVDA"]


def test_resolve_sector_theme_symbols_empty_vocabulary_returns_empty_list(monkeypatch):
    from api.services.journal_two.notes import resolve_sector_theme_symbols
    c = _conn()
    matched = resolve_sector_theme_symbols("u1", sector="Technology", conn=c)
    assert matched == []


def test_resolve_sector_theme_symbols_no_match_returns_empty_list(monkeypatch):
    from api.services.journal_two.notes import resolve_sector_theme_symbols
    c = _conn()
    _insert_note(c, "n1", user_id="u1")
    _insert_mention(c, "n1", "u1", "JPM")
    _stub_ticker_meta(monkeypatch, {"JPM": {"sector": "Financials", "industry": "Banks", "theme": None}})
    matched = resolve_sector_theme_symbols("u1", sector="Technology", conn=c)
    assert matched == []


def test_resolve_sector_theme_symbols_both_given_requires_both_to_match(monkeypatch):
    from api.services.journal_two.notes import resolve_sector_theme_symbols
    c = _conn()
    _insert_note(c, "n1", user_id="u1")
    _insert_mention(c, "n1", "u1", "NVDA")
    _insert_note(c, "n2", user_id="u1")
    _insert_mention(c, "n2", "u1", "AMD")
    _stub_ticker_meta(monkeypatch, {
        "NVDA": {"sector": "Technology", "industry": "Semiconductors", "theme": "AI Infrastructure"},
        "AMD": {"sector": "Technology", "industry": "Semiconductors", "theme": "Data Center"},
    })
    matched = resolve_sector_theme_symbols("u1", sector="Technology", theme="AI Infrastructure", conn=c)
    assert matched == ["NVDA"]


def test_resolve_sector_theme_symbols_ignores_a_provider_failure_for_one_symbol(monkeypatch):
    from api.services.journal_two.notes import resolve_sector_theme_symbols
    c = _conn()
    _insert_note(c, "n1", user_id="u1")
    _insert_mention(c, "n1", "u1", "NVDA")
    _insert_note(c, "n2", user_id="u1")
    _insert_mention(c, "n2", "u1", "BADSYM")

    def flaky(sym):
        if sym == "BADSYM":
            raise RuntimeError("provider hiccup")
        return {"sector": "Technology", "industry": "Semiconductors", "theme": None}
    monkeypatch.setattr("api.services.ticker_meta.get_ticker_meta", flaky)

    matched = resolve_sector_theme_symbols("u1", sector="Technology", conn=c)
    assert matched == ["NVDA"]


def test_symbol_in_filter_composes_via_list_notes(monkeypatch):
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", user_id="u1", body_plain="thesis note")
    _insert_mention(c, "n1", "u1", "NVDA")
    _insert_note(c, "n2", user_id="u1", body_plain="unrelated note")
    _insert_mention(c, "n2", "u1", "JPM")
    ids = {r["id"] for r in list_notes("u1", symbol_in=["NVDA"], conn=c)}
    assert ids == {"n1"}


def test_symbol_in_empty_list_is_an_honest_empty_result_not_ignored():
    """A sector/theme filter that matched NOTHING in the member's own
    vocabulary must filter to zero rows, never silently behave as if no
    filter were applied at all."""
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", user_id="u1", body_plain="anything")
    ids = {r["id"] for r in list_notes("u1", symbol_in=[], conn=c)}
    assert ids == set()


# ── Slice 4: $NVDA ticker-field-only correctness fix ────────────────────────

def test_dollar_ticker_matches_a_ticker_field_only_note():
    """The confirmed pre-existing gap: '$NVDA' used to find nothing for a
    note whose ONLY NVDA signal was the ticker field (no text mention
    anywhere) -- fts_match_expr already stripped the $ for the FTS branch;
    only the exact-ticker comparison was unstripped."""
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", ticker="NVDA", body_plain="no text mention of the symbol at all")
    ids = {r["id"] for r in list_notes("u1", q="$NVDA", conn=c)}
    assert ids == {"n1"}


def test_plain_ticker_query_still_matches_unaffected():
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", ticker="NVDA", body_plain="no text mention")
    ids = {r["id"] for r in list_notes("u1", q="NVDA", conn=c)}
    assert ids == {"n1"}


def test_hyphenated_ticker_query_is_unaffected_by_the_leading_separator_strip():
    """Only the LEADING separator is stripped -- an internal hyphen
    (BRK-B) must be preserved so the exact-ticker comparison still matches
    a note whose ticker field is literally 'BRK-B'."""
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", ticker="BRK-B", body_plain="no text mention")
    ids = {r["id"] for r in list_notes("u1", q="BRK-B", conn=c)}
    assert ids == {"n1"}

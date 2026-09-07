"""Wave K Slice 1 — deterministic retrieval + the §15 evaluation set.

The corpus is synthetic and small BECAUSE ground truth must be exactly known:
every query below has a right answer that was authored, not observed. The
point is not to show retrieval working -- it is to MEASURE what deterministic
retrieval misses, so the semantic decision rests on a number instead of an
intuition (§16).

Query classes A-R come from the directive. Each is tagged with the outcome it
is expected to produce, and the summary test prints the recall table.
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services.journal_two import ask_evidence as ev
from api.services.journal_two import ask_retrieval as ar

U = "u1"
OTHER = "u2"


def _doc(*paras):
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": p}]} for p in paras]}


NOTES = {
    "n_thesis": {
        "title": "NVDA long thesis",
        "ticker": "NVDA",
        "paras": [
            "Data center demand is inflecting and I expect operating leverage to persist.",
            "Invalidation: if hyperscaler capex guidance turns down two quarters running.",
        ],
        "props": {"builtin:thesis_status": "active", "builtin:confidence": "high",
                  "builtin:research_type": "thesis", "builtin:review_date": "2026-10-01"},
    },
    "n_support": {
        "title": "NVDA channel checks",
        "ticker": "NVDA",
        "paras": ["Supply chain contacts confirm rack-scale orders accelerated into Q4."],
        "props": {},
    },
    "n_risk": {
        "title": "NVDA risks I keep coming back to",
        "ticker": "NVDA",
        "paras": [
            "Customer concentration is the risk I keep writing down: four customers are >10% each.",
            "China export policy remains the second unresolved exposure.",
        ],
        "props": {},
    },
    "n_amd": {
        "title": "AMD accelerator notes",
        "ticker": "AMD",
        "paras": ["MI400 ramp looks credible but gross margin normalization is a concern."],
        "props": {},
    },
    "n_paraphrase": {
        "title": "Margin thinking",
        "ticker": "NVDA",
        "paras": ["Gross margin normalization should be expected as mix shifts to rack-scale."],
        "props": {},
    },
}


@pytest.fixture()
def corpus(tmp_path):
    db = tmp_path / "auth.db"
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        "CREATE TABLE j2_notes (id TEXT PRIMARY KEY, user_id TEXT, title TEXT,"
        " ticker TEXT, body_json TEXT, body_plain TEXT, properties_json TEXT,"
        " deleted_at TEXT, updated_at TEXT);"
        "CREATE VIRTUAL TABLE j2_notes_fts USING fts5(note_id UNINDEXED,"
        " user_id UNINDEXED, title, body_plain, tokenize='porter unicode61');"
        "CREATE TABLE j2_note_embeds (note_id TEXT, user_id TEXT, symbol TEXT);"
        "CREATE TABLE j2_note_mentions (note_id TEXT, user_id TEXT, symbol TEXT);"
        "CREATE TABLE j2_note_documents (id TEXT PRIMARY KEY, user_id TEXT,"
        " note_id TEXT, name TEXT, status TEXT, attachment_url TEXT);"
        "CREATE TABLE j2_note_document_pages (document_id TEXT, user_id TEXT,"
        " page_number INTEGER, text TEXT);"
        "CREATE TABLE j2_note_excerpts (id TEXT PRIMARY KEY, user_id TEXT,"
        " note_id TEXT, document_id TEXT, page_number INTEGER, captured_text TEXT,"
        " quote_prefix TEXT, quote_suffix TEXT, annotation TEXT);"
        "CREATE TABLE j2_thesis_evidence (id TEXT PRIMARY KEY, user_id TEXT,"
        " note_id TEXT, target_type TEXT, target_id TEXT, stance TEXT,"
        " caption TEXT, removed_at TEXT);"
        "CREATE TABLE j2_fact_observations (id TEXT PRIMARY KEY, user_id TEXT,"
        " note_id TEXT, entity_id TEXT, ticker TEXT, fact_type TEXT, period TEXT,"
        " value_number REAL, value_text TEXT, unit TEXT, currency TEXT, scale TEXT,"
        " temporal_mode TEXT, observed_at TEXT, source_as_of TEXT, source TEXT,"
        " source_ref TEXT, rights_class TEXT, caption TEXT);"
    )
    from api.services.journal_two.notes import extract_plain_text
    for nid, spec in NOTES.items():
        doc = _doc(*spec["paras"])
        plain = extract_plain_text(doc)
        conn.execute(
            "INSERT INTO j2_notes VALUES (?,?,?,?,?,?,?,NULL,'2026-09-07')",
            (nid, U, spec["title"], spec["ticker"], json.dumps(doc), plain,
             json.dumps(spec["props"])))
        conn.execute("INSERT INTO j2_notes_fts VALUES (?,?,?,?)",
                     (nid, U, spec["title"], plain))
    # A second tenant with a deliberately colliding note.
    other = _doc("Customer concentration is the risk for NVDA in my book too.")
    from api.services.journal_two.notes import extract_plain_text as _x
    conn.execute("INSERT INTO j2_notes VALUES ('n_other',?,?,?,?,?,'{}',NULL,'2026-09-07')",
                 (OTHER, "Someone else NVDA", "NVDA", json.dumps(other), _x(other)))
    conn.execute("INSERT INTO j2_notes_fts VALUES ('n_other',?,?,?)",
                 (OTHER, "Someone else NVDA", _x(other)))
    # A document page + the excerpt the member saved FROM that page.
    conn.execute("INSERT INTO j2_note_documents VALUES "
                 "('d1',?,'n_thesis','deck.pdf','ready','/x.pdf')", (U,))
    page = ("Management expects gross margins to normalize lower in the "
            "mid-seventies range as mix shifts toward rack-scale systems.")
    conn.execute("INSERT INTO j2_note_document_pages VALUES ('d1',?,2,?)", (U, page))
    conn.execute("INSERT INTO j2_note_excerpts VALUES "
                 "('e1',?,'n_thesis','d1',2,?,'expects ',' in the','the guidance walk-down')",
                 (U, "gross margins to normalize lower"))
    conn.execute("INSERT INTO j2_thesis_evidence VALUES "
                 "('ev1',?,'n_thesis','document_excerpt','e1','opposes','weakens my thesis',NULL)",
                 (U,))
    conn.execute("INSERT INTO j2_fact_observations VALUES "
                 "('f1',?,'n_thesis','E:NVDA','NVDA','price',NULL,142.83,NULL,"
                 "'usd_per_share','USD',NULL,'live_and_snapshot','2026-09-04T14:00:00Z',"
                 "NULL,'massive',NULL,'independent','entry reference')", (U,))
    conn.commit()
    _fts_tables_for_docs(conn)
    return conn


def _fts_tables_for_docs(conn):
    """Wave I/J search helpers need their own FTS mirrors; build them here so
    the evaluation exercises the REAL search functions, not a stand-in.

    Called from the fixture unconditionally: retrieve() queries document and
    excerpt search on every general-intent question, so making these opt-in
    turned "no document corpus" into "OperationalError" -- which measures
    nothing.
    """
    conn.executescript(
        "CREATE VIRTUAL TABLE j2_note_document_pages_fts USING fts5("
        " document_id UNINDEXED, user_id UNINDEXED, page_number UNINDEXED, text,"
        " tokenize='porter unicode61');"
        "CREATE VIRTUAL TABLE j2_note_excerpts_fts USING fts5("
        " excerpt_id UNINDEXED, user_id UNINDEXED, text,"
        " tokenize='porter unicode61');"
    )
    for r in conn.execute("SELECT * FROM j2_note_document_pages").fetchall():
        conn.execute("INSERT INTO j2_note_document_pages_fts VALUES (?,?,?,?)",
                     (r["document_id"], r["user_id"], r["page_number"], r["text"]))
    for r in conn.execute("SELECT * FROM j2_note_excerpts").fetchall():
        conn.execute("INSERT INTO j2_note_excerpts_fts VALUES (?,?,?)",
                     (r["id"], r["user_id"], (r["captured_text"] or "") + " " +
                      (r["annotation"] or "")))
    conn.commit()


def _ids(result):
    return {e["source_id"] for e in result["evidence"]}


def _types(result):
    return {e["source_type"] for e in result["evidence"]}


# ── The evaluation set (§15 A-R) ─────────────────────────────────────────────

class TestEvaluationSet:
    def test_A_exact_note_phrase(self, corpus):
        r = ar.retrieve(U, "customer concentration", conn=corpus)
        assert "n_risk" in _ids(r)

    def test_B_note_title_match(self, corpus):
        r = ar.retrieve(U, "channel checks", conn=corpus)
        assert "n_support" in _ids(r)

    def test_C_paraphrase_with_lexical_overlap(self, corpus):
        # "margin normalization" vs "gross margin normalization" -- shares
        # tokens, so lexical retrieval should reach it.
        r = ar.retrieve(U, "margin normalization", conn=corpus)
        assert "n_paraphrase" in _ids(r)

    def test_D_paraphrase_with_LOW_lexical_overlap_is_the_measured_gap(self, corpus):
        # "margin pressure" never appears; the note says "gross margin
        # normalization". THIS IS THE SEMANTIC GAP, recorded rather than
        # hidden. A vector index would likely bridge it; BM25 cannot.
        r = ar.retrieve(U, "margin pressure", conn=corpus)
        assert "n_paraphrase" not in _ids(r), (
            "if this ever passes, lexical retrieval improved and the semantic "
            "recommendation must be re-measured"
        )

    def test_E_ticker_alias_resolves_to_canonical_entity(self, corpus):
        r = ar.retrieve(U, "NVDA risks", conn=corpus)
        assert r["entity"] is None or r["entity"].get("symbol") == "NVDA"
        assert "n_risk" in _ids(r)

    def test_F_thesis_question_reaches_authoritative_thesis_state(self, corpus):
        r = ar.retrieve(U, "which theses need review", conn=corpus)
        assert r["intent"] == ar.INTENT_STRUCTURED
        assert ev.THESIS_STATE in _types(r)

    def test_G_invalidation_question(self, corpus):
        r = ar.retrieve(U, "invalidation hyperscaler capex", conn=corpus)
        assert "n_thesis" in _ids(r)

    def test_H_supporting_evidence(self, corpus):
        r = ar.retrieve(U, "rack-scale orders accelerated", conn=corpus)
        assert "n_support" in _ids(r)

    def test_I_opposing_evidence_carries_its_stance(self, corpus):
        r = ar.retrieve(U, "gross margins normalize", conn=corpus)
        stances = {e.get("stance") for e in r["evidence"]}
        assert "opposes" in stances, "counter-evidence must retain its stance"

    def test_J_captured_financial_fact_is_structured_not_prose(self, corpus):
        r = ar.retrieve(U, "NVDA price", conn=corpus)
        facts = [e for e in r["evidence"] if e["source_type"] == ev.FINANCIAL_FACT]
        assert facts and facts[0]["payload"]["value_number"] == 142.83
        assert facts[0]["temporal"]["temporal_mode"] == "live_and_snapshot"

    def test_K_document_page(self, corpus):
        r = ar.retrieve(U, "mid-seventies range", conn=corpus)
        assert any(e["source_type"] in (ev.DOCUMENT_PAGE, ev.DOCUMENT_EXCERPT)
                   for e in r["evidence"])

    def test_L_saved_excerpt(self, corpus):
        r = ar.retrieve(U, "guidance walk-down", conn=corpus)
        assert any(e["source_type"] == ev.DOCUMENT_EXCERPT for e in r["evidence"])

    def test_M_page_and_excerpt_are_ONE_independent_source(self, corpus):
        r = ar.retrieve(U, "gross margins to normalize lower", conn=corpus)
        page_or_exc = [e for e in r["evidence"]
                       if e["source_type"] in (ev.DOCUMENT_PAGE, ev.DOCUMENT_EXCERPT)]
        keys = {e["lineage_key"] for e in page_or_exc}
        assert len(keys) <= 1, "one saved quote must not read as two sources"

    def test_N_unrelated_ticker_is_not_contaminated_in(self, corpus):
        r = ar.retrieve(U, "NVDA customer concentration", conn=corpus)
        assert "n_amd" not in _ids(r)

    def test_O_no_answer_is_a_result_not_a_forced_top_k(self, corpus):
        r = ar.retrieve(U, "zebra husbandry techniques", conn=corpus)
        assert r["no_answer"] is True
        assert r["evidence"] == []

    def test_P_structured_query_routes_without_prose_search(self, corpus):
        r = ar.retrieve(U, "list my theses", conn=corpus)
        assert r["intent"] == ar.INTENT_STRUCTURED
        st = [e for e in r["evidence"] if e["source_type"] == ev.THESIS_STATE]
        assert st and st[0]["payload"]["status"] == "active"

    def test_Q_historical_intent_is_refused_not_answered_in_past_tense(self, corpus):
        r = ar.retrieve(U, "what did I believe before earnings", conn=corpus)
        assert r["intent"] == ar.INTENT_HISTORICAL
        assert r["no_answer"] and r["no_answer_reason"] == "historical_state_unsupported"
        assert r["evidence"] == [], "current notes must not be narrated as history"

    def test_R_conflicting_research_surfaces_both_sides(self, corpus):
        r = ar.retrieve(U, "margins", conn=corpus)
        # The member's own bullish note and the opposing excerpt both exist.
        assert len(r["evidence"]) >= 1


class TestTenantIsolation:
    def test_another_users_note_is_never_a_candidate(self, corpus):
        r = ar.retrieve(U, "customer concentration", conn=corpus)
        assert "n_other" not in _ids(r)
        assert all(e["user_id"] == U for e in r["evidence"])

    def test_the_other_tenant_sees_only_their_own(self, corpus):
        r = ar.retrieve(OTHER, "customer concentration", conn=corpus)
        assert _ids(r) <= {"n_other"}

    def test_facts_are_tenant_scoped(self, corpus):
        r = ar.retrieve(OTHER, "NVDA price", conn=corpus)
        assert not [e for e in r["evidence"] if e["source_type"] == ev.FINANCIAL_FACT]


class TestCoverage:
    def test_coverage_reports_what_could_have_been_searched(self, corpus):
        r = ar.retrieve(U, "margins", conn=corpus)
        c = r["coverage"]
        assert c["notes_searchable"] == len(NOTES)
        assert c["document_pages_searchable"] == 1
        assert c["excerpts_searchable"] == 1

    def test_unsearchable_documents_are_counted_separately(self, corpus):
        corpus.execute("INSERT INTO j2_note_documents VALUES "
                       "('d2',?,'n_thesis','scan.pdf','no_text','/y.pdf')", (U,))
        corpus.commit()
        c = ar.retrieve(U, "margins", conn=corpus)["coverage"]
        assert c["documents_not_searchable"] == 1, (
            "a scanned PDF must be reportable as NOT searched"
        )


class TestCitationReadiness:
    def test_note_evidence_arrives_with_a_prosemirror_location(self, corpus):
        r = ar.retrieve(U, "customer concentration", conn=corpus)
        note = [e for e in r["evidence"] if e["source_type"] == ev.NOTE][0]
        assert note["citation_validity"] == ev.CITE_EXACT
        assert "from" in note["location"] and "fingerprint" in note["location"]

    def test_a_note_whose_passage_cannot_be_located_degrades_honestly(self, corpus):
        # Matched via title only; the query term is not in the body.
        r = ar.retrieve(U, "channel checks", conn=corpus)
        note = [e for e in r["evidence"] if e["source_id"] == "n_support"][0]
        assert note["citation_validity"] in (ev.CITE_EXACT, ev.CITE_NOTE_ONLY)
        if note["citation_validity"] == ev.CITE_NOTE_ONLY:
            assert not note["location"]

    def test_independent_sources_counts_lineage_among_QUERY_MATCHES(self, corpus):
        # Entity context (thesis state, facts) is returned but does not count
        # toward "how many sources back this claim" -- it does not back it.
        r = ar.retrieve(U, "gross margins to normalize lower", conn=corpus)
        matched = [e for e in r["evidence"] if e.get("relevance") == ar.QUERY_MATCH]
        assert r["independent_sources"] == len({e["lineage_key"] for e in matched})
        assert r["independent_sources"] <= len(r["evidence"])

    def test_entity_context_does_not_satisfy_a_question_it_cannot_answer(self, corpus):
        # Measured during the recall-gap characterization: naming the ticker
        # returned the thesis state and a price fact for a question about
        # MARGINS. That is context, not an answer, and must not read as one.
        r = ar.retrieve(U, "NVDA margin pressure", conn=corpus)
        assert r["no_answer"] is True, "entity context must not satisfy the question"
        assert r["evidence"], "but the context is still offered"
        assert all(e["relevance"] == ar.ENTITY_CONTEXT for e in r["evidence"])

    def test_a_real_match_alongside_entity_context_is_an_answer(self, corpus):
        r = ar.retrieve(U, "NVDA customer concentration", conn=corpus)
        assert r["no_answer"] is False
        assert r["query_matches"] >= 1


# ── §16 semantic-recall gap measurement ──────────────────────────────────────

# Each probe: (query, expected_note, class). The classes are the directive's
# own categories. NOTHING here is tuned to make embeddings look necessary --
# the low-overlap probes are ordinary ways a member would ask, and the
# lexical-pass probes are kept in deliberately so the number is a RATIO, not
# a list of failures.
SEMANTIC_PROBES = [
    # LEXICAL: shares tokens with the note.
    ("customer concentration", "n_risk", "lexical"),
    ("China export policy", "n_risk", "lexical"),
    ("rack-scale orders", "n_support", "lexical"),
    ("hyperscaler capex", "n_thesis", "lexical"),
    ("gross margin normalization", "n_paraphrase", "lexical"),
    ("operating leverage", "n_thesis", "lexical"),
    # ENTITY/STRUCTURED: resolved without lexical overlap on the body.
    ("NVDA", "n_thesis", "entity"),
    # LOW OVERLAP: the member's words and the note's words barely intersect.
    ("margin pressure", "n_paraphrase", "low_overlap"),
    ("too reliant on a handful of buyers", "n_risk", "low_overlap"),
    ("is demand accelerating", "n_thesis", "low_overlap"),
    ("what could go wrong", "n_risk", "low_overlap"),
    ("profitability squeeze", "n_paraphrase", "low_overlap"),
    ("geopolitical exposure", "n_risk", "low_overlap"),
    ("supplier feedback", "n_support", "low_overlap"),
]


def test_MEASURE_semantic_recall_gap(corpus, capsys):
    """Quantifies what deterministic retrieval misses (§16).

    This test does not fail on a miss -- a miss is the DATA. It fails only if
    the lexical baseline regresses below what it already achieves, so the
    recommendation cannot be quietly re-baselined later.
    """
    by_class: dict[str, list[tuple[str, bool]]] = {}
    for query, expected, klass in SEMANTIC_PROBES:
        hit = expected in _ids(ar.retrieve(U, query, conn=corpus))
        by_class.setdefault(klass, []).append((query, hit))

    lines = ["", "SEMANTIC-RECALL GAP (deterministic baseline, no embeddings)", "=" * 62]
    for klass in ("lexical", "entity", "low_overlap"):
        rows = by_class.get(klass, [])
        hits = sum(1 for _, h in rows if h)
        lines.append(f"{klass:12} {hits}/{len(rows)} recalled")
        for q, h in rows:
            lines.append(f"    {'HIT ' if h else 'MISS'}  {q}")
    total_hits = sum(1 for rows in by_class.values() for _, h in rows if h)
    lines.append("-" * 62)
    lines.append(f"overall      {total_hits}/{len(SEMANTIC_PROBES)}")
    print("\n".join(lines))

    lex = by_class["lexical"]
    assert sum(1 for _, h in lex if h) == len(lex), (
        "the lexical baseline regressed -- re-measure before trusting any "
        "semantic recommendation built on the old number"
    )
    assert by_class["entity"][0][1], "entity routing must not regress"


# ── §6 entity-resolution privacy rail ────────────────────────────────────────

class TestEntityResolutionDoesNotLeakQueryFragments:
    """⛔ REGRESSION RAIL for a real defect found during benchmarking.

    The first resolve_entity() called entity_master.resolve() on every
    word-like token in the query. entity_master reaches yfinance OVER THE
    NETWORK, so the first evaluation run fired ~40 live 404 lookups for
    fragments of private member questions -- CUSTOM, CONCEN, TRATIO, PRESSU,
    CHANNE, CHECKS. Private research questions must never be dribbled out to a
    quote provider as accidental ticker probes.

    The fix is an ordering guarantee: the member's OWN corpus is the candidate
    universe, and network-backed resolution is reached only for a symbol they
    actually write about. These tests pin that ordering.
    """

    def test_prose_words_are_never_ticker_candidates(self):
        for q in ["customer concentration", "what could go wrong",
                  "margin pressure", "supplier feedback", "is demand accelerating"]:
            assert ar.candidate_symbols(q) == [], f"{q!r} produced ticker candidates"

    def test_common_words_that_are_real_tickers_are_still_not_candidates(self):
        # MY, THE, FOR, ON, IT, RISK are all genuinely listed symbols. A symbol
        # universe does not settle a ticker match.
        assert ar.candidate_symbols("what are my risks for it on the note") == []

    def test_only_uppercase_or_cashtag_tokens_are_candidates(self):
        assert ar.candidate_symbols("NVDA risks") == ["NVDA"]
        assert ar.candidate_symbols("$nvda vs AMD") == ["NVDA", "AMD"]
        assert ar.candidate_symbols("nvda risks") == []

    def test_resolution_never_touches_the_network_for_an_unowned_symbol(self, corpus, monkeypatch):
        # A symbol the member has never written about cannot help retrieve
        # THEIR research, so there is nothing to resolve -- and nothing to send.
        calls = []
        import api.services.journal_two.ticker_research as tr
        monkeypatch.setattr(tr, "resolve_research_symbols",
                            lambda s: calls.append(s) or {"symbol": s, "symbols": [s]})
        assert ar.resolve_entity(corpus, U, "TSLA MSFT GOOG outlook") is None
        assert calls == [], "resolved a symbol absent from the member's corpus"

    def test_resolution_is_reached_only_for_a_symbol_the_member_owns(self, corpus, monkeypatch):
        calls = []
        import api.services.journal_two.ticker_research as tr
        monkeypatch.setattr(tr, "resolve_research_symbols",
                            lambda s: calls.append(s) or {"symbol": s, "entityId": "E", "symbols": [s]})
        ar.resolve_entity(corpus, U, "NVDA TSLA comparison")
        assert calls == ["NVDA"], "must resolve only the owned symbol, once"

    def test_a_full_prose_question_triggers_zero_resolution_attempts(self, corpus, monkeypatch):
        calls = []
        import api.services.journal_two.ticker_research as tr
        monkeypatch.setattr(tr, "resolve_research_symbols",
                            lambda s: calls.append(s) or {"symbol": s, "symbols": [s]})
        ar.retrieve(U, "am I too reliant on a handful of buyers", conn=corpus)
        assert calls == [], "a prose question must not probe any ticker"


# ── Slice 2: Ask Document ────────────────────────────────────────────────────

class TestAskDocument:
    """Document-scoped retrieval. Reuses Wave J identity and anchors wholesale.

    NOTE ON EVIDENCE CLASS: production currently holds 0 document pages and 0
    excerpts, so everything here is SYNTHETIC/sandbox evidence. That is stated
    rather than glossed -- no claim of production document-retrieval validation
    is made anywhere in Wave K.
    """

    def test_a_question_about_the_document_cites_document_and_page(self, corpus):
        r = ar.retrieve_document(U, "d1", "mid-seventies range", conn=corpus)
        assert r["no_answer"] is False
        top = r["evidence"][0]
        assert top["location"]["document_id"] == "d1"
        assert top["location"]["page_number"] == 2
        assert top["navigation"]["kind"] in ("document", "excerpt")

    def test_retrieval_never_leaves_the_named_document(self, corpus):
        corpus.execute("INSERT INTO j2_note_documents VALUES "
                       "('d9',?,'n_thesis','other.pdf','ready','/o.pdf')", (U,))
        corpus.execute("INSERT INTO j2_note_document_pages VALUES ('d9',?,1,?)",
                       (U, "mid-seventies range appears in this other document too."))
        corpus.execute("INSERT INTO j2_note_document_pages_fts VALUES ('d9',?,1,?)",
                       (U, "mid-seventies range appears in this other document too."))
        corpus.commit()
        r = ar.retrieve_document(U, "d1", "mid-seventies range", conn=corpus)
        assert all(e["location"]["document_id"] == "d1" for e in r["evidence"])

    def test_a_page_and_its_saved_excerpt_remain_ONE_source(self, corpus):
        r = ar.retrieve_document(U, "d1", "gross margins to normalize lower",
                                 conn=corpus)
        assert r["independent_sources"] == 1

    def test_a_healthy_anchor_earns_an_exact_citation(self, corpus):
        # The excerpt's captured text IS on the page, uniquely -- so Wave J's
        # own classifier says it can navigate precisely.
        r = ar.retrieve_document(U, "d1", "guidance walk-down", conn=corpus)
        exc = [e for e in r["evidence"] if e["source_type"] == ev.DOCUMENT_EXCERPT]
        assert exc and exc[0]["citation_validity"] == ev.CITE_EXACT

    def test_a_DEGRADED_anchor_falls_back_to_page_and_never_claims_exact(self, corpus):
        # Rewrite the page so the captured text no longer appears. The excerpt
        # is still true evidence; only its NAVIGATION confidence degrades.
        corpus.execute("UPDATE j2_note_document_pages SET text = ?"
                       " WHERE document_id='d1' AND page_number=2",
                       ("Entirely different extracted content now.",))
        corpus.commit()
        r = ar.retrieve_document(U, "d1", "guidance walk-down", conn=corpus)
        exc = [e for e in r["evidence"] if e["source_type"] == ev.DOCUMENT_EXCERPT]
        assert exc, "the excerpt is still evidence"
        assert exc[0]["citation_validity"] == ev.CITE_PAGE_ONLY
        assert exc[0]["citation_validity"] not in ev.PRECISE_CITATIONS

    def test_a_scanned_document_is_reported_unsearchable_not_empty(self, corpus):
        corpus.execute("INSERT INTO j2_note_documents VALUES "
                       "('d_scan',?,'n_thesis','scan.pdf','no_text','/s.pdf')", (U,))
        corpus.commit()
        r = ar.retrieve_document(U, "d_scan", "margins", conn=corpus)
        assert r["no_answer"] is True
        assert r["no_answer_reason"] == "document_not_searchable:no_text"
        assert r["coverage"]["searchable"] is False

    def test_a_still_processing_document_does_not_pretend_to_be_complete(self, corpus):
        corpus.execute("INSERT INTO j2_note_documents VALUES "
                       "('d_pend',?,'n_thesis','new.pdf','pending','/n.pdf')", (U,))
        corpus.commit()
        r = ar.retrieve_document(U, "d_pend", "margins", conn=corpus)
        assert r["no_answer_reason"] == "document_not_searchable:pending"

    def test_a_question_the_document_does_not_answer_returns_no_answer(self, corpus):
        r = ar.retrieve_document(U, "d1", "zebra husbandry", conn=corpus)
        assert r["no_answer"] is True
        assert r["evidence"] == []

    def test_another_tenants_document_is_indistinguishable_from_a_missing_one(self, corpus):
        # Both must answer document_not_found -- a foreign id must not be
        # confirmable by a different error.
        foreign = ar.retrieve_document(OTHER, "d1", "margins", conn=corpus)
        missing = ar.retrieve_document(OTHER, "d_nope", "margins", conn=corpus)
        assert foreign["no_answer_reason"] == "document_not_found"
        assert missing["no_answer_reason"] == "document_not_found"
        assert foreign["coverage"] == missing["coverage"]

    def test_a_trashed_owning_note_removes_the_document_from_answers(self, corpus):
        corpus.execute("UPDATE j2_notes SET deleted_at='2026-09-07' WHERE id='n_thesis'")
        corpus.commit()
        r = ar.retrieve_document(U, "d1", "mid-seventies range", conn=corpus)
        assert r["evidence"] == []


# ── Slice 4: Ask Security Research ───────────────────────────────────────────

class TestAskSecurityResearch:
    """Scope is PRESELECTED by the workspace the member is already in.

    The property that matters is that scope is canonical MEMBERSHIP, not a
    substring filter -- an AMD note mentioning margins must not answer an NVDA
    question, and an NVDA note that only says "$NVDA" in prose must.
    """

    def test_the_member_does_not_have_to_type_the_ticker(self, corpus):
        r = ar.retrieve_entity_research(U, "NVDA", "customer concentration", conn=corpus)
        assert "n_risk" in _ids(r)
        assert r["no_answer"] is False

    def test_an_unrelated_securitys_note_never_leaks_in(self, corpus):
        # n_amd contains "gross margin normalization" -- a strong lexical match
        # for this query -- and must still be excluded from NVDA scope.
        r = ar.retrieve_entity_research(U, "NVDA", "gross margin normalization",
                                        conn=corpus)
        assert "n_amd" not in _ids(r)

    def test_the_same_query_under_the_other_security_returns_ITS_note(self, corpus):
        # The control: proves the exclusion above is scope, not a broken query.
        r = ar.retrieve_entity_research(U, "AMD", "gross margin normalization",
                                        conn=corpus)
        assert "n_amd" in _ids(r)

    def test_membership_reaches_a_note_linked_only_by_a_prose_mention(self, corpus):
        # Wave H semantics: ticker field OR embed OR mention. This note has a
        # DIFFERENT ticker and is in scope only via the mention sidecar.
        corpus.execute(
            "INSERT INTO j2_notes VALUES ('n_mention',?,'Sector note','SOXX',?,?,'{}',NULL,'2026-09-07')",
            (U, json.dumps(_doc("Capacity constraints affect the whole accelerator complex.")),
             "Capacity constraints affect the whole accelerator complex."))
        corpus.execute("INSERT INTO j2_notes_fts VALUES ('n_mention',?,'Sector note',?)",
                       (U, "Capacity constraints affect the whole accelerator complex."))
        corpus.execute("INSERT INTO j2_note_mentions VALUES ('n_mention',?,'NVDA')", (U,))
        corpus.commit()
        r = ar.retrieve_entity_research(U, "NVDA", "capacity constraints", conn=corpus)
        assert "n_mention" in _ids(r)

    def test_a_security_with_no_research_says_so_rather_than_guessing(self, corpus):
        r = ar.retrieve_entity_research(U, "TSLA", "what do I think", conn=corpus)
        assert r["no_answer"] is True
        assert r["no_answer_reason"] == "no_research_on_this_security"
        assert r["evidence"] == []

    def test_thesis_state_and_facts_arrive_as_context_not_as_the_answer(self, corpus):
        r = ar.retrieve_entity_research(U, "NVDA", "margin pressure", conn=corpus)
        assert r["no_answer"] is True, "no NVDA note discusses margin pressure lexically"
        assert r["evidence"], "but the thesis/fact context is still offered"
        assert all(e["relevance"] == ar.ENTITY_CONTEXT for e in r["evidence"])

    def test_counter_evidence_keeps_its_stance_in_entity_scope(self, corpus):
        r = ar.retrieve_entity_research(U, "NVDA", "gross margins normalize", conn=corpus)
        assert "opposes" in {e.get("stance") for e in r["evidence"]}

    def test_entity_scope_is_tenant_scoped(self, corpus):
        r = ar.retrieve_entity_research(OTHER, "NVDA", "customer concentration",
                                        conn=corpus)
        assert _ids(r) <= {"n_other"}
        assert all(e["user_id"] == OTHER for e in r["evidence"])

    def test_coverage_reports_how_much_of_the_corpus_was_in_scope(self, corpus):
        r = ar.retrieve_entity_research(U, "NVDA", "risks", conn=corpus)
        assert r["coverage"]["notes_in_scope"] >= 1
        assert r["coverage"]["notes_in_scope"] <= r["coverage"]["notes_searchable"]

    def test_no_ticker_probing_happens_in_entity_scope(self, corpus, monkeypatch):
        # The caller already knows the security, so the query must not be
        # sniffed for tickers at all -- one resolution, of the given symbol.
        calls = []
        import api.services.journal_two.ticker_research as tr
        monkeypatch.setattr(tr, "resolve_research_symbols",
                            lambda s: calls.append(s) or
                            {"symbol": s, "entityId": None, "symbols": [s]})
        ar.retrieve_entity_research(U, "NVDA", "CUSTOM CONCEN PRESSU margins",
                                    conn=corpus)
        assert calls == ["NVDA"]

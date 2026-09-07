"""Wave K Slice 1 — deterministic private-corpus retrieval.

NO LLM. NO EMBEDDINGS. This is the baseline the semantic decision must be
measured against (§14/§31): "what does deterministic retrieval actually miss?"
cannot be answered by a system that quietly leans on a model to paper over
weak recall.

Everything here composes primitives that already shipped and are already
tenant-scoped and trash-excluding:

    j2_notes_fts                 note title/body            (Wave A)
    j2_note_document_pages_fts   document page text         (Wave I)
    j2_note_excerpts_fts         saved excerpts + annotation(Wave J)
    entity_master + Wave H       canonical ticker membership(Wave H)
    j2_note_properties           structured thesis state    (Wave E)
    j2_thesis_evidence           supports/opposes edges     (Wave G)
    j2_fact_observations         captured financial facts   (Wave F)

⛔ TENANT SCOPING IS INSIDE EVERY QUERY (§26). Nothing here retrieves broadly
and filters afterwards -- every SQL statement carries `user_id = ?`, so a
cross-tenant row is never a candidate, never ranked, and never reaches
synthesis. The rails assert this per source type.

PRODUCTION SHAPE DRIVES PRIORITY (§24). Measured 2026-09-07: 751 live notes,
0 document pages, 0 excerpts. Notes are the day-one surface. Document and
excerpt retrieval are additive and must not slow the note path -- each source
is queried independently and only when its scope asks for it, so an empty
document corpus costs nothing.
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import ask_evidence as ev
from api.services.journal_two import note_citation_text as nct
from api.services.journal_two.notes_search import fts_match_expr

# ── Query intents (§19). Small and inspectable; NOT an agent planner. ────────
INTENT_STRUCTURED = "structured_research_query"
INTENT_ENTITY = "security_research"
INTENT_GENERAL = "general_notebook"
INTENT_HISTORICAL = "historical_intent_unsupported"

# Whether an evidence object ANSWERS the question or merely surrounds it.
QUERY_MATCH = "query_match"
ENTITY_CONTEXT = "entity_context"

# Relevance floor. bm25() in SQLite returns NEGATIVE numbers where more
# negative is a better match, so a candidate is kept when its score is below
# this. A weak lexical brush must not become "evidence" (§20).
BM25_FLOOR = -0.15

_HISTORICAL_MARKERS = (
    "before earnings", "back then", "at the time", "used to think",
    "did i believe", "did i think", "previously believed", "last quarter i",
    "what did i believe", "originally",
)
_STRUCTURED_MARKERS = (
    "need review", "needs review", "due for review", "which theses",
    "how many theses", "active theses", "list my theses",
)


def classify_intent(query: str) -> str:
    """Route deterministically. Historical intent is DETECTED, not served --
    the point is to stop current-state evidence being narrated as historical
    truth (§19). Wave K does not answer historical-state questions."""
    q = (query or "").lower()
    if any(m in q for m in _HISTORICAL_MARKERS):
        return INTENT_HISTORICAL
    if any(m in q for m in _STRUCTURED_MARKERS):
        return INTENT_STRUCTURED
    return INTENT_GENERAL


# Conservative ticker shapes: an explicit $CASHTAG, or an UPPERCASE token.
# Lowercase prose is never a ticker candidate -- MY, THE, FOR, ON, IT and
# RISK are all real listed symbols, and this repo already carries the
# lesson that a symbol universe does not settle a ticker match.
_SYMBOL_RE = re.compile(r"\$[A-Za-z][A-Za-z.\-]{0,5}|\b[A-Z][A-Z.\-]{1,5}\b")

_STOPWORD_TICKERS = frozenset({
    "WHAT", "MY", "THE", "IS", "ARE", "DO", "I", "HAVE", "ABOUT", "FOR",
    "AND", "OR", "NOT", "WHY", "HOW", "WHICH", "THAT", "THIS", "IT", "ON",
    "IN", "OF", "TO", "A", "AN", "ME", "SAY", "SAID", "RISK", "RISKS",
    "NOTE", "NOTES", "PDF", "AI", "US", "CEO", "CFO", "Q1", "Q2", "Q3", "Q4",
})


def candidate_symbols(query: str) -> list[str]:
    """Symbols a member could plausibly have MEANT, from the query text alone.

    Deliberately conservative: an explicit `$CASHTAG`, or a token the member
    typed in UPPERCASE. Lowercase prose words are never treated as tickers --
    "my", "the", "risk" and "for" are all real listed symbols, and the repo has
    a standing lesson that a symbol universe does not settle a ticker match.
    """
    out, seen = [], set()
    for raw in _SYMBOL_RE.findall(query or ""):
        sym = raw.lstrip("$").upper()
        if sym in _STOPWORD_TICKERS or sym in seen:
            continue
        seen.add(sym)
        out.append(sym)
    return out


def resolve_entity(conn, user_id: str, query: str) -> dict[str, Any] | None:
    """Canonical entity for an entity-scoped question.

    ⛔ THE MEMBER'S OWN CORPUS IS THE CANDIDATE SET, and that ordering is the
    whole point. My first version called `entity_master.resolve()` on every
    word-like token in the query, which reaches yfinance OVER THE NETWORK per
    token -- the evaluation run fired ~40 live 404s for words like CUSTOM,
    CONCEN, TRATIO and PRESSU. That is a latency disaster on the request path
    and it sends fragments of a member's private question to an external
    quote provider for no retrieval benefit whatsoever.

    Now: extract conservative candidates, intersect with the tickers that
    actually appear in THIS member's notes (one cheap local query), and only
    then ask entity_master to expand aliases. A symbol the member has never
    written about cannot help retrieve their research, so there is nothing to
    resolve.
    """
    cands = candidate_symbols(query)
    if not cands:
        return None
    ph = ",".join("?" * len(cands))
    rows = conn.execute(
        f"SELECT DISTINCT ticker FROM j2_notes WHERE user_id = ?"
        f" AND deleted_at IS NULL AND ticker IN ({ph})",
        (user_id, *cands),
    ).fetchall()
    owned = [r[0] for r in rows if r[0]]
    if not owned:
        return None
    symbol = next((c for c in cands if c in owned), owned[0])
    try:
        from api.services.journal_two.ticker_research import resolve_research_symbols
        return resolve_research_symbols(symbol)
    except Exception:  # noqa: BLE001 -- entity_master hiccup must never block
        return {"symbol": symbol, "entityId": None, "displayName": None,
                "symbols": [symbol]}


# ── Per-source retrieval ─────────────────────────────────────────────────────

def _notes(conn, user_id: str, expr: str, limit: int,
           note_ids: list[str] | None = None) -> list[dict[str, Any]]:
    """Candidate notes via FTS, then the passage LOCATED inside each.

    Two representations, each doing its own job (Slice 1 finding): FTS over
    `body_plain` finds the note; `note_citation_text` locates the passage in
    the member-visible canonical text and yields ProseMirror positions.
    """
    sql = (
        "SELECT f.note_id AS id, n.user_id, n.title, n.ticker, n.body_json,"
        " bm25(j2_notes_fts) AS score"
        " FROM j2_notes_fts f JOIN j2_notes n ON n.id = f.note_id"
        " WHERE j2_notes_fts MATCH ? AND f.user_id = ? AND n.deleted_at IS NULL"
    )
    params: list[Any] = [expr, user_id]
    if note_ids is not None:
        if not note_ids:
            return []
        sql += f" AND n.id IN ({','.join('?' * len(note_ids))})"
        params.extend(note_ids)
    sql += " ORDER BY score LIMIT ?"
    params.append(limit)

    out: list[dict[str, Any]] = []
    for r in conn.execute(sql, params).fetchall():
        row = dict(r)
        if row["score"] > BM25_FLOOR:
            continue
        doc = _json(row.get("body_json"))
        snippet, location, validity = _best_note_passage(doc, expr)
        out.append(ev.from_note(row, snippet=snippet, location=location,
                                citation_validity=validity, score=-row["score"]))
    return out


def _best_note_passage(doc, expr: str):
    """Pick a passage to cite and give it a real ProseMirror location.

    Falls back honestly: if no query term can be located in the canonical
    text, the citation opens the note WITHOUT claiming a passage (§21) rather
    than pointing at a guess.
    """
    flat = nct.flatten(doc)
    text = flat["text"]
    if not text:
        return "", None, ev.CITE_NOTE_ONLY
    terms = [t for t in _terms(expr) if len(t) > 2]
    for term in terms:
        idx = text.lower().find(term.lower())
        if idx < 0:
            continue
        start = max(0, idx - 90)
        end = min(len(text), idx + len(term) + 150)
        snippet = text[start:end].strip()
        rng = nct.pm_range(idx, idx + len(term), flat["spans"])
        if rng:
            return snippet, {**rng, "fingerprint": nct.fingerprint(doc),
                             "snippet_start": idx, "snippet_end": idx + len(term)}, ev.CITE_EXACT
    return text[:200].strip(), None, ev.CITE_NOTE_ONLY


def _terms(expr: str) -> list[str]:
    return [t.strip('"') for t in (expr or "").replace(" OR ", " ").replace(" AND ", " ").split()
            if t.strip('"')]


def _document_pages(conn, user_id: str, q: str, limit: int) -> list[dict[str, Any]]:
    from api.services.journal_two.document_search import search_document_pages
    out = []
    for r in search_document_pages(user_id, q, limit=limit, conn=conn):
        row = dict(r)
        row["user_id"] = user_id
        out.append(ev.from_document_page(row, snippet=row.get("snippet") or "", score=0.5))
    return out


def _excerpts(conn, user_id: str, q: str, limit: int) -> list[dict[str, Any]]:
    """Saved excerpts. NOTE the key mapping: excerpt_search returns
    `excerpt_id`/`document_name` (its own SQL aliases), not `id`/`name` --
    reading them wrong raised KeyError on every document-bearing query."""
    from api.services.journal_two.excerpt_search import search_excerpts
    out = []
    for r in search_excerpts(user_id, q, limit=limit, conn=conn):
        row = dict(r)
        mapped = {
            "id": row.get("excerpt_id"),
            "user_id": user_id,
            "document_id": row.get("document_id"),
            "page_number": row.get("page_number"),
            "document_name": row.get("document_name"),
            "captured_text": row.get("snippet") or "",
            "annotation": row.get("annotation"),
            "quote_prefix": None,
            "quote_suffix": None,
        }
        # anchor_ok=False until the Wave J anchor audit has vouched for it:
        # an unverified anchor must not be presented as precise (§21).
        out.append(ev.from_excerpt(mapped, anchor_ok=False, score=0.7))
    return out


def _facts(conn, user_id: str, entity: dict[str, Any] | None,
           limit: int) -> list[dict[str, Any]]:
    """Facts are retrieved STRUCTURALLY, never by vectorising a number (§43)."""
    if not entity:
        return []
    symbols = entity.get("symbols") or []
    if not symbols:
        return []
    ph = ",".join("?" * len(symbols))
    rows = conn.execute(
        "SELECT * FROM j2_fact_observations"
        " WHERE user_id = ?"
        f" AND (entity_id = ? OR ticker IN ({ph}))"
        " ORDER BY observed_at DESC LIMIT ?",
        (user_id, entity.get("entityId"), *symbols, limit),
    ).fetchall()
    return [ev.from_fact(dict(r), score=0.8) for r in rows]


def _thesis_states(conn, user_id: str, note_ids: list[str] | None,
                   limit: int) -> list[dict[str, Any]]:
    """Authoritative thesis state from Wave E properties + Wave G edges."""
    sql = ("SELECT id, user_id, title, ticker, properties_json FROM j2_notes"
           " WHERE user_id = ? AND deleted_at IS NULL"
           " AND properties_json IS NOT NULL AND properties_json != '{}'")
    params: list[Any] = [user_id]
    if note_ids:
        sql += f" AND id IN ({','.join('?' * len(note_ids))})"
        params.extend(note_ids)
    sql += " ORDER BY updated_at DESC LIMIT ?"
    params.append(limit)

    out = []
    for r in conn.execute(sql, params).fetchall():
        row = dict(r)
        props = _json(row.get("properties_json")) or {}
        if not props.get("builtin:thesis_status"):
            continue
        counts = {"supports": 0, "opposes": 0}
        for e in conn.execute(
            "SELECT stance, COUNT(*) c FROM j2_thesis_evidence"
            " WHERE user_id = ? AND note_id = ? AND removed_at IS NULL GROUP BY stance",
            (user_id, row["id"]),
        ).fetchall():
            counts[e["stance"]] = e["c"]
        out.append(ev.from_thesis_state(row, properties=props,
                                        evidence_counts=counts, score=0.9))
    return out


def _thesis_edge_evidence(conn, user_id: str, thesis_note_ids: list[str],
                          by_source: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Apply supports/opposes stance to evidence already retrieved.

    The stance is a property of the EDGE. This never fabricates a new source:
    it only marks an object we already found, which is what keeps lineage
    honest when the same excerpt is also a page hit.
    """
    if not thesis_note_ids:
        return []
    ph = ",".join("?" * len(thesis_note_ids))
    rows = conn.execute(
        f"SELECT * FROM j2_thesis_evidence WHERE user_id = ? AND note_id IN ({ph})"
        " AND removed_at IS NULL", (user_id, *thesis_note_ids),
    ).fetchall()
    out = []
    for r in rows:
        base = by_source.get(f"{r['target_type']}:{r['target_id']}")
        if base is None:
            continue
        out.append(ev.with_stance(base, r["stance"], r["caption"], r["note_id"]))
    return out


def _json(raw):
    import json
    if isinstance(raw, dict):
        return raw
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        return None


# ── Corpus coverage (§23) ────────────────────────────────────────────────────

def coverage(conn, user_id: str) -> dict[str, Any]:
    """What COULD have been searched. Lets synthesis say when coverage is
    incomplete instead of implying it searched everything (§29/§30)."""
    def one(sql, *p):
        r = conn.execute(sql, p).fetchone()
        return (r[0] if r else 0) or 0
    docs = {}
    for r in conn.execute(
        "SELECT status, COUNT(*) c FROM j2_note_documents WHERE user_id = ? GROUP BY status",
        (user_id,),
    ).fetchall():
        docs[r["status"]] = r["c"]
    return {
        "notes_searchable": one(
            "SELECT COUNT(*) FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL", user_id),
        "document_pages_searchable": one(
            "SELECT COUNT(*) FROM j2_note_document_pages WHERE user_id = ?", user_id),
        "excerpts_searchable": one(
            "SELECT COUNT(*) FROM j2_note_excerpts WHERE user_id = ?", user_id),
        "documents_by_status": docs,
        # The honesty fields: sources that exist but could NOT be searched.
        "documents_not_searchable": (docs.get("no_text", 0)
                                     + docs.get("processing_failed", 0)
                                     + docs.get("pending", 0)),
    }


# ── Entry point ──────────────────────────────────────────────────────────────

def retrieve(user_id: str, query: str, *, limit: int = 8,
             conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Deterministic private-corpus retrieval.

    Returns ``{"intent", "entity", "evidence", "coverage",
    "independent_sources", "no_answer"}``. `no_answer` is a first-class
    RESULT, not an error: forcing top-k for every question is how a system
    starts citing weak brushes as evidence (§20).
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        intent = classify_intent(query)
        entity = resolve_entity(conn, user_id, query)
        cov = coverage(conn, user_id)

        if intent == INTENT_HISTORICAL:
            # Detected and refused, deliberately. Answering from current notes
            # in the past tense is the specific failure §14 forbids.
            return {"intent": intent, "entity": entity, "evidence": [],
                    "coverage": cov, "independent_sources": 0, "no_answer": True,
                    "no_answer_reason": "historical_state_unsupported"}

        member_note_ids = None
        if entity:
            member_note_ids = _entity_note_ids(conn, user_id, entity)

        items: list[dict[str, Any]] = []
        if intent == INTENT_STRUCTURED:
            items += _thesis_states(conn, user_id, member_note_ids, limit)
            for i in items:
                i["relevance"] = QUERY_MATCH
        else:
            expr = fts_match_expr(query)
            if expr:
                items += _notes(conn, user_id, expr, limit, member_note_ids)
                items += _document_pages(conn, user_id, query, limit)
                items += _excerpts(conn, user_id, query, limit)
            # ⛔ Thesis state and facts are CONTEXT, not a floor. Adding them
            # unconditionally made "zebra husbandry techniques" return the
            # member's thesis as evidence -- the exact §20 failure of forcing
            # top-k when the corpus has no answer. They join only when the
            # question actually reached this research: either the text search
            # found something, or a security the member writes about was named.
            for i in items:
                i["relevance"] = QUERY_MATCH
            if items or entity:
                ctx = (_thesis_states(conn, user_id, member_note_ids, 3)
                       + _facts(conn, user_id, entity, 5))
                for i in ctx:
                    i["relevance"] = ENTITY_CONTEXT
                items += ctx

        by_source = {f"{i['source_type']}:{i['source_id']}": i for i in items}
        thesis_ids = [i["source_id"] for i in items if i["source_type"] == ev.THESIS_STATE]
        items += _thesis_edge_evidence(conn, user_id, thesis_ids, by_source)

        merged = ev.dedupe(items)
        merged.sort(key=lambda i: (i.get("curation", 0), i.get("score", 0.0)), reverse=True)
        merged = merged[:limit]
        # ⛔ NO-ANSWER IS DECIDED BY QUERY MATCHES, NOT BY LIST LENGTH.
        # Measured while characterizing the recall gap: "NVDA margin pressure"
        # resolved the entity and returned the member's thesis state and a
        # price fact -- neither of which says anything about margins -- with
        # no_answer=False. Synthesis would have been handed context and told
        # it was an answer. Entity context is still RETURNED (it is genuinely
        # useful: "I couldn't find that; here is your current NVDA thesis")
        # but it cannot satisfy the question on its own.
        matched = [i for i in merged if i.get("relevance") == QUERY_MATCH]
        return {
            "intent": intent, "entity": entity, "evidence": merged, "coverage": cov,
            "independent_sources": ev.independent_source_count(matched),
            "query_matches": len(matched),
            "no_answer": not matched,
            "no_answer_reason": None if matched else "no_supporting_evidence",
        }
    finally:
        if owned:
            conn.close()


def _entity_note_ids(conn, user_id: str, entity: dict[str, Any]) -> list[str]:
    """Wave H membership, reused verbatim: ticker field OR embed OR mention
    over the resolved ALIAS set. Not a substring filter (§11)."""
    symbols = entity.get("symbols") or []
    if not symbols:
        return []
    ph = ",".join("?" * len(symbols))
    rows = conn.execute(
        "SELECT DISTINCT n.id FROM j2_notes n"
        " WHERE n.user_id = ? AND n.deleted_at IS NULL"
        f" AND (n.ticker IN ({ph})"
        f" OR EXISTS (SELECT 1 FROM j2_note_embeds e WHERE e.note_id = n.id"
        f"            AND e.user_id = n.user_id AND e.symbol IN ({ph}))"
        f" OR EXISTS (SELECT 1 FROM j2_note_mentions m WHERE m.note_id = n.id"
        f"            AND m.user_id = n.user_id AND m.symbol IN ({ph})))",
        (user_id, *symbols, *symbols, *symbols),
    ).fetchall()
    return [r["id"] for r in rows]


# ── Slice 2: Ask Document ────────────────────────────────────────────────────

DOC_STATUS_SEARCHABLE = "ready"


def _anchor_ok(conn, user_id: str, excerpt_row: dict) -> bool:
    """Is this excerpt's stored anchor good enough to promise EXACT navigation?

    ⛔ Never manufacture a valid anchor (§8). Slice 0 already wrote the
    classifier that answers this honestly, against the CURRENT extracted page
    text, so this reuses it rather than assuming -- a degraded anchor keeps
    page-level navigation and says so.
    """
    from tools.notebook_excerpt_anchor_audit import NOT_NAVIGABLE, classify
    page = conn.execute(
        "SELECT text FROM j2_note_document_pages"
        " WHERE document_id = ? AND page_number = ? AND user_id = ?",
        (excerpt_row.get("document_id"), excerpt_row.get("page_number"), user_id),
    ).fetchone()
    verdict, _ = classify(excerpt_row, page["text"] if page is not None else None)
    return verdict not in NOT_NAVIGABLE


def _document_pages_scoped(conn, user_id: str, document_id: str, q: str,
                           limit: int) -> list[dict[str, Any]]:
    """Page hits WITHIN one document. Tenant scoping stays inside the query."""
    expr = fts_match_expr(q)
    if expr is None:
        return []
    rows = conn.execute(
        "SELECT p.document_id AS document_id, p.page_number AS page_number,"
        " snippet(j2_note_document_pages_fts, 3, '', '', '...', 18) AS snippet,"
        " d.name AS name, d.note_id AS note_id"
        " FROM j2_note_document_pages_fts p"
        " JOIN j2_note_documents d ON d.id = p.document_id"
        " JOIN j2_notes n ON n.id = d.note_id"
        " WHERE j2_note_document_pages_fts MATCH ? AND p.user_id = ?"
        " AND p.document_id = ? AND n.deleted_at IS NULL"
        " ORDER BY bm25(j2_note_document_pages_fts) LIMIT ?",
        (expr, user_id, document_id, limit),
    ).fetchall()
    out = []
    for r in rows:
        row = dict(r)
        row["user_id"] = user_id
        out.append(ev.from_document_page(row, snippet=row.get("snippet") or "",
                                         score=0.6))
    return out


def _excerpts_scoped(conn, user_id: str, document_id: str, q: str,
                     limit: int) -> list[dict[str, Any]]:
    """Saved excerpts WITHIN one document, each anchor-verified."""
    expr = fts_match_expr(q)
    if expr is None:
        return []
    rows = conn.execute(
        "SELECT e.* , d.name AS document_name"
        " FROM j2_note_excerpts_fts f"
        " JOIN j2_note_excerpts e ON e.id = f.excerpt_id"
        " JOIN j2_note_documents d ON d.id = e.document_id"
        " JOIN j2_notes n ON n.id = e.note_id"
        " WHERE j2_note_excerpts_fts MATCH ? AND f.user_id = ?"
        " AND e.document_id = ? AND n.deleted_at IS NULL"
        " ORDER BY bm25(j2_note_excerpts_fts) LIMIT ?",
        (expr, user_id, document_id, limit),
    ).fetchall()
    out = []
    for r in rows:
        row = dict(r)
        out.append(ev.from_excerpt(row, anchor_ok=_anchor_ok(conn, user_id, row),
                                   score=0.8))
    return out


def document_coverage(conn, user_id: str, document_id: str) -> dict[str, Any]:
    """Can this document be answered from at all? (§29/§30)

    A scanned or still-processing document must never be implied to have been
    searched -- the answer has to be able to say it was not.
    """
    d = conn.execute(
        "SELECT d.id, d.name, d.status FROM j2_note_documents d"
        " WHERE d.id = ? AND d.user_id = ?", (document_id, user_id)).fetchone()
    if d is None:
        return {"exists": False, "searchable": False, "status": None,
                "pages_indexed": 0}
    pages = conn.execute(
        "SELECT COUNT(*) c FROM j2_note_document_pages"
        " WHERE document_id = ? AND user_id = ?", (document_id, user_id)).fetchone()["c"]
    status = d["status"]
    return {"exists": True, "name": d["name"], "status": status,
            "pages_indexed": pages,
            "searchable": status == DOC_STATUS_SEARCHABLE and pages > 0}


def retrieve_document(user_id: str, document_id: str, query: str, *,
                      limit: int = 6,
                      conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Ask THIS document (§10). Scoped to one document, never the corpus.

    Reuses Wave J wholesale: document/page identity, the excerpt anchor, and
    the anchor-integrity classifier. Nothing about citation location is
    redesigned here -- a page citation from Ask Document is the same object the
    Notebook already knows how to open.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        cov = document_coverage(conn, user_id, document_id)
        if not cov["exists"]:
            # Tenant isolation and "no such document" are deliberately the
            # SAME answer: a foreign document id must not be distinguishable
            # from a missing one.
            return {"document": None, "evidence": [], "coverage": cov,
                    "no_answer": True, "no_answer_reason": "document_not_found",
                    "query_matches": 0, "independent_sources": 0}
        if not cov["searchable"]:
            return {"document": document_id, "evidence": [], "coverage": cov,
                    "no_answer": True,
                    "no_answer_reason": f"document_not_searchable:{cov['status']}",
                    "query_matches": 0, "independent_sources": 0}

        items = (_document_pages_scoped(conn, user_id, document_id, query, limit)
                 + _excerpts_scoped(conn, user_id, document_id, query, limit))
        for i in items:
            i["relevance"] = QUERY_MATCH
        merged = ev.dedupe(items)
        merged.sort(key=lambda i: (i.get("curation", 0), i.get("score", 0.0)),
                    reverse=True)
        merged = merged[:limit]
        return {
            "document": document_id, "evidence": merged, "coverage": cov,
            "query_matches": len(merged),
            "independent_sources": ev.independent_source_count(merged),
            "no_answer": not merged,
            "no_answer_reason": None if merged else "no_supporting_evidence",
        }
    finally:
        if owned:
            conn.close()


# ── Slice 4: Ask Security Research ───────────────────────────────────────────

def retrieve_entity_research(user_id: str, symbol: str, query: str, *,
                             limit: int = 8,
                             conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Ask THIS security's research (§11). The scope is PRESELECTED.

    The member is already inside NVDA Research, so they should not have to type
    "NVDA" -- and critically, the scope must not be a substring filter. This
    reuses Wave H's canonical membership verbatim: resolve the symbol through
    entity_master, expand aliases, then match on the note's own ticker OR a
    chart embed OR a prose mention. A note that only ever says "$NVDA" in a
    sentence is in scope; an AMD note that happens to mention margins is not.

    Unlike the corpus-wide entry point this does NOT sniff the query for a
    ticker -- the caller already knows the security, so there is no reason to probe.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        try:
            from api.services.journal_two.ticker_research import resolve_research_symbols
            entity = resolve_research_symbols(symbol)
        except Exception:  # noqa: BLE001
            entity = {"symbol": symbol, "entityId": None, "displayName": None,
                      "symbols": [symbol]}

        note_ids = _entity_note_ids(conn, user_id, entity)
        cov = coverage(conn, user_id)
        cov["notes_in_scope"] = len(note_ids)

        if not note_ids:
            return {"entity": entity, "evidence": [], "coverage": cov,
                    "query_matches": 0, "independent_sources": 0,
                    "no_answer": True, "no_answer_reason": "no_research_on_this_security"}

        items: list[dict[str, Any]] = []
        expr = fts_match_expr(query)
        if expr:
            items += _notes(conn, user_id, expr, limit, note_ids)
            # Documents and excerpts belonging to THIS security's notes only.
            items += _entity_documents(conn, user_id, note_ids, query, limit)
        for i in items:
            i["relevance"] = QUERY_MATCH

        ctx = (_thesis_states(conn, user_id, note_ids, 3)
               + _facts(conn, user_id, entity, 5))
        for i in ctx:
            i["relevance"] = ENTITY_CONTEXT
        items += ctx

        by_source = {f"{i['source_type']}:{i['source_id']}": i for i in items}
        thesis_ids = [i["source_id"] for i in items if i["source_type"] == ev.THESIS_STATE]
        items += _thesis_edge_evidence(conn, user_id, thesis_ids, by_source)

        merged = ev.dedupe(items)
        merged.sort(key=lambda i: (i.get("curation", 0), i.get("score", 0.0)), reverse=True)
        merged = merged[:limit]
        matched = [i for i in merged if i.get("relevance") == QUERY_MATCH]
        return {
            "entity": entity, "evidence": merged, "coverage": cov,
            "query_matches": len(matched),
            "independent_sources": ev.independent_source_count(matched),
            "no_answer": not matched,
            "no_answer_reason": None if matched else "no_supporting_evidence",
        }
    finally:
        if owned:
            conn.close()


def _entity_documents(conn, user_id: str, note_ids: list[str], q: str,
                      limit: int) -> list[dict[str, Any]]:
    """Pages and saved excerpts from documents attached to THIS security's
    notes. Scoped by note membership, so an unrelated security's filing cannot
    leak in on a shared phrase."""
    if not note_ids:
        return []
    expr = fts_match_expr(q)
    if expr is None:
        return []
    ph = ",".join("?" * len(note_ids))
    out: list[dict[str, Any]] = []
    for r in conn.execute(
        "SELECT p.document_id AS document_id, p.page_number AS page_number,"
        " snippet(j2_note_document_pages_fts, 3, '', '', '...', 18) AS snippet,"
        " d.name AS name"
        " FROM j2_note_document_pages_fts p"
        " JOIN j2_note_documents d ON d.id = p.document_id"
        " WHERE j2_note_document_pages_fts MATCH ? AND p.user_id = ?"
        f" AND d.note_id IN ({ph})"
        " ORDER BY bm25(j2_note_document_pages_fts) LIMIT ?",
        (expr, user_id, *note_ids, limit),
    ).fetchall():
        row = dict(r)
        row["user_id"] = user_id
        out.append(ev.from_document_page(row, snippet=row.get("snippet") or "", score=0.6))
    for r in conn.execute(
        "SELECT e.*, d.name AS document_name FROM j2_note_excerpts_fts f"
        " JOIN j2_note_excerpts e ON e.id = f.excerpt_id"
        " JOIN j2_note_documents d ON d.id = e.document_id"
        " WHERE j2_note_excerpts_fts MATCH ? AND f.user_id = ?"
        f" AND e.note_id IN ({ph})"
        " ORDER BY bm25(j2_note_excerpts_fts) LIMIT ?",
        (expr, user_id, *note_ids, limit),
    ).fetchall():
        row = dict(r)
        out.append(ev.from_excerpt(row, anchor_ok=_anchor_ok(conn, user_id, row),
                                   score=0.8))
    return out

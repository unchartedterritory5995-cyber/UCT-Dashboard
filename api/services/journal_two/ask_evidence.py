"""Wave K Slice 1 — the typed private-corpus evidence envelope.

THE SLICE 1 QUESTION THIS ANSWERS
---------------------------------
"What evidence objects would we give the model?" -- asked and answered BEFORE
any prompt, LLM call, embedding, or chat UX exists. Everything downstream
consumes this shape; nothing downstream may invent a source.

An evidence object is CITATION-READY BEFORE THE MODEL SEES IT. By the time
synthesis runs, each object already knows what it is, who owns it, where it
came from, whether its citation can navigate, and what it may not be counted
alongside. The model's only job is to phrase it.

TWO IDEAS DELIBERATELY KEPT APART
---------------------------------
SOURCE IDENTITY  -- what evidence object is this? Survives edits. A note id
                    is still that note after the member rewrites a paragraph.
CITATION LOCATION -- where can the member inspect the supporting passage?
                    For a note this is ProseMirror positions, which do NOT
                    survive edits (see note_citation_text.resolve_note_citation).
Collapsing them is what makes a system confidently navigate to the wrong
passage: identity looks fine, so the location is trusted.

LINEAGE, AND WHY IT IS NOT OPTIONAL
-----------------------------------
The same underlying passage can surface three ways: as DOCUMENT_PAGE text, as
a DOCUMENT_EXCERPT the member saved from that page, and as a THESIS_STATE
evidence edge pointing at that excerpt. Those are ONE source with three
records, not three independent corroborating sources. An answer that says
"three sources support this" when a member saved one quote is lying with
arithmetic. `lineage_key` makes the duplication detectable before ranking;
`dedupe()` collapses it, keeping the most member-curated representative and
recording what it absorbed.

STRUCTURED STAYS STRUCTURED
---------------------------
A financial fact is not prose. Flattening "$142.83 captured 2026-09-04,
temporal_mode=snapshot" into a sentence at retrieval time destroys exactly the
semantics Wave F built and makes THEN/NOW confusion unavoidable. Facts and
thesis state carry typed payloads; the synthesizer phrases them later.
"""
from __future__ import annotations

from typing import Any

# ── Source types ─────────────────────────────────────────────────────────────
NOTE = "note"
DOCUMENT_PAGE = "document_page"
DOCUMENT_EXCERPT = "document_excerpt"
FINANCIAL_FACT = "financial_fact"
THESIS_STATE = "thesis_state"

SOURCE_TYPES = frozenset({NOTE, DOCUMENT_PAGE, DOCUMENT_EXCERPT,
                          FINANCIAL_FACT, THESIS_STATE})

# ── Citation validity ────────────────────────────────────────────────────────
# What a citation may CLAIM. Distinct from "is this evidence any good" --
# a degraded citation can still be true evidence, it just cannot promise to
# take the member to the exact passage.
CITE_EXACT = "exact"            # can open the precise passage
CITE_PAGE_ONLY = "page_only"    # right document + page, not the passage
CITE_NOTE_ONLY = "note_only"    # right note, not the passage
CITE_RECORD_ONLY = "record_only"  # a structured record (fact/thesis), no passage
CITE_UNAVAILABLE = "unavailable"  # cannot navigate at all

PRECISE_CITATIONS = frozenset({CITE_EXACT})

# ── Relevance ────────────────────────────────────────────────────────────────
# Does this evidence ANSWER the question, or merely surround it? Kept HERE,
# beside the envelope it annotates, so retrieval and ranking cannot drift into
# two spellings of one idea.
QUERY_MATCH = "query_match"
ENTITY_CONTEXT = "entity_context"

# ⛔ AN ALLOWLIST, NOT A DENYLIST. Only a positive query match may back a
# claim. An item whose relevance was never set is therefore NOT answer
# evidence -- a new caller that forgets to label its results makes the system
# say "I could not find that", never invent a confident answer from context.
ANSWER_RELEVANCE = frozenset({QUERY_MATCH})


def make_evidence(
    *,
    source_type: str,
    source_id: str,
    user_id: str,
    label: str,
    text: str = "",
    payload: dict[str, Any] | None = None,
    location: dict[str, Any] | None = None,
    navigation: dict[str, Any] | None = None,
    citation_validity: str = CITE_UNAVAILABLE,
    lineage_key: str | None = None,
    entity: dict[str, Any] | None = None,
    temporal: dict[str, Any] | None = None,
    rights: dict[str, Any] | None = None,
    stance: str | None = None,
    curation: int = 0,
    score: float = 0.0,
) -> dict[str, Any]:
    """One retrieval result, in the single shape every source type produces.

    `text` is QUOTED EVIDENCE, never instruction -- prompt construction will
    serialize it under an untrusted boundary (§22). `payload` carries typed
    structure that must not be flattened into prose. `curation` records how
    deliberately the member kept this (0 = incidental text, 1 = saved excerpt,
    2 = attached to a thesis as evidence) and is what dedupe keeps.
    """
    if source_type not in SOURCE_TYPES:
        raise ValueError(f"unknown source_type {source_type!r}")
    return {
        # identity -- survives edits
        "source_type": source_type,
        "source_id": source_id,
        "user_id": user_id,
        "label": label,
        # content
        "text": text,
        "payload": payload or {},
        # citation -- may NOT survive edits; see note_citation_text
        "location": location or {},
        "navigation": navigation or {},
        "citation_validity": citation_validity,
        # relationships
        "lineage_key": lineage_key or f"{source_type}:{source_id}",
        "entity": entity or {},
        "temporal": temporal or {},
        "rights": rights or {},
        "stance": stance,
        "curation": curation,
        "score": score,
    }


# ── Per-source constructors ──────────────────────────────────────────────────

def from_note(row, *, snippet: str, location: dict[str, Any] | None,
              citation_validity: str, score: float = 0.0) -> dict[str, Any]:
    """A passage inside a note the member wrote.

    `location` carries ProseMirror {from,to} plus the fingerprint the click
    path needs to detect drift -- identity (note_id) and location are separate
    fields precisely because the first survives an edit and the second may not.
    """
    return make_evidence(
        source_type=NOTE, source_id=row["id"], user_id=row["user_id"],
        label=(row.get("title") or "Untitled note"),
        text=snippet, location=location, citation_validity=citation_validity,
        navigation={"kind": "note", "note_id": row["id"]},
        entity={"ticker": row.get("ticker")} if row.get("ticker") else {},
        curation=0, score=score,
    )


def from_document_page(row, *, snippet: str, score: float = 0.0) -> dict[str, Any]:
    """Raw extracted text from one page of an attached document.

    Lineage is the PAGE, not this row -- an excerpt saved from the same page
    must collide with it.
    """
    return make_evidence(
        source_type=DOCUMENT_PAGE,
        source_id=f"{row['document_id']}#p{row['page_number']}",
        user_id=row["user_id"],
        label=f"{row.get('name') or 'Document'} · p.{row['page_number']}",
        text=snippet,
        location={"document_id": row["document_id"], "page_number": row["page_number"]},
        navigation={"kind": "document", "document_id": row["document_id"],
                    "page_number": row["page_number"]},
        citation_validity=CITE_PAGE_ONLY,
        lineage_key=f"page:{row['document_id']}#{row['page_number']}",
        curation=0, score=score,
    )


def from_excerpt(row, *, anchor_ok: bool, score: float = 0.0) -> dict[str, Any]:
    """A passage the member DELIBERATELY saved from a document page.

    Shares the page's lineage_key on purpose: this is the same underlying
    passage, and Wave J's own anchor-integrity verdict decides whether the
    citation may promise exact navigation.
    """
    return make_evidence(
        source_type=DOCUMENT_EXCERPT, source_id=row["id"], user_id=row["user_id"],
        label=f"{row.get('document_name') or 'Document'} · p.{row['page_number']}",
        text=row.get("captured_text") or "",
        payload={"annotation": row.get("annotation")} if row.get("annotation") else {},
        location={"document_id": row["document_id"], "page_number": row["page_number"],
                  "quote_prefix": row.get("quote_prefix"),
                  "quote_suffix": row.get("quote_suffix")},
        navigation={"kind": "excerpt", "excerpt_id": row["id"],
                    "document_id": row["document_id"],
                    "page_number": row["page_number"]},
        citation_validity=CITE_EXACT if anchor_ok else CITE_PAGE_ONLY,
        lineage_key=f"page:{row['document_id']}#{row['page_number']}",
        curation=1, score=score,
    )


def from_fact(row, *, score: float = 0.0) -> dict[str, Any]:
    """A captured financial fact. STRUCTURED -- never pre-flattened to prose.

    Wave F's temporal_mode and rights_class travel with it so the synthesizer
    can never present a snapshot as a current value (§15), and so a
    rights-restricted fact is identifiable downstream.
    """
    return make_evidence(
        source_type=FINANCIAL_FACT, source_id=row["id"], user_id=row["user_id"],
        label=f"{row.get('fact_type')} · {row.get('ticker')}",
        text="",  # deliberately empty: this evidence is its payload
        payload={
            "fact_type": row.get("fact_type"), "ticker": row.get("ticker"),
            "value_number": row.get("value_number"), "value_text": row.get("value_text"),
            "unit": row.get("unit"), "currency": row.get("currency"),
            "period": row.get("period"), "caption": row.get("caption"),
        },
        navigation={"kind": "fact", "fact_id": row["id"], "note_id": row.get("note_id")},
        citation_validity=CITE_RECORD_ONLY,
        entity={"entity_id": row.get("entity_id"), "ticker": row.get("ticker")},
        temporal={"temporal_mode": row.get("temporal_mode"),
                  "observed_at": row.get("observed_at"),
                  "source_as_of": row.get("source_as_of")},
        rights={"rights_class": row.get("rights_class"), "source": row.get("source")},
        curation=1, score=score,
    )


def from_thesis_state(note_row, *, properties: dict[str, Any],
                      evidence_counts: dict[str, int],
                      score: float = 0.0) -> dict[str, Any]:
    """The AUTHORITATIVE current state of a thesis.

    "What is my current thesis?" must not depend on BM25 finding prose. This
    reads Wave E properties and Wave G evidence counts directly -- a second
    thesis representation is exactly what §12 forbids.
    """
    return make_evidence(
        source_type=THESIS_STATE, source_id=note_row["id"], user_id=note_row["user_id"],
        label=(note_row.get("title") or "Untitled thesis"),
        text="",
        payload={
            "status": properties.get("builtin:thesis_status"),
            "confidence": properties.get("builtin:confidence"),
            "research_type": properties.get("builtin:research_type"),
            "review_date": properties.get("builtin:review_date"),
            "supports_count": evidence_counts.get("supports", 0),
            "opposes_count": evidence_counts.get("opposes", 0),
        },
        navigation={"kind": "note", "note_id": note_row["id"]},
        citation_validity=CITE_NOTE_ONLY,
        entity={"ticker": note_row.get("ticker")} if note_row.get("ticker") else {},
        curation=2, score=score,
    )


def with_stance(evidence: dict[str, Any], stance: str, caption: str | None,
                thesis_note_id: str) -> dict[str, Any]:
    """Mark an evidence object as attached to a thesis as supporting/opposing.

    ⛔ The stance lives on the EDGE, never on the passage (Wave G/J decision).
    The same excerpt can support one thesis and oppose another, so this
    RETURNS A COPY rather than mutating the shared object -- and it does NOT
    change lineage_key, because attaching a quote to a thesis does not make it
    a second independent source.
    """
    out = dict(evidence)
    out["stance"] = stance
    out["curation"] = max(out.get("curation", 0), 2)
    out["payload"] = {**out.get("payload", {}),
                      "evidence_caption": caption,
                      "thesis_note_id": thesis_note_id}
    return out


# ── Lineage deduplication ────────────────────────────────────────────────────

def dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse records that describe ONE underlying source passage.

    Keeps the most member-curated representative (a saved excerpt beats the
    raw page it came from; a thesis-attached excerpt beats a loose one), takes
    the best score seen, and records what was absorbed so a caller can say
    "your saved excerpt, which also appears on page 2" rather than counting it
    twice.

    ⛔ This is the guard against lying with arithmetic. Without it an answer
    can report three corroborating sources for what is one quote the member
    saved once.
    """
    best: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for it in items:
        key = it["lineage_key"]
        if key not in best:
            best[key] = dict(it)
            best[key]["absorbed"] = []
            order.append(key)
            continue
        cur = best[key]
        winner, loser = ((it, cur) if (it.get("curation", 0), it.get("score", 0.0))
                         > (cur.get("curation", 0), cur.get("score", 0.0)) else (cur, it))
        merged = dict(winner)
        merged["score"] = max(it.get("score", 0.0), cur.get("score", 0.0))
        merged["absorbed"] = (cur.get("absorbed") or []) + [
            {"source_type": loser["source_type"], "source_id": loser["source_id"]}
        ]
        # ⛔ COLLAPSE THE SOURCE COUNT, NOT THE TEXT. Measured by the Slice 8
        # real-model E2E: a member saves "down 240 basis points sequentially"
        # from a page that reads "Gross margin was 73.5% in the quarter, down
        # 240 basis points...". Dedupe correctly keeps ONE source -- the saved
        # excerpt, which is the more curated record -- but keeping only its
        # text discarded the sentence containing the actual figure, so the
        # answer could no longer state it. Curating a quote must not make the
        # rest of its page invisible.
        #
        # The citation still points at the saved excerpt (its precision is why
        # it won); the wider text rides along as context the synthesizer may
        # read and quote.
        win_text = winner.get("text") or ""
        lose_text = loser.get("text") or ""
        if len(lose_text) > len(win_text):
            merged["payload"] = {**merged.get("payload", {}),
                                 "source_context": lose_text}
        # A stance discovered on either record is a real fact about the edge.
        merged["stance"] = winner.get("stance") or loser.get("stance")
        best[key] = merged
    return [best[k] for k in order]


def independent_source_count(items: list[dict[str, Any]]) -> int:
    """How many genuinely independent sources back a claim. Distinct lineage
    keys, NOT len(items) -- the number an answer is allowed to imply."""
    return len({it["lineage_key"] for it in items})

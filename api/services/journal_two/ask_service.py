"""Wave K Slice 6 — one research assistant, four scopes.

Ask Current Note, Ask Document, Ask Security Research and Ask Notebook were
four separate ideas about how to answer a question. This module makes them one
pipeline with a scope parameter:

    retrieve (per scope) -> rank + budget -> fenced prompt -> stream -> resolve

Everything scope-specific lives in `_SCOPES`. Everything else -- the evidence
envelope, ranking, the prompt boundary, citation resolution, the rate limit,
the refusal -- is shared, so a fix to any of them reaches all four.

TWO DECISIONS THAT ARE STRUCTURAL, NOT PROMPTED
-----------------------------------------------
1. NO ANSWER MEANS NO MODEL CALL. When retrieval finds nothing that answers
   the question, this returns a deterministic refusal and never contacts the
   provider. Asking a model to say "I could not find that" is asking the one
   component capable of inventing an answer to decline to -- and paying it to.
   The refusal is free, instant, and cannot be talked out of. Entity context is
   still returned beside it, because "here is your current NVDA thesis" is
   useful; it is just not the answer.

2. A FOLLOW-UP RE-RETRIEVES, AND ONLY FROM THE MEMBER'S OWN WORDS. "What about
   the risks?" is retrieved with the member's previous QUESTION prepended --
   never the assistant's previous answer. Model output is not evidence and must
   not be able to steer what gets retrieved next; that is how a single
   hallucinated noun quietly becomes the corpus query for the rest of a thread.

⛔ NOTHING HERE LOGS QUESTION OR ANSWER TEXT. The Wave 2 route it replaces logs
`query={query!r}`; that is a defect, not a precedent (see Slice 7).
"""
from __future__ import annotations

import time
from typing import Any, Iterable

from api.services.journal_two import ask_evidence as ev
from api.services.journal_two import ask_prompt as ap
from api.services.journal_two import ask_retrieval as ar

# ── Scopes ───────────────────────────────────────────────────────────────────
NOTE = "note"
DOCUMENT = "document"
SECURITY = "security"
NOTEBOOK = "notebook"
SCOPES = (NOTE, DOCUMENT, SECURITY, NOTEBOOK)

# The member always knows what was searched (§9). The label travels WITH the
# answer rather than being assembled in the UI, so a scope shown on screen and
# a scope actually searched cannot drift apart.
_SCOPES: dict[str, dict[str, Any]] = {
    NOTE: {
        "needs_target": True,
        "label": lambda t, r: "This note",
        "refusal": lambda t, r: "I couldn't find that in this note.",
    },
    DOCUMENT: {
        "needs_target": True,
        "label": lambda t, r: f"This document{_named(r)}",
        "refusal": lambda t, r: "I couldn't find that in this document.",
    },
    SECURITY: {
        "needs_target": True,
        "label": lambda t, r: f"{str(t).upper()} research",
        "refusal": lambda t, r: (
            f"I couldn't find research specifically about that in your "
            f"{str(t).upper()} notes."),
    },
    NOTEBOOK: {
        "needs_target": False,
        "label": lambda t, r: "My Notebook",
        "refusal": lambda t, r: "I couldn't find that in your Notebook.",
    },
}


def _named(result: dict[str, Any]) -> str:
    name = (result.get("coverage") or {}).get("name")
    return f" ({name})" if name else ""


# ⛔ WHAT THE CLIENT MAY SEE. An allowlist, because the failure direction of a
# denylist is leaking the next field somebody adds. Ranking internals are
# deliberately absent (§18): tier, tier_name, norm_score, score, lineage_key
# and absorbed are how the answer was assembled, not evidence the member
# asked for, and `user_id` has no business crossing the wire at all.
#
# ⚰️ AND IT USED TO NAME FIELDS THIS FUNCTION DOES NOT EMIT. The tuple listed
# `text` while the projection sends `snippet`, and omitted `n`, `type` and
# `location`, which it does send — an allowlist that enforced nothing, beside a
# comment claiming it was the safety mechanism. It is now the projection's
# OUTPUT keys, and a rail compares the two, so it can never drift again.
_PUBLIC_FIELDS = ("n", "type", "label", "citation", "snippet", "navigation",
                  "location", "stance", "payload", "textOrigin", "truncated")
_SNIPPET_CAP = 400


def public_source(n: int, item: dict[str, Any]) -> dict[str, Any]:
    """One source, projected for the browser. Index-addressed, so a citation
    handle means the same thing to the model, the server and the client."""
    return {
        "n": n,
        "type": item.get("source_type"),
        "label": item.get("label") or "",
        "citation": item.get("citation_validity"),
        "snippet": (item.get("text") or "")[:_SNIPPET_CAP],
        "navigation": item.get("navigation") or {},
        "location": item.get("location") or {},
        "stance": item.get("stance"),
        "payload": item.get("payload") or {},
        # ⛔⛔ WAVE P3 §34 — THE FIELD THAT DIES HERE IF NOBODY LOOKS. The
        # retriever can carry provenance perfectly and the member still never
        # sees it, because this projection is the last place it can be dropped
        # and dropping it looks like nothing at all. It is metadata, never a
        # source, a score or a ranking input.
        "textOrigin": item.get("text_origin"),
        "truncated": bool(item.get("truncated")),
    }


def _retrieval_query(query: str, history: list[dict[str, Any]] | None) -> str:
    """What gets retrieved for a follow-up.

    ⛔ THE MEMBER'S PRIOR QUESTION, NEVER THE ASSISTANT'S PRIOR ANSWER.
    "What about the risks?" needs context to retrieve anything at all, and the
    only safe place to get it is the member's own previous words.
    """
    prior = [str(h.get("q") or "") for h in (history or [])[-2:]
             if isinstance(h, dict) and h.get("q")]
    return " ".join([*prior, query]).strip()[:600]


def retrieve(user_id: str, scope: str, target: str | None, query: str,
             *, history: list[dict[str, Any]] | None = None,
             conn=None) -> dict[str, Any]:
    """Run the scope's retrieval. Every branch returns the same shape."""
    if scope not in _SCOPES:
        raise ValueError(f"unknown scope {scope!r}")
    if _SCOPES[scope]["needs_target"] and not target:
        raise ValueError(f"scope {scope!r} requires a target")
    q = _retrieval_query(query, history)
    if scope == NOTE:
        return ar.retrieve_note(user_id, target, q, conn=conn)
    if scope == DOCUMENT:
        return ar.retrieve_document(user_id, target, q, conn=conn)
    if scope == SECURITY:
        return ar.retrieve_entity_research(user_id, target, q, conn=conn)
    return ar.retrieve(user_id, q, conn=conn)


def coverage_notice(scope: str, result: dict[str, Any]) -> str | None:
    """A trust-affecting limitation, or nothing (§11).

    Only surfaces when the system KNOWS it did not search everything. A banner
    on every answer is noise that trains members to ignore the one that
    matters.
    """
    cov = result.get("coverage") or {}
    missing = int(cov.get("documents_not_searchable", 0) or 0)
    if missing:
        return (f"{missing} attached document"
                f"{'s' if missing != 1 else ''} couldn't be searched yet "
                "(no readable text, or still processing).")
    status = cov.get("status")
    if scope == DOCUMENT and status in ("pending", "no_text", "processing_failed"):
        return {
            "pending": "This document is still being processed.",
            "no_text": "No readable text could be extracted from this document.",
            "processing_failed": "This document couldn't be processed.",
        }[status]
    if scope == NOTE and cov.get("exists") and not cov.get("has_text"):
        return "This note doesn't have any text yet."
    return None


def prepare(user_id: str, scope: str, target: str | None, query: str,
            *, history: list[dict[str, Any]] | None = None,
            conn=None) -> dict[str, Any]:
    """Everything decided before a single token is generated.

    Returned whole so the caller can emit it as the FIRST stream event: the
    member sees the scope that was searched and the sources that were found
    before any prose arrives, and the client can validate a citation handle
    the moment it appears rather than after the fact.
    """
    result = retrieve(user_id, scope, target, query, history=history, conn=conn)
    items = result.get("evidence") or []
    spec = _SCOPES[scope]
    answerable = [i for i in items if i.get("relevance") in ev.ANSWER_RELEVANCE]
    return {
        "scope": scope,
        "scope_label": spec["label"](target, result),
        "sources": [public_source(n, it) for n, it in enumerate(items, 1)],
        "items": items,
        "answerable": len(answerable),
        "independent_sources": result.get("independent_sources", 0),
        "no_answer": bool(result.get("no_answer")),
        "refusal": spec["refusal"](target, result),
        "coverage_notice": coverage_notice(scope, result),
        "coverage": result.get("coverage") or {},
    }


def request(prepared: dict[str, Any], query: str, *, model: str,
            max_tokens: int,
            history: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The provider call, built through the Slice 5 boundary and nowhere else."""
    return ap.request_kwargs(query, prepared["items"], model=model,
                             max_tokens=max_tokens,
                             coverage=prepared.get("coverage"),
                             history=history)


def resolve_answer(answer: str, prepared: dict[str, Any]) -> dict[str, Any]:
    """Map the model's [n] handles back onto the packet that was sent.

    An index the packet does not contain resolves to nothing -- it is reported
    so it can be counted, and never rendered as though a source stood behind
    it (§23).
    """
    parsed = ap.parse_citations(answer, prepared["items"])
    return {
        "cited": [c["index"] for c in parsed["citations"]],
        "invalid": parsed["invalid_indices"],
        "hallucinated_citation": parsed["hallucinated_citation"],
    }


# ── Telemetry ────────────────────────────────────────────────────────────────

def telemetry(scope: str, prepared: dict[str, Any], *, started: float,
              settled: bool, answered: bool,
              resolved: dict[str, Any] | None = None) -> dict[str, Any]:
    """Aggregate-only. ⛔ NO QUESTION TEXT, NO ANSWER TEXT, NO SOURCE TEXT,
    NO LABELS -- a document name is member content too. Shapes and counts are
    enough to see whether the feature works; the words are not ours to keep."""
    out = {
        "scope": scope,
        "sources": len(prepared.get("sources") or []),
        "answerable": prepared.get("answerable", 0),
        "independentSources": prepared.get("independent_sources", 0),
        "noAnswer": bool(prepared.get("no_answer")),
        "hadCoverageNotice": bool(prepared.get("coverage_notice")),
        "settled": settled,
        "hadAnswer": answered,
        "elapsedMs": int((time.time() - started) * 1000),
    }
    if resolved is not None:
        out["citedCount"] = len(resolved.get("cited") or [])
        out["hallucinatedCitation"] = bool(resolved.get("hallucinated_citation"))
    return out


# ── Streaming helpers ────────────────────────────────────────────────────────

_HANDLE_TAIL = 5  # "[123]" -- the longest handle we might be mid-way through


def hold_back(buffered: str) -> tuple[str, str]:
    """Split streamed text into (safe to emit, keep buffered).

    ⛔ NEVER EMIT A HALF-WRITTEN HANDLE. A chunk ending in "[1" would render as
    a literal bracket and then, one chunk later, as a chip -- the member sees a
    citation flicker into existence, and for a moment a handle that has not
    been validated is on screen. Holding back a trailing partial costs one
    chunk of latency and makes the rendered stream monotonic.
    """
    idx = buffered.rfind("[")
    if idx == -1:
        return buffered, ""
    tail = buffered[idx:]
    if "]" in tail or len(tail) > _HANDLE_TAIL:
        return buffered, ""
    return buffered[:idx], tail


def iter_public_sources(items: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [public_source(n, it) for n, it in enumerate(items, 1)]

# ── Transport ────────────────────────────────────────────────────────────────
# Config still reads note_ask's env names (NOTE_ASK_SYNTH_*) so migrating the
# prompt path cannot silently change a deployed knob. note_ask keeps the
# reservation ledger; it no longer builds a prompt.

def model_name() -> str:
    from api.services import note_ask
    return note_ask._SYNTH_MODEL


def max_tokens() -> int:
    from api.services import note_ask
    return note_ask._SYNTH_MAX_TOKENS


async def synthesize(kwargs: dict[str, Any]):
    """Stream text deltas for an already-built request.

    ⛔ TAKES FULLY-BUILT KWARGS. It cannot assemble a prompt, so there is no
    path by which member text reaches `system=` from here -- the boundary is
    upstream in ask_prompt and this function has no way to reopen it. LOCKED
    provider config: no `temperature` (the Sonnet tier 400s on it), thinking
    disabled, explicit timeout.
    """
    from api.services import note_ask
    client = note_ask._async_client()
    async with client.messages.stream(**kwargs,
                                      timeout=note_ask._SYNTH_TIMEOUT) as stream:
        async for delta in stream.text_stream:
            yield delta

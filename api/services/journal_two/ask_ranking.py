"""Wave K Slice 3 -- deterministic ranking + a bounded evidence budget.

WHY THE SCORES COULD NOT SIMPLY BE SORTED TOGETHER
--------------------------------------------------
The retrievers produce numbers on incomparable scales. A note carries the
magnitude of SQLite's `bm25()` -- unbounded, and larger for a better match.
Every other source carries a constant chosen by hand: 0.5 for a page, 0.7 for
an excerpt, 0.8 for a fact, 0.9 for a thesis state. Slices 1-4 sorted those
together with `(curation, score)`, which compares a bm25 magnitude against a
literal that was never on the same axis. It ordered things, but not for a
reason -- and it only looked right because the constants happened to sit where
they did.

So ranking here is TWO-LEVEL, and both levels are declared:

    1. SIGNAL TIER -- WHY this matched. Structural. Never a magnitude.
    2. within tier -- a score normalized INSIDE its own source type.

A tier states something a magnitude cannot: an exact structured record ("your
thesis status is active, confidence 3") answers a thesis question better than
any lexical brush, however the bm25 falls. Normalizing inside a type states
the other half: a note's bm25 magnitude is only ever compared with another
note's.

WHAT A CONSTANT SCORE ACTUALLY MEANS
------------------------------------
A source type whose retriever assigns every row the SAME number carries no
within-type ranking signal at all. Mapping that constant to 1.0 would assert
"best of its type" for rows that are equally the worst of it, and would let a
whole type sweep the top of every tier. Such a type normalizes to NORM_FLOOR:
no evidence of being better than its weakest sibling.

CURATION IS A RANKING SIGNAL, NEVER A CORROBORATION SIGNAL
----------------------------------------------------------
A passage the member saved outranks the raw page it came from; one they
attached to a thesis outranks that. They told us it mattered. It still does
not COUNT as another source -- lineage dedupe collapses the two records and
`independent_sources` counts lineage keys, not rows. Boosting relevance and
inflating corroboration are different operations, and this module does only
the first.
"""
from __future__ import annotations

from typing import Any

from api.services.journal_two import ask_evidence as ev

# ── Signal tiers ─────────────────────────────────────────────────────────────
# ORDINAL. The numbers only order them; no arithmetic is done on a tier.
TIER_STRUCTURED = 0   # an authoritative structured record answers this
TIER_TITLE = 1        # the member named this note after what was asked
TIER_ATTACHED = 2     # they attached this passage to a thesis as evidence
TIER_CURATED = 3      # they deliberately saved this passage
TIER_LEXICAL = 4      # ordinary text match
TIER_CONTEXT = 9      # entity context -- shown, but never an answer

TIER_NAMES = {
    TIER_STRUCTURED: "structured", TIER_TITLE: "title", TIER_ATTACHED: "attached",
    TIER_CURATED: "curated", TIER_LEXICAL: "lexical", TIER_CONTEXT: "context",
}

# Declared ordering among source types when normalized scores TIE inside a
# tier. ⛔ A tiebreak, never an override -- and declared, so that ties do not
# resolve by whatever the alphabet or the retrieval order happened to be.
# A structured record is the most precise, then what the member curated, then
# their own writing, then raw extracted document text.
TYPE_PRIOR = {
    ev.THESIS_STATE: 0, ev.FINANCIAL_FACT: 1, ev.DOCUMENT_EXCERPT: 2,
    ev.NOTE: 3, ev.DOCUMENT_PAGE: 4,
}

# A title match this short is a coincidence, not a signal ("a", "AI").
MIN_TITLE_MATCH = 3

# What a type with no within-type signal is worth: the floor of the band, not
# the top of it. See "WHAT A CONSTANT SCORE ACTUALLY MEANS" above.
NORM_FLOOR = 0.5

# ── Evidence budget ──────────────────────────────────────────────────────────
# Bounded on THREE axes, because they fail differently. MAX_ITEMS bounds how
# many things an answer may lean on. MAX_CHARS bounds the prompt independently
# -- one long page can blow a token budget that eight short notes would not.
# MAX_PER_SOURCE_TYPE stops one document's forty matching pages from filling a
# packet that should also have carried the member's own note.
MAX_ITEMS = 8
MAX_CHARS = 6000
MAX_PER_SOURCE_TYPE = 4

# Below this, a truncated fragment is not evidence -- it is a torn edge that
# the model would still be tempted to quote. Stop instead of admitting one.
MIN_USEFUL_CHARS = 200


def assign_tier(item: dict[str, Any], query: str = "") -> int:
    """Decide WHY this matched. Structural -- no score is consulted."""
    # ⛔ FIRST, AND UNCONDITIONALLY. Context can carry curation 2 (a fact, or
    # a stance-marked copy) and would otherwise climb into an answer tier.
    if item.get("relevance") != ev.QUERY_MATCH:
        return TIER_CONTEXT
    if item.get("source_type") in (ev.THESIS_STATE, ev.FINANCIAL_FACT):
        return TIER_STRUCTURED
    label = (item.get("label") or "").strip().lower()
    q = (query or "").strip().lower()
    if len(label) >= MIN_TITLE_MATCH and len(q) >= MIN_TITLE_MATCH and (
            q in label or label in q):
        return TIER_TITLE
    curation = item.get("curation", 0)
    if curation >= 2:
        return TIER_ATTACHED
    if curation >= 1:
        return TIER_CURATED
    return TIER_LEXICAL


def _normalize_within_type(items: list[dict[str, Any]]) -> None:
    """Map each raw score into [NORM_FLOOR, 1.0] AMONG ITS OWN SOURCE TYPE.

    Deterministic given the candidate set -- which is what makes ranking
    testable at all. The band's floor rather than zero, because passing the
    relevance floor already meant something: being the weakest of its type is
    not evidence of being worthless, only of not being the best.
    """
    by_type: dict[str, list[dict[str, Any]]] = {}
    for it in items:
        by_type.setdefault(it.get("source_type", "?"), []).append(it)
    for group in by_type.values():
        scores = [g.get("score") or 0.0 for g in group]
        lo, hi = min(scores), max(scores)
        span = hi - lo
        for g in group:
            raw = g.get("score") or 0.0
            g["norm_score"] = (NORM_FLOOR if span <= 0 else
                               NORM_FLOOR + (1.0 - NORM_FLOOR) * (raw - lo) / span)


def rank(items: list[dict[str, Any]], query: str = "") -> list[dict[str, Any]]:
    """Order the candidates. Pure, and deterministic under permutation.

    The key is fully specified down to `source_id`, so shuffling the input
    cannot change the output. A ranking whose ties resolve by arrival order
    cannot be tested, and would drift the moment a retriever reordered a
    query -- which is why every level of the key is declared.
    """
    out = [dict(i) for i in items]
    for it in out:
        it["tier"] = assign_tier(it, query)
        it["tier_name"] = TIER_NAMES[it["tier"]]
    _normalize_within_type(out)
    out.sort(key=lambda i: (
        i["tier"],
        -i["norm_score"],
        TYPE_PRIOR.get(i.get("source_type"), len(TYPE_PRIOR)),
        str(i.get("source_type")),
        str(i.get("source_id")),
    ))
    return out


def budget(items: list[dict[str, Any]], query: str = "", *,
           max_items: int = MAX_ITEMS, max_chars: int = MAX_CHARS,
           max_per_type: int = MAX_PER_SOURCE_TYPE) -> list[dict[str, Any]]:
    """Take the bounded packet that synthesis will be handed.

    ⛔ DIVERSITY MUST NOT EVICT AUTHORITY. The per-type cap is counted per
    (tier, source_type), so the FIRST item of any tier-and-type is always
    admitted: a diversity rule can thin a run of forty pages, but it can never
    drop the single most authoritative source, and it can never silence a
    whole source type. A cap that can evict the best evidence is worse than no
    cap at all.
    """
    ranked = items if (items and "tier" in items[0]) else rank(items, query)
    # The cap has a FLOOR OF ONE, which is what makes the guarantee above
    # structural rather than a matter of configuration: no caller can pass a
    # cap that silences a whole source type, so the best-ranked item of any
    # tier-and-type always survives the diversity rule.
    per_type = max(1, max_per_type)
    kept: list[dict[str, Any]] = []
    seen: dict[tuple[int, str], int] = {}
    chars = 0
    for it in ranked:
        if len(kept) >= max_items:
            break
        key = (it["tier"], it.get("source_type", "?"))
        n = seen.get(key, 0)
        if n >= per_type:
            continue
        cost = len(it.get("text") or "")
        if chars + cost > max_chars:
            room = max_chars - chars
            # A single oversized item is TRUNCATED rather than dropped --
            # losing the best evidence for being long is the wrong failure.
            # Truncation narrows what may be quoted; it never invalidates the
            # citation, whose location still spans the whole passage.
            if room < MIN_USEFUL_CHARS:
                continue
            it = dict(it)
            it["text"] = (it.get("text") or "")[:room]
            it["truncated"] = True
            cost = room
        kept.append(it)
        seen[key] = n + 1
        chars += cost
    return kept


def answer_evidence(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The items that may back a claim.

    ⛔ AN ALLOWLIST. Entity context is excluded here even though it is still
    shown to the member -- promoting context into evidence must be impossible,
    not merely discouraged.
    """
    return [i for i in items if i.get("relevance") in ev.ANSWER_RELEVANCE]


def packet(items: list[dict[str, Any]], query: str = "",
           **kw) -> dict[str, Any]:
    """Candidates in, bounded evidence packet out, with honest counts.

    Dedupes first: ranking a page and the excerpt saved from it as two rows
    would let a boost applied to one of them read as corroboration from both.
    """
    merged = ev.dedupe(items)
    ranked = rank(merged, query)
    kept = budget(ranked, query, **kw)
    answers = answer_evidence(kept)
    return {
        "evidence": kept,
        "answer_evidence": answers,
        # ⛔ Distinct lineage keys, not len(). The number an answer is allowed
        # to imply when it says "two sources support this".
        "independent_sources": ev.independent_source_count(answers),
        "no_answer": not answers,
        "dropped": len(ranked) - len(kept),
        "chars": sum(len(i.get("text") or "") for i in kept),
    }

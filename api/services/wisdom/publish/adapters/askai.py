"""Ask-AI adapter — the "UCT SAID" retrieval block (W1 Part 5; CONTRACTS §6.6).

Consumer: `api/routers/ai_search.py::_grounded_system`, right after the brain block.

THE GATE, in this order (W1 §0.4g, CONTRACTS §4)
1. `ASKAI_WISDOM_RETRIEVAL_ENABLED` — the kill switch, read FIRST and per call. Off
   means this module touches neither auth.db nor wisdom.db.
2. an asker id, carried by a ContextVar the endpoint sets (`_grounded_system` keeps its
   one-argument signature: ~10 tests monkeypatch it with `lambda q: ...`). No asker —
   the eval harness, the personal lane — means off.
3. S12 cohort membership `rollout.includes(user_id, "wisdom-askai")` (bare cohort name;
   an empty cohort is nobody). The route is already `require_paid`, so paid content
   (session transcripts) only reaches entitled members, and only the admin cohort while dark.

WHAT THE BLOCK SAYS
Up to two hits, each `[<speaker> · <date> · <provisional|confirmed>] <text> (cite: <locator>)`,
under a header that tells the model to cite speaker and date, never to present a statement
as current data, and to call provisional items provisional. The locator is the interim S8
address (see adapters/common.py for the grammar and the D2 migration note). When the block
fires the router appends the source key "wisdom" and a salt suffix, so an answer cached
before a flip is never served after it.
"""
from __future__ import annotations

import logging
from typing import Iterable, Optional

from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

CONSUMER = "askai"
FLAG_ENV = "ASKAI_WISDOM_RETRIEVAL_ENABLED"
COHORT = "wisdom-askai"
SOURCE_KEY = "wisdom"
SALT_SUFFIX = "|wisdom"
MAX_HITS = 2
SNIPPET_CHARS = 350
#: The same shapes the brain block serves (ai_search._BRAIN_ELIGIBLE). Any question
#: naming a ticker is eligible too: "what did UCT say about NVDA" is the core ask.
ELIGIBLE_QUESTION_TYPES = frozenset({"concept-education", "valuation", "compare", "setup-technical", "other"})
HEADER = ("\n\nUCT SAID (dated, signed statements by the UCT team from Wisdom records — cite the speaker "
          "and date, e.g. 'TSDR, 2026-09-06'; never present them as current market data; an item marked "
          "provisional is unreviewed and must be called provisional): ")


def enabled_for(user_id: Optional[str]) -> bool:
    if not flags.askai_retrieval_enabled():  # kill switch first
        return False
    if not user_id:
        return False
    try:
        from api.services import rollout

        return bool(rollout.includes(str(user_id), COHORT))
    except Exception:
        log.exception("[wisdom] cohort lookup failed; Ask-AI Wisdom block stays off for this ask")
        return False


def wisdom_block(query: Optional[str], *, user_id: Optional[str], question_type: Optional[str] = None,
                 query_tickers: Iterable[str] = ()) -> tuple[str, list]:
    """(block text, citations) or ("", []). Never raises."""
    try:
        if not enabled_for(user_id):
            return "", []
        tickers = [t for t in (query_tickers or ()) if t]
        if not tickers and question_type not in ELIGIBLE_QUESTION_TYPES:
            return "", []
        from api.services.wisdom.publish import retrieval
        from api.services.wisdom.publish.adapters import common

        hits = retrieval.search(query, tickers=tickers, limit=MAX_HITS)
        if not hits:
            return "", []
        parts, cites = [], []
        for h in hits:
            who = common.speaker(h["author_id"])
            date = common.et_date(h["stated_at"]) or "undated"
            status = common.status_label(h["status"])
            parts.append(f"[{who} · {date} · {status}] {common.clip(h['text'], SNIPPET_CHARS)} (cite: {h['locator']})")
            cites.append({"locator": h["locator"], "speaker": who, "date": date, "status": status,
                          "kind": h["doc_kind"]})
        return HEADER + " | ".join(parts), cites
    except Exception:
        log.exception("[wisdom] Ask-AI Wisdom block failed; answering without it")
        return "", []


def daily_preview(ctx) -> dict:
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import common

    flag_on = flags.askai_retrieval_enabled()
    with store.read() as conn:
        docs = (conn.execute("SELECT COUNT(*) FROM wisdom_retrieval_docs").fetchone()[0]
                if common.table_exists(conn, "wisdom_retrieval_docs") else 0)
    try:
        from api.services import rollout

        members = len(rollout.cohort_user_ids(COHORT))
    except Exception:
        members = None
    out = {"flag_on": flag_on, "indexed_docs": docs, "cohort_members": members}
    if getattr(ctx, "dry_run", False):
        return {**out, "dry_run": True}
    with store.write() as conn:
        common.log_publish(conn, CONSUMER, f"summary:indexed_docs={docs}:cohort_members={members}",
                           "export" if flag_on else "would_publish", FLAG_ENV, flag_on)
    return out

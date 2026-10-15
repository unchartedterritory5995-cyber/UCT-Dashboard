"""Ask-AI adapter for the TSDR trader archive — the "TRADER ARCHIVE" grounding block.

Consumer: `api/routers/ai_search.py::_grounded_system`, right after the "UCT SAID" block.

THE GATE: `WISDOM_ARCHIVE_ENABLED`, read FIRST and per call (owner ruling 2026-10-15: paid
members and every in-app tool). Off means this module never opens wisdom.db. There is no
cohort: the Ask AI route is already `require_paid`, which is exactly the audience the owner
named. (The older "UCT SAID" block keeps its own flag and cohort; this one does not use them.)

WHAT THE BLOCK SAYS — bounded: at most MAX_HITS records, each excerpt clipped to
EXCERPT_CHARS, the whole block capped at MAX_BLOCK_CHARS:
  [<trader> · <date> · <record id>] <excerpt> (calls: <TICKER> <dir> <setup> r20 +x.x%)
under a header telling the model to cite trader + date + record id, and never to present an
archived call or its outcome as current data or advice.
"""
from __future__ import annotations

import logging
from typing import Iterable, Optional

from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

FLAG_ENV = "WISDOM_ARCHIVE_ENABLED"
SOURCE_KEY = "trader_archive"
SALT_SUFFIX = "|trader_archive"
MAX_HITS = 6
EXCERPT_CHARS = 280
MAX_BLOCK_CHARS = 2600
HEADER = ("\n\nTRADER ARCHIVE (dated posts by the UCT trading team from the TSDR archive — cite the "
          "trader, the date and the record id, e.g. 'TSDR, 2025-01-02, t123'; these are historical "
          "posts, never current market data or a recommendation; a call's outcome is measured after "
          "the fact, r20 = return 20 sessions later): ")


def _pct(v) -> Optional[str]:
    try:
        x = float(v) * 100
    except (TypeError, ValueError):
        return None
    return f"{'+' if x > 0 else ''}{x:.1f}%"


def _speaker(author_id: Optional[str]) -> str:
    try:
        from api.services.wisdom.publish.adapters import common

        return common.speaker(author_id)
    except Exception:
        return str(author_id or "Unknown")


def format_hit(h: dict) -> str:
    calls = []
    for c in h.get("calls") or []:
        o = c.get("outcome") or {}
        bits = [c.get("ticker") or "", c.get("direction") or "", c.get("setup") or ""]
        r20 = _pct(o.get("r20"))
        if r20:
            bits.append(f"r20 {r20}")
        calls.append(" ".join(b for b in bits if b))
    tail = f" (calls: {'; '.join(calls)})" if calls else ""
    return f"[{_speaker(h.get('author_id'))} · {h.get('stated_date') or 'undated'} · {h.get('record_id')}] " \
           f"{h.get('excerpt') or ''}{tail}"


def archive_block(query: Optional[str], *, query_tickers: Iterable[str] = ()) -> tuple[str, list]:
    """(block text, citations) or ("", []). Never raises."""
    try:
        if not flags.archive_enabled():  # the gate first: off touches no store
            return "", []
        from api.services.wisdom.archive import service
        from api.services.wisdom.core import store

        with store.read() as conn:
            hits = service.retrieval_hits(conn, query or "", tickers=list(query_tickers or ()),
                                          limit=MAX_HITS, excerpt_chars=EXCERPT_CHARS)
        if not hits:
            return "", []
        parts, cites, used = [], [], len(HEADER)
        for h in hits:
            line = format_hit(h)
            if used + len(line) + 3 > MAX_BLOCK_CHARS:
                break
            parts.append(line)
            used += len(line) + 3
            cites.append({"record_id": h["record_id"], "trader": _speaker(h.get("author_id")),
                          "date": h.get("stated_date"), "kind": "trader_archive", "flag_env": FLAG_ENV})
        if not parts:
            return "", []
        return HEADER + " | ".join(parts), cites
    except Exception:
        log.exception("[wisdom] Ask-AI trader-archive block failed; answering without it")
        return "", []

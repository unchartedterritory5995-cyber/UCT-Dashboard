"""Compass tools over the TSDR trader archive — ONE implementation for chat AND voice.

`trader_archive_search(query)` and `trader_archive_ticker(symbol)` are registered in BOTH
Compass registries (text chat: coach_chat_tools.TOOLS; voice: voice_tool_impls via
voice_tools.voice_tool + the voice_agents union/core). Each surface is a thin wrapper over
the two functions here so the two can never diverge.

⛔ Gated by WISDOM_ARCHIVE_ENABLED, read PER CALL: off, the tools are hidden from both
registries and a call that raced a flip is refused, not served. Read-only. Bounded output:
at most MAX_HITS records (excerpts clipped), at most MAX_CALLS calls.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

NAMES = ("trader_archive_search", "trader_archive_ticker")
OFF_MESSAGE = "The trader archive isn't available right now."
MAX_HITS = 6
MAX_CALLS = 12
EXCERPT_CHARS = 280


def enabled() -> bool:
    return flags.archive_enabled()


def _pct(v) -> Optional[str]:
    try:
        x = float(v) * 100
    except (TypeError, ValueError):
        return None
    return f"{'+' if x > 0 else ''}{x:.1f}%"


def _trader(author_id) -> str:
    from api.services.wisdom.archive.askai import _speaker

    return _speaker(author_id)


def search(query: str, *, limit: int = MAX_HITS) -> dict:
    if not enabled():
        return {"ok": False, "error": OFF_MESSAGE, "narration": OFF_MESSAGE}
    q = str(query or "").strip()[:200]
    if not q:
        return {"ok": False, "error": "What should I look for in the trader archive?",
                "narration": "What should I look for in the trader archive?"}
    from api.services.wisdom.archive import service
    from api.services.wisdom.core import store

    tickers = [t for t in re.findall(r"\$?\b([A-Z]{1,5})\b", q) if t.isupper()][:3]
    try:
        with store.read() as conn:
            hits = service.retrieval_hits(conn, q, tickers=tickers, limit=max(1, min(int(limit or MAX_HITS), MAX_HITS)),
                                          excerpt_chars=EXCERPT_CHARS)
    except Exception as exc:  # noqa: BLE001
        log.exception("[wisdom] trader_archive_search failed")
        return {"ok": False, "error": f"archive unavailable: {exc}"}
    results = [{**h, "trader": _trader(h.get("author_id"))} for h in hits]
    narration = (f"{len(results)} archived posts match." if results
                 else "Nothing in the trader archive matches that.")
    return {"ok": True, "query": q, "count": len(results), "results": results, "narration": narration,
            "note": "Historical posts by the UCT team; cite trader, date and record id; not current advice."}


def ticker(symbol: str) -> dict:
    if not enabled():
        return {"ok": False, "error": OFF_MESSAGE, "narration": OFF_MESSAGE}
    from api.services.wisdom.archive import service
    from api.services.wisdom.core import store

    try:
        sym = service.normalize_ticker(symbol or "")
    except service.ItemError:
        return {"ok": False, "error": "symbol required", "narration": "Which ticker?"}
    try:
        with store.read() as conn:
            hits = service.retrieval_hits(conn, "", tickers=[sym], limit=MAX_HITS, excerpt_chars=EXCERPT_CHARS)
            full = service.by_ticker(conn, sym, limit=500)
            summary = service.ticker_summary(conn, sym)
    except Exception as exc:  # noqa: BLE001
        log.exception("[wisdom] trader_archive_ticker failed")
        return {"ok": False, "error": f"archive unavailable: {exc}"}
    calls = sorted(full.get("calls") or [], key=lambda c: c.get("posted") or "", reverse=True)[:MAX_CALLS]
    compact_calls = [{
        "call_id": c["call_id"], "record_id": c["record_id"], "trader": _trader(c.get("author_id")),
        "posted": c.get("posted"), "direction": c.get("direction"), "setup": c.get("setup"),
        "action": c.get("action"), "entry": c.get("entry"), "stop": c.get("stop"),
        "outcome": {k: (c.get("outcome") or {}).get(k) for k in ("r5", "r20", "r60", "status")
                    if k in (c.get("outcome") or {})},
    } for c in calls]
    recent = [{**h, "trader": _trader(h.get("author_id"))} for h in hits]
    mean = _pct(summary.get("mean_r20"))
    narration = (f"{sym}: {len(full.get('records') or [])} archived posts, {summary['n_calls']} calls"
                 f" ({summary['n_scored']} scored{', mean r20 ' + mean if mean else ''}).")
    return {"ok": True, "symbol": sym, "n_records": len(full.get("records") or []), **summary,
            "recent_posts": recent, "recent_calls": compact_calls, "narration": narration,
            "note": "Historical posts by the UCT team; outcomes measured after the fact; not current advice."}

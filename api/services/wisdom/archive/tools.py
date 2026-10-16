"""Compass tools over the TSDR trader archive — ONE implementation for chat AND voice.

`trader_archive_search(query)`, `trader_archive_ticker(symbol)` and
`trader_archive_setup(setup_or_question)` are registered in BOTH
Compass registries (text chat: coach_chat_tools.TOOLS; voice: voice_tool_impls via
voice_tools.voice_tool + the voice_agents union/core). Each surface is a thin wrapper over
the two functions here so the two can never diverge.

⛔ Gated by WISDOM_ARCHIVE_ENABLED, read PER CALL: off, the tools are hidden from both
registries and a call that raced a flip is refused, not served. Read-only. Bounded output:
at most MAX_HITS records (excerpts clipped), at most MAX_CALLS calls; a playbook carries
at most MAX_CUTS context cuts, MAX_TEACHINGS teachings and MAX_EXAMPLES winners/failures each.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

NAMES = ("trader_archive_search", "trader_archive_ticker", "trader_archive_setup", "trader_archive_rhymes")
OFF_MESSAGE = "The trader archive isn't available right now."
MAX_HITS = 6
MAX_CALLS = 12
EXCERPT_CHARS = 280
MAX_CUTS = 4
MAX_TEACHINGS = 4
MAX_EXAMPLES = 5


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


MAX_RHYMES = 8


def rhymes(limit: int = MAX_RHYMES) -> dict:
    """THIS RHYMES: today's scanner hits that map to an archive setup, each with the setup's measured
    record, the ticker's team history and the closest past team calls (archive/rhymes.py).
    Display only; never a price level; never a recommendation."""
    if not enabled():
        return {"ok": False, "error": OFF_MESSAGE, "narration": OFF_MESSAGE}
    from api.services.wisdom.archive import rhymes as _rhymes

    payload = _rhymes.today()
    if payload is None:
        msg = "Today's scan or the archive isn't available right now."
        return {"ok": False, "error": msg, "narration": msg}
    n = max(1, min(int(limit or MAX_RHYMES), MAX_RHYMES))
    hits = payload.get("hits") or []
    narration = (f"{len(hits)} of today's scanner hits rhyme with the team archive "
                 f"(market {payload.get('market_state') or 'unknown'})." if hits
                 else "None of today's scanner hits map to a setup in the team archive.")
    return {"ok": True, "market_state": payload.get("market_state"), "count": len(hits),
            "hits": hits[:n], "narration": narration,
            "note": "Display only: the team's past calls beside today's detections, measured after "
                    "the fact; cite trader, date and record id; not a signal or advice."}


def setup(setup_or_question: str) -> dict:
    """A setup's playbook: definition, measured record, the contexts it did best and worst in,
    the traders' teachings (record ids) and its best and worst archived calls."""
    if not enabled():
        return {"ok": False, "error": OFF_MESSAGE, "narration": OFF_MESSAGE}
    q = str(setup_or_question or "").strip()[:200]
    if not q:
        return {"ok": False, "error": "Which setup?", "narration": "Which setup?"}
    from api.services.wisdom.archive import askai, service
    from api.services.wisdom.core import store

    try:
        with store.read() as conn:
            pb = None
            key = q.lower().replace(" ", "_").replace("-", "_")
            if re.fullmatch(r"[a-z0-9_]{1,60}", key):
                pb = service.playbook(conn, key)
            if pb is None:
                for sid in service.match_setups(conn, q, limit=1):
                    pb = service.playbook(conn, sid)
            if pb is None:
                names = [r["name"] for r in service.playbooks(conn)["setups"][:8]]
    except Exception as exc:  # noqa: BLE001
        log.exception("[wisdom] trader_archive_setup failed")
        return {"ok": False, "error": f"archive unavailable: {exc}"}
    if pb is None:
        msg = "No setup playbook matches that." + (f" Some setups: {', '.join(names)}." if names else "")
        return {"ok": False, "error": msg, "narration": msg}
    cuts = []
    for group, rows in (pb.get("context") or {}).items():
        for value, st in (rows or {}).items():
            if (st or {}).get("n_scored", 0) >= askai.MIN_CONTEXT_N and st.get("mean_edgeR") is not None:
                cuts.append({"group": group, "value": value, "n_scored": st["n_scored"],
                             "edge_R": st["mean_edgeR"], "win20": st.get("win20")})
    cuts.sort(key=lambda c: -c["edge_R"])
    half = MAX_CUTS // 2
    best_ctx, worst_ctx = cuts[:half], [c for c in cuts[::-1][:half] if c not in cuts[:half]]

    def ex(rows):
        return [{**{k: e.get(k) for k in ("call_id", "record_id", "ticker", "posted", "direction", "action",
                                           "evidence", "r20", "sim_R", "regime")},
                 "trader": _trader(e.get("author_id"))} for e in (rows or [])[:MAX_EXAMPLES]]

    line, _ = askai.format_playbook(pb)
    return {"ok": True, "setup_id": pb["setup_id"], "name": pb["name"], "aliases": pb.get("aliases") or [],
            "used_by": [_trader(a) for a in pb.get("used_by") or []],
            "stats": (pb.get("stats") or {}).get("all") or {},
            "best_context": best_ctx, "worst_context": worst_ctx,
            "teachings": [{**{k: t.get(k) for k in ("record_id", "date")}, "trader": _trader(t.get("author_id")),
                           "note": t.get("note")} for t in (pb.get("teachings") or [])[:MAX_TEACHINGS]],
            "winners": ex(pb.get("winners")), "failures": ex(pb.get("failures")),
            "narration": line or f"{pb['name']}: no scored calls yet.",
            "note": ("Measured across all archived calls of this setup; edge = versus the same stock on a "
                     "random day, proven only at |z| >= 3. Historical, not current advice.")}

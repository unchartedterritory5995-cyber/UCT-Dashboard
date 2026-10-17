"""Team history: every time the UCT team mentioned or called one ticker, from the TSDR archive.

The chart's "Team history" panel reads this through GET /api/wisdom/archive/ticker/{sym}/team-history
(require_paid). One row per CALL on the ticker, plus one row per POST that names the ticker without
a call on it (a mention), newest first. Each row carries the date, the trader's display name (the
six team authors only), the setup and action, and what happened next.

THE AGING RULE (the archive's own, never restated): a call's outcome (5- and 20-session return)
leaves this module ONLY for a call posted more than `provider.PRICE_AGE_SESSIONS` (20) trading
sessions before today, decided by `provider.is_aged` -- the same gate the archive applies to a
call's stated prices. A younger call says `outcome_status: "pending"` and carries no numbers, even
when the import already scored part of it. No price level (entry / stop / target) is ever read here.

SESSION MOMENTS: a row's `moment` is ALWAYS present and is null unless a resolver has been
registered with `set_moment_resolver` (the call -> session-video work ships separately, behind
its own flag, and registers itself). The resolver is optional by construction: absent, failing
or returning junk, every row keeps `moment: null` and the panel renders without a link.

GATE: `enabled()` = WISDOM_TICKER_HISTORY_ENABLED and WISDOM_ARCHIVE_ENABLED, both read per call.
"""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Callable, Optional

from api.services.wisdom.archive import provider, service
from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

MAX_ROWS = 300
#: The outcome horizons the panel shows, in trading sessions.
OUTCOME_KEYS = ("r5", "r20")

_resolver: Optional[Callable] = None
_MOMENT_URL = re.compile(r"^/[A-Za-z0-9_\-./?=&%#]{0,300}$")


def enabled() -> bool:
    return flags.team_history_enabled() and flags.archive_enabled()


def set_moment_resolver(fn: Optional[Callable]) -> None:
    """Register fn(conn, call_ids) -> {call_id: {"url": "/...", "label": str?, "t": seconds?}}.

    Pass None to clear. The resolver owns its own flag; this module never reads it."""
    global _resolver
    _resolver = fn


def _clean_moment(raw) -> Optional[dict]:
    """Only an in-app link survives: a relative path, an optional short label and offset."""
    if not isinstance(raw, dict):
        return None
    url = raw.get("url")
    if not isinstance(url, str) or not _MOMENT_URL.match(url) or url.startswith("//"):
        return None
    out: dict = {"url": url}
    label = raw.get("label")
    if isinstance(label, str) and label.strip():
        out["label"] = " ".join(label.split())[:120]
    t = raw.get("t")
    if isinstance(t, (int, float)) and not isinstance(t, bool) and 0 <= t < 86400:
        out["t"] = int(t)
    return out


def _moments(conn, call_ids: list) -> dict:
    if _resolver is None or not call_ids:
        return {}
    try:
        got = _resolver(conn, list(call_ids)) or {}
    except Exception:  # noqa: BLE001 -- a broken resolver costs the links, never the panel
        log.exception("[wisdom] team history: moment resolver failed")
        return {}
    if not isinstance(got, dict):
        return {}
    return {cid: m for cid, m in ((c, _clean_moment(got.get(c))) for c in call_ids) if m}


def _outcome(call: dict, today: date) -> tuple[str, Optional[dict]]:
    if not provider.is_aged(call.get("posted"), today):
        return "pending", None
    o = call.get("outcome") or {}
    nums = {k: float(o[k]) for k in OUTCOME_KEYS if isinstance(o.get(k), (int, float))}
    return ("scored", nums) if nums else ("unscored", None)


def for_ticker(conn, sym: str, *, today: Optional[date] = None, limit: int = MAX_ROWS) -> dict:
    """The panel's payload for one ticker. Raises service.ItemError on a malformed symbol."""
    t = service.normalize_ticker(sym)
    today = today or provider._today()
    limit = max(1, min(int(limit or MAX_ROWS), MAX_ROWS))
    calls = provider.calls(conn, tickers=[t], limit=limit)
    called_records = {c["record_id"] for c in calls}
    team = set(service.team_authors())
    mentions = []
    if provider.has_archive(conn):
        for r in conn.execute(
                "SELECT record_id, author_id, stated_date, record_type FROM wisdom_archive_records "
                "WHERE (',' || tickers || ',') LIKE ? ORDER BY stated_date DESC, record_id DESC LIMIT ?",
                (f"%,{t},%", limit)):
            if r["author_id"] in team and r["record_id"] not in called_records:
                mentions.append(dict(r))
    moments = _moments(conn, [c["call_id"] for c in calls])

    rows: list = []
    for c in calls:
        status, outcome = _outcome(c, today)
        rows.append({
            "kind": "call", "id": c["call_id"], "record_id": c["record_id"],
            "date": str(c.get("posted") or "")[:10] or None,
            "trader": provider.speaker(c["author_id"]),
            "setup": c.get("setup"), "setup_name": c.get("setup_name") or c.get("setup"),
            "action": c.get("action"), "direction": c.get("direction"),
            "outcome_status": status, "outcome": outcome,
            "moment": moments.get(c["call_id"]),
        })
    for m in mentions:
        rows.append({
            "kind": "mention", "id": m["record_id"], "record_id": m["record_id"],
            "date": str(m.get("stated_date") or "")[:10] or None,
            "trader": provider.speaker(m["author_id"]), "record_type": m.get("record_type"),
            "setup": None, "setup_name": None, "action": None, "direction": None,
            "outcome_status": None, "outcome": None, "moment": None,
        })
    rows.sort(key=lambda r: (r["date"] or "", r["id"]), reverse=True)
    rows = rows[:limit]
    scored = [r["outcome"]["r20"] for r in rows if r["outcome"] and "r20" in r["outcome"]]
    return {
        "ticker": t,
        "aged_through": provider.aged_before(today),
        "age_sessions": provider.PRICE_AGE_SESSIONS,
        "n_calls": sum(1 for r in rows if r["kind"] == "call"),
        "n_mentions": sum(1 for r in rows if r["kind"] == "mention"),
        "n_scored": len(scored),
        "n_pending": sum(1 for r in rows if r["outcome_status"] == "pending"),
        "rows": rows,
    }

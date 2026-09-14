"""AI ticker dossier adapter — "what UCT actually said about this name" (W1 Part 5).

Consumer: `api/services/ai_search_dossier.py::_gather_sources`, right after
`_recent_ts_qa(sym)`. Durable stances and principles only — never prices, levels or
dates. The dossier synthesis prompt already forbids them; this module strips them at the
source too (the same firewall `_recent_ts_qa` applies with its label), so a stated level
can never become a "house view" figure.

Flag `WISDOM_DOSSIER_ENABLED` off → `wisdom_lines` returns [] before any store read, so
the bundle and its source hash are byte-identical and no entity re-synthesizes. With it on,
an entity that has Wisdom lines gets a new source hash once, which re-synthesizes it
against `AI_SEARCH_DOSSIER_COST_HARD` — expected, and logged in the daily preview count.
"""
from __future__ import annotations

import logging

from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

CONSUMER = "dossier"
FLAG_ENV = "WISDOM_DOSSIER_ENABLED"
MAX_LINES = 4
LABEL = "[UCT SAID — durable stance/principle only; never prices, levels or dates]"
_STANCE = {
    "watching": "watching it", "taking": "taking the trade", "in_it": "in the position", "added": "added to it",
    "trimmed": "trimmed it", "exited": "exited", "stopped_out": "stopped out", "hindsight": "used it as a teaching example",
    "passed": "passed on it", "avoid": "avoiding it", "no_view": "no view",
}


def _lines_from(conn, sym: str, limit: int) -> list[str]:
    from api.services.wisdom.publish.adapters import common, provenance

    records = common.select_records(conn, types=("CALL", "NEGATIVE_CALL", "PRINCIPLE"), ticker=sym, limit=40)
    if not records:
        return []
    names = common.vocab_names(conn)
    statements = {r["principle_key"]: r["statement"] for r in conn.execute(
        "SELECT principle_key, statement FROM wisdom_principles WHERE status IN ('provisional', 'confirmed') "
        "AND is_guest = 0 AND (canonical IS NULL OR canonical = 1)")}
    lines, seen = [], set()
    for r in records:
        if r["record_type"] == "PRINCIPLE":
            text = statements.get(r["principle_key"]) or ""
        else:
            setup = names.get(r["vocab_id"]) or r["setup_name_raw"]
            text = f"{r['direction'] or 'long'} bias, {_STANCE.get(r['stance'], r['record_type'].lower())}"
            if setup:
                text += f", setup {setup}"
            if r["thesis"] or r["reason"]:
                text += f": {r['thesis'] or r['reason']}"
        text = common.clip(common.scrub_levels_and_dates(text), 220)
        key = (r["author_id"], text.lower())
        if not text or key in seen:
            continue
        seen.add(key)
        # §8c.3: the marker rides at the end of the line, so the stored dossier bundle can
        # be scanned for it. `locator=None` deliberately — this lane's firewall forbids
        # dates, and a locator can carry one; the record ref is a hash and cannot.
        mark = provenance.marker_text(consumer=CONSUMER, subject_ref=f"wisdom_records:{r['record_id']}",
                                      locator=None, flag_env=FLAG_ENV)
        lines.append(f"{LABEL} {common.speaker(r['author_id'])}: {text} "
                     f"({common.status_label(r['status'])}) {mark}")
        if len(lines) >= limit:
            break
    return lines


def wisdom_lines(sym: str, *, limit: int = MAX_LINES) -> list[str]:
    if not flags.dossier_enabled():  # before any store read: flag off is byte-identical
        return []
    try:
        from api.services.wisdom.core import store
        from api.services.wisdom.publish.adapters import common

        ticker = common.normalize_ticker(sym)
        if not ticker:
            return []
        with store.read() as conn:  # dossier synthesis runs on its own daemon thread
            if not common.table_exists(conn, "wisdom_records"):
                return []
            return _lines_from(conn, ticker, limit)
    except Exception:
        log.exception("[wisdom] dossier lines failed for %s", sym)
        return []


def daily_preview(ctx) -> dict:
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import common

    flag_on = flags.dossier_enabled()
    with store.read() as conn:
        tickers = sorted({common.normalize_ticker(r["ticker"]) for r in common.select_records(
            conn, types=("CALL", "NEGATIVE_CALL", "PRINCIPLE"), extra_where="r.ticker IS NOT NULL")})
        with_lines = sum(1 for t in tickers if _lines_from(conn, t, 1))
    out = {"flag_on": flag_on, "entities_with_lines": with_lines}
    if getattr(ctx, "dry_run", False):
        return {**out, "dry_run": True}
    with store.write() as conn:
        common.log_publish(conn, CONSUMER, f"summary:entities={with_lines}",
                           "export" if flag_on else "would_publish", FLAG_ENV, flag_on)
    return out

"""F-CAT-1 spend rail — money out must buy rows in, or the engine stops.

⚰️ **THE OUTAGE.** 2026-09-08 → 2026-09-11, the catalyst engine billed the
curator LLM 31–52 times a day (plus `__hunter__` calls at $0.10–0.22 each) and
persisted **zero rows** for four trading days. Nothing noticed. Every existing
guard watched a different question:

  * the cost cap watches TOTAL SPEND — and the spend was normal;
  * `curator_health` watches whether the curator RAN — and it ran;
  * `/api/admin/catalyst-stats` reports `today_rows` — and nobody was reading it;
  * the coverage audit ran daily and recorded `ranked: 0, missed: 40` — into a
    table with no alarm attached.

⭐ **The unasked question was the ratio.** Spend is only meaningful against what
it bought. This module asks exactly one thing after every run — *did this run
spend money and persist nothing?* — and escalates a streak of them into a stop.

⛔ **ADMIN ONLY, never a member.** A zero-row run is an operational failure, not
a member-facing event; it goes to the admin Discord channel, the same one
`curator_health` uses.

⛔ **THE KILL SWITCH IS AN ENV VAR AND ITS STREAK IS DURABLE.** It is NOT a tag
and NOT a delete (`feedback_kill_switch_never_a_delete`), and the streak is a
query over `catalyst_runs` rather than a module-level counter — this engine has
already been burned twice by guards that a redeploy silently re-armed
(`_DEEP_CONTEXT_DONE`, `news_catalysts._gen_count`), and this repo ships enough
commits in a day to reset an in-memory counter before it can ever reach N.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from api.services.catalyst import store

logger = logging.getLogger(__name__)

#: Alert dedup, per market date. Deliberately in-process: a redeploy re-arming
#: this costs one extra admin ping, which is harmless. The expensive guarantee —
#: the kill switch below — is durable in SQLite, which is where durability is
#: actually load-bearing.
_ALERTED_DATES: set[str] = set()

_DEFAULT_KILL_AFTER = 3


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def kill_after() -> int:
    """Consecutive money-spent-nothing-persisted runs tolerated before stopping.
    ``0`` disables the automatic stop (the manual switch still works)."""
    return _int_env("CATALYST_ZERO_ROW_KILL_AFTER", _DEFAULT_KILL_AFTER)


def block_reason() -> Optional[str]:
    """Why this run must NOT spend, or None if it may. Never raises.

    ⛔ Fails OPEN on a broken ledger read, and that is deliberate: this guard
    protects a cost budget, not member safety, and a store hiccup silently
    disabling the whole catalyst engine would be a worse outage than the spend
    it prevents. The daily cost cap in `cost_guard` is the hard backstop.
    """
    manual = os.environ.get("CATALYST_SPEND_DISABLED", "").strip().lower()
    if manual in ("1", "true", "yes"):
        return "CATALYST_SPEND_DISABLED=1 (manual kill switch)"

    n = kill_after()
    if n <= 0:
        return None
    try:
        streak = store.consecutive_zero_row_spending_runs()
    except Exception:
        logger.exception("[catalyst-spend-rail] streak read failed — allowing the run")
        return None
    if streak >= n:
        return (f"{streak} consecutive runs spent money and persisted zero rows "
                f"(cap CATALYST_ZERO_ROW_KILL_AFTER={n}). "
                f"Fix the engine, then clear with CATALYST_ZERO_ROW_KILL_AFTER=0 "
                f"for one run, or write a healthy run.")
    return None


def record_and_check(market_date: str, started_at: int, summary: dict) -> dict:
    """Persist the run receipt and fire the zero-row alert. Never raises.

    Returns `summary`, annotated with `rows_written` and `spend_usd` so the
    caller's own log line carries the ratio this rail exists to watch.
    """
    try:
        spend = store.spend_since(started_at)
        rows = store.rows_written_since(market_date, started_at)
        summary["rows_written"] = rows
        summary["spend_usd"] = round(spend, 4)

        store.record_run(
            market_date=market_date, started_at=started_at,
            candidates=summary.get("candidates", 0),
            scored=summary.get("scored", 0),
            selected=summary.get("selected", 0),
            synthesized=summary.get("synthesized", 0),
            rows_written=rows, spend_usd=spend,
            skipped=summary.get("skipped"),
            errors=summary.get("errors") or [],
        )

        if spend > 0 and rows == 0:
            logger.error(
                "[catalyst-spend-rail] ZERO-ROW RUN: $%.4f spent, 0 rows persisted "
                "on %s — errors=%s", spend, market_date, summary.get("errors"))
            _alert(market_date, spend, summary)
    except Exception:
        logger.exception("[catalyst-spend-rail] post-run check failed")
    return summary


def _alert(market_date: str, spend: float, summary: dict) -> None:
    if os.environ.get("CATALYST_SPEND_ALERT_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return
    if market_date in _ALERTED_DATES:
        return
    _ALERTED_DATES.add(market_date)

    errors = summary.get("errors") or []
    detail = "\n".join(f"• {e}" for e in errors[:6])[:1000] or "(no stage reported an error)"
    try:
        streak = store.consecutive_zero_row_spending_runs()
    except Exception:
        streak = -1
    try:
        from api.services import discord_notify
        discord_notify._send_webhook({
            "title": "🔴 Catalyst engine spent money and wrote nothing",
            "description": (
                "A refresh billed the LLM and persisted **zero rows**. This is "
                "the 2026-09-09 failure shape: the pipeline pays for curation "
                "up front, so an abort after that point costs the spend and "
                "delivers nothing. The table members see is not updating.\n\n"
                f"After **{kill_after()}** consecutive runs like this the engine "
                "stops spending on its own."
            ),
            "fields": [
                {"name": "Date", "value": market_date, "inline": True},
                {"name": "Spent", "value": f"${spend:.4f}", "inline": True},
                {"name": "Streak", "value": str(streak), "inline": True},
                {"name": "Failing stages", "value": detail, "inline": False},
            ],
            "color": 0xD03030,
        })
    except Exception:
        logger.debug("[catalyst-spend-rail] discord send failed", exc_info=True)

"""Badges adapter — "UCT said" for tickers with a recent team CALL or MENTION (W1 Part 5).

W1 surface: `GET /api/admin/wisdom/publish/adapters/badges?tickers=A,B` (require_admin),
server flag `WISDOM_BADGES_ENABLED` only. No CatalystTable / Calendar / VITE flag change in
W1 (CONTRACTS §0 #15: render-loop class H14; auth.py has an unmerged edit elsewhere).

Response: `{TICKER: {kind, speaker, stated_at, label}}` — the newest CALL/MENTION per
ticker inside the last `WISDOM_BADGES_LOOKBACK_DAYS` (default 10). With the flag off the
mapping is empty, unless an admin asks for `preview=true`, which returns the same shape
with `"preview": true` on every value. Guests (D14) are never "UCT said"; a provisional
record's label says so.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Iterable, Optional

from api.services.wisdom.core import flags

CONSUMER = "badges"
FLAG_ENV = "WISDOM_BADGES_ENABLED"
DEFAULT_LOOKBACK_DAYS = 10
MAX_TICKERS = 200


def lookback_days() -> int:
    try:
        days = int(os.environ.get("WISDOM_BADGES_LOOKBACK_DAYS", str(DEFAULT_LOOKBACK_DAYS)))
    except ValueError:
        days = DEFAULT_LOOKBACK_DAYS
    return max(1, min(90, days))


def parse_tickers(raw: Optional[str]) -> list[str]:
    from api.services.wisdom.publish.adapters import common

    return list(dict.fromkeys(t for t in (common.normalize_ticker(x) for x in (raw or "").split(",")) if t))


def badges_for(tickers: Iterable[str], *, preview: bool = False, now: Optional[datetime] = None,
               days: Optional[int] = None) -> dict:
    from api.services.wisdom.core import store, timeutil
    from api.services.wisdom.publish.adapters import common

    flag_on = flags.badges_enabled()
    if not flag_on and not preview:
        return {}
    wanted = list(dict.fromkeys(common.normalize_ticker(t) for t in tickers if t))[:MAX_TICKERS]
    wanted = [t for t in wanted if t]
    if not wanted:
        return {}
    now = timeutil.to_et(now) if now else timeutil.now_et()
    since = timeutil.iso_et(now - timedelta(days=days or lookback_days()))
    with store.read(for_request=True) as conn:
        if not common.table_exists(conn, "wisdom_records"):
            return {}
        records = common.select_records(
            conn, types=("CALL", "MENTION"), since_iso=since,
            extra_where=f"UPPER(r.ticker) IN ({','.join('?' * len(wanted))})", extra_params=wanted)
    out: dict = {}
    for r in records:  # newest first
        ticker = common.normalize_ticker(r["ticker"])
        if ticker in out:
            continue
        status = common.status_label(r["status"])
        badge = {"kind": "call" if r["record_type"] == "CALL" else "mention",
                 "speaker": common.speaker(r["author_id"]), "stated_at": r["stated_at_et"],
                 "label": "UCT said" + (" · provisional" if status == "provisional" else "")}
        if not flag_on:
            badge["preview"] = True
        out[ticker] = badge
    return out


def daily_preview(ctx) -> dict:
    from api.services.wisdom.core import store, timeutil
    from api.services.wisdom.publish.adapters import common

    flag_on = flags.badges_enabled()
    since = timeutil.iso_et(timeutil.now_et() - timedelta(days=lookback_days()))
    with store.read() as conn:
        tickers = sorted({common.normalize_ticker(r["ticker"]) for r in common.select_records(
            conn, types=("CALL", "MENTION"), since_iso=since, extra_where="r.ticker IS NOT NULL")})
    out = {"flag_on": flag_on, "tickers_badged": len(tickers), "lookback_days": lookback_days()}
    if getattr(ctx, "dry_run", False):
        return {**out, "dry_run": True}
    with store.write() as conn:
        common.log_publish(conn, CONSUMER, f"summary:tickers={len(tickers)}:days={lookback_days()}",
                           "export" if flag_on else "would_publish", FLAG_ENV, flag_on)
    return out

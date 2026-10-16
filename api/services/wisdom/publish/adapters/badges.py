"""Badges adapter — "UCT said" for tickers with a recent team CALL or MENTION (W1 Part 5).

W1 surface: `GET /api/admin/wisdom/publish/adapters/badges?tickers=A,B` (require_admin),
server flag `WISDOM_BADGES_ENABLED` only. No CatalystTable / Calendar / VITE flag change in
W1 (CONTRACTS §0 #15: render-loop class H14; auth.py has an unmerged edit elsewhere).

⭐ The TSDR-archive lane at the bottom of this module (`archive_badges`, `archive_history`) IS
member-visible — see its section comment. The Loop half described here stays admin-only.

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
    from api.services.wisdom.publish.adapters import common, provenance

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
                 "label": "UCT said" + (" · provisional" if status == "provisional" else ""),
                 # §8c.3: every badge a surface receives names the record behind it.
                 **provenance.marker(consumer=CONSUMER, subject_ref=f"wisdom_records:{r['record_id']}",
                                     locator=common.row_locator(r), flag_env=FLAG_ENV)}
        if not flag_on:
            badge["preview"] = True
        out[ticker] = badge
    return out


# ── the TSDR archive lane (owner decisions 2026-10-16) ───────────────────────
#
# A MEMBER lane, unlike the Loop half above (admin endpoint only in W1): it is served to paid
# members by `GET /api/wisdom/team-calls` (`api/routers/wisdom_publish.py`), feeds the
# watchlist intelligence "team called it" fact, the watchlist digest line and the UCT20 card
# line. Gated by THIS adapter's flag AND `WISDOM_ARCHIVE_ENABLED`, both read per call before
# any store read. Reads only `archive.provider` (the archive is its own provider, outside the
# R89 floor — docs/wisdom/LEDGER.md). Never carries an entry/stop/target: a badge is a fact
# about a call, not a level.

#: action -> (badge kind, label). Exits and trims are not "called it"; flow posts are reads.
ARCHIVE_LABELS = {
    "entry": ("call", "Team took it"), "add": ("call", "Team added"), "idea": ("call", "Team called it"),
    "watch": ("mention", "On the team's watchlist"),
}


def archive_enabled() -> bool:
    from api.services.wisdom.archive import provider

    return flags.badges_enabled() and provider.enabled()


def archive_badges(tickers: Iterable[str], *, now: Optional[datetime] = None,
                   days: Optional[int] = None) -> dict:
    """{TICKER: badge} for the newest archive call per ticker inside the lookback. {} when off."""
    if not archive_enabled():
        return {}
    from api.services.wisdom.archive import provider
    from api.services.wisdom.core import store, timeutil
    from api.services.wisdom.publish.adapters import common, provenance

    wanted = [t for t in dict.fromkeys(common.normalize_ticker(t) for t in tickers if t) if t][:MAX_TICKERS]
    if not wanted:
        return {}
    now = timeutil.to_et(now) if now else timeutil.now_et()
    since = (now - timedelta(days=days or lookback_days())).date().isoformat()
    with store.read(for_request=True) as conn:
        calls = provider.calls(conn, tickers=wanted, actions=tuple(ARCHIVE_LABELS), since=since)
    out: dict = {}
    for c in calls:  # newest first
        ticker = c["ticker"]
        if ticker in out:
            continue
        kind, label = ARCHIVE_LABELS[c["action"]]
        call = provider.public_call(c)
        out[ticker] = {"kind": kind, "label": label, "speaker": call["trader"],
                       "stated_at": call["posted"], "setup": call["setup"], "setup_name": call["setup_name"],
                       "direction": call["direction"], "action": call["action"], "record_id": call["record_id"],
                       "call_id": call["call_id"], "outcome": call["outcome"], "source_detail": "archive",
                       **provenance.marker(consumer=CONSUMER, subject_ref=provider.subject_ref(c),
                                           locator=call["locator"], flag_env=FLAG_ENV)}
    return out


def archive_history(tickers: Iterable[str]) -> dict:
    """{TICKER: {n_calls, n_traders, n_scored, mean_r20, last}} over the whole archive. {} when off."""
    if not archive_enabled():
        return {}
    from api.services.wisdom.archive import provider
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import common, provenance

    wanted = [t for t in dict.fromkeys(common.normalize_ticker(t) for t in tickers if t) if t][:MAX_TICKERS]
    if not wanted:
        return {}
    with store.read(for_request=True) as conn:
        calls = provider.calls(conn, tickers=wanted)
    grouped: dict = {}
    for c in calls:  # newest first
        grouped.setdefault(c["ticker"], []).append(c)
    out: dict = {}
    for ticker, cs in grouped.items():
        r20 = [c["outcome"].get("r20") for c in cs if isinstance(c["outcome"].get("r20"), (int, float))]
        last = next((c for c in cs if c.get("action") in ARCHIVE_LABELS), cs[0])
        call = provider.public_call(last)
        out[ticker] = {"n_calls": len(cs), "n_traders": len({c["author_id"] for c in cs}),
                       "n_scored": len(r20), "mean_r20": (sum(r20) / len(r20)) if r20 else None,
                       "last": {k: call[k] for k in ("trader", "posted", "setup", "setup_name", "direction",
                                                      "action", "record_id", "outcome")},
                       **provenance.marker(consumer=CONSUMER, subject_ref=provider.subject_ref(last),
                                           locator=call["locator"], flag_env=FLAG_ENV)}
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

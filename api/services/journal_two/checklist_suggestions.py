"""Checklist from my winners (P2 Tier 3, Task 6): before-entry items suggested from the habits on
the member's best trades, each with those trades as evidence. A SUGGESTION ONLY: this module reads
and never writes. Accepting one is the member's act, through the rules doors that already exist
(R-T3-6, R-T3-V4).

  suggest(conn, user_id, account_id) ->
    {"status": "ok" | "too_few", "winnerCount": int, "bestCount": int,
     "suggestions": [{"tag", "label", "shareBest", "shareOthers",
                      "evidence": [{"tradeRef", "tradeId", "symbol", "exitDate", "r"}]}]}

THE POPULATION (R-T3-5).
  * Closed equity trades: `j2_trades` holds exactly those. Inclusion is `ANALYTICS_INCLUDED_SQL`,
    imported, never restated, so an `analytics_excluded` trade counts nowhere.
  * Effective R is `analytics._effective_r_map` (stop R, else the excursion's true R), imported.
    A trade with NO effective R cannot be ranked, so it is left out of the population entirely:
    neither a best trade nor one of "the rest".
  * A winner is a trade whose effective R is above 0. The best trades are the top BEST_N winners
    by R; ties break by the later exit day, then by trade id, so the cut is the same every read.
  * Fewer than MIN_WINNERS winners: `too_few`, and nothing is suggested.

WHICH TAGS (R-T3-4). Habits are the trade's `emotion_tags`. `mistake_tags` is never read: a mistake
is never a checklist item, however often it rides along with a winner.

WHEN A TAG QUALIFIES (R-T3-5). Both: it is on at least MIN_SHARE of the best trades, and its rate
among the best is at least MIN_LIFT times its rate among the rest (every other ranked trade). A tag
never seen outside the best has an infinite ratio. The ratio is what stops a tag on every trade
from posing as a winners' habit. At most MAX_SUGGESTIONS, ordered by the rate among the best.

A TAG ALREADY ON THE CHECKLIST is dropped: an active before-entry rule whose label contains the
tag as a word, compared without case. With an account, that account's rules; with none (All
Accounts), every rule the member has.
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any

from api.services.journal_two import analytics, excursions_store
from api.services.journal_two.filters import ANALYTICS_INCLUDED_SQL
from api.services.journal_two.trade_refs import trade_ref_for_row
from api.services.notebook_flags import flag_on

MIN_WINNERS = 10
BEST_N = 20
MIN_SHARE = 0.40
MIN_LIFT = 1.5
MAX_SUGGESTIONS = 5

#: The Tier 3 switch (auth.NOTEBOOK_FLAGS row; enablement, unset means OFF).
FLAG = "JOURNAL_TIER3_ENABLED"


def enabled() -> bool:
    """Read per call through the one Notebook flag parse, never latched at import."""
    return flag_on(FLAG, False)


def label_for(tag: str) -> str:
    return f"Before entry: am I {tag}?"


def _tags(raw: Any) -> set[str]:
    """One trade's emotion tags, deduplicated, blanks and non-strings dropped."""
    return {t.strip() for t in analytics._json_tags(raw) if isinstance(t, str) and t.strip()}


def _ranked_rows(conn: sqlite3.Connection, user_id: str, account_id: str | None) -> list[dict]:
    sql = (
        "SELECT id, symbol, exit_date, trading_day_et, r_multiple, external_id, source, "
        "       emotion_tags "
        "  FROM j2_trades WHERE user_id = ? " + ANALYTICS_INCLUDED_SQL
    )
    params: list[Any] = [user_id]
    if account_id:
        sql += " AND account_id = ?"
        params.append(account_id)
    rows = conn.execute(sql, params).fetchall()
    excursions = excursions_store.list_excursions_for_user(user_id, conn=conn)
    r_map, _ = analytics._effective_r_map(rows, excursions)
    out = []
    for row in rows:
        r = r_map.get(row["id"])
        if r is None:
            continue  # cannot be ranked: outside the population
        out.append({
            "id": row["id"],
            "ref": trade_ref_for_row(row),
            "symbol": row["symbol"],
            # The canonical day spine (filters.trades_where): the ET trading day, else the exit date.
            "day": row["trading_day_et"] or (row["exit_date"] or "")[:10],
            "r": float(r),
            "tags": _tags(row["emotion_tags"]),
        })
    return out


def _rank(trades: list[dict]) -> list[dict]:
    """R descending, then the later exit day, then trade id. Three stable passes, last key first."""
    ordered = sorted(trades, key=lambda t: t["id"])
    ordered.sort(key=lambda t: t["day"], reverse=True)
    ordered.sort(key=lambda t: t["r"], reverse=True)
    return ordered


def _checklist_words(conn: sqlite3.Connection, user_id: str, account_id: str | None) -> list[str]:
    """Lower-cased labels of the active before-entry rules in scope."""
    sql = ("SELECT label FROM j2_journal_rules WHERE user_id = ? AND status = 'active' "
           "AND before_entry = 1")
    params: list[Any] = [user_id]
    if account_id:
        sql += " AND account_id = ?"
        params.append(account_id)
    return [(r["label"] or "").lower() for r in conn.execute(sql, params).fetchall()]


def _on_checklist(tag: str, labels: list[str]) -> bool:
    word = re.compile(rf"(?<![\w-]){re.escape(tag.lower())}(?![\w-])")
    return any(word.search(label) for label in labels)


def suggest(conn: sqlite3.Connection, user_id: str, account_id: str | None) -> dict:
    trades = _ranked_rows(conn, user_id, account_id)
    winners = _rank([t for t in trades if t["r"] > 0])
    if len(winners) < MIN_WINNERS:
        return {"status": "too_few", "winnerCount": len(winners), "bestCount": 0, "suggestions": []}

    best = winners[:BEST_N]
    best_ids = {t["id"] for t in best}
    rest = [t for t in trades if t["id"] not in best_ids]
    on_checklist = _checklist_words(conn, user_id, account_id)

    candidates = []
    for tag in sorted({tag for t in best for tag in t["tags"]}):
        carrying = [t for t in best if tag in t["tags"]]
        rest_count = sum(1 for t in rest if tag in t["tags"])
        share_best = len(carrying) / len(best)
        share_rest = rest_count / len(rest) if rest else 0.0
        if share_best < MIN_SHARE:
            continue
        # A tag never seen outside the best has an infinite ratio; otherwise best >= lift x rest.
        if rest_count and share_best < MIN_LIFT * share_rest:
            continue
        if _on_checklist(tag, on_checklist):
            continue
        candidates.append({
            "tag": tag,
            "label": label_for(tag),
            "shareBest": round(share_best, 4),
            "shareOthers": round(share_rest, 4),
            # `best` is already in R order (then day, then id), so the evidence is too.
            "evidence": [{"tradeRef": t["ref"], "tradeId": t["id"], "symbol": t["symbol"],
                          "exitDate": t["day"], "r": round(t["r"], 2)} for t in carrying],
            "_share": share_best,
        })
    candidates.sort(key=lambda c: c["tag"])
    candidates.sort(key=lambda c: c["_share"], reverse=True)
    for c in candidates:
        del c["_share"]
    return {"status": "ok", "winnerCount": len(winners), "bestCount": len(best),
            "suggestions": candidates[:MAX_SUGGESTIONS]}

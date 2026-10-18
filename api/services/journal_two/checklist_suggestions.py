"""Checklist from my winners (P2 Tier 3, Task 6): before-entry items suggested from the habits on
the member's best trades, each with those trades as evidence. A SUGGESTION ONLY: this module reads
and never writes. Accepting one is the member's act, through the rules doors that already exist
(R-T3-6, R-T3-V4).

  suggest(conn, user_id, account_id) ->
    {"status": "ok" | "too_few", "winnerCount": int, "bestCount": int, "restCount": int,
     "restSample": "too_few" | "thin" | "normal",
     "suggestions": [{"tag", "label", "sourceId", "pendingMark": rule id | None,
                      "shareBest", "shareOthers", "othersTagged",
                      "evidence": [{"tradeRef", "tradeId", "symbol", "exitDate", "r"}]}]}

THE POPULATION (R-T3-5; fix round 1, ruling R-T3-T6-R2).
  * Closed equity trades: `j2_trades` holds exactly those. Inclusion is `ANALYTICS_INCLUDED_SQL`,
    imported, never restated, so an `analytics_excluded` trade counts nowhere.
  * Effective R is `analytics._effective_r_map` (stop R, else the excursion's true R), imported.
    ONLY THE RANKING NEEDS R: a winner is a trade whose effective R is above 0, and the best trades
    are the top BEST_N winners by R; ties break by the later exit day, then by trade id. A trade
    with no effective R can never be a best trade.
  * "THE REST" IS EVERY OTHER INCLUDED CLOSED TRADE, with or without an effective R. A broker book
    stores no stop, so most of its trades have no R; leaving them out of the rest made a tag on
    nearly every trade read as "on 0% of the rest" and pass on an infinite lift.
  * Fewer than MIN_WINNERS winners: `too_few`, and nothing is suggested.
  * TOO FEW OTHER TRADES, NO SUGGESTION (final fix I3): a suggestion IS a contrast with the rest,
    so the rest must be big enough to compare with: `restSample` is `sample_size.band(restCount)`,
    and while it is `too_few` (fewer than sample_size's 10, an empty rest included) nothing is
    suggested and the panel says there are too few other trades to compare.

WHICH TAGS (R-T3-4, final fix I4 / R-T3-FIN-1). Habits are the trade's `emotion_tags`. `mistake_tags`
is never read: a mistake is never a checklist item, however often it rides along with a winner. A
suggestion is something to CONFIRM before entry, so a tag nobody would want present is never one:
NEVER_SUGGESTED is the ONE declared excluded set (the negative emotions plus every mistake word, so
"FOMO" typed as an emotion is caught too), compared case-insensitively. SUGGESTIBLE_EMOTIONS is the
rest of the standard vocabulary, declared so tests/test_checklist_suggestions.py can fail on a
vocabulary tag (server or client list) that is in neither set: a new tag forces a decision. A
member's own tag outside the vocabulary is suggestible by default (the excluded set is the rule).
Nothing in the codebase classified valence before this, so the sets are declared here.

ONE TAG WHATEVER ITS CASE (final fix M4): tags are counted by their lower-case key; a suggestion
shows the spelling the member used on the most included trades (ties: the first in sort order),
and its `sourceId` is the key, so a rule made from it is found whatever the spelling.

WHEN A TAG QUALIFIES (R-T3-5, final fix I3). Both: it is on at least MIN_SHARE of the best trades,
and its rate among the best is at least MIN_LIFT times its rate among the rest. The comparison is
always FINITE: a tag on none of the N other trades is read at the rest's resolution, fewer than 1
in N, so its lift is share-among-the-best x N, never infinite. Every suggestion carries both counts
(`evidence` for the best, `othersTagged` of `restCount` for the rest). At most MAX_SUGGESTIONS,
ordered by the rate among the best.

A RULE ALREADY MADE FOR THE TAG (active rules only; with an account that account's rules, with
none every rule the member has):
  * an active BEFORE-ENTRY rule whose label holds the tag as a word (any case), or that was made
    from this suggestion (`sourceId`), drops the tag: it is on the checklist already;
  * an active rule NOT yet marked before entry that was made from this suggestion, or whose label
    is the suggested label (any case), is "already added, mark it": the tag stays, with
    `pendingMark` = that rule's id, so the client marks the existing rule and never makes a second
    one (fix round 1, M3: a failed mark followed by a reload must not offer a second create).
"""
from __future__ import annotations

import re
import sqlite3
from collections import Counter
from typing import Any

from api.services.journal_two import analytics, excursions_store, sample_size, tag_suggest
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


#: Final fix I4 (R-T3-FIN-1). The standard emotions a member would want present before entry.
SUGGESTIBLE_EMOTIONS = frozenset({"confident", "calm", "disciplined", "patient", "focused"})
#: THE ONE EXCLUDED SET, lower-case: the negative emotions, and every mistake word (derived from the
#: mistake vocabulary, never restated), so neither is ever offered as "Before entry: am I <tag>?".
NEVER_SUGGESTED = frozenset(
    {"anxious", "greedy", "fearful", "frustrated", "euphoric", "bored", "impulsive", "rushed",
     "distracted", "revenge-driven"}
    | {m.lower() for m in tag_suggest.STANDARD_MISTAKES})


def suggestible(tag: str) -> bool:
    """May this tag be suggested as a before-entry item? Every tag but the excluded set, any case."""
    return tag.lower() not in NEVER_SUGGESTED


def label_for(tag: str) -> str:
    return f"Before entry: am I {tag}?"


def _tags(raw: Any) -> set[str]:
    """One trade's emotion tags, deduplicated, blanks and non-strings dropped."""
    return {t.strip() for t in analytics._json_tags(raw) if isinstance(t, str) and t.strip()}


#: The provenance a rule made from this panel carries (`source_id`); the client sends it back as-is.
SOURCE_PREFIX = "winners:"


def source_id_for(tag: str) -> str:
    return f"{SOURCE_PREFIX}{tag}"


def _included_rows(conn: sqlite3.Connection, user_id: str, account_id: str | None) -> list[dict]:
    """Every included closed trade, with `r` = its effective R, or None when it cannot be ranked."""
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
        out.append({
            "id": row["id"],
            "ref": trade_ref_for_row(row),
            "symbol": row["symbol"],
            # The canonical day spine (filters.trades_where): the ET trading day, else the exit date.
            "day": row["trading_day_et"] or (row["exit_date"] or "")[:10],
            "r": None if r is None else float(r),
            "tags": _tags(row["emotion_tags"]),
        })
    return out


def _rank(trades: list[dict]) -> list[dict]:
    """R descending, then the later exit day, then trade id. Three stable passes, last key first."""
    ordered = sorted(trades, key=lambda t: t["id"])
    ordered.sort(key=lambda t: t["day"], reverse=True)
    ordered.sort(key=lambda t: t["r"], reverse=True)
    return ordered


def _active_rules(conn: sqlite3.Connection, user_id: str, account_id: str | None) -> list[dict]:
    """The active rules in scope, newest first: label (trimmed, lower-cased), before_entry, source."""
    sql = ("SELECT id, label, before_entry, source_id FROM j2_journal_rules "
           "WHERE user_id = ? AND status = 'active'")
    params: list[Any] = [user_id]
    if account_id:
        sql += " AND account_id = ?"
        params.append(account_id)
    sql += " ORDER BY created_at DESC, rowid DESC"
    return [{"id": r["id"], "label": (r["label"] or "").strip().lower(),
             "before_entry": bool(r["before_entry"]), "source_id": r["source_id"]}
            for r in conn.execute(sql, params).fetchall()]


def _rule_state(tag: str, rules: list[dict]) -> tuple[bool, str | None]:
    """(already on the checklist, the id of a made-but-unmarked rule to mark) for one tag."""
    word = re.compile(rf"(?<![\w-]){re.escape(tag.lower())}(?![\w-])")
    ours_id = source_id_for(tag.lower())
    suggested = label_for(tag).lower()
    pending = None
    for r in rules:
        ours = (r["source_id"] or "").lower() == ours_id
        if r["before_entry"]:
            if ours or word.search(r["label"]):
                return True, None
        elif pending is None and (ours or r["label"] == suggested):
            pending = r["id"]
    return False, pending


def _spellings(trades: list[dict]) -> dict[str, str]:
    """M4: lower-case key -> the spelling on the most included trades (ties: first in sort order)."""
    counts: dict[str, Counter] = {}
    for t in trades:
        for tag in t["tags"]:
            counts.setdefault(tag.lower(), Counter())[tag] += 1
    return {key: sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] for key, c in counts.items()}


def suggest(conn: sqlite3.Connection, user_id: str, account_id: str | None) -> dict:
    trades = _included_rows(conn, user_id, account_id)
    for t in trades:
        t["keys"] = {tag.lower() for tag in t["tags"]}      # M4: one habit whatever its case
    winners = _rank([t for t in trades if t["r"] is not None and t["r"] > 0])
    if len(winners) < MIN_WINNERS:
        return {"status": "too_few", "winnerCount": len(winners), "bestCount": 0, "restCount": 0,
                "restSample": sample_size.band(0), "suggestions": []}

    best = winners[:BEST_N]
    best_ids = {t["id"] for t in best}
    # R-T3-T6-R2: the rest is EVERY other included trade, ranked or not.
    rest = [t for t in trades if t["id"] not in best_ids]
    rest_sample = sample_size.band(len(rest))
    out = {"status": "ok", "winnerCount": len(winners), "bestCount": len(best),
           "restCount": len(rest), "restSample": rest_sample, "suggestions": []}
    if rest_sample == "too_few":
        return out  # I3: too few other trades to compare with (an empty rest included)

    spelling = _spellings(trades)
    rules = _active_rules(conn, user_id, account_id)
    candidates = []
    for key in sorted({k for t in best for k in t["keys"]}):
        if not suggestible(key):
            continue                                        # I4: never a before-entry item
        tag = spelling[key]
        carrying = [t for t in best if key in t["keys"]]
        rest_count = sum(1 for t in rest if key in t["keys"])
        share_best = len(carrying) / len(best)
        share_rest = rest_count / len(rest)
        if share_best < MIN_SHARE:
            continue
        # I3: ALWAYS finite. A tag on none of the N others is read as fewer than 1 in N.
        if share_best < MIN_LIFT * max(rest_count, 1) / len(rest):
            continue
        on_checklist, pending = _rule_state(tag, rules)
        if on_checklist:
            continue
        candidates.append({
            "tag": tag,
            "label": label_for(tag),
            "sourceId": source_id_for(key),
            "pendingMark": pending,
            "shareBest": round(share_best, 4),
            "shareOthers": round(share_rest, 4),
            "othersTagged": rest_count,
            # `best` is already in R order (then day, then id), so the evidence is too.
            "evidence": [{"tradeRef": t["ref"], "tradeId": t["id"], "symbol": t["symbol"],
                          "exitDate": t["day"], "r": round(t["r"], 2)} for t in carrying],
            "_share": share_best,
        })
    candidates.sort(key=lambda c: c["tag"])
    candidates.sort(key=lambda c: c["_share"], reverse=True)
    for c in candidates:
        del c["_share"]
    out["suggestions"] = candidates[:MAX_SUGGESTIONS]
    return out

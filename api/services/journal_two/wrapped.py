"""Your trading year: the data (P2 Tier 3, Task 7). One read, `year_wrapped`, behind
GET /api/j2/wrapped/{year} (api/routers/notebook_wrapped.py), and the years it can open,
`years_with_trades`, behind GET /api/j2/wrapped/years (Task 8, the Report page door's picker).

The four sections and where each number comes from (R-T3-9):

  * bestSetups: `playbook_stats.get_playbook_stats` over the year's INCLUDED closed trades
    (`analytics_included=True`, R-T3-T7-R3). Expectancy is THAT record's `expectancyR`, never
    recomputed here. The band (R-T3-V5: `too_few` | `thin` | `normal`, `sample_size`'s own) is the
    band of the count `expectancyR` rests on, the trades that carry an R: the record's
    `avgRStat.band` (R-T3-T7-R5, the R-T3-T5-R4 principle), never `tradeCount`'s; `sampleN` is that
    record's n, so the page prints the count the band describes. Setups that can be
    ranked (anything but `too_few`) come first, by expectancy R; a `too_few` setup cannot be ranked,
    so it only fills a slot the ranked setups leave open (the page says "Too few trades to rank").
  * tickers: MEMBER-WIDE whatever account is picked (R-T3-T7-R4: notes carry no account, and no
    other surface scopes notes by account), so the payload says `tickersScope: "all"`. Notes not in
    the trash (`deleted_at IS NULL`) created in the year, each counted ONCE per symbol
    over `j2_notes.ticker` and the `j2_note_mentions` projection (the cashtag sidecar
    `notes._sync_note_mentions` keeps; bodies are never re-parsed). Sample-notebook notes count
    nowhere (`sample_marker`, fin-data I3). Top 5.
    ONE RULE FOR TIER 3'S NOTE READERS (final fix M3): a note counts unless it is in the trash or is
    a sample-notebook note. An ARCHIVED note counts, here and in the By check-in view
    (`analytics._checkin_section`): archiving files a note away, it does not take back what it
    records. Railed by tests/test_wrapped.py, which runs both readers over one note set.
  * discipline: twelve months, Jan to Dec. A month's adherence is the mean `adherencePct` of the
    month's closed trades that HAVE a record, joined through `trader_blocks.adherence_of_trade`
    (THE one join, R-PF-N7) on the trade's ref. A month with trades and no records reads
    `adherence: None`, never 0 (`adherence_pct` is never NULL on a stored row, so None can only
    mean "no record"). `sampleN` is the number of RECORDS the mean rests on and `sample` its band
    (`sample_size.band`, final fix I2); the month's trade count is not in the row.
  * lessons: rule versions whose words changed within the year (`j2_journal_rule_versions`),
    newest first, at most TOP_LESSONS (R-T3-7). A dismissed rule is gone and teaches nothing.
    Each carries `changedDay`, the ET day it was put in the year by, so the page prints the day
    the bucket used rather than the UTC date of the stamp.

The year is the ET trading day throughout: a trade by the `filters.trades_where` day spine, a
note and a version by `timeutil.compute_trading_day_et` of their stamp. `available` is False for
the current ET year before December 1 and for any year with no closed trade; when False every
array is empty and `unavailableReason` says which (ruling R-T3-T8-R3): `"not_ready"` for the
current ET year before December 1 ET, whatever its trades (the plan's sentence is about the
calendar, so it wins when both apply), else `"no_trades"`. The page picks its sentence from it and
never from the device clock. The key is present only when `available` is False.

ISOLATION: every query is keyed on the member's id; `account_id` only narrows the member's OWN
trades and rules (never notes, see tickers), so another member's account id matches nothing.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from api.services.journal_two import (adherence_store, checklist_suggestions, playbook_stats, sample_marker,
                                      sample_size)
from api.services.journal_two.calendar import et_today
from api.services.journal_two.filters import _DAY, ANALYTICS_INCLUDED_SQL, FilterSpec, trades_where  # noqa: PLC2701 -- the ONE trading-day spine
from api.services.journal_two.timeutil import compute_trading_day_et
from api.services.journal_two.trade_refs import trade_ref_for_row
from api.services.journal_two.trader_blocks import adherence_of_trade
from api.services.notebook_flags import flag_on

#: The Tier 3 switch. One name for all of Tier 3: read from the module that declared it.
FLAG = checklist_suggestions.FLAG

#: The earliest year a member may ask for.
MIN_YEAR = 2000
#: The 400 sentence for a year outside MIN_YEAR .. the current ET year.
YEAR_UNAVAILABLE_SENTENCE = "That year isn't available."
#: The current year opens on this ET month and day.
OPENS_ON = "12-01"

TOP_SETUPS = 3
TOP_TICKERS = 5
TOP_LESSONS = 12
#: Tickers are member-wide whatever account is picked (R-T3-T7-R4); Task 8 labels it from this.
TICKERS_SCOPE = "all"


def enabled() -> bool:
    """Read per call through the one Notebook flag parse, never latched at import."""
    return flag_on(FLAG, False)


def current_et_year() -> int:
    return int(et_today()[:4])


def year_in_range(year: int) -> bool:
    return MIN_YEAR <= year <= current_et_year()


def _year_spec(year: int) -> FilterSpec:
    return FilterSpec(date_from=f"{year}-01-01", date_to=f"{year}-12-31")


def _in_year(stamp: str | None, year: int) -> bool:
    day = compute_trading_day_et(stamp) if stamp else None
    return bool(day) and day[:4] == str(year)


def _closed_trades(conn: sqlite3.Connection, user_id: str, year: int, account_id: str | None) -> list:
    """The year's closed trades, scoped, on the analytics inclusion rule."""
    frag, params = trades_where(_year_spec(year))
    sql = (f"SELECT id, external_id, source, position_id, {_DAY} AS day FROM j2_trades"
           " WHERE user_id = ? " + ANALYTICS_INCLUDED_SQL)
    args: list[Any] = [user_id]
    if account_id:
        sql += " AND account_id = ?"
        args.append(account_id)
    sql += " " + frag
    return conn.execute(sql, args + params).fetchall()


def _rank_key_sampled(rec: dict) -> tuple:
    """Expectancy R descending (None last); a tie goes to the larger R-bearing count (`sampleN`,
    the n the expectancy rests on), then the larger trade count, then the name."""
    e = rec["expectancyR"]
    return (e is None, -(e or 0.0), -rec["sampleN"], -rec["tradeCount"], rec["setup"])


def _best_setups(conn: sqlite3.Connection, user_id: str, year: int, account_id: str | None) -> list[dict]:
    records = playbook_stats.get_playbook_stats(user_id, account_id, spec=_year_spec(year), conn=conn,
                                                analytics_included=True)
    # The band AND its n come from ONE record, `avgRStat` (sample_size.mean_stat over the R-bearing
    # trades the expectancy rests on), so the label and the count printed beside it cannot drift.
    rows = [{"setup": r["setup"], "tradeCount": r["tradeCount"], "expectancyR": r["expectancyR"],
             "sample": r["avgRStat"]["band"], "sampleN": r["avgRStat"]["n"]} for r in records]
    ranked = sorted((r for r in rows if r["sample"] != "too_few"), key=_rank_key_sampled)
    unranked = sorted((r for r in rows if r["sample"] == "too_few"),
                      key=lambda r: (-r["tradeCount"], r["setup"]))
    return (ranked + unranked)[:TOP_SETUPS]


def _norm_symbol(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    sym = raw.strip().lstrip("$").strip().upper()
    return sym or None


def _tickers(conn: sqlite3.Connection, user_id: str, year: int) -> list[dict]:
    """Member-wide (R-T3-T7-R4): no account predicate, because notes are written without one."""
    # A one-day margin each side in SQL (created_at is a UTC stamp); the ET year is decided below.
    lo, hi = f"{year - 1}-12-31", f"{year + 1}-01-02"
    # fin-data I3: a sample-notebook note is an example to read, never a fact about the member.
    # Final fix M3: an archived note COUNTS, as it does in the By check-in view (one rule, see the
    # module docstring); only the trash (`deleted_at`) and the sample notebook leave a note out.
    where = ("n.user_id = ? AND n.deleted_at IS NULL"
             " AND n.created_at >= ? AND n.created_at < ? AND " + sample_marker.not_sample_sql("n"))
    args: list[Any] = [user_id, lo, hi]
    notes = {r["id"]: r for r in conn.execute(
        f"SELECT n.id, n.ticker, n.created_at FROM j2_notes n WHERE {where}", args).fetchall()
        if _in_year(r["created_at"], year)}
    symbols: dict[str, set[str]] = {nid: set() for nid in notes}
    for nid, r in notes.items():
        sym = _norm_symbol(r["ticker"])
        if sym:
            symbols[nid].add(sym)
    for m in conn.execute(
            "SELECT m.note_id, m.symbol FROM j2_note_mentions m JOIN j2_notes n"
            f" ON n.id = m.note_id AND n.user_id = m.user_id WHERE m.user_id = ? AND {where}",
            [user_id] + args).fetchall():
        sym = _norm_symbol(m["symbol"])
        if sym and m["note_id"] in symbols:
            symbols[m["note_id"]].add(sym)
    counts: dict[str, int] = {}
    for syms in symbols.values():
        for sym in syms:
            counts[sym] = counts.get(sym, 0) + 1
    ordered = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [{"symbol": s, "noteCount": n} for s, n in ordered[:TOP_TICKERS]]


def _discipline(conn: sqlite3.Connection, user_id: str, year: int, trades: list) -> list[dict]:
    adh = adherence_store.list_adherence_for_user(user_id, conn=conn)
    months: dict[str, list[float]] = {f"{year}-{m:02d}": [] for m in range(1, 13)}
    for t in trades:
        pcts = months.get((t["day"] or "")[:7])     # the SQL spine's own answer, never restated
        if pcts is None:
            continue
        rec = adherence_of_trade(adh.get, trade_ref_for_row(t), t["position_id"])
        if rec is not None and rec.get("adherencePct") is not None:
            pcts.append(float(rec["adherencePct"]))
    # Final fix I2: the mean rests on the RECORDS, so `sampleN` is the record count and `sample` its
    # band (sample_size's own); the month's trade count is not in the row, so it cannot be printed
    # beside a mean it does not describe.
    return [{"month": month,
             "adherence": round(sum(pcts) / len(pcts), 4) if pcts else None,
             "sample": sample_size.band(len(pcts)),
             "sampleN": len(pcts)}
            for month, pcts in months.items()]


def _lessons(conn: sqlite3.Connection, user_id: str, year: int, account_id: str | None) -> list[dict]:
    where = "r.user_id = ? AND r.status != 'dismissed'"
    args: list[Any] = [user_id]
    if account_id:
        where += " AND r.account_id = ?"
        args.append(account_id)
    rows = conn.execute(
        "SELECT v.rule_id, v.version, v.label, v.change_note, v.changed_at FROM j2_journal_rule_versions v"
        " JOIN j2_journal_rules r ON r.id = v.rule_id AND r.user_id = v.user_id"
        f" WHERE v.user_id = ? AND {where}", [user_id] + args).fetchall()
    out = [{"ruleId": r["rule_id"], "label": r["label"], "version": int(r["version"]),
            "changeNote": r["change_note"], "changedAt": r["changed_at"],
            "changedDay": compute_trading_day_et(r["changed_at"])}
           for r in rows if _in_year(r["changed_at"], year)]
    # R-P2b-2, read-only: a rule made before versions existed has no v1 row until something writes
    # it. Its v1 is its creation, so a rule made this year still counts, and this read writes nothing.
    for r in conn.execute(
            f"SELECT r.id, r.label, r.created_at FROM j2_journal_rules r WHERE {where} AND NOT EXISTS"
            " (SELECT 1 FROM j2_journal_rule_versions v WHERE v.rule_id = r.id AND v.user_id = r.user_id)",
            args).fetchall():
        if _in_year(r["created_at"], year):
            out.append({"ruleId": r["id"], "label": r["label"], "version": 1,
                        "changeNote": None, "changedAt": r["created_at"],
                        "changedDay": compute_trading_day_et(r["created_at"])})
    out.sort(key=lambda x: (x["changedAt"], x["version"], x["ruleId"]), reverse=True)
    return out[:TOP_LESSONS]


def years_with_trades(conn: sqlite3.Connection, user_id: str, account_id: str | None) -> list[int]:
    """The years the year page can open, newest first (Task 8, R-T3-V6): every year with a closed,
    analytics-included trade (the `_closed_trades` rule, without the year), on the same ET day
    spine, scoped to the member and, when picked, to one of the member's own accounts. A year
    outside `year_in_range` is left out, because `/{year}` would refuse it. The current year is
    listed like any other; whether it is open yet is the page's `available`, not this list's."""
    sql = f"SELECT DISTINCT substr({_DAY}, 1, 4) AS y FROM j2_trades WHERE user_id = ? " + ANALYTICS_INCLUDED_SQL
    args: list[Any] = [user_id]
    if account_id:
        sql += " AND account_id = ?"
        args.append(account_id)
    years = {int(r["y"]) for r in conn.execute(sql, args).fetchall()
             if isinstance(r["y"], str) and r["y"].isdigit()}
    return sorted((y for y in years if year_in_range(y)), reverse=True)


NOT_READY = "not_ready"
NO_TRADES = "no_trades"


def _empty(year: int, trade_count: int, reason: str) -> dict:
    return {"year": year, "tradeCount": trade_count, "bestSetups": [], "tickers": [],
            "tickersScope": TICKERS_SCOPE, "discipline": [], "lessons": [], "available": False,
            "unavailableReason": reason}


def year_wrapped(conn: sqlite3.Connection, user_id: str, year: int, account_id: str | None) -> dict:
    """{"year", "tradeCount", "bestSetups", "tickers", "tickersScope", "discipline", "lessons",
    "available"}, plus "unavailableReason" when "available" is False.
    The caller has checked `year_in_range`."""
    account_id = account_id or None
    today = et_today()
    trades = _closed_trades(conn, user_id, year, account_id)
    if year == int(today[:4]) and today[5:] < OPENS_ON:
        return _empty(year, len(trades), NOT_READY)     # the calendar wins, trades or not
    if not trades:
        return _empty(year, 0, NO_TRADES)
    return {
        "year": year,
        "tradeCount": len(trades),
        "bestSetups": _best_setups(conn, user_id, year, account_id),
        "tickers": _tickers(conn, user_id, year),
        "tickersScope": TICKERS_SCOPE,
        "discipline": _discipline(conn, user_id, year, trades),
        "lessons": _lessons(conn, user_id, year, account_id),
        "available": True,
    }

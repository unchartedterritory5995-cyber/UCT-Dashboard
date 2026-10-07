"""Journal 2.0 — reviews that write themselves (wave 13, lane 13F).

One click drafts a daily, weekly or monthly review's DATA: trades and P&L, the discipline
record, setup changes, links to plans/reviews/resurfaced notes, the best and worst trade (for
the client to freeze a chart of each), and the leak finder's findings. This module computes
that data; `app/src/pages/journal-2-0/lib/reviewDrafts.js` turns it into a note through the
Notebook's one create door (or appends it to the member's daily note, for the daily case) --
this module never writes a note itself, and nothing here is scheduled (no background drafts).

**Never a second authority.**
  * Period P&L: `coach_data_assembler._aggregate_trades`, the arithmetic Compass's own
    periods use, over the rows the draft itself selected -- never a reimplemented aggregate.
    (Reusing a sibling module's underscore-prefixed helper rather than restating its
    arithmetic is this codebase's own precedent -- 13B's `playbook_patterns.py` reuses
    `plan_grading._note_state_at` the same way.)
  * WHICH DAY A TRADE BELONGS TO (every period): `filters._DAY`, the trading-day spine
    (`trading_day_et`, falling back to the exit date for a row from before that column). Each
    draft fetches its trades ONCE on that spine and both the trade list and the numbers
    table (`coach_data_assembler._aggregate_trades` over those same rows) come from that one
    fetch, so they cannot count different trades. The verdict scorecard called below is
    already on the same spine. ⚰️ The daily fetch and `assemble_day` both windowed on
    `exit_date` between Eastern midnights, which files a date-only manual trade (stored at
    UTC midnight = 8 PM Eastern the day before) under the PREVIOUS day, while the scorecard
    in the same draft filed it under its own.
  * Setups: `playbook_stats.get_playbook_stats` (the all-time per-setup baseline).
  * Grades: 13A's `plan_grading.grade_payload`, called once per period trade -- and ONLY
    while plan grading's own switch is on. ⛔ That call FREEZES a first match into
    `j2_trade_plan_links` (R4). With review drafts armed and plan grading not, a draft froze
    plans the member could neither see nor Re-link. A feature never writes another feature's
    data while that feature is off: with the switch off no trade is graded, nothing is
    written, `discipline` is None and the client leaves that section out
    (`tests/test_review_drafts.py`, which also lists every caller of the matcher).
  * Leaks: `leak_finder.find_leaks`, a pure function of the enriched trade list below.
  * The SKIP-overridden dollar figure: `verdict_scorecard.get_verdict_scorecard`.
  * Compass text: read-only, from whatever `coach.list_eod_recaps` / `list_weekly_reviews`
    ALREADY HOLDS for the exact period -- never generated here. **No model client is reachable
    from this module or anything it imports.**

**The enriched trade dict** (built once per period by `_enrich_trades`, consumed by every
helper below and by `leak_finder.py`):

    id, tradeRef, symbol, side, shares, entryPrice, exitPrice, entryDate, exitDate,
    originalStop, setup, source, pnlDollarGross, fees, pnlDollarNet, rMultiple, result,
    hourEt, tradingDayEt, contextAtEntry, status, checks, entryContext, plan.

**Account scope, two conventions, reconciled once.** `coach_data_assembler` and this module's
own trade fetch both resolve a Compass-style account id (a real id, or the unified sentinel
`'_all_'`, via `resolve_account_scope`). `playbook_stats` and `verdict_scorecard` are NOT
Compass-scoped -- they read `None` as "every account" and would read the literal string
`'_all_'` as an account id that matches nothing. `_plain_account_id` converts between the two,
once, so every caller below uses the right one.
"""
from __future__ import annotations

import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from api.services.journal_two import coach, coach_data_assembler, entry_context, leak_finder, notes
from api.services.journal_two import playbook_stats, sample_size, verdict_scorecard
from api.services.journal_two.coach_scope import resolve_account_scope
from api.services.journal_two.filters import _DAY, FilterSpec  # noqa: PLC2701 -- the ONE trading-day spine
from api.services.journal_two.note_levels import note_link
from api.services.journal_two.plan_grading import (
    STATUS_MEMBER_NONE, STATUS_NEEDS_PICK, STATUS_PLANNED, STATUS_UNPLANNED,
    MatchScope, _prop_defs, grade_payload,
)
from api.services.journal_two.plan_grading import enabled as plan_grading_enabled
from api.services.journal_two.trade_refs import trade_ref_for_row
from api.services.journal_two.unified_coach import UNIFIED_ACCOUNT_ID
from api.services.notebook_flags import flag_on

FLAG = "NOTEBOOK_REVIEW_DRAFTS_ENABLED"

#: At most this many of a period's trades are graded against their plans in one draft (the
#: newest ones). Grading reads notes; this bounds one request. Every trade is still listed and
#: counted; `gradingCap` in the payload says how many were left ungraded.
MAX_GRADED_TRADES = 300

#: A Compass excerpt is quoted, never the whole thing -- a review note cites it, it does not
#: become it. Cut at a word boundary, never mid-word.
COMPASS_EXCERPT_MAX_CHARS = 420


def enabled() -> bool:
    """The gate, read per call through the one parser (unset = OFF)."""
    return flag_on(FLAG, False)


def _plain_account_id(account_id: str | None) -> str | None:
    """`None` for `playbook_stats` / `verdict_scorecard` (which read falsy as "every
    account"); the Compass sentinel never reaches them, where it would match nothing."""
    return None if account_id in (None, UNIFIED_ACCOUNT_ID) else account_id


# ── period boundaries ──────────────────────────────────────────────────────────────────────





# ⛔ EVERY PERIOD IS EASTERN TRADING DAYS (owner ruling, fin-data round 2). A draft's week is
# Monday through Friday and its month the first through the last day, each as TRADING DAYS on
# `filters._DAY` -- the same spine as the daily draft. ⚰️ Weekly and monthly used to window
# `exit_date` between UTC midnights: a trade closed Friday evening Eastern (already Saturday
# in UTC) fell out of its week, and one closed on the last evening of a month fell into the
# next month.

def _week_days(week_start: str) -> tuple[str, str]:
    """(Monday, Friday) of the trading week that starts on `week_start`, as ISO days."""
    start = datetime.fromisoformat(week_start).date()
    return start.isoformat(), (start + timedelta(days=4)).isoformat()


def _month_days(month_iso: str) -> tuple[str, str]:
    """(first day, last day) of the month, as ISO days."""
    year, mon = int(month_iso[:4]), int(month_iso[5:7])
    nxt = datetime(year + 1, 1, 1) if mon == 12 else datetime(year, mon + 1, 1)
    return f"{month_iso[:7]}-01", (nxt - timedelta(days=1)).date().isoformat()


# ── the windows COMPASS uses (read, never changed, in this lane) ─────────────────────────────
#
# A draft can quote what Compass said about the period. Compass picks its trades differently:
#   * weekly review -- `coach_data_assembler.assemble_week`: exit_date in
#     [Monday 00:00 UTC, Saturday 00:00 UTC);
#   * daily recap   -- `coach_data_assembler.assemble_day`: exit_date between Eastern
#     midnights.
# Both read the instant; a draft reads the trading day. They part for a trade closed in the
# evening Eastern (weekly) and for a date-only trade, stored at UTC midnight (daily). The two
# functions below are those windows, so `_compass_text` can tell whether Compass was talking
# about the same trades before quoting it.

def _compass_week_window(week_start: str) -> tuple[datetime, datetime]:
    start = datetime.fromisoformat(week_start).replace(tzinfo=timezone.utc)
    return start, start + timedelta(days=5)


def _compass_day_window(day_iso: str) -> tuple[datetime, datetime]:
    from zoneinfo import ZoneInfo
    start = datetime.combine(datetime.fromisoformat(day_iso).date(), datetime.min.time(),
                             tzinfo=ZoneInfo("America/New_York"))
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


# ── the raw fetch + enrichment ────────────────────────────────────────────────────────────


def _fetch_period_trades(
    conn: sqlite3.Connection, user_id: str, account_id: str, start_utc: datetime, end_utc: datetime,
) -> list[sqlite3.Row]:
    """Every closed equity trade in `[start_utc, end_utc)`, WITH its id. This is COMPASS's
    predicate (`coach_data_assembler._trades_in_range`: account scope, exit_date window,
    analytics_excluded), kept byte for byte so it answers one question: which trades did
    Compass count for a period? No draft selects its own trades with it any more."""
    ids = resolve_account_scope(conn, user_id, account_id)
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    return conn.execute(
        f"""
        SELECT id, symbol, side, shares, entry_price, exit_price, entry_date, exit_date,
               original_stop, setup, pnl_dollar, pnl_percent, r_multiple, result, fees,
               hour_et, trading_day_et, context_at_entry, source, external_id, account_id
          FROM j2_trades
         WHERE user_id = ? AND account_id IN ({marks})
           AND exit_date >= ? AND exit_date < ?
           AND (analytics_excluded IS NULL OR analytics_excluded = 0)
         ORDER BY exit_date ASC
        """,
        [user_id, *ids, start_utc.isoformat(), end_utc.isoformat()],
    ).fetchall()


def _fetch_day_trades(conn: sqlite3.Connection, user_id: str, account_id: str, day_iso: str) -> list[sqlite3.Row]:
    """Every closed equity trade whose TRADING DAY is `day_iso`."""
    return _fetch_days_trades(conn, user_id, account_id, day_iso, day_iso)


def _fetch_days_trades(conn: sqlite3.Connection, user_id: str, account_id: str,
                       first_day: str, last_day: str) -> list[sqlite3.Row]:
    """Every closed equity trade whose TRADING DAY is in `[first_day, last_day]` -- the ONE
    selection every draft uses (a day, a week, a month). The same columns, account scope and
    `analytics_excluded` rule as Compass's window above, selected on `filters._DAY` rather
    than an instant: a date-only trade has no instant to window on (its stored UTC midnight
    is the evening before in Eastern time), and an evening trade's instant is already the
    next UTC day."""
    ids = resolve_account_scope(conn, user_id, account_id)
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    return conn.execute(
        f"""
        SELECT id, symbol, side, shares, entry_price, exit_price, entry_date, exit_date,
               original_stop, setup, pnl_dollar, pnl_percent, r_multiple, result, fees,
               hour_et, trading_day_et, context_at_entry, source, external_id, account_id
          FROM j2_trades
         WHERE user_id = ? AND account_id IN ({marks})
           AND {_DAY} >= ? AND {_DAY} <= ?
           AND (analytics_excluded IS NULL OR analytics_excluded = 0)
         ORDER BY exit_date ASC
        """,
        [user_id, *ids, first_day, last_day],
    ).fetchall()


def _aggregate_rows(rows: list[sqlite3.Row]) -> dict[str, Any]:
    """The numbers table for exactly `rows`: `coach_data_assembler._aggregate_trades` (the
    arithmetic every period uses) over the rows the trade list itself was built from."""
    def num(v: Any) -> float | None:
        return float(v) if v is not None else None
    return coach_data_assembler._aggregate_trades([  # noqa: SLF001 -- precedented reuse, see module docstring
        {"result": r["result"], "r_multiple": num(r["r_multiple"]),
         "pnl_dollar": num(r["pnl_dollar"]), "pnl_percent": num(r["pnl_percent"])}
        for r in rows
    ])


def _enrich_trades(conn: sqlite3.Connection, user_id: str, rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    if not rows:
        return []
    grading = plan_grading_enabled()   # read once per draft; off = no grade, and NO write
    defs = _prop_defs(conn, user_id) if grading else []
    # ONE matching scope for the whole period (fin-security I-2): a ticker's notes are read
    # once however many trades it has, and "unplanned" is remembered between drafts. Grading is
    # also CAPPED at the newest `MAX_GRADED_TRADES` of the period; an older trade is listed and
    # counted in every dollar figure, but carries no grade -- and the payload says how many.
    scope = MatchScope(conn, user_id, defs=defs) if grading else None
    graded_ids = {r["id"] for r in rows[-MAX_GRADED_TRADES:]}
    if scope is not None:
        scope.preload([r for r in rows if r["id"] in graded_ids])
    shaped = [{"id": r["id"], "symbol": r["symbol"], "entryDate": r["entry_date"]} for r in rows]
    contexts = entry_context.contexts_for_trades(user_id, shaped, conn=conn) if entry_context.enabled() else {}
    out = []
    for r in rows:
        gross = float(r["pnl_dollar"])
        fees = float(r["fees"] or 0)
        payload = (grade_payload(conn, user_id, r, defs, with_candidates=False, scope=scope)
                   if grading and r["id"] in graded_ids
                   else {"status": None, "checks": None, "plan": None})
        out.append({
            "id": r["id"], "tradeRef": trade_ref_for_row(r), "symbol": r["symbol"], "side": r["side"],
            "shares": float(r["shares"]), "entryPrice": float(r["entry_price"]),
            "exitPrice": float(r["exit_price"]), "entryDate": r["entry_date"], "exitDate": r["exit_date"],
            "originalStop": float(r["original_stop"]) if r["original_stop"] is not None else None,
            "setup": r["setup"], "source": r["source"] if "source" in r.keys() else None,
            "pnlDollarGross": gross, "fees": fees, "pnlDollarNet": round(gross - fees, 4),
            "rMultiple": float(r["r_multiple"]) if r["r_multiple"] is not None else None,
            "result": r["result"],
            "hourEt": r["hour_et"] if "hour_et" in r.keys() else None,
            "tradingDayEt": r["trading_day_et"] if "trading_day_et" in r.keys() else None,
            "contextAtEntry": r["context_at_entry"],
            "status": payload["status"], "checks": payload.get("checks"),
            "entryContext": contexts.get(r["id"]),
            "plan": payload.get("plan"),
        })
    if scope is not None:
        scope.flush()
    return out


# ── the numbers section (period P&L -- one authority per period) ────────────────────────────


# Every period's numbers table is `_aggregate_rows` over the rows its own trade list was built
# from (above), so the list and the numbers cannot count different trades.

# ── discipline (13A reuse, framed by the period instead of a rolling window) ────────────────


def _rate(k: int, n: int) -> dict[str, Any]:
    return sample_size.rate_stat(k, n)


def _period_discipline(enriched: list[dict[str, Any]]) -> dict[str, Any]:
    planned = [t for t in enriched if t["status"] == STATUS_PLANNED and t["checks"]]
    unplanned = [t for t in enriched if t["status"] in (STATUS_UNPLANNED, STATUS_MEMBER_NONE)]
    needs_pick = [t for t in enriched if t["status"] == STATUS_NEEDS_PICK]

    def kept(check: str) -> dict[str, Any]:
        states = [t["checks"][check]["state"] for t in planned]
        k = sum(1 for s in states if s == "kept")
        return _rate(k, k + sum(1 for s in states if s == "missed"))

    tstates = [t["checks"]["target"]["state"] for t in planned]
    decided = [s for s in tstates if s in ("hit", "reached_not_taken", "not_reached")]
    return {
        "plannedCount": len(planned), "unplannedCount": len(unplanned), "needsPickCount": len(needs_pick),
        "planRate": _rate(len(planned), len(planned) + len(unplanned)),
        "entry": kept("entry"), "stop": kept("stop"), "size": kept("size"),
        "targetHitRate": _rate(tstates.count("hit"), len(decided)),
    }


# ── setup changes (playbook_stats is the all-time baseline) ────────────────────────────────


def _setup_changes(conn: sqlite3.Connection, user_id: str, account_id: str,
                   enriched: list[dict[str, Any]]) -> list[dict[str, Any]]:
    all_time = {
        r["setup"]: r
        for r in playbook_stats.get_playbook_stats(user_id, _plain_account_id(account_id), conn=conn)
    }
    by_setup: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for t in enriched:
        setup = (t.get("setup") or "").strip()
        if setup:
            by_setup[setup].append(t)
    out = []
    for setup, items in by_setup.items():
        rs = [t["rMultiple"] for t in items if t.get("rMultiple") is not None]
        period_stat = sample_size.mean_stat(rs)
        baseline = all_time.get(setup)
        all_time_avg_r = baseline["avgR"] if baseline else None
        delta = (
            round(period_stat["mean"] - all_time_avg_r, 4)
            if period_stat["mean"] is not None and all_time_avg_r is not None else None
        )
        out.append({
            "setup": setup, "periodTradeCount": len(items), "periodAvgRStat": period_stat,
            "allTimeAvgR": all_time_avg_r, "allTimeAvgRStat": baseline["avgRStat"] if baseline else None,
            "delta": delta,
        })
    out.sort(key=lambda r: (r["delta"] is None, -abs(r["delta"] or 0)))
    return out[:5]


# ── links: plans / reviews / resurfaced ─────────────────────────────────────────────────────

_REVIEW_TAGS = ("debrief", "weekly-review", "monthly-review")


def _plan_links(enriched: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out = []
    for t in enriched:
        plan = t.get("plan")
        note_id = plan.get("noteId") if plan else None
        if note_id and note_id not in seen:
            seen.add(note_id)
            out.append({
                "noteId": note_id, "noteTitle": plan.get("noteTitle") or "Untitled",
                "symbol": t["symbol"], "tradeRef": t["tradeRef"],
            })
    return out


def _prior_reviews(conn: sqlite3.Connection, user_id: str, before_day: str) -> list[dict[str, Any]]:
    """The member's own most recent review notes of each kind, before this period -- so a new
    draft can be read beside what the last one said. Best-effort: a notes-layer hiccup here
    must never break the draft itself."""
    out = []
    for tag in _REVIEW_TAGS:
        try:
            rows = notes.list_notes(user_id, tag=tag, date_to=before_day, sort="updated", limit=2, conn=conn)
        except Exception:  # noqa: BLE001 -- a links section is a courtesy, never a 500
            rows = []
        for n in rows or []:
            out.append({
                "noteId": n.get("id"), "title": n.get("title") or "Untitled",
                "tag": tag, "updatedAt": n.get("updatedAt"),
            })
    return out


def _resurfaced_notes(conn: sqlite3.Connection, user_id: str, start_day: str, end_day: str) -> list[dict[str, Any]]:
    """Notes the Awareness Engine's resurfacing (13D) brought back during this period, read
    straight from its ledger (`j2_note_resurface_fires`) -- never a second resurfacing scan."""
    try:
        rows = conn.execute(
            "SELECT DISTINCT f.note_id, f.version_id, f.kind, f.day_et, n.title"
            "  FROM j2_note_resurface_fires f"
            "  JOIN j2_notes n ON n.id = f.note_id AND n.user_id = f.user_id"
            " WHERE f.user_id = ? AND f.day_et >= ? AND f.day_et <= ? AND n.deleted_at IS NULL"
            " ORDER BY f.day_et DESC LIMIT 20",
            (user_id, start_day, end_day),
        ).fetchall()
    except sqlite3.OperationalError:
        return []  # the resurfacing ledger has never been created on this pod -- nothing fired
    out = []
    seen: set[str] = set()
    for r in rows:
        if r["note_id"] in seen:
            continue
        seen.add(r["note_id"])
        out.append({
            "noteId": r["note_id"], "title": r["title"] or "Untitled",
            "link": note_link(r["note_id"], r["version_id"]), "kind": r["kind"], "day": r["day_et"],
        })
    return out


# ── the best and worst trade (the client freezes a chart of each) ──────────────────────────


def _best_worst(enriched: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    graded = [t for t in enriched if t.get("rMultiple") is not None]
    if not graded:
        return None, None

    def shape(t: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": t["id"], "tradeRef": t["tradeRef"], "symbol": t["symbol"], "side": t["side"],
            "entryDate": t["entryDate"], "exitDate": t["exitDate"], "entryPrice": t["entryPrice"],
            "exitPrice": t["exitPrice"], "rMultiple": t["rMultiple"], "pnlDollar": t["pnlDollarNet"],
        }

    ordered = sorted(graded, key=lambda t: t["rMultiple"])
    worst_t, best_t = ordered[0], ordered[-1]
    best = shape(best_t)
    worst = shape(worst_t) if worst_t is not best_t else None
    return best, worst


# ── Compass text (quoted only if it exists; never generated here) ──────────────────────────


def _compass_excerpt(body: str | None, *, kind: str, created_at: Any) -> dict[str, Any] | None:
    text = (body or "").strip()
    if not text:
        return None
    if len(text) > COMPASS_EXCERPT_MAX_CHARS:
        cut = text.rfind(" ", 0, COMPASS_EXCERPT_MAX_CHARS)
        text = text[: cut if cut > 0 else COMPASS_EXCERPT_MAX_CHARS].rstrip() + "…"
    return {"text": text, "kind": kind, "createdAt": created_at}


def _same_period_or_omit(
    conn: sqlite3.Connection, user_id: str, account_id: str, period: str, rows: list[sqlite3.Row],
    compass: dict[str, Any] | None, *, day_iso: str | None = None, week_start: str | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """(the quote to show, or None) and (why it was left out, or None).

    ⛔ A QUOTE ABOUT A DIFFERENT SET OF TRADES IS NEVER SHOWN AS THE SAME PERIOD (owner ruling,
    fin-data round 2). Compass's text is quoted only when the trades Compass counted for the
    period are exactly the trades this draft lists. When they differ the quote is left out and
    the payload says so, with how many trades are in one and not the other and which window
    each uses. Nothing to quote means nothing to explain: (None, None)."""
    if compass is None:
        return None, None
    if period == "weekly" and week_start:
        window = _compass_week_window(week_start)
        theirs = "from Monday 00:00 to Saturday 00:00 UTC"
        ours = "Monday to Friday in Eastern time"
        what = "this week"
    elif period == "daily" and day_iso:
        window = _compass_day_window(day_iso)
        theirs = "by the clock time each trade closed, midnight to midnight Eastern"
        ours = "the trading day each trade belongs to"
        what = "this day"
    else:
        return compass, None
    compass_ids = {r["id"] for r in _fetch_period_trades(conn, user_id, account_id, *window)}
    draft_ids = {r["id"] for r in rows}
    if compass_ids == draft_ids:
        return compass, None
    draft_only, compass_only = len(draft_ids - compass_ids), len(compass_ids - draft_ids)
    n = draft_only + compass_only
    return None, {
        "draftOnly": draft_only, "compassOnly": compass_only,
        "compassWindow": theirs, "draftWindow": ours,
        "sentence": (f"Compass reviewed {what} {theirs}. This note covers {ours}. "
                     f"{n} trade{'' if n == 1 else 's'} {'is' if n == 1 else 'are'} in one and not the "
                     "other, so the Compass review is not quoted here."),
    }


def _compass_text(
    conn: sqlite3.Connection, user_id: str, account_id: str, period: str,
    *, day_iso: str | None = None, week_start: str | None = None,
) -> dict[str, Any] | None:
    if period == "daily" and day_iso:
        try:
            recaps = coach.list_eod_recaps(user_id=user_id, account_id=account_id, conn=conn)
        except Exception:  # noqa: BLE001 -- a missing/forgotten quote is not a draft failure
            recaps = []
        for r in recaps:
            if (r.get("metadata") or {}).get("day") == day_iso:
                return _compass_excerpt(r.get("body"), kind="eod_recap", created_at=r.get("created_at"))
    elif period == "weekly" and week_start:
        try:
            reviews = coach.list_weekly_reviews(user_id, account_id, conn=conn)
        except Exception:  # noqa: BLE001
            reviews = []
        for r in reviews:
            if (r.get("metadata") or {}).get("week_start") == week_start:
                return _compass_excerpt(r.get("body"), kind="weekly_review", created_at=r.get("created_at"))
    return None  # monthly has no Compass surface to quote


# ── assembly ─────────────────────────────────────────────────────────────────────────────


def _assemble(
    conn: sqlite3.Connection, user_id: str, account_id: str, period: str,
    enriched: list[dict[str, Any]], aggregates: dict[str, Any], *,
    range_: dict[str, str], compass: dict[str, Any] | None,
    compass_omitted: dict[str, Any] | None = None,
) -> dict[str, Any]:
    baseline = leak_finder.baseline_stats(enriched)
    spec = FilterSpec(date_from=range_["start"], date_to=range_["end"])
    try:
        vs_payload = verdict_scorecard.get_verdict_scorecard(
            user_id, _plain_account_id(account_id), spec=spec, conn=conn,
        )
    except Exception:  # noqa: BLE001 -- the scorecard is one detector's input, not the draft
        vs_payload = None
    leaks = leak_finder.find_leaks(enriched, baseline=baseline, verdict_scorecard=vs_payload)
    best, worst = _best_worst(enriched)
    return {
        "period": period,
        "range": range_,
        "tradeCount": len(enriched),
        "aggregates": aggregates,
        "discipline": _period_discipline(enriched) if plan_grading_enabled() else None,
        "setupChanges": _setup_changes(conn, user_id, account_id, enriched),
        "bestTrade": best,
        "worstTrade": worst,
        "links": {
            "plans": _plan_links(enriched),
            "reviews": _prior_reviews(conn, user_id, range_["start"]),
            "resurfaced": _resurfaced_notes(conn, user_id, range_["start"], range_["end"]),
        },
        "leaks": leaks,
        "leakCoverage": leak_finder.coverage(enriched),
        "gradingCap": ({"limit": MAX_GRADED_TRADES, "graded": min(len(enriched), MAX_GRADED_TRADES),
                        "ungraded": max(0, len(enriched) - MAX_GRADED_TRADES)}
                       if plan_grading_enabled() else None),
        "compassText": compass,
        "compassOmitted": compass_omitted,
        "baseline": baseline,
        "sample": sample_size.constants(),
    }


def build_daily_draft(conn: sqlite3.Connection, user_id: str, account_id: str, day_iso: str) -> dict[str, Any]:
    # ONE fetch, on the trading-day spine; the list and the numbers are both made from it.
    rows = _fetch_day_trades(conn, user_id, account_id, day_iso)
    enriched = _enrich_trades(conn, user_id, rows)
    aggregates = _aggregate_rows(rows)
    compass, omitted = _same_period_or_omit(
        conn, user_id, account_id, "daily", rows,
        _compass_text(conn, user_id, account_id, "daily", day_iso=day_iso), day_iso=day_iso)
    return _assemble(
        conn, user_id, account_id, "daily", enriched, aggregates,
        range_={"start": day_iso, "end": day_iso}, compass=compass, compass_omitted=omitted,
    )


def build_weekly_draft(conn: sqlite3.Connection, user_id: str, account_id: str, week_start: str) -> dict[str, Any]:
    first, last = _week_days(week_start)
    rows = _fetch_days_trades(conn, user_id, account_id, first, last)   # ONE fetch: list and numbers
    enriched = _enrich_trades(conn, user_id, rows)
    compass, omitted = _same_period_or_omit(
        conn, user_id, account_id, "weekly", rows,
        _compass_text(conn, user_id, account_id, "weekly", week_start=week_start), week_start=week_start)
    return _assemble(
        conn, user_id, account_id, "weekly", enriched, _aggregate_rows(rows),
        range_={"start": first, "end": last}, compass=compass, compass_omitted=omitted,
    )


def build_monthly_draft(conn: sqlite3.Connection, user_id: str, account_id: str, month_iso: str) -> dict[str, Any]:
    first, last = _month_days(month_iso)
    rows = _fetch_days_trades(conn, user_id, account_id, first, last)   # ONE fetch: list and numbers
    enriched = _enrich_trades(conn, user_id, rows)
    return _assemble(
        conn, user_id, account_id, "monthly", enriched, _aggregate_rows(rows),
        range_={"start": first, "end": last}, compass=None,
    )

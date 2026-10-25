"""Notebook widgets wave 10 (Task 10.11): ready-made trader widgets, computed on the server (II).

Three builders, each `(user_id: str, params: dict, now: datetime) -> dict`:

  * `my_plan_vs_actual` (`myPlanVsActual`, "Plan vs actual"): one closed trade the member owns,
    laid out against its frozen plan (`plan_grading.get_link`). Every number `grade_checks`
    computes is taken from it; the builder only lays the rows out. It follows the plan-grading
    switch (ruling W10-R38): off, it reads "Not available right now." and reads nothing.
  * `my_game_plan` (`myGamePlan`, "Pre-market game plan"): three parts that fail alone -- the
    morning wire (`trader_blocks.prep_part("wire")`), the member's names reporting today and last
    night (`prep_part("earnings")`, ruling W10-R39), and the open risk to stops over every account
    (`shelf_discipline.open_risk`, the one authority Risk left today also asks).
  * `my_alerts_fired` (`myAlertsFired`, "Alerts that fired"): both append-only fire logs since the
    previous finished session's close (ruling W10-R10), each row in the log's own words
    (ruling W10-R37).

Every payload carries `asOf`, `source` ("broker" / "manual" / "mixed") and `lines`, the member's
sentences in order. An unknown value is None, never 0, and no string shows `0`, `$0`, `0%`,
`"0 of"` or `"(0)"` where the honest answer is "none yet" (W9-R7).

The facts each figure follows:
  * Only the session member's rows (`user_id` on every read). A trade id that is not the member's
    own closed equity trade -- another member's, an unknown one, an option strategy's -- reads
    "Not available.", the same sentence for each, so the answer is never an oracle (W9-R18).
  * A plan link whose note is a sample note (`sample_marker.is_sample_note`) is not the member's
    plan: it reads as unlinked. Nothing here reads a note table itself.
  * Slippage is side-aware and signed so that POSITIVE is worse: a long filled above its plan, a
    short filled below it.
  * A stop that is a broker placeholder or unusable (`placeholder_stop.is_placeholder_stop`) reads
    "No stop set", never a 0 stop. In the game plan it is counted in `noStop` and is never zero
    risk.
  * Open risk counts EVERY open position, including those on no account or on an account that no
    longer exists (ruling W10-R34). Positions are read ONCE, for all accounts, through
    `shelf_discipline.read_open_positions` (at most 5,000, an overflow said so). "No open
    positions." only when no position and no open option strategy exists anywhere.
  * The game plan's reads are held-only (`prep_part` never fetches from a vendor).
  * Day boundaries: `since` is `close_time(session_on_or_before(today - 1))`, so the Monday after
    Good Friday reads from Thursday's close; a non-session day folds onto the session before, the
    trading-days scan's own fold (ruling W10-R35).
  * No options exit time is read anywhere in this module (Plan vs actual covers equity trades
    only), so `options.exit_is_date_only` has nothing to guard here.
  * Caps: each fire log is read with `limit=ALERT_READ_LIMIT` (50) and `ALERT_ROW_CAP` (40) rows
    are kept (W10-R10). A log whose read came back full with its oldest row still inside the
    window may hold more: the count reads "at least N" and the payload carries `capped`. Every SQL
    read here is bounded and runs under `run.deadline`.

Refusals are `ParamError` (`tool_errors.ToolError`, W9-R14), the ONE class, defined in the constants-only
`shelf_kind_names` and imported from there.

Every name taken from another module is public (Task 10.12): `notebook_widgets.iso_utc` / `num` /
`origin` (bound here under their old local names), and `alert_user_series.definition_label` (a member
formula's own name, the one rule `indicator_alert_service` reads it by too).
"""
from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable

from api.services import session_calendar
from api.services.journal_two import plan_grading, sample_marker, trading_days, widget_definitions
from api.services.journal_two import shelf_discipline
from api.services.journal_two.notebook_widgets import iso_utc as _iso_utc, num as _num, origin as _origin
from api.services.journal_two.shelf_kind_names import TITLES as KIND_TITLES, ParamError
from api.services.journal_two.trade_refs import trade_ref_for_row
from api.services.journal_two.widget_engine import plan as wplan

__all__ = ["ParamError", "PARAMS", "TITLES", "BUILDERS", "clean_params", "my_plan_vs_actual",
           "my_game_plan", "my_alerts_fired"]

# -- constants --------------------------------------------------------------------------------------

KIND_PLAN_VS_ACTUAL = "myPlanVsActual"
KIND_GAME_PLAN = "myGamePlan"
KIND_ALERTS_FIRED = "myAlertsFired"
#: The titles, from the constants leaf (Task 10.14: one authority for every dedicated title).
TITLES = {k: KIND_TITLES[k] for k in (KIND_PLAN_VS_ACTUAL, KIND_GAME_PLAN, KIND_ALERTS_FIRED)}
PARAMS = {
    KIND_PLAN_VS_ACTUAL: ("tradeId",),
    KIND_GAME_PLAN: (),
    KIND_ALERTS_FIRED: (),
}
#: Names reporting (today, and last night) shown at most, each.
REPORTING_MAX = 10
#: Each fire log is read with this limit (W10-R10).
ALERT_READ_LIMIT = 50
#: Rows kept in the alerts list (W10-R10).
ALERT_ROW_CAP = 40

# -- member sentences -------------------------------------------------------------------------------

S_NOT_AVAILABLE = "Not available."
S_NOT_AVAILABLE_NOW = "Not available right now."
S_PVA_UNLINKED = "This trade isn't linked to a plan. Link one from the trade's page."
S_NOT_IN_PLAN = "Not in the plan"
S_NO_STOP = "No stop set"

S_WIRE_NOT_YET = "The morning wire has not published yet today."
S_WIRE_UNREAD = "The morning wire couldn't be read right now."
S_EARNINGS_NONE = "None of your names report today."
S_EARNINGS_UNREAD = "Earnings dates couldn't be read right now."
S_NAMES_UNREAD = "Your names couldn't be read right now."
S_NAMES_SOME_UNREAD = "Some of your names couldn't be read right now."
S_RISK_UNREAD = shelf_discipline.S_RISK_UNREAD       # one authority for the sentence

S_ALERTS_EMPTY = "No alerts fired since the last session."
S_ALERTS_UNREAD = "Some alerts couldn't be read right now."
WHAT_FALLBACK = "Alert fired"

#: The earnings snapshot's gaps that mean "the read did not answer" (held cache empty, or a read
#: that failed). `no_names` is an answer: the member has no names, so none of them report.
_EARNINGS_UNREAD_GAPS = ("no_earnings_yet", "source_error")
#: Today's reporters: before today's open, after today's close.
_WHEN_TODAY = (("bmo", "before the open"), ("amcTonight", "after the close"))
#: The member's names read for the game plan (member_interest's sources, the firm's UCT 20 out).
_OWN_SOURCES_SKIP = ("uct20",)

#: An indicator fire's condition, in words (`alert_fired_log.CONDITION_KIND`'s keys). A condition
#: that names its own level carries no threshold in the text.
_CONDITION_WORDS = {
    "above": "above", "below": "below",
    "cross_above": "crossed above", "cross_below": "crossed below",
    "cross_zero": "crossed zero",
    "touch_upper": "touched the upper band", "touch_lower": "touched the lower band",
}
_NO_THRESHOLD = ("cross_zero", "touch_upper", "touch_lower")
#: The detail fields each S7 type's shape is built from: a fire whose detail holds none of them is
#: not shaped (the shape would fill the gaps with "filing" and "an unknown date").
_SHAPE_NEEDS = {"document-arrival": ("form", "filed", "company"),
                "rating-change": ("action", "to_grade", "from_grade")}


def _s_unknown_kind() -> str:
    return widget_definitions.S_NOT_FOUND


# -- small helpers ----------------------------------------------------------------------------------

def _utc(now: datetime | None) -> datetime:
    ts = now or datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def _deadline(conn: sqlite3.Connection):
    """`run.deadline` on `conn` (imported late: run.py imports the whole widget engine)."""
    from api.services.journal_two.widget_engine import run as wrun
    return wrun.deadline(conn)


def _connection() -> sqlite3.Connection:
    from api.services import auth_db
    return auth_db.get_connection()


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _price(v: float) -> str:
    """A price with cents: "$184.20", "$1,250.00"."""
    return f"${abs(v):,.2f}"


def _signed_pct(v: float) -> str:
    return f"{abs(v) * 100:.1f}%"


def _r_text(v: float) -> str:
    return f"{v:.1f}R"


# -- params -----------------------------------------------------------------------------------------

def clean_params(kind: str, raw: Any) -> dict:
    """The params a widget of `kind` keeps (`PARAMS`), checked; unknown keys are dropped and an
    empty value is absent. An unusable `tradeId` is absent (the builder then reads "Not
    available."), never a refusal: a refusal would tell one member that another's id exists."""
    if kind not in PARAMS:
        raise ParamError(_s_unknown_kind())
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    for key in PARAMS[kind]:
        v = src.get(key)
        if key == "tradeId":
            v = v if isinstance(v, str) and v and len(v) <= wplan.MAX_TEXT else None
        if v is not None:
            out[key] = v
    return out


# -- Plan vs actual ---------------------------------------------------------------------------------

def _not_available(now_dt: datetime) -> dict:
    return {"asOf": _iso_utc(now_dt), "source": _origin([]), "available": False,
            "tradeId": None, "rows": [], "lines": [S_NOT_AVAILABLE]}


def _excursion(c: sqlite3.Connection, user_id: str, ref: str) -> dict:
    """The trade's stored excursion (`excursions_store.get_excursion`, scoped), or {}."""
    from api.services.journal_two import excursions_store
    try:
        return excursions_store.get_excursion(user_id, ref, c) or {}
    except sqlite3.OperationalError:
        return {}


def _realized_r(t: sqlite3.Row, exc: dict) -> tuple[float | None, bool]:
    """(the trade's effective R, True when it is the excursion's true R): its stop-based
    `r_multiple`, else the stored true R (the `analytics._effective_r_map` rule, read, never
    recomputed)."""
    r = _num(t["r_multiple"]) if "r_multiple" in t.keys() else None
    if r is not None:
        return r, False
    tr = _num(exc.get("trueR"))
    return tr, tr is not None


def _entry_row(checks: dict, plan: dict, side: str, fill: float) -> dict:
    sign = 1.0 if side == "Long" else -1.0
    e = checks.get("entry") or {}
    planned = _num(e.get("planned")) if "planned" in e else _num(plan.get("entry"))
    actual = _num(e.get("actual")) if "actual" in e else _num(fill)
    out: dict[str, Any] = {"label": "Entry", "planned": planned, "actual": actual,
                           "slippage": None, "slippagePct": None, "state": e.get("state")}
    if planned is None:
        body = (f"{S_NOT_IN_PLAN}; filled at {_price(actual)}." if actual is not None
                else f"{S_NOT_IN_PLAN}.")
    else:
        # Positive slippage is worse: a long filled above its plan, a short filled below it.
        slip = sign * (actual - planned)
        pct = _num(e.get("deltaPct"))
        slip_pct = sign * pct if pct is not None else (slip / planned if planned else None)
        out.update(slippage=_num(slip), slippagePct=_num(slip_pct))
        head = f"Planned {_price(planned)}, filled {_price(actual)}"
        if round(slip, 2) == 0:
            body = f"{head}; filled at the plan."
        else:
            word = "worse" if slip > 0 else "better"
            pct_s = f" ({_signed_pct(slip_pct)})" if slip_pct is not None and round(
                abs(slip_pct) * 100, 1) else ""
            body = f"{head}; {_price(slip)}{pct_s} {word} than the plan."
    out["text"] = f"Entry: {body}"
    return out


def _stop_row(checks: dict, plan: dict, t: sqlite3.Row) -> dict:
    from api.services.placeholder_stop import is_placeholder_stop
    s = checks.get("stop") or {}
    planned = _num(s.get("planned")) if "planned" in s else _num(plan.get("stop"))
    raw = t["original_stop"]
    # A placeholder or unusable stop is "No stop set", never a 0 (or entry-priced) stop.
    actual = None if is_placeholder_stop(raw, t["entry_price"]) else _num(raw)
    head = f"Planned {_price(planned)}" if planned is not None else S_NOT_IN_PLAN
    if actual is None:
        body = f"{head}. {S_NO_STOP} on the trade."
    else:
        body = f"{head}{',' if planned is not None else ';'} your stop {_price(actual)}."
    return {"label": "Stop", "planned": planned, "actual": actual, "state": s.get("state"),
            "text": f"Stop: {body}"}


def _target_row(checks: dict, plan: dict, fill_exit: float) -> dict:
    g = checks.get("target") or {}
    planned = _num(g.get("planned")) if "planned" in g else _num(plan.get("target"))
    actual = _num(g.get("exit")) if "exit" in g else _num(fill_exit)
    if planned is None:
        body = f"{S_NOT_IN_PLAN}; exited at {_price(actual)}." if actual is not None else \
            f"{S_NOT_IN_PLAN}."
    else:
        body = f"Planned {_price(planned)}, exited at {_price(actual)}."
    state = g.get("state")
    # "unknown" (no excursion read) is not a state a member is shown: it is absent.
    return {"label": "Target", "planned": planned, "actual": actual,
            "state": None if state == "unknown" else state, "text": f"Target: {body}"}


def _r_row(checks: dict, plan: dict, realized: float | None, true_r: bool) -> dict:
    r_unit = _num(checks.get("r"))
    pe, pt = _num(plan.get("entry")), _num(plan.get("target"))
    planned = None
    if r_unit and pe is not None and pt is not None:
        planned = _num(abs(pt - pe) / r_unit)
    head = _r_text(planned) if planned is not None else S_NOT_IN_PLAN
    if realized is not None:
        tail = f"realized {_r_text(realized)}" + (" (true R)" if true_r else "")
    else:
        tail = "realized R not recorded"
    body = f"Planned {head}, {tail}." if planned is not None else f"{head}; {tail}."
    return {"label": "R", "planned": planned, "actual": realized,
            "source": ("trueR" if true_r else "stop") if realized is not None else None,
            "text": f"R: {body}"}


def _shares(v: float) -> str:
    return f"{v:,.0f}" if float(v) == int(v) else f"{v:,.4f}".rstrip("0").rstrip(".")


def _size_line(size: dict, closes: int) -> str:
    """"Size: planned 20 shares, entered 10." -- with the closes when the entry was closed in
    pieces (the trade page's `size_from_closes`)."""
    planned = float(size["planned"])
    text = (f"Size: planned {_shares(planned)} {'share' if planned == 1 else 'shares'}, entered "
            f"{_shares(float(size['actual']))}")
    if closes > 1:
        text += f" (closed in {closes} trades)"
    return text + "."


def my_plan_vs_actual(user_id: str, params: dict, now: datetime) -> dict:
    """One owned closed trade against its frozen plan: Entry, Stop, Target, R."""
    now_dt = _utc(now)
    p = clean_params(KIND_PLAN_VS_ACTUAL, params)
    if not plan_grading.enabled():                 # W10-R38: before any read
        return {**_not_available(now_dt), "lines": [S_NOT_AVAILABLE_NOW]}
    tid = p.get("tradeId")
    if not tid:
        return _not_available(now_dt)
    c = _connection()
    try:
        with _deadline(c):
            t = plan_grading.get_trade(c, user_id, tid)            # OWN-SCOPED: user_id AND id
            if t is None or t["exit_price"] is None or t["side"] not in ("Long", "Short"):
                return _not_available(now_dt)
            ref = trade_ref_for_row(t)
            link = plan_grading.get_link(c, user_id, ref)
            if link is not None and link.get("noteId") and sample_marker.is_sample_note(
                    c, user_id, link["noteId"]):
                link = None                                    # a sample is never the member's plan
            exc = _excursion(c, user_id, ref)
            # I-1: the shares ENTERED, from the one function the trade page's grading asks too.
            entered, closes = plan_grading.entered_shares(c, user_id, t)
    finally:
        c.close()
    base: dict[str, Any] = {"asOf": _iso_utc(now_dt), "source": _origin([t["source"]]),
                            "available": True, "tradeId": tid, "symbol": t["symbol"],
                            "side": t["side"], "rows": []}
    if link is None or link.get("sourceKind") == "none":
        base["lines"] = [S_PVA_UNLINKED]
        return base
    plan = link.get("plan") or {}
    trade = {"side": t["side"], "entryPrice": float(t["entry_price"]),
             "exitPrice": float(t["exit_price"]), "shares": float(t["shares"])}
    checks = plan_grading.grade_checks(plan, trade, mfe_price=_num(exc.get("mfePrice")),
                                       entered_shares=entered)
    realized, true_r = _realized_r(t, exc)
    rows = [_entry_row(checks, plan, t["side"], trade["entryPrice"]),
            _stop_row(checks, plan, t),
            _target_row(checks, plan, trade["exitPrice"]),
            _r_row(checks, plan, realized, true_r)]
    size = checks.get("size") or {}
    base.update(rows=rows, lines=[r["text"] for r in rows],
                followedPlan=checks.get("followedPlan"),
                size={k: size.get(k) for k in ("state", "planned", "actual", "deltaPct")})
    if size.get("state") in ("kept", "missed"):
        base["lines"].append(_size_line(size, closes))     # m-1: followedPlan counts size
    if checks.get("sideMismatch"):
        base["lines"].append("The plan's stop is on the other side of its entry for this trade.")
    return base


# -- Pre-market game plan ---------------------------------------------------------------------------

def _wire_part(user_id: str, now_dt: datetime, today: date, memo: dict) -> dict:
    from api.services.journal_two import trader_blocks
    out: dict[str, Any] = {"headline": None, "regime": None, "exposure": None, "wireDate": None}
    try:
        snap = trader_blocks.prep_part(user_id, "wire", now=now_dt, memo=memo)
    except Exception:  # noqa: BLE001 -- one part failing never fails the widget
        out["lines"] = [S_WIRE_UNREAD]
        return out
    snap = snap if isinstance(snap, dict) else {}
    if snap.get("missing") == "source_error":
        out["lines"] = [S_WIRE_UNREAD]
        return out
    out["wireDate"] = snap.get("wireDate") or None
    if snap.get("missing") or out["wireDate"] != today.isoformat():
        out["lines"] = [S_WIRE_NOT_YET]
        return out
    out.update(headline=snap.get("headline") or None, regime=snap.get("regime") or None,
               exposure=_num(snap.get("exposure")))
    lines = [out["headline"]] if out["headline"] else []
    if out["exposure"] is not None:
        lines.append(f"Exposure: {out['exposure']:g}%." if out["exposure"] else
                     "Exposure: none.")
    out["lines"] = lines or [S_WIRE_NOT_YET]
    return out


def _names_unread(memo: dict) -> tuple[bool, bool]:
    """(some of the member's own names could not be read, none of them could be), from the SAME read
    that produced today's and last night's lists: `trader_blocks._my_names` leaves the sources it
    could not read in the shared read budget (`trader_blocks.NAMES_FAILED`, fix round 2 M-3). No
    record means no names read was attempted or every source answered: nothing is said."""
    from api.services import member_interest
    from api.services.journal_two import trader_blocks
    own = [n for n in member_interest.SOURCES if n not in _OWN_SOURCES_SKIP]
    failed = {f for f in (memo.get(trader_blocks.NAMES_FAILED) or []) if f in own}
    none_read = bool(own) and failed >= set(own)
    return bool(failed) and not none_read, none_read


def _symbols(rows: Any) -> list[str]:
    out: list[str] = []
    for sym in rows if isinstance(rows, list) else []:
        s = str(sym or "").upper()
        if s and s not in out:
            out.append(s)
    return out


def _reporting_part(user_id: str, now_dt: datetime, today: date, memo: dict) -> dict:
    from api.services.journal_two import trader_blocks
    out: dict[str, Any] = {"names": None, "lastNight": None}
    try:
        snap = trader_blocks.prep_part(user_id, "earnings", now=now_dt, memo=memo)
    except Exception:  # noqa: BLE001
        out["lines"] = [S_EARNINGS_UNREAD]
        return out
    snap = snap if isinstance(snap, dict) else {}
    if snap.get("missing") in _EARNINGS_UNREAD_GAPS:
        out["lines"] = [S_EARNINGS_UNREAD]                  # the read did not answer
        return out
    some, none_read = _names_unread(memo)
    if none_read:
        out["lines"] = [S_NAMES_UNREAD]                     # one sentence, no lists (M3, M-3)
        return out
    names: list[dict] = []
    seen: set[str] = set()
    for key, when in _WHEN_TODAY:
        for s in _symbols(snap.get(key)):
            if s not in seen:
                seen.add(s)
                names.append({"symbol": s, "when": when})
    # W10-R39: last night's after-close reporters, their own list (not "today").
    last = [s for s in _symbols(snap.get("amc")) if s not in seen]
    out["names"] = names[:REPORTING_MAX]
    out["lastNight"] = last[:REPORTING_MAX]
    if len(names) > REPORTING_MAX:
        out["truncated"] = len(names) - REPORTING_MAX
    if len(last) > REPORTING_MAX:
        out["lastNightTruncated"] = len(last) - REPORTING_MAX
    lines: list[str] = []
    if names:
        lines += [f"{n['symbol']} reports {n['when']}." for n in out["names"]]
        if out.get("truncated"):
            lines.append(f"{_plural(out['truncated'], 'more name reports', 'more names report')}"
                         " today.")
    if last:
        more = (f", and {_plural(out['lastNightTruncated'], 'other', 'others')}"
                if out.get("lastNightTruncated") else "")
        lines.append(f"Reported last night: {', '.join(out['lastNight'])}{more}.")
    if not names:
        lines.insert(0, S_EARNINGS_NONE if not some else
                     f"{S_NAMES_SOME_UNREAD} None of the others report today.")
    elif some:
        lines.append(S_NAMES_SOME_UNREAD)                   # the list shown is not all of them
    out["lines"] = lines
    return out


def _risk_part(user_id: str) -> dict:
    """Open risk to stops over every account, positions read ONCE (W10-R34: a position on no
    account is in the total), through `shelf_discipline.open_risk`, the one authority Risk left
    today asks too: the same number and the same words for the same positions (I-3)."""
    out: dict[str, Any] = {"openPositions": None, "openRisk": None, "noStop": None,
                           "unread": None, "openOptions": None, "unlinked": None,
                           "riskLines": [], "sources": []}
    try:
        c = _connection()
        try:
            with _deadline(c):
                pos, capped = shelf_discipline.read_open_positions(user_id, c)
                ids = {r["id"] for r in c.execute(
                    "SELECT id FROM j2_accounts WHERE user_id = ? LIMIT 5001", (user_id,))}
                opts = int(c.execute(
                    "SELECT COUNT(*) FROM j2_option_strategies WHERE user_id = ? AND status = 'open'",
                    (user_id,)).fetchone()[0] or 0)
        finally:
            c.close()
        info = shelf_discipline.open_risk(user_id, pos, open_options=opts)
    except Exception:  # noqa: BLE001
        out["lines"] = [S_RISK_UNREAD]
        return out
    out["sources"] = [p.get("source") for p in pos]
    unlinked = sum(1 for p in pos if p.get("accountId") not in ids)
    out.update(openPositions=len(pos) or None, openRisk=info["risk"],
               noStop=info["noStop"] if pos else None, unread=info["unread"] or None,
               openOptions=opts or None, unlinked=unlinked if pos else None,
               riskLines=list(info["lines"]))
    lines: list[str] = []
    if capped:
        out["capped"] = True
        lines.append(shelf_discipline.positions_capped_line())
    if pos:
        lines.append(f"{_plural(len(pos), 'open position', 'open positions')}.")
    lines += info["lines"]
    if unlinked:
        lines.append(f"Includes {_plural(unlinked, 'position', 'positions')} not linked to an"
                     " account.")
    out["lines"] = lines
    return out


def my_game_plan(user_id: str, params: dict, now: datetime) -> dict:
    """The morning wire, my names reporting, my open risk: three parts that fail alone."""
    now_dt = _utc(now)
    clean_params(KIND_GAME_PLAN, params)
    today = trading_days.today_et(now_dt)
    memo: dict = {}                       # one read budget for both prep parts
    wire = _wire_part(user_id, now_dt, today, memo)
    reporting = _reporting_part(user_id, now_dt, today, memo)
    risk = _risk_part(user_id)
    sources = risk.pop("sources", [])
    return {
        "asOf": _iso_utc(now_dt),
        "source": _origin(sources),
        "day": today.isoformat(),
        "wire": wire,
        "reporting": reporting,
        "risk": risk,
        "lines": wire["lines"] + reporting["lines"] + risk["lines"],
    }


# -- Alerts that fired ------------------------------------------------------------------------------

def last_session_close(now: datetime) -> datetime:
    """The close of the previous finished session: `close_time(session_on_or_before(today - 1))`
    (13:00 ET on a half-day). The Monday after Good Friday reads from Thursday's close."""
    today = trading_days.today_et(_utc(now))
    day = trading_days.session_on_or_before(today - timedelta(days=1))
    close = session_calendar.close_time(day)
    if close is None:                       # a day the calendar does not cover: the weekday rule
        close = datetime(day.year, day.month, day.day, 16, 0, tzinfo=session_calendar.ET)
    return close.astimezone(timezone.utc)


def _iso_epoch(v: Any) -> str | None:
    f = _num(v)
    if f is None:
        return None
    return datetime.fromtimestamp(f, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _text(v: Any) -> str | None:
    return v.strip() if isinstance(v, str) and v.strip() else None


#: The most decimals a reading is widened to so that it never prints like its threshold.
_MAX_PLACES = 10
#: A member's own formula with no name of its own (never its `u_<hash>` id).
S_OWN_INDICATOR = "Your indicator"


def _places(v: float) -> int:
    """Thousands and up read whole (with separators); anything smaller reads to 2 decimals."""
    return 0 if abs(v) >= 1000 else 2


def _fig(v: float, places: int) -> str:
    """A figure with thousands separators, never exponent notation."""
    return f"{v:,.{places}f}"


def _pair(threshold: float | None, value: float | None) -> tuple[str | None, str | None]:
    """(threshold, reading) as text (fix round 2 M-2): no exponent, separators from 1,000, two
    decimals under 100, and widened together until two DIFFERENT numbers never print alike. A 0
    threshold reads "zero"."""
    pt = _places(threshold) if threshold is not None else 0
    pv = _places(value) if value is not None else 0
    if threshold is not None and value is not None and threshold != value:
        while _fig(threshold, pt) == _fig(value, pv) and max(pt, pv) < _MAX_PLACES:
            pt, pv = pt + 1, pv + 1
        if _fig(threshold, pt) == _fig(value, pv):
            # m-2: at the cap, the exact digits (fixed-point, never an exponent), so "never alike"
            # holds however close the two are.
            return ("zero" if threshold == 0 else _exact(threshold)), _exact(value)
    t = None if threshold is None else ("zero" if threshold == 0 else _fig(threshold, pt))
    return t, (None if value is None else _fig(value, pv))


def _exact(v: float) -> str:
    """The float's own shortest digits (`repr`), written fixed-point with separators."""
    return f"{Decimal(repr(float(v))):,f}"


def _member_formula_label(address: str, user_id: str | None, names: dict | None) -> str:
    """A member formula's own stored name, read for THAT member only (`user_definitions.get` is
    scoped by `user_id`); never its `u_<hash>` id."""
    from api.services import alert_user_series, user_definitions
    def_id = address.partition(".")[0]
    cache = names if names is not None else {}
    if def_id not in cache:
        label = None
        if user_id:
            try:
                row = user_definitions.get(user_id, def_id)
            except Exception:  # noqa: BLE001 -- an unreadable name is the plain words, never a failure
                row = None
            if row:
                got = alert_user_series.definition_label(row.get("definition") or {}, def_id)
                label = got if got and got != def_id else None
        cache[def_id] = label or S_OWN_INDICATOR
    return cache[def_id]


def _indicator_label(address: str, user_id: str | None, names: dict | None) -> str:
    """The indicator's own display label (`ALERT_LABELS`, the one the alert dropdown and the alert
    row read); a member formula's stored name; else the address in plain words, never a raw
    upper-cased address."""
    from api.services import alert_user_series
    from api.services import indicator_alert_evaluator as ev
    if address in ev.ALERT_LABELS:
        return ev.ALERT_LABELS[address]
    if alert_user_series.is_user_address(address) or address.startswith("u_"):
        return _member_formula_label(address, user_id, names)
    words = " ".join(w for w in address.replace(".", " ").replace("_", " ").split())
    return (words[:1].upper() + words[1:]) if words else S_OWN_INDICATOR


def _indicator_text(f: dict, *, user_id: str | None = None, names: dict | None = None) -> str:
    """An indicator or price fire in words, from the log's own fields (W10-R37, fix round 2 M-2):
    "RSI above 70.00 (71.00)". The label is the indicator's own; a condition that names its own level
    ("crossed zero", the bands) or needs no number (an event) carries no threshold; an event reads
    its own condition label alone; "Alert fired" only when the log says nothing usable."""
    from api.services import indicator_alert_evaluator as ev
    ind = _text(f.get("indicator"))
    cond = _text(f.get("condition"))
    if not ind or not cond:
        return WHAT_FALLBACK
    address = ev.resolve_address(ind)
    entry = next((c for c in ev.ALERT_CONDITIONS.get(address) or [] if c.get("value") == cond), None)
    if address in ev.EVENT_ADDRESSES and entry and _text(entry.get("label")):
        return entry["label"]                        # "Price crossed SAR this bar": its own words
    text = f"{_indicator_label(address, user_id, names)} " \
           f"{_CONDITION_WORDS.get(cond, cond.replace('_', ' '))}"
    needs = cond not in _NO_THRESHOLD and (entry is None or entry.get("needs_threshold", True))
    thr = _num(f.get("threshold")) if needs else None
    t, v = _pair(thr, _num(f.get("value")))
    if t is not None:
        text += f" {t}"
    elif needs:
        text += " its alert level"
    if v is not None:
        text += f" ({v})"
    return text


def _indicator_rows(user_id: str) -> list[dict]:
    from api.services import alert_fired_log
    out = []
    names: dict = {}                                 # one name read per member formula
    for f in alert_fired_log.list_fires(user_id, ALERT_READ_LIMIT):
        if str(f.get("user_id")) != str(user_id):
            continue                                        # belt and braces: the read is scoped
        out.append({"_t": _num(f.get("fired_at")), "symbol": _text(f.get("sym")),
                    "what": _indicator_text(f, user_id=user_id, names=names),
                    "kind": "indicator"})
    return out


def _shapers() -> dict:
    """trigger type -> the type's own public `alert_shape_for_fire` (imported late)."""
    from api.services.alert_taxonomy import document_arrival, rating_change
    return {document_arrival.TYPE_ID: document_arrival.alert_shape_for_fire,
            rating_change.TYPE_ID: rating_change.alert_shape_for_fire}


def _price_text(f: dict) -> str | None:
    """A watchlist price alert in words, from the fire's own stored detail (W10-R44): "Price above
    $100.00 ($101.25)". None when the detail names no level."""
    d = f.get("detail") if isinstance(f.get("detail"), dict) else {}
    level = _num(d.get("level"))
    level = level if level is not None else _num(d.get("target_price"))
    if level is None:
        return None
    words = _CONDITION_WORDS.get(str(d.get("direction") or ""), "reached")
    line = _LINE_WORDS.get(str(d.get("level_kind") or ""))      # m-4: a drawn line says so
    text = f"Price {words} {line} at {_price(level)}" if line else f"Price {words} {_price(level)}"
    hit = _num(f.get("triggering_value"))
    return text + (f" ({_price(hit)})" if hit is not None else "")


#: A price alert's `level_kind` (`price_level.KNOWN_LEVEL_KINDS`) that is a drawn line, in words.
_LINE_WORDS = {"trendline": "the trendline", "line": "the chart line"}
#: trigger type -> composes a fire's text from its own stored detail, after its shape and its
#: detail's title/message (the price alert has neither).
_COMPOSERS = {"price-level": _price_text}


def _taxonomy_text(f: dict, shapers: dict) -> str:
    """A filing, rating or price fire in its own words (W10-R37, W10-R44): the type's shape (built
    from the fire's frozen detail) -- its message, then its title -- then the detail's own title or
    message, then the words composed from the detail, then "Alert fired". A fire whose detail holds
    none of the fields its shape reads (`_SHAPE_NEEDS`) is not shaped: the shape would invent "an
    unknown date" for facts the log never held."""
    d = f.get("detail") if isinstance(f.get("detail"), dict) else {}
    shape = shapers.get(f.get("trigger_type"))
    if shape is not None and any(d.get(k) for k in _SHAPE_NEEDS.get(f.get("trigger_type"), ())):
        try:
            got = shape(f) or {}
            what = _text(got.get("message")) or _text(got.get("title"))
            if what:
                return what
        except Exception:  # noqa: BLE001 -- an unshapeable fire falls back, never fails the list
            pass
    what = _text(d.get("title")) or _text(d.get("message"))
    if what:
        return what
    compose = _COMPOSERS.get(f.get("trigger_type"))
    if compose is not None:
        try:
            what = compose(f)
        except Exception:  # noqa: BLE001
            what = None
    return what or WHAT_FALLBACK


def _taxonomy_rows(user_id: str) -> list[dict]:
    from api.services.alert_taxonomy import receipts
    shapers = _shapers()
    out = []
    # W10-R44: the member's watchlist price alerts too (no predicate row); this widget only.
    for f in receipts.list_fires_for_feed(user_id, limit=ALERT_READ_LIMIT,
                                          include_price_alerts=True):
        d = f.get("detail") if isinstance(f.get("detail"), dict) else {}
        sym = _text(d.get("ticker")) or _text(d.get("symbol")) or _text(f.get("entity_ref"))
        out.append({"_t": _num(f.get("fired_at")), "symbol": sym.upper() if sym else None,
                    "what": _taxonomy_text(f, shapers),
                    "kind": _text(f.get("trigger_type")) or "alert"})
    return out


def my_alerts_fired(user_id: str, params: dict, now: datetime) -> dict:
    """Both fire logs since the previous session's close, newest first, at most `ALERT_ROW_CAP`.
    Never `user_alerts` (the bell mirror, which also holds routine reminders: W10-R10)."""
    now_dt = _utc(now)
    clean_params(KIND_ALERTS_FIRED, params)
    since = last_session_close(now_dt)
    cut = since.timestamp()
    unread = capped = False
    kept: list[dict] = []
    for read in (_indicator_rows, _taxonomy_rows):
        try:
            rows = read(user_id)
        except Exception:  # noqa: BLE001 -- one log failing shows the other
            unread = True
            continue
        times = [r["_t"] for r in rows if r["_t"] is not None]
        if len(rows) >= ALERT_READ_LIMIT and times and min(times) >= cut:
            capped = True                                   # the read was full inside the window
        kept += [r for r in rows if r["_t"] is not None and r["_t"] >= cut]
    kept.sort(key=lambda r: r["_t"], reverse=True)
    shown = [{"at": _iso_epoch(r["_t"]), "symbol": r["symbol"], "what": r["what"],
              "kind": r["kind"]} for r in kept[:ALERT_ROW_CAP]]
    lines: list[str] = []
    if shown:
        if len(kept) > ALERT_ROW_CAP:
            lines.append(f"Showing the newest {ALERT_ROW_CAP} of {'at least ' if capped else ''}"
                         f"{len(kept)} alerts since the last session.")
        else:
            lines.append(f"{'At least ' if capped else ''}"
                         f"{_plural(len(kept), 'alert', 'alerts')} fired since the last session.")
    elif not unread:
        lines.append(S_ALERTS_EMPTY)
    if unread:
        lines.append(S_ALERTS_UNREAD)
    out: dict[str, Any] = {
        "asOf": _iso_utc(now_dt),
        "source": _origin([]),
        "since": _iso_utc(since),
        "rows": shown,
        "lines": lines,
    }
    if len(kept) > ALERT_ROW_CAP:
        out["truncated"] = len(kept) - ALERT_ROW_CAP
    if capped:
        out["capped"] = True
    return out


#: kind -> builder (the dedicated router, Task 10.12, dispatches on this).
BUILDERS: dict[str, Callable[[str, dict, datetime], dict]] = {
    KIND_PLAN_VS_ACTUAL: my_plan_vs_actual,
    KIND_GAME_PLAN: my_game_plan,
    KIND_ALERTS_FIRED: my_alerts_fired,
}

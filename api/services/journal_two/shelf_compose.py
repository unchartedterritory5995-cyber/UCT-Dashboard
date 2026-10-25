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

Refusals are `ParamError` (`tool_errors.ToolError`, W9-R14). It is the SAME class as
`shelf_discipline.ParamError`, imported, so the router catches one class; Task 10.12 re-homes it
in `shelf_kinds.py` and the import keeps working through the re-export.

Private names imported from other modules (for 10.12's tidy-up): `notebook_widgets._iso_utc` /
`_num` / `_origin`. Every other name used is public.
"""
from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from api.services import session_calendar
from api.services.journal_two import plan_grading, sample_marker, trading_days, widget_definitions
from api.services.journal_two import shelf_discipline
from api.services.journal_two.notebook_widgets import _iso_utc, _num, _origin
from api.services.journal_two.shelf_discipline import ParamError
from api.services.journal_two.trade_refs import trade_ref_for_row
from api.services.journal_two.widget_engine import plan as wplan

__all__ = ["ParamError", "PARAMS", "TITLES", "BUILDERS", "clean_params", "my_plan_vs_actual",
           "my_game_plan", "my_alerts_fired"]

# -- constants --------------------------------------------------------------------------------------

KIND_PLAN_VS_ACTUAL = "myPlanVsActual"
KIND_GAME_PLAN = "myGamePlan"
KIND_ALERTS_FIRED = "myAlertsFired"
TITLES = {
    KIND_PLAN_VS_ACTUAL: "Plan vs actual",
    KIND_GAME_PLAN: "Pre-market game plan",
    KIND_ALERTS_FIRED: "Alerts that fired",
}
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
    checks = plan_grading.grade_checks(plan, trade, mfe_price=_num(exc.get("mfePrice")))
    realized, true_r = _realized_r(t, exc)
    rows = [_entry_row(checks, plan, t["side"], trade["entryPrice"]),
            _stop_row(checks, plan, t),
            _target_row(checks, plan, trade["exitPrice"]),
            _r_row(checks, plan, realized, true_r)]
    base.update(rows=rows, lines=[r["text"] for r in rows],
                followedPlan=checks.get("followedPlan"))
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


def _names_unread(user_id: str) -> tuple[bool, bool]:
    """(some of the member's own names could not be read, none of them could be): asked only when
    the earnings answer came back empty, so "none of your names report" is never said about names
    that were never read (fix M3). `member_interest.interest_for`'s `failed`, the UCT 20 left out
    as in `trader_blocks._my_names`."""
    from api.services import member_interest
    try:
        got = member_interest.interest_for(user_id) or {}
    except Exception:  # noqa: BLE001 -- interest_for never raises; an unreadable read is unread
        return True, True
    failed = [f for f in got.get("failed") or [] if f not in _OWN_SOURCES_SKIP]
    if not failed:
        return False, False
    by = got.get("by_source") or {}
    have = any(by.get(n) for n in member_interest.SOURCES if n not in _OWN_SOURCES_SKIP)
    return True, not have


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
        some, none_read = _names_unread(user_id)
        if none_read:
            out["names"] = out["lastNight"] = None
            out["lines"] = [S_NAMES_UNREAD]                 # never "none of your names" (M3)
            return out
        lines.insert(0, S_EARNINGS_NONE if not some else
                     f"{S_NAMES_SOME_UNREAD} None of the others report today.")
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


def _level(v: float) -> str:
    """A threshold in words where a figure would read as a zero ("zero"), else the figure."""
    return "zero" if v == 0 else f"{v:g}"


def _reading(v: float) -> str:
    return f"{v:,.1f}" if abs(v) < 100 else f"{v:,.2f}"


def _indicator_text(f: dict) -> str:
    """An indicator or price fire in words, from the log's own fields (W10-R37): "RSI above 70
    (71.0)". A condition that names its own level ("crossed zero", the bands) carries no number
    for it; "Alert fired" only when the log says nothing usable."""
    ind = _text(f.get("indicator"))
    cond = _text(f.get("condition"))
    if not ind or not cond:
        return WHAT_FALLBACK
    words = _CONDITION_WORDS.get(cond, cond.replace("_", " "))
    text = f"{ind.upper()} {words}"
    thr = _num(f.get("threshold"))
    if thr is not None and cond not in _NO_THRESHOLD:
        text += f" {_level(thr)}"
    elif cond not in _NO_THRESHOLD:
        text += " its alert level"
    val = _num(f.get("value"))
    if val is not None:
        text += f" ({_reading(val)})"
    return text


def _indicator_rows(user_id: str) -> list[dict]:
    from api.services import alert_fired_log
    out = []
    for f in alert_fired_log.list_fires(user_id, ALERT_READ_LIMIT):
        if str(f.get("user_id")) != str(user_id):
            continue                                        # belt and braces: the read is scoped
        out.append({"_t": _num(f.get("fired_at")), "symbol": _text(f.get("sym")),
                    "what": _indicator_text(f), "kind": "indicator"})
    return out


def _shapers() -> dict:
    """trigger type -> the type's own public `alert_shape_for_fire` (imported late)."""
    from api.services.alert_taxonomy import document_arrival, rating_change
    return {document_arrival.TYPE_ID: document_arrival.alert_shape_for_fire,
            rating_change.TYPE_ID: rating_change.alert_shape_for_fire}


def _taxonomy_text(f: dict, shapers: dict) -> str:
    """A filing or rating fire in its own words (W10-R37): the type's shape (built from the fire's
    frozen detail) -- its message, then its title -- then the detail's own title or message, then
    "Alert fired". A fire whose detail holds none of the fields its shape reads (`_SHAPE_NEEDS`)
    is not shaped: the shape would invent "an unknown date" for facts the log never held."""
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
    return _text(d.get("title")) or _text(d.get("message")) or WHAT_FALLBACK


def _taxonomy_rows(user_id: str) -> list[dict]:
    from api.services.alert_taxonomy import receipts
    shapers = _shapers()
    out = []
    for f in receipts.list_fires_for_feed(user_id, limit=ALERT_READ_LIMIT):
        d = f.get("detail") if isinstance(f.get("detail"), dict) else {}
        sym = _text(d.get("ticker")) or _text(f.get("entity_ref"))
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

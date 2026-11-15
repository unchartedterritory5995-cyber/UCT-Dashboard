"""MD-1 kind `earnings.calendar` (owner: agent-md) — the market-wide earnings calendar, read from what UCT already built.

A thin, READ-ONLY adapter over the Calendar page's own week payload (api/routers/calendar.py `peek_week_payload`): the
current week's TTL cache / last-good ServeStale slot, or another week's range-week cache. It NEVER builds a week: a cold
build fans out to EarningsWhispers / Finviz scrapes, Finnhub + FMP range and per-day legs, the TBD-session resolver
(Nasdaq / SEC / Yahoo / EW per symbol), ForexFactory and the name / entity passes — far past a turn's provider budget.
A week UCT has not built is answered `unavailable` ("not loaded yet"), provider_calls 0. No refresh is kicked; the admin
refresh route is never reached. The Calendar page's own re-warm loop keeps the current week warm.

WHAT IT RETURNS (by construction): earnings rows only. The day buckets read are an ALLOW-LIST — `bmo`, `amc`, `tbd` —
so the payload's ForexFactory `econ` / `fed` rows can never appear, whatever the payload holds.
  * session: `bmo` / `amc` as the schedule says; a `tbd` row (no hour) is `unknown` — never guessed.
  * source, PER ROW: the provider that placed it (`src`, stamped where calendar.py builds the row: earningswhispers,
    finviz, finnhub, fmp, uct-wire, uct-roster, uct-actuals). A row built before the stamp existed is `unrecorded`.
    The envelope's `source` is the set of row sources actually returned (never a constant).
  * estimates are the consensus as UCT stored it; actuals ride along when the payload has them; `when` says past /
    today / upcoming against today's ET date, so a past date is never worded as upcoming.

TIME (MD-1 §3): `as_of` = the payload's own build time (calendar.py TERM-019), never fetched_at; a wire-built week is
dated, not timed (its date, as UTC midnight, with a note). `stale` when served from the last-good slot.
freshness `periodic`, or `historical` when every day of the week has passed.

Access: served only through the gateway (`POST /api/agent/data`, `require_admin_dark` → `require_paid`), and only while
UCT_AGENT_DATA=1 and `earnings.calendar` is in UCT_AGENT_DATA_KINDS (fail-closed). Not model-isolated (raw third-party
schedule data); the capability that reads it is LOCAL-ONLY (turn.LOCAL_ONLY_ACTIONS): the member sees the rows, a model
never does.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

KIND = "earnings.calendar"
SOURCE_NONE = "uct-calendar"            # an envelope with no rows has no row source: the calendar store itself
MAX_SYMBOLS = 50
MAX_LIMIT = 50
DEFAULT_LIMIT = 25
SESSIONS = ("bmo", "amc", "any")
#: the ONLY payload buckets read — earnings sessions. econ / fed (ForexFactory) are not in it, by construction.
ROW_BUCKETS = (("bmo", "bmo"), ("amc", "amc"), ("tbd", "unknown"))
_SESSION_ORDER = {"bmo": 0, "amc": 1, "unknown": 2}
_ET = ZoneInfo("America/New_York")
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SYM = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")

NOTE_SCHEDULE = "report dates and sessions are the company's or the provider's schedule and can change"
NOTE_ESTIMATES = "estimates are the consensus as UCT stored it, not a dated pre-report snapshot"
NOTE_COLD = ("UCT has not loaded the earnings calendar for the week of {monday} yet, so nothing is read for it "
             "(opening that week on the Calendar page loads it)")
NOTE_RANGE = "the week of {monday} is outside UCT's earnings calendar range (52 weeks either side of this week)"
NOTE_FAILED = "UCT's earnings calendar for the week of {monday} could not be built from its providers"
NOTE_EMPTY = "UCT's earnings calendar for the week of {monday} holds no reporters, which means its build failed"
NOTE_STALE = ("this is the last good calendar UCT built ({minutes} minutes ago); a newer build is pending, so very "
              "recent schedule changes may be missing")
NOTE_DEGRADED = "the calendar build was missing a provider, so some reporters or sessions may be absent"
NOTE_WIRE = "this week was built from UCT's morning wire, which is dated, not timed"
NOTE_NO_ASOF = "the build time of this calendar is not recorded"
NOTE_NOT_ON = "not on UCT's calendar for that window: {syms} (this is not proof they don't report)"
NOTE_SESSION_EXCLUDED = "{n} reporter{s} with an unconfirmed session (no hour given) {were} left out of the {sess} filter"
NOTE_TRUNCATED = "{shown} of {total} reporters are shown (limit {limit})"
NOTE_DATE_EST = "{n} report date{s} {are} a provider projection, not a confirmed date"
NOTE_NO_ROWS = "no reporters on UCT's calendar for {window} match this request"
NOTE_PAST = "dates before today ({today}) have already passed; their rows are reported results, not upcoming reports"


def _cal():
    from api.routers import calendar as cal
    return cal


def now_et() -> datetime:
    return datetime.now(_ET)


def _iso_day(v) -> Optional[date]:
    if not isinstance(v, str) or not _ISO.match(v):
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check: the request's SHAPE only."""
    if not isinstance(params, dict):
        return "params must be an object"
    if params.get("date") is not None and _iso_day(params.get("date")) is None:
        return "`date` must be a YYYY-MM-DD day"
    if params.get("week") is not None and _iso_day(params.get("week")) is None:
        return "`week` must be a YYYY-MM-DD day (any day of that week)"
    if params.get("date") is not None and params.get("week") is not None:
        return "give `date` or `week`, not both"
    syms = params.get("symbols")
    if syms is not None:
        if not isinstance(syms, list) or not syms:
            return "`symbols` must be a list of 1-50 tickers"
        if len(syms) > MAX_SYMBOLS:
            return f"at most {MAX_SYMBOLS} symbols per read"
        if not all(isinstance(s, str) and _SYM.match(s.strip().upper() or "!") for s in syms):
            return "each symbol must be a ticker"
    if params.get("session", "any") not in SESSIONS:
        return "`session` must be bmo, amc or any"
    limit = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_LIMIT:
        return f"`limit` must be a whole number from 1 to {MAX_LIMIT}"
    return None


def _as_of(payload: dict, notes: list) -> Optional[str]:
    raw = payload.get("as_of")
    if isinstance(raw, str) and raw:
        if _ISO.match(raw):                                     # a wire-built week: dated, not timed
            notes.append(NOTE_WIRE)
            d = date.fromisoformat(raw)
            return env.utc_iso(datetime(d.year, d.month, d.day, tzinfo=timezone.utc))
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return env.utc_iso(dt)
        except ValueError:
            pass
    notes.append(NOTE_NO_ASOF)
    return None


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _rows_of(payload: dict, only_day: Optional[str], today: date) -> list[dict]:
    out = []
    days = payload.get("days") if isinstance(payload.get("days"), dict) else {}
    for ds in sorted(days):
        d = _iso_day(ds)
        day = days[ds]
        if d is None or not isinstance(day, dict) or (only_day and ds != only_day):
            continue
        when = "past" if d < today else "today" if d == today else "upcoming"
        for bucket, session in ROW_BUCKETS:                     # the allow-list: earnings buckets only
            for r in day.get(bucket) or []:
                if not isinstance(r, dict) or not isinstance(r.get("sym"), str) or not r["sym"]:
                    continue
                src = r.get("src")
                out.append({
                    "symbol": r["sym"].upper(), "name": r.get("name") if isinstance(r.get("name"), str) else None,
                    "date": ds, "when": when, "session": session,
                    "eps_est": _num(r.get("eps_est")), "rev_est_m": _num(r.get("rev_est")),
                    "eps_act": _num(r.get("eps_act")), "rev_act_m": _num(r.get("rev_act")),
                    "date_estimated": r.get("date_est") is True,
                    "source": src if isinstance(src, str) and src else "unrecorded",
                    "_mc": _num(r.get("mc_b")) or 0,
                })
    return out


def read_earnings_calendar(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE_NONE, why)
    today = now_et().date()
    only_day = params.get("date")
    anchor = _iso_day(only_day or params.get("week"))
    peek = _cal().peek_week_payload(anchor)                    # READ-ONLY: never a build, never a provider call
    monday = peek["monday"]
    if peek["state"] == "out_of_range":
        return env.unavailable(KIND, params, SOURCE_NONE, NOTE_RANGE.format(monday=monday))
    payload = peek.get("payload")
    if peek["state"] == "cold" or not isinstance(payload, dict):
        return env.unavailable(KIND, params, SOURCE_NONE, NOTE_COLD.format(monday=monday))
    src = str(payload.get("source") or "")
    if src in ("", "error", "out_of_range") or src.startswith("range_error"):
        return env.unavailable(KIND, params, SOURCE_NONE, NOTE_FAILED.format(monday=monday))
    if not _cal()._weekly_payload_is_good(payload):
        return env.unavailable(KIND, params, SOURCE_NONE, NOTE_EMPTY.format(monday=monday))

    notes = [NOTE_SCHEDULE, NOTE_ESTIMATES]
    as_of = _as_of(payload, notes)
    stale = peek["state"] == "stale"
    if stale:
        notes.append(NOTE_STALE.format(minutes=int((peek.get("age_s") or 0) // 60)))
    if (payload.get("earnings_quality") or {}).get("degraded"):
        notes.append(NOTE_DEGRADED)

    rows = _rows_of(payload, only_day, today)
    want = [s.strip().upper() for s in params.get("symbols") or []]
    want = list(dict.fromkeys(want))
    not_on: list[str] = []
    if want:
        have = {r["symbol"] for r in rows}
        not_on = [s for s in want if s not in have]
        rows = [r for r in rows if r["symbol"] in set(want)]
    session = params.get("session", "any")
    excluded = {"unknown": 0, "other": 0}
    if session != "any":
        keep = []
        for r in rows:
            if r["session"] == session:
                keep.append(r)
            elif r["session"] == "unknown":
                excluded["unknown"] += 1
            else:
                excluded["other"] += 1
        rows = keep
        if excluded["unknown"]:
            n = excluded["unknown"]
            notes.append(NOTE_SESSION_EXCLUDED.format(n=n, s="" if n == 1 else "s", were="was" if n == 1 else "were",
                                                      sess=session))
    rows.sort(key=lambda r: (r["date"], _SESSION_ORDER[r["session"]], -r["_mc"], r["symbol"]))
    total = len(rows)
    limit = params.get("limit", DEFAULT_LIMIT)
    shown = rows[:limit]
    for r in shown:
        r.pop("_mc", None)
    if total > limit:
        notes.append(NOTE_TRUNCATED.format(shown=limit, total=total, limit=limit))
    est = sum(1 for r in shown if r["date_estimated"])
    if est:
        notes.append(NOTE_DATE_EST.format(n=est, s="" if est == 1 else "s", are="is" if est == 1 else "are"))
    if any(r["when"] == "past" for r in shown):
        notes.append(NOTE_PAST.format(today=today.isoformat()))
    if not_on:
        notes.append(NOTE_NOT_ON.format(syms=", ".join(not_on)))
    if not total and not want:
        notes.append(NOTE_NO_ROWS.format(window=only_day or f"the week of {monday}"))

    sources = sorted({r["source"] for r in shown})
    days = sorted((payload.get("days") or {}).keys())
    last_day = _iso_day(days[-1]) if days else None
    freshness = "historical" if last_day is not None and last_day < today else "periodic"
    data = {"week_start": payload.get("week_start") or monday, "week_end": payload.get("week_end"),
            "date": only_day, "session": session, "rows": shown, "total": total, "truncated": total > limit,
            "excluded": excluded, "not_on_calendar": not_on, "sources": sources, "today": today.isoformat()}
    return env.make_envelope(KIND, params, status="partial" if not_on else "ok", freshness=freshness, as_of=as_of,
                             source="+".join(sources) if sources else SOURCE_NONE, data=data, stale=stale,
                             notes=notes, provider_calls=0,
                             coverage={"requested": len(want), "answered": len(want) - len(not_on)} if want else None)

"""MD-1 kind `short.interest` (owner: terminal-data, data wave 5) — one stock's FINRA short interest, in one read.

One stock's newest short interest report (settlement date, shares short, days to cover, average daily volume, the
change from the report before), short interest as a percent of float, the newest reports of its history and the newest
days of its daily short volume: the Agent half of the SHINT terminal panel
(app/src/pages/terminal/panels/shortInterestModel.js), over the answer behind `GET /api/research/short-data/{ticker}`
(api/services/short_data.py).

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The member route's `get_stock` never builds on
the request, but with nothing held it STARTS the service's one background build for the stock (two vendor requests) and
waits on it. A turn must not start that, so this adapter never calls `get_stock`. It reads `short_data.held_stock`, the
service's own read-only accessor:
  * the held answer, inside its freshness                                   → `held: "fresh"`;
  * else the last good answer, past its freshness and still servable        → `held: "last_good"`, and the read is `stale`;
  * else nothing is held                                                     → `unavailable`, with the reason.
provider_calls is always 0. A rail counts builds, threads and vendor requests through the real service state with
nothing held, and shows the route's own reader starting one in the same state.

WHAT A HELD ANSWER CAN SAY, each kept apart (the service's own states):
  * `ok`            at least one of the two datasets answered. Each dataset carries its own state: `ok`; `none` (the
                    vendor answered and has no rows for this stock: a healthy answer, said in a note); `unavailable`
                    (the vendor refused this site's key, or the server has no key) or `failed` (a failed read, or rows
                    that could not be read). One dataset `unavailable` or `failed` beside a healthy one is `partial`;
  * `unavailable`   the vendor refused BOTH datasets (the data plan), or the server has no key: `unavailable`, with the
                    reason, never "no short interest";
  * `failed`        the service's last read failed: `unavailable`, with the reason;
  * `bad_symbol`    not a US stock or fund symbol: refused before any read by `validate` (the service's own rule).
`computing` is the member route's word for "nothing held, a build is running": this read never starts or waits on one,
so it is the nothing-held answer here.

EVERY NUMBER IS THE SERVICE'S OWN. Nothing is re-derived here. A number that does not exist is null, never 0: no days
to cover, no average volume, no change (no report before, or a report before of zero shares), no float, no percent of
float (and a percent the service withheld is null with `withheld` true), no total volume and no ratio are each null.

THE CUT IS STATED: at most `reports` reports and `days` days of short volume, the NEWEST of each, with how many the
server holds beside them and a note naming both and saying the older ones are the ones left out.

TIME (MD-1 §3): `as_of` = the SETTLEMENT DATE of the newest report, as the start of that Eastern day (a date, not a
time of day; a note says so). It is never today: FINRA collects short interest twice a month and publishes it about two
weeks later. When UCT read the vendor is a read time: it rides as `data.read_at`. With no report in the answer `as_of`
is null with a note. Every read is `historical` (a settled report and completed sessions); the kind is DECLARED
`periodic`, the less fresh read being allowed.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the data is FINRA's, licensed to UCT through its market-data vendor
for display to members (docs/terminal-research/09-security-licensing-cost/licensing-register.md, rows T-93 and T-94),
and no row of that register clears it for a model provider. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

KIND = "short.interest"
SOURCE = "uct-short-data"
#: the reports and the short volume days one read carries: the SHINT panel's own first draw and its "Show more" step
#: (shortInterestModel.js REPORTS_SHOWN / REPORTS_MORE / VOLUME_DAYS_SHOWN), and the service's own window (SV_DAYS)
DEFAULT_REPORTS = 12
MAX_REPORTS = 24
DEFAULT_DAYS = 10
MAX_DAYS = 60
HELD = ("fresh", "last_good")
#: one dataset's state, by the service's own words
SECTION_STATES = ("ok", "none", "unavailable", "failed")
FLOAT_STATES = ("ok", "stale", "missing")
#: a report's and a short volume day's fields, by the service's own names
REPORT_FIELDS = ("settlement_date", "short_interest", "avg_daily_volume", "days_to_cover", "change_shares", "change_pct")
DAY_FIELDS = ("date", "short_volume", "total_volume", "short_volume_ratio")
FLOAT_FIELDS = ("shares", "pct_float", "withheld", "state", "source")
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ET = ZoneInfo("America/New_York")

NOTE_WHAT = ("FINRA short interest for {sym}: the shares sold short and not yet covered as of each settlement date, "
             "newest report first, each with the change from the report before it; days to cover is the data vendor's "
             "own figure (shares short against the average daily volume); FINRA's data, read through UCT's market-data "
             "vendor")
NOTE_LAG = ("FINRA collects short interest twice a month and publishes it about two weeks later, so a report is "
            "already about two weeks old when it is published; the newest one here is for {date}, never today")
NOTE_PUBLISHED = ("the day FINRA published the report is not in the vendor's answer; by FINRA's schedule (after the "
                  "close on the 7th business day after the settlement date) it was {estimate}, an estimate")
NOTE_AS_OF = ("as_of is the settlement date of the newest report (a date, not a time of day); UCT read it from the "
              "data vendor at {at}")
NOTE_NO_AS_OF = ("no short interest report is in this answer, so as_of is not given; UCT read the data vendor at "
                 "{at}")
NOTE_NO_READ_TIME = "the held answer carries no read time, so its age is unknown"
NOTE_LAST_GOOD = ("this is the last good answer for {sym}, older than the {hours} hours it is normally kept, so a "
                  "report or a day of short volume published since is missing")
NOTE_VOLUME = ("daily short volume is NOT short interest: it counts the shares sold short in one day's off-exchange "
               "trades only (not exchange trades), most of them bought back the same day, and says nothing about how "
               "many shares are still held short")
NOTE_FLOAT = ("percent of float divides the settlement date's short interest by TODAY's float from the nightly "
              "screener export, so the two figures are from different days")
NOTE_FLOAT_MISSING = "no float is on file for {sym}, so no percent of float is given; that is not 0%"
NOTE_FLOAT_WITHHELD = ("short interest is more than {max}% of the float on file for {sym}, so the two figures do not "
                       "describe the same share count (a split or an offering since the settlement date) and the "
                       "percent of float is withheld")
NOTE_FLOAT_STALE = "the screener export the float comes from is older than usual, so the float may be behind"
NOTE_HISTORY_CUT = ("the server read the newest {n} reports and the data vendor holds older ones, so the history "
                    "stops at {first}; the older reports are the ones not read")
NOTE_REPORTS_CUT = "showing the newest {n} of the {total} reports the server holds; the older ones are left out"
NOTE_DAYS_CUT = ("showing the newest {n} of the {total} days of short volume the server holds; the older ones are "
                 "left out")
NOTE_NO_REPORTS = ("the data vendor answered and holds no short interest report for {sym}; that is a healthy answer, "
                   "not a failed read, and it is not zero shares short")
NOTE_NO_VOLUME = ("the data vendor answered and holds no daily short volume for {sym}; that is a healthy answer, not "
                  "a failed read")
NOTE_SECTION_REFUSED = ("{what} is not given: the data vendor refused it for this site's key when the server last "
                        "asked (the data plan); that is not the same as none")
NOTE_SECTION_NO_KEY = ("{what} is not given: this server has no key for the data vendor; that is not the same as "
                       "none")
NOTE_SECTION_FAILED = ("{what} is not given: the server's last read of it failed, or its rows could not be read; "
                       "that is not the same as none")
NOTE_NOT_HELD = ("no short interest answer for {sym} is held on the server (one is kept {hours} hours after the Short "
                 "interest panel reads that stock, and a last good copy {extra} hours more), and this read never "
                 "starts a vendor read; that is not the same as no short interest")
NOTE_REFUSED = ("the data vendor refused both short interest and daily short volume for this site's key when the "
                "server last asked for {sym} (the data plan), and this read never asks again; that is not the same "
                "as no short interest")
NOTE_NO_KEY = ("this server has no key for the data vendor, so short interest for {sym} could not be read; that is "
               "not the same as no short interest")
NOTE_READ_FAILED = ("the server's last read of short interest for {sym} from the data vendor failed, and this read "
                    "never starts another; that is not the same as no short interest")
NOTE_BAD_SYMBOL = "{sym} is not a US stock or fund symbol, so there is no short interest to read"
NOTE_FAILED = "the short interest answer could not be read for {sym}"
#: what each dataset is called in a note
SECTION_WORDS = {"interest": "short interest", "volume": "daily short volume"}


def _clean(raw: Any) -> Optional[str]:
    """A typed ticker in the house form, by the service's own rule (`short_data.clean_symbol`), or None."""
    from api.services import short_data as svc
    return svc.clean_symbol(raw) if isinstance(raw, str) else None


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    if _clean(params.get("symbol")) is None:
        return "`symbol` must be one US stock or fund ticker"
    for name, most, default in (("reports", MAX_REPORTS, DEFAULT_REPORTS), ("days", MAX_DAYS, DEFAULT_DAYS)):
        n = params.get(name, default)
        if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= most:
            return f"`{name}` must be a whole number from 1 to {most}"
    return None


def held_answer(sym: str) -> tuple[Optional[dict], str]:
    """(the answer the service already holds for this stock, how it is held), WITHOUT starting or waiting on a build."""
    from api.services import short_data as svc
    return svc.held_stock(sym)


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
        return None
    return float(v)


def _whole(v: Any) -> Optional[int]:
    """A count of shares: a finite number that is not negative, as an int. Anything else is null, never 0."""
    f = _num(v)
    return int(round(f)) if f is not None and f >= 0 else None


def _status_code(v: Any) -> Optional[int]:
    return int(v) if isinstance(v, int) and not isinstance(v, bool) and 100 <= v <= 599 else None


def _day(v: Any) -> Optional[str]:
    s = str(v or "")[:10]
    if not _ISO_DAY.match(s):
        return None
    try:
        datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        return None
    return s


def _read_at(v: Any) -> Optional[str]:
    """The service's read stamp as an MD-1 time, or None when it is not one."""
    try:
        at = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return env.utc_iso(at if at.tzinfo else at.replace(tzinfo=timezone.utc))


def day_as_of(day: Optional[str]) -> Optional[str]:
    """A settlement date as an MD-1 time: the start of that Eastern day (a date, not a time of day)."""
    if not day:
        return None
    y, m, d = (int(p) for p in day.split("-"))
    return env.utc_iso(datetime(y, m, d, tzinfo=_ET))


def _report(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or _day(r.get("settlement_date")) is None or _whole(r.get("short_interest")) is None:
        return None
    dtc = _num(r.get("days_to_cover"))
    return {"settlement_date": _day(r["settlement_date"]), "short_interest": _whole(r["short_interest"]),
            "avg_daily_volume": _whole(r.get("avg_daily_volume")),
            "days_to_cover": dtc if dtc is not None and dtc >= 0 else None,
            # no report before, or a report before of zero shares: no change, never a 0
            "change_shares": int(round(_num(r.get("change_shares")))) if _num(r.get("change_shares")) is not None else None,
            "change_pct": _num(r.get("change_pct"))}


def _volume_day(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or _day(r.get("date")) is None or _whole(r.get("short_volume")) is None:
        return None
    ratio = _num(r.get("short_volume_ratio"))
    return {"date": _day(r["date"]), "short_volume": _whole(r["short_volume"]), "total_volume": _whole(r.get("total_volume")),
            "short_volume_ratio": ratio if ratio is not None and 0 <= ratio <= 100 else None}


def _section(raw: Any, rows_key: str, shape) -> tuple[str, Optional[str], Optional[int], list]:
    """(state, reason, the vendor's status code, the rows) of one dataset. An `ok` section with no row that can be
    read is `failed`, never an empty stock."""
    s = raw if isinstance(raw, dict) else {}
    state = s.get("state") if s.get("state") in SECTION_STATES else "failed"
    rows = [x for x in (shape(r) for r in s.get(rows_key) or []) if x] if state == "ok" and isinstance(s.get(rows_key), list) else []
    if state == "ok" and not rows:
        state = "failed"
    reason = s.get("reason") if isinstance(s.get("reason"), str) else None
    return state, reason, _status_code(s.get("http_status")), rows


def _section_note(name: str, state: str, reason: Optional[str]) -> Optional[str]:
    what = SECTION_WORDS[name]
    if state == "unavailable":
        return (NOTE_SECTION_NO_KEY if reason == "not_configured" else NOTE_SECTION_REFUSED).format(what=what)
    return NOTE_SECTION_FAILED.format(what=what) if state == "failed" else None


def read_short_interest(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym = _clean(params["symbol"])
    want_reports = params.get("reports", DEFAULT_REPORTS)
    want_days = params.get("days", DEFAULT_DAYS)
    try:
        from api.services import short_data as svc
        got, how = held_answer(sym)                         # what the service holds, or nothing: never a build
        fresh_hours = int(svc.STOCK_FRESH_S // 3600)
        extra_hours = int(svc.STOCK_STALE_EXTRA_S // 3600)
        float_max = int(svc.PCT_FLOAT_MAX)
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never "no short interest"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(sym=sym))
    if got is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(sym=sym, hours=fresh_hours, extra=extra_hours))
    if not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(sym=sym))
    status = got.get("status")
    if status == "bad_symbol":
        return env.unavailable(KIND, params, SOURCE, NOTE_BAD_SYMBOL.format(sym=sym))
    if how not in HELD:
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(sym=sym))
    i_state, i_reason, i_code, reports = _section(got.get("interest"), "reports", _report)
    v_state, v_reason, v_code, days = _section(got.get("volume"), "days", _volume_day)
    if status == "computing":                              # the route's word for nothing held: never waited on here
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(sym=sym, hours=fresh_hours, extra=extra_hours))
    if status == "unavailable":                             # the vendor refused both datasets, or the server has no key
        reason = i_reason if i_state == "unavailable" else v_reason
        return env.unavailable(KIND, params, SOURCE,
                               (NOTE_NO_KEY if reason == "not_configured" else NOTE_REFUSED).format(sym=sym))
    if status == "failed":
        return env.unavailable(KIND, params, SOURCE, NOTE_READ_FAILED.format(sym=sym))
    if status != "ok":
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(sym=sym))
    if not any(s in ("ok", "none") for s in (i_state, v_state)):
        # an `ok` answer whose datasets cannot be read here is a failed read, never an empty stock
        return env.unavailable(KIND, params, SOURCE, NOTE_READ_FAILED.format(sym=sym))

    src_i = got.get("interest") if isinstance(got.get("interest"), dict) else {}
    src_v = got.get("volume") if isinstance(got.get("volume"), dict) else {}
    newest = reports[0] if reports else None
    settled = newest["settlement_date"] if newest else None
    read_at = _read_at(got.get("read_at"))
    shown_reports = reports[:want_reports]
    shown_days = days[:want_days]

    flt_in = got.get("float") if isinstance(got.get("float"), dict) else {}
    withheld = flt_in.get("withheld") is True
    flt = {"shares": _whole(flt_in.get("shares")) or None,
           # a withheld percent is null with `withheld` true: never 0, never the mismatched figure
           "pct_float": None if withheld else _num(flt_in.get("pct_float")), "withheld": withheld,
           "state": flt_in.get("state") if flt_in.get("state") in FLOAT_STATES else "missing",
           "source": flt_in.get("source") if isinstance(flt_in.get("source"), str) else None}

    notes = [NOTE_WHAT.format(sym=sym)]
    if settled:
        notes.append(NOTE_LAG.format(date=settled))
        estimate = _day(got.get("publication_estimate"))
        if estimate:
            notes.append(NOTE_PUBLISHED.format(estimate=estimate))
        notes.append(NOTE_AS_OF.format(at=read_at or "a time not given"))
    else:
        notes.append(NOTE_NO_AS_OF.format(at=read_at or "a time not given"))
    # unknown is never claimed fresh: an answer with no read time is stale
    stale = how == "last_good" or read_at is None
    if read_at is None:
        notes.append(NOTE_NO_READ_TIME)
    if how == "last_good":
        notes.append(NOTE_LAST_GOOD.format(sym=sym, hours=fresh_hours))
    if i_state == "none":
        notes.append(NOTE_NO_REPORTS.format(sym=sym))
    if v_state == "none":
        notes.append(NOTE_NO_VOLUME.format(sym=sym))
    for name, state, reason in (("interest", i_state, i_reason), ("volume", v_state, v_reason)):
        said = _section_note(name, state, reason)
        if said:
            notes.append(said)
    if days:
        notes.append(NOTE_VOLUME)
    if newest:
        if withheld:
            notes.append(NOTE_FLOAT_WITHHELD.format(max=float_max, sym=sym))
        elif flt["pct_float"] is None:
            notes.append(NOTE_FLOAT_MISSING.format(sym=sym))
        else:
            notes.append(NOTE_FLOAT)
            if flt["state"] == "stale":
                notes.append(NOTE_FLOAT_STALE)
    history_cut = i_state == "ok" and src_i.get("cut") is True
    if history_cut:
        notes.append(NOTE_HISTORY_CUT.format(n=len(reports), first=reports[-1]["settlement_date"]))
    if len(reports) > len(shown_reports):
        notes.append(NOTE_REPORTS_CUT.format(n=len(shown_reports), total=len(reports)))
    if len(days) > len(shown_days):
        notes.append(NOTE_DAYS_CUT.format(n=len(shown_days), total=len(days)))

    window = src_v.get("window_days")
    # `sym` / `settlement_date` / `publication_estimate` / `read_at` / `interest` / `volume` / `float` / `source` keep the
    # route's own names (the SHINT panel's model reads them)
    data = {"sym": sym, "settlement_date": settled, "latest": newest,
            "publication_estimate": _day(got.get("publication_estimate")) if settled else None,
            "read_at": read_at, "held": how,
            "interest": {"state": i_state, "reason": i_reason, "http_status": i_code, "reports": shown_reports,
                         "count": len(reports), "shown": len(shown_reports), "cut": history_cut,
                         "first_date": reports[-1]["settlement_date"] if reports else None},
            "volume": {"state": v_state, "reason": v_reason, "http_status": v_code, "days": shown_days,
                       "count": len(days), "shown": len(shown_days),
                       "window_days": int(window) if isinstance(window, int) and not isinstance(window, bool) else None},
            "float": flt,
            "source": got.get("source") if isinstance(got.get("source"), str) else None}
    total = len(reports) + len(days)
    answered = len(shown_reports) + len(shown_days)
    coverage = {"evaluated": total, "answered": answered, "dropped": total - answered, "not_computable": 0}
    partial = any(s in ("unavailable", "failed") for s in (i_state, v_state))
    return env.make_envelope(KIND, params, status="partial" if partial else "ok", freshness="historical",
                             as_of=day_as_of(settled), source=SOURCE, data=data, stale=stale, coverage=coverage,
                             notes=notes, provider_calls=0)

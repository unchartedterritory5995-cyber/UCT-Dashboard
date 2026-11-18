"""MD-1 kind `short.list` (owner: terminal-data, data wave 5) — the newest FINRA short interest report, ranked.

The newest short interest report across the stocks UCT follows, each beside its previous report, ranked one of four
ways: the Agent half of the SHRTS terminal panel (app/src/pages/terminal/panels/shortListModel.js), over the answer
behind `GET /api/research/short-interest-list` (api/services/short_data.py).

⛔ ONLY THE LIST THE SERVICE ALREADY HOLDS, NEVER A BUILD OR A CHECK (MD-1 §5). The member route's `get_market` never
builds on the request, but with nothing held it STARTS the service's one background build (four to six vendor
requests) and waits on it, and with a list held it starts the cheap "is there a newer report" check once that is due.
A turn must start neither, so this adapter never calls `get_market`. It reads `short_data.held_market`, the service's
own read-only accessor: the list the module holds (looked for on disk once per process, a local file read), ranked by
the service's own `rank_market`; or, with no list held, what the service's last build said while that still stands;
or nothing → `unavailable`, with the reason. provider_calls is always 0. A rail counts builds, threads and vendor
requests through the real service state, with nothing held and with a check due, and shows the route's own reader
starting one in the same state.

WHAT THE SERVICE CAN SAY, each kept apart (its own states):
  * `ok`            the ranked list, as below;
  * `unavailable`   with `reason` `refused` (the vendor refused this site's key: the data plan), `not_configured` (no
                    key on the server), `shape` (the vendor answered, but not with rows that can be read as a report)
                    or `thin` (the report held too few of the stocks UCT follows to be a market list): each
                    `unavailable` here with its own note, never "no stock is short";
  * `failed`        the service's last build failed: `unavailable`, with the reason;
  * `bad_rank`      not a rank: refused before any read by `validate`.
`computing` is the member route's word for "nothing held, a build is running": this read never starts or waits on one,
so it is the nothing-held answer here.

EVERY NUMBER IS THE SERVICE'S OWN: nothing is ranked or counted here. A number that does not exist is null, never 0:
no days to cover, no previous report, no change, no float and no percent of float are each null. A stock without the
number a rank needs is not ranked by it (the service's own rule), and the two percent-change ranks keep only stocks
whose PREVIOUS report was at least the service's floor, so a tiny base cannot top the list; the floor is stated.

THE CUT IS STATED: at most `limit` rows, the first of the ranking, with how many stocks the rank covers beside them
and a note naming both and saying the lowest ranked are the ones left out.

TIME (MD-1 §3): `as_of` = the report's SETTLEMENT DATE, as the start of that Eastern day (a date, not a time of day; a
note says so). It is never today: FINRA collects short interest twice a month and publishes it about two weeks later.
When UCT read the report from the vendor is a read time: it rides as `data.read_at`. The list is `stale`, with a note,
when the server's last look for a newer report did not go well, when FINRA's own schedule says a newer report is out
and the server has not read it (this read never looks), or when the list carries no read time. Every read is
`historical` (a settled report); the kind is DECLARED `periodic`, the less fresh read being allowed.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the data is FINRA's, licensed to UCT through its market-data vendor
for display to members (docs/terminal-research/09-security-licensing-cost/licensing-register.md, row T-93), and no row
of that register clears it for a model provider. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _status_code, _whole, day_as_of

KIND = "short.list"
SOURCE = "uct-short-data"
#: the four ranks, in the SHRTS panel's own order (shortListModel.js SHORT_RANKS; the service's RANKS), railed equal
RANKS = ("dtc", "up", "down", "float")
DEFAULT_RANK = "dtc"
#: how each rank orders the list: the panel's own words (shortListModel.js SHORT_RANKS[..].words), railed equal
RANK_WORDS = {"dtc": "most days to cover first", "up": "biggest percent increase in short interest first",
              "down": "biggest percent decrease in short interest first", "float": "highest percent of float first"}
DEFAULT_LIMIT = 25
MAX_LIMIT = 50
#: a row's fields, by the service's own names
ROW_FIELDS = ("sym", "short_interest", "avg_daily_volume", "days_to_cover", "prev_short_interest", "change_shares",
              "change_pct", "float_shares", "pct_float")
FLOAT_FIELDS = ("state", "with_float", "withheld", "source")
CHECK_FIELDS = ("state", "reason", "http_status", "at")
FLOAT_STATES = ("ok", "stale", "missing")
_ET = ZoneInfo("America/New_York")

NOTE_WHAT = ("the newest FINRA short interest report the server holds, for settlement date {date}: the shares sold "
             "short and not yet covered as of that date for {count} of the {universe} stocks UCT follows, each beside "
             "its previous report, ranked {order}; FINRA's data, read through UCT's market-data vendor")
NOTE_LAG = ("FINRA collects short interest twice a month and publishes it about two weeks later, so a report is "
            "already about two weeks old when it is published; this one is for {date}, never today")
NOTE_PUBLISHED = ("the day FINRA published the report is not in the vendor's answer; by FINRA's schedule (after the "
                  "close on the 7th business day after the settlement date) it was {estimate}, an estimate")
NOTE_AS_OF = ("as_of is the report's settlement date (a date, not a time of day); UCT read the report from the data "
              "vendor at {at}, and this read never looks for a newer one")
NOTE_NO_READ_TIME = "the held list carries no read time, so its age is unknown"
NOTE_PREVIOUS = "a change is measured against the previous report, for settlement date {date}"
NOTE_NO_PREVIOUS = "the server holds no previous report to compare with, so no change is given; that is not a change of 0"
NOTE_RANK_DTC = ("days to cover is the data vendor's own figure (shares short against the average daily volume); a "
                 "stock with none is not ranked, never ranked as 0")
NOTE_RANK_CHANGE = ("a percent change is ranked only for stocks whose PREVIOUS report was at least {floor:,} shares, "
                    "so a tiny base cannot top the list; a stock with no previous report is not ranked")
NOTE_RANK_FLOAT = ("percent of float divides the settlement date's short interest by TODAY's float from the nightly "
                   "screener export, so the two figures are from different days; a stock with no float on file is not "
                   "ranked, and a percent above {max}% of float is withheld as a mismatch ({withheld} withheld)")
NOTE_FLOAT_STALE = "the screener export the float comes from is older than usual, so the float may be behind"
NOTE_FLOAT_MISSING = ("the screener export the float comes from could not be read when the list was built, so no "
                      "percent of float is given; that is not the same as no stock being short")
NOTE_LANDING = ("a newer report, for settlement date {date}, is still arriving at the data vendor (it held too few "
                "stocks when the server looked), so the list is the report before it")
NOTE_CHECK = ("the server's last look for a newer report did not go well ({what}), so this is the last report it "
              "read and a newer one may exist")
NOTE_NEWER_DUE = ("by FINRA's schedule the report for settlement date {date} has been published, and the server has "
                  "not read it: this read never looks for a newer report, so the list may be one report behind")
NOTE_NONE = ("no stock in the report has the number this rank needs ({order}); that is a statement about the report "
             "the server holds, not a failed read")
NOTE_CUT = ("showing the first {n} of the {total} stocks this rank covers, {order}; the lowest ranked are the ones "
            "left out")
NOTE_NOT_HELD = ("no short interest list is held on this server yet (it is read from the data vendor when the Short "
                 "interest list panel is first opened, then kept in memory and on disk), and this read never starts "
                 "that read; that is not the same as no stock being short")
NOTE_REFUSED = ("the data vendor refused the short interest report for this site's key when the server last asked "
                "(the data plan), and this read never asks again; that is not the same as no stock being short")
NOTE_NO_KEY = ("this server has no key for the data vendor, so the short interest report could not be read; that is "
               "not the same as no stock being short")
NOTE_SHAPE = ("the data vendor answered, but not with rows the server could read as a short interest report; that is "
              "not the same as no stock being short")
NOTE_THIN = ("the data vendor's newest report held too few of the stocks UCT follows to be a market list, so nothing "
             "is held; that is not the same as no stock being short")
NOTE_READ_FAILED = ("the server's last read of the short interest report from the data vendor failed, and this read "
                    "never starts another; that is not the same as no stock being short")
NOTE_BAD_RANK = "that is not a rank of the short interest list; the ranks are {ranks}"
NOTE_FAILED = "the short interest list could not be read"
#: the service's `unavailable` reasons → the note that says each
UNAVAILABLE_NOTES = {"refused": NOTE_REFUSED, "not_configured": NOTE_NO_KEY, "shape": NOTE_SHAPE, "thin": NOTE_THIN}
#: what the last look's failure is called in a note
CHECK_WORDS = {"refused": "the data vendor refused this site's key", "not_configured": "no key for the data vendor",
               "shape": "the vendor's answer could not be read as a report",
               "thin": "the newest report held too few stocks"}
CHECK_FAILED = "the read failed"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    if params.get("rank", DEFAULT_RANK) not in RANKS:
        return "`rank` must be one of " + ", ".join(RANKS)
    n = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_LIMIT:
        return f"`limit` must be a whole number from 1 to {MAX_LIMIT}"
    return None


def today_et() -> date:
    return datetime.now(_ET).date()


def held_answer(rank: str, limit: int) -> tuple[Optional[dict], str]:
    """(one ranked answer from the list the service already holds, how it is held), WITHOUT a build or a check."""
    from api.services import short_data as svc
    return svc.held_market(rank, limit)


def newer_due(held_day: str) -> Optional[str]:
    """The newest settlement date AFTER `held_day` whose report FINRA's own schedule had published before today
    (Eastern), or None. A calendar reckoning from the house's own helpers; no read, and None when it cannot be told."""
    try:
        from api.services import short_data as svc
        from api.services import short_interest as house
        today = today_et()
        for settled in house.settlement_dates_before(today, 4):          # newest first
            iso = settled.isoformat()
            if iso <= held_day:
                return None
            estimate = svc.publication_estimate(iso)
            if estimate and estimate < today.isoformat():
                return iso
    except Exception:  # noqa: BLE001 — a reckoning that fails says nothing; it never fails the read
        return None
    return None


def _row(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or not str(r.get("sym") or "").strip() or _whole(r.get("short_interest")) is None:
        return None
    dtc = _num(r.get("days_to_cover"))
    change = _num(r.get("change_shares"))
    return {"sym": str(r["sym"]).strip().upper(), "short_interest": _whole(r["short_interest"]),
            "avg_daily_volume": _whole(r.get("avg_daily_volume")),
            "days_to_cover": dtc if dtc is not None and dtc >= 0 else None,
            # no previous report: no change, never a 0
            "prev_short_interest": _whole(r.get("prev_short_interest")),
            "change_shares": int(round(change)) if change is not None else None, "change_pct": _num(r.get("change_pct")),
            "float_shares": _whole(r.get("float_shares")) or None, "pct_float": _num(r.get("pct_float"))}


def _count(v: Any) -> Optional[int]:
    return int(v) if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None


def read_short_list(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    rank = params.get("rank", DEFAULT_RANK)
    limit = params.get("limit", DEFAULT_LIMIT)
    order = RANK_WORDS[rank]
    try:
        from api.services import short_data as svc
        got, how = held_answer(rank, limit)                 # the held list, or nothing: never a build, never a check
        float_max = int(svc.PCT_FLOAT_MAX)
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never "no stock is short"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if got is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    if not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    status = got.get("status")
    if status == "bad_rank":
        return env.unavailable(KIND, params, SOURCE, NOTE_BAD_RANK.format(ranks=", ".join(RANKS)))
    if status == "computing":                               # the route's word for nothing held: never waited on here
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    if status == "unavailable":                             # what the service's last build said: the reason is its own
        return env.unavailable(KIND, params, SOURCE, UNAVAILABLE_NOTES.get(got.get("reason"), NOTE_FAILED))
    if status == "failed":
        return env.unavailable(KIND, params, SOURCE, NOTE_READ_FAILED)
    settled = _day(got.get("settlement_date"))
    if status != "ok" or how != "held" or not isinstance(got.get("rows"), list) or settled is None or got.get("rank") != rank:
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)

    rows = [x for x in (_row(r) for r in got["rows"]) if x][:limit]
    ranked = max(_count(got.get("ranked")) or 0, len(rows))
    cut = got.get("cut") is True or ranked > len(rows)
    previous = _day(got.get("previous_settlement_date"))
    landing = _day(got.get("newer_report_landing"))
    estimate = _day(got.get("publication_estimate"))
    read_at = _read_at(got.get("read_at"))
    floor = _count(got.get("floor_shares")) if rank in ("up", "down") else None
    flt_in = got.get("float") if isinstance(got.get("float"), dict) else {}
    flt = {"state": flt_in.get("state") if flt_in.get("state") in FLOAT_STATES else "missing",
           "with_float": _count(flt_in.get("with_float")), "withheld": _count(flt_in.get("withheld")),
           "source": flt_in.get("source") if isinstance(flt_in.get("source"), str) else None}
    check_in = got.get("check") if isinstance(got.get("check"), dict) and isinstance(got["check"].get("state"), str) else None
    check = {"state": check_in["state"], "reason": check_in.get("reason") if isinstance(check_in.get("reason"), str) else None,
             "http_status": _status_code(check_in.get("http_status")), "at": _read_at(check_in.get("at"))} if check_in else None
    due = newer_due(settled)
    if due is not None and due == landing:
        due = None                                          # the vendor has only part of it: said as landing, below

    notes = [NOTE_WHAT.format(date=settled, count=_count(got.get("count")) or 0, universe=_count(got.get("universe")) or 0,
                              order=order), NOTE_LAG.format(date=settled)]
    if estimate:
        notes.append(NOTE_PUBLISHED.format(estimate=estimate))
    notes.append(NOTE_AS_OF.format(at=read_at or "a time not given"))
    notes.append(NOTE_PREVIOUS.format(date=previous) if previous else NOTE_NO_PREVIOUS)
    if rank == "dtc":
        notes.append(NOTE_RANK_DTC)
    elif rank == "float":
        notes.append(NOTE_FLOAT_MISSING if flt["state"] == "missing" else
                     NOTE_RANK_FLOAT.format(max=float_max, withheld=flt["withheld"] or 0))
        if flt["state"] == "stale":
            notes.append(NOTE_FLOAT_STALE)
    elif floor is not None:
        notes.append(NOTE_RANK_CHANGE.format(floor=floor))
    # unknown is never claimed fresh: a list with no read time is stale; so is one a failed look or FINRA's own
    # schedule says may be behind
    stale = read_at is None or check is not None or due is not None
    if read_at is None:
        notes.append(NOTE_NO_READ_TIME)
    if landing:
        notes.append(NOTE_LANDING.format(date=landing))
    if check is not None:
        notes.append(NOTE_CHECK.format(what=CHECK_WORDS.get(check["reason"], CHECK_FAILED)))
    if due is not None:
        notes.append(NOTE_NEWER_DUE.format(date=due))
    if not rows:
        notes.append(NOTE_NONE.format(order=order))
    elif cut:
        notes.append(NOTE_CUT.format(n=len(rows), total=ranked, order=order))

    # `rank` / `settlement_date` / `previous_settlement_date` / `newer_report_landing` / `publication_estimate` /
    # `read_at` / `count` / `universe` / `ranked` / `limit` / `cut` / `rows` / `floor_shares` / `float` / `check` /
    # `source` keep the route's own names (the SHRTS panel's model reads them)
    data = {"rank": rank, "settlement_date": settled, "previous_settlement_date": previous,
            "newer_report_landing": landing, "newer_report_due": due, "publication_estimate": estimate,
            "read_at": read_at, "held": how, "count": _count(got.get("count")), "universe": _count(got.get("universe")),
            "ranked": ranked, "limit": limit, "shown": len(rows), "cut": cut, "rows": rows, "floor_shares": floor,
            "float": flt, "check": check,
            "source": got.get("source") if isinstance(got.get("source"), str) else None}
    coverage = {"evaluated": ranked, "answered": len(rows), "dropped": ranked - len(rows), "not_computable": 0}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=day_as_of(settled), source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)

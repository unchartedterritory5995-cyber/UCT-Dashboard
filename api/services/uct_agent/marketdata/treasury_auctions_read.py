"""MD-1 kind `rates.auctions` (owner: terminal-data, data wave 9) — US Treasury auctions, as held.

The auctions the US Treasury is about to hold and the results of the recent ones, as UCT holds them: the Agent half of
the AUCT terminal function, over the answer of `GET /api/research/treasury-auctions`
(`api/services/treasury_auctions.py`). Two lists, each with its own rows, count and cut: the auctions coming up
(security, auction day, issue day, announcement day, amount offered, reopening, CUSIP), soonest first, and the results
of the last 45 days (the high yield, rate or discount margin and which of the three it is, the bid-to-cover ratio, the
competitive award split between primary dealers, direct bidders and indirect bidders with each one's share, and what
kind of sale it was), newest first.

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's `treasury_auctions.get_auctions`
STARTS the service's background build (two requests to the Treasury's Fiscal Data service) when nothing is held or a
refresh is due. A turn must not, so this adapter never calls it. It reads through
`treasury_auctions_held.held_auctions()`, which returns the answer the service holds (in memory, or the copy on this
server's disk) or nothing, and never builds. provider_calls is always 0. A rail shows `get_auctions` starting the build
in the same state.

NOTHING HELD IS SAID, NEVER "NO AUCTIONS": `not_held` is `unavailable` with that reason. A held answer with an empty
list is what the Treasury's records list, said in words.

WHAT IS STATED: every row and every figure is the service's own, passed through. A figure the Treasury left empty
(an amount, a rate, a bid-to-cover ratio) is null, never 0; a bidder split with a class missing is null, never a share
of 0. The bidder shares are the service's own arithmetic; nothing is recomputed here.

THE CUT IS STATED: each list returns at most `rows` rows; the auctions coming up are cut from their FAR end (the latest
days ahead) and the results from their OLD end, and the note says so, with each list's whole count beside what is
shown. Where the service itself read one page and the Treasury held more rows (`cut` in its answer), that is said too.

TIME (MD-1 §3): `as_of` = the newest date in what UCT read (the service's own `as_of`: the day of the Treasury's newest
list of coming auctions or the newest auction day with a result, whichever is later), as the start of that Eastern
day; never the time of the read. When UCT read the records rides as `data.read_at`. The read is `stale`, with a note,
when UCT read the records before the Treasury's last evening update (the service's own refresh slot,
`treasury_yields.last_daily_slot`) or when its last look for newer records did not go well: this read never looks.
Every read is `periodic`, as the kind is declared.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) has no row for the Treasury's Fiscal Data
auction records. The nearest row, row T-95, covers the Treasury's own par yield curve as a US Government work shown on
the member's Treasury yields panel, and says nothing else reads it (no AI lane, no export, no external publication).
No row clears these records for a model provider, and no other row does. Shown to the member only; the capability is
local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _status_code, _whole, day_as_of

KIND = "rates.auctions"
SOURCE = "us-treasury-fiscal-data"
DEFAULT_ROWS = 12           # the AUCT panel's results on screen before "Show all" (AUCT_RESULTS_SHOWN; a rail pins it)
MAX_ROWS = 50
LISTS = ("upcoming", "results")
UPCOMING_FIELDS = ("security_type", "security_term", "auction_date", "issue_date", "announced_date", "offering_amount",
                   "reopening", "cusip")
RESULT_FIELDS = ("security_type", "security_term", "auction_date", "issue_date", "maturity_date", "offering_amount",
                 "rate", "rate_kind", "bid_to_cover", "reopening", "tips", "floating_rate", "cash_management", "cusip",
                 "bidders")
#: the service's names for which rate a result is (treasury_auctions.RATE_FIELDS; a rail pins the two together)
RATE_KINDS = ("high_yield", "high_rate", "high_discount_margin")
#: the service's bidder classes (treasury_auctions.BIDDER_FIELDS; a rail pins the two together)
BIDDER_CLASSES = ("primary_dealers", "direct", "indirect")
MAX_TEXT = 40
#: the service's words for a look that did not go well (treasury_auctions `check.state` / `check.reason`)
CHECK_WORDS = {"refused": "the Treasury's Fiscal Data service refused the request",
               "shape": "its answer could not be read as the auction records",
               "rate_limited": "the Fiscal Data service said too many requests",
               "timeout": "it did not answer in time", "source": "the Fiscal Data service answered with an error",
               "error": "the read failed"}
CHECK_FAILED = "it did not go well"

NOTE_WHAT = ("US Treasury auctions as UCT holds them, from the Treasury's Fiscal Data service: the auctions coming up "
             "(security, auction day, issue day, amount offered), soonest first, and the results of the last {days} days "
             "(the high yield, rate or discount margin, the bid-to-cover ratio, and the competitive award split between "
             "primary dealers, direct bidders and indirect bidders with each one's share), newest first. Amounts in US "
             "dollars and rates in percent, as the Treasury publishes them. A record and a schedule, not a forecast and "
             "not advice")
NOTE_AS_OF = ("`as_of` is the newest date in what UCT read ({day}): the day of the Treasury's newest list of coming "
              "auctions ({upcoming}) or the newest auction day with a result ({through}), whichever is later; it is "
              "never the time of this read. UCT read the records at {at} (UCT's own time)")
NOTE_NO_DATE = ("the records UCT holds carry no date of their own, so `as_of` is null. UCT read them at {at} (UCT's own "
                "time)")
NOTE_NO_UPCOMING = "the Treasury's records UCT holds list no auction coming up"
NOTE_NO_RESULTS = "the Treasury's records UCT holds list no auction with a result in the last {days} days"
NOTE_CUT_UPCOMING = ("{total} auctions are listed as coming up and the soonest {shown} are returned: the list is cut "
                     "from the FAR end")
NOTE_CUT_RESULTS = ("{total} auction results are held and the newest {shown} are returned: the list is cut from the "
                    "OLD end")
NOTE_PUBLISHER_CUT = ("the Treasury held more rows than the one page UCT reads, newest first, so the oldest are not in "
                      "what UCT holds: {what}")
NOTE_MISSING = ("{n} auctions returned have at least one figure the Treasury left empty (the amount, the rate, the "
                "bid-to-cover ratio or the bidder split); those figures are null, never 0")
NOTE_DROPPED = "{n} rows the Treasury sent have no auction day or no security and are not in what UCT holds"
NOTE_STALE = ("UCT read these records at {at}, before the Treasury's last evening update UCT looks for ({slot}), so "
              "newer records may exist. This read never looks for them: open the Treasury auctions panel (AUCT) in UCT, "
              "then ask again")
NOTE_CHECK = ("UCT's last look for newer auction records, at {at}, did not go well ({why}): the records held are the "
              "last good ones")
NOTE_NOT_HELD = ("no Treasury auctions are held on this server yet, and this read never asks the Treasury. That is not "
                 "the same as no auctions. Open the Treasury auctions panel (AUCT) in UCT, then ask again")
NOTE_FAILED = "the Treasury auctions read failed; nothing is stated. That is not the same as no auctions"

PUBLISHER_CUT_WORDS = {"upcoming": "the oldest copies of the list of coming auctions",
                       "results": "the oldest results"}


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission. The auctions take no symbol."""
    if not isinstance(params, dict):
        return "the request must be an object"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer() -> tuple[Optional[dict], str]:
    """READ ONLY: (the answer the service holds, 'held' | 'not_held'), WITHOUT starting a build
    (`treasury_auctions_held.held_auctions`)."""
    from api.services import treasury_auctions_held as svc
    return svc.held_auctions()


def last_slot() -> str:
    """The service's own refresh slot: the most recent weekday 18:15 New York time (treasury_yields.last_daily_slot),
    as an MD-1 time, read at call time."""
    from api.services import treasury_yields as ty
    return env.utc_iso(ty.last_daily_slot(ty.now_et()))


def _text(v: Any, limit: int = MAX_TEXT) -> Optional[str]:
    return v.strip()[:limit] if isinstance(v, str) and v.strip() else None


def _flag(v: Any) -> Optional[bool]:
    return v if isinstance(v, bool) else None


def _positive(v: Any) -> Optional[float]:
    f = _num(v)
    return f if f is not None and f > 0 else None


def _common(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or _day(r.get("auction_date")) is None or _text(r.get("security_type")) is None:
        return None
    return {"security_type": _text(r["security_type"]), "security_term": _text(r.get("security_term")),
            "auction_date": _day(r["auction_date"]), "issue_date": _day(r.get("issue_date"))}


def _upcoming(r: Any) -> Optional[dict]:
    base = _common(r)
    if base is None:
        return None
    return {**base, "announced_date": _day(r.get("announced_date")), "offering_amount": _positive(r.get("offering_amount")),
            "reopening": _flag(r.get("reopening")), "cusip": _text(r.get("cusip"), 12)}


def _bidders(b: Any) -> Optional[dict]:
    if not isinstance(b, dict):
        return None
    out: dict[str, Any] = {}
    for name in BIDDER_CLASSES:
        c = b.get(name)
        share, amount = (_num(c.get("share")), _num(c.get("amount"))) if isinstance(c, dict) else (None, None)
        if share is None or amount is None or share < 0 or amount < 0:
            return None                                    # a split with a class missing is no split, never a share of 0
        out[name] = {"amount": amount, "share": share}
    total = _positive(b.get("total"))
    return {**out, "total": total} if total is not None else None


def _result(r: Any) -> Optional[dict]:
    base = _common(r)
    if base is None:
        return None
    rate = _num(r.get("rate"))
    return {**base, "maturity_date": _day(r.get("maturity_date")), "offering_amount": _positive(r.get("offering_amount")),
            "rate": rate, "rate_kind": r.get("rate_kind") if rate is not None and r.get("rate_kind") in RATE_KINDS else None,
            "bid_to_cover": _positive(r.get("bid_to_cover")), "reopening": _flag(r.get("reopening")),
            "tips": r.get("tips") is True, "floating_rate": r.get("floating_rate") is True,
            "cash_management": r.get("cash_management") is True, "cusip": _text(r.get("cusip"), 12),
            "bidders": _bidders(r.get("bidders"))}


def _check(c: Any) -> Optional[dict]:
    if not isinstance(c, dict):
        return None
    text = lambda k: c.get(k) if isinstance(c.get(k), str) and c.get(k) else None      # noqa: E731
    return {"state": text("state"), "reason": text("reason"), "http_status": _status_code(c.get("http_status")),
            "at": text("at")}


def read_auctions(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    limit = params.get("rows", DEFAULT_ROWS)
    try:
        got, how = held_answer()                               # the held answer only: never a build
        slot = last_slot()
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no auctions"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how == "not_held" or got is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    if (how != "held" or not isinstance(got, dict) or got.get("status") != "ok"
            or not isinstance(got.get("upcoming"), list) or not isinstance(got.get("results"), list)):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    read_at = _read_at(got.get("read_at")) if got.get("read_at") else None
    if read_at is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)

    lists = {"upcoming": [x for x in (_upcoming(r) for r in got["upcoming"]) if x],
             "results": [x for x in (_result(r) for r in got["results"]) if x]}
    days = _whole(got.get("window_days"))
    day, upcoming_as_of, through = _day(got.get("as_of")), _day(got.get("upcoming_as_of")), _day(got.get("results_through"))
    dropped_raw = got.get("dropped") if isinstance(got.get("dropped"), dict) else {}
    dropped = sum(_whole(dropped_raw.get(k)) or 0 for k in LISTS) + sum(len(got[k]) - len(lists[k]) for k in LISTS)
    cut_raw = got.get("cut") if isinstance(got.get("cut"), dict) else {}
    publisher_cut = {k: cut_raw.get(k) is True for k in LISTS}
    check = _check(got.get("check"))
    stale = read_at < slot or check is not None

    out_lists = {}
    for k in LISTS:
        shown = lists[k][:limit]
        out_lists[k] = {"rows": shown, "count": len(shown), "total": len(lists[k]), "cut": len(lists[k]) > len(shown)}
    gaps = sum(1 for r in out_lists["upcoming"]["rows"] if r["offering_amount"] is None)
    gaps += sum(1 for r in out_lists["results"]["rows"]
                if r["offering_amount"] is None or r["rate"] is None or r["bid_to_cover"] is None or r["bidders"] is None)

    notes = [NOTE_WHAT.format(days=days if days is not None else "45"),
             NOTE_AS_OF.format(day=day, upcoming=upcoming_as_of or "not given", through=through or "not given", at=read_at)
             if day else NOTE_NO_DATE.format(at=read_at)]
    if not lists["upcoming"]:
        notes.append(NOTE_NO_UPCOMING)
    if not lists["results"]:
        notes.append(NOTE_NO_RESULTS.format(days=days if days is not None else "45"))
    if out_lists["upcoming"]["cut"]:
        notes.append(NOTE_CUT_UPCOMING.format(total=out_lists["upcoming"]["total"], shown=out_lists["upcoming"]["count"]))
    if out_lists["results"]["cut"]:
        notes.append(NOTE_CUT_RESULTS.format(total=out_lists["results"]["total"], shown=out_lists["results"]["count"]))
    if any(publisher_cut.values()):
        notes.append(NOTE_PUBLISHER_CUT.format(what=" and ".join(PUBLISHER_CUT_WORDS[k] for k in LISTS if publisher_cut[k])))
    if gaps:
        notes.append(NOTE_MISSING.format(n=gaps))
    if dropped:
        notes.append(NOTE_DROPPED.format(n=dropped))
    if read_at < slot:
        notes.append(NOTE_STALE.format(at=read_at, slot=slot))
    if check is not None:
        notes.append(NOTE_CHECK.format(at=check["at"] or "a time it did not record",
                                       why=CHECK_WORDS.get(check["reason"] or "", CHECK_FAILED)))

    # `as_of` / `upcoming_as_of` / `results_through` / `window_days` / `upcoming` / `results` / `read_at` / `basis` /
    # `source` / `check` keep the route's own names (the panel's model reads them)
    data = {"as_of": day, "upcoming_as_of": upcoming_as_of, "results_through": through, "window_days": days,
            "upcoming": out_lists["upcoming"], "results": out_lists["results"], "dropped": dropped,
            "publisher_cut": publisher_cut, "read_at": read_at,
            "basis": got.get("basis") if isinstance(got.get("basis"), str) else None,
            "source": got.get("source") if isinstance(got.get("source"), str) else None, "check": check}
    total = len(lists["upcoming"]) + len(lists["results"])
    shown_n = out_lists["upcoming"]["count"] + out_lists["results"]["count"]
    coverage = {"evaluated": total, "answered": shown_n, "dropped": total - shown_n, "not_computable": gaps}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=day_as_of(day), source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)

"""MD-1 kind `dilution.watch` (owner: terminal-data, data wave 7) — one company's share-issuance filings, as held.

One company's share-issuance filings of the last three years as UCT classified them from the SEC's filing index:
each filing's date, form and kind, the shelf registrations with their state, and the counts of offerings,
unregistered sales and registrations: the Agent half of the DILU terminal function, over the answer of
`GET /api/research/dilution-watch/{ticker}` (`api/services/dilution_watch.py`). It answers for ONE company: the
service holds no market-wide list, and none is made here.

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's `dilution_watch.get_watch` STARTS
a background build when nothing is held: a thread that requests the SEC's website. A turn must not, so this adapter
never calls it. It reads through `dilution_watch.held_watch()`, which returns `(answer, how)` with how `fresh`,
`last_good` (the last good answer while the fresh one has lapsed), `not_held` or `refused`, and never starts a
build. provider_calls is always 0. A rail shows `get_watch` starting the build in the same state.

NOTHING HELD IS SAID, NEVER "NO FILINGS": `not_held` is `unavailable`, and so is a held answer that records a read
of the SEC's index that did not go well. The service's own `none` (the SEC lists no filer for the symbol, or the
company has no filing index) is a healthy answer with no rows, with its reason.

WHAT IS STATED: every row and every count is the service's own classification of a form type and its item numbers;
no filing document was read, and nothing is recomputed here. A count the read did not reach back far enough for is
null, never 0 and never a smaller number. Each filing's link and accession number are not carried.

THE CUT IS STATED: at most `rows` filings are returned, newest first; a longer list is cut from the OLD end and the
note says so. The counts cover the whole window whatever the cut.

TIME (MD-1 §3): `as_of` = the day of the newest filing of any form in the SEC's index for the company (the index's
own newest date), as the start of that Eastern day; never the time of this read. When UCT read the index rides
beside it as `data.read_at`. The read is `stale`, with a note, when the answer is the last good one and its refresh
is overdue: this read never refreshes it. A healthy `none` carries no date, and so does an index that names no
filing day: then `as_of` is null and a note says why. Every read is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) row T-96 covers these filings as shown on
the member's Dilution watch panel and says nothing else reads it (no AI lane, no export, no external publication).
That row does not clear the classification for a model provider, and no other row does. Shown to the member only;
the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.bars_daily import _SYMBOL_RE
from api.services.uct_agent.marketdata.short_interest import _day, _read_at, _status_code, _whole, day_as_of

KIND = "dilution.watch"
SOURCE = "sec-edgar-filing-index"
DEFAULT_ROWS = 15
MAX_ROWS = 40
MAX_SHELVES = 3             # the Dilution watch panel shows three (dilutionModel SHELVES_SHOWN; a rail pins it)
MAX_TEXT = 160
HORIZONS = ("offerings", "unregistered", "registrations")
SHELF_STATES = ("live", "expired", "not_effective", "withdrawal_requested")
NONE_WORDS = {"no_cik": "the SEC lists no filer for this symbol", "no_filings": "the SEC has no filing index for this company"}
#: the service's words for a read of the SEC's index that did not go well (`reason` of a failed / unavailable answer)
FAILED_WORDS = {"refused": "the SEC's website refused the request", "shape": "its answer could not be read",
                "rate_limited": "the SEC's website said too many requests", "timeout": "it did not answer in time",
                "source": "the SEC's website answered with an error", "error": "the read failed"}
FAILED_DEFAULT = "it did not go well"

NOTE_WHAT = ("{symbol}'s share-issuance filings of the last {years} years as UCT classified them from the SEC's "
             "filing index: each filing's date, form and kind, its shelf registrations and their state, and counts "
             "of offerings, unregistered sales and registrations. Classified from the form type and item numbers "
             "alone: no filing document was read. A record of filings, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the day of the newest filing of any form in the SEC's index for {symbol} ({day}); it is never "
              "the time of this read. UCT read the index at {at} (UCT's own time) and the window ends on {to}")
NOTE_NO_DATE = ("the held answer names no newest filing day for {symbol}, so `as_of` is null. UCT read the index at "
                "{at} (UCT's own time) and the window ends on {to}")
NOTE_CUT = ("{total} filings are in the window and the newest {shown} are returned, newest first: the list is cut "
            "from the OLD end. The counts cover the whole window")
NOTE_COVERAGE = ("the SEC's index was read back to {day} only, not the whole window: a count that needs older "
                 "filings is null, never 0 and never a smaller number")
NOTE_FUND = ("the SEC classes {symbol} as a fund or its filings are a fund's: share issuance by a fund is routine "
             "and these rows do not mean what they mean for a company")
NOTE_STALE = ("this is the last good answer UCT holds for {symbol} and its refresh is overdue. This read never "
              "refreshes it: open the Dilution watch panel (DILU) in UCT, then ask again")
NOTE_NONE = ("no share-issuance filing is stated for {symbol}: {why}. The answer carries no date, so `as_of` is "
             "null")
NOTE_NOT_HELD = ("no filing answer is held for {symbol} on this server, and this read never requests one from the "
                 "SEC. That is not the same as no filings. Open the Dilution watch panel (DILU) in UCT, then ask "
                 "again")
NOTE_SOURCE_FAILED = ("UCT's last read of the SEC's filing index for {symbol} did not go well ({why}), and no "
                      "earlier answer is held; nothing is stated. That is not the same as no filings")
NOTE_FAILED = "the dilution watch read failed; nothing is stated. That is not the same as no filings"


def _clean(v: Any) -> Optional[str]:
    s = v.strip().upper().lstrip("$") if isinstance(v, str) else ""
    return s if s and _SYMBOL_RE.match(s) else None


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if _clean(params.get("symbol")) is None:
        return "`symbol` must be one US stock ticker"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer(sym: str) -> tuple[Optional[dict], str]:
    """(the answer the service already holds, 'fresh' | 'last_good' | 'not_held' | 'refused'), WITHOUT starting a
    build."""
    from api.services import dilution_watch as svc
    return svc.held_watch(sym)


def _text(v: Any) -> Optional[str]:
    return v.strip()[:MAX_TEXT] if isinstance(v, str) and v.strip() else None


def _under(u: Any) -> Optional[dict]:
    """The registration a filing was made under (its form and filing day), or None."""
    if not isinstance(u, dict) or not _text(u.get("form")):
        return None
    return {"form": _text(u["form"]), "filed": _day(u.get("filed")), "shelf": u.get("shelf") is True}


def _filing(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or _day(r.get("date")) is None or not _text(r.get("form")):
        return None
    return {"date": _day(r["date"]), "form": _text(r["form"]), "kind": _text(r.get("kind")), "what": _text(r.get("what")),
            "under": _under(r.get("under"))}


def _shelf(s: Any) -> Optional[dict]:
    if not isinstance(s, dict) or _day(s.get("filed")) is None:
        return None
    return {"form": _text(s.get("form")), "filed": _day(s["filed"]), "effective": _day(s.get("effective")),
            "expires_estimate": _day(s.get("expires_estimate")),
            "state": s.get("state") if s.get("state") in SHELF_STATES else None,
            "offerings": _whole(s.get("offerings")), "latest_offering": _day(s.get("latest_offering"))}


def _horizon(h: Any) -> dict:
    h = h if isinstance(h, dict) else {}
    # a count the read did not reach back for is None on the service's side: it stays null, never 0
    return {"m12": _whole(h.get("m12")), "y3": _whole(h.get("y3")), "latest": _day(h.get("latest"))}


def read_dilution(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym, limit = _clean(params["symbol"]), params.get("rows", DEFAULT_ROWS)
    try:
        got, how = held_answer(sym)                            # the held answer only: never a build
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no filings"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how == "not_held" or got is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(symbol=sym))
    if how not in ("fresh", "last_good") or not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    status = got.get("status")
    if status == "computing":                                  # a build is running and nothing is held yet
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(symbol=sym))
    if status in ("failed", "unavailable"):
        return env.unavailable(KIND, params, SOURCE, NOTE_SOURCE_FAILED.format(
            symbol=sym, why=FAILED_WORDS.get(got.get("reason") or "", FAILED_DEFAULT)))
    if status == "none":
        reason = got.get("reason") if got.get("reason") in NONE_WORDS else None
        if reason is None:
            return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
        data = {"symbol": sym, "state": "none", "none_reason": reason, "rows": [], "count": 0, "total": 0, "cut": False,
                "as_of": None, "read_at": None, "http_status": _status_code(got.get("http_status"))}
        return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=None, source=SOURCE, data=data,
                                 stale=False, coverage={"evaluated": 0, "answered": 0, "dropped": 0, "not_computable": 0},
                                 notes=[NOTE_NONE.format(symbol=sym, why=NONE_WORDS[reason])], provider_calls=0)
    window = got.get("window") if isinstance(got.get("window"), dict) else {}
    to, day = _day(window.get("to")), _day(got.get("newest_filing"))
    if status != "ok" or to is None or not isinstance(got.get("rows"), list):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    rows = [x for x in (_filing(r) for r in got["rows"]) if x]
    rows.sort(key=lambda r: r["date"], reverse=True)                       # newest first
    total = _whole(got.get("rows_total"))
    total = max(total if total is not None else 0, len(rows))
    shown = rows[:limit]
    cov = got.get("coverage") if isinstance(got.get("coverage"), dict) else {}
    complete = cov.get("complete") is True
    summary = got.get("summary") if isinstance(got.get("summary"), dict) else {}
    shelves = [x for x in (_shelf(s) for s in got.get("shelves") or []) if x][:MAX_SHELVES]
    read_at = got.get("read_at") if isinstance(got.get("read_at"), str) and got["read_at"] else None
    years = _whole(window.get("years"))
    stale = how == "last_good"

    at = read_at or "a time it did not record"
    notes = [NOTE_WHAT.format(symbol=sym, years=years if years is not None else "few"),
             NOTE_AS_OF.format(symbol=sym, day=day, at=at, to=to) if day else NOTE_NO_DATE.format(symbol=sym, at=at, to=to)]
    if total > len(shown):
        notes.append(NOTE_CUT.format(total=total, shown=len(shown)))
    if not complete:
        notes.append(NOTE_COVERAGE.format(day=_day(cov.get("from")) or "a day it did not record"))
    if got.get("fund_like") is True:
        notes.append(NOTE_FUND.format(symbol=sym))
    if stale:
        notes.append(NOTE_STALE.format(symbol=sym))

    horizons = {k: _horizon(summary.get(k)) for k in HORIZONS}
    data = {"symbol": sym, "state": "ok", "company": _text(got.get("company")), "fund_like": got.get("fund_like") is True,
            "window": {"years": years, "from": _day(window.get("from")), "to": to,
                       "recent_months": _whole(window.get("recent_months")), "recent_from": _day(window.get("recent_from"))},
            "coverage": {"complete": complete, "from": _day(cov.get("from")), "pages_unread": _whole(cov.get("pages_unread"))},
            "newest_filing": day,
            "summary": {"live_shelves": _whole(summary.get("live_shelves")),
                        "pending_shelves": _whole(summary.get("pending_shelves")), **horizons},
            "shelves": shelves, "rows": shown, "count": len(shown), "total": total, "cut": total > len(shown),
            "as_of": day, "read_at": _read_at(read_at) if read_at else None, "last_good": stale}
    nulls = sum(1 for k in HORIZONS for f in ("m12", "y3") if horizons[k][f] is None)
    coverage = {"evaluated": total, "answered": len(shown), "dropped": total - len(shown), "not_computable": nulls}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=day_as_of(day), source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)

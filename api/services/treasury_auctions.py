"""Treasury auctions for the Terminal's AUCT screen: what the US Treasury is about to sell, and how
its recent sales went.

    get_auctions() -> the body of GET /api/research/treasury-auctions
      status   'ok' | 'computing' | 'unavailable' | 'failed'
      unavailable: reason 'refused' (the publisher answered a 4xx or a redirect) | 'shape' (it
                   answered, but not with rows that can be read as auctions), http_status
      failed:      reason 'rate_limited' (a 429) | 'timeout' | 'source' (a 5xx, a dropped
                   connection) | 'error', http_status
      ok: as_of (the newest DATE in what was read), upcoming_as_of (the day of the Treasury's newest
          list of coming auctions, or None), results_through (the newest auction day with a result,
          or None), window_days, read_at, basis, source, check,
          upcoming [{security_type, security_term, auction_date, issue_date, announced_date,
                     offering_amount (US DOLLARS), reopening (True | False | None), cusip}]
                   soonest first, auction days from today on
          results  [{security_type, security_term, auction_date, issue_date, maturity_date,
                     offering_amount, rate (PERCENT), rate_kind ('high_yield' | 'high_rate' |
                     'high_discount_margin' | None), bid_to_cover, reopening, tips, floating_rate,
                     cash_management, cusip,
                     bidders None | {primary_dealers: {amount, share}, direct: {...},
                                     indirect: {...}, total}}]
                   newest first
          dropped {upcoming, results} (rows without a date or a security, skipped and counted)
          cut {upcoming, results} (True when the publisher held more rows than the one page read;
                                   each list is read newest first, so what is left out is the oldest)

THE SOURCE is the US Treasury Fiscal Data service, read with the client this repository already
has (`api/services/econ/adapters/fiscaldata.py`: `fetch_all`, its base address and its
`HttpClient`). Two datasets, the publisher's "(Updated)" tables:

    v1/accounting/od/upcoming_auctions_v2            "Treasury Securities Upcoming Auctions (Updated)"
    v1/accounting/od/treasury_securities_auctions_v2 "Treasury Securities Auctions Data (Updated)"

  Established 2026-11-21 from the publisher's own dataset pages (fiscaldata.treasury.gov/datasets/
  upcoming-auctions/ and .../treasury-securities-auctions-data/: each table's endpoint, its date
  field `record_date`, and its data dictionary). Every field read below is named in those
  dictionaries; `comp_auction_close_date` ("Competitive Auction Close Date") is the auction date
  in both, and the upcoming table has no `auction_date` of its own any more. The publisher's notice
  "Treasury Auctions Data Updates and Enhancements" says the updated APIs carry data from
  2026-10-01 on (history to be added later) and that the older `upcoming_auctions` and
  `auctions_query` APIs stay available until spring 2027; this module reads only the updated two.
  THIS SERVER HAS NEVER ASKED THE PUBLISHER: the dictionaries name the fields, but no answer has
  been read here, so the filter on `comp_auction_close_date` and the text the publisher sends for a
  yes or a no are assumed from the publisher's documentation. Every value arrives as text (the
  dataset page says so); a missing one is the text "null".

No field list is sent with the request. The publisher answers a request that names a field it does
not have with an error, so naming them would make one wrong name cost the whole screen; reading
every column and taking what is known costs only that column ("No figure"). A field this module
does not know is dropped. A row without an auction date or a security is skipped and counted.

WHICH RATE. A bill auction's result is its high rate (`high_rate`), a note, bond or TIPS auction's
is its high yield (`high_yield`), a floating rate note's is its high discount margin
(`high_discnt_margin`). The first of those the row carries is the rate, named in `rate_kind`.

THE BIDDER SPLIT is the competitive par awarded to primary dealers, direct bidders and indirect
bidders (`prim_deal_comp_par_awarded`, `dir_bid_comp_par_awarded`, `indir_bid_comp_par_awarded`:
"Primary Dealers / Direct Bidders / Indirect Bidders Competitive Par Awarded" in the dictionary),
each with its share of the three together, in percent, computed here. With any of the three
missing, or a total that is not positive, there is no split (None), never a share of 0.

IT NEVER ASKS THE PUBLISHER ON A MEMBER'S REQUEST, and never more often than the RATES read asks
the Treasury. The answer is held in this module (and on this server's disk) through
`api/services/held_build.py`, the RATES read's own hold-and-build way; one background build makes
the two requests, one page each, with no retry; a request with nothing held waits a few seconds on
it and is otherwise told `computing`. A refresh is due once after each weekday 18:15 New York slot,
the Treasury yields read's own daily slot (`treasury_yields.last_daily_slot`), so an auction held
today shows its result this evening. A refusal is remembered for six hours, a 429 for fifteen
minutes and any other failure for a minute (the RATES read's own holds), with the last good answer
kept and the failed look said beside it.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any, Optional

from api.services import held_build
from api.services import treasury_yields as ty

SOURCE = "US Treasury Fiscal Data"
UPCOMING_ENDPOINT = "v1/accounting/od/upcoming_auctions_v2"
RESULTS_ENDPOINT = "v1/accounting/od/treasury_securities_auctions_v2"
DATE_FIELD = "comp_auction_close_date"          # the publisher's name for the auction date
WINDOW_DAYS = 45                                # calendar days of results read (the builder's default)
PAGE_ROWS = 500                                 # one page of each dataset is read, never more
USER_AGENT = "UCT-Intelligence terminal (Treasury auctions read)"
DISK_VERSION = 1
REFUSED_HOLD_S = ty.REFUSED_HOLD_S
RATE_LIMITED_HOLD_S = ty.RATE_LIMITED_HOLD_S
SHAPE_HOLD_S = ty.SHAPE_HOLD_S

_NA = frozenset({"", "null", "none", "n/a", "*"})
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
#: (the row's field, rate_kind), in the order a row is asked
RATE_FIELDS = (("high_yield", "high_yield"), ("high_rate", "high_rate"), ("high_discnt_margin", "high_discount_margin"))
BIDDER_FIELDS = (("primary_dealers", "prim_deal_comp_par_awarded"), ("direct", "dir_bid_comp_par_awarded"),
                 ("indirect", "indir_bid_comp_par_awarded"))


# ── reading one value ────────────────────────────────────────────────────────────────────────

def _text(v: Any) -> Optional[str]:
    if v is None or isinstance(v, (dict, list, bool)):
        return None
    s = str(v).strip()
    return None if s.lower() in _NA else s


def _day(v: Any) -> Optional[str]:
    s = _text(v)
    if not s or not _ISO_DAY.match(s[:10]):
        return None
    try:
        return date.fromisoformat(s[:10]).isoformat()
    except ValueError:
        return None


def _figure(v: Any) -> Optional[float]:
    """A number sent as text, or None. Never 0 for a missing one."""
    s = _text(v)
    if s is None:
        return None
    try:
        f = float(s.replace(",", ""))
    except ValueError:
        return None
    return f if f == f and abs(f) != float("inf") else None


def _yes_no(v: Any) -> Optional[bool]:
    s = (_text(v) or "").lower()
    return True if s in ("yes", "y", "true") else False if s in ("no", "n", "false") else None


# ── shaping ──────────────────────────────────────────────────────────────────────────────────

def bidder_split(row: dict) -> Optional[dict]:
    """The competitive award by bidder class with each class's share of the three, or None when
    any of the three is missing or their total is not positive."""
    amounts = {name: _figure(row.get(field)) for name, field in BIDDER_FIELDS}
    if any(a is None or a < 0 for a in amounts.values()):
        return None
    total = sum(amounts.values())
    if total <= 0:
        return None
    out: dict[str, Any] = {name: {"amount": a, "share": round(a / total * 100, 1)} for name, a in amounts.items()}
    out["total"] = total
    return out


def _rate(row: dict) -> tuple[Optional[float], Optional[str]]:
    for field, kind in RATE_FIELDS:
        value = _figure(row.get(field))
        if value is not None:
            return value, kind
    return None, None


def shape_upcoming(rows: list, today: str) -> tuple[list[dict], int, Optional[str]]:
    """(auctions from today on, soonest first; rows skipped; the newest list day). The Treasury
    publishes the list again as it changes, so the same auction can arrive more than once: the
    newest record of each is kept, whatever order the rows come in."""
    best: dict[tuple, tuple[str, dict]] = {}
    dropped = 0
    newest = None
    for row in rows:
        if not isinstance(row, dict):
            dropped += 1
            continue
        when, kind = _day(row.get(DATE_FIELD)), _text(row.get("security_type"))
        if not when or not kind:
            dropped += 1
            continue
        record = _day(row.get("record_date")) or ""
        if record and (newest is None or record > newest):
            newest = record
        if when < today:
            continue                                   # already held: it belongs to the results
        item = {
            "security_type": kind, "security_term": _text(row.get("security_term")), "auction_date": when,
            "issue_date": _day(row.get("issue_date")), "announced_date": _day(row.get("announcemt_date")),
            "offering_amount": _figure(row.get("offering_amt")), "reopening": _yes_no(row.get("reopening")),
            "cusip": _text(row.get("cusip")),
        }
        # one sale per security and term per day (a CUSIP can be missing when first listed)
        key = (kind, item["security_term"], when)
        if key not in best or record > best[key][0]:
            best[key] = (record, item)
    items = [item for _record, item in best.values()]
    items.sort(key=lambda i: (i["auction_date"], i["security_type"], i["security_term"] or ""))
    return items, dropped, newest


def shape_results(rows: list, today: str) -> tuple[list[dict], int, Optional[str]]:
    """(auctions with their results, newest first; rows skipped; the newest auction day with a
    result). A row for a day still to come that carries no result is an announcement, not a
    result: it is left to the upcoming list."""
    out: list[dict] = []
    seen: set[tuple] = set()
    dropped = 0
    through = None
    for row in rows:
        if not isinstance(row, dict):
            dropped += 1
            continue
        when, kind = _day(row.get(DATE_FIELD)), _text(row.get("security_type"))
        if not when or not kind:
            dropped += 1
            continue
        rate, rate_kind = _rate(row)
        cover = _figure(row.get("bid_to_cover_ratio"))
        if rate is None and cover is None and when >= today:
            continue
        item = {
            "security_type": kind, "security_term": _text(row.get("security_term")), "auction_date": when,
            "issue_date": _day(row.get("issue_date")), "maturity_date": _day(row.get("maturity_date")),
            "offering_amount": _figure(row.get("offering_amt")), "rate": rate, "rate_kind": rate_kind,
            "bid_to_cover": cover, "reopening": _yes_no(row.get("reopening")),
            "tips": _yes_no(row.get("inflation_protected")) is True,
            "floating_rate": _yes_no(row.get("floating_rate")) is True,
            "cash_management": _yes_no(row.get("cash_management_bill")) is True,
            "cusip": _text(row.get("cusip")), "bidders": bidder_split(row),
        }
        key = (item["cusip"] or f'{kind}|{item["security_term"]}', when)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
        if (rate is not None or cover is not None) and (through is None or when > through):
            through = when
    out.sort(key=lambda i: (i["auction_date"], i["security_type"], i["security_term"] or ""), reverse=True)
    return out, dropped, through


# ── the read ─────────────────────────────────────────────────────────────────────────────────

def _client():
    """The repository's Fiscal Data HTTP client, with no retries: a failed look is said and tried
    again later by this module's own rule, never hammered."""
    from api.services.econ import http as econ_http
    return econ_http.HttpClient(user_agent=USER_AGENT, max_retries=0, timeout=(10, 30))


def _read(http, endpoint: str, *, filters: list[str], sort: str) -> tuple[list[dict], bool]:
    """(the rows of ONE page, whether the publisher holds more rows than that page carried)."""
    from api.services.econ.adapters import fiscaldata
    rows, meta, _raw, _status = fiscaldata.fetch_all(http, endpoint, filters=filters, sort=sort,
                                                     page_size=PAGE_ROWS, first_page_only=True)
    try:
        total = int((meta or {}).get("total-count"))
    except (TypeError, ValueError):
        total = None
    return rows, total is not None and total > len(rows)


_HTTP = re.compile(r"\bHTTP (\d{3}) ")              # raise_for_status: a 4xx answered as it is
_LAST_STATUS = re.compile(r"\(last: status (\d{3})\)")   # the retry budget spent on a 5xx, 408 or 429
_REDIRECT = re.compile(r"redirect (\d{3})")          # soft_failure: a redirect is never followed


def _stop_for(exc: Exception, what: str) -> held_build.Stop:
    """The repository client's two errors as the RATES read's states and holds. Only the error's
    class and an HTTP status are ever kept (the client's own messages, which carry no secret)."""
    from api.services.econ.model import MalformedPayload, SourceUnavailable
    text = str(exc)
    if isinstance(exc, MalformedPayload):
        moved = _REDIRECT.search(text)
        if moved:
            status = int(moved.group(1))
            return held_build.Stop("unavailable", "refused", status, hold=REFUSED_HOLD_S,
                                   note=f"fiscaldata status={status} unavailable ({what} answered a redirect, never followed)")
        return held_build.Stop("unavailable", "shape", 200, hold=SHAPE_HOLD_S,
                               note=f"fiscaldata status=200 rows=0 shape mismatch ({what} is not the dataset's shape)")
    if isinstance(exc, SourceUnavailable):
        refused = _HTTP.search(text)
        if refused and 400 <= int(refused.group(1)) < 500:
            status = int(refused.group(1))
            return held_build.Stop("unavailable", "refused", status, hold=REFUSED_HOLD_S,
                                   note=f"fiscaldata status={status} unavailable ({what} refused)")
        last = _LAST_STATUS.search(text)
        status = int(last.group(1)) if last else (int(refused.group(1)) if refused else None)
        if status == 429:
            return held_build.Stop("failed", "rate_limited", 429, hold=RATE_LIMITED_HOLD_S,
                                   note=f"fiscaldata status=429 failed ({what}: too many requests)")
        if status is None and "timeout" in text.lower():
            return held_build.Stop("failed", "timeout", None, note=f"fiscaldata status=none failed ({what} did not answer in time)")
        return held_build.Stop("failed", "source", status, note=f"fiscaldata status={status or 'none'} failed ({what} did not answer)")
    return held_build.Stop("failed", "error", note=f"fiscaldata status=none failed ({what}: {type(exc).__name__})")


def build(_previous: Optional[dict] = None) -> tuple[dict, str]:
    """ONE build, on the background thread: two requests, one page each. Returns the answer and its
    log line's words; raises `held_build.Stop` for a read that did not work."""
    today = ty.now_et().date()
    since = (today - timedelta(days=WINDOW_DAYS)).isoformat()
    http = _client()
    try:
        upcoming_rows, upcoming_cut = _read(http, UPCOMING_ENDPOINT, filters=[f"{DATE_FIELD}:gte:{today.isoformat()}"],
                                            sort="-record_date")
    except Exception as exc:  # noqa: BLE001 -- classed below; nothing of the error's text is kept
        raise _stop_for(exc, "the upcoming list") from None
    try:
        result_rows, results_cut = _read(http, RESULTS_ENDPOINT, filters=[f"{DATE_FIELD}:gte:{since}"],
                                         sort=f"-{DATE_FIELD}")
    except Exception as exc:  # noqa: BLE001
        raise _stop_for(exc, "the results") from None
    upcoming, dropped_up, upcoming_as_of = shape_upcoming(upcoming_rows, today.isoformat())
    results, dropped_res, through = shape_results(result_rows, today.isoformat())
    if (upcoming_rows and not upcoming and dropped_up == len(upcoming_rows)) or \
            (result_rows and not results and dropped_res == len(result_rows)):
        # rows came, and not one of them carries an auction date and a security: not this dataset
        raise held_build.Stop("unavailable", "shape", 200, hold=SHAPE_HOLD_S,
                              note="fiscaldata status=200 rows=0 shape mismatch (rows without the auction date or the security)")
    days = [d for d in (upcoming_as_of, through) if d]
    answer = {
        "status": "ok", "v": DISK_VERSION, "as_of": max(days) if days else None,
        "upcoming_as_of": upcoming_as_of, "results_through": through, "window_days": WINDOW_DAYS,
        "upcoming": upcoming, "results": results, "dropped": {"upcoming": dropped_up, "results": dropped_res},
        "cut": {"upcoming": upcoming_cut, "results": results_cut},
        "read_at": held_build.now_iso(), "basis": "as_published", "source": SOURCE,
    }
    cut = " cut=" + ",".join(k for k, v in answer["cut"].items() if v) if upcoming_cut or results_cut else ""
    note = (f"fiscaldata status=200 requests=2 rows={len(upcoming_rows)}+{len(result_rows)} "
            f"upcoming={len(upcoming)} results={len(results)} dropped={dropped_up + dropped_res}{cut} "
            f"latest={answer['as_of'] or 'none'}")
    return answer, note


def _valid(held: dict) -> bool:
    return (held.get("status") == "ok" and held.get("v") == DISK_VERSION
            and isinstance(held.get("upcoming"), list) and isinstance(held.get("results"), list))


def refresh_due(checked: float, now=None) -> bool:
    """Pure: a refresh is due once after each weekday 18:15 New York slot."""
    return checked < ty.last_daily_slot(now or ty.now_et()).timestamp()


_held = held_build.HeldBuild("auctions-data", build, lambda _held_answer, checked: refresh_due(checked),
                             disk=("treasury_auctions", f"auctions_v{DISK_VERSION}.json"), version=DISK_VERSION,
                             valid=_valid)


def get_auctions(*, wait_s: Optional[float] = None) -> dict:
    """The route's body. Never builds on the caller's thread."""
    got = _held.get(wait_s=wait_s)
    if got.get("status") != "ok":
        return {**got, "source": SOURCE}
    return {k: v for k, v in got.items() if k != "v"}


def reset_for_tests() -> None:
    _held.reset()

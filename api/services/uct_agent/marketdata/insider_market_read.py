"""MD-1 kind `insider.market` (owner: terminal-data, data wave 13) — the market's insider buying, as held.

Two parts, each with its own state, source and date: the latest open-market purchases across the market (the INS panel,
`GET /api/insider/feed?scope=market`, `api/services/insider.py` `get_market_insider_buys`: the vendor's newest Form 4
filings over the last seven days, largest dollar amount first, at most fifty), and the current insider clusters (the INS
CLUSTER view, `GET /api/insider/clusters`, `api/services/insider_clusters_sec.py`: a stock in which three or more
insiders bought on the open market within ten business days, read each night from the SEC's own Form 4 filings). The
routes' own field names.

⛔ ONLY WHAT THE SERVER ALREADY HOLDS, NEVER A REQUEST (MD-1 §5). The INS route pages the vendor on a cache miss, so this
adapter reads the purchases through `insider_feed_held.held_market_buys()` (the same cache entry, or nothing); the
clusters are read through `insider_clusters_sec.held_answer()`, which never reads the SEC and never starts a run.
provider_calls is always 0. A rail shows the INS route paging the vendor in the same state.

A DOLLAR AMOUNT IS NEVER $0: the purchases list writes a price the filing did not state as 0 (and its amount as 0); here
such a row has no price and no amount, and the rows without one are counted. A cluster's value covers only the purchases
with a price, as the clusters answer says.

NOTHING HELD IS SAID, NEVER "NO BUYING": a part not held is said; both not held is `unavailable`. An empty purchases list
is said as the service holds it: it does not say whether no purchase was found or the vendor's pages failed. The
clusters' coverage (the filing days read, complete or not) is kept and said.

TIME (MD-1 §3): `as_of` is null and each part carries its own date (the purchases: the newest filing date in the list;
the clusters: the newest filing day whose index was read, with the time the list was built); never the time of the read.
Every read is `periodic`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the purchases are the vendor's selection of Form 4 filings (row T-39 of
docs/terminal-research/09-security-licensing-cost/licensing-register.md, its insider trading for member display, "R";
row T-44, its numbers into a model, "No AI clause"); the clusters are built from the SEC's own filings (row T-83,
public domain, "A"), and row T-99, which records the cluster store, says nothing else reads it yet, "no AI lane". No row
of that register clears the vendor's list for a model provider, and the narrower rule is kept for the whole kind. Shown
to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole

KIND = "insider.market"
SOURCE = "uct-insider-market"
DEFAULT_ROWS = 10
MAX_ROWS = 50                                     # insider._MARKET_CAP and insider_clusters_sec.MAX_CLUSTERS (a rail pins both)
WINDOW_DAYS = 7                                   # insider._MARKET_WINDOW_DAYS (a rail pins it)
PURCHASE_FIELDS = ("symbol", "name", "title", "shares", "price", "amount", "date", "filing_date")
CLUSTER_FIELDS = ("ticker", "company", "insiders", "roles", "first_buy", "last_buy", "buys", "filings", "shares", "value",
                  "value_complete", "unpriced_buys", "avg_price", "close", "change_pct")

NOTE_WHAT = ("the market's insider buying as UCT holds it for the INS panel: the latest open-market purchases from Form 4 "
             "filings across the market, and the INS CLUSTER view's stocks in which several insiders bought within a few "
             "days. A record of filings, not advice")
NOTE_AS_OF = ("`as_of` is null: each part carries its own date (purchases: the newest filing {buys}; clusters: the newest "
              "filing day read {clusters}); never the time of the read")
NOTE_BUYS = ("purchases: the vendor's newest Form 4 filings over the last {days} days, open-market purchases only, largest "
             "dollar amount first; the service keeps at most {cap}, so a full list may leave out the smallest")
NOTE_UNPRICED = "{n} of the purchases returned state no price, so they have no dollar amount (never $0)"
NOTE_BUYS_EMPTY = ("the held purchases list is empty: the service holds an empty list both when no open-market purchase was "
                   "found in the window and when the vendor's pages could not be read, and it does not say which. That is "
                   "not the same as no insider buying")
NOTE_CUT = "{part}: {total} are held and the first {shown} are returned: the list is cut from the {end} end"
NOTE_RULE = ("clusters: {n} or more different insiders buying on the open market within {days} business days, from the SEC's "
             "Form 4 filings; joint filers count as one insider. Built {at} (UCT's own time)")
NOTE_COVERAGE = ("clusters: the read of the filing days {start} to {end} is not complete ({read} of {listed} filings read), "
                 "so a cluster may be missing")
NOTE_NO_CLUSTER = "clusters: no stock in what UCT holds has a cluster. That is not the same as no insider buying"
NOTE_PART_NOT_HELD = "{part} are not held on this server yet, and this read never asks for them. Open {code} in UCT, then ask again"
NOTE_NOT_HELD = ("the market's insider buying is not held on this server yet, and this read never asks the vendor or the SEC. "
                 "That is not the same as no insider buying. Open INS in UCT, then ask again")
NOTE_FAILED = "the insider buying read failed; nothing is stated. That is not the same as no insider buying"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission. The kind takes no symbol."""
    if not isinstance(params, dict):
        return "the request must be an object"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer() -> tuple[tuple[Optional[list], str], tuple[Optional[dict], str]]:
    """READ ONLY: ((the purchases, how), (the clusters answer, how)), WITHOUT a request
    (`insider_feed_held.held_market_buys`, `insider_clusters_sec.held_answer`)."""
    from api.services import insider_clusters_sec, insider_feed_held
    return insider_feed_held.held_market_buys(), insider_clusters_sec.held_answer()


def _purchase(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or not isinstance(r.get("symbol"), str) or not r["symbol"].strip():
        return None
    price = _num(r.get("price"))
    price = price if price is not None and price > 0 else None
    shares = _whole(r.get("shares"))
    amount = _num(r.get("amount")) if price is not None else None
    return {"symbol": r["symbol"].strip().upper()[:12], "name": str(r.get("name") or "")[:120] or None,
            "title": str(r.get("title") or "")[:120] or None, "shares": shares if shares else None, "price": price,
            "amount": amount if amount is not None and amount > 0 else None, "date": _day(r.get("date")),
            "filing_date": _day(r.get("filing_date"))}


def _cluster(c: Any) -> Optional[dict]:
    if not isinstance(c, dict) or not _day(c.get("last_buy")):
        return None
    close = c.get("close") if isinstance(c.get("close"), dict) else {}
    roles = c.get("roles") if isinstance(c.get("roles"), dict) else {}
    return {"ticker": c.get("ticker") if isinstance(c.get("ticker"), str) else None,
            "company": str(c.get("company") or "")[:160] or None, "insiders": _whole(c.get("insiders")),
            "roles": {str(k)[:20]: _whole(v) for k, v in roles.items() if _whole(v)},
            "first_buy": _day(c.get("first_buy")), "last_buy": _day(c.get("last_buy")), "buys": _whole(c.get("buys")),
            "filings": _whole(c.get("filings")), "shares": _whole(c.get("shares")), "value": _num(c.get("value")),
            "value_complete": c.get("value_complete") is True, "unpriced_buys": _whole(c.get("unpriced_buys")) or 0,
            "avg_price": _num(c.get("avg_price")),
            "close": {"value": _num(close.get("value")), "date": _day(close.get("date")),
                      "reason": close.get("reason") if isinstance(close.get("reason"), str) else None},
            "change_pct": _num(c.get("change_pct"))}


def read_market(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    rows = params.get("rows", DEFAULT_ROWS)
    try:
        (buys, buys_how), (cl, cl_how) = held_answer()
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    buys_held = buys_how == "held" and isinstance(buys, list)
    cl_held = cl_how == "held" and isinstance(cl, dict)
    if not (buys_held or cl_held):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    try:
        return _answer(params, rows, buys if buys_held else None, cl if cl_held else None)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _answer(params: dict, rows: int, buys: Optional[list], cl: Optional[dict]) -> dict:
    from api.services import insider, insider_clusters_sec
    notes = [NOTE_WHAT]
    later = []
    buys_part: dict = {"state": "not_held"}
    if buys is not None:
        got = [x for x in (_purchase(r) for r in buys) if x]
        shown = got[:rows]
        filed = [x["filing_date"] or x["date"] for x in got if x["filing_date"] or x["date"]]
        buys_part = {"state": "held", "window_days": WINDOW_DAYS, "cap": insider._MARKET_CAP, "rows": shown,
                     "total": len(got), "unpriced": sum(1 for x in got if x["price"] is None),
                     "newest_filing": max(filed) if filed else None}
        later.append(NOTE_BUYS.format(days=WINDOW_DAYS, cap=insider._MARKET_CAP))
        if not got:
            later.append(NOTE_BUYS_EMPTY)
        unpriced_shown = sum(1 for x in shown if x["price"] is None)
        if unpriced_shown:
            later.append(NOTE_UNPRICED.format(n=unpriced_shown))
        if len(got) > len(shown):
            later.append(NOTE_CUT.format(part="purchases", total=len(got), shown=len(shown), end="SMALLEST"))
    else:
        later.append(NOTE_PART_NOT_HELD.format(part="The latest purchases", code="INS"))
    cl_part: dict = {"state": "not_held"}
    if cl is not None:
        got = [x for x in (_cluster(c) for c in cl.get("clusters") or []) if x]
        cov = cl.get("coverage") if isinstance(cl.get("coverage"), dict) else {}
        rules = cl.get("rules") if isinstance(cl.get("rules"), dict) else {}
        total = _whole(cl.get("total"))
        total = total if total is not None and total >= len(got) else len(got)
        cl_part = {"state": "held", "as_of": _day(cl.get("as_of")), "read_at": _read_at(cl.get("read_at")),
                   "rows": got[:rows], "total": total, "truncated": cl.get("truncated") is True or total > rows,
                   "min_insiders": _whole(rules.get("min_insiders")) or insider_clusters_sec.CLUSTER_MIN_INSIDERS,
                   "window_business_days": _whole(rules.get("window_business_days")) or insider_clusters_sec.CLUSTER_WINDOW_DAYS,
                   "coverage": {"complete": cov.get("complete") is True, "from": _day(cov.get("from")), "to": _day(cov.get("to")),
                                "listed": _whole(cov.get("listed")), "read": _whole(cov.get("read"))},
                   "left_out": ["people"]}
        later.append(NOTE_RULE.format(n=cl_part["min_insiders"], days=cl_part["window_business_days"],
                                      at=cl_part["read_at"] or "at a time it does not give"))
        if not cl_part["coverage"]["complete"]:
            later.append(NOTE_COVERAGE.format(start=cl_part["coverage"]["from"] or "a day it does not give",
                                              end=cl_part["coverage"]["to"] or "a day it does not give",
                                              read=cl_part["coverage"]["read"] if cl_part["coverage"]["read"] is not None else "an unstated number",
                                              listed=cl_part["coverage"]["listed"] if cl_part["coverage"]["listed"] is not None else "an unstated number"))
        if not got:
            later.append(NOTE_NO_CLUSTER)
        if total > len(cl_part["rows"]):
            later.append(NOTE_CUT.format(part="clusters", total=total, shown=len(cl_part["rows"]), end="OLDEST"))
    else:
        later.append(NOTE_PART_NOT_HELD.format(part="The insider clusters", code="INS CLUSTER"))
    notes.append(NOTE_AS_OF.format(buys=buys_part.get("newest_filing") or "not held",
                                   clusters=cl_part.get("as_of") or "not held"))
    notes.extend(later)
    data = {"purchases": buys_part, "clusters": cl_part}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=None, source=SOURCE, data=data,
                             notes=notes, provider_calls=0)

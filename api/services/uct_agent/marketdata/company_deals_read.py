"""MD-1 kind `company.deals` (owner: terminal-data, data wave 12) — one stock's deals and index changes, as held.

Two parts, each with its own state, source and read time: the announced mergers and acquisitions that name the stock (as
acquirer or target, each with its filing day and its SEC filing), and its additions to and removals from the S&P 500, the
Nasdaq 100 and the Dow 30 (each with the day, the stock it replaced or was replaced by, and the reason given). The Agent
half of `NVDA MNA` and `NVDA IDXC`, over the answers of `GET /api/research/mergers?sym=` (`api/services/mergers.py`) and
`GET /api/research/index-changes?sym=` (`api/services/index_changes.py`), with the routes' own field names.

⛔ ONLY THE ANSWERS THE SERVICES ALREADY HOLD, NEVER A BUILD (MD-1 §5). Both routes answer through their holds' `get()`,
which STARTS the one background build (a vendor search for the company's name and the latest-deals pages; the three index
lists) when nothing is held or a refresh is due. A turn must not, so this adapter reads through
`company_deals_held.held_mergers()` and `company_deals_held.held_index_changes()`, over the holds' `peek()`. When only the
market's latest-deals list is held (no company search was run for the stock), the deals in it naming the stock's symbol
are stated as exactly that. provider_calls is always 0. A rail shows the routes starting those builds in the same state.

"NO RECORD MATCHED", NEVER "NONE EXIST": a part with no row for the stock says no record in what UCT holds matched it
(and how the deals were looked for), never that the company has no deals or was never in an index. A part not held is
said; both not held is `unavailable`. The routes' own leg states (the name search, each index list) are kept and said.

TIME (MD-1 §3): `as_of` is null and each part carries its own read time (when UCT read the vendor), never the time of the
read; each row carries its own day. Every read is `periodic`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the deals and the index changes are the estimates vendor's lists,
stamped `data_class="mergers"` and `data_class="constituents"`, which no row of
docs/terminal-research/09-security-licensing-cost/licensing-register.md names for these lists (so "U", never inferred);
the nearest rows are T-39 (FMP's index constituents for member display, "R") and T-44 (FMP's numbers into a model, "No AI
clause"). The SEC filing each deal links to is public (row T-83), but the list that found it is the vendor's. No row of
that register clears these lists for a model provider. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _read_at, _whole
from api.services.uct_agent.marketdata.stock_stats_read import check_params, clean_symbol

KIND = "company.deals"
SOURCE = "uct-company-deals"
DEFAULT_ROWS = 10
MAX_ROWS = 50
INDEX_NAMES = {"sp500": "S&P 500", "nasdaq100": "Nasdaq 100", "dow": "Dow 30"}      # index_changes.INDEX_NAMES
SEARCH_WORDS = {"ok": "the company's name was searched and the latest filings were looked through by symbol",
                "none": "the company's name was searched and the latest filings were looked through by symbol",
                "no_name": "the server holds no company name for it, so only the latest filings were looked through, by symbol",
                "not_in_plan": "the name search is not in the site's plan with the vendor, so only the latest filings were looked through",
                "not_configured": "the vendor is not switched on for this server, so only the latest filings were looked through",
                "rate_limited": "the name search was turned away for too many requests, so only the latest filings were looked through",
                "failed": "the name search could not be read, so only the latest filings were looked through",
                "not_run": "no name search has been run for it on this server, so only the deals in the market's latest filings were looked through, by symbol"}
LEG_WORDS = {"none": "the vendor's list answered with no row", "not_in_plan": "it is not in the site's plan with the vendor",
             "not_configured": "the vendor is not switched on for this server", "rate_limited": "it was turned away for too many requests",
             "failed": "it could not be read"}

NOTE_WHAT = ("{symbol}'s deals and index changes as UCT holds them for the MNA and IDXC panels: the announced mergers and "
             "acquisitions that name it, with each SEC filing, and its additions to and removals from the S&P 500, the "
             "Nasdaq 100 and the Dow 30. A record of announcements, not advice")
NOTE_AS_OF = ("`as_of` is null: each part carries its own read time (deals: {deals}; index changes: {changes}), and each "
              "row its own day; never the time of the read")
NOTE_SEARCH = "deals: {how}"
NOTE_NO_DEAL = ("no deal in what UCT holds matched {symbol} ({how}). That is not the same as a company with no deals")
NOTE_OTHER = "{n} more deals matched the name search but name a different company; they are not returned"
NOTE_NO_CHANGE = ("no index change in what UCT holds matched {symbol}. That is not the same as a stock never in an index")
NOTE_LEG = "the {index} list is not stated: {why}"
NOTE_CUT = "{part}: {total} are held and the newest {shown} are returned: the list is cut from the OLD end"
NOTE_PART_NOT_HELD = ("{part} for {symbol} are not held on this server yet, and this read never builds them. Open {code} for "
                      "{symbol} in UCT, then ask again")
NOTE_NOT_HELD = ("{symbol}'s deals and index changes are not held on this server yet, and this read never builds them. That "
                 "is not the same as none. Open MNA or IDXC for {symbol} in UCT, then ask again")
NOTE_FAILED = "the deals and index changes read failed; nothing is stated. That is not the same as none"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    return check_params(params, MAX_ROWS, DEFAULT_ROWS)


def held_answer(sym: str) -> tuple[tuple[Optional[dict], str], tuple[Optional[dict], str]]:
    """READ ONLY: ((the deals answer, how), (the index changes answer, how)), WITHOUT starting a build
    (`company_deals_held.held_mergers`, `company_deals_held.held_index_changes`)."""
    from api.services import company_deals_held as svc
    return svc.held_mergers(sym), svc.held_index_changes(sym)


def _party(p: Any) -> Optional[dict]:
    if not isinstance(p, dict) or not (p.get("sym") or p.get("name")):
        return None
    return {"sym": p.get("sym") if isinstance(p.get("sym"), str) else None,
            "name": p.get("name")[:160] if isinstance(p.get("name"), str) else None}


def _deal(d: Any, sym: str) -> Optional[dict]:
    if not isinstance(d, dict) or not _day(d.get("date")):
        return None
    acq, tgt = _party(d.get("acquirer")), _party(d.get("target"))
    role = "acquirer" if (acq or {}).get("sym") == sym else "target" if (tgt or {}).get("sym") == sym else "named"
    link = d.get("link") if isinstance(d.get("link"), str) and d["link"].startswith("https://") else None
    return {"date": d["date"], "accepted_at": d.get("accepted_at") if isinstance(d.get("accepted_at"), str) else None,
            "role": role, "acquirer": acq, "target": tgt, "link": link}


def _change(c: Any, sym: str) -> Optional[dict]:
    if not isinstance(c, dict) or not _day(c.get("date")) or c.get("index") not in INDEX_NAMES:
        return None
    added, removed = _party(c.get("added")), _party(c.get("removed"))
    return {"index": c["index"], "index_name": INDEX_NAMES[c["index"]], "date": c["date"],
            "side": "added" if (added or {}).get("sym") == sym else "removed", "added": added, "removed": removed,
            "reason": c.get("reason")[:300] if isinstance(c.get("reason"), str) else None}


def read_deals(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym = clean_symbol(params["symbol"])
    rows = params.get("rows", DEFAULT_ROWS)
    try:
        (mg, mg_how), (ix, ix_how) = held_answer(sym)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    mg_held = mg_how in ("held", "latest_only") and isinstance(mg, dict)
    ix_held = ix_how == "held" and isinstance(ix, dict)
    if not (mg_held or ix_held):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(symbol=sym))
    try:
        return _answer(params, sym, rows, mg if mg_held else None, mg_how, ix if ix_held else None)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _answer(params: dict, sym: str, rows: int, mg: Optional[dict], mg_how: str, ix: Optional[dict]) -> dict:
    notes = [NOTE_WHAT.format(symbol=sym)]
    later = []
    deals_part = {"state": "not_held"}
    if mg is not None:
        deals = [x for x in (_deal(d, sym) for d in mg.get("deals") or []) if x]
        search = mg.get("search") if mg.get("search") in SEARCH_WORDS else ("not_run" if mg_how == "latest_only" else "failed")
        deals_part = {"state": mg_how, "read_at": _read_at(mg.get("read_at")), "search": search,
                      "name": mg.get("name") if isinstance(mg.get("name"), str) else None, "deals": deals[:rows],
                      "total": len(deals), "cut": len(deals) > rows or mg.get("cut") is True,
                      "other_companies": _whole(mg.get("other_companies")) or 0, "from_latest": _whole(mg.get("from_latest")) or 0}
        later.append(NOTE_SEARCH.format(how=SEARCH_WORDS[search]))
        if not deals:
            later.append(NOTE_NO_DEAL.format(symbol=sym, how=SEARCH_WORDS[search]))
        if deals_part["other_companies"]:
            later.append(NOTE_OTHER.format(n=deals_part["other_companies"]))
        if len(deals) > rows:
            later.append(NOTE_CUT.format(part="deals", total=len(deals), shown=rows))
    else:
        later.append(NOTE_PART_NOT_HELD.format(part="Deals", symbol=sym, code="MNA"))
    changes_part = {"state": "not_held"}
    if ix is not None:
        changes = [x for x in (_change(c, sym) for c in ix.get("changes") or []) if x]
        legs = ix.get("indexes") if isinstance(ix.get("indexes"), dict) else {}
        leg_states = {i: ((legs.get(i) or {}).get("state") if isinstance(legs.get(i), dict) else None) for i in INDEX_NAMES}
        changes_part = {"state": "held", "read_at": _read_at(ix.get("read_at")), "indexes": leg_states,
                        "changes": changes[:rows], "total": len(changes), "cut": len(changes) > rows or ix.get("cut") is True}
        for i, st in leg_states.items():
            if st not in ("ok", "none"):
                later.append(NOTE_LEG.format(index=INDEX_NAMES[i], why=LEG_WORDS.get(st or "failed", LEG_WORDS["failed"])))
        if not changes:
            later.append(NOTE_NO_CHANGE.format(symbol=sym))
        if len(changes) > rows:
            later.append(NOTE_CUT.format(part="index changes", total=len(changes), shown=rows))
    else:
        later.append(NOTE_PART_NOT_HELD.format(part="Index changes", symbol=sym, code="IDXC"))
    notes.append(NOTE_AS_OF.format(deals=deals_part.get("read_at") or "not held", changes=changes_part.get("read_at") or "not held"))
    notes.extend(later)
    data = {"symbol": sym, "deals": deals_part, "index_changes": changes_part}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=None, source=SOURCE, data=data,
                             notes=notes, provider_calls=0)

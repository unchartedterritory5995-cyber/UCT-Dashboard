"""Mergers and acquisitions for the Terminal's MNA screen: the latest announced deals across the market, and
the deals that name one company.

    get_latest()      -> the body of GET /api/research/mergers
    get_company(sym)  -> the body of GET /api/research/mergers?sym=
      status   'ok' | 'computing' | 'failed' | 'unavailable'
      failed:      reason 'source' (a 5xx, a timeout, a dropped connection, the local FMP budget spent) |
                   'rate_limited'
      unavailable: reason 'not_in_plan' (the provider refused: 401, 402, 403, 404, or its 24-hour refused
                   window) | 'not_configured'
      ok (latest):  scope 'latest', read_at, source, check, pages_read, cut (the last page read was full,
                    so the feed holds older deals than these), dropped, deals
      ok (company): scope 'company', sym, name (the company name the server holds, or None), read_at,
                    source, check, search ('ok' | 'none' | 'no_name' | 'not_in_plan' | 'not_configured' |
                    'rate_limited' | 'failed'), from_latest (deals found in the held latest list),
                    other_companies (rows the name search matched that name another company: not shown),
                    dropped, deals
      a deal: {date (YYYY-MM-DD), accepted_at (the filing's acceptance time as sent, New York wall time),
               acquirer {sym, name, cik, covered}, target {sym, name, cik, covered}, link (an https
               address on sec.gov, or None)}   newest first. `covered` is True when the symbol is in the
               site's universe (a link that opens a board); a target is often private, with no symbol.

THE SOURCE is Financial Modeling Prep, through the one adapter (`fmp_client`):
`get_mergers_acquisitions_latest` (`/stable/mergers-acquisitions-latest?page=&limit=`) and
`search_mergers_acquisitions` (`/stable/mergers-acquisitions-search?name=`). The repo named no FMP M&A
path before; both are FMP's stable docs' own (read 2026-11-21 as a web search indexes them: the docs site
refuses automated reading). Licence: the adapter stamps `data_class="mergers"`, unregistered, so "U",
as FMP's IPO calendar is; nothing gates display on that stamp.

FIELDS READ, NOT CONFIRMED AGAINST A LIVE ANSWER (the docs' sample row, as indexed): `symbol`,
`companyName`, `cik` (the acquirer), `targetedCompanyName`, `targetedCik`, `targetedSymbol` (the target;
the last two read only if present), `transactionDate`, `acceptedDate`, `link`. Every other field is
dropped. A row without a date (`transactionDate`, else the day of `acceptedDate`) or without the
acquirer's symbol is skipped and counted. Exact repeats are kept once.

WHICH DEALS NAME A COMPANY. The search takes a NAME, so the stock's name is the one the server already
holds (`held_reads.held_name`, never a provider call); with none held there is no search (`no_name`). A
row the search returns is kept only when its acquirer or target symbol IS the stock, or its acquirer or
target name, with the usual company suffixes ("Inc", "Corp", "Ltd", ...) and punctuation set aside,
equals the stock's name read the same way; any other row it matched is counted, not shown. Deals in the
held latest list that name the stock's symbol are added.

IT NEVER ASKS THE PROVIDER ON A MEMBER'S REQUEST. The answers are held in this module through the house
hold-and-build way (`held_build.HeldBuild` for the latest list, on this server's disk too;
`held_reads.KeyedHeld` per company): one background build; a request with nothing held waits a few
seconds and is otherwise told `computing`. The latest list is refreshed at most once an hour
(`LATEST_TTL_S`; the feed's own cycle is hours) and reads at most `LATEST_PAGES` pages of `PAGE_SIZE`; a
company's deals at most every `COMPANY_TTL_S` (one search each). A refusal is held for six hours, a
failure for five minutes.
"""
from __future__ import annotations

import re
import time
from typing import Any, Optional

from api.services import held_build
from api.services import held_reads
from api.services.held_reads import KeyedHeld, fmp_leg

SOURCE = "Financial Modeling Prep"
DISK_VERSION = 1
PAGE_SIZE = 100
LATEST_PAGES = 3
LATEST_TTL_S = 3600
COMPANY_TTL_S = 6 * 3600
REFUSED_HOLD_S = 6 * 3600
FAILED_HOLD_S = 300
COMPANY_CAP = 200
MAX_KEYS = 64
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}")
_SUFFIXES = {"inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "plc", "llc", "lp",
             "holdings", "holding", "group", "sa", "nv", "ag", "the", "class", "a", "b", "common", "stock", "ordinary",
             "shares"}


def _text(v: Any) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def _sym(v: Any) -> Optional[str]:
    s = (_text(v) or "").upper()
    return s if re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,11}", s) else None


def _link(v: Any) -> Optional[str]:
    s = _text(v) or ""
    return s if re.match(r"^https://(www\.)?sec\.gov/", s) and len(s) <= 400 and " " not in s else None


def name_key(name: Optional[str]) -> str:
    """A company name read for matching: lower case, punctuation and the usual suffixes set aside."""
    words = re.sub(r"[^a-z0-9 ]+", " ", (name or "").lower()).split()
    return " ".join(w for w in words if w not in _SUFFIXES)


def shape_deals(raw: Any, followed: frozenset) -> tuple[list[dict], int]:
    """The provider's rows -> deals newest first, and how many rows were skipped."""
    out, seen, dropped = [], set(), 0
    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict):
            dropped += 1
            continue
        accepted = _text(r.get("acceptedDate"))
        day = _text(r.get("transactionDate")) or accepted or ""
        day = day[:10] if _ISO_DAY.match(day) else None
        acq_sym = _sym(r.get("symbol"))
        if not day or not acq_sym:
            dropped += 1
            continue
        tgt_sym = _sym(r.get("targetedSymbol"))
        deal = {
            "date": day, "accepted_at": accepted[:19] if accepted else None,
            "acquirer": {"sym": acq_sym, "name": _text(r.get("companyName")), "cik": _text(r.get("cik")),
                         "covered": acq_sym in followed},
            "target": {"sym": tgt_sym, "name": _text(r.get("targetedCompanyName")), "cik": _text(r.get("targetedCik")),
                       "covered": bool(tgt_sym) and tgt_sym in followed},
            "link": _link(r.get("link")),
        }
        key = (day, acq_sym, deal["target"]["name"], tgt_sym, deal["link"])
        if key in seen:
            continue
        seen.add(key)
        out.append(deal)
    out.sort(key=lambda d: (d["date"], d["accepted_at"] or ""), reverse=True)
    return out, dropped


def _stop_for(state: str, status: Optional[int], what: str) -> held_build.Stop:
    if state in ("not_in_plan", "not_configured"):
        return held_build.Stop("unavailable", state, status, hold=REFUSED_HOLD_S, note=f"fmp {what} {state} ({status})")
    if state == "rate_limited":
        return held_build.Stop("failed", "rate_limited", status, hold=FAILED_HOLD_S, note=f"fmp {what} rate limited")
    return held_build.Stop("failed", "source", status, hold=FAILED_HOLD_S, note=f"fmp {what} failed ({status})")


def build_latest(_previous: Optional[dict] = None) -> tuple[dict, str]:
    """ONE build: up to `LATEST_PAGES` pages, stopping at a short or empty page."""
    from api.services import fmp_client as fc

    rows: list = []
    pages = 0
    last_full = False
    for page in range(LATEST_PAGES):
        state, value, status = fmp_leg(fc.get_mergers_acquisitions_latest, page=page, limit=PAGE_SIZE)
        if state == "none":
            last_full = False
            break
        if state != "ok":
            if page == 0:
                raise _stop_for(state, status, "mergers latest")
            last_full = False      # a later page failed: keep what was read, and say the list may be short
            break
        pages += 1
        got = value if isinstance(value, list) else []
        rows.extend(got)
        last_full = len(got) >= PAGE_SIZE
        if not last_full:
            break
    deals, dropped = shape_deals(rows, held_reads.site_universe())
    answer = {"status": "ok", "v": DISK_VERSION, "scope": "latest", "read_at": held_build.now_iso(), "source": SOURCE,
              "pages_read": pages, "cut": last_full, "dropped": dropped, "deals": deals}
    return answer, f"fmp mergers latest pages={pages} rows={len(rows)} deals={len(deals)} dropped={dropped}"


def _latest_due(answer: dict, checked: float) -> bool:
    return (time.time() - float(checked or 0)) >= LATEST_TTL_S


def _valid_latest(held: dict) -> bool:
    return held.get("status") == "ok" and held.get("v") == DISK_VERSION and isinstance(held.get("deals"), list)


_latest = held_build.HeldBuild("mergers-latest", build_latest, _latest_due, disk=("mergers", f"latest_v{DISK_VERSION}.json"),
                               version=DISK_VERSION, valid=_valid_latest)


def _names_company(deal: dict, sym: str, key: str) -> bool:
    if deal["acquirer"]["sym"] == sym or deal["target"]["sym"] == sym:
        return True
    return bool(key) and key in (name_key(deal["acquirer"]["name"]), name_key(deal["target"]["name"]))


def _company_build_for(sym: str):
    def build(_previous: Optional[dict] = None) -> tuple[dict, str]:
        from api.services import fmp_client as fc

        name = held_reads.held_name(sym)
        key = name_key(name)
        followed = held_reads.site_universe()
        found, dropped, other = [], 0, 0
        if not key:
            search = "no_name"
        else:
            search, value, status = fmp_leg(fc.search_mergers_acquisitions, name)
            if search == "ok":
                deals, dropped = shape_deals(value, followed)
                for d in deals:
                    if _names_company(d, sym, key):
                        found.append(d)
                    else:
                        other += 1
        latest = _latest.peek() or {}
        from_latest = 0
        for d in latest.get("deals") or []:
            if d["acquirer"]["sym"] == sym or d["target"]["sym"] == sym:
                found.append(d)
                from_latest += 1
        if search in ("failed", "rate_limited") and not found:
            raise _stop_for(search, None, f"mergers search {sym}")
        merged, seen = [], set()
        for d in sorted(found, key=lambda d: (d["date"], d["accepted_at"] or ""), reverse=True):
            k = (d["date"], d["acquirer"]["sym"], d["target"]["name"], d["target"]["sym"], d["link"])
            if k not in seen:
                seen.add(k)
                merged.append(d)
        answer = {"status": "ok", "scope": "company", "sym": sym, "name": name, "read_at": held_build.now_iso(),
                  "source": SOURCE, "search": search, "from_latest": from_latest, "other_companies": other,
                  "dropped": dropped, "cut": len(merged) > COMPANY_CAP, "deals": merged[:COMPANY_CAP]}
        return answer, f"fmp mergers company {sym} search={search} deals={len(merged)} other={other}"

    return build


def _company_due(answer: dict, checked: float) -> bool:
    ttl = FAILED_HOLD_S if (answer or {}).get("search") in ("failed", "rate_limited") else COMPANY_TTL_S
    return (time.time() - float(checked or 0)) >= ttl


def _valid_company(held: dict) -> bool:
    return held.get("status") == "ok" and isinstance(held.get("deals"), list)


_company = KeyedHeld("mergers-company", _company_build_for, _company_due, max_keys=MAX_KEYS, valid=_valid_company)


def get_latest(*, wait_s: Optional[float] = None) -> dict:
    """The route's body for the market view. Never builds on the caller's thread."""
    got = _latest.get(wait_s=wait_s)
    if got.get("status") != "ok":
        return {**got, "scope": "latest", "source": SOURCE}
    return {k: v for k, v in got.items() if k != "v"}


def get_company(sym: str, *, wait_s: Optional[float] = None) -> dict:
    """The route's body for one company. Never builds on the caller's thread. Asking for a company also
    lets the latest list be read (its own hold), so the company's deals in it are found."""
    _latest.get(wait_s=0)
    got = _company.get(sym, wait_s=wait_s)
    if got.get("status") != "ok":
        return {**got, "scope": "company", "sym": sym, "source": SOURCE}
    return got


def reset_for_tests() -> None:
    _latest.reset()
    _company.reset()

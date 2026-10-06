"""COV-05 -- People: officers, key executives, their compensation, and the
insider roles they declare to the SEC. The Research > People tab.

Sources, each named on every row it produces:
  * FMP `/stable/key-executives`               name, title, pay, year born
  * FMP `/stable/governance-executive-compensation`
                                               the proxy's summary compensation
                                               table, one officer-year per row,
                                               each with its filing date + SEC link
  * SEC EDGAR Form 4 (`edgar_ownership`)       the role each reporting owner
                                               declares (director, officer + title,
                                               10% owner), with the accession

Measured, and shown rather than smoothed over (live probe 2026-10-02):
FMP's `titleSince` was null on every executive of AAPL, MSFT and CELH, and
`pay` is null for about half of them and never says which year it covers. So
"since" is `unavailable` with that reason, a null pay is `unavailable` with a
reason, and a pay figure is labelled "year not stated by FMP". Nothing is ever
an empty cell.

Request path. FMP is read synchronously, the way every existing Research tab
reads it (Estimates, Ownership): two calls, a 10 s ceiling each, the result
cached 24 h (10 min on a failure). EDGAR is cache-only: `form4_snapshot` never
touches the network on a request; a miss answers `pending` (and queues one
refresh only when EDGAR_OWNERSHIP_ENABLED is armed -- that module's own gate).

DARK behind RESEARCH_PEOPLE_ENABLED (unset = the route 404s, the tab is absent).
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from api.services.cache import cache

_logger = logging.getLogger(__name__)

ENABLED_ENV = "RESEARCH_PEOPLE_ENABLED"
_CACHE_PREFIX = "research_people::"
_TTL_OK = 24 * 3600
_TTL_FAIL = 600
_FMP_TIMEOUT = 10

SRC_EXECS = "FMP /stable/key-executives"
SRC_COMP = "FMP /stable/governance-executive-compensation (proxy summary compensation table)"
SRC_EDGAR = "SEC EDGAR Form 4"

_HONORIFICS = {"mr", "mrs", "ms", "dr", "jr", "sr", "ii", "iii", "iv", "esq", "cpa", "phd", "md"}


def is_enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def name_tokens(s: Any) -> list[str]:
    """Lowercase alphabetic tokens, honorifics and initials dropped."""
    toks = re.findall(r"[a-z]+", str(s or "").lower())
    return [t for t in toks if len(t) > 1 and t not in _HONORIFICS]


def same_person(exec_name: str, other: str) -> bool:
    """The executive's LAST name appears in `other` (any order: EDGAR writes
    "COOK TIMOTHY D", a proxy writes "Tim Cook Chief Executive Officer") AND some
    token there shares the first three letters of the FIRST name ("Tim" /
    "Timothy", "Kate" / "Katherine"). Matching is within ONE issuer's officers,
    so this is a join, not a search; a missed match shows as no link, never as a
    wrong one."""
    t = name_tokens(exec_name)
    if len(t) < 2:
        return False
    o = name_tokens(other)
    first = t[0][:3]
    return t[-1] in o and any(len(x) >= 3 and x[:3] == first for x in o if x != t[-1])


# ── FMP reads ───────────────────────────────────────────────────────────────

def _fmp(fn_name: str, sym: str) -> tuple[str, Any, Optional[str]]:
    """(state, value, reason). state: ok | not_found | unavailable."""
    from api.services import fmp_client
    try:
        res = getattr(fmp_client, fn_name)(sym, timeout=_FMP_TIMEOUT)
    except fmp_client.FMPNotFound:
        return "not_found", None, "FMP returned no rows for this symbol"
    except fmp_client.FMPNotConfigured:
        return "unavailable", None, "FMP is not configured on this server"
    except Exception as exc:  # noqa: BLE001 -- recorded as a state with its class, never silent
        _logger.warning("research_people %s failed for %s: %s", fn_name, sym, exc)
        return "unavailable", None, f"FMP could not be read ({type(exc).__name__})"
    if res.degraded is not None:
        return "unavailable", None, f"FMP refused this endpoint recently ({res.degraded})"
    return "ok", res.value, None


def shape_executives(raw: Any, *, as_of: str) -> list[dict]:
    rows = []
    for e in raw if isinstance(raw, list) else []:
        if not isinstance(e, dict) or not e.get("name"):
            continue
        unavailable = {}
        since = e.get("titleSince")
        if not since:
            unavailable["since"] = "FMP does not report when this officer took the title"
        pay = e.get("pay")
        if pay is None:
            unavailable["pay"] = "FMP reports no pay figure for this officer"
        rows.append({
            "name": e["name"],
            "title": e.get("title") or None,
            "since": since or None,
            "pay": pay,
            "pay_currency": e.get("currencyPay") or None,
            "pay_note": "year not stated by FMP" if pay is not None else None,
            "year_born": e.get("yearBorn"),
            "active": e.get("active"),
            "source": SRC_EXECS,
            "as_of": as_of,
            "unavailable": unavailable,
        })
    return rows


_COMP_FIELDS = (("salary", "salary"), ("bonus", "bonus"), ("stockAward", "stock_award"),
                ("optionAward", "option_award"), ("incentivePlanCompensation", "incentive"),
                ("allOtherCompensation", "other"), ("total", "total"))


def shape_compensation(raw: Any) -> dict:
    """The NEWEST fiscal year's summary compensation table, every row citing
    the proxy it came from."""
    rows = [r for r in (raw if isinstance(raw, list) else []) if isinstance(r, dict) and r.get("year")]
    if not rows:
        return {"year": None, "rows": []}
    year = max(int(r["year"]) for r in rows)
    out = []
    seen = set()
    for r in rows:
        if int(r["year"]) != year:
            continue
        k = (r.get("nameAndPosition"), r.get("total"), r.get("filingDate"))
        if k in seen:          # FMP repeats a row when a proxy is re-filed
            continue
        seen.add(k)
        row = {"name_and_position": r.get("nameAndPosition") or "Not stated", "year": year,
               "filing_date": (r.get("filingDate") or "")[:10] or None, "url": r.get("link") or None,
               "source": SRC_COMP}
        for src, dst in _COMP_FIELDS:
            row[dst] = r.get(src)
        out.append(row)
    out.sort(key=lambda r: (r["total"] is None, -(r["total"] or 0)))
    return {"year": year, "rows": out}


def _fmp_part(sym: str) -> dict:
    """The cached FMP half. Never raises."""
    key = _CACHE_PREFIX + sym
    hit = cache.get(key)
    if hit is not None:
        return hit
    as_of = _today()
    st_e, raw_e, why_e = _fmp("get_key_executives", sym)
    st_c, raw_c, why_c = _fmp("get_executive_compensation", sym)
    execs = {"state": st_e, "source": SRC_EXECS, "as_of": as_of,
             "rows": shape_executives(raw_e, as_of=as_of) if st_e == "ok" else None}
    if why_e:
        execs["reason"] = why_e
    if st_e == "ok" and not execs["rows"]:
        execs.update(state="not_found", rows=None, reason="FMP returned no named executives")
    comp_shape = shape_compensation(raw_c) if st_c == "ok" else {"year": None, "rows": []}
    comp = {"state": st_c, "source": SRC_COMP, "as_of": as_of, "year": comp_shape["year"],
            "rows": comp_shape["rows"] if st_c == "ok" else None}
    if why_c:
        comp["reason"] = why_c
    if st_c == "ok" and not comp["rows"]:
        comp.update(state="not_found", rows=None, reason="FMP returned no compensation table rows")
    part = {"executives": execs, "compensation": comp}
    ok = st_e in ("ok", "not_found") and st_c in ("ok", "not_found")
    cache.set(key, part, _TTL_OK if ok else _TTL_FAIL)
    return part


# ── EDGAR (cache-only) ──────────────────────────────────────────────────────

def _insider_roles(sym: str, snapshot_fn: Optional[Callable[[str], dict]] = None) -> dict:
    from api.services import edgar_ownership as eo
    base = {"source": SRC_EDGAR, "window_days": eo.WINDOW_DAYS, "rows": None}
    snap = (snapshot_fn or eo.form4_snapshot)(sym) or {}
    state = snap.get("state")
    if state in eo.READABLE_STATES:
        roles = snap.get("owner_roles")
        if roles is None:
            return {**base, "state": "unavailable",
                    "reason": "the cached Form 4 read predates role capture; it refreshes within 4 hours"}
        out = {**base, "state": state, "since": snap.get("since"), "rows": [dict(r, source=SRC_EDGAR) for r in roles]}
        if state == "partial":
            out["reason"] = (f"{len(snap.get('filings_unread') or [])} Form 4 filing(s) in the window were not read"
                             if snap.get("filings_unread") else "the window was cut at the filing cap")
        if not roles:
            out["state"] = "none_in_window"
            out["reason"] = f"no Form 4 was filed for this issuer in the last {eo.WINDOW_DAYS} days"
        return out
    if state == "pending":
        if not eo.is_enabled():
            return {**base, "state": "unavailable",
                    "reason": "EDGAR Form 4 reading is switched off on this server (EDGAR_OWNERSHIP_ENABLED)"}
        return {**base, "state": "pending", "reason": "the Form 4 read is queued; it appears on a later visit"}
    if state == "not_found":
        return {**base, "state": "not_found", "reason": "no SEC filer could be matched to this symbol"}
    return {**base, "state": "unavailable", "reason": f"SEC EDGAR could not be read ({snap.get('detail') or 'unknown'})"}


# ── the payload ─────────────────────────────────────────────────────────────

def people(sym: str, *, snapshot_fn: Optional[Callable[[str], dict]] = None) -> dict:
    sym = (sym or "").upper().strip()
    # A FUND HAS NO OFFICERS, NO PROXY PAY AND NO FORM 4 INSIDERS. Asked anyway, FMP
    # answers "no rows" and the tab read "Unavailable: FMP returned no rows for this
    # symbol" -- a vendor failure that was not one. The search index classifies the
    # symbol in memory; an unknown type is NOT a fund and reads the vendors as before.
    from api.services import ticker_search_index
    fund = ticker_search_index.fund_not_applicable(
        sym, "funds have no executives, proxy pay or Form 4 insiders")
    if fund:
        na = {"state": "not_applicable", "rows": None, "reason": fund["reason"], "as_of": _today()}
        return {"ticker": sym, "not_applicable": fund["not_applicable"],
                "executives": {**na, "source": SRC_EXECS},
                "compensation": {**na, "source": SRC_COMP, "year": None},
                "insider_roles": {**na, "source": SRC_EDGAR}}
    fmp_part = _fmp_part(sym)
    execs = dict(fmp_part["executives"])
    comp = fmp_part["compensation"]
    roles = _insider_roles(sym, snapshot_fn)

    if execs.get("rows"):
        linked = []
        for e in execs["rows"]:
            e = dict(e)
            c = next((r for r in comp.get("rows") or [] if same_person(e["name"], r["name_and_position"])), None)
            e["comp_total"] = c["total"] if c else None
            e["comp_year"] = c["year"] if c else None
            e["comp_filing_date"] = c["filing_date"] if c else None
            r = next((x for x in roles.get("rows") or [] if same_person(e["name"], x["name"])), None)
            e["insider_role"] = r["role"] if r else None
            e["insider_accession"] = r["accession"] if r else None
            linked.append(e)
        execs["rows"] = linked
    return {"ticker": sym, "executives": execs, "compensation": comp, "insider_roles": roles}

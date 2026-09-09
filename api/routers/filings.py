"""SEC Filings router — wraps sec_filings.recent_filings.

GET /api/filings/{ticker}?count=10
Returns: {ticker, company, cik, form_filter, count, filings: [{form, filed, period, accession, url}]}

Empty-safe; never raises.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Query

from api.services.sec_filings import recent_filings

_log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/filings/{ticker}")
def get_filings(ticker: str, count: int = Query(default=10, ge=1, le=50)):
    """Recent SEC filings for a ticker.

    Returns at most `count` filings (newest-first). Empty-safe: returns
    {ticker, filings: []} on any failure, never raises.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"ticker": sym, "filings": []}
    try:
        return recent_filings(sym, count=count)
    except Exception as e:
        _log.warning("recent_filings failed for %s: %s", sym, e)
        return {"ticker": sym, "filings": []}


# The forms a researcher reading a financial statement actually wants, in the
# order they want them. The raw feed is dominated by Form 4 / 144 insider
# paperwork, which is noise in this context.
_PRIMARY_FORMS = [
    ("10-K", "Annual report", "Audited annual financial statements."),
    ("20-F", "Annual report", "Annual report for a foreign private issuer."),
    ("40-F", "Annual report", "Annual report for a Canadian issuer."),
    ("10-Q", "Quarterly report", "Unaudited quarterly financial statements."),
    ("8-K", "Current report", "Material events — earnings releases are filed here."),
    ("DEF 14A", "Proxy statement", "Executive compensation and governance."),
]


@router.get("/api/filings/{ticker}/primary")
def get_primary_filings(ticker: str):
    """The latest of each PRIMARY filing type — the source documents behind the
    Financials tab.

    Reuses `recent_filings`, whose cache key is the CIK (the whole submissions
    document), so filtering per form costs in-process work and not extra SEC
    requests. Companies absent from EDGAR (non-US issuers, ETFs) get an empty
    list and an honest reason rather than a fabricated link.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"ticker": sym, "filings": []}
    # One call PER FORM. The filter is applied before the count cap, so an annual
    # report is found even for a company that files hundreds of Form 4s a year —
    # and because `recent_filings` caches the submissions document per CIK, all
    # of these resolve from one SEC request.
    base = None
    out = []
    try:
        for form, label, blurb in _PRIMARY_FORMS:
            res = recent_filings(sym, form_type=form, count=1) or {}
            if res.get("error"):
                base = res
                break
            base = base or res
            hit = next((f for f in (res.get("filings") or []) if f.get("url")), None)
            if hit:
                out.append({"form": hit.get("form"), "label": label, "blurb": blurb,
                            "filed": hit.get("filed"), "period": hit.get("period"),
                            "url": hit.get("url"), "direct": True})
    except Exception as e:  # noqa: BLE001
        _log.warning("primary filings failed for %s: %s", sym, e)
        return {"ticker": sym, "filings": [], "reason": "fetch_failed"}

    if base is not None and base.get("error"):
        return {"ticker": sym, "filings": [], "reason": "not_in_edgar",
                "cik": None, "company": None}

    cik = (base or {}).get("cik")

    # EDGAR pages a heavy filer's older submissions into separate files, so the
    # "recent" block for a company like JPMorgan (thousands of structured-note
    # filings a year) can span only a few months and contain no annual report at
    # all. Rather than fabricate a document URL or fetch more pages, fall back to
    # SEC's own type-filtered index — still authoritative, one click from the
    # filing, and free. Marked `direct: false` so the UI can label it a search.
    if cik:
        have = {f["label"] for f in out}
        for form, label in (("10-K", "Annual report"), ("10-Q", "Quarterly report")):
            if label in have:
                continue
            out.append({
                "form": form, "label": label,
                "blurb": f"Browse this company's {form} filings on EDGAR.",
                "filed": None, "period": None, "direct": False,
                "url": ("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany"
                        f"&CIK={cik}&type={form}&dateb=&owner=include&count=10"),
            })
    return {
        "ticker": sym,
        "company": (base or {}).get("company"),
        "cik": cik,
        "filings": out,
        "edgar_url": (f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany"
                      f"&CIK={cik}&type=&dateb=&owner=include&count=40") if cik else None,
    }

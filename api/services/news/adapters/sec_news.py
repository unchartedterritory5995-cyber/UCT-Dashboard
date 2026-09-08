"""SEC EDGAR adapter — the universal primary-source lane.

The only source in the stack with guaranteed coverage of every listed company:
every issuer files, filings appear within 1-3 minutes of acceptance, and the
content is public domain and explicitly reusable.

Builds on the existing `api/services/sec_filings.py` (CIK map + submissions
API + declared User-Agent) rather than re-implementing EDGAR access, so the
10 req/s courtesy limit and UA declaration stay in one place.
"""

from __future__ import annotations

import logging
from datetime import datetime, time as dtime, timezone

_log = logging.getLogger(__name__)

# Forms worth surfacing in a company news feed. Everything else is filed noise
# for this purpose (Form 3/4/5, 144, 13F-HR, ARS, CERT...).
#
# Form 4 is deliberately EXCLUDED even though it is material: MU alone filed
# two in its last eight, and a news wire that fills with individual insider
# transactions stops reading as news. The Ownership tab already presents
# them properly, aggregated and classified.
FORM_LABELS = {
    "8-K": "Current report",
    "10-Q": "Quarterly report",
    "10-K": "Annual report",
    "6-K": "Foreign issuer report",
    "20-F": "Annual report (foreign issuer)",
    "S-1": "Registration statement",
    "S-3": "Shelf registration",
    "424B5": "Prospectus supplement",
    "SC 13D": "Activist stake",
    "SC 13G": "Passive stake",
    "DEF 14A": "Proxy statement",
}
DISPLAY_FORMS = frozenset(FORM_LABELS)

# 8-K item codes carry the actual news. Kept short and plain-language (§31):
# the reader wants "results" or "CEO change", not "Item 5.02".
ITEM_LABELS = {
    "1.01": "Material agreement", "1.02": "Agreement terminated",
    "2.01": "Completion of acquisition", "2.02": "Results of operations",
    "2.03": "Financial obligation", "2.05": "Restructuring costs",
    "2.06": "Material impairment", "3.01": "Listing / compliance",
    "3.02": "Unregistered equity sale", "4.01": "Auditor change",
    "4.02": "Non-reliance on prior statements", "5.01": "Change in control",
    "5.02": "Executive or director change", "5.03": "Bylaw amendment",
    "5.07": "Shareholder vote", "7.01": "Regulation FD disclosure",
    "8.01": "Other events",
}


def _parse_date(raw: str) -> datetime | None:
    if not raw:
        return None
    s = str(raw).strip()
    try:
        if len(s) == 10:
            d = datetime.strptime(s, "%Y-%m-%d")
            # EDGAR gives a filing DATE, not a time. Anchor at 16:30 ET, just
            # after the close, so a filing sorts after the same day's intraday
            # news instead of ahead of it at midnight.
            return datetime.combine(d.date(), dtime(20, 30), tzinfo=timezone.utc)
        s = s.replace("Z", "+00:00")
        d = datetime.fromisoformat(s)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


_ACRONYMS = {"Inc", "Corp", "Co", "Ltd", "Plc", "Llc", "Lp", "Nv", "Sa", "Ag",
             "Se", "Usa", "Us", "Uk", "Ai", "Nv."}


def _nice_company(raw: str, symbol: str) -> str:
    """SEC names arrive SHOUTING: 'MICRON TECHNOLOGY INC'.

    Prefer the properly-cased name our own ticker metadata already holds, and
    fall back to title-casing EDGAR's. A headline in block capitals reads as a
    system message rather than as news.
    """
    try:
        from api.services.news import subject as _subj
        nice = (_subj.company_name(symbol) or "").strip()
        if nice:
            return nice
    except Exception:
        pass
    name = (raw or "").strip()
    if not name:
        return symbol
    if name.isupper():
        parts = []
        for w in name.split():
            t = w.title()
            # 'JPMORGAN' -> 'JPMorgan', not 'Jpmorgan'.
            if w.startswith("JP") and len(w) > 2:
                t = "JP" + w[2:].title()
            parts.append(t)
        name = " ".join(parts)
    return name


def _headline(symbol: str, form: str, items: str, company: str) -> str:
    """A plain-language headline. Never fabricated — every part is filed fact.

    Deliberately does NOT repeat the company or the form. The panel is
    company-scoped and the row's source line already reads "SEC · 8-K", so
    "Micron Technology Inc files 8-K — Results of operations" printed the
    company once and the form twice. What the reader actually wants is the
    thing that happened, which is the 8-K item.
    """
    codes = [c.strip() for c in (items or "").split(",") if c.strip()]
    named = [ITEM_LABELS[c] for c in codes if c in ITEM_LABELS]
    if named:
        return named[0]
    return FORM_LABELS.get(form, form)


_ARCHIVE_CACHE: dict[str, list[dict]] = {}


def _archive_filings(symbol: str) -> list[dict]:
    """Older filings from EDGAR's overflow shards.

    EDGAR's `filings.recent` block holds only the most recent ~1,000 filings.
    JPMorgan posts hundreds of 424B2 structured-note supplements, so its entire
    recent block is prospectus paperwork and it contains NO 8-K, 10-Q or 10-K
    at all — the ticker rendered with zero news. The submissions document lists
    additional JSON shards in `filings.files`; this reads the first of those.

    Only called when the recent block yielded nothing, so prolific filers pay
    one extra request and ordinary companies pay none. Failures return [].
    """
    sym = symbol.upper()
    if sym in _ARCHIVE_CACHE:
        return _ARCHIVE_CACHE[sym]
    rows: list[dict] = []
    try:
        import requests
        from api.services import sec_filings as sf

        cik = sf._ticker_to_cik(sym)                   # noqa: SLF001
        if not cik:
            _ARCHIVE_CACHE[sym] = rows
            return rows
        head = requests.get(
            f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json",
            headers={"User-Agent": sf._UA}, timeout=15)  # noqa: SLF001
        head.raise_for_status()
        files = ((head.json().get("filings") or {}).get("files") or [])[:2]
        for meta in files:
            name = (meta or {}).get("name")
            if not name:
                continue
            r = requests.get(f"https://data.sec.gov/submissions/{name}",
                             headers={"User-Agent": sf._UA}, timeout=20)  # noqa: SLF001
            r.raise_for_status()
            blk = r.json() or {}
            forms = blk.get("form") or []
            dates = blk.get("filingDate") or []
            accs = blk.get("accessionNumber") or []
            docs = blk.get("primaryDocument") or []
            items_col = blk.get("items") or []
            for i, form in enumerate(forms):
                if (form or "").strip() not in DISPLAY_FORMS:
                    continue
                acc = accs[i] if i < len(accs) else ""
                doc = docs[i] if i < len(docs) else ""
                nodash = (acc or "").replace("-", "")
                rows.append({
                    "form": form,
                    "filed": dates[i] if i < len(dates) else "",
                    "accession": acc,
                    "items": items_col[i] if i < len(items_col) else "",
                    "url": (f"https://www.sec.gov/Archives/edgar/data/"
                            f"{int(cik)}/{nodash}/{doc}" if nodash and doc else ""),
                })
                if len(rows) >= 60:
                    break
            if len(rows) >= 60:
                break
    except Exception as e:                             # noqa: BLE001
        _log.warning("sec archive %s: %s", sym, e)
    _ARCHIVE_CACHE[sym] = rows
    return rows


def fetch(symbol: str, *, count: int = 30) -> list[dict]:
    """Recent displayable filings for one ticker, in the shared raw shape.

    Queries PER FORM rather than taking the last N filings of any kind. A
    prolific filer buries its news: JPMorgan posts hundreds of 424B2 structured
    -note supplements, so an unfiltered pull of its 60 most recent filings
    contained not one 8-K and the ticker came back with zero news. Per-form
    queries are effectively free — `sec_filings` caches the whole submissions
    document per CIK and filters it in memory, so this is ONE HTTP request per
    ticker regardless of how many forms we ask for.

    Returns [] on any failure: one source failing must never blank the feed.
    """
    sym = (symbol or "").upper().strip()
    if not sym:
        return []
    try:
        from api.services import sec_filings
    except Exception as e:                            # noqa: BLE001
        _log.warning("sec import failed: %s", e)
        return []

    company = ""
    rows: list[dict] = []
    seen_acc: set[str] = set()
    for form in ("8-K", "10-Q", "10-K", "SC 13D", "DEF 14A", "6-K", "20-F",
                 "S-1", "424B5", "SC 13G", "S-3"):
        try:
            data = sec_filings.recent_filings(sym, form_type=form, count=12) or {}
        except Exception as e:                        # noqa: BLE001
            _log.warning("sec fetch %s %s: %s", sym, form, e)
            continue
        if data.get("error"):
            continue
        company = company or (data.get("company") or data.get("name") or "").strip()
        for f in (data.get("filings") or data.get("results") or []):
            acc = (f or {}).get("accession") or (f or {}).get("accessionNumber") or ""
            if acc and acc in seen_acc:
                continue
            if acc:
                seen_acc.add(acc)
            rows.append(f)

    # A prolific filer's recent block can be entirely paperwork. Reach into
    # the overflow shards rather than showing the ticker as having no news.
    if not rows:
        rows = _archive_filings(sym)
        if rows and not company:
            company = sym

    out: list[dict] = []
    for f in rows:
        if not isinstance(f, dict):
            continue
        form = (f.get("form") or f.get("form_type") or f.get("type") or "").strip()
        if form not in DISPLAY_FORMS:
            continue
        when = _parse_date(f.get("filing_date") or f.get("date") or f.get("filed"))
        if not when:
            continue
        acc = (f.get("accession") or f.get("accession_number")
               or f.get("accessionNumber") or "").strip()
        url = (f.get("url") or f.get("link") or f.get("filing_url") or "").strip()
        if not acc and not url:
            continue
        items = (f.get("items") or "").strip()
        codes = [c.strip() for c in items.split(",") if c.strip()]
        named = [ITEM_LABELS[c] for c in codes if c in ITEM_LABELS]
        # The headline already carries the FIRST item. Repeating it as the
        # description just prints the same words twice in the row; only the
        # additional items add anything, so only they become the description.
        desc = ""
        if len(named) > 1:
            desc = "Also: " + "; ".join(named[1:4])
        elif f.get("description"):
            desc = str(f["description"]).strip()

        out.append({
            "provider": "sec",
            "lane": "sec",
            "provider_id": acc or url,
            "publisher": "SEC",
            "url": url,
            "title": _headline(sym, form, items, company),
            "body": desc,
            "image": "",
            "published_at": when,
            "tags": [sym],
            "author": "",
            "form_type": form,
            "cik_match": True,     # a filing IS the company, by construction
        })
    return out

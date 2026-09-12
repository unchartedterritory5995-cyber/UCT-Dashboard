# api/services/edgar.py
"""SEC EDGAR 8-K RSS fetcher — free primary source for earnings + M&A filings."""

import re
from datetime import datetime, timezone, timedelta

try:
    import requests as _requests
except ImportError:
    _requests = None

_cik_map_cache: dict[str, str] = {}
_cik_map_fetched_date: str = ""


def _fetch_cik_ticker_map() -> dict[str, str]:
    """Return {cik_str: ticker} mapping from SEC's public JSON. Cached daily."""
    global _cik_map_cache, _cik_map_fetched_date
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if _cik_map_fetched_date == today and _cik_map_cache:
        return _cik_map_cache
    try:
        r = _requests.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers={"User-Agent": "UCTDashboard contact@unchartedterritory.com"},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        _cik_map_cache = {str(v["cik_str"]): v["ticker"] for v in data.values()}
        _cik_map_fetched_date = today
    except Exception:
        pass
    return _cik_map_cache


def _parse_cik(url: str) -> str | None:
    """Extract CIK digits from an EDGAR URL. Returns None if not found."""
    m = re.search(r"CIK=0*(\d+)", url, re.IGNORECASE)
    return m.group(1) if m else None


def _classify_8k(summary: str) -> str:
    """Map 8-K item numbers in summary text to a category badge."""
    s = summary.lower()
    if "2.02" in s or "results of operations" in s:
        return "EARN"
    if "1.01" in s or "1.02" in s or "material definitive" in s or "termination of material" in s:
        return "M&A"
    return "GENERAL"


def fetch_edgar_news(hours: int = 24) -> list[dict]:
    """Fetch recent 8-K filings from SEC EDGAR Atom feed."""
    if _requests is None:
        return []

    cik_map = _fetch_cik_ticker_map()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    try:
        r = _requests.get(
            "https://www.sec.gov/cgi-bin/browse-edgar"
            "?action=getcurrent&type=8-K&dateb=&owner=include&count=40&output=atom",
            headers={"User-Agent": "UCTDashboard contact@unchartedterritory.com"},
            timeout=10,
        )
        r.raise_for_status()
        text = r.text
    except Exception:
        return []

    results = []
    entries = re.findall(r"<entry>(.*?)</entry>", text, re.DOTALL)
    for entry in entries:
        updated = re.search(r"<updated>(.*?)</updated>", entry)
        if not updated:
            continue
        try:
            ts_str = updated.group(1).strip()
            dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            if dt < cutoff:
                continue
            try:
                from zoneinfo import ZoneInfo
                _et = ZoneInfo("America/New_York")
            except ImportError:
                _et = timezone(timedelta(hours=-5))
            time_str = dt.astimezone(_et).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            continue

        link = re.search(r'<link[^>]+href="([^"]+)"', entry)
        if not link:
            continue
        cik = _parse_cik(link.group(1))
        if not cik:
            continue
        ticker = cik_map.get(cik, "")
        if not ticker or not (1 <= len(ticker) <= 4) or not ticker.isalpha():
            continue

        summary_m = re.search(r"<summary[^>]*>(.*?)</summary>", entry, re.DOTALL)
        summary = summary_m.group(1) if summary_m else ""
        category = _classify_8k(summary)

        title_m = re.search(r"<title[^>]*>(.*?)</title>", entry, re.DOTALL)
        raw_title = title_m.group(1) if title_m else ""
        company = raw_title.replace("&amp;", "&").split(" - ")[0].strip()
        item_desc = re.search(r"(Item \d+\.\d+[^<]*)", summary)
        item_label = item_desc.group(1).strip() if item_desc else "8-K Filing"
        headline = f"{company} — {item_label}"

        results.append({
            "headline":  headline,
            "source":    "SEC EDGAR",
            "url":       link.group(1),
            "time":      time_str,
            "category":  category,
            "sentiment": "neutral",
            "tickers":   [ticker],
        })

    return results


# ── Newest periodic filing, for confirming a staleness flag ───────────────────
# Cached per ticker per UTC day: SEC asks for under 10 req/s, and a company's
# newest 10-Q does not change hourly.
_newest_q_cache: dict[str, tuple[str, str | None]] = {}

_PERIODIC_FORMS = ("10-Q", "10-K", "10-Q/A", "10-K/A", "20-F", "40-F")


def _resolve_cik(ticker: str) -> str | None:
    """Ticker -> zero-padded CIK via EDGAR's browse endpoint.

    ⛔ NOT via `sec.gov/files/company_tickers.json`. That file is PARTIAL — 10,426
    entries on 2026-09-12, missing `MMC` and `BK`, both certain filers — so a
    resolver built on it answers "not a US filer" for real companies. The first
    version of this probe did exactly that and printed a fabricated explanation
    for its own limitation. `browse-edgar?action=getcompany&CIK=<ticker>`
    resolves a ticker directly and worked for every name tried.
    """
    t = (ticker or "").upper().strip()
    if not t or _requests is None:
        return None
    try:
        r = _requests.get(
            "https://www.sec.gov/cgi-bin/browse-edgar",
            params={"action": "getcompany", "CIK": t, "type": "10-Q",
                    "count": "1", "output": "atom"},
            headers={"User-Agent": "UCTDashboard contact@unchartedterritory.com"},
            timeout=10,
        )
        r.raise_for_status()
        m = re.search(r"CIK=(\d{10})", r.text) or re.search(r"<cik>(\d+)</cik>", r.text)
        return m.group(1).zfill(10) if m else None
    except Exception:
        return None


def newest_reported_quarter(ticker: str) -> str | None:
    """The newest fiscal quarter the FILINGS show a periodic report for, as a
    'YYYY Qn' label — or None when SEC cannot answer.

    This is the independent oracle behind the fundamentals monitor's
    `stale_reported` check. `reported_staleness` can only say "what we hold is
    old", which is useful for a member but cannot distinguish a provider that
    dropped a filed quarter from a company that has not filed one. Measured
    2026-09-12: six names flagged as stale had filed nothing newer than what we
    already served, so they were not defects at all.

    ⛔ Reads the SUBMISSIONS INDEX, not an XBRL concept. A filing's form and
    reportDate are filing-level facts; picking the wrong us-gaap tag silently
    reports an older quarter, and no tag is universal across filers.

    ⚠️ Non-periodic forms are excluded because an 8-K's `reportDate` is the EVENT
    date, not a fiscal period end — counting it invents a quarter out of a press
    release. Labels come from the ONE shared period-end mapper, so this answer is
    directly comparable to the widget's own labels.

    Returns None rather than a guess on any failure: unknown and current must
    stay distinguishable, or the monitor manufactures findings during an outage.
    """
    t = (ticker or "").upper().strip()
    if not t or _requests is None:
        return None
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    hit = _newest_q_cache.get(t)
    if hit and hit[0] == today:
        return hit[1]

    label = None
    cik = _resolve_cik(t)
    if cik:
        try:
            r = _requests.get(
                f"https://data.sec.gov/submissions/CIK{cik}.json",
                headers={"User-Agent": "UCTDashboard contact@unchartedterritory.com"},
                timeout=15,
            )
            r.raise_for_status()
            recent = ((r.json() or {}).get("filings") or {}).get("recent") or {}
            forms = recent.get("form") or []
            ends = recent.get("reportDate") or []
            best = None
            for form, end in zip(forms, ends):
                if form not in _PERIODIC_FORMS or not end:
                    continue
                if best is None or end > best:
                    best = end
            if best:
                from api.services.earnings_estimates import _fiscal_q_from_period_end
                q, y = _fiscal_q_from_period_end(best)
                label = f"{y} Q{q}" if q else None
        except Exception:
            # A failed lookup is NOT cached as "no filings" — that would pin an
            # outage for the rest of the day and silence a real gap.
            return None

    _newest_q_cache[t] = (today, label)
    return label

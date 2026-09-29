"""V5 DISCOVERY: which SEC filings exist that the live store has not processed.

    feed        EDGAR "getcurrent" Atom, FEED_FORMS, newest 100 each      -- latency (minutes)
    daily       EDGAR daily form index for a COMPLETE business day        -- authority: a day is VERIFIED only when its
                                                                            index was read and every universe filing on
                                                                            it reached a terminal state
    sweep       every universe company's submissions                      -- catch-up / weekly repair

Every source feeds the same queue (v5_queue, keyed by accession). A filing is enqueued only for a company in the
V5 universe (the `security` table) and only if the store does not already hold it.
"""
from __future__ import annotations

import datetime as dt
import re
import time
import urllib.error

from . import incremental as INC, sec_client as SEC, v5_prod as VP
from .filings import parse_submission_pages

_ACCN = re.compile(r"(\d{10}-\d{2}-\d{6})")


def universe(conn) -> set[int]:
    return {r[0] for r in conn.execute("SELECT cik FROM security")}


def feed(forms=VP.FEED_FORMS, *, get=None) -> list[dict]:
    get = get or SEC.get_bytes
    seen, out = set(), []
    for form in forms:
        url = (f"{SEC.WWW}/cgi-bin/browse-edgar?action=getcurrent&type={form}&company=&dateb=&owner=include"
               f"&start=0&count=100&output=atom")
        for e in INC.parse_current_feed(get(url).decode("utf-8", "replace")):
            if e["accn"] not in seen and e["form"] == form:
                seen.add(e["accn"])
                out.append({"cik": e["cik"], "accn": e["accn"], "form": e["form"], "filed": (e.get("updated") or "")[:10],
                            "source": "feed"})
    return out


def parse_form_index(text: str) -> list[dict]:
    """EDGAR daily-index form.YYYYMMDD.idx -> [{form, cik, filed, accn}] (fixed-width; forms may contain spaces)."""
    lines = text.splitlines()
    hdr = next((i for i, l in enumerate(lines) if l.startswith("Form Type")), None)
    if hdr is None:
        return []
    width = lines[hdr].index("Company Name")
    out = []
    for l in lines[hdr + 2:]:
        toks = l.split()
        if len(toks) < 4:
            continue
        m = _ACCN.search(toks[-1])
        if not m or not toks[-3].isdigit():
            continue
        out.append({"form": l[:width].strip(), "cik": int(toks[-3]), "filed": toks[-2], "accn": m.group(1)})
    return out


def daily_index(day: dt.date, *, get=None) -> list[dict] | None:
    """The day's form index, or None if SEC has not posted one (not yet, weekend, or holiday)."""
    get = get or SEC.get_bytes
    q = (day.month - 1) // 3 + 1
    url = f"{SEC.WWW}/Archives/edgar/daily-index/{day.year}/QTR{q}/form.{day:%Y%m%d}.idx"
    try:
        return parse_form_index(get(url).decode("latin-1"))
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            return None
        raise
    except Exception as e:
        if "404" in str(e) or "Not Found" in str(e):
            return None
        raise


def sweep_company(cik: int, floor: dt.datetime, *, pages_fn=None) -> list[dict]:
    """A company's filings in EVIDENCE_FORMS accepted after `floor` (the store decides which are new)."""
    if pages_fn is None:
        def pages_fn(c):
            return SEC.submission_pages(c)[1]
    filings = parse_submission_pages(pages_fn(cik))
    return [{"cik": cik, "accn": a, "form": f.form, "filed": f.public_at.date().isoformat(), "source": "sweep"}
            for a, f in filings.items() if f.form in VP.EVIDENCE_FORMS and f.public_at > floor]


def enqueue(conn, entries: list[dict], *, uni: set[int] | None = None, now: float | None = None) -> dict:
    """Queue every universe filing the store does not hold. Idempotent (accession primary key)."""
    now = int(time.time() if now is None else now)
    uni = universe(conn) if uni is None else uni
    out = {"seen": len(entries), "queued": 0, "known": 0, "out_of_universe": 0, "out_of_scope_form": 0}
    with conn:
        for e in entries:
            if e["cik"] not in uni:
                out["out_of_universe"] += 1
                continue
            if e.get("form") and e["form"] not in VP.EVIDENCE_FORMS:
                out["out_of_scope_form"] += 1
                continue
            if conn.execute("SELECT 1 FROM filing WHERE accn=?", (e["accn"],)).fetchone() or \
                    conn.execute("SELECT 1 FROM v5_queue WHERE accn=?", (e["accn"],)).fetchone():
                out["known"] += 1
                continue
            conn.execute("INSERT INTO v5_queue (accn, cik, form, source, discovered_at, filed, state, attempts, updated_at) "
                         "VALUES (?,?,?,?,?,?, 'QUEUED', 0, ?)", (e["accn"], e["cik"], e.get("form"), e["source"], now,
                                                                  e.get("filed"), now))
            out["queued"] += 1
    return out


def business_days(after: dt.date, through: dt.date) -> list[dt.date]:
    d, out = after + dt.timedelta(days=1), []
    while d <= through:
        if d.weekday() < 5:
            out.append(d)
        d += dt.timedelta(days=1)
    return out

"""Market Cap V1 OFFERING STATUS EVIDENCE (methodology MCAP_V1-M3, owner decisions 2026-10-05).

    python -m api.services.marketcap.offering_status --inputs inputs.db --ipo ipo.db --out offering.db [--workers 16]

The build values a listing's first sessions from an IPO-capitalization projection ("to be outstanding after this
offering", ipo.py). For a TRADITIONAL IPO that is the security's initial capitalization: it cannot trade before it prices.
For a security that is ALREADY PUBLICLY TRADED (an uplisting or cross-listing with a concurrent offering), trading on the
new venue proves nothing about the offering, so two facts about the projection's own documents are evidence:

  market   per projection document: does the issuer's own prospectus say its security ALREADY trades publicly?
           PUBLIC     "Our common stock is (currently) quoted/traded/listed on the OTCQB / TSX / ..."
           NO_MARKET  "there is (currently) no public market for our common stock"
           AMBIGUOUS  both (admitted to quotation, never traded: fail closed -> no M3 effect)
           NONE       neither
  priced   per projection document of a PUBLIC listing: the SAME OFFERING's pricing -- the first final prospectus (424B1-5)
           under the SAME registration file number (SEC submissions `fileNumber`, 333-...) filed on/after it and within 30
           days of the listing -- and whether that priced prospectus states its post-offering capitalization ASSUMING THE
           EXERCISE of pre-funded warrants (non-common instruments counted as shares outstanding). A final prospectus of
           another registration (a resale 424B3, another offering) never prices this projection (ACOG 2024: a resale 424B3
           under 333-282675 is not the pricing of the 333-280196 offering). No file number on either side = the
           association is unobservable: no row, never "priced".

This module records evidence only; build.py decides eligibility (pricing PIT time through the ordinary acceptance
authority and Obs.known_from -- one clock). No pricing row = pricing unobservable in V1's inputs, never "no pricing".
"""
from __future__ import annotations

import argparse
import gzip
import html
import json
import os
import re
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

from .fetch import _path as cache_path, filing_base, get_head

DDL = """
CREATE TABLE IF NOT EXISTS market(cik INTEGER, listing_start TEXT, accn TEXT, form TEXT, status TEXT, sentence TEXT,
  PRIMARY KEY(cik, listing_start, accn));
CREATE TABLE IF NOT EXISTS priced(cik INTEGER, listing_start TEXT, proj_accn TEXT, final_accn TEXT, final_form TEXT,
  prefunded_basis INTEGER, sentence TEXT, file_number TEXT, PRIMARY KEY(cik, listing_start, proj_accn));
"""
FINAL_FORMS = ("424B1", "424B2", "424B3", "424B4", "424B5")
HEADS = (8_000_000, 600_000, 350_000, 150_000, 90_000)   # every head size a harvest caches documents under

SEC = (r"(?:common stock|Common Stock|common shares|ordinary shares|Common Shares|shares of common stock|securities|"
       r"units, Common Stock and warrants)")
VENUE = (r"(?:OTC\w*|over-the-counter|Over-the-Counter|Pink|Bulletin Board|Toronto Stock Exchange|TSX(?: Venture Exchange)?|"
         r"Canadian Securities Exchange|CSE|ASX)")
POS = [re.compile(rf"\b(?:Our|The Company[’']s|our)\s+{SEC}\s+(?:is|are)\s+(?:currently\s+|presently\s+)?"
                  rf"(?:quoted|traded|listed|subject to quotation)\s+(?:on|in)\s+(?:the\s+)?(?:[\w’' ]{{0,40}}?)?{VENUE}"),
       re.compile(rf"\bPrior to (?:this offering|the consummation of this offering),\s+(?:our\s+{SEC}\s+(?:is|was)\s+quoted|"
                  rf"there has been a limited public market for our {SEC})\s+on the\s+(?:[\w’' ]{{0,30}})?{VENUE}"),
       re.compile(rf"\b{SEC}\s+(?:is|are)\s+(?:currently\s+)?(?:quoted|listed|traded)\s+on\s+the\s+{VENUE}")]
POS_GUARD = re.compile(r"warrants?\b(?! to purchase)|if (?:our|we)|delisted|may be eligible|expect")
NEG = re.compile(rf"(?:there (?:is|has been) (?:currently )?no (?:established )?public (?:trading )?market for (?:our|the) "
                 rf"(?:{SEC}|shares|Class A common stock|ADSs)|prior to this offering,? there (?:has been|was) no public market "
                 rf"for (?:our|the) (?:{SEC}|shares))", re.I)
KEY = re.compile(r"OTC|Pink|Bulletin|over-the-counter|no public market|no established|Toronto|TSX|CSE|ASX|listed on|quoted", re.I)
PREFUNDED_BASIS = re.compile(r"(?:assum(?:es|ing)|giv(?:es|ing) effect to)\s+(?:the\s+)?exercise\s+(?:in\s+full\s+)?of\s+"
                             r"(?:all\s+(?:of\s+)?)?(?:the\s+)?pre-funded\s+warrants", re.I)


def text_of(b: bytes) -> str:
    s = b.decode("utf-8", "replace")
    s = re.sub(r"(?is)<(script|style).*?</\1>", " ", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s).replace("\xa0", " "))


def market_status(text: str) -> tuple[str, str | None]:
    ss = [s[:500] for s in re.split(r"(?<=[.;])\s+(?=[A-Z(])", text) if KEY.search(s)]
    pos = [s for s in ss if any(p.search(s) for p in POS) and not POS_GUARD.search(s[:120])]
    neg = [s for s in ss if NEG.search(s)]
    if pos and not neg:
        return "PUBLIC", pos[0]
    if neg and not pos:
        return "NO_MARKET", neg[0]
    return ("AMBIGUOUS", pos[0]) if pos else ("NONE", None)


def prefunded_basis(text: str) -> str | None:
    m = PREFUNDED_BASIS.search(text)
    return text[max(0, m.start() - 160):m.end() + 40] if m else None


def document(cik: int, accn: str, doc: str) -> str:
    """The document's text from the content cache (largest cached head first); fetched only when never cached."""
    url = filing_base(cik, accn) + "/" + doc
    for n in HEADS:
        p = cache_path(f"{url}#head{n}")
        if os.path.exists(p):
            b = gzip.decompress(open(p, "rb").read())
            return "" if b == b"\x00404" else text_of(b)[:900_000]
    b = get_head(url, 600_000)
    return text_of(b)[:900_000] if b else ""


def file_numbers(submissions_zip: str, ciks: set) -> dict[str, str]:
    """{accession: registration file number} from SEC submissions (every page) for `ciks`."""
    import zipfile
    z = zipfile.ZipFile(submissions_zip)
    names = set(z.namelist())
    out = {}
    for cik in ciks:
        main = f"CIK{cik:010d}.json"
        if main not in names:
            continue
        j = json.loads(z.read(main))
        for pg in [j["filings"]["recent"]] + [json.loads(z.read(f["name"])) for f in j["filings"].get("files", []) if f["name"] in names]:
            fnum = pg.get("fileNumber") or [None] * len(pg["accessionNumber"])
            for a, f in zip(pg["accessionNumber"], fnum):
                if f:
                    out[a] = f
    return out


def harvest(inputs_db: str, ipo_db: str, out: str, workers: int = 16, submissions: str | None = None) -> dict:
    inp = sqlite3.connect(f"file:{inputs_db}?mode=ro", uri=True, check_same_thread=False)
    ipo = sqlite3.connect(f"file:{ipo_db}?mode=ro", uri=True)
    projections = ipo.execute("SELECT DISTINCT cik, accn, form, filing_date, listing_start FROM ipo_obs WHERE status IN ('OK','MULTI_CLASS') "
                              "AND count IS NOT NULL AND class != 'TOTAL'").fetchall()
    if os.path.exists(out):
        os.remove(out)
    db = sqlite3.connect(out, check_same_thread=False)
    db.executescript(DDL)
    lock = threading.Lock()
    docs = {}
    for _c, accn, _f, _d, _s in projections:
        r = inp.execute("SELECT primary_doc FROM filing WHERE cik=? AND accn=?", (_c, accn)).fetchone()
        docs[accn] = r[0] if r else None

    def one(row):
        cik, accn, form, fd, start = row
        st, sent = market_status(document(cik, accn, docs[accn])) if docs.get(accn) else ("NONE", None)
        with lock:
            db.execute("INSERT OR REPLACE INTO market VALUES (?,?,?,?,?,?)", (cik, start, accn, form, st, sent))

    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(one, projections))
    db.commit()
    public = db.execute("SELECT DISTINCT cik, listing_start FROM market GROUP BY cik, listing_start "
                        "HAVING SUM(status='PUBLIC') > 0 AND SUM(status IN ('NO_MARKET','AMBIGUOUS')) = 0").fetchall()
    n_priced = 0
    fnums = file_numbers(submissions, {c for c, _s in public}) if submissions else {}
    unobservable = 0
    for cik, start in public:
        hi = (date.fromisoformat(start) + timedelta(days=30)).isoformat()
        for accn, form, fd in [(a, f, d) for c, a, f, d, s in projections if c == cik and s == start]:
            fn = fnums.get(accn)
            if not fn:                                     # the offering's registration is unobservable: no association
                unobservable += 1
                continue
            fin = next((r for r in inp.execute(
                f"SELECT accn, form, primary_doc FROM filing WHERE cik=? AND form IN ({','.join('?' * len(FINAL_FORMS))}) "
                "AND filing_date BETWEEN ? AND ? ORDER BY public_at, accn", (cik, *FINAL_FORMS, fd, hi)) if fnums.get(r[0]) == fn), None)
            if fin is None:
                continue                                   # this offering's pricing is unobservable in V1's inputs
            basis = prefunded_basis(document(cik, fin[0], fin[2])) if fin[2] else None
            db.execute("INSERT OR REPLACE INTO priced VALUES (?,?,?,?,?,?,?,?)",
                       (cik, start, accn, fin[0], fin[1], int(bool(basis)), basis, fn))
            n_priced += 1
    db.commit()
    counts = dict(db.execute("SELECT status, COUNT(*) FROM market GROUP BY status").fetchall())
    db.close()
    return {"projection_documents": len(projections), "market": counts, "public_listings": len(public), "priced": n_priced,
            "registration_unobservable": unobservable}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True)
    ap.add_argument("--ipo", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--submissions", help="SEC submissions.zip (registration file numbers: same-offering pricing)")
    a = ap.parse_args(argv)
    print(json.dumps(harvest(a.inputs, a.ipo, a.out, a.workers, a.submissions)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

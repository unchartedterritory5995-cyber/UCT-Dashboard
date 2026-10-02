"""Successor-issuer lineage for Market Cap V1 (8-K12B / 8-K12G3): only what Market Cap needs, nothing more.

A ticker's bars can run back decades before its CURRENT issuer existed (XOM bars from 1962, ExxonMobil Holdings CIK
2115436 registered 2026-07-01). Those days belong to the PREDECESSOR. They are valued only when filing evidence
proves the successor is the SAME ECONOMIC ENTITY under a new legal parent:

  PURE_REORGANIZATION  holding-company reorganization / redomestication (reorganization marker), every predecessor
                       share converted one-for-one (or at a stated ratio) into the successor's corresponding share,
                       an explicit statement that the successor holds the same assets / businesses / operations (or
                       the same proportional ownership), NO merger / acquisition / combination / cash consideration,
                       and exactly ONE predecessor registrant identified by its Exchange Act FILE NUMBER (SEC registry,
                       never by name, never by ticker);
  MERGER / ACQUISITION a business combination, acquisition, merger of equals, cash or exchange-ratio consideration
                       (MDT 2015 Covidien, DD 2017 Dow, DIS 2019 Fox, ETN 2012 Cooper) -> a BOUNDARY: earlier days
                       belong to a different economic entity;
  SPINOFF / NEW_ENTITY a distribution / separation, an emergence from bankruptcy -> a boundary;
  AMBIGUOUS            anything else, or a pure reorganization whose predecessor is not uniquely identified ->
                       SUCCESSOR_ISSUER_RELATIONSHIP_UNRESOLVED (held).

    python -m api.services.marketcap.lineage index --submissions sec/submissions.zip --out fileno.db
    python -m api.services.marketcap.lineage harvest --inputs inputs.db --fileno fileno.db --out lineage.db
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import zipfile
from datetime import date

from . import textcover
from .textcover import DATE, for_matching, parse_date

REORG = re.compile(r"holding\s+company\s+(?:reorganization|merger|structure|formation)|reorganiz\w+[^.;]{0,160}?holding\s+company"
                   r"|section\s+251\s*\(g\)|251\(g\)|redomicil\w*|redomesticat\w*|reincorporat\w+|change\s+(?:its|the\s+company's|our)"
                   r"\s+(?:jurisdiction|place|state)\s+of\s+(?:incorporation|organization)", re.I)
CONVERT_1 = re.compile(r"(?:each|every)\s+(?:issued\s+and\s+outstanding\s+|outstanding\s+)?(?:share|ordinary\s+share|common\s+share)s?\s+of"
                       r"[^.;]{0,200}?(?:converted|exchanged|cancell?ed\s+and\s+converted|became)\s+(?:in)?to\s+(?:the\s+right\s+to\s+receive\s+)?"
                       r"(one|1|one\s*\(1\)|an\s+equivalent(?:\s+corresponding)?|a\s+corresponding|the\s+same\s+number\s+of|an\s+equal\s+number\s+of)\s+",
                       re.I)
ONE_FOR_ONE = re.compile(r"(?:converted|exchanged)[^.;]{0,160}?on\s+a\s+one[\s-]*(?:for|to)[\s-]*one\s+basis"
                         r"|one[\s-]*for[\s-]*one\s+(?:basis|exchange|conversion)"
                         r"|holding\s+the\s+same\s+number\s+(?:and\s+percentage\s+)?of\s+shares", re.I)
EACH_CLASS = re.compile(r"each\s+class|corresponding\s+(?:share|class)|same\s+designations|each\s+share\s+of\s+(?:class|series)", re.I)
CONTINUITY = re.compile(r"same\s+(?:consolidated\s+)?assets,?\s+(?:liabilities,?\s+)?(?:and\s+)?(?:businesses?|operations)"
                        r"|(?:consolidated\s+)?assets\s+and\s+liabilities[^.;]{0,120}?(?:are|were)\s+(?:the\s+same|identical)"
                        r"|(?:same|identical)\s+(?:proportionate|proportional|percentage)\s+(?:ownership|interest)"
                        r"|same\s+number\s+and\s+percentage\s+of\s+shares"
                        r"|same\s+(?:business|businesses)\s+and\s+operations|continue\s+to\s+(?:conduct|own|operate)\s+(?:the\s+same|all)\s+"
                        r"(?:business|businesses|operations)", re.I)
MERGER = re.compile(r"(?:completed|consummat\w+|closing\s+of|effect(?:ed|uated))\s+(?:of\s+)?(?:its\s+|the\s+)?(?:previously\s+announced\s+)?"
                    r"(?:business\s+combination|merger\s+of\s+equals|acquisition|combination|merger\s+with)"
                    r"|merger\s+of\s+equals|exchange\s+ratio|(?<!fractional\s)(?<!lieu\s)"
                    r"\$\s?\d[\d,.]*\s+(?:in\s+cash|per\s+share\s+in\s+cash)|cash\s+consideration|(?:cash|stock)\s+and\s+(?:cash|stock)"
                    r"\s+consideration|transactions?\s+contemplated\s+by\s+the\s+(?:business\s+combination|transaction)\s+agreement", re.I)
SPIN = re.compile(r"spin-?off|(?:pro\s+rata\s+)?distribution\s+of\s+(?:all|100%|approximately)[^.;]{0,80}?(?:shares|stock)\s+of"
                  r"|separation\s+and\s+distribution", re.I)
BANKRUPT = re.compile(r"chapter\s+11|emerg\w+\s+from\s+bankruptcy|bankruptcy\s+court|plan\s+of\s+reorganization\s+under", re.I)
FILENO = re.compile(r"(?<![\d-])((?:0?0[01]|\d)-\d{4,6})(?![\d-])")
EFFECTIVE = re.compile(rf"(?:on|effective(?:\s+as\s+of)?)\s+({DATE}),?\s+[^.;]{{0,160}}?(?:implemented|completed|consummated|became\s+effective"
                       rf"|became\s+the\s+successor)|(?:became|was)\s+effective\s+(?:on|as\s+of)\s+({DATE})", re.I)


def classify(text: str) -> dict:
    t = for_matching(textcover.normalize(text) if isinstance(text, bytes) else text)
    ev = {}
    for name, rx in (("reorg", REORG), ("convert", CONVERT_1), ("one_for_one", ONE_FOR_ONE), ("each_class", EACH_CLASS),
                     ("continuity", CONTINUITY), ("merger", MERGER), ("spin", SPIN), ("bankrupt", BANKRUPT)):
        m = rx.search(t)
        if m:
            ev[name] = t[max(0, m.start() - 120):m.end() + 160][:420]
    convert = "convert" in ev or "one_for_one" in ev
    if "bankrupt" in ev:
        kind = "NEW_ENTITY"
    elif "merger" in ev:
        kind = "MERGER"
    elif "spin" in ev and not ("reorg" in ev and convert and "continuity" in ev):
        kind = "SPINOFF"
    elif "reorg" in ev and convert and "continuity" in ev:
        kind = "PURE_REORGANIZATION"
    else:
        kind = "AMBIGUOUS"
    dates = [parse_date(m.group(1) or m.group(2)) for m in EFFECTIVE.finditer(t)]
    eff = max((d for d in dates if d), default=None)
    return {"kind": kind, "evidence": ev, "effective": eff, "file_numbers": sorted(set(FILENO.findall(t)))}


PERIODIC = ("10-K", "10-Q", "8-K", "20-F", "40-F", "6-K", "10-K405", "10-KSB", "10-QSB")


def build_index(sub_zip: str, out: str) -> dict:
    """Exchange Act file number -> registrant CIK, from each registrant's OWN periodic filings (SEC submissions bulk)."""
    db = sqlite3.connect(out)
    db.executescript("CREATE TABLE IF NOT EXISTS fileno(fileno TEXT, cik INTEGER, name TEXT, first TEXT, last TEXT, n INTEGER, "
                     "PRIMARY KEY(fileno, cik));")
    z = zipfile.ZipFile(sub_zip)
    n = 0
    for nm in z.namelist():
        if "-submissions-" in nm or not nm.startswith("CIK"):
            continue
        j = json.loads(z.read(nm))
        r = j.get("filings", {}).get("recent", {})
        agg: dict = {}
        for f, fn, fd in zip(r.get("form", []), r.get("fileNumber", []), r.get("filingDate", [])):
            if f in PERIODIC and fn and re.fullmatch(r"(?:0?0[01]|\d)-\d{4,6}", fn):
                a = agg.setdefault(fn, [fd, fd, 0])
                a[0], a[1], a[2] = min(a[0], fd), max(a[1], fd), a[2] + 1
        if agg:
            cik = int(j.get("cik") or nm[3:13])
            db.executemany("INSERT OR REPLACE INTO fileno VALUES(?,?,?,?,?,?)",
                           [(fn, cik, j.get("name"), a[0], a[1], a[2]) for fn, a in agg.items()])
            n += 1
    db.commit()
    return {"registrants": n}


def _norm_fileno(fn: str) -> set:
    a, b = fn.split("-")
    heads = {a, a.zfill(3), a.lstrip("0") or "0"}
    tails = {b, b.zfill(5), b.lstrip("0") or "0"}
    return {f"{h}-{t}" for h in heads for t in tails}


def harvest(inputs: str, fileno_db: str, out: str) -> dict:
    from .fetch import filing_base, get_head
    inp = sqlite3.connect(inputs)
    idx = sqlite3.connect(fileno_db)
    db = sqlite3.connect(out)
    db.executescript("""CREATE TABLE IF NOT EXISTS lineage(succ_cik INTEGER, accn TEXT, form TEXT, filing_date TEXT, effective TEXT,
      kind TEXT, pred_cik INTEGER, pred_name TEXT, pred_candidates TEXT, ratio REAL, each_class INTEGER, status TEXT, evidence TEXT,
      PRIMARY KEY(succ_cik, accn));""")
    rows = inp.execute("SELECT cik, accn, form, filing_date, primary_doc FROM filing WHERE form IN "
                       "('8-K12B','8-K12G3','8-K12B/A','8-K12G3/A') ORDER BY filing_date").fetchall()
    stat: dict = {}
    for cik, accn, form, fd, doc in rows:
        b = get_head(filing_base(cik, accn) + "/" + doc, 600_000) if doc else None
        if b is None:
            db.execute("INSERT OR REPLACE INTO lineage VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       (cik, accn, form, fd, None, "AMBIGUOUS", None, None, "[]", None, 0, "NO_FILE", "{}"))
            continue
        c = classify(textcover.normalize(b))
        own = {fn for (fn,) in idx.execute("SELECT fileno FROM fileno WHERE cik=?", (cik,))}
        own_n = set().union(*(_norm_fileno(x) for x in own)) if own else set()
        preds = {}
        for fn in c["file_numbers"]:
            # ⭐ a successor may KEEP the predecessor's Exchange Act file number (Rule 12g-3): a number the successor
            # also uses still identifies the OTHER registrant that filed under it before the effective date
            for v in _norm_fileno(fn):
                for pc, pn, first, last in idx.execute("SELECT cik, name, first, last FROM fileno WHERE fileno=?", (v,)):
                    if pc != cik and first <= fd:
                        preds[pc] = (pn, fn, first, last)
        eff = c["effective"] if c["effective"] and (date.fromisoformat(fd) - c["effective"]).days in range(0, 120) else date.fromisoformat(fd)
        kind = c["kind"]
        status = "OK"
        pred = None
        if kind == "PURE_REORGANIZATION":
            live = {k: v for k, v in preds.items() if v[3] >= (date.fromisoformat(fd).replace(year=date.fromisoformat(fd).year - 2)).isoformat()}
            if len(live) == 1:
                pred = next(iter(live))
            else:
                status = "PREDECESSOR_NOT_UNIQUE" if live else "PREDECESSOR_NOT_FOUND"
        db.execute("INSERT OR REPLACE INTO lineage VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (cik, accn, form, fd, eff.isoformat(), kind, pred, preds.get(pred, (None,))[0] if pred else None,
                    json.dumps({str(k): v for k, v in preds.items()}), 1.0 if kind == "PURE_REORGANIZATION" else None,
                    int("each_class" in c["evidence"]), status, json.dumps(c["evidence"])[:6000]))
        stat[(kind, status)] = stat.get((kind, status), 0) + 1
    db.commit()
    return {f"{k[0]}/{k[1]}": v for k, v in stat.items()}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=("index", "harvest"))
    ap.add_argument("--submissions")
    ap.add_argument("--inputs")
    ap.add_argument("--fileno")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "index":
        print(json.dumps(build_index(a.submissions, a.out)))
    else:
        print(json.dumps(harvest(a.inputs, a.fileno, a.out)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

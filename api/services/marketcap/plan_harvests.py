"""Derive the next harvest lists from staged data (deterministic).

    python -m api.services.marketcap.plan_harvests --data C:/mcapdata [--build B.db]

Writes into --data:
  ipo_list.json        [[cik, listing_start]]  issuers whose listing began inside EDGAR coverage and after the CIK
                       first filed (IPO / direct listing / uplisting) -> harvest_text --mode ipo
  adr_ciks.json        [cik]  primary ticker is a depositary receipt (Massive ADRC/ADRS) or the issuer files
                       20-F / 40-F -> harvest_text --mode adr
  multiclass_ciks.json [cik]  any harvested cover with >= 2 share classes, >= 2 equity tickers with bars, or a
                       Massive share-class/total divergence -> harvest_covers --ciks-file (phase 2)
  econ_list.json       [[cik, accn]]  the annual report each multi-class regime wants (needs --build)
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import date

from .build import EQUITY_TYPES, FPI_FORMS, bars_days, load_ref
from .identity import EDGAR_DOMESTIC, EDGAR_FOREIGN, decide
from .structure import class_key


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--build")
    a = ap.parse_args(argv)
    P = lambda n: os.path.join(a.data, n)
    inp = sqlite3.connect(P("inputs.db"))
    px = sqlite3.connect(P("prices.db"))
    ref = load_ref(P("ref.jsonl"))
    cov = sqlite3.connect(P("covers.db")) if os.path.exists(P("covers.db")) else None
    forms = defaultdict(set)
    first = {}
    for cik, form, fd in inp.execute("SELECT cik, form, MIN(filing_date) FROM filing GROUP BY cik, form"):
        forms[cik].add(form)
        first[cik] = min(first.get(cik, fd), fd)
    ipo, adr, multi = [], [], set()
    for cik, tj in inp.execute("SELECT cik, tickers_json FROM issuer"):
        tickers = json.loads(tj or "[]")
        foreign = bool(forms[cik] & set(FPI_FORMS))
        ff = date.fromisoformat(first[cik]) if cik in first else None
        eq = []
        for t in tickers:
            r, _sp = ref.get(t, (None, []))
            if r is not None and r.type not in EQUITY_TYPES:
                continue
            days, _ = bars_days(px, t.replace(".", "-"))
            if not days:
                continue
            dec = decide(t, cik, days, r, ff, foreign)
            if dec:
                eq.append((t, dec, r))
        if not eq:
            continue
        t0, dec0, r0 = eq[0]
        edgar = EDGAR_FOREIGN if foreign else EDGAR_DOMESTIC
        start = min(d.listing.start for _t, d, _r in eq)
        if start >= edgar and ff is not None and ff <= start:
            ipo.append([cik, start.isoformat()])
        if (r0 is not None and r0.type in ("ADRC", "ADRS")) or foreign:
            adr.append(cik)
        if len(eq) >= 2:
            multi.add(cik)
        if r0 is not None and r0.share_class_shares and r0.weighted_shares and r0.type not in ("ADRC", "ADRS") \
                and abs(r0.share_class_shares / r0.weighted_shares - 1) > 0.05:
            multi.add(cik)
    if cov is not None:
        per = defaultdict(set)
        for cik, accn, mem, lab in cov.execute("SELECT cik, accn, member, label FROM cover_fact WHERE concept='dei:EntityCommonStockSharesOutstanding'"):
            per[(cik, accn)].add(class_key(mem, lab))
        for (cik, _a), ks in per.items():
            if len([k for k in ks if k != "COMMON"]) >= 2:
                multi.add(cik)
    json.dump(sorted(ipo), open(P("ipo_list.json"), "w"))
    json.dump(sorted(set(adr)), open(P("adr_ciks.json"), "w"))
    json.dump(sorted(multi), open(P("multiclass_ciks.json"), "w"))
    out = {"ipo": len(ipo), "adr": len(set(adr)), "multiclass": len(multi)}
    if a.build:
        b = sqlite3.connect(a.build)
        econ = sorted({(c, x) for c, x in b.execute("SELECT cik, accn FROM econ_request WHERE accn IS NOT NULL")})
        json.dump([list(x) for x in econ], open(P("econ_list.json"), "w"))
        out["econ"] = len(econ)
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())

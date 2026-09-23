"""Fetch the production backfill's inputs from SEC, under fair-access rules.

    python -m api.services.fundamentals_pit.bulk_inputs --work /data/fundamentals_pit_work \
        [--fs-from 2009q1] [--fs-to 2026q2] [--no-fs]

Writes, into --work:
    companyfacts.zip     every company's XBRL facts (~1.4 GB)
    submissions.zip      every company's filing index (~1.6 GB)
    fs/<YYYY>q<N>.zip    SEC Financial Statement Data Sets, one per quarter
                         (restatement signals for the backfill; ~50-100 MB each)

Every request goes through `sec_client.download` -- the declared User-Agent and
the shared rate limiter -- and a file already present is kept, so a re-run after
a worker redeploy resumes rather than re-downloading. A quarter not yet
published (404) ends the FS range; any other failure raises.

Prints a JSON manifest (paths + sizes) for the backfill command line and the
run record. Downloads only; ingests nothing.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date

from . import sec_client as SEC

COMPANYFACTS_URL = "https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip"
SUBMISSIONS_URL = "https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip"
FS_URL = "https://www.sec.gov/files/dera/data/financial-statement-data-sets/{q}.zip"


def quarters(q_from: str, q_to: str) -> list[str]:
    y, n = int(q_from[:4]), int(q_from[5])
    y1, n1 = int(q_to[:4]), int(q_to[5])
    out = []
    while (y, n) <= (y1, n1):
        out.append(f"{y}q{n}")
        y, n = (y + 1, 1) if n == 4 else (y, n + 1)
    return out


def fetch(work: str, fs_from: str | None, fs_to: str | None) -> dict:
    os.makedirs(os.path.join(work, "fs"), exist_ok=True)
    man = {"companyfacts": os.path.join(work, "companyfacts.zip"),
           "submissions": os.path.join(work, "submissions.zip"), "fs": []}
    SEC.download(COMPANYFACTS_URL, man["companyfacts"])
    SEC.download(SUBMISSIONS_URL, man["submissions"])
    if fs_from:
        today = date.today()
        last = fs_to or f"{today.year}q{(today.month - 1) // 3 + 1}"
        for q in quarters(fs_from, last):
            dest = os.path.join(work, "fs", f"{q}.zip")
            try:
                SEC.download(FS_URL.format(q=q), dest)
            except SEC.SecError as e:
                if e.status == 404:
                    break                       # not yet published: the range ends here
                raise
            man["fs"].append(dest)
    man["sizes"] = {p: os.path.getsize(p) for p in [man["companyfacts"], man["submissions"], *man["fs"]]}
    return man


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="download SEC bulk inputs for the fundamentals backfill")
    ap.add_argument("--work", required=True)
    ap.add_argument("--fs-from", default="2009q1")
    ap.add_argument("--fs-to")
    ap.add_argument("--no-fs", action="store_true")
    a = ap.parse_args(argv)
    man = fetch(a.work, None if a.no_fs else a.fs_from, a.fs_to)
    print(json.dumps(man, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

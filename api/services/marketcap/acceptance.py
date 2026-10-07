"""ACCEPTANCE AUTHORITY for Market Cap V1: when each piece of share evidence became public.

⛔ MEASURED 2026-10-01 (Fundamentals V5 acceptance-time audit): data.sec.gov submissions `acceptanceDateTime` is served
with the EDGAR EASTERN wall clock and a "Z" suffix for whole submissions-JSON pages (a filing's own day, and for 200
companies' entire histories in the nightly bulk file). Read as UTC it is 4 h (EDT) / 5 h (EST) EARLY. At daily
granularity that is a ONE-DAY LOOKAHEAD: a 10-Q accepted 16:30 ET read as 12:30 ET would set the 16:00 ET close of the
same day. `inputs.db` parsed exactly that field, so 5,906 of its filings (3,712 carrying share facts) were early.

Deterministic hierarchy for a filing's acceptance instant (Fundamentals V5 is only READ, never changed):
  1. V5_CORRECTED  -- the corrected Fundamentals V5 filing table (every row EDGAR-header verified, or proven by its
                      submissions page; 6,324 corrected 2026-10-01). Export: filing_export_after.csv.gz.
  2. EDGAR_RECORD  -- the EDGAR acceptance record: `<accn>.hdr.sgml` ACCEPTANCE-DATETIME, else the filing index
                      'Accepted' field. Eastern wall clock, interpreted with America/New_York (real DST) -> UTC.
  3. CONSERVATIVE  -- neither available: the submissions value is AMBIGUOUS (UTC, or Eastern labelled UTC). Take the
                      LATER reading (its clock digits as Eastern -> UTC). Possibly late, never early.
public_at = max(acceptance, filing date 06:00 ET) (the Fundamentals rule) in every case.
"""
from __future__ import annotations

import csv
import gzip
import os
import sqlite3
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
SCHEMA = """
CREATE TABLE IF NOT EXISTS acceptance(accn TEXT PRIMARY KEY, accepted TEXT NOT NULL, source TEXT NOT NULL, evidence TEXT);
CREATE TABLE IF NOT EXISTS input_file(name TEXT PRIMARY KEY, sha256 TEXT, rows INTEGER);
"""


def eastern_to_utc(raw14: str) -> datetime:
    """EDGAR Eastern 'YYYYMMDDHHMMSS' -> UTC; an ambiguous/nonexistent wall clock takes the LATER instant."""
    naive = datetime.strptime(raw14, "%Y%m%d%H%M%S")
    return _later_instant(naive)


def _later_instant(naive: datetime) -> datetime:
    """⛔ Compare in UTC: two aware datetimes sharing one tzinfo compare by WALL time, ignoring `fold`."""
    return max(naive.replace(tzinfo=ET, fold=0).astimezone(timezone.utc), naive.replace(tzinfo=ET, fold=1).astimezone(timezone.utc))


def conservative(accepted_iso: str) -> datetime:
    """The LATER of the two readings of a submissions acceptanceDateTime: its clock digits as Eastern wall time."""
    d = datetime.fromisoformat(accepted_iso)
    naive = d.astimezone(timezone.utc).replace(tzinfo=None)
    return max(d.astimezone(timezone.utc), _later_instant(naive))


def public_at(accepted: datetime | None, filing_date: date) -> datetime:
    floor = datetime.combine(filing_date, time(6, 0), tzinfo=ET).astimezone(timezone.utc)
    if accepted is None:
        return datetime.combine(filing_date, time(23, 59, 59), tzinfo=ET).astimezone(timezone.utc)
    return max(accepted, floor)


class Authority:
    """accn -> (accepted UTC, source). Unknown accessions fall to CONSERVATIVE in `resolve`."""

    def __init__(self, path: str | None):
        self.db = sqlite3.connect(f"file:{path}?mode=ro", uri=True) if path and os.path.exists(path) else None

    def lookup(self, accn: str):
        if self.db is None:
            return None
        r = self.db.execute("SELECT accepted, source FROM acceptance WHERE accn=?", (accn,)).fetchone()
        return (datetime.fromisoformat(r[0]), r[1]) if r else None

    def resolve(self, accn: str, submissions_accepted: str | None, filing_date: str) -> tuple[datetime, str]:
        """(public_at UTC, source)."""
        fd = date.fromisoformat(filing_date)
        hit = self.lookup(accn)
        if hit is not None:
            return public_at(hit[0], fd), hit[1]
        if submissions_accepted:
            return public_at(conservative(submissions_accepted), fd), "CONSERVATIVE"
        return public_at(None, fd), "NO_ACCEPTANCE_END_OF_DAY"


def build(out: str, v5_export: str, header_cache: str) -> dict:
    """acceptance.db from (1) the corrected V5 filing export and (2) the EDGAR-record cache (hdr/<accn>.txt = 14 digits)."""
    import hashlib
    if os.path.exists(out):
        os.remove(out)
    db = sqlite3.connect(out)
    db.executescript(SCHEMA)
    n1 = 0
    with gzip.open(v5_export, "rt") as f:
        rows = []
        for accn, _cik, _form, _fd, acc, _pub, _seen, _facts in csv.reader(f):
            if acc:
                rows.append((accn, datetime.fromtimestamp(int(acc), timezone.utc).isoformat(), "V5_CORRECTED", None))
        db.executemany("INSERT OR REPLACE INTO acceptance VALUES (?,?,?,?)", rows)
        n1 = len(rows)
    n2 = 0
    rows = []
    for name in os.listdir(header_cache):
        if not name.endswith(".txt"):
            continue
        raw = open(os.path.join(header_cache, name)).read().strip()
        if len(raw) != 14:
            continue
        accn = name[:-4]
        src = "EDGAR_INDEX" if os.path.exists(os.path.join(header_cache, name + ".idx")) else "EDGAR_HEADER"
        rows.append((accn, eastern_to_utc(raw).isoformat(), src, raw))
    # the EDGAR record is the authority itself; it also confirms every V5 row it covers
    db.executemany("INSERT OR REPLACE INTO acceptance VALUES (?,?,?,?)", rows)
    n2 = len(rows)
    db.execute("INSERT INTO input_file VALUES (?,?,?)", ("v5_export", hashlib.sha256(open(v5_export, "rb").read()).hexdigest(), n1))
    db.execute("INSERT INTO input_file VALUES (?,?,?)", ("edgar_records", None, n2))
    db.commit()
    return {"v5_corrected": n1, "edgar_records": n2,
            "by_source": dict(db.execute("SELECT source, count(*) FROM acceptance GROUP BY source").fetchall())}


if __name__ == "__main__":
    import json, sys
    print(json.dumps(build(sys.argv[1], sys.argv[2], sys.argv[3]), indent=1))

"""Raw-truth ingestion: SEC documents -> the append-only store.

Idempotent by construction: facts are INSERT OR IGNORE on their full identity,
filings freeze at first sight, and a company whose companyfacts + submissions
content hash is unchanged is skipped outright (resume = re-run).

RETAINED_TAGS is the set of concepts the V1 catalogue and the split verifier
read -- about 30 tags of the ~500 a large filer reports. Everything else stays
in SEC's archives; adding a metric later means re-running the (cheap, bulk)
backfill for its tags, never inventing values.
"""
from __future__ import annotations

import hashlib
import json
import time

from . import store as S
from .concepts import PRIMITIVES
from .facts import parse_companyfacts
from .filings import parse_submission_pages
from .filings import PERIODIC_FORMS
from .split_ledger import PER_SHARE_TAGS, SHARE_COUNT_TAGS

RETAINED_TAGS = frozenset({t for p in PRIMITIVES.values() for t in p.tags}
                          | set(PER_SHARE_TAGS) | set(SHARE_COUNT_TAGS))


def _sha(obj) -> str:
    if isinstance(obj, (bytes, bytearray)):
        return hashlib.sha256(obj).hexdigest()
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def parse_company(companyfacts: dict, pages: list[dict]) -> tuple[dict, list, list]:
    """Pure parse (safe to run in a worker process): (filings, facts, anomalies)."""
    anomalies: list = []
    filings = parse_submission_pages(pages, anomalies)
    facts = parse_companyfacts(companyfacts, set(RETAINED_TAGS))
    used = {f.accn for f in facts}
    # Keep a filing if a retained fact cites it, or it is a periodic report
    # (the incremental path inspects those for restatement signals). MEASURED:
    # keeping every 8-K / 6-K added 820k rows for the UCT universe and nothing
    # reads them.
    keep = {a: f for a, f in filings.items() if a in used or f.form in PERIODIC_FORMS}
    return keep, facts, anomalies


def ingest_parsed(conn, cik: int, meta: dict, filings: dict, facts: list, cf_sha: str, sub_sha: str,
                  *, anomalies: int = 0, force: bool = False, now: float | None = None) -> dict:
    """Write one parsed company in ONE transaction; skip if content unchanged."""
    now = time.time() if now is None else now
    prev = S.get_ingest_state(conn, cik)
    if (not force and prev and prev["companyfacts_sha"] == cf_sha
            and prev["submissions_sha"] == sub_sha and not prev["last_error"]):
        return {"cik": cik, "skipped": True}
    with S.tx(conn):
        S.put_security(conn, cik, meta.get("name"), meta.get("tickers") or [], meta.get("fiscalYearEnd"), now)
        new_filings = S.put_filings(conn, cik, filings, now)
        new_facts = S.put_facts(conn, cik, facts, now)
        unjoined = sum(1 for f in facts if f.accn not in filings)
        S.set_ingest_state(conn, cik, cf_sha, sub_sha, len(facts), None, now, unjoined=unjoined)
    return {"cik": cik, "skipped": False, "facts_seen": len(facts), "facts_new": new_facts,
            "filings_new": new_filings, "unjoined_facts": unjoined, "submission_anomalies": anomalies}


def ingest_company(conn, cik: int, companyfacts: dict, submissions_main: dict, pages: list[dict],
                   *, cf_bytes: bytes | None = None, sub_bytes: bytes | None = None,
                   force: bool = False, now: float | None = None) -> dict:
    """One company, one transaction. Returns stats; never partially applies."""
    cf_sha = _sha(cf_bytes if cf_bytes is not None else companyfacts)
    sub_sha = _sha(sub_bytes if sub_bytes is not None else pages)
    prev = S.get_ingest_state(conn, cik)
    if (not force and prev and prev["companyfacts_sha"] == cf_sha
            and prev["submissions_sha"] == sub_sha and not prev["last_error"]):
        return {"cik": cik, "skipped": True}
    filings, facts, anomalies = parse_company(companyfacts, pages)
    meta = {k: submissions_main.get(k) for k in ("name", "tickers", "fiscalYearEnd")}
    return ingest_parsed(conn, cik, meta, filings, facts, cf_sha, sub_sha,
                         anomalies=len(anomalies), force=True, now=now)


def record_failure(conn, cik: int, error: str, now: float | None = None) -> None:
    """A failed company is RECORDED (never silently skipped); a re-run retries it."""
    with S.tx(conn):
        prev = S.get_ingest_state(conn, cik) or {}
        S.set_ingest_state(conn, cik, prev.get("companyfacts_sha"), prev.get("submissions_sha"),
                           prev.get("facts_seen") or 0, error[:2000], now)


def ingest_signals(conn, rows: list[tuple], source: str, now: float | None = None) -> int:
    """Restatement signals (restatement_signals.*). Rows whose accession is not
    a known filing are kept anyway -- the join happens at read time, so a
    signal that arrives before its company is ingested is not lost."""
    with S.tx(conn):
        return S.put_signals(conn, rows, source, now)


def ingest_splits(conn, rows: list[tuple], source: str, now: float | None = None) -> int:
    with S.tx(conn):
        return S.put_splits(conn, rows, source, now)

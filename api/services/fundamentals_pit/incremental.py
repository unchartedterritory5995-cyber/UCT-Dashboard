"""Incremental ingestion: a filing is disseminated -> its values become servable.

    detect      EDGAR "latest filings" Atom feed (per form), or an explicit list
    ingest      the company's companyfacts + submissions (append-only; a filing
                already known changes nothing)
    signal      the NEW periodic filing's own XBRL instance -> restatement signals
    derive      that company's series (input-hash skip if nothing changed)
    publish     its artifact (ETag skip if unchanged) -> cache invalidates by ETag

Idempotent and restart-safe: every step keys on accession/CIK and the store's
own records (pending_refresh, signal_check, publish_log). A refresh that finds
the new accession NOT yet in companyfacts (SEC's XBRL API trails the submission
by up to a minute, longer at peak) stays PENDING and is retried; nothing is
half-applied. `reconcile` (nightly) re-runs the bulk archives through the same
idempotent path and repairs anything a missed poll left behind.

Not scheduled since the 2026-09-29 cutover: schedule.py registers only the V5 pipeline
(FUNDAMENTALS_PIT_V5_PIPELINE=1, worker). The flag that used to schedule this is read by nothing.
"""
from __future__ import annotations

import re
import time
import traceback
from datetime import datetime, timezone

from . import derive as D, ingest as I, publish as P, restatement_signals as R, sec_client as SEC, store as S
from .split_ledger import PRODUCTION_SOURCES

WATCH_FORMS = ("10-K", "10-Q", "10-K/A", "10-Q/A", "10-KT", "10-QT", "20-F", "40-F")
SIGNAL_FORMS = frozenset({"10-K", "10-Q", "10-K/A", "10-Q/A", "10-KT", "10-QT", "10-KT/A", "10-QT/A"})
MAX_ATTEMPTS = 12

_ENTRY = re.compile(r"<entry>(.*?)</entry>", re.S)
_TITLE = re.compile(r"<title>(.*?)</title>", re.S)
_HREF = re.compile(r'<link[^>]*href="([^"]+)"')
_UPDATED = re.compile(r"<updated>(.*?)</updated>")
_ACCN = re.compile(r"(\d{10}-\d{2}-\d{6})")
_CIK = re.compile(r"\((\d{4,10})\)")


def parse_current_feed(atom: str) -> list[dict]:
    """EDGAR getcurrent Atom -> [{form, cik, accn, updated}]."""
    out = []
    for body in _ENTRY.findall(atom):
        t, h, u = _TITLE.search(body), _HREF.search(body), _UPDATED.search(body)
        if not (t and h):
            continue
        title = t.group(1)
        form = title.split(" - ", 1)[0].strip()
        c, a = _CIK.search(title), _ACCN.search(h.group(1))
        if c and a:
            out.append({"form": form, "cik": int(c.group(1)), "accn": a.group(1),
                        "updated": u.group(1) if u else None})
    return out


def poll(forms=WATCH_FORMS, count: int = 100) -> list[dict]:
    seen, out = set(), []
    for form in forms:
        url = (f"{SEC.WWW}/cgi-bin/browse-edgar?action=getcurrent&type={form}&company=&dateb=&owner=include"
               f"&start=0&count={count}&output=atom")
        for e in parse_current_feed(SEC.get_bytes(url).decode("utf-8", "replace")):
            if e["accn"] not in seen and e["form"] == form:
                seen.add(e["accn"])
                out.append(e)
    return out


def enqueue(conn, events: list[dict], universe_ciks: set[int] | None, now: float | None = None) -> int:
    now = time.time() if now is None else now
    n = 0
    with S.tx(conn):
        for e in events:
            if universe_ciks is not None and e["cik"] not in universe_ciks:
                continue
            if conn.execute("SELECT 1 FROM filing WHERE accn=?", (e["accn"],)).fetchone():
                continue                                   # already ingested
            before = conn.total_changes
            conn.execute("INSERT OR IGNORE INTO pending_refresh VALUES (?,?,?,0,NULL)", (e["cik"], e["accn"], now))
            n += conn.total_changes - before
    return n


# ── V5: ONE restatement-evidence model for full AND incremental derivation ──
#
# ⛔⛔ MEASURED 2026-09-25: the full (v4) derivation took restatement evidence from
# the SEC FS data sets -- spans RECONSTRUCTED from (rounded end, quarter count) --
# and the incremental path from each filing's own instance (EXACT spans). 71 of 121
# filings disagreed and CELH 2022-05-10 derived differently in the two modes. V5 has
# ONE seam: every restatement signal, historical or new, is `instance_evidence`
# (the filing's own XBRL instance, exact context periods, consolidated-only) and is
# written by `record_evidence`. `check_signals` (incremental) and
# `instance_signal_pass` (full backfill) are two schedulers of the same two calls.

def instance_evidence(cik: int, accn: str, fetch_instance=None) -> list[tuple] | None:
    """The filing's restatement evidence, from its OWN instance. None = no instance.
    The fetcher resolves at CALL time (SEC.filing_instance), so one stub covers every route."""
    xml = (fetch_instance or SEC.filing_instance)(cik, accn)
    return None if xml is None else R.instance_signals(accn, xml)


def record_evidence(conn, accn: str, rows: list[tuple] | None, now: float) -> int:
    rows = rows or []
    with S.tx(conn):
        n = S.put_signals(conn, rows, "instance", now)
        conn.execute("INSERT OR REPLACE INTO signal_check VALUES (?,?,?,?)", (accn, now, len(rows), "instance"))
    return n


def _unchecked(conn, ciks=None) -> list[tuple[int, str]]:
    """Every filing that CONTRIBUTES XBRL FACTS and has no evidence record yet.

    ⛔ SCOPE, MEASURED 2026-09-25: restricting evidence to the 10-K/10-Q family lost
    real restatement evidence -- the v4 FS signals came from 20-F (355 filings),
    6-K (95), 8-K (84), 40-F, S-1/F-1/POS AM too, and a filing's numbers are used
    whatever its form. The rule is: evidence from every filing whose facts we hold;
    a filing with no XBRL facts has no instance and costs no request."""
    if ciks is None:
        ciks = [r[0] for r in conn.execute("SELECT DISTINCT cik FROM filing")]
    out = []
    for cik in ciks:                                     # per company: the fact PK starts with cik
        with_facts = {r[0] for r in conn.execute("SELECT DISTINCT filing_id FROM fact WHERE cik=?", (cik,))}
        out += [(cik, accn) for fid, accn in conn.execute(
            "SELECT f.filing_id, f.accn FROM filing f LEFT JOIN signal_check c ON c.accn = f.accn "
            "WHERE f.cik=? AND c.accn IS NULL", (cik,)) if fid in with_facts]
    return sorted(out)


def check_signals(conn, cik: int, *, fetch_instance=None, now: float | None = None) -> int:
    """INCREMENTAL: the evidence of every periodic filing of this company not yet checked."""
    now = time.time() if now is None else now
    total = 0
    for _, accn in _unchecked(conn, [cik]):
        total += record_evidence(conn, accn, instance_evidence(cik, accn, fetch_instance), now)
    return total


def instance_signal_pass(conn, ciks=None, *, workers: int = 8, fetch_instance=None,
                         now: float | None = None, progress=None) -> dict:
    """FULL: the same evidence for every unchecked periodic filing. Fetch + extract run
    on a thread pool under sec_client's ONE process-wide rate limiter; every write is
    on this thread. RESUMABLE: `signal_check` is the checkpoint -- a restart skips
    every filing already recorded."""
    from concurrent.futures import ThreadPoolExecutor
    now = time.time() if now is None else now
    todo = _unchecked(conn, ciks)
    out = {"todo": len(todo), "checked": 0, "signals": 0, "no_instance": 0, "failed": []}

    def work(item):
        cik, accn = item
        try:
            return item, instance_evidence(cik, accn, fetch_instance), None
        except Exception as e:                           # NOT recorded: retried on the next pass
            return item, None, str(e)[:300]

    with ThreadPoolExecutor(max(1, workers)) as ex:
        for (cik, accn), rows, err in ex.map(work, todo):
            if err is not None:
                out["failed"].append([cik, accn, err])
                continue
            if rows is None:
                out["no_instance"] += 1
            out["signals"] += record_evidence(conn, accn, rows, now)
            out["checked"] += 1
            if progress and out["checked"] % 500 == 0:
                progress(out)
    return out


def mark_backfilled_signals(conn, source: str, accns: set[str], now: float | None = None) -> None:
    """Record that FS-data-set coverage already inspected these filings, so the
    incremental path does not re-fetch their instances."""
    now = time.time() if now is None else now
    with S.tx(conn):
        conn.executemany("INSERT OR IGNORE INTO signal_check VALUES (?,?,?,?)",
                         [(a, now, -1, source) for a in accns])


def refresh_company(conn, cik: int, *, cache_dir: str | None = None, local_root: str | None = None,
                    sources=PRODUCTION_SOURCES, fetch_instance=None,
                    fetch_company=None, now: float | None = None) -> dict:
    """Ingest -> signals -> derive -> publish for ONE company."""
    now = time.time() if now is None else now
    if fetch_company is None:
        def fetch_company(c):
            main, pages = SEC.submission_pages(c, cache_dir=cache_dir)
            return SEC.companyfacts(c, cache_dir=cache_dir), main, pages
    cf, main, pages = fetch_company(cik)
    st = I.ingest_company(conn, cik, cf, main, pages, now=now)
    sig = check_signals(conn, cik, fetch_instance=fetch_instance, now=now)
    built = D.build_company(conn, cik, sources=sources, now=now)
    pub = P.publish_company(conn, cik, local_root=local_root, now=now)
    return {"cik": cik, "ingest": st, "signals": sig, "derive": built, "publish": pub}


def drain(conn, **kw) -> dict:
    """Work the pending queue. A pending filing clears only once its accession
    is actually in the store (companyfacts caught up); otherwise it is retried
    on the next drain, up to MAX_ATTEMPTS, and every failure is recorded."""
    report = {"done": [], "retry": [], "failed": []}
    # ⛔ An exhausted filing is NOT retried every tick (it used to be: the SELECT had
    # no attempts filter, so a permanently failing filing hit SEC forever). It stays
    # in pending_refresh with its last_error -- visible, counted as `exhausted` in
    # jobs_status.json -- and weekly_reconcile repairs it from the bulk archives.
    for cik, accn, attempts in conn.execute(
            "SELECT cik, accn, attempts FROM pending_refresh WHERE attempts < ? ORDER BY first_seen_at",
            (MAX_ATTEMPTS,)).fetchall():
        try:
            res = refresh_company(conn, cik, **kw)
            arrived = conn.execute("SELECT 1 FROM filing WHERE accn=?", (accn,)).fetchone() is not None
        except Exception:
            res, arrived = {"error": traceback.format_exc()[-800:]}, False
        with S.tx(conn):
            if arrived:
                conn.execute("DELETE FROM pending_refresh WHERE cik=? AND accn=?", (cik, accn))
                report["done"].append(accn)
            elif attempts + 1 >= MAX_ATTEMPTS:
                conn.execute("UPDATE pending_refresh SET attempts=?, last_error=? WHERE cik=? AND accn=?",
                             (attempts + 1, str(res.get("error", "never arrived"))[:2000], cik, accn))
                report["failed"].append(accn)
            else:
                conn.execute("UPDATE pending_refresh SET attempts=?, last_error=? WHERE cik=? AND accn=?",
                             (attempts + 1, res.get("error"), cik, accn))
                report["retry"].append(accn)
    return report


def reconcile(db: str, companyfacts_zip: str, submissions_zip: str, *, fs_zips=(), tickers_file: str | None = None,
              workers: int = 4) -> dict:
    """Nightly: the bulk archives through the SAME idempotent backfill path.
    Unchanged companies are skipped by content hash; anything a missed poll
    left behind is ingested, re-derived, and (via publish) re-served."""
    from .backfill import run
    argv = ["--db", db, "--bulk-companyfacts", companyfacts_zip, "--bulk-submissions", submissions_zip,
            "--workers", str(workers)]
    argv += ["--tickers-file", tickers_file] if tickers_file else ["--all"]
    for z in fs_zips:
        argv += ["--fs-zip", z]
    return run(argv)


def refresh_beta_all(conn, *, local_root: str | None = None, closes_fn=None) -> dict:
    """The DAILY Beta pass (after the close): every company whose closes moved
    is recomputed on the worker and republished. Idempotent -- an unchanged input
    hash is skipped, and publish_beta skips an unchanged etag."""
    from . import beta_store as BS
    from .publish import publish_beta
    ciks = [r[0] for r in conn.execute("SELECT cik FROM security ORDER BY cik")]
    out = BS.refresh(conn, ciks, **({"closes_fn": closes_fn} if closes_fn else {}))
    out["published"] = sum(1 for c in ciks if publish_beta(conn, c, local_root=local_root).get("published"))
    return out


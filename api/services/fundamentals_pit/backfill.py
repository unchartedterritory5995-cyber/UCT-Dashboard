"""Backfill / repair CLI for the PIT fundamentals store.

    python -m api.services.fundamentals_pit.backfill --db PATH  <source>  <scope>  [steps]

SOURCE (pick one)
  --bulk-companyfacts ZIP --bulk-submissions ZIP   SEC nightly archives (preferred: 2 downloads,
                                                   zero per-company requests)
  --online [--cache-dir DIR]                       data.sec.gov per company (repair / small lists),
                                                   rate-limited by sec_client
SCOPE (pick one)
  --tickers AAPL,NVDA | --tickers-file JSON | --ciks 320193,... | --all
STEPS
  --fs-zip PATH [--fs-zip PATH ...]   restatement signals from SEC FS data sets
  --splits-json PATH --splits-source NAME   split rows [[ticker, ex_date, ratio, ref], ...]
  --splits-massive FROM TO            split rows from the confirmed-splits adapter (needs MASSIVE_API_KEY)
  --no-derive                         ingest only
  --beta                              also precompute Beta (worker bars store)
  --split-sources a,b                 sources the DERIVE step trusts (default: production)
  --workers N  --force  --report PATH

RESTARTABLE: every company commits alone and records its content hash; a re-run
skips unchanged companies and retries failed ones. A failed company is
RECORDED in ingest_state.last_error and listed in the report -- never skipped
silently. DETERMINISTIC: the same inputs produce byte-identical series.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
import time
import traceback
import zipfile
from concurrent.futures import ProcessPoolExecutor

from . import derive as D, ingest as I, restatement_signals as R, sec_client as SEC, store as S
from .split_ledger import PRODUCTION_SOURCES

log = logging.getLogger("fundamentals_pit.backfill")

# ── bulk workers (module-level so they pickle) ──────────────────────────────
_ZIPS: dict = {}


def _zips(cf_path: str, sub_path: str):
    key = (cf_path, sub_path)
    if key not in _ZIPS:
        sub = zipfile.ZipFile(sub_path)
        _ZIPS[key] = (zipfile.ZipFile(cf_path), sub, set(sub.namelist()))
    return _ZIPS[key]


def _bulk_meta(args) -> tuple:
    """(member, cik, tickers) -- cheap pass to decide scope."""
    member, cf_path, sub_path = args
    cf, sub, names = _zips(cf_path, sub_path)
    cik = int(member.replace("CIK", "").split(".")[0])
    fn = f"CIK{cik:010d}.json"
    if fn not in names:
        return member, cik, None
    main = json.loads(sub.read(fn))
    return member, cik, [t.upper() for t in main.get("tickers") or []]


def _bulk_parse(args) -> dict:
    member, cf_path, sub_path = args
    try:
        cf, sub, names = _zips(cf_path, sub_path)
        raw = cf.read(member)
        doc = json.loads(raw)
        cik = int(doc.get("cik") or member.replace("CIK", "").split(".")[0])
        main_raw = sub.read(f"CIK{cik:010d}.json")
        main = json.loads(main_raw)
        pages = [main["filings"]["recent"]]
        extra = b""
        for f in main["filings"].get("files", []):
            if f["name"] in names:
                b = sub.read(f["name"])
                extra += b
                pages.append(json.loads(b))
        filings, facts, anomalies = I.parse_company(doc, pages)
        return {"cik": cik, "meta": {k: main.get(k) for k in ("name", "tickers", "fiscalYearEnd")},
                "filings": filings, "facts": facts, "anomalies": len(anomalies),
                "cf_sha": hashlib.sha256(raw).hexdigest(), "sub_sha": hashlib.sha256(main_raw + extra).hexdigest()}
    except Exception:
        return {"member": member, "error": traceback.format_exc()[-1500:]}


def _derive_one(args) -> dict:
    db, cik, sources, force = args
    try:
        conn = S.connect(db)
        try:
            return D.build_company(conn, cik, sources=tuple(sources), force=force)
        finally:
            conn.close()
    except Exception:
        return {"cik": cik, "error": traceback.format_exc()[-1500:]}


# ── orchestration ───────────────────────────────────────────────────────────
def run(argv: list[str] | None = None) -> dict:
    quiet_http_loggers()
    ap = argparse.ArgumentParser(prog="fundamentals_pit.backfill")
    ap.add_argument("--db", required=True)
    ap.add_argument("--bulk-companyfacts")
    ap.add_argument("--bulk-submissions")
    ap.add_argument("--online", action="store_true")
    ap.add_argument("--cache-dir")
    ap.add_argument("--tickers")
    ap.add_argument("--tickers-file")
    ap.add_argument("--ciks")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--listed", action="store_true",
                    help="every filer with at least one ticker (what a chart can reach)")
    ap.add_argument("--fs-zip", action="append", default=[])
    ap.add_argument("--splits-json")
    ap.add_argument("--splits-source")
    ap.add_argument("--splits-massive", nargs=2, metavar=("FROM", "TO"))
    ap.add_argument("--split-sources", default=",".join(PRODUCTION_SOURCES))
    ap.add_argument("--no-derive", action="store_true")
    ap.add_argument("--beta", action="store_true",
                    help="precompute Beta for derived companies from THIS process's bars store (worker)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--report")
    a = ap.parse_args(argv)
    t0 = time.time()
    conn = S.connect(a.db)
    report: dict = {"started": t0, "ingested": 0, "skipped": 0, "failed": [], "facts_new": 0,
                    "filings_new": 0, "derived": 0, "derive_skipped": 0, "derive_failed": [],
                    "split_unverified": [], "signals_new": 0, "splits_new": 0}

    tickers = None
    if a.tickers:
        tickers = {t.strip().upper() for t in a.tickers.split(",") if t.strip()}
    elif a.tickers_file:
        tickers = {t.upper() for t in json.load(open(a.tickers_file))}
    ciks_wanted = {int(c) for c in a.ciks.split(",")} if a.ciks else None
    if not (tickers or ciks_wanted or a.all or a.listed):
        ap.error("choose a scope: --tickers / --tickers-file / --ciks / --listed / --all")

    # 1. splits (independent of companies)
    if a.splits_json:
        if not a.splits_source:
            ap.error("--splits-json needs --splits-source")
        rows = [(t, d, r, ref) for t, d, r, ref in json.load(open(a.splits_json))]
        report["splits_new"] += I.ingest_splits(conn, rows, a.splits_source)
    if a.splits_massive:
        from .split_ledger import massive_rows_chunked
        rows = massive_rows_chunked(*a.splits_massive)
        report["splits_fetched"] = len(rows)
        report["splits_new"] += I.ingest_splits(conn, rows, "massive")

    # 2. companies
    done_ciks: list[int] = []
    if a.bulk_companyfacts:
        cf = zipfile.ZipFile(a.bulk_companyfacts)
        members = [i.filename for i in cf.infolist() if i.filename.endswith(".json")]
        with ProcessPoolExecutor(a.workers) as ex:
            metas = list(ex.map(_bulk_meta, [(m, a.bulk_companyfacts, a.bulk_submissions) for m in members],
                                chunksize=64))
            chosen = [m for m, cik, tk in metas
                      if a.all or (a.listed and tk) or (ciks_wanted and cik in ciks_wanted)
                      or (tickers and tk and set(tk) & tickers)]
            report["scope"] = len(chosen)
            log.info("bulk scope: %d companies", len(chosen))
            for i, res in enumerate(ex.map(_bulk_parse, [(m, a.bulk_companyfacts, a.bulk_submissions)
                                                          for m in chosen], chunksize=8)):
                if "error" in res:
                    report["failed"].append({"member": res["member"], "error": res["error"][-300:]})
                    continue
                try:
                    st = I.ingest_parsed(conn, res["cik"], res["meta"], res["filings"], res["facts"],
                                         res["cf_sha"], res["sub_sha"], anomalies=res["anomalies"], force=a.force)
                except Exception:
                    err = traceback.format_exc()[-1500:]
                    I.record_failure(conn, res["cik"], err)
                    report["failed"].append({"cik": res["cik"], "error": err[-300:]})
                    continue
                done_ciks.append(res["cik"])
                _tally(report, st)
                if i % 250 == 0:
                    log.info("ingested %d/%d", i + 1, len(chosen))
    elif a.online:
        tmap = SEC.company_tickers(cache_dir=a.cache_dir)
        ciks = set(ciks_wanted or ())
        for t in tickers or ():
            if t in tmap:
                ciks.add(tmap[t])
            else:
                report["failed"].append({"ticker": t, "error": "no SEC CIK for ticker"})
        report["scope"] = len(ciks)
        for cik in sorted(ciks):
            try:
                cfd = SEC.companyfacts(cik, cache_dir=a.cache_dir)
                main, pages = SEC.submission_pages(cik, cache_dir=a.cache_dir)
                st = I.ingest_company(conn, cik, cfd, main, pages, force=a.force)
            except Exception:
                err = traceback.format_exc()[-1500:]
                I.record_failure(conn, cik, err)
                report["failed"].append({"cik": cik, "error": err[-300:]})
                continue
            done_ciks.append(cik)
            _tally(report, st)
    else:
        ap.error("choose a source: --bulk-companyfacts/--bulk-submissions or --online")

    # 3. restatement signals for filings we hold
    if a.fs_zip:
        known = {r[0] for r in conn.execute("SELECT accn FROM filing")}
        for path in a.fs_zip:
            src = f"fs_dataset:{path.replace(chr(92), '/').rsplit('/', 1)[-1]}"
            with zipfile.ZipFile(path) as z:
                with z.open("num.txt") as f:
                    rows = R.fs_dataset_signals(f, known)
                with z.open("sub.txt") as f:
                    covered = set(R.fs_dataset_accepted(f)) & known
            report["signals_new"] += I.ingest_signals(conn, rows, src)
            from .incremental import mark_backfilled_signals
            mark_backfilled_signals(conn, src, covered)

    # 4. derive
    if not a.no_derive:
        sources = tuple(s for s in a.split_sources.split(",") if s)
        targets = sorted(set(done_ciks))
        with ProcessPoolExecutor(a.workers) as ex:
            for res in ex.map(_derive_one, [(a.db, c, sources, a.force) for c in targets], chunksize=4):
                if "error" in res:
                    report["derive_failed"].append({"cik": res["cik"], "error": res["error"][-300:]})
                elif res.get("skipped"):
                    report["derive_skipped"] += 1
                else:
                    report["derived"] += 1
                    if res.get("withheld_split_sensitive"):
                        report["split_unverified"].append(res["cik"])

    # 4b. Beta, precomputed here -- never on a member request (beta_store.py)
    if a.beta:
        from . import beta_store as BS
        ciks = sorted(set(done_ciks)) or [r[0] for r in conn.execute("SELECT cik FROM security")]
        report["beta"] = BS.refresh(conn, ciks)

    # 5. reconciliation summary (read back from the store, not from memory)
    report["store"] = {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
                       for t in ("security", "filing", "fact", "filing_signal", "split_event", "series_point")}
    report["recorded_failures"] = conn.execute(
        "SELECT count(*) FROM ingest_state WHERE last_error IS NOT NULL").fetchone()[0]
    report["elapsed_s"] = round(time.time() - t0, 1)
    conn.close()
    if a.report:
        from api.services.log_redaction import redact
        with open(a.report, "w") as f:
            f.write(redact(json.dumps(report, indent=1, default=str)))
    return report


def quiet_http_loggers() -> None:
    from api.services.log_redaction import install
    install()                       # and redact any credential that still reaches a record
    for name in ("httpx", "httpcore", "urllib3", "requests"):
        logging.getLogger(name).setLevel(logging.WARNING)


def _tally(report: dict, st: dict) -> None:
    if st.get("skipped"):
        report["skipped"] += 1
    else:
        report["ingested"] += 1
        report["facts_new"] += st.get("facts_new", 0)
        report["filings_new"] += st.get("filings_new", 0)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    # ⛔ NEVER LOG REQUEST URLS. The Massive client carries `apiKey=` in the query
    # string, and httpx logs every request URL at INFO -- measured: the first
    # production run wrote the key into its job log in plain text.
    quiet_http_loggers()
    rep = run()
    print(json.dumps({k: (v if not isinstance(v, list) else len(v)) for k, v in rep.items()}, default=str))
    sys.exit(1 if rep["failed"] or rep["derive_failed"] else 0)

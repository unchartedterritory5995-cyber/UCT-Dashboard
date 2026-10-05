"""Market Cap V1 ACQUISITION -- every input of a build, produced by committed code from named sources.

The accepted candidate's inputs were assembled by hand over several sessions (ad-hoc exports and candidate lists).
This module is that assembly as code, so a scheduled refresh can reproduce it without anyone at a shell:

  SOURCE (production-only)        STAGE                         OUTPUT (the build's --data dir)
  Fundamentals V5 live.db         universe                      sec_t.json.gz   {cik: ["", [tickers]]}
  bars.db (daily, split-adjusted) prices                        prices.db       (prices.py schema)
  Massive reference API           reference                     ref.jsonl       [ticker, details, splits, events]
  SEC bulk (public)               sec_bulk                      companyfacts.zip, submissions.zip (+ Last-Modified)
  -                               inputs                        inputs.db       (inputs.stage)
  frozen V5 acceptance export     acceptance                    acceptance.db   (acceptance.build)
  + EDGAR acceptance records
  SEC archives (cached)           lineage                       fileno.db, lineage.db
  lineage PURE_REORGANIZATION/OK  predecessors                  pred_inputs.db, pred_covers.db, pred_text.db, pred_econ.db
  staged data                     plan                          ipo_list.json, adr_ciks.json, multiclass_ciks.json
  SEC archives (cached)           harvests                      covers.db, text.db, ipo.db, adr.db, prosp.db
  a build                         build-dependent harvests      econ.db (econ_request), splitev.db (held splits)

EVIDENCE IS ACCUMULATED, NEVER REWRITTEN. Evidence DBs are facts about immutable SEC documents. A refresh copies the
previous run's evidence DBs and RESUMES each harvest (the harvests skip documents already done), so only new filings
are fetched; every fetch goes through the content-addressed cache (fetch.py), so re-deriving everything from scratch
(`fresh_evidence`) is the same computation with no network. The parsers are pinned (methodology.py).

EVIDENCE WINDOW (pinned): the accepted candidate's offering-document evidence (prosp.db) covers filings from
PROSP_EVIDENCE_FROM onward -- the original newest-first harvest stopped there; 10,522 older 424B/S-1/F-1/S-3/F-3
filings (1994-2004) were never parsed. A refresh keeps that window so it cannot silently change accepted pre-2005
history; widening it is an owner decision (docs/marketcap/PRODUCTION-LIFECYCLE.md).
"""
from __future__ import annotations

import gzip
import json
import os
import shutil
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

PROSP_EVIDENCE_FROM = "2004-10-22"
EVIDENCE_FILES = ("covers.db", "text.db", "ipo.db", "econ.db", "adr.db", "prosp.db", "splitev.db",
                  "pred_covers.db", "pred_text.db", "pred_econ.db")
BUILD_INPUTS = ("inputs.db", "covers.db", "text.db", "ipo.db", "econ.db", "adr.db", "prices.db", "ref.jsonl", "acceptance.db",
                "prosp.db", "splitev.db", "lineage.db", "pred_inputs.db", "pred_covers.db", "pred_text.db", "pred_econ.db",
                "identity.db", "offering.db")
SEC_BULK = {"companyfacts.zip": "https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip",
            "submissions.zip": "https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip"}
REF_FIELDS = ("ticker", "name", "market", "locale", "primary_exchange", "type", "active", "cik", "composite_figi",
              "share_class_figi", "list_date", "delisted_utc", "share_class_shares_outstanding", "weighted_shares_outstanding",
              "market_cap", "currency_name")


class AcquisitionError(RuntimeError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── production-only sources ─────────────────────────────────────────────────────────────────────────────────────────
def universe_from_v5(live_db: str, out: str) -> dict:
    """The Fundamentals V5 security table (read-only): exactly the export the accepted candidate used."""
    c = sqlite3.connect(f"file:{live_db}?mode=ro", uri=True)
    try:
        uni = {str(k): ["", json.loads(t)] for k, _n, t in c.execute("SELECT cik, name, tickers FROM security")}
    finally:
        c.close()
    if len(uni) < 1000:
        raise AcquisitionError(f"universe has only {len(uni)} issuers")
    open(out, "wb").write(gzip.compress(json.dumps(uni).encode()))
    return {"issuers": len(uni), "tickers": sum(len(v[1]) for v in uni.values())}


def tickers_of(universe_path: str) -> list[str]:
    d = json.loads(gzip.decompress(open(universe_path, "rb").read()))
    return sorted({t for _n, ts in d.values() for t in ts})


def prices_from_bars(bars_db: str, universe_path: str, out: str, pause: float = 0.0) -> dict:
    """Daily closes for every universe ticker from bars.db (read-only), in prices.py's schema. bars.db is
    split-adjusted to today's basis, so this is a FULL export every time (a split re-bases a whole history)."""
    from .prices import DDL
    src = sqlite3.connect(f"file:{bars_db}?mode=ro", uri=True)
    if os.path.exists(out):
        os.remove(out)
    db = sqlite3.connect(out)
    db.executescript(DDL)
    n_t = n_b = 0
    latest = 0
    for t in tickers_of(universe_path):
        rows = src.execute("SELECT ts, c, v FROM ohlcv WHERE ticker=? AND tf='D' ORDER BY ts", (t,)).fetchall()
        if rows:
            bad = [r[0] for r in rows if not (19000101 <= int(r[0]) <= 21001231)]
            if bad:
                raise AcquisitionError(f"{t}: daily keys are not YYYYMMDD (e.g. {bad[0]})")
            db.executemany("INSERT OR REPLACE INTO bar VALUES(?,?,?,?)", ((t, int(r[0]), r[1], r[2]) for r in rows))
            n_t += 1
            n_b += len(rows)
            latest = max(latest, int(rows[-1][0]))
        if pause:
            time.sleep(pause)
    db.commit()
    db.close()
    src.close()
    return {"tickers": n_t, "bars": n_b, "latest_session": latest}


def reference_from_massive(universe_path: str, out: str, *, key: str | None = None, pause: float = 0.25,
                           base: str = "https://api.polygon.io") -> dict:
    """Massive reference per universe ticker: details, full split history, ticker-change events (resumable).
    Identical endpoints and fields to the accepted candidate's pull. Share counts here are NEVER used as evidence."""
    key = key or os.environ.get("MASSIVE_API_KEY") or os.environ.get("POLYGON_API_KEY")
    if not key:
        raise AcquisitionError("Massive API key NOT CONFIGURED")
    errors = []

    def get(path):
        url = base + path + ("&" if "?" in path else "?") + "apiKey=" + key
        for i in range(4):
            try:
                with urllib.request.urlopen(url, timeout=30) as r:
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return {"status": "NOT_FOUND"}
                time.sleep(2 * (i + 1))
            except Exception:  # noqa: BLE001
                time.sleep(2 * (i + 1))
        errors.append(path.split("?")[0])
        return {"status": "ERROR"}

    done = set()
    if os.path.exists(out):
        done = {json.loads(line)[0] for line in open(out)}
    n = 0
    with open(out, "a") as f:
        for t in tickers_of(universe_path):
            if t in done:
                continue
            d = (get(f"/v3/reference/tickers/{t}").get("results") or {})
            s = get(f"/v3/reference/splits?ticker={t}&limit=1000").get("results") or []
            ev = {}
            if d.get("composite_figi"):
                ev = (get(f"/vX/reference/tickers/{d['composite_figi']}/events").get("results") or {})
            f.write(json.dumps([t, {k: d.get(k) for k in REF_FIELDS},
                                [[x.get("execution_date"), x.get("split_from"), x.get("split_to")] for x in s],
                                ev.get("events") or []]) + "\n")
            f.flush()
            n += 1
            time.sleep(pause)
    if errors:
        raise AcquisitionError(f"{len(errors)} Massive reference requests failed (e.g. {errors[0]})")
    return {"tickers_pulled": n, "already": len(done)}


# ── SEC public sources ──────────────────────────────────────────────────────────────────────────────────────────────
def sec_head(url: str) -> dict:
    from api.services.fundamentals_pit import sec_client as SEC
    ua = os.environ.get("SEC_USER_AGENT", SEC.DEFAULT_UA)
    r = urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers={"User-Agent": ua}), timeout=60)
    lm = r.headers.get("Last-Modified")
    return {"last_modified": parsedate_to_datetime(lm).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if lm else None,
            "bytes": int(r.headers.get("Content-Length") or 0)}


def sec_bulk(dest_dir: str) -> dict:
    """Download SEC's nightly companyfacts/submissions bulk files (rate-limited client, atomic rename)."""
    from api.services.fundamentals_pit import sec_client as SEC
    from .inputs import sha256
    os.makedirs(dest_dir, exist_ok=True)
    out = {}
    for name, url in SEC_BULK.items():
        head = sec_head(url)
        p = os.path.join(dest_dir, name)
        t0 = time.time()
        n = SEC.download(url, p)
        out[name] = {**head, "path": p, "downloaded_bytes": n, "sha256": sha256(p), "seconds": round(time.time() - t0, 1)}
        if head["bytes"] and os.path.getsize(p) != head["bytes"]:
            raise AcquisitionError(f"{name}: {os.path.getsize(p)} bytes, SEC announced {head['bytes']}")
    return out


# ── harvests that need code beyond the pinned CLIs ──────────────────────────────────────────────────────────────────
def harvest_prosp_windowed(inputs: str, out: str, workers: int = 16, from_date: str = PROSP_EVIDENCE_FROM) -> dict:
    """harvest_text --mode prosp, restricted to the pinned evidence window (same selection, parser, DB layout)."""
    from . import harvest_text as H
    inp = sqlite3.connect(inputs)
    db = sqlite3.connect(out, check_same_thread=False)
    db.executescript(H.DDL)
    done = {a for (a,) in db.execute("SELECT accn FROM done WHERE mode='prosp'")}
    todo = [x for x in H.select_prosp(inp) if x[3] >= from_date and x[1] not in done]
    lock = threading.Lock()
    ok, err = [0], []

    def work(x):
        try:
            rows = H.prosp_one(*x)
        except Exception as e:  # noqa: BLE001 -- not marked done: retried on the next run
            with lock:
                err.append((x[1], type(e).__name__))
            return
        with lock:
            db.executemany("INSERT INTO prosp_obs VALUES(?,?,?,?,?,?,?,?,?,?,?)", rows)
            db.execute("INSERT OR REPLACE INTO done VALUES(?,?,?)", ("prosp", x[0], x[1]))
            ok[0] += 1
    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(work, todo))
    db.commit()
    return {"mode": "prosp", "window_from": from_date, "todo": len(todo), "processed": ok[0], "errors": len(err)}


def split_candidates(build_db: str) -> list[dict]:
    """Held split transitions of a build that need authoritative evidence: split_gap HELD_NO_EVIDENCE, with the
    accessions of the states on either side (the rule the accepted candidate's splitev inputs were derived with)."""
    B = sqlite3.connect(f"file:{build_db}?mode=ro", uri=True)
    out = []
    for cik, d, k, dirn, cls, pa, na in B.execute("SELECT cik, d, k, direction, cls, prev_asof, next_asof FROM split_gap "
                                                  "WHERE status='HELD_NO_EVIDENCE'"):
        runs = B.execute("SELECT start, end, obs_accession FROM state_run WHERE issuer_id=? ORDER BY start", (f"cik:{cik}",)).fetchall()
        nxt = [r for r in runs if r[0] >= d][:1]
        prv = [r for r in runs if r[1] < d][-1:]
        out.append(dict(cik=cik, date=d, k=k, direction=dirn, cls=cls, prev_asof=pa, next_asof=na,
                        next_accn=nxt[0][2] if nxt else None, prev_accn=prv[0][2] if prv else None))
    B.close()
    return out


def evidence_ciks(splitev_db: str) -> set:
    if not os.path.exists(splitev_db):
        return set()
    c = sqlite3.connect(f"file:{splitev_db}?mode=ro", uri=True)
    try:
        return {x for (x,) in c.execute("SELECT DISTINCT cik FROM split_evidence")}
    finally:
        c.close()


def econ_list(build_db: str) -> list:
    B = sqlite3.connect(f"file:{build_db}?mode=ro", uri=True)
    try:
        return [list(x) for x in sorted({(c, a) for c, a in B.execute("SELECT cik, accn FROM econ_request WHERE accn IS NOT NULL")})]
    finally:
        B.close()


def predecessor_universe(lineage_db: str, inputs_db: str) -> dict:
    """Predecessor registrants of PROVEN pure reorganizations (lineage PURE_REORGANIZATION / OK)."""
    L = sqlite3.connect(f"file:{lineage_db}?mode=ro", uri=True)
    preds = {(p, n) for p, n in L.execute("SELECT pred_cik, pred_name FROM lineage WHERE kind='PURE_REORGANIZATION' "
                                          "AND status='OK' AND pred_cik IS NOT NULL")}
    L.close()
    return {str(p): [n or "", []] for p, n in sorted(preds)}


def evidence_counts(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        tabs = [t for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        return {t: c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tabs}
    finally:
        c.close()


def missing_after(kind: str, data: str, arg=None) -> int:
    """How many documents a harvest's selection still lacks (fetch failures). 0 = complete."""
    from . import harvest_covers as HC, harvest_text as H
    inp = sqlite3.connect(f"file:{os.path.join(data, 'inputs.db')}?mode=ro", uri=True)
    try:
        if kind == "covers":
            done = {a for (a,) in sqlite3.connect(os.path.join(data, "covers.db")).execute("SELECT accn FROM cover_status")}
            sel = HC.select(inp) + (HC.select_ciks(inp, arg) if arg else [])
            return len({a for _c, a in sel} - done)
        db, mode = {"text": ("text.db", "text"), "ipo": ("ipo.db", "ipo"), "adr": ("adr.db", "adr"), "econ": ("econ.db", "econ"),
                    "prosp": ("prosp.db", "prosp")}[kind]
        done = {a for (a,) in sqlite3.connect(os.path.join(data, db)).execute("SELECT accn FROM done WHERE mode=?", (mode,))}
        if kind == "text":
            sel = H.select_text(inp)
        elif kind == "ipo":
            sel = H.select_ipo(inp, arg)
        elif kind == "adr":
            sel = H.select_docs(inp, arg, ("20-F", "40-F", "20-F/A", "F-6", "F-6EF", "F-6/A"))
        elif kind == "econ":
            sel = H.select_docs(inp, arg, ("10-K", "10-K405", "20-F", "40-F", "10-KT"))
        else:
            sel = [x for x in H.select_prosp(inp) if x[3] >= PROSP_EVIDENCE_FROM]
        return len({x[1] for x in sel} - done)
    finally:
        inp.close()


def seed_evidence(prev_data: str, data: str) -> dict:
    """Copy the previous run's evidence DBs (never modified in place) into this run's data dir."""
    os.makedirs(data, exist_ok=True)
    out = {}
    for n in EVIDENCE_FILES:
        src = os.path.join(prev_data, n)
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(data, n))
            out[n] = os.path.getsize(src)
    return out


def knowledge(data: str) -> dict:
    """The two clocks' inputs: newest filing public instant, newest priced session."""
    inp = sqlite3.connect(f"file:{os.path.join(data, 'inputs.db')}?mode=ro", uri=True)
    px = sqlite3.connect(f"file:{os.path.join(data, 'prices.db')}?mode=ro", uri=True)
    try:
        cutoff = inp.execute("SELECT MAX(public_at) FROM filing").fetchone()[0]
        latest_px = px.execute("SELECT MAX(d) FROM bar").fetchone()[0]
    finally:
        inp.close()
        px.close()
    return {"filing_knowledge_cutoff": cutoff, "latest_price_session": latest_px}

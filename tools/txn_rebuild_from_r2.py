"""Rebuild the Trade Exchange News database from the PERMANENT R2 journal.

    python tools/txn_rebuild_from_r2.py --to /tmp/txn-rebuilt.db              # R2 from TXN_JOURNAL_* env
    python tools/txn_rebuild_from_r2.py --to OUT.db --journal-dir DIR          # a file journal (tests, drills)
    python tools/txn_rebuild_from_r2.py --to OUT.db --verify-only              # re-check an existing rebuild

The journal holds one object per DELIVERY, every delivery ever received, forever
(no lifecycle rule on the events prefix -- never reintroduce one). Replaying all of
them, in event-id (= receipt) order, through the SAME ingest web uses
(``Store.ingest``: validation, the duplicate policy, ticker resolution, the ledger
with the exact original bytes) gives back every headline and every delivery record.
The result is a NEW database: a new epoch (every browser discards its cursor and
reloads, by design), ``via='reconcile'``, ``journaled=1``; ingest time is set to the
receipt time, so no rebuilt headline is flagged "delayed".

⛔ SAFETY. It writes ONLY the ``--to`` file, which must not exist (``--verify-only``
reads it). It never deletes or rewrites a journal object (it only LISTs and GETs)
and never touches a live database. Putting the rebuilt file in place is a separate,
manual step with web stopped: docs/runbooks/trade-exchange-news-retention.md.

Verification (exit 0 only when every check passes; 1 otherwise; 2 inconclusive):
  * every settled journal object is a delivery in the rebuilt ledger, and nothing else is;
  * the ledger accounts for every headline and every collapsed repeat (integrity.py);
  * ``PRAGMA integrity_check`` is ok.
Prints counts only -- never headline content.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))


def _reader(args):
    from api.services.trade_exchange_news import journal_reader as jr
    if args.journal_dir:
        return jr.FileJournalReader(args.journal_dir, args.prefix or jr.DEFAULT_PREFIX)
    r = jr.reader_from_env()
    if r is None:
        raise SystemExit("no journal: pass --journal-dir or set TXN_JOURNAL=s3 and TXN_JOURNAL_* credentials")
    return r


def rebuild(reader, dest: str, *, workers: int = 16, chunk: int = 256, progress=print) -> dict:
    from api.services.trade_exchange_news import config, records
    from api.services.trade_exchange_news.pipeline import _tickers_for
    from api.services.trade_exchange_news.store import Store
    if os.path.exists(dest):
        raise SystemExit(f"refusing: {dest} exists (the rebuild never overwrites a database)")
    store = Store(dest)
    t0 = time.time()
    ids = list(reader.ids_after(""))
    progress(f"journal lists {len(ids)} deliveries")
    counts = {"new": 0, "repeat": 0, "known": 0, "invalid": 0}
    window = config.dedupe_window_ms()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i in range(0, len(ids), chunk):
            part = ids[i:i + chunk]
            for eid, raw in zip(part, pool.map(reader.get, part)):      # map keeps event-id order
                try:
                    rec = records.validate(raw)
                except records.RecordError:
                    counts["invalid"] += 1
                    progress(f"  invalid journal record {eid} (kept in R2, not ingested)")
                    continue
                out = store.ingest(rec, via="reconcile",
                                   dedupe_key=records.dedupe_key(rec["source"], rec["content"]),
                                   window_ms=window, tickers=_tickers_for(rec["content"], rec["source"]),
                                   now_ms=rec["received_at_ms"], record_json=records.encode_record(raw))
                counts[out["kind"]] += 1
            if (i // chunk) % 20 == 0:
                progress(f"  {min(i + chunk, len(ids))}/{len(ids)}")
    counts["seconds"] = round(time.time() - t0, 1)
    return counts


def verify(reader, dest: str) -> tuple[int, dict]:
    import sqlite3
    from api.services.trade_exchange_news import integrity
    from api.services.trade_exchange_news.store import Store
    if not os.path.exists(dest):
        return 2, {"error": f"{dest} does not exist"}
    store = Store(dest)
    rep = integrity.check(store, reader, backup_probe=None, now_ms=int(time.time() * 1000) + integrity.GRACE_MS)
    c = sqlite3.connect(dest)
    try:
        rep["integrity_check"] = c.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        c.close()
    rep.pop("_recover_ids", None)
    rep.pop("_relink_ids", None)
    ok = rep["ok"] and rep["integrity_check"] == "ok"
    return (0 if ok else 1), rep


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--to", required=True, help="the NEW database file to write (must not exist)")
    ap.add_argument("--journal-dir", help="a file journal root instead of R2")
    ap.add_argument("--prefix", help="journal prefix (default trade-exchange-news/v1/events)")
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--verify-only", action="store_true")
    args = ap.parse_args(argv)
    if Path(args.to).resolve().parent in (Path("/data").resolve(), Path("C:/data").resolve()) and not args.verify_only:
        print("refusing: write the rebuild outside the live data directory, then swap it in per the runbook")
        return 2
    reader = _reader(args)
    if not args.verify_only:
        print("rebuild:", rebuild(reader, args.to, workers=args.workers))
    code, rep = verify(reader, args.to)
    print("verify:", "PASS" if code == 0 else ("FAIL" if code == 1 else "INCONCLUSIVE"))
    print("  ledger:", rep.get("ledger"))
    print("  journal:", rep.get("journal"))
    print("  integrity_check:", rep.get("integrity_check"))
    for p in rep.get("problems", []):
        print("  problem:", p)
    return code


if __name__ == "__main__":
    raise SystemExit(main())

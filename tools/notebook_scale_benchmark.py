"""Wave 0 (P0-2 performance gate): honest search/folder read-latency numbers
at realistic Notebook sizes — 100 / 1,000 / 10,000 / 50,000+ notes.

VERIFICATION ONLY. This does not change any product code — it measures the
REAL query functions (notes.py's list_notes/count_notes/folder_note_counts/
notes_for_folders/get_symbol_backlinks/tag_counts) against a freshly-seeded
SQLite file per tier, through the real schema (ensure_schema) and the real
FTS5 triggers (seeding is a bulk raw INSERT, not create_note() per row, but
AFTER INSERT ON j2_notes fires identically regardless of the INSERT's
source, so the FTS index it produces is byte-for-byte what production would
build). A trivial fixture (a handful of notes, an in-memory DB with no real
disk I/O) cannot stand in for this — the P0-2 defect it exists to catch
(a folder's true size silently invisible past a capped page) only manifests
at real scale, sorted the way a migrated library actually sorts.

Usage:
    python tools/notebook_scale_benchmark.py [--tiers 100,1000,10000,50000]
                                              [--out report.json] [--keep-db]

Prints a per-tier table to stdout and (optionally) a machine-readable JSON
report. Never hides a slow number — that is the entire point of this script.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sqlite3
import sys
import tempfile
import time
import tracemalloc
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc

USER_ID = "bench_user"

# A real trading-journal-shaped body so FTS5 has genuine text to index —
# never an empty string (that would make every latency number a lie about
# what production actually indexes).
_BODY_TEMPLATE = (
    "Reviewed the setup on {ticker} this morning. Price reclaimed the 20 EMA "
    "on above-average volume after a three-week pullback from the prior high. "
    "Watching for a base breakout above {level} with a stop under the recent "
    "swing low. Risk stays under 1% of account size per the standard sizing "
    "rule. {marker}"
)
_COMMON_MARKER = "regime check confirms constructive breadth"
_RARE_MARKER = "zzqbenchmarkrareterm"
_TICKERS = ["AMD", "NVDA", "TSLA", "MSFT", "AAPL", "GOOGL", "META", "AVGO", "CRM", "NFLX"]
_TAGS_POOL = ["earnings", "setup", "watchlist", "review", "thesis", "risk", "macro"]


def _seed(conn: sqlite3.Connection, n: int, heavy_folder_id: str, other_folder_ids: list[str]) -> dict:
    """Bulk raw INSERT — realistic distribution, real FTS-indexable text.
    Returns seed metadata (ticker used for embeds, marker counts) so the
    measurement phase can build correct, non-trivial queries against it."""
    rng = random.Random(42)  # deterministic across runs, for reproducible numbers
    now = "2026-01-01T00:00:00+00:00"
    rows = []
    embed_rows = []
    common_count = 0
    rare_count = 0
    # The heavy folder holds ~15% of the library — the exact shape of the
    # P0-2 defect (one big catch-all folder whose notes sort past any
    # capped, alphabetically-ordered page).
    heavy_share = max(1, int(n * 0.15))
    for i in range(n):
        note_id = uuid.uuid4().hex
        ticker = _TICKERS[i % len(_TICKERS)]
        is_common = rng.random() < 0.30
        is_rare = (i == n // 2)  # exactly one note carries the rare marker
        marker = ""
        if is_common:
            marker = _COMMON_MARKER
            common_count += 1
        if is_rare:
            marker = (marker + " " + _RARE_MARKER).strip()
            rare_count += 1
        body_plain = _BODY_TEMPLATE.format(ticker=ticker, level=round(50 + i * 0.01, 2), marker=marker)
        body_json = json.dumps({"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": body_plain}]},
        ]})
        folder_id = heavy_folder_id if i < heavy_share else (
            other_folder_ids[i % len(other_folder_ids)] if other_folder_ids and i % 3 != 0 else None
        )
        tags = json.dumps(rng.sample(_TAGS_POOL, k=rng.randint(0, 3)))
        rows.append((
            note_id, USER_ID, None, folder_id, f"Note {i:06d} — {ticker} setup", None,
            body_json, body_plain, None, None, ticker, tags, now, now,
        ))
        if i % 10 == 0:  # ~10% of notes carry a chart embed, for backlinks
            embed_rows.append((note_id, USER_ID, 0, "chart", ticker, "D", None, "snapshot", now))
    conn.executemany(
        "INSERT INTO j2_notes (id, user_id, account_id, folder_id, title, subtitle,"
        " body_json, body_plain, hero_image_url, first_image_url, ticker, tags,"
        " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    conn.executemany(
        "INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol,"
        " timeframe, trade_ref, mode, captured_at) VALUES (?,?,?,?,?,?,?,?,?)",
        embed_rows,
    )
    conn.commit()
    return {
        "heavy_share": heavy_share, "common_count": common_count, "rare_count": rare_count,
        "embed_symbol": _TICKERS[0],  # i % 10 == 0 always lands on _TICKERS[0] for i=0,10,20...
    }


def _time_ms(fn) -> tuple[float, object]:
    t0 = time.perf_counter()
    result = fn()
    return (time.perf_counter() - t0) * 1000.0, result


def run_tier(n: int, keep_db: bool = False) -> dict:
    tmp_dir = tempfile.mkdtemp(prefix=f"j2_bench_{n}_")
    db_path = os.path.join(tmp_dir, "bench.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    j2db.ensure_schema(conn)

    heavy = notes_svc.create_folder(USER_ID, "Catch-All", conn=conn)
    others = [notes_svc.create_folder(USER_ID, f"Folder {i}", conn=conn)["id"] for i in range(8)]

    seed_t0 = time.perf_counter()
    meta = _seed(conn, n, heavy["id"], others)
    seed_ms = (time.perf_counter() - seed_t0) * 1000.0

    tracemalloc.start()
    timings = {}

    timings["list_notes (page 1, default sort)"], page1 = _time_ms(
        lambda: notes_svc.list_notes(USER_ID, conn=conn))
    timings["count_notes (whole library)"], total = _time_ms(
        lambda: notes_svc.count_notes(USER_ID, conn=conn))
    timings["list_notes (FTS, common term ~30%)"], common_hits = _time_ms(
        lambda: notes_svc.list_notes(USER_ID, q=_COMMON_MARKER, conn=conn))
    timings["count_notes (FTS, common term ~30%)"], common_total = _time_ms(
        lambda: notes_svc.count_notes(USER_ID, q=_COMMON_MARKER, conn=conn))
    timings["list_notes (FTS, rare term, 1 note)"], rare_hits = _time_ms(
        lambda: notes_svc.list_notes(USER_ID, q=_RARE_MARKER, conn=conn))
    timings["folder_note_counts (whole library)"], counts = _time_ms(
        lambda: notes_svc.folder_note_counts(USER_ID, conn=conn))
    timings["notes_for_folders (heavy + 2 others)"], byfolder = _time_ms(
        lambda: notes_svc.notes_for_folders(USER_ID, [heavy["id"], others[0], others[1]], conn=conn))
    timings["get_symbol_backlinks"], backlinks = _time_ms(
        lambda: notes_svc.get_symbol_backlinks(USER_ID, meta["embed_symbol"], conn=conn))
    timings["tag_counts (whole library)"], tags = _time_ms(
        lambda: notes_svc.tag_counts(USER_ID, conn=conn))

    _, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    # ── Correctness, not just speed — a fast wrong answer is not a pass ──
    correctness = {
        "count_notes matches seeded total": total == n,
        "heavy folder count matches seeded share": counts["counts"].get(heavy["id"]) == meta["heavy_share"],
        "notes_for_folders returns the heavy folder honestly (not capped at old 100)":
            len(byfolder.get(heavy["id"], [])) == min(meta["heavy_share"], 200),
        "FTS common-term list/count agree": len(common_hits) <= common_total and common_total == meta["common_count"],
        "FTS rare-term finds exactly the one seeded note": len(rare_hits) == meta["rare_count"],
        "backlinks count matches embed rows for that symbol": backlinks["count"] == (n + 9) // 10,
    }

    conn.close()
    if not keep_db:
        try:
            os.remove(db_path)
            os.rmdir(tmp_dir)
        except OSError:
            pass

    return {
        "n": n,
        "seed_ms": round(seed_ms, 1),
        "timings_ms": {k: round(v, 2) for k, v in timings.items()},
        "peak_tracemalloc_bytes": peak_bytes,
        "correctness": correctness,
        "db_path": db_path if keep_db else None,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiers", default="100,1000,10000,50000")
    ap.add_argument("--out", default=None, help="write a JSON report to this path")
    ap.add_argument("--keep-db", action="store_true", help="don't delete the seeded DB files")
    args = ap.parse_args()

    tiers = [int(x) for x in args.tiers.split(",") if x.strip()]
    results = []
    for n in tiers:
        print(f"\n=== Seeding + measuring {n:,} notes ===")
        r = run_tier(n, keep_db=args.keep_db)
        results.append(r)
        print(f"  seed time: {r['seed_ms']:.1f}ms")
        for label, ms in r["timings_ms"].items():
            print(f"  {label:52s} {ms:8.2f} ms")
        print(f"  peak traced Python memory during queries: {r['peak_tracemalloc_bytes'] / 1e6:.2f} MB")
        failed = [k for k, v in r["correctness"].items() if not v]
        if failed:
            print(f"  XX CORRECTNESS FAILURES: {failed}")
        else:
            print("  OK all correctness checks passed")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        print(f"\nFull report written to {args.out}")

    any_incorrect = any(not v for r in results for v in r["correctness"].values())
    sys.exit(1 if any_incorrect else 0)


if __name__ == "__main__":
    main()

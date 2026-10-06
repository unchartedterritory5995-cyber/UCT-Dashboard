"""Exchange Breadth V1 — SURGICAL repair of the v1 historical artifact's `exch_session` side table.

Usage: python3 repair_exch_session.py SRC DST DET_DIR CODE_COMMIT MANIFEST_OUT

The v1 grind lost exactly four `exch_session` rows to the pump race (fixed in exch_counts). The
breadth rows are intact. This tool NEVER touches SRC: it copies it to a NEW file DST and inserts
only those four rows, in one transaction, after proving each row three independent ways:

  1. DETERMINISTIC REBUILD  the three bounded rebuilds (det_a / det_b / det_cap, pinned code, pinned
                            inputs) stored byte-identical rows for each date;
  2. INDEPENDENT RECOUNT    the same counts recomputed from the captured `us` membership with an
                            own identity resolve + own lookup over the raw ledger rows (no grind code);
  3. ARTIFACT CONSISTENCY   us / NYSE / NASDAQ equal SRC's own pass_session_v2c2 sizes for that date,
                            and the buckets sum to us.

Refuses if: SRC hash differs, SRC has a WAL, DST exists, any row already exists, any proof
disagrees, or the transaction changes anything but four rows.
"""
import collections
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import time

SRC, DST, DET, COMMIT, MANIFEST = sys.argv[1:6]
SRC_SHA = "1ba6b1a873d08a3b6fc1a90f5a58c107d667db15fa5030ebf139cbfd9c92430e"
LEDGER = "/data/_audit/exch_v1/venue_ledger_72eef1c2.json"
LEDGER_CONTENT_SHA = "72eef1c26c47bafa15648fc864ddd1ac8593b4312cc92444ccc7b59c0b23193d"
REF = "/data/_audit/v2cc/inputs_v20260924f/pit_reference.json"
DATES = ("2010-09-16", "2021-03-02", "2022-11-07", "2025-06-27")
KEYS = ("CONFLICT", "NASDAQ", "NYSE", "OTHER", "UNRESOLVED", "absent", "us")


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def die(msg):
    raise SystemExit("REFUSED: " + msg)


if sha(SRC) != SRC_SHA:
    die("source artifact hash")
if os.path.exists(SRC + "-wal") and os.path.getsize(SRC + "-wal"):
    die("source has a non-empty WAL")
if os.path.exists(DST):
    die(f"{DST} exists")

# ── 1. the deterministic rebuilds agree byte-for-byte ────────────────────────────────────
det_rows = {}
for tag in ("a", "b", "cap"):
    c = sqlite3.connect(f"file:{DET}/det_{tag}.db?immutable=1", uri=True)
    for d in DATES:
        r = c.execute("SELECT counts FROM exch_session WHERE date=?", (d,)).fetchone()
        if r is None:
            die(f"det_{tag} has no exch_session row for {d}")
        det_rows.setdefault(d, set()).add(r[0])
    c.close()
for d, v in det_rows.items():
    if len(v) != 1:
        die(f"rebuilds disagree on {d}: {v}")
rows = {d: next(iter(v)) for d, v in det_rows.items()}

# ── 2. independent recount from the captured membership ──────────────────────────────────
ldoc = json.load(open(LEDGER))   # the recount below uses NO ledger/grind code, only raw rows
canon = json.dumps(sorted([list(r) for r in ldoc["rows"]]), separators=(",", ":"), sort_keys=True).encode()
if hashlib.sha256(canon).hexdigest() != LEDGER_CONTENT_SHA:
    die("ledger content hash")
by = collections.defaultdict(list)
for r in ldoc["rows"]:
    by[r[0]].append((r[2], r[3], r[4]))
ref = json.load(open(REF))
cap = json.load(open(f"{DET}/capture_cap.json"))


def resolve(recs, d):
    hits = [r for r in (recs or []) if not ((r.get("delisted_utc") or "")[:10] and d > r["delisted_utc"][:10])
            and not ((r.get("list_date") or "")[:10] and d < r["list_date"][:10])]
    if not hits:
        return None
    hits.sort(key=lambda r: (r.get("list_date") or ""))
    return hits[-1]


recount = {}
for d in DATES:
    k = dict.fromkeys(KEYS, 0)
    us = cap[d]["universes"]["us"]
    k["us"] = len(us)
    for t in us:
        rec = resolve(ref.get(t), d)
        ident = f"{t}|{(rec or {}).get('delisted_utc') or 'active'}"
        if ident not in by:
            k["absent"] += 1
            continue
        hit = [s for f, tt, s in by[ident] if f <= d <= tt]
        if len(hit) > 1:
            die(f"two ledger rows cover {ident} on {d}")
        k[hit[0] if hit else "UNRESOLVED"] += 1
    recount[d] = k
    if json.dumps(k, sort_keys=True) != rows[d]:
        die(f"independent recount disagrees on {d}: {k} vs {rows[d]}")

# ── 3. consistent with the artifact's own sizes ──────────────────────────────────────────
src = sqlite3.connect(f"file:{SRC}?immutable=1", uri=True)
for d in DATES:
    sz = json.loads(src.execute("SELECT universe_sizes FROM pass_session_v2c2 WHERE date=?", (d,)).fetchone()[0])
    k = recount[d]
    if (k["us"], k["NYSE"], k["NASDAQ"]) != (sz["us"], sz["nyse"], sz["nasdaq"]):
        die(f"sizes disagree on {d}: {k} vs {sz}")
    if sum(k[x] for x in KEYS if x != "us") != k["us"]:
        die(f"buckets do not sum on {d}")
    if src.execute("SELECT 1 FROM pass_checkpoint WHERE date=? AND status='done'", (d,)).fetchone() is None:
        die(f"{d} is not a done session")
    if src.execute("SELECT 1 FROM exch_session WHERE date=?", (d,)).fetchone() is not None:
        die(f"{d} already has an exch_session row in SRC")
before = src.execute("SELECT COUNT(*) FROM exch_session").fetchone()[0]
src.close()

# ── copy, then one transaction of exactly four inserts ───────────────────────────────────
shutil.copyfile(SRC, DST)
if sha(DST) != SRC_SHA:
    os.remove(DST)
    die("copy is not byte-identical to SRC")
w = sqlite3.connect(DST, isolation_level=None)
w.execute("BEGIN IMMEDIATE")
try:
    for d in DATES:
        if w.execute("SELECT 1 FROM exch_session WHERE date=?", (d,)).fetchone() is not None:
            raise RuntimeError(f"{d} unexpectedly exists")
    t0 = w.total_changes
    for d in DATES:
        w.execute("INSERT INTO exch_session(date, counts) VALUES(?,?)", (d, rows[d]))
    if w.total_changes - t0 != 4:
        raise RuntimeError(f"changes {w.total_changes - t0} != 4")
    if w.execute("SELECT COUNT(*) FROM exch_session").fetchone()[0] != before + 4:
        raise RuntimeError("row count after insert")
    w.execute("COMMIT")
except BaseException:
    w.execute("ROLLBACK")
    w.close()
    os.remove(DST)
    raise
w.execute("PRAGMA wal_checkpoint(TRUNCATE)")
w.close()
man = {"operation": "insert the 4 exch_session rows lost to the v1 pump race (exch_counts fix)",
       "source_artifact": SRC, "source_sha256": SRC_SHA, "repaired_artifact": DST, "repaired_sha256": sha(DST),
       "repaired_bytes": os.path.getsize(DST), "repair_code_commit": COMMIT,
       "repair_tool_sha256": sha(os.path.abspath(__file__)),
       "repaired_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
       "rows_inserted": [[d, rows[d]] for d in DATES],
       "proofs": {"deterministic_rebuilds_identical": True, "independent_recount_equal": True,
                  "equals_artifact_sizes_and_bucket_sum": True},
       "exch_session_rows_before": before, "exch_session_rows_after": before + 4,
       "ledger_content_sha256": LEDGER_CONTENT_SHA}
json.dump(man, open(MANIFEST, "w"), indent=1, sort_keys=True)
print(json.dumps(man, indent=1, sort_keys=True))

"""
backfill_side_heal.py — one-time offline side backfill from the raw OPRA tape.

Context (2026-07-25): flow.db's Massive-era history (6/23 -> 7/24) was written
before any systematic side-heal existed, so it sits at ~12% sided. Going
forward the nightly cron fixes each day at exact-ns, but the backlog needs a
one-time pass. The raw hourly tape shards only survive for the CURRENT day
(spool rotates within ~a day), so ONLY 7/24 is recoverable from tape — and it
is recoverable OFFLINE and ms-exact, because each shard carries both the trades
(ev="T") and the consolidated NBBO quotes (ev="Q", bp/ap) that produced them.

This does NOT call /v3/quotes. It reconstructs the book from the tape itself:
stream the shards in order, keep a running per-contract NBBO from the Q events,
and classify each T against the book in effect at that instant. Then it matches
each tape trade to flow.db's blank rows on (occ_symbol, price, size) and writes
the side through the same write-once-guarded update the nightly heal uses, so it
is idempotent and can never overwrite a live NBBO side.

For 6/23 -> 7/23 there is no tape, so those days are intentionally left blank
(a blank is an honest "unknown"; a second-precision guess would stamp wrong
sides onto a permanent record). See the timeline in massive-validation notes.

Run once from the flow-worker console:
    python3 -c "from api.backfill_side_heal import run; print(run())"
"""
import os
import gzip
import json
import glob
import logging
from collections import defaultdict

log = logging.getLogger(__name__)

TAPE_DIR = os.environ.get("MASSIVE_TAPE_SPOOL", "/data/tape_spool")
BACKFILL_DATE_MDY = os.environ.get("MASSIVE_BACKFILL_DATE", "7/24/2026")
BACKFILL_DATE_YMD = os.environ.get("MASSIVE_BACKFILL_YMD", "20260724")  # shard filename date
PREM_FLOOR = float(os.environ.get("MASSIVE_BACKFILL_PREMIUM", "0"))     # 0 = heal everything blank


def _occ(symbol, cp, strike, exp_mdy):
    """flow.db row fields -> OCC symbol, e.g. NBIS/170/PUT/8/7/2026 -> O:NBIS260807P00170000."""
    m, d, y = [int(x) for x in str(exp_mdy).split("/")]
    c = "C" if str(cp).upper().startswith("C") else "P"
    k = int(round(float(strike) * 1000))
    return f"O:{str(symbol).upper().strip()}{y % 100:02d}{m:02d}{d:02d}{c}{k:08d}"


def _classify_side(trade_price, bid, ask):
    """Exact port of the deployed worker _classify_side (7/18 midpoint split)."""
    if bid is None or ask is None:
        return ""
    try:
        b, a, p = float(bid), float(ask), float(trade_price)
    except (TypeError, ValueError):
        return ""
    if b <= 0 or a <= 0 or a < b:
        return ""
    tol = 0.005
    if p > a + tol:
        return "AA"
    if p < b - tol:
        return "BB"
    mid = (b + a) / 2.0
    if p > mid:
        return "A"
    if p < mid:
        return "B"
    return ""


def _iter_tape(date_ymd):
    """Yield each record from the day's shards, in file+line order.

    Shards are one JSON array per line (jsonl-of-arrays). Fall back to a lenient
    per-line parse so a single corrupt line can't abort the whole run.
    """
    shards = sorted(glob.glob(os.path.join(TAPE_DIR, f"tape-{date_ymd}-*.jsonl.gz")))
    for path in shards:
        with gzip.open(path, "rt") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    arr = json.loads(line)
                except Exception:
                    continue
                for r in arr:
                    yield r


def _load_targets(db, source, date_mdy):
    """flow.db blank non-ML rows for the day, indexed by (occ, price, size) -> [dedup_key,...]."""
    import sqlite3
    _prem = "CAST(REPLACE(REPLACE(COALESCE(Premium,''),'$',''),',','') AS REAL)"
    con = sqlite3.connect(db.db_path, timeout=30)
    try:
        rows = con.execute(
            f"""SELECT dedup_key, Symbol, CallPut, Strike, ExpirationDate, Price, Volume
                FROM flow
                WHERE source = ? AND CreatedDate = ?
                  AND (Side IS NULL OR Side = '')
                  AND UPPER(COALESCE(Type,'')) NOT LIKE 'ML/%'
                  AND {_prem} >= ?""",
            (source, date_mdy, PREM_FLOOR),
        ).fetchall()
    finally:
        con.close()
    targets = defaultdict(list)
    for dedup_key, sym, cp, strike, exp, price, vol in rows:
        try:
            occ = _occ(sym, cp, strike, exp)
            key = (occ, round(float(price), 2), int(float(vol)))
        except Exception:
            continue
        targets[key].append(dedup_key)
    return targets, len(rows)


def run(source="stocks", date_mdy=None, date_ymd=None):
    """Backfill one (source) for the tape day. Returns a summary dict."""
    from api.flow_db import FlowDB
    db = FlowDB()
    date_mdy = date_mdy or BACKFILL_DATE_MDY
    date_ymd = date_ymd or BACKFILL_DATE_YMD

    if not sorted(glob.glob(os.path.join(TAPE_DIR, f"tape-{date_ymd}-*.jsonl.gz"))):
        log.warning("[backfill] no tape shards for %s in %s", date_ymd, TAPE_DIR)
        return {"error": "no tape", "date": date_mdy}

    targets, n_rows = _load_targets(db, source, date_mdy)
    if not targets:
        return {"date": date_mdy, "source": source, "targets": 0, "healed": 0}

    nbbo = {}                 # sym -> (bid, ask)
    updates = []
    matched_keys = set()      # (occ,price,size) already resolved — heal each once
    counts = {"healed": 0, "mid": 0}
    for r in _iter_tape(date_ymd):
        ev = r.get("ev")
        sym = r.get("sym")
        if ev == "Q":
            nbbo[sym] = (r.get("bp"), r.get("ap"))
            continue
        if ev != "T":
            continue
        try:
            key = (sym, round(float(r.get("p")), 2), int(r.get("s")))
        except (TypeError, ValueError):
            continue
        if key not in targets or key in matched_keys:
            continue
        bid, ask = nbbo.get(sym, (None, None))
        side = _classify_side(r.get("p"), bid, ask)
        matched_keys.add(key)
        if side:
            for dk in targets[key]:
                updates.append((dk, side, ""))   # write-once: only fills a still-blank Side
            counts["healed"] += 1
        else:
            counts["mid"] += 1

    applied = db.update_sides_by_dedup(updates) if updates else 0
    summary = {
        "date": date_mdy, "source": source, "targets": n_rows,
        "matched_contracts": len(matched_keys), "healed_rows": applied,
        "mid_or_offbook": counts["mid"],
    }
    log.info("[backfill] %s %s: targets %d, matched %d, healed %d rows (mid/off-book %d)",
             date_mdy, source, n_rows, len(matched_keys), applied, counts["mid"])
    return summary


def run_all():
    """Backfill both sources for the tape day."""
    return {src: run(source=src) for src in ("stocks", "indexes")}

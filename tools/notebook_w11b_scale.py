"""Wave 11 lane 11B: formula and rollup reads at library scale (1k / 10k / 50k notes).

VERIFICATION ONLY. Seeds each tier with `notebook_scale_benchmark._seed` (the Notebook's own
realistic library: bodies, tags, tasks, embeds, mentions, trash and archive shares) into a
fresh SQLite file under --work-dir, then adds the 11B mix on top:

  * four number properties (Entry, Stop, Exit, Account risk) set on ~20% of the notes (the
    "trade plans"), and three formulas over them (R-multiple, Risk per share, Position size);
  * two parent notes linking to ~50 and ~500 of those trade plans, and two rollups over
    the links (average R, win rate of R);
  * closed trades linked to ~5% of the notes, and one rollup over a note's trades.

Timed, each through the ROUTE function a browser's request reaches (so the number includes
the page's computed values, exactly what GET returns), on a FRESH connection per call
(`auth_db.get_connection`, production's opener -- notebook_scale_benchmark's per-call model):

  * GET /notes sorted by a rollup (Avg R, descending; page of 100 + true total)
  * GET /notes filtered by a formula (R > 1; page of 100 + true total)
  * GET /notes/{parent}/properties (the 500-child parent: every formula and rollup)
  * a property WRITE (one trade plan's Exit), then the sorted read again

Each op: --warmup untimed runs, then --reps timed runs -> p50 / p95 / max. Before every timed
batch the scratchpad MEASURING.flag is created ("11b <time>") and removed after; if it
already exists the run waits. `tools/gate_box_lock.py status` is recorded at the start and
end of each batch. The RAW record (every sample) is written to --out before any summary.

    python tools/notebook_w11b_scale.py --tiers 1000,10000,50000 --reps 20 --warmup 2 \\
        --work-dir <scratch>/w11b-scale --flag <scratch>/MEASURING.flag \\
        --out docs/notebook/evidence/wave11-11b/scale/run-<n>.json

One tier per invocation fits a tool call's time limit; `--combine a.json b.json ... --out
c.json` then merges the per-tier records (untouched) and adds the log-log slope.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import random
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:  # noqa: BLE001
        pass

_REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO / "tools"))
import notebook_scale_benchmark as nb  # noqa: E402  -- imports conftest FIRST (census pins + tripwire)

os.environ["NOTEBOOK_FORMULAS_ENABLED"] = "1"   # this process only: the gate under test

from api.services.journal_two import db as j2db  # noqa: E402
from api.services.journal_two import note_properties as np_  # noqa: E402
from api.services.journal_two import notes as notes_svc  # noqa: E402

U = nb.USER_ID
OPS = ("GET /notes, no computed sort or filter (baseline)", "GET /notes sorted by a rollup",
       "GET /notes filtered by a formula", "GET one note's properties (500-child parent)",
       "property write, then the sorted read")


def _box_status() -> str:
    try:
        r = subprocess.run([sys.executable, str(_REPO / "tools" / "gate_box_lock.py"), "status"],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        return (r.stdout + r.stderr).strip()
    except Exception as e:  # noqa: BLE001
        return f"(status unavailable: {type(e).__name__}: {e})"


def _wait_and_raise_flag(flag: Path) -> None:
    waited = 0.0
    while flag.exists():
        if waited == 0.0:
            print(f"  MEASURING.flag present ({flag.read_text(encoding='utf-8', errors='replace').strip()!r}); waiting")
        time.sleep(5)
        waited += 5
    flag.write_text(f"11b {dt.datetime.now().isoformat(timespec='seconds')}\n", encoding="utf-8")


def _seed_11b(conn: sqlite3.Connection, rng: random.Random) -> dict:
    """The formula/rollup mix, on top of the Notebook's own seed."""
    ids = {n: np_.create_property_def(U, n, "number", conn=conn)["id"]
           for n in ("Entry", "Stop", "Exit", "Account risk")}
    r_id = np_.create_property_def(U, "R-multiple", "formula", conn=conn,
                                   config={"expression": "({Exit} - {Entry}) / ({Entry} - {Stop})"})["id"]
    np_.create_property_def(U, "Risk per share", "formula", conn=conn, config={"expression": "abs({Entry} - {Stop})"})
    np_.create_property_def(U, "Position size", "formula", conn=conn,
                            config={"expression": "round({Account risk} / {Risk per share}, 0)"})
    live = [r[0] for r in conn.execute(
        "SELECT id FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY rowid", (U,))]
    plans = [i for i in live if rng.random() < 0.20]
    updates = []
    for nid in plans:
        entry = round(rng.uniform(10, 500), 2)
        stop = round(entry * rng.uniform(0.9, 0.98), 2)
        exit_ = round(entry * rng.uniform(0.85, 1.3), 2)
        updates.append((json.dumps({ids["Entry"]: entry, ids["Stop"]: stop, ids["Exit"]: exit_,
                                    ids["Account risk"]: 500}), nid))
    conn.executemany("UPDATE j2_notes SET properties_json = ? WHERE id = ?", updates)
    # Two parents linking to ~50 and ~500 trade plans (the noteLink sidecar rows a body
    # link produces; written raw, as notebook_scale_benchmark writes its embeds).
    parents = {}
    now = "2026-10-01T00:00:00+00:00"
    for size in (50, 500):
        pid = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (pid, U, f"Parent {size}", json.dumps({"type": "doc", "content": []}), "", "[]", now, now))
        kids = rng.sample(plans, min(size, len(plans)))
        conn.executemany("INSERT INTO j2_note_links (note_id, user_id, position, target_note_id) VALUES (?,?,?,?)",
                         [(pid, U, k, kid) for k, kid in enumerate(kids)])
        parents[size] = (pid, len(kids))
    avg_id = np_.create_property_def(U, "Avg R", "rollup", conn=conn, config={
        "source": "links_from_this", "aggregate": "avg", "propertyId": r_id})["id"]
    np_.create_property_def(U, "Win rate", "rollup", conn=conn, config={
        "source": "links_from_this", "aggregate": "win_rate", "propertyId": r_id})
    np_.create_property_def(U, "Trade R", "rollup", conn=conn, config={
        "source": "trades", "aggregate": "avg", "tradeField": "r_multiple"})
    # Closed trades linked to ~5% of the live notes.
    linked = [i for i in live if rng.random() < 0.05]
    trades, embeds = [], []
    for k, nid in enumerate(linked):
        tid = uuid.uuid4().hex
        rr = round(rng.uniform(-1.5, 4), 2)
        trades.append((tid, U, uuid.uuid4().hex, "NVDA", "Long", 10, 100, "2026-09-01", 110, "2026-09-02",
                       95, rr * 50, rr / 20, rr, 1, "Win" if rr > 0 else "Loss", "{}", now))
        embeds.append((nid, U, 1000 + k, "chart", "NVDA", tid, "equity_trade"))
    conn.executemany(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
        " exit_price, exit_date, original_stop, pnl_dollar, pnl_percent, r_multiple, hold_days, result,"
        " context_at_entry, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", trades)
    conn.executemany(
        "INSERT OR IGNORE INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol, trade_ref, trade_ref_type)"
        " VALUES (?,?,?,?,?,?,?)", embeds)
    conn.commit()
    return {"r_id": r_id, "avg_id": avg_id, "exit_id": ids["Exit"], "plans": len(plans),
            "parents": {str(k): v[1] for k, v in parents.items()}, "parent_500": parents[500][0],
            "write_note": plans[0], "trades_linked": len(linked), "live_notes": len(live)}


def _samples(fn, warmup: int, reps: int) -> tuple[list[float], object]:
    out = None
    for _ in range(warmup):
        out = fn()
    xs = []
    for _ in range(reps):
        t0 = time.perf_counter()
        out = fn()
        xs.append((time.perf_counter() - t0) * 1000.0)
    return xs, out


def _stats(xs: list[float]) -> dict:
    return {"p50_ms": round(nb.percentile(xs, 50), 3), "p95_ms": round(nb.percentile(xs, 95), 3),
            "max_ms": round(max(xs), 3), "min_ms": round(min(xs), 3), "reps": len(xs)}


def run_tier(n: int, *, reps: int, warmup: int, paragraphs: int, work_dir: str, flag: Path) -> dict:
    tmp = tempfile.mkdtemp(prefix=f"w11b_{n}_", dir=work_dir)
    db_path = os.path.join(tmp, "bench.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    j2db.ensure_schema(conn)
    heavy = notes_svc.create_folder(U, "Catch-All", conn=conn)
    others = [notes_svc.create_folder(U, f"Folder {i}", conn=conn)["id"] for i in range(8)]
    t0 = time.perf_counter()
    nb._seed(conn, n, heavy["id"], others, paragraphs)
    j2db.backfill_note_task_digest(conn)
    fx = _seed_11b(conn, random.Random(11))
    seed_ms = (time.perf_counter() - t0) * 1000.0
    conn.close()

    from api.routers import journal_two as j2r
    user = {"id": U, "role": "member"}
    sort_q = json.dumps({"propertyId": fx["avg_id"], "direction": "desc"})
    filt_q = json.dumps([{"propertyId": fx["r_id"], "op": "gt", "value": 1}])

    def in_db(fn):
        def run():
            with nb._auth_db_is(db_path):
                return fn()
        return run

    def list_call(**kw):
        base = dict(folder_id=None, tag=None, ticker=None, q=None, embed_symbol=None, embed_widget=None,
                    sort="updated", limit=100, offset=0, deleted=False, dateFrom=None, dateTo=None,
                    sector=None, theme=None, savedViewId=None, propertyFilter=None, propertySort=None,
                    meaning=False, user=user)
        base.update(kw)
        return j2r.list_notes_endpoint(**base)

    counter = {"i": 0}

    def write_then_read():
        counter["i"] += 1
        with nb._auth_db_is(db_path):
            notes_svc.update_note(U, fx["write_note"], {"properties": {fx["exit_id"]: 100 + counter["i"]}})
            return list_call(propertySort=sort_q)

    ops = {
        OPS[0]: in_db(lambda: list_call()),
        OPS[1]: in_db(lambda: list_call(propertySort=sort_q)),
        OPS[2]: in_db(lambda: list_call(propertyFilter=filt_q)),
        OPS[3]: in_db(lambda: j2r.note_properties_endpoint(fx["parent_500"], user=user)),
        OPS[4]: write_then_read,
    }
    rec = {"tier": n, "seed_ms": round(seed_ms, 1), "db_bytes": os.path.getsize(db_path), "fixture": fx, "ops": {}}
    with nb._ticker_meta_stubbed():
        for label, fn in ops.items():
            _wait_and_raise_flag(flag)
            box_before = _box_status()
            try:
                xs, result = _samples(fn, warmup, reps)
            finally:
                try:
                    flag.unlink()
                except FileNotFoundError:
                    pass
            box_after = _box_status()
            entry = {**_stats(xs), "samples_ms": [round(x, 3) for x in xs],
                     "box_before": box_before, "box_after": box_after}
            if isinstance(result, dict) and "notes" in result:
                entry["check"] = {"rows": len(result["notes"]), "total": result.get("total"),
                                  "first_computed": next(iter(result["notes"]), {}).get("computed", {}).get(fx["avg_id"])}
            elif isinstance(result, dict) and "properties" in result:
                cell = next((p for p in result["properties"] if p["name"] == "Avg R"), {})
                entry["check"] = {"avg_r": cell.get("value"), "set": (cell.get("computedValue") or {}).get("setSize")}
            rec["ops"][label] = entry
            print(f"  {n:>6}  {label:<46} p50 {entry['p50_ms']:>9.2f}  p95 {entry['p95_ms']:>9.2f}  max {entry['max_ms']:>9.2f}",
                  flush=True)
    return rec


def _slopes(tiers: list[dict]) -> dict:
    """The log-log slope of p50 against library size, first tier to last."""
    slopes = {}
    if len(tiers) >= 2:
        a, b = tiers[0], tiers[-1]
        for label in OPS:
            if label not in a["ops"] or label not in b["ops"]:
                continue
            pa, pb = a["ops"][label]["p50_ms"], b["ops"][label]["p50_ms"]
            slopes[label] = round(math.log(pb / pa) / math.log(b["tier"] / a["tier"]), 3) if pa > 0 and pb > 0 else None
    return slopes


def combine(paths: list[str], out: Path) -> int:
    parts = [json.loads(Path(p).read_text(encoding="utf-8")) for p in paths]
    tiers = sorted((t for part in parts for t in part["tiers"]), key=lambda t: t["tier"])
    report = {"tool": "notebook_w11b_scale", "combined_from": [str(p).replace("\\", "/") for p in paths],
              "git": sorted({part["git"] for part in parts}), "tiers": tiers,
              "loglog_slope_p50": _slopes(tiers)}
    out.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    print("log-log slope (p50):", json.dumps(report["loglog_slope_p50"]))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--combine", nargs="+", default=None)
    ap.add_argument("--tiers", default="1000,10000,50000")
    ap.add_argument("--reps", type=int, default=20)
    ap.add_argument("--warmup", type=int, default=2)
    ap.add_argument("--paragraphs", type=int, default=8)
    ap.add_argument("--work-dir")
    ap.add_argument("--flag")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    if args.combine:
        return combine(args.combine, Path(args.out))
    if not args.work_dir or not args.flag:
        ap.error("--work-dir and --flag are required to measure")
    if "c:\\data" in os.path.abspath(args.work_dir).lower():
        print("REFUSED: work dir under the shared root")
        return 3
    os.makedirs(args.work_dir, exist_ok=True)
    tiers = [int(x) for x in args.tiers.split(",")]
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    report = {"tool": "notebook_w11b_scale", "started_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
              "git": nb._git("rev-parse", "HEAD"), "reps": args.reps, "warmup": args.warmup,
              "connection_model": "per-call (auth_db.get_connection per route call)", "tiers": []}
    for n in tiers:
        report["tiers"].append(run_tier(n, reps=args.reps, warmup=args.warmup, paragraphs=args.paragraphs,
                                        work_dir=args.work_dir, flag=Path(args.flag)))
        out.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")   # R-RAW, per tier
    slopes = _slopes(report["tiers"])
    report["loglog_slope_p50"] = slopes
    report["finished_utc"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    out.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    print("log-log slope (p50):", json.dumps(slopes))
    return 0


if __name__ == "__main__":
    sys.exit(main())

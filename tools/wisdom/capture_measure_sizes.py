"""Measure D12 capture payload sizes from LOCAL MIRRORS, read-only. PC-side, explicit paths.

    python tools/wisdom/capture_measure_sizes.py --mirror-root C:\\data \\
        --wire-json C:\\Users\\Patrick\\morning-wire\\data\\wire_data.json [--out sizes.json]

⛔ The numbers this prints are from STALE local mirrors, never production. They
size docs/wisdom/methodology/capture-v1.md's projection table and nothing else.

Every sqlite open is ``file:...?mode=ro&immutable=1``: immutable means SQLite
never touches the -wal/-shm sidecars either, so a measurement cannot write into a
live directory. No api.* import, so the conftest census pins are not needed.
There is deliberately NO default for --mirror-root: a tool under tools/wisdom/
never defaults to /data (docs/wisdom/CONTRACTS.md §0 row 18).

Each gz figure uses the capture archive's own encoding (sorted keys, compact
separators, gzip mtime=0), so a measured size is the size the archive would write.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import io
import json
import os
import sqlite3
import sys


def _ro(path: str) -> sqlite3.Connection:
    uri = "file:" + path.replace(os.sep, "/") + "?mode=ro&immutable=1"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _sizes(obj) -> tuple[int, int]:
    raw = json.dumps(obj, sort_keys=True, default=str, separators=(",", ":"),
                     ensure_ascii=False).encode("utf-8")
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as fh:
        fh.write(raw)
    return len(raw), len(buf.getvalue())


def _wire(path: str) -> dict:
    wire = json.load(open(path, encoding="utf-8"))
    raw, gz = _sizes(wire)
    cands = wire.get("candidates") or {}
    groups = cands.get("candidates") if isinstance(cands, dict) else None
    groups = groups if isinstance(groups, dict) else {}
    c_raw, c_gz = _sizes(cands)
    return {
        "wire": {"date": wire.get("date"), "top_level_keys": len(wire), "raw": raw, "gz": gz},
        "candidates": {"rows": sum(len(v or []) for v in groups.values()),
                       "buckets": {k: len(v or []) for k, v in groups.items()},
                       "raw": c_raw, "gz": c_gz},
    }


def _screener(path: str) -> dict:
    conn = _ro(path)
    try:
        rows = [dict(r) for r in conn.execute("SELECT * FROM screener_rows")]
    finally:
        conn.close()
    raw, gz = _sizes(rows)
    street_cols = ("ticker", "short_float_pct", "short_ratio", "float_shares", "float_pct",
                   "inst_pct", "insider_own_pct", "analyst_consensus", "pt_target",
                   "pt_upside_pct", "bars_asof", "snapshot_date")
    have = [c for c in street_cols if rows and c in rows[0]]
    s_raw, s_gz = _sizes([{c: r.get(c) for c in have} for r in rows])
    asofs = sorted(r["bars_asof"] for r in rows if r.get("bars_asof"))
    return {
        "screener": {"rows": len(rows), "columns": len(rows[0]) if rows else 0, "raw": raw, "gz": gz,
                     "median_bars_asof": asofs[len(asofs) // 2] if asofs else None,
                     "rows_with_rs_rank": sum(1 for r in rows if r.get("rs_rank") is not None)},
        "street_whole_market": {"rows": len(rows), "columns": have, "raw": s_raw, "gz": s_gz},
    }


def _detections(path: str) -> dict:
    conn = _ro(path)
    try:
        total = conn.execute("SELECT COUNT(*) FROM pattern_detections").fetchone()[0]
        lo, hi = conn.execute("SELECT MIN(detected_at), MAX(detected_at) FROM pattern_detections").fetchone()
        per_day = {
            dt.datetime.fromtimestamp(r[0] * 86400, dt.timezone.utc).date().isoformat(): r[1]
            for r in conn.execute("SELECT detected_at / 86400, COUNT(*) FROM pattern_detections "
                                  "GROUP BY 1 ORDER BY 1")
        }
        sample = [dict(r) for r in conn.execute(
            "SELECT * FROM pattern_detections ORDER BY rowid DESC LIMIT 5000")]
        updated = conn.execute(
            "SELECT COUNT(*) FROM pattern_detections WHERE last_seen_at > detected_at").fetchone()[0]
        try:
            outcomes = conn.execute("SELECT COUNT(*) FROM pattern_outcomes").fetchone()[0]
        except sqlite3.Error as exc:
            outcomes = f"unreadable: {exc}"
    finally:
        conn.close()
    raw, gz = _sizes(sample)
    lags = sorted(r["last_seen_at"] - r["detected_at"] for r in sample)
    return {"detections": {
        "rows": total, "detected_at_min": lo, "detected_at_max": hi,
        "span_hours": round((hi - lo) / 3600, 1) if lo and hi else None,
        "rows_per_utc_day": per_day, "rows_ever_updated": updated, "outcomes": outcomes,
        "sample_rows": len(sample), "raw_bytes_per_row": round(raw / max(1, len(sample)), 1),
        "gz_bytes_per_row": round(gz / max(1, len(sample)), 1),
        "update_lag_s_p50": lags[len(lags) // 2] if lags else None,
        "update_lag_s_p95": lags[int(len(lags) * 0.95)] if lags else None,
        "update_lag_s_max": lags[-1] if lags else None,
    }}


def _catalysts(path: str) -> dict:
    conn = _ro(path)
    try:
        per = {}
        for (d,) in conn.execute("SELECT DISTINCT market_date FROM catalysts ORDER BY market_date"):
            rows = [dict(r) for r in conn.execute("SELECT * FROM catalysts WHERE market_date = ?", (d,))]
            raw, gz = _sizes(rows)
            per[d] = {"rows": len(rows), "ranked": sum(1 for r in rows if r.get("rank") is not None),
                      "raw": raw, "gz": gz}
    finally:
        conn.close()
    return {"catalysts": per}


def _vision(path: str) -> dict:
    conn = _ro(path)
    try:
        rows = [dict(r) for r in conn.execute("SELECT * FROM pattern_verdicts")]
    finally:
        conn.close()
    raw, gz = _sizes(rows)
    dates = sorted({r["asof_date"] for r in rows})
    return {"vision": {"rows": len(rows), "raw": raw, "gz": gz, "distinct_asof": len(dates),
                       "asof_first": dates[0] if dates else None, "asof_last": dates[-1] if dates else None}}


def _tweets(path: str) -> dict:
    conn = _ro(path)
    try:
        rows = [dict(r) for r in conn.execute("SELECT * FROM tweets")]
        accounts = [dict(r) for r in conn.execute("SELECT handle, is_official FROM twitter_accounts")]
    finally:
        conn.close()
    raw, gz = _sizes(rows)
    per = {}
    for r in rows:
        per[r["author_handle"]] = per.get(r["author_handle"], 0) + 1
    return {"tweets": {"rows": len(rows), "raw": raw, "gz": gz, "per_handle": per,
                       "accounts": accounts, "gz_bytes_per_tweet": round(gz / max(1, len(rows)), 1)}}


def _catalyst_metadata(path: str) -> dict:
    conn = _ro(path)
    try:
        rows = [dict(r) for r in conn.execute("SELECT * FROM ticker_metadata")]
    finally:
        conn.close()
    raw, gz = _sizes(rows)
    return {"catalyst_metadata": {"rows": len(rows), "with_float": sum(1 for r in rows if r.get("float_shares")),
                                  "raw": raw, "gz": gz}}


def _breadth_intraday(path: str) -> dict:
    conn = _ro(path)
    try:
        return {"breadth_intraday": {"rows": conn.execute("SELECT COUNT(*) FROM breadth_intraday").fetchone()[0]}}
    finally:
        conn.close()


def _themes(path: str) -> dict:
    conn = _ro(path)
    try:
        sectors = [dict(r) for r in conn.execute("SELECT * FROM theme_sectors")]
        themes = [dict(r) for r in conn.execute("SELECT * FROM themes")]
        members = [dict(r) for r in conn.execute("SELECT * FROM theme_memberships")]
        try:
            engine = conn.execute("SELECT COUNT(*) FROM engine_memberships").fetchone()[0]
        except sqlite3.Error as exc:
            engine = f"unreadable: {exc}"
    finally:
        conn.close()
    raw, gz = _sizes({"sectors": sectors, "themes": themes, "memberships": members})
    return {"themes": {"themes": len(themes), "owner_memberships": len(members),
                       "engine_memberships": engine, "raw": raw, "gz": gz}}


MIRRORS = (
    ("screener.db", _screener),
    ("patterns.db", _detections),
    ("catalysts.db", _catalysts),
    ("pattern_vision.db", _vision),
    ("tweets.db", _tweets),
    ("catalyst_metadata.db", _catalyst_metadata),
    ("breadth_intraday.db", _breadth_intraday),
    ("auth.db", _themes),
)


def measure(mirror_root: str, wire_json: str | None) -> dict:
    out: dict = {"measured_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                 "mirror_root": mirror_root, "label": "STALE LOCAL MIRRORS, NOT PRODUCTION", "absent": []}
    if wire_json:
        if os.path.exists(wire_json):
            out.update(_wire(wire_json))
        else:
            out["absent"].append(wire_json)
    for name, fn in MIRRORS:
        path = os.path.join(mirror_root, name)
        if not os.path.exists(path):
            out["absent"].append(path)
            continue
        try:
            out.update(fn(path))
        except sqlite3.Error as exc:
            out.setdefault("unreadable", {})[name] = str(exc)
    finviz = os.path.join(mirror_root, "screener_finviz.json")
    if os.path.exists(finviz):
        out["finviz"] = {"bytes": os.path.getsize(finviz)}
    else:
        out["absent"].append(finviz)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--mirror-root", required=True, help="directory holding the local sqlite mirrors")
    ap.add_argument("--wire-json", default=None, help="a wire_data.json copy to size")
    ap.add_argument("--out", default=None, help="write the JSON result here as well as stdout")
    args = ap.parse_args(argv)
    result = measure(args.mirror_root, args.wire_json)
    text = json.dumps(result, indent=1, default=str)
    print(text)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

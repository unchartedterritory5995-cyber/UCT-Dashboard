"""Measure universe minute frames against a real day of minute aggregates.

    python tools/minute_frames_measure.py <minute_aggs.csv.gz> [--cap api/data/cap_universe.json]

Reads a Massive flat-file day (`ticker,volume,open,close,high,low,window_start,transactions`,
window_start in ns), builds the frame every minute of the 04:00-20:00 ET session would have
carried (every symbol's bar for that minute) with `api.services.minute_frames`, exactly as the
publisher encodes it, and prints, for the cap universe and the full market, with and without
`av`: records per minute, the gzip frame size (median, p90, max, RTH median), the day's total,
the encode time, and the rolling "today so far" file (built with the publisher's TodayWriter) at
10:00, 12:00, 16:00 and 20:00 ET. Every frame is decoded back and compared value for value.

Memory: the day is held as flat arrays (~150 MB for a full-market day of ~1.9 M bars), so this
is ordinary work, not a heavy-lock job. The input is licensed vendor data: it is READ here,
never written anywhere and never committed.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import statistics
import sys
import time
from array import array

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import minute_frames as mf  # noqa: E402


def load_day(path: str):
    """(symbols, minute[], sym[], o[], h[], l[], c[], v[]) as flat arrays, file order."""
    syms: list = []
    index: dict = {}
    cols = {k: array("d") for k in "ohlcv"}
    minute = array("l")
    sym = array("l")
    with gzip.open(path, "rt") as f:
        f.readline()
        for line in f:
            t, v, o, c, h, lo, ws, _n = line.rstrip("\n").split(",")
            i = index.get(t)
            if i is None:
                i = index[t] = len(syms)
                syms.append(t)
            sym.append(i)
            minute.append(int(ws) // 60_000_000_000)
            cols["o"].append(float(o)); cols["h"].append(float(h)); cols["l"].append(float(lo))
            cols["c"].append(float(c)); cols["v"].append(float(v))
    return syms, minute, sym, cols


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))]


def measure(day, universe, label: str, with_av: bool) -> dict:
    syms, minute, sym, cols = day
    order = sorted(range(len(minute)), key=minute.__getitem__)       # stable: file order within a minute
    cum = [0.0] * len(syms)
    keep = None if universe is None else [s in universe for s in syms]
    gz_sizes, rth_gz, rth_recs, n_recs, enc_ms = [], [], [], [], []
    writer = None
    today_at: dict = {}
    marks = {"1000": 360, "1200": 480, "1600": 720, "2000": 960}    # seq at which each mark is taken
    prev = mf.NO_SEQ
    i = 0
    n = len(order)
    while i < n:
        m = minute[order[i]]
        rows = {}
        while i < n and minute[order[i]] == m:
            k = order[i]
            s = sym[k]
            cum[s] += cols["v"][k]
            if keep is None or keep[s]:
                row = (cols["o"][k], cols["h"][k], cols["l"][k], cols["c"][k], cols["v"][k])
                rows[syms[s]] = row + (round(cum[s], 6),) if with_av else row
            i += 1
        d, seq = mf.seq_of_minute(m)
        if seq < 0:
            continue
        if writer is None:
            writer = mf.TodayWriter(day=d, epoch=1)
        t0 = time.perf_counter()
        raw = mf.encode_frame(day=d, seq=seq, prev_seq=prev, epoch=1, minute=m,
                              blocks=[(m, mf.KIND_ONTIME, rows)], with_av=with_av)
        gz = mf.gzip_bytes(raw)
        enc_ms.append((time.perf_counter() - t0) * 1000)
        back = mf.decode_frame(gz)["blocks"][0]["rows"]
        if back != rows:
            raise SystemExit(f"round trip mismatch at minute {m}")
        writer.add(raw, seq)
        for name, at in marks.items():
            if seq == at - 1:
                t0 = time.perf_counter()
                snap = writer.snapshot()
                today_at[name] = {"gzip_mb": round(len(snap) / 1e6, 2),
                                  "snapshot_ms": round((time.perf_counter() - t0) * 1000)}
        gz_sizes.append(len(gz))
        n_recs.append(len(rows))
        if 330 <= seq < 720:
            rth_gz.append(len(gz))
            rth_recs.append(len(rows))
        prev = seq
    return {
        "universe": label, "with_av": with_av, "frames": len(gz_sizes),
        "records_per_minute": {"median": statistics.median(n_recs), "rth_median": statistics.median(rth_recs),
                               "max": max(n_recs)},
        "frame_gzip_kb": {"median": round(statistics.median(gz_sizes) / 1e3, 1),
                          "p90": round(pct(gz_sizes, 0.9) / 1e3, 1),
                          "max": round(max(gz_sizes) / 1e3, 1),
                          "rth_median": round(statistics.median(rth_gz) / 1e3, 1)},
        "bytes_per_record_gzip_rth": round(sum(rth_gz) / max(1, sum(rth_recs)), 2),
        "day_total_gzip_mb": round(sum(gz_sizes) / 1e6, 2),
        "rth_total_gzip_mb": round(sum(rth_gz) / 1e6, 2),
        "encode_gzip_ms": {"median": round(statistics.median(enc_ms), 1), "max": round(max(enc_ms), 1)},
        "today_file": today_at,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("day_file")
    ap.add_argument("--cap", default=os.path.join("api", "data", "cap_universe.json"))
    a = ap.parse_args(argv)
    t0 = time.time()
    day = load_day(a.day_file)
    with open(a.cap, encoding="utf-8") as f:
        cap = set(json.load(f))
    print(f"loaded {len(day[1]):,} minute bars, {len(day[0]):,} symbols in {time.time() - t0:.0f}s",
          file=sys.stderr)
    out = []
    for label, uni in (("cap", cap), ("all", None)):
        for with_av in (False, True):
            out.append(measure(day, uni, label, with_av))
            print(json.dumps(out[-1]), file=sys.stderr, flush=True)
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

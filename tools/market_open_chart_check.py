#!/usr/bin/env python3
"""Market-open chart verification harness.

HTTP-only (no browser), so it runs headless in a scheduled cloud agent. Verifies
the live-market claims of the charts-dominance work that could NOT be checked on
a closed-market weekend:

  1. health            — /api/health is up
  2. latency matrix    — Server-Timing server-compute + total + cache layer across
                         a ticker x TF grid (warm/cold/delta), so any regression
                         from orjson / mmap / since / A2 is visible with real numbers
  3. weekly dedup      — no duplicate/non-Friday weekly candles (the 2026-07-02 bug)
  4. bar sanity        — no null/non-positive OHLC, no future-dated bars, sane volume
  5. live-bar liveness — during RTH, an intraday developing bar actually advances
                         between polls (catches the "frozen chart" regression class)
  6. accuracy monitor  — reconciliation-status: any real Daily drift (detect-only),
                         heal activity, cycle progress
  7. deep tail         — the measured deep-intraday fetch latency (bars=20000)

Prints a markdown report + a JSON blob (marker: <<<JSON>>>). Exit 0 = all pass,
1 = one or more FAIL. Designed to be run by a Claude cloud agent that reads the
report, interprets it vs the weekend baseline, and flags regressions.

Usage: python tools/market_open_chart_check.py [--base https://uctintelligence.com]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
import urllib.request
import zoneinfo

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"  # Cloudflare 1010 blocks bare UAs
_ET = zoneinfo.ZoneInfo("America/New_York")


def _decode(headers: dict, body: bytes) -> bytes:
    enc = (headers.get("Content-Encoding") or headers.get("content-encoding") or "").lower()
    if "gzip" in enc:
        import gzip as _gz
        try:
            return _gz.decompress(body)
        except Exception:  # noqa: BLE001
            return body
    return body


def _get(base: str, path: str, timeout: float = 45.0):
    """GET path. Returns (status, elapsed_s, headers_dict, decoded_body_bytes)."""
    # Request gzip only (stdlib has no brotli); decompress below so the JSON-body
    # checks actually parse instead of trivially passing on empty bodies.
    req = urllib.request.Request(base + path, headers={
        "User-Agent": _UA, "Accept-Encoding": "gzip", "Accept": "application/json",
    })
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            hdr = dict(r.headers)
            return r.status, time.perf_counter() - t0, hdr, _decode(hdr, r.read())
    except urllib.error.HTTPError as e:
        hdr = dict(e.headers or {})
        return e.code, time.perf_counter() - t0, hdr, _decode(hdr, e.read() if hasattr(e, "read") else b"")
    except Exception as e:  # noqa: BLE001
        return None, time.perf_counter() - t0, {"_error": str(e)[:200]}, b""


def _json(body: bytes):
    try:
        return json.loads(body)
    except Exception:  # noqa: BLE001
        return None


def _market_is_open(now_et: dt.datetime) -> bool:
    if now_et.weekday() >= 5:
        return False
    hm = now_et.hour * 100 + now_et.minute
    return 930 <= hm <= 1600  # RTH; good enough for a liveness gate (holidays handled by empty ticks)


def _server_timing(headers: dict) -> tuple[str, float | None]:
    """Parse `Server-Timing: bars;desc="layer";dur=NN.N` -> (layer, ms)."""
    st = headers.get("Server-Timing") or headers.get("server-timing") or ""
    layer, ms = "?", None
    for part in st.split(";"):
        part = part.strip()
        if part.startswith('desc='):
            layer = part[5:].strip('"')
        elif part.startswith("dur="):
            try:
                ms = float(part[4:])
            except ValueError:
                pass
    return layer, ms


class Report:
    def __init__(self):
        self.checks: list[dict] = []
        self.metrics: dict = {}

    def add(self, name: str, ok: bool, detail: str, warn: bool = False):
        self.checks.append({"name": name, "status": ("WARN" if warn and ok else ("PASS" if ok else "FAIL")), "detail": detail})

    @property
    def failed(self):
        return [c for c in self.checks if c["status"] == "FAIL"]

    def render(self) -> str:
        lines = ["# Market-open chart check", ""]
        for c in self.checks:
            lines.append(f"[{c['status']:4}] {c['name']} - {c['detail']}")
        lines += ["", f"**{len(self.failed)} FAIL / {len(self.checks)} checks**"]
        return "\n".join(lines)


def run(base: str) -> Report:
    rep = Report()
    now_et = dt.datetime.now(_ET)
    rth = _market_is_open(now_et)
    rep.metrics["now_et"] = now_et.isoformat()
    rep.metrics["market_open"] = rth

    # 1. health
    st, el, _, body = _get(base, "/api/health")
    h = _json(body) or {}
    rep.add("health", st == 200, f"HTTP {st} in {el*1000:.0f}ms, wire_date={h.get('wire_date')}, uptime={h.get('uptime_seconds')}s")

    # 2. latency matrix (Server-Timing)
    grid = [("AAPL", "D"), ("AAPL", "1"), ("AAPL", "5"), ("AAPL", "60"),
            ("NVDA", "D"), ("SPY", "1"), ("PLTR", "5"), ("AAON", "D")]
    matrix = []
    slow = []
    for tk, tf in grid:
        st, el, hdr, b = _get(base, f"/api/bars/{tk}?tf={tf}&bars=300")
        layer, ms = _server_timing(hdr)
        size = len(b)
        matrix.append({"ticker": tk, "tf": tf, "http": st, "total_ms": round(el * 1000, 1),
                       "server_ms": ms, "layer": layer, "bytes": size})
        # A warm/stale/sqlite/mem serve should be single-digit ms of server-compute.
        if ms is not None and layer in ("mem", "sqlite", "stale-swr", "delta") and ms > 150:
            slow.append(f"{tk}/{tf} {layer} {ms:.0f}ms")
    rep.metrics["latency_matrix"] = matrix
    warm = [m for m in matrix if m["layer"] in ("mem", "sqlite", "stale-swr")]
    warm_ms = [m["server_ms"] for m in warm if m["server_ms"] is not None]
    p_warm = round(max(warm_ms), 1) if warm_ms else None
    all_200 = all(m["http"] == 200 for m in matrix)
    rep.add("latency: all 200", all_200, f"{sum(m['http']==200 for m in matrix)}/{len(matrix)} returned 200")
    rep.add("latency: warm server-compute", not slow, (f"warm max {p_warm}ms; layers seen: " + ",".join(sorted({m['layer'] for m in matrix}))) + (f"; SLOW: {slow}" if slow else ""), warn=bool(slow))

    # 3. weekly dedup
    for tk in ("MSTR", "AAPL"):
        st, _, _, b = _get(base, f"/api/bars/{tk}?tf=W&bars=200")
        d = _json(b) or {}
        bars = d.get("bars", [])
        weeks = {}
        nonfri = 0
        for bar in bars:
            try:
                day = dt.date.fromisoformat(bar["t"])
            except Exception:  # noqa: BLE001
                continue
            weeks[day.isocalendar()[:2]] = weeks.get(day.isocalendar()[:2], 0) + 1
            if day.weekday() != 4:
                nonfri += 1
        dups = sum(1 for v in weeks.values() if v > 1)
        rep.add(f"weekly dedup {tk}", dups == 0 and nonfri == 0,
                f"{len(bars)} bars, {dups} dup-weeks, {nonfri} non-Friday keys")

    # 4. bar sanity (spot check a couple responses)
    for tk, tf in (("AAPL", "D"), ("NVDA", "5")):
        st, _, _, b = _get(base, f"/api/bars/{tk}?tf={tf}&bars=300")
        d = _json(b) or {}
        bars = d.get("bars", [])
        bad = 0
        future = 0
        now_s = time.time()
        for bar in bars:
            o, hi, lo, c = bar.get("o"), bar.get("h"), bar.get("l"), bar.get("c")
            if None in (o, hi, lo, c) or min(o, hi, lo, c) <= 0 or hi < lo:
                bad += 1
            t = bar.get("t")
            if isinstance(t, (int, float)) and t > now_s + 120:  # intraday future bar
                future += 1
        rep.add(f"bar sanity {tk}/{tf}", bad == 0 and future == 0,
                f"{len(bars)} bars, {bad} bad-OHLC, {future} future-dated")

    # 5. live-bar liveness (RTH only)
    if rth:
        tk, tf = "AAPL", "1"
        st, _, _, b1 = _get(base, f"/api/bars/{tk}?tf={tf}&bars=600")
        d1 = _json(b1) or {}
        last1 = (d1.get("bars") or [{}])[-1]
        time.sleep(35)
        st, _, _, b2 = _get(base, f"/api/bars/{tk}?tf={tf}&bars=600")
        d2 = _json(b2) or {}
        last2 = (d2.get("bars") or [{}])[-1]
        advanced = (last2.get("t") != last1.get("t")) or (last2.get("c") != last1.get("c")) or (last2.get("v") != last1.get("v"))
        rep.add("live-bar liveness (RTH)", bool(advanced),
                f"{tk}/{tf} last bar {'ADVANCED' if advanced else 'FROZEN'} over 35s "
                f"(t {last1.get('t')}->{last2.get('t')}, c {last1.get('c')}->{last2.get('c')})")
    else:
        rep.add("live-bar liveness", True, "market closed -- skipped (run again during RTH)", warn=True)

    # 6. accuracy monitor (reconciliation-status)
    st, _, _, b = _get(base, "/api/admin/reconciliation-status")
    rc = _json(b) or {}
    rep.metrics["reconciliation"] = rc
    detect = rc.get("detect_only_drift_count", 0)
    last_detect = rc.get("last_detect_drift", [])
    rep.add("accuracy: Daily drift monitor", detect == 0,
            f"detect_only_drift_count={detect}, cycles={rc.get('cycles_completed')}, "
            f"healed_total={rc.get('rows_healed_total')}"
            + (f"; LAST DETECT: {last_detect[-3:]}" if last_detect else ""),
            warn=(detect > 0))

    # 7. deep tail (measured; expected slow on a cold ticker)
    st, el, hdr, b = _get(base, "/api/bars/AAPL?tf=1&bars=20000", timeout=60.0)
    layer, ms = _server_timing(hdr)
    size = len(b)
    rep.metrics["deep_tail"] = {"http": st, "total_ms": round(el * 1000, 1), "server_ms": ms, "layer": layer, "bytes": size}
    rep.add("deep intraday (20k) reachable", st == 200,
            f"HTTP {st}, layer={layer}, server={ms}ms, total={el*1000:.0f}ms, {size} bytes "
            f"(deep first-fetch is expected to be slow; cached after)", warn=(ms is not None and ms > 8000))

    return rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://uctintelligence.com")
    args = ap.parse_args()
    rep = run(args.base.rstrip("/"))
    print(rep.render())
    print("\n<<<JSON>>>")
    print(json.dumps({"checks": rep.checks, "metrics": rep.metrics}, default=str))
    sys.exit(1 if rep.failed else 0)


if __name__ == "__main__":
    main()

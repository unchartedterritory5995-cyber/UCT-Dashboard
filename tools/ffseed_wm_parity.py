"""Does the DEVICE's W / M (from a full-depth D copy) equal the SERVER's W / M, field for field? Read-only, production.

Zero-network PR 3.3 serves W and M from the device's full-depth D copy (app/src/data/deviceStore/resample.js
`deriveServed`, over utils/resampleBars). This checks that derivation against what every chart receives from the
server (`/api/bars/{sym}?tf=W` and `tf=M`: the stored W / M rows and the live derive, `wm_drv`), for N symbols:

  1. the D copy a device holds: the sealed history (`/api/bars-history/{sym}?tf=D`, edge-cached) older than the tail's
     first bar, then the tail (`/api/bars/{sym}?tf=D&bars=600`), by the client's seam rule (utils/historyPrepend
     `prependOlder`): exactly what the full-depth pack builds (api/services/ffseed.py `daily_full_window`);
  2. W and M from it by the SHIPPED JavaScript (`node tools/ffseed_wm_parity_derive.mjs`, which imports
     resample.js unchanged), at this moment's clock;
  3. every server W / M bar compared with the device bar of the same label: t, o, h, l, c, v, exactly.

    python tools/ffseed_wm_parity.py                       # 200 symbols (a fixed liquid set + a seeded sample)
    python tools/ffseed_wm_parity.py --n 50 --json out.json
    python tools/ffseed_wm_parity.py --symbols AAPL,MSFT

Signs in as the synthetic MEMBER account (`bench`, tools/synthetic_session.py: the one sign-in, signed out however
the run ends). Four GETs a symbol (one of them edge-cached), paced (`--rps`, default 4). Exit 0 when every compared
bar is equal, 1 when any differs, 2 when the run could not compare.
"""
from __future__ import annotations

import argparse
import functools
import json
import random
import subprocess
import sys
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import (HTTP only here)

BASE = "https://uctintelligence.com"
ET = ZoneInfo("America/New_York")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0 Safari/537.36"
LIQUID = ("AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,AVGO,BRK-B,JPM,V,LLY,SPY,QQQ,IWM,DIA,XLF,XLE,XLK,SMH,TLT,GLD,"
          "HYG,ARKK,SOFI,PLTR,HOOD,COIN,MARA,RIVN,SMCI,F,NIO,AMD,MU,INTC").split(",")
FIELDS = ("o", "h", "l", "c", "v")
SEAM = 0.02                                   # utils/barsMerge._closeMismatch


def unix_of(iso: str) -> int:
    return int(datetime(int(iso[:4]), int(iso[5:7]), int(iso[8:10]), tzinfo=timezone.utc).timestamp())


def iso_of(t: int) -> str:
    return datetime.fromtimestamp(int(t), timezone.utc).date().isoformat()


def last_sealed_day(now: datetime) -> str:
    """The NYSE trading day before today ET (the `d` every browser sends: routers/bars.calendar_last_sealed_day)."""
    from api.services import session_calendar as sc
    d = now.astimezone(ET).date() - timedelta(days=1)
    for _ in range(14):
        if sc.is_trading_day(d):
            return d.isoformat()
        d -= timedelta(days=1)
    return ""


def join_daily(hist: list, tail: list) -> list:
    """utils/historyPrepend.prependOlder: the history older than the tail's first bar, then the tail; refused (the
    history alone, the client's full-depth fallback) on a > 2% close mismatch at the tail's first bar."""
    if not tail:
        return hist
    first = tail[0]["t"]
    seam = next((b for b in hist if b["t"] == first), None)
    if seam and float(seam["c"]) and abs(float(tail[0]["c"]) - float(seam["c"])) / abs(float(seam["c"])) > SEAM:
        return hist
    return [b for b in hist if b["t"] < first] + tail


def pick_symbols(n: int, seed: int) -> list:
    with open(REPO / "api" / "data" / "cap_universe.json", encoding="utf-8") as f:
        uni = sorted({str(t).upper() for t in json.load(f) if t})
    out = [s for s in LIQUID if s in uni][:n]
    rest = [s for s in uni if s not in out]
    random.Random(seed).shuffle(rest)
    return out + rest[: max(0, n - len(out))]


def compare(server: list, dev: dict) -> dict:
    """Every server bar against the device bar of the same label."""
    if "why" in dev:
        return {"compared": 0, "equal": 0, "refused": dev["why"], "diffs": []}
    by_t = {int(t): i for i, t in enumerate(dev["t"])}
    diffs, n, eq = [], 0, 0
    for k, b in enumerate(server):
        t = unix_of(b["t"])
        i = by_t.get(t)
        n += 1
        if i is None:
            diffs.append({"t": b["t"], "where": "missing-on-device", "pos": k})
            continue
        bad = [f for f in FIELDS if float(dev[f][i]) != float(b[f])]
        if bad:
            where = "newest" if k == len(server) - 1 else ("oldest" if i == 0 else "interior")
            diffs.append({"t": b["t"], "where": where, "fields": bad,
                          "server": {f: b[f] for f in FIELDS}, "device": {f: dev[f][i] for f in FIELDS}})
        else:
            eq += 1
    return {"compared": n, "equal": eq, "diffs": diffs}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--symbols", default=None)
    ap.add_argument("--seed", type=int, default=20261128)
    ap.add_argument("--rps", type=float, default=4.0, help="requests a second at most")
    ap.add_argument("--json", default=None)
    a = ap.parse_args(argv)
    import requests
    try:
        from tools import synthetic_session as S  # noqa: PLC0415
    except ImportError:
        import synthetic_session as S  # noqa: PLC0415
    syms = [x.strip().upper() for x in a.symbols.split(",")] if a.symbols else pick_symbols(a.n, a.seed)
    s = requests.Session()
    s.headers["User-Agent"] = UA
    s.post = functools.partial(s.post, timeout=30)
    session = S.sign_in_client(s, BASE, "bench", timeout=30)
    try:
        session.response.raise_for_status()
        return _run(a, s, syms)
    finally:
        session.close()


def _run(a, s, syms) -> int:
    gap = 1.0 / max(0.1, a.rps)
    last = [0.0]

    def get(url):
        wait = last[0] + gap - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        last[0] = time.monotonic()
        r = s.get(url, timeout=60)
        return r.json() if r.status_code == 200 else {"_status": r.status_code}

    now = datetime.now(timezone.utc)
    d = last_sealed_day(now)
    daily, server = {}, {}
    for sym in syms:
        hist = get(f"{BASE}/api/bars-history/{sym}?tf=D&bars=60000&d={d}")
        tail = get(f"{BASE}/api/bars/{sym}?tf=D&bars=600")
        if not hist.get("sealed") or not isinstance(tail.get("bars"), list) or not tail["bars"]:
            server[sym] = {"error": [hist.get("_status"), tail.get("_status")]}
            continue
        D = join_daily(hist.get("bars") or [], tail["bars"])
        daily[sym] = {k: [unix_of(b["t"]) if k == "t" else b[k] for b in D] for k in ("t",) + FIELDS}
        server[sym] = {"W": (get(f"{BASE}/api/bars/{sym}?tf=W&bars=2000").get("bars") or []),
                       "M": (get(f"{BASE}/api/bars/{sym}?tf=M&bars=1200").get("bars") or [])}
    with tempfile.TemporaryDirectory() as tmp:
        inp, outp = Path(tmp) / "in.json", Path(tmp) / "out.json"
        inp.write_text(json.dumps({"nowMs": int(now.timestamp() * 1000), "symbols": daily}), encoding="ascii")
        subprocess.run(["node", str(REPO / "tools" / "ffseed_wm_parity_derive.mjs"), str(inp), str(outp)],
                       check=True, cwd=str(REPO))
        dev = json.loads(outp.read_text(encoding="ascii"))
    rows, totals = {}, {tf: {"symbols": 0, "symbols_equal": 0, "bars": 0, "equal": 0, "where": {}} for tf in ("W", "M")}
    for sym in syms:
        if "error" in server.get(sym, {}) or sym not in dev:
            rows[sym] = server.get(sym) or {"error": "no data"}
            continue
        rows[sym] = {}
        for tf in ("W", "M"):
            r = compare(server[sym][tf], dev[sym][tf])
            rows[sym][tf] = r
            t = totals[tf]
            t["symbols"] += 1
            t["bars"] += r["compared"]
            t["equal"] += r["equal"]
            t["symbols_equal"] += int(r["compared"] > 0 and r["equal"] == r["compared"])
            for x in r["diffs"]:
                t["where"][x["where"]] = t["where"].get(x["where"], 0) + 1
    errors = sum(1 for v in rows.values() if "error" in v)
    print(f"{now.astimezone(ET):%Y-%m-%d %H:%M} ET  symbols {len(syms)} (errors {errors})")
    for tf, t in totals.items():
        print(f"  {tf}: {t['symbols_equal']}/{t['symbols']} symbols equal on every bar; bars {t['equal']}/{t['bars']}"
              f"; differing by position {t['where'] or 'none'}")
    shown = 0
    for sym, v in rows.items():
        for tf in ("W", "M"):
            r = v.get(tf) if isinstance(v, dict) else None
            if r and r["diffs"] and shown < 30:
                shown += 1
                print(f"  {sym} {tf}: {len(r['diffs'])} differ, first {json.dumps(r['diffs'][0])}")
    if a.json:
        Path(a.json).write_text(json.dumps({"at": now.isoformat(), "totals": totals, "rows": rows}, indent=1),
                                encoding="utf-8")
    if not any(t["bars"] for t in totals.values()):
        return 2
    return 0 if all(t["equal"] == t["bars"] for t in totals.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())

"""W5 T5 -- CROSS-ENGINE REPORT (docs/pine/SERVER-RUNTIME-DESIGN.md H7, H8, HP-8). REPORT ONLY: nothing here gates.

Two modes.

  collect: run tools/pine_cross_engine_probe.js verbatim in one Playwright browser (headless, Playwright's own
           build; never a branded Chrome, never a profile) and write the raw answers to <dir>/probe-<engine>.json.
           The Node answers come from ``node tools/pine_cross_engine_probe.mjs --out <dir>/probe-node.json``.
      python tools/pine_cross_engine_report.py collect --engine chromium --dir <dir>

  summarize: compare every probe-*.json in <dir> with probe-node.json (and each engine with the others) and write the
           small committed summaries math-summary.json and tz-summary.json.
      python tools/pine_cross_engine_report.py summarize --dir <dir> --out <evidence dir>
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROBE = REPO / "tools" / "pine_cross_engine_probe.js"
CLOCK = REPO / "app" / "src" / "components" / "chart" / "engine" / "runtime" / "clockFns.js"


def clock_source() -> str:
    import re
    return re.sub(r"^export ", "", CLOCK.read_text(encoding="utf-8"), flags=re.M)


def collect(engine: str, d: Path) -> int:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = getattr(p, engine).launch()
        try:
            page = browser.new_page()
            ua = page.evaluate("navigator.userAgent")
            result = page.evaluate("([src, clock]) => (0, eval)(src)(clock)", [PROBE.read_text(encoding="utf-8"), clock_source()])
            result["host"] = {"engine": engine, "browser": browser.version, "userAgent": ua}
            page.close()
        finally:
            browser.close()
    (d / f"probe-{engine}.json").write_text(json.dumps(result), encoding="utf-8")
    print(f"{engine} {result['host']['browser']}: probe written")
    return 0


def f64(text: str):
    data = base64.b64decode(text)
    return struct.unpack(f"<{len(data) // 8}d", data)


def u16(text: str):
    data = base64.b64decode(text)
    return struct.unpack(f"<{len(data) // 2}H", data)


def key(x: float) -> int:
    """Order-preserving integer for a double (negative zero == zero)."""
    i = struct.unpack("<q", struct.pack("<d", x))[0]
    return -(1 << 63) - i if i < 0 else i


def ulps(a: float, b: float):
    if a != a or b != b:
        return 0 if (a != a and b != b) else None
    return abs(key(a) - key(b))


def canon_sha(xs) -> str:
    h = hashlib.sha256()
    for x in xs:
        h.update(b"NaN" if x != x else struct.pack("<d", x))
    return h.hexdigest()[:16]


def math_summary(ref: dict, other: dict, sets) -> dict:
    bounds, lo = [], 0
    for name, n in sets:
        bounds.append((name, lo, lo + n))
        lo += n
    inputs = f64(ref["math"]["inputs"])
    out = {}
    for fn, text in ref["math"]["fns"].items():
        a, b = f64(text), f64(other["math"]["fns"][fn])
        nd, nan_mismatch, mx, tot, first = 0, 0, 0, 0, None
        per = {}
        for i, (x, y) in enumerate(zip(a, b)):
            g = ulps(x, y)
            if g == 0 and (x == y or x != x):
                continue
            if g == 0:
                continue
            nd += 1
            if g is None:
                nan_mismatch += 1
            else:
                mx = max(mx, g)
                tot += g
            for nm, s, e in bounds:
                if s <= i < e:
                    per[nm] = per.get(nm, 0) + 1
            if first is None:
                first = {"index": i, "x": repr(inputs[2 * i]), "y": repr(inputs[2 * i + 1]), "ref": repr(x), "other": repr(y), "ulps": g}
        out[fn] = {"n": len(a), "differ": nd, "max_ulp": mx, "nan_vs_number": nan_mismatch, "by_set": per, "first": first}
    return out


def tz_summary(ref: dict, other: dict) -> dict:
    ra, oa = ref["tz"], other["tz"]
    res = {"transitions": len(oa["transitions"]), "transitions_equal_to_node": ra["transitions"] == oa["transitions"]}
    s1, s2 = u16(ra["sweep"]), u16(oa["sweep"])
    bad = [i for i, (x, y) in enumerate(zip(s1, s2)) if x != y]
    res["sweep_values"] = len(s1)
    res["sweep_differ"] = len(bad)
    res["sweep_sha"] = hashlib.sha256(base64.b64decode(oa["sweep"])).hexdigest()[:16]
    res["sweep_first_differ"] = [{"utc_hour_index": i // 14, "field": i % 7, "ref": s1[i], "other": s2[i]} for i in bad[:5]]
    e1, e2 = f64(ra["edgeMs"]), f64(oa["edgeMs"])
    res["edges"] = len(e1)
    res["edge_ms_differ"] = sum(1 for x, y in zip(e1, e2) if x != y)
    f1, f2 = base64.b64decode(ra["edgeFields"]), base64.b64decode(oa["edgeFields"])
    res["edge_fields_differ"] = sum(1 for x, y in zip(f1, f2) if x != y)
    res["edge_sha"] = hashlib.sha256(base64.b64decode(oa["edgeMs"]) + f2).hexdigest()[:16]
    return res


def us_rule_transitions():
    """Independent truth: the US DST rule as arithmetic (UTC ms, kind). 1990-2006 first Sun Apr / last Sun Oct, 2007+ second
    Sun Mar / first Sun Nov; the change is at 02:00 local standard (07:00 UTC) and 02:00 local daylight (06:00 UTC)."""
    import datetime as dt
    out = []
    def nth_sunday(y, m, n):
        d = dt.date(y, m, 1)
        d += dt.timedelta(days=(6 - d.weekday()) % 7)
        return d + dt.timedelta(weeks=n - 1)
    def last_sunday(y, m):
        d = dt.date(y + (m == 12), (m % 12) + 1, 1) - dt.timedelta(days=1)
        return d - dt.timedelta(days=(d.weekday() + 1) % 7)
    for y in range(1990, 2031):
        if y < 2007:
            s, e = nth_sunday(y, 4, 1), last_sunday(y, 10)
        else:
            s, e = nth_sunday(y, 3, 2), nth_sunday(y, 11, 1)
        for d, h, a, b in ((s, 7, -300, -240), (e, 6, -240, -300)):
            ms = int(dt.datetime(d.year, d.month, d.day, h, tzinfo=dt.timezone.utc).timestamp() * 1000)
            out.append([ms, a, b])
    return out


def summarize(d: Path, out: Path) -> int:
    probes = {}
    for f in sorted(d.glob("probe-*.json")):
        probes[f.stem[len("probe-"):]] = json.loads(f.read_text(encoding="utf-8"))
    ref = probes["node"]
    sets = ref["math"]["sets"]
    rule = us_rule_transitions()
    hosts, math, tz = {}, {}, {}
    for name, pr in probes.items():
        hosts[name] = pr["host"]
        hosts[name]["math_fingerprint"] = {fn: canon_sha(f64(t)) for fn, t in pr["math"]["fns"].items()}
        hosts[name]["math_anchors"] = pr["math"]["anchors"]
        hosts[name]["meta"] = pr["tz"]["meta"]
        hosts[name]["math_inputs_equal_node"] = pr["math"]["inputs"] == ref["math"]["inputs"]
        hosts[name]["math_inputs_sha"] = hashlib.sha256(base64.b64decode(pr["math"]["inputs"])).hexdigest()[:16]
        tr = pr["tz"]["transitions"]
        hosts[name]["dst_rule_check"] = {"expected": len(rule), "found": len(tr), "equal": [list(map(int, t)) for t in tr] == rule,
                                         "missing": [t for t in rule if t not in [list(map(int, x)) for x in tr]][:5],
                                         "extra": [x for x in tr if list(map(int, x)) not in rule][:5]}
        if name != "node":
            math[f"{name}_vs_node"] = math_summary(ref, pr, sets)
            tz[f"{name}_vs_node"] = tz_summary(ref, pr)
    names = [n for n in probes if n != "node"]
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            math[f"{b}_vs_{a}"] = math_summary(probes[a], probes[b], sets)
    out.mkdir(parents=True, exist_ok=True)
    (out / "hosts.json").write_text(json.dumps(hosts, indent=1), encoding="utf-8")
    (out / "math-summary.json").write_text(json.dumps(math, indent=1), encoding="utf-8")
    (out / "tz-summary.json").write_text(json.dumps(tz, indent=1), encoding="utf-8")
    print("hosts:", ", ".join(f"{n}={h.get('browser') or h.get('v8')}" for n, h in hosts.items()))
    for pair, fns in math.items():
        diff = {fn: (v["differ"], v["max_ulp"]) for fn, v in fns.items() if v["differ"]}
        print(f"math {pair}: {diff or 'bit-identical on all functions'}")
    for pair, v in tz.items():
        print(f"tz {pair}: sweep_differ={v['sweep_differ']} edge_ms_differ={v['edge_ms_differ']} edge_fields_differ={v['edge_fields_differ']} transitions_equal={v['transitions_equal_to_node']}")
    for n, h in hosts.items():
        print(f"dst rule {n}: {h['dst_rule_check']['found']}/{h['dst_rule_check']['expected']} equal={h['dst_rule_check']['equal']}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="mode", required=True)
    c = sub.add_parser("collect")
    c.add_argument("--engine", required=True, choices=["chromium", "webkit", "firefox"])
    c.add_argument("--dir", required=True)
    s = sub.add_parser("summarize")
    s.add_argument("--dir", required=True)
    s.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    return collect(a.engine, Path(a.dir)) if a.mode == "collect" else summarize(Path(a.dir), Path(a.out))


if __name__ == "__main__":
    sys.exit(main())

"""W5 T4 -- THE HOST-PARITY RAIL, CHROMIUM HALF (docs/pine/SERVER-RUNTIME-DESIGN.md 2.3, HP-2/HP-3/HP-5).

Drives the REAL in-app runtime worker chunk (a production build's ``assets/runtimeWorker-*.js``)
in Playwright's own headless Chromium -- the `tools/runtime_pane_worker_probe.py` machinery: the
chunk is served from a fake origin through ``page.route`` and started as a module Worker, and each
corpus case is posted to it exactly as ``runtimeAsync.messageOf`` posts it (``{id, def, rows, ctx}``).

Nothing about a case is decided here, so nothing here is a second authority:

1. ``node tools/pine_runtime_host_parity.mjs --emit-jobs`` writes the cases, the generated bars and
   the column encoder's own source (``encodeColumnsB64``), which this page runs in Chromium;
2. the raw worker answers are digested by ``--digest-raw``, through the SAME ``recordOf`` the Node
   half uses;
3. every ``ok`` digest is recomputed from the same bytes by the PYTHON codec
   (``api/services/pine_runtime_codec.py``), so the JS and Python halves of T3 agree on real runs;
4. HP-3: the Chromium records are compared with the committed ``expected-digests.json`` AND with a
   fresh Node-half run over the server bundle (``--host node --out``).

Exit: 0 equal, 1 a case differs (named), 2 inconclusive (the worker never loaded, or a wall-clock
stop such as ``runtime:time-budget``, which is never a verdict).

    python tools/pine_runtime_host_parity.py --dist app/dist --out <dir>

Playwright's bundled Chromium only (``p.chromium.launch()``): never a branded Chrome, never a
profile, never a sign-in. One browser, one page, one worker; all closed before exit.
"""
from __future__ import annotations

import argparse
import base64
import json
import struct
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
import conftest  # noqa: E402,F401 -- the shared-data-root census + tripwire (tests/test_tools_pin_the_root.py); inert on a Railway service
from api.services import pine_runtime_codec as codec  # noqa: E402

MJS = REPO / "tools" / "pine_runtime_host_parity.mjs"
EXPECTED = REPO / "app" / "src" / "components" / "chart" / "engine" / "runtime" / "__fixtures__" / "hostParity" / "expected-digests.json"
ORIGIN = "http://hp-parity.invalid"

PAGE = """<!doctype html><meta charset="utf-8"><title>host parity</title><script>
window.__bars = {};
window.__start = (url) => new Promise((resolve) => {
  const w = new Worker(url, {type: 'module'});
  window.__w = w;
  w.onerror = (e) => resolve('worker error: ' + (e.message || 'load failed'));
  // a no-op job proves the chunk installed its handler before any case is scored
  w.onmessage = () => resolve('ready');
  w.postMessage({id: 0, def: null, rows: [], ctx: {}});
});
window.__run = (c) => new Promise((resolve) => {
  window.__w.onmessage = (ev) => {
    const d = ev.data;
    if (d.ok) {
      resolve({ok: true, encoded: window.__encode(d.columns), warmup: d.warmup || null});
    } else {
      resolve({ok: false, error: {name: d.error.name, guard: d.error.guard, bar: d.error.bar}});
    }
  };
  window.__w.postMessage({id: 1, def: c.def, rows: window.__bars[c.set], ctx: c.ctx});
});
</script>"""


def node(*args: str) -> str:
    p = subprocess.run(["node", str(MJS), *args], cwd=str(REPO), capture_output=True, text=True, encoding="utf-8")
    if p.returncode not in (0,):
        raise SystemExit(f"node {' '.join(args)} failed rc={p.returncode}\n{p.stdout}\n{p.stderr}")
    return p.stdout


def compare(a: Path, b: Path) -> tuple[int, str]:
    p = subprocess.run(["node", str(MJS), "--compare", str(a), str(b)], cwd=str(REPO), capture_output=True,
                       text=True, encoding="utf-8")
    return p.returncode, p.stdout.strip()


def ulp_gap(a: float, b: float) -> int | None:
    """Distance in representable doubles; None when exactly one side is NaN; 0 for two NaNs."""
    if a != a or b != b:
        return 0 if (a != a and b != b) else None
    if a in (float("inf"), float("-inf")) or b in (float("inf"), float("-inf")):
        return None  # the JS rule (ulpStats): an infinity on either side is "inf/nan", not a distance
    ia = struct.unpack("<q", struct.pack("<d", a))[0]
    ib = struct.unpack("<q", struct.pack("<d", b))[0]
    if ia < 0:
        ia = -(1 << 63) - ia
    if ib < 0:
        ib = -(1 << 63) - ib
    return abs(ia - ib)


def column_diff(node_raw: dict, other_raw: dict, names) -> dict:
    """W5-T5 (HP-8): for each named case where both hosts answered ok, every column that differs:
    rows differing, the largest ulp gap, and the first example."""
    def cols(r):
        return {k: struct.unpack(f"<{len(base64.b64decode(t)) // 8}d", base64.b64decode(t)) for k, t in r["encoded"]["columns"].items()}
    out = {}
    for n in names:
        a, b = node_raw["results"].get(n), other_raw.get(n)
        if not a or not b or not a["ok"] or not b["ok"]:
            continue
        ca, cb = cols(a), cols(b)
        per = {}
        for k in sorted(set(ca) | set(cb)):
            xa, xb = ca.get(k), cb.get(k)
            if xa is None or xb is None or len(xa) != len(xb):
                per[k] = {"shape": "differs"}
                continue
            bad = [(i, ulp_gap(x, y)) for i, (x, y) in enumerate(zip(xa, xb)) if struct.pack("<d", x) != struct.pack("<d", y) and not (x != x and y != y)]
            if bad:
                gaps = [g for _, g in bad if g is not None]
                i0 = bad[0][0]
                per[k] = {"rows_differ": len(bad), "rows": len(xa), "max_ulp": max(gaps) if gaps else None,
                          "nan_vs_number": sum(1 for _, g in bad if g is None),
                          "first": {"row": i0, "node": repr(xa[i0]), "other": repr(xb[i0])}}
        out[n] = per
    return out


def worker_chunk(dist: Path) -> Path:
    found = sorted((dist / "assets").glob("runtimeWorker-*.js"))
    if len(found) != 1:
        raise SystemExit(f"expected exactly one assets/runtimeWorker-*.js under {dist}, found {len(found)}")
    return found[0]


def python_digest(identity: dict, rec_raw: dict) -> str:
    """The Python codec's digest of an ok answer, from the same Float64 LE bytes."""
    cols = {}
    for k, text in rec_raw["encoded"]["columns"].items():
        data = base64.b64decode(text)
        cols[k] = list(struct.unpack(f"<{len(data) // 8}d", data))
    return codec.column_digest(identity, cols, [])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", required=True, help="a production build's output dir (holds assets/runtimeWorker-*.js)")
    ap.add_argument("--out", required=True, help="a directory for jobs, raw answers and records")
    ap.add_argument("--only", default="", help="comma-separated cases or scripts")
    ap.add_argument("--browser", default="chromium", choices=["chromium", "webkit", "firefox"],
                    help="W5-T5 / HP-8: webkit and firefox are REPORT-ONLY (design H8); the verdict is printed, not gated")
    args = ap.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    dist = Path(args.dist)
    chunk = worker_chunk(dist)
    only = ["--only", args.only] if args.only else []

    jobs_file = out / "jobs.json"
    print(node("--emit-jobs", str(jobs_file), *only).strip())
    jobs = json.loads(jobs_file.read_text(encoding="utf-8"))
    node_file = out / "node.json"
    node_raw_file = out / "node-raw.json"
    print("node half:", node("--host", "node", "--quiet", "--out", str(node_file), "--raw-out", str(node_raw_file), *only).strip() or "ok")
    identity = json.loads(node_file.read_text(encoding="utf-8"))["identity"]

    from playwright.sync_api import sync_playwright

    def serve(route):
        rel = route.request.url[len(ORIGIN) + 1:].split("?")[0]
        if rel == "":
            return route.fulfill(status=200, content_type="text/html", body=PAGE)
        f = (dist / rel).resolve()
        if dist.resolve() not in f.parents or not f.is_file():
            return route.fulfill(status=404, body="")
        return route.fulfill(status=200, content_type="text/javascript", body=f.read_bytes())

    results = {}
    t_all = time.time()
    with sync_playwright() as p:
        browser = getattr(p, args.browser).launch()
        browser_version = browser.version
        try:
            page = browser.new_page()
            page.route(f"{ORIGIN}/**", serve)
            page.goto(f"{ORIGIN}/")
            page.evaluate(f"window.__encode = {jobs['encoderJs']}")
            for name, rows in jobs["bars"].items():
                page.evaluate("([n, r]) => { window.__bars[n] = r }", [name, rows])
            state = page.evaluate(f"__start('{ORIGIN}/{chunk.relative_to(dist).as_posix()}')")
            print(f"worker {chunk.name}: {state}")
            if state != "ready":
                print("INCONCLUSIVE: the worker chunk did not load")
                return 2
            for c in jobs["cases"]:
                t0 = time.time()
                results[c["case"]] = page.evaluate("(c) => __run(c)", c)
                r = results[c["case"]]
                print(f"{c['case']:40} {'ok' if r['ok'] else r['error']['guard']} {1000 * (time.time() - t0):7.0f} ms")
            page.close()
        finally:
            browser.close()
    print(f"chromium: {len(results)} cases in {time.time() - t_all:.1f} s")

    raw_file = out / "chromium-raw.json"
    print(f"{args.browser} {browser_version}")
    raw_file.write_text(json.dumps({"host": args.browser, "browser": browser_version, "worker": chunk.name, "identity": identity,
                                    "results": results}), encoding="utf-8")
    chromium_file = out / "chromium.json"
    print(node("--digest-raw", str(raw_file), "--out", str(chromium_file)).strip())

    # the Python codec on the same bytes (T3's two halves agree on real runs)
    recs = json.loads(chromium_file.read_text(encoding="utf-8"))["records"]
    py_bad = [n for n, r in results.items() if r["ok"] and recs[n]["status"] == "ok"
              and python_digest(identity, r) != recs[n]["digest"]]
    n_ok = sum(1 for r in recs.values() if r["status"] == "ok")
    print(f"python codec: {n_ok - len(py_bad)}/{n_ok} ok digests equal the JS codec's" + (f"; RED {py_bad[:5]}" if py_bad else ""))

    code_n, text_n = compare(node_file, chromium_file)
    print(f"node vs {args.browser}:", text_n.splitlines()[-1] if text_n else "")
    if code_n or "REPORTED" in text_n:
        print(text_n)
    if args.only:
        code_e, text_e = 0, "expected: skipped (--only)"
    else:
        code_e, text_e = compare(EXPECTED, chromium_file)
        print(f"committed vs {args.browser}:", text_e.splitlines()[-1] if text_e else "")
        if code_e or "REPORTED" in text_e:
            print(text_e)
    differing = sorted({line.split()[1].rstrip(":") for line in text_n.splitlines() if line.startswith(("RED ", "INCONCLUSIVE ", "REPORTED "))})
    coldiff = column_diff(json.loads(node_raw_file.read_text(encoding="utf-8")), results, differing)
    (out / "column-diff.json").write_text(json.dumps(coldiff, indent=1), encoding="utf-8")
    print(f"column diff: {len(differing)} differing case(s), {sum(len(v) for v in coldiff.values())} differing column(s)")
    codes = [code_n, code_e, 1 if py_bad else 0]
    verdict = 1 if 1 in codes else 2 if 2 in codes else 0
    (out / "verdict.json").write_text(json.dumps({"browser": browser_version, "node_vs_chromium": text_n.splitlines()[-1] if text_n else "",
                                                  "committed_vs_chromium": text_e.splitlines()[-1] if text_e else "",
                                                  "reported": [l for l in (text_n + chr(10) + text_e).splitlines() if l.startswith("REPORTED")],
                                                  "python_codec_red": py_bad, "exit": verdict}, indent=1), encoding="utf-8")
    print({0: "HP-2/HP-3 GREEN", 1: "HP-2/HP-3 RED", 2: "HP-2/HP-3 INCONCLUSIVE"}[verdict])
    if args.browser != "chromium":
        print("HP-8 is REPORT-ONLY: exit 0 whatever the verdict (design H8)")
        return 0
    return verdict


if __name__ == "__main__":
    sys.exit(main())

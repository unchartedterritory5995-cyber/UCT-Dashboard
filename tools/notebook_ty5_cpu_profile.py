"""Lane TY5 -- a JS CPU profile of the typing pass at 1 and 2,000 paragraphs, on the SAME
build, to find which functions' self time grows with document size.

Local-only diagnostic (like notebook_perf_harness.py itself): never run in CI, Playwright is
a local install. Reuses the harness's own Sandbox launcher, provisioning, seeding and
note-open helpers rather than re-implementing them -- the only new piece here is the CDP
`Profiler.start`/`Profiler.stop` session around the typed keystrokes and the self-time
analysis of the resulting .cpuprofile.

METHOD (matches the TY5 brief): boot a sandbox over the CURRENT build (whatever `app/dist`
already holds -- build it first, unminified, for ATTRIBUTION readability; see the README),
open a small note then the target note (a real switch, like the harness's own typing pass),
start the CDP profiler, type the SAME characters the harness types (60, delay=25ms), stop the
profiler, and keep the raw .cpuprofile plus a self-time-by-function summary. Do this at every
size in --sizes. The diff step (ranking functions by their self-ms/key delta between sizes) is
a separate, pure step over the two summaries -- see `summarize_profiles()` below, exercised by
--self-check with no browser.

R-RAW: raw profiles are big (one GC/compile sample per ~100us can run to tens of thousands of
nodes), so what is COMMITTED is the summary (self-ms total + ms/key by function, top 60) in
docs/notebook/perf-runs/ty5/ -- the full .cpuprofile stays in the scratch dir this script was
pointed at, named in the summary's own "raw_profile" field so it can be regenerated.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as H  # noqa: E402

# Puts the caret at the end of the note, same as the harness's own
# INSTALL_TYPING_PROBE_JS -- WITHOUT installing that probe's own keydown/MessageChannel
# listeners, so the profiled session carries no instrumentation of its own, only the editor's
# real work. Missing this step was the first version's bug: `pg.keyboard.type()` landed on an
# unfocused document, so almost nothing dispatched and the profile was ~99% idle at both sizes.
FOCUS_EDITOR_END_JS = """
() => {
  const pm = document.querySelector('.ProseMirror')
  if (!pm) return false
  pm.focus()
  const sel = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(pm)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
  return true
}
"""


def _key(call_frame: dict) -> tuple:
    """Identity for aggregating self time ACROSS node ids: the same source function can get a
    fresh node id per distinct call site/recursion, and a size-scaling cost is about the
    FUNCTION, not any one node id."""
    return (call_frame.get("functionName") or "(anonymous)", call_frame.get("url") or "",
            call_frame.get("lineNumber", -1), call_frame.get("columnNumber", -1))


def self_time_by_function(profile: dict) -> dict[tuple, float]:
    """Self time per (name,url,line,col), in microseconds. Standard simplification (used by
    most open cpuprofile readers, e.g. speedscope): pair samples[i] with timeDeltas[i] -- off
    by one sample at the boundary, immaterial for ranking a function's total self time across
    thousands of samples."""
    nodes = {n["id"]: n for n in profile["nodes"]}
    samples = profile.get("samples") or []
    deltas = profile.get("timeDeltas") or []
    out: dict[tuple, float] = {}
    for i, node_id in enumerate(samples):
        dt = deltas[i] if i < len(deltas) else 0
        if dt <= 0:
            continue
        node = nodes.get(node_id)
        if node is None:
            continue
        k = _key(node["callFrame"])
        out[k] = out.get(k, 0.0) + dt
    return out


# V8's CPU profiler reports time with nothing JS on the stack under these two synthetic
# frames. A session includes the idle gaps BETWEEN keystrokes (Playwright's `delay=` between
# key presses) and the idle wait after typing stops, so these two dwarf every real function's
# self time by two orders of magnitude -- ranking "ms/key" against the whole session (idle
# included) buries the signal under noise that is identical in shape at every size. They are
# reported, never ranked: BUSY self time (every OTHER frame, "(garbage collector)" included,
# since a GC pause is real work the typing pass paid for) is what "ms/key" is computed over.
IDLE_FRAMES = frozenset({"(idle)", "(program)"})


def summarize_profile(profile: dict, keys: int, top: int = 60) -> dict:
    by_fn = self_time_by_function(profile)
    idle_us = sum(us for k, us in by_fn.items() if k[0] in IDLE_FRAMES)
    busy_us = sum(us for k, us in by_fn.items() if k[0] not in IDLE_FRAMES)
    rows = [{"functionName": k[0], "url": k[1], "line": k[2], "column": k[3],
             "self_ms": round(us / 1000.0, 4),
             "self_ms_per_key": round((us / 1000.0) / keys, 5) if keys else None}
            for k, us in by_fn.items() if k[0] not in IDLE_FRAMES]
    rows.sort(key=lambda r: -r["self_ms"])
    return {"keys": keys, "total_self_ms": round((busy_us + idle_us) / 1000.0, 3),
            "idle_self_ms": round(idle_us / 1000.0, 3),
            "busy_self_ms": round(busy_us / 1000.0, 3),
            "busy_self_ms_per_key": round((busy_us / 1000.0) / keys, 4) if keys else None,
            "sample_count": len(profile.get("samples") or []),
            "rows": rows[:top]}


def diff_profiles(small: dict, big: dict, top: int = 40) -> list[dict]:
    """Rank functions by (self ms/key at the BIG size) - (self ms/key at the SMALL size). A
    function present only at the big size has an implicit 0 at the small size (a real, not a
    missing, data point -- it never ran at all on a 1-paragraph note)."""
    small_by: dict[tuple, float] = {(r["functionName"], r["url"], r["line"], r["column"]): r["self_ms_per_key"]
                                     for r in small["rows"]}
    rows = []
    for r in big["rows"]:
        k = (r["functionName"], r["url"], r["line"], r["column"])
        at_small = small_by.get(k, 0.0) or 0.0
        at_big = r["self_ms_per_key"] or 0.0
        rows.append({"functionName": r["functionName"], "url": r["url"], "line": r["line"],
                     "ms_per_key_small": round(at_small, 5), "ms_per_key_big": round(at_big, 5),
                     "delta_ms_per_key": round(at_big - at_small, 5)})
    rows.sort(key=lambda r: -r["delta_ms_per_key"])
    return rows[:top]


def run(base: str, sizes: list[int], chars: int, out_dir: Path, raw_dir: Path) -> dict:
    from playwright.sync_api import sync_playwright
    run_id = time.strftime("r%H%M%S")
    notes_summary: dict[int, dict] = {}
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
        H._provision(admin_ctx.request, ctx.request, base)
        notes = H._seed(ctx.request, base, sizes, run_id)
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        small_id, small_marker = notes[3]
        pg.goto(f"{base}/journal/notebook?note={small_id}")
        H._dismiss_intro(pg)
        pg.wait_for_selector(".ProseMirror", timeout=30000)
        cdp = ctx.new_cdp_session(pg)
        cdp.send("Profiler.enable")
        cdp.send("Profiler.setSamplingInterval", {"interval": 30})
        for n in sizes:
            nid, marker = notes[n]
            pg.evaluate(H.OPEN_NOTE_JS, {"id": small_id, "marker": small_marker, "timeoutMs": 15000})
            pg.evaluate(H.OPEN_NOTE_JS, {"id": nid, "marker": marker, "timeoutMs": 15000})
            focused = pg.evaluate(FOCUS_EDITOR_END_JS)
            if not focused:
                errors.append(f"could not focus the editor at {n} paragraphs")
                continue
            cdp.send("Profiler.start")
            pg.keyboard.type("q" * chars, delay=25)
            pg.wait_for_timeout(300)
            result = cdp.send("Profiler.stop")
            profile = result["profile"]
            raw_path = raw_dir / f"profile-{n}p-{run_id}.cpuprofile.json"
            raw_path.write_text(json.dumps(profile), encoding="utf-8")
            summary = summarize_profile(profile, chars)
            summary["paragraphs"] = n
            summary["raw_profile"] = str(raw_path)
            notes_summary[n] = summary
            print(f"profiled {n:,} paragraphs: {summary['sample_count']} samples, "
                  f"{summary['busy_self_ms_per_key']} ms BUSY self/key "
                  f"(of {summary['total_self_ms']} ms total, {summary['idle_self_ms']} ms idle) "
                  "-- profiled pass, not a budget reading")
        cdp.detach()
        br.close()
    out_dir.mkdir(parents=True, exist_ok=True)
    for n, summary in notes_summary.items():
        (out_dir / f"ty5-profile-{n}p.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    sizes_sorted = sorted(sizes)
    if len(sizes_sorted) >= 2:
        diff = diff_profiles(notes_summary[sizes_sorted[0]], notes_summary[sizes_sorted[-1]])
        (out_dir / "ty5-profile-diff.json").write_text(json.dumps({
            "small": sizes_sorted[0], "big": sizes_sorted[-1], "chars": chars, "rows": diff,
        }, indent=1), encoding="utf-8")
        print(f"\ntop size-scaling functions ({sizes_sorted[0]} -> {sizes_sorted[-1]} paragraphs):")
        for r in diff[:20]:
            print(f"  {r['delta_ms_per_key']:+.5f} ms/key  {r['functionName']}  {r['url']}:{r['line']}")
    return notes_summary


def self_check() -> int:
    """No browser: the pure analysis functions against a tiny synthetic profile."""
    prof = {"nodes": [
        {"id": 1, "callFrame": {"functionName": "(root)", "url": "", "lineNumber": 0, "columnNumber": 0}},
        {"id": 2, "callFrame": {"functionName": "toJSON", "url": "memoDocJSON.js", "lineNumber": 60, "columnNumber": 1}},
        {"id": 3, "callFrame": {"functionName": "stringify", "url": "[native]", "lineNumber": -1, "columnNumber": -1}},
    ], "samples": [1, 2, 2, 3, 3, 3], "timeDeltas": [0, 100, 100, 100, 100, 100]}
    by_fn = self_time_by_function(prof)
    assert by_fn[("toJSON", "memoDocJSON.js", 60, 1)] == 200
    assert by_fn[("stringify", "[native]", -1, -1)] == 300
    small = summarize_profile({"nodes": prof["nodes"], "samples": [1], "timeDeltas": [0]}, keys=60)
    big = summarize_profile(prof, keys=60)
    diff = diff_profiles(small, big)
    top = diff[0]
    assert top["functionName"] == "stringify" and top["delta_ms_per_key"] > 0, diff
    print("SELF-CHECK OK: self_time_by_function aggregates by (name,url,line,col); "
          "diff_profiles ranks a function absent at the small size as a real 0, not a gap")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=None, help="an already-running sandbox")
    ap.add_argument("--boot", action="store_true")
    ap.add_argument("--data-dir", default=None)
    ap.add_argument("--port", type=int, default=8331)
    ap.add_argument("--sizes", default="1,2000")
    ap.add_argument("--chars", type=int, default=60)
    ap.add_argument("--out", default=str(REPO / "docs/notebook/perf-runs/ty5"))
    ap.add_argument("--raw-dir", default=None)
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    sizes = [int(x) for x in args.sizes.split(",") if x.strip()]
    out_dir = Path(args.out)
    raw_dir = Path(args.raw_dir) if args.raw_dir else Path(args.data_dir or ".").parent / "ty5-profile-raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    if bool(args.boot) == bool(args.base):
        print("pass exactly one of --boot (with --data-dir) or --base")
        return 3
    if args.boot:
        why = H.refuse_shared_root(args.data_dir or "")
        if why:
            print(f"REFUSED: {why}")
            return 3
        if H.port_busy(args.port):
            print(f"REFUSED: port {args.port} already has a listener")
            return 3
        log_path = raw_dir / "sandbox.log"
        box = H.Sandbox(args.data_dir, args.port, log_path)
        base = f"http://127.0.0.1:{args.port}"
        box.start()
        try:
            if not box.wait_healthy(base, 240):
                print("REFUSED: the sandbox never answered /api/health")
                return 3
            run(base, sizes, args.chars, out_dir, raw_dir)
        finally:
            box.stop()
    else:
        run(args.base, sizes, args.chars, out_dir, raw_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

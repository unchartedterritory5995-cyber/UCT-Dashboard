"""Lane TY8 -- per-key tail attribution.

TY4/TY5/TY7 established that `typing_busy_per_char`'s AGGREGATE p50/p95 narrows (but does not
close) the gap to the 16 ms line at 2,000 paragraphs, and that the gap between p50 and p95 is
wide: on a quiet box (`docs/notebook/perf-runs/ty-l15-quiet/README.md`), 2,000 paragraphs reads
p50 11.6 / p95 17.1 ms. That is a TAIL problem -- most keys are cheap and a minority are slow --
and TY5/TY7's own aggregated self-time profiles (a CPU profile over a whole typing burst, or a
trace's self-time summed over the whole pass) cannot see which keys those are, only the total.

This tool runs the harness's own TRACE-ONLY pass (`tools/notebook_perf_harness.py --busy`,
unchanged, reused) at 1,000 and 2,000 paragraphs and, for EVERY keydown-to-keydown window
(the exact window `keystroke_busy_ms` already defines), records:

  * the window's busy total (independently re-derived here from the per-label self-time
    breakdown below, as a cross-check against `H.keystroke_busy_ms`'s own top-level-span sum --
    the two are the same partition of main-thread time computed two different ways);
  * the SELF TIME of every named phase inside that window -- GC, event dispatch, layout, paint,
    script, timers, and anything else the trace's own categories record -- using the identical
    nested stack algorithm `summarize_trace` uses, just clipped to one window instead of the
    whole pass (clipping is safe here because the trace's complete (`X`) events are well-formed
    and strictly nested, so a clipped parent's clipped children stay inside it).

Then it buckets the windows by their OWN busy time (the slowest ~10% vs a band around the
median) and reports, per label, how often it appears and how much it costs in each bucket --
so "what appears on the slow keys that does not appear on the fast ones" is a comparison over
real per-key numbers, not a guess.

R-RAW: the full Chrome trace per size is large and stays in the scratch dir named in the
summary's own "raw_trace" field (same convention as TY5's .cpuprofile). What is COMMITTED is
the per-window breakdown and the slow-vs-median comparison -- the raw, uninterpreted numbers --
BEFORE any interpretation is written.

Local-only diagnostic, like notebook_perf_harness.py and notebook_ty5_cpu_profile.py: never run
in CI, Playwright is a local install. Reuses the harness's Sandbox launcher, provisioning,
seeding, note-open helpers and trace primitives rather than re-implementing them.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as H  # noqa: E402
# TY5's own fix for the identical first-version bug this tool would otherwise repeat:
# `pg.keyboard.type()` on an unfocused document dispatches almost nothing. Reused, not
# re-typed -- it places the caret at the note's end without installing any listeners of its
# own, so a TRACE-ONLY pass stays instrumentation-free.
from notebook_ty5_cpu_profile import FOCUS_EDITOR_END_JS  # noqa: E402


def _label(e: dict) -> str:
    """A labeled identity for a trace event. Extends `H._trace_label` (EventDispatch gets its
    event type) with the function/url the brief names explicitly for timers and function calls,
    read from the trace's own `args.data` and never invented -- a call whose args carry no
    function/url reports just the bare event name, which is itself a real finding (the trace at
    these categories does not resolve it), not papered over with a guess."""
    name = e.get("name", "?")
    data = (e.get("args") or {}).get("data") or {}
    if name == "EventDispatch" and data.get("type"):
        return f"EventDispatch {data['type']}"
    if name == "FunctionCall":
        fn = data.get("functionName") or ""
        url = data.get("url") or ""
        line = data.get("lineNumber")
        loc = f"{url}:{line}" if url and line is not None else url
        tail = " ".join(x for x in (fn, loc) if x)
        return f"FunctionCall {tail}".strip() if tail else "FunctionCall"
    if name == "TimerFire":
        tid = data.get("timerId")
        return f"TimerFire#{tid}" if tid is not None else "TimerFire"
    return name


def _events_on_mains(events: list[dict], mains: set[tuple]) -> list[dict]:
    return [e for e in events if e.get("ph") == "X" and "dur" in e and (e.get("pid"), e.get("tid")) in mains]


def _window_label_self_ms(clipped_sorted: list[dict]) -> dict[str, float]:
    """The identical nested stack self-time algorithm `H.summarize_trace` runs over a whole
    pass, run here over one window's already-clipped, already-sorted (ts, then -dur) event
    list. Returns self ms per label; the values sum to the window's busy time with no double
    counting, for the same reason `summarize_trace`'s rows sum to its `busy_ms_per_key`."""
    self_us: dict[str, float] = {}
    stack: list[dict] = []

    def close(item):
        self_us[item["label"]] = self_us.get(item["label"], 0.0) + max(0.0, item["dur"] - item["child"])

    for e in clipped_sorted:
        while stack and stack[-1]["end"] <= e["ts"]:
            close(stack.pop())
        item = {"label": e["label"], "dur": e["dur"], "end": e["ts"] + e["dur"], "child": 0.0}
        if stack:
            stack[-1]["child"] += min(item["dur"], max(0.0, stack[-1]["end"] - e["ts"]))
        stack.append(item)
    while stack:
        close(stack.pop())
    return {k: v / 1000.0 for k, v in self_us.items()}


def per_window_breakdown(trace) -> list[dict]:
    """Every complete keydown-to-keydown window (`H.keystroke_busy_ms`'s own definition: the
    last keydown's window never closes and is dropped) -> {"window": i, "busy_ms": float,
    "labels": [{"label", "self_ms"}, ...] sorted largest first}."""
    data = json.loads(trace) if isinstance(trace, (bytes, bytearray, str)) else trace
    events = data.get("traceEvents", []) if isinstance(data, dict) else list(data)
    mains = H._renderer_main_threads(events)
    keydowns = H._keydown_dispatch_times(events, mains)
    if len(keydowns) < 2:
        return []
    all_events = _events_on_mains(events, mains)
    labeled = [{"label": _label(e), "ts": float(e["ts"]), "dur": float(e["dur"])} for e in all_events]
    out = []
    for i in range(len(keydowns) - 1):
        w0, w1 = keydowns[i], keydowns[i + 1]
        clipped = []
        for e in labeled:
            s = max(e["ts"], w0)
            en = min(e["ts"] + e["dur"], w1)
            if en > s:
                clipped.append({"label": e["label"], "ts": s, "dur": en - s})
        clipped.sort(key=lambda x: (x["ts"], -x["dur"]))
        by_label = _window_label_self_ms(clipped)
        busy_ms = sum(by_label.values())
        rows = sorted(({"label": k, "self_ms": round(v, 4)} for k, v in by_label.items() if v > 0),
                      key=lambda r: -r["self_ms"])
        out.append({"window": i, "busy_ms": round(busy_ms, 4), "labels": rows})
    return out


def slow_vs_median(windows: list[dict], slow_pct: float = 10.0, median_band_pct: float = 10.0) -> dict:
    """Buckets windows by their OWN busy_ms (not a global percentile fit) into a SLOW bucket
    (>= the (100 - slow_pct)th percentile) and a MEDIAN bucket (a `median_band_pct`-wide band
    centered on the 50th percentile), using `H.percentile` -- the harness's own percentile
    convention, not a second one. For every label seen in EITHER bucket, reports how often it
    appears (presence_rate) and its mean cost, both over the whole bucket (so an absent label
    is a real 0, never a missing data point -- the same convention TY5's `diff_profiles` uses)
    and conditional on appearing at all. Rows are sorted by the biggest slow-vs-median gap in
    mean cost over the bucket -- the candidates most worth reading first."""
    if not windows:
        return {"n_windows": 0, "rows": []}
    busy = [w["busy_ms"] for w in windows]
    p_slow_cut = H.percentile(busy, 100.0 - slow_pct)
    lo = H.percentile(busy, 50.0 - median_band_pct / 2.0)
    hi = H.percentile(busy, 50.0 + median_band_pct / 2.0)
    slow = [w for w in windows if w["busy_ms"] >= p_slow_cut]
    median = [w for w in windows if lo <= w["busy_ms"] <= hi]

    def agg(bucket: list[dict]) -> dict[str, dict]:
        n_b = len(bucket)
        sums: dict[str, float] = {}
        counts: dict[str, int] = {}
        for w in bucket:
            for r in w["labels"]:
                sums[r["label"]] = sums.get(r["label"], 0.0) + r["self_ms"]
                counts[r["label"]] = counts.get(r["label"], 0) + 1
        return {lab: {"presence_rate": round(counts[lab] / n_b, 3) if n_b else 0.0,
                      "mean_self_ms_when_present": round(sums[lab] / counts[lab], 4),
                      "mean_self_ms_over_bucket": round(sums[lab] / n_b, 4) if n_b else 0.0}
                for lab in sums}

    slow_agg, median_agg = agg(slow), agg(median)
    zero = {"presence_rate": 0.0, "mean_self_ms_when_present": 0.0, "mean_self_ms_over_bucket": 0.0}
    rows = []
    for lab in set(slow_agg) | set(median_agg):
        s, m = slow_agg.get(lab, zero), median_agg.get(lab, zero)
        rows.append({"label": lab, "slow": s, "median": m,
                     "delta_mean_self_ms_over_bucket": round(s["mean_self_ms_over_bucket"]
                                                              - m["mean_self_ms_over_bucket"], 4)})
    rows.sort(key=lambda r: -r["delta_mean_self_ms_over_bucket"])
    return {"n_windows": len(windows), "slow_cutoff_busy_ms": round(p_slow_cut, 3),
            "median_band_ms": [round(lo, 3), round(hi, 3)], "slow_count": len(slow),
            "median_count": len(median),
            "slow_busy_ms": {"mean": round(sum(w["busy_ms"] for w in slow) / len(slow), 3) if slow else None,
                             "min": round(min((w["busy_ms"] for w in slow), default=0.0), 3)},
            "median_busy_ms": {"mean": round(sum(w["busy_ms"] for w in median) / len(median), 3) if median else None},
            "rows": rows}


def run(base: str, sizes: list[int], chars: int, out_dir: Path, raw_dir: Path) -> dict:
    from playwright.sync_api import sync_playwright
    run_id = time.strftime("r%H%M%S")
    results: dict[int, dict] = {}
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
        H._provision(admin_ctx.request, ctx.request, base)
        notes = H._seed(ctx.request, base, sizes, run_id)
        pg = ctx.new_page()
        errors: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        small_id, small_marker = notes[3]
        pg.goto(f"{base}/journal/notebook?note={small_id}")
        H._dismiss_intro(pg)
        pg.wait_for_selector(".ProseMirror", timeout=30000)
        for n in sizes:
            nid, marker = notes[n]
            pg.evaluate(H.OPEN_NOTE_JS, {"id": small_id, "marker": small_marker, "timeoutMs": 15000})
            pg.evaluate(H.OPEN_NOTE_JS, {"id": nid, "marker": marker, "timeoutMs": 15000})
            focused = pg.evaluate(FOCUS_EDITOR_END_JS)
            if not focused:
                errors.append(f"could not focus the editor at {n} paragraphs")
                continue
            # TRACE-ONLY: no wrappers of any kind, not even the typing probe's own
            # keydown/MessageChannel listeners -- identical convention to H.run_live's --busy
            # pass, because the window boundaries come from the trace's own keydown dispatches.
            br.start_tracing(page=pg, categories=H.TRACE_CATEGORIES)
            pg.keyboard.type("q" * chars, delay=25)
            pg.wait_for_timeout(300)
            trace = br.stop_tracing()
            raw_path = raw_dir / f"trace-{n}p-{run_id}.json"
            raw_bytes = trace if isinstance(trace, (bytes, bytearray)) else json.dumps(trace).encode("utf-8")
            raw_path.write_bytes(raw_bytes)
            windows = per_window_breakdown(trace)
            busy_check = H.keystroke_busy_ms(trace)
            errs_here = list(errors)
            errors.clear()
            if not windows:
                errs_here.append(f"keystroke-busy trace at {n} paragraphs: fewer than two "
                                  "keydown dispatches were captured -- no complete window")
            results[n] = {
                "paragraphs": n, "chars": chars, "run_id": run_id,
                "windows": windows,
                "busy_check_p50_ms": round(H.percentile(busy_check, 50), 3) if busy_check else None,
                "busy_check_p95_ms": round(H.percentile(busy_check, 95), 3) if busy_check else None,
                "raw_trace": str(raw_path),
                "errors": errs_here,
            }
            p50 = results[n]["busy_check_p50_ms"]
            p95 = results[n]["busy_check_p95_ms"]
            print(f"{n:,} paragraphs: {len(windows)} windows, busy p50/p95 = {p50}/{p95} ms/key "
                  f"(cross-check against H.keystroke_busy_ms)")
        br.close()
    out_dir.mkdir(parents=True, exist_ok=True)
    for n, summary in results.items():
        windows_path = out_dir / f"ty8-windows-{n}p.json"
        # newline="\n": a new file's committed blob is LF (CLAUDE.md R-2) -- never the
        # platform default, which on Windows would silently write CRLF.
        windows_path.write_text(json.dumps(summary, indent=1), encoding="utf-8", newline="\n")
        comp = slow_vs_median(summary["windows"])
        comp["paragraphs"] = n
        comp["chars"] = chars
        comp["run_id"] = run_id
        comp_path = out_dir / f"ty8-slow-vs-median-{n}p.json"
        comp_path.write_text(json.dumps(comp, indent=1), encoding="utf-8", newline="\n")
        print(f"\n{n:,} paragraphs -- slow (>= {comp['slow_cutoff_busy_ms']} ms, "
              f"n={comp['slow_count']}) vs median ({comp['median_band_ms']} ms, "
              f"n={comp['median_count']}) -- top labels by (slow - median) mean ms/window:")
        for r in comp["rows"][:15]:
            print(f"  {r['delta_mean_self_ms_over_bucket']:+.4f} ms  {r['label']}  "
                  f"(slow presence {r['slow']['presence_rate']:.2f}, "
                  f"median presence {r['median']['presence_rate']:.2f})")
    return results


def self_check() -> int:
    """No browser: builds a tiny synthetic trace with a known, planted cost (a 6 ms FunctionCall
    inside ONE window out of ten, all others carrying only a cheap EventDispatch) and proves:
    (1) per_window_breakdown's busy_ms for a window matches the window's actual planted work and
    agrees with `H.keystroke_busy_ms`'s own number for the SAME trace; (2) slow_vs_median puts
    the planted-cost window in the SLOW bucket, the planted label's delta is positive and its
    median-bucket presence is a real 0 (not missing); (3) a label present on every window with
    IDENTICAL cost (e.g. the keydown dispatch itself) has a near-zero delta -- it does not get
    flagged as a tail cause just for existing everywhere."""
    def mk_main(pid=1, tid=1):
        return [{"ph": "M", "name": "thread_name", "pid": pid, "tid": tid,
                 "args": {"name": "CrRendererMain"}}]

    events = mk_main()
    pid, tid = 1, 1
    n_windows = 20
    step_us = 25_000  # 25ms cadence, matching the harness's own --chars delay
    for i in range(n_windows + 1):  # n_windows+1 keydowns -> n_windows complete windows (last dropped)
        t0 = i * step_us
        # Vary the baseline dispatch cost slightly (no two windows tied) so a percentile cutoff
        # has something to bite on -- real measured data is never exactly tied either.
        dur = 150 + (i % 7) * 10
        events.append({"ph": "X", "name": "EventDispatch", "pid": pid, "tid": tid,
                       "ts": t0, "dur": dur, "args": {"data": {"type": "keydown"}}})
        if i == 7:  # the planted slow window: an extra 6ms FunctionCall, nested isn't required
            events.append({"ph": "X", "name": "FunctionCall", "pid": pid, "tid": tid,
                           "ts": t0 + 300, "dur": 6000,
                           "args": {"data": {"functionName": "plantedSlowFn", "url": "plant.js",
                                             "lineNumber": 42}}})
    windows = per_window_breakdown(json.dumps({"traceEvents": events}))
    assert len(windows) == n_windows, f"expected {n_windows} complete windows, got {len(windows)}"
    busy_check = H.keystroke_busy_ms(json.dumps({"traceEvents": events}))
    assert len(busy_check) == n_windows
    for i, (w, b) in enumerate(zip(windows, busy_check)):
        assert abs(w["busy_ms"] - b) < 1e-6, f"window {i}: {w['busy_ms']} vs H.keystroke_busy_ms {b}"
    assert windows[7]["busy_ms"] > windows[0]["busy_ms"] + 5.0, "the planted window must read slow"
    slow_label = "FunctionCall plantedSlowFn plant.js:42"
    assert any(r["label"] == slow_label for r in windows[7]["labels"]), windows[7]["labels"]

    comp = slow_vs_median(windows, slow_pct=10.0, median_band_pct=40.0)
    slow_window_nums = {w["window"] for w in windows if w["busy_ms"] >= comp["slow_cutoff_busy_ms"]}
    assert 7 in slow_window_nums, (comp["slow_cutoff_busy_ms"], [w["busy_ms"] for w in windows])
    row = next(r for r in comp["rows"] if r["label"] == slow_label)
    assert row["slow"]["presence_rate"] > 0, row
    assert row["median"]["presence_rate"] == 0.0, row  # a real 0, not a missing key
    assert row["slow"]["mean_self_ms_over_bucket"] > row["median"]["mean_self_ms_over_bucket"], row
    assert row["delta_mean_self_ms_over_bucket"] > 0.05, row
    keydown_row = next((r for r in comp["rows"] if r["label"] == "EventDispatch keydown"), None)
    assert keydown_row is not None
    # present on every window at a near-flat cost (a small jitter is planted on purpose, see
    # `dur` above) -- its delta must stay far below the planted label's, never flagged as a
    # tail cause just for being everywhere.
    assert abs(keydown_row["delta_mean_self_ms_over_bucket"]) < row["delta_mean_self_ms_over_bucket"] / 2, \
        (keydown_row, row)

    print("SELF-CHECK OK: per_window_breakdown agrees with H.keystroke_busy_ms window-for-window; "
          "slow_vs_median puts the planted-cost window in the slow bucket, reports its absence "
          "from the median bucket as a real 0, and does not flag a flat, everywhere-present label")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=None, help="an already-running sandbox")
    ap.add_argument("--boot", action="store_true")
    ap.add_argument("--data-dir", default=None)
    ap.add_argument("--port", type=int, default=8341)
    ap.add_argument("--sizes", default="1000,2000")
    ap.add_argument("--chars", type=int, default=150)
    ap.add_argument("--out", default=str(REPO / "docs/notebook/perf-runs/ty8"))
    ap.add_argument("--raw-dir", default=None)
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    sizes = [int(x) for x in args.sizes.split(",") if x.strip()]
    out_dir = Path(args.out)
    raw_dir = Path(args.raw_dir) if args.raw_dir else Path(args.data_dir or ".").parent / "ty8-trace-raw"
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

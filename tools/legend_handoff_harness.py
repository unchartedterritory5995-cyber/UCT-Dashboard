"""Browser acceptance for the LEGEND HANDOFF on a symbol switch.

The chart transitions A -> B atomically (see scan_handoff_harness.py). This
harness asks the question that one never did: does the LEGEND transition with
it? Every animation frame across a scan is sampled in-page, and every legend
surface is recorded:

  Bar Info      date / O / H / L / C / change / change%
  study stack   EMA 9 / EMA 20 / SMA 50 / SMA 200 (+ banded Volume if present)
  volume strip  the volume pane's own readout
  pane legends  own-pane RSI and multi-output MACD

Each symbol is served from its OWN price and volume band, so every number the
legend prints identifies the generation it came from. Signatures are captured
per symbol at rest, AFTER the scan (a calibration pass), and every scanned frame
is classified against them:

  BLANK   the chart has candles but a legend surface/row/value is missing
  MIXED   the legend disagrees with the drawn chart (or with itself)
  LATE    the legend shows a generation older than one it already showed

Fail-closed: a transition with no stimulus, no observed frames, no target chart
or no target legend is INVALID, and INVALID never counts as PASS.

Negative controls (all four must trip):
  NC1 blank frame    -> BLANK     NC2 mixed frame   -> MIXED
  NC3 late gen       -> LATE      NC4 dead observer -> INVALID

Isolation: no backend (every /api/** route-mocked), no session, and the harness
page refuses every non-GET to the preference/layout routes.

Usage:  <venv>\\python.exe tools\\legend_handoff_harness.py [--label NAME]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import socket
import sys
from datetime import timedelta

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from intraday_tail_harness import (   # noqa: E402
    CLOCK_JS, FAKE_NOW, SEED_JS, CACHE_LOGIC_VERSION, EXT_OPEN_MIN, EXT_CLOSE_MIN, ET,
    Fixture, _session_days, route_handler,
)
from scan_handoff_harness import start_dev_server, CLEAR_IDB   # noqa: E402

TF = "5"
TF_MIN = 5

# The owner's scan list, then cold symbols for the rapid late-response burst.
SYMS = ["AAPL", "MSFT", "NVDA", "GWH", "MVST", "PYPL", "AMD", "INTC", "ORCL", "TSLA"]
WARM = {"MSFT", "GWH", "PYPL"}          # seeded in IndexedDB before load
# Everything else starts COLD (network, 111 ms modelled origin latency).


def band(sym: str) -> int:
    return SYMS.index(sym) + 1


def make_sym_bars(sym: str, upto, n_sessions: int = 4):
    """Deterministic bars in `sym`'s own band. Price ~100*k, volume ~10k*k, and
    a per-symbol oscillation period + drift so RSI (scale-free) differs too."""
    k = band(sym)
    out, i = [], 0
    for day in _session_days(upto, n_sessions):
        m = EXT_OPEN_MIN
        while m < EXT_CLOSE_MIN:
            from datetime import datetime
            t = datetime(day.year, day.month, day.day, m // 60, m % 60, tzinfo=ET)
            if t > upto:
                break
            ts = int(t.timestamp())
            base = 100.0 * k * (1 + 0.02 * math.sin(i / (4.0 + k)) + 0.0004 * k * math.cos(i / 7.0))
            out.append({
                "t": ts,
                "o": round(base, 2),
                "h": round(base * 1.002, 2),
                "l": round(base * 0.998, 2),
                "c": round(base * (1 + 0.0007 * math.sin(i * 1.3 + k)), 2),
                "v": 10000 * k + (ts % 500),
            })
            i += 1
            m += TF_MIN
    return out


class BandFixture(Fixture):
    def bars_response(self, sym, tf, want, since):
        all_bars = make_sym_bars(sym, self.server_now)
        if since:
            rows = [b for b in all_bars if b["t"] > int(since)]
            body = {"ticker": sym, "tf": tf, "bars": rows, "delta": True}
        else:
            rows = all_bars[-want:]
            body = {"ticker": sym, "tf": tf, "bars": rows}
        self.requests.append({"sym": sym, "tf": tf, "bars": want,
                              "since": int(since) if since else None,
                              "returned": len(rows), "delta": bool(since)})
        return body


# ── the in-page observer ────────────────────────────────────────────────────
# Samples on every animation frame: rAF callbacks run immediately before the
# frame is composited, so what this reads is what the member sees. It records
# only while `window.__lh.dead` is false — NC4 flips it to prove a dead observer
# yields INVALID, never PASS.
OBSERVER_JS = r"""
(() => {
  if (window.__lh) return true;
  const txt = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null);
  const shown = (el) => !!el && el.getClientRects().length > 0
    && getComputedStyle(el).visibility !== 'hidden';
  const lh = { frames: [], marks: [], dead: false, running: true, mutations: 0 };
  const snap = () => {
    const now = performance.now();
    const symEl = document.querySelector('[data-testid="sym-label"]');
    const domSym = symEl ? (symEl.textContent || '').trim().split(/[\s(·]/)[0].toUpperCase() : null;
    const t = window.__uctChartTiming;
    const rows = t ? t.report() : null;
    let chartSym = null;
    if (Array.isArray(rows)) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i]['T0→paint'] != null) { chartSym = String(rows[i].sym || '').toUpperCase(); break; }
      }
    }
    const bar = document.querySelector('[class*="barInfo"]');
    const barVals = bar ? Array.from(bar.querySelectorAll('[class*="barVal"]')).map(txt) : null;
    const barChg = bar ? Array.from(bar.querySelectorAll('[class*="barChg"]')).map(txt) : null;
    const barDate = bar ? txt(bar.querySelector('[class*="barDate"]')) : null;
    const stack = document.querySelector('[class*="studyStack"]');
    const study = stack ? Array.from(stack.querySelectorAll('[data-legend-row]')).map((r) => ({
      id: r.getAttribute('data-legend-row'), text: txt(r), shown: shown(r),
    })) : null;
    const vol = Array.from(document.querySelectorAll('[class*="volLegend"]')).filter(shown).map(txt);
    const panes = Array.from(document.querySelectorAll('[class*="paneLegend"]')).filter(shown)
      .map((p) => txt(p));
    return {
      ts: now, domSym, chartSym,
      requested: (window.__scan && window.__scan.requested()) || null,
      barShown: shown(bar), barDate, barVals, barChg,
      stackShown: shown(stack), study, vol, panes,
    };
  };
  // ⭐ AN INDEPENDENT FRAME COUNTER, registered first so it runs first in every
  // frame. The observer stamps it on each sample; a jump of more than one means a
  // frame was painted that the observer did NOT see. A long main-thread task
  // produces no frame at all, so it never looks like a miss.
  lh.beat = 0;
  const beat = () => { if (!lh.running) return; lh.beat += 1; requestAnimationFrame(beat); };
  requestAnimationFrame(beat);
  const tick = () => {
    if (!lh.running) return;
    if (!lh.dead) { const f = snap(); f.beat = lh.beat; lh.frames.push(f); }
    requestAnimationFrame(tick);
  };
  lh.mark = (target, kind) => { lh.marks.push({ ts: performance.now(), target, kind, beat: lh.beat, frameIdx: lh.frames.length }); };
  lh.snap = snap;
  window.__lh = lh;
  requestAnimationFrame(tick);
  return true;
})()
"""

# ── negative controls, applied to the REAL rendered legend (harness-only) ──
# Each arms a one-shot tamper that fires on the frame the chart first shows
# `target`, holds for `n` frames, then restores the DOM it touched.
NC_JS = r"""
([kind, target, fromValues, n, delay]) => {
  const lh = window.__lh;
  let armed = true, left = n, saved = [], wait = delay || 0;
  const legendEls = () => Array.from(document.querySelectorAll(
    '[class*="barInfo"], [class*="studyStack"], [class*="volLegend"], [class*="paneLegend"]'));
  const valueEls = () => Array.from(document.querySelectorAll('[class*="barVal"]'));
  const step = () => {
    const f = lh.snap();
    if (armed && f.chartSym === target && wait-- <= 0) {
      armed = false;
      if (kind === 'blank') {
        saved = legendEls().map((el) => [el, el.style.visibility]);
        saved.forEach(([el]) => { el.style.visibility = 'hidden'; });
      } else {
        // mixed / late: print another generation's Bar Info values.
        saved = valueEls().map((el) => [el, el.textContent]);
        valueEls().forEach((el, i) => { if (fromValues[i] != null) el.textContent = fromValues[i]; });
      }
    }
    if (!armed) {
      if (left-- <= 0) {
        if (kind === 'blank') saved.forEach(([el, v]) => { el.style.visibility = v; });
        else saved.forEach(([el, v]) => { if (el.isConnected) el.textContent = v; });
        return;
      }
      if (kind !== 'blank') {
        valueEls().forEach((el, i) => { if (fromValues[i] != null) el.textContent = fromValues[i]; });
      }
    }
    requestAnimationFrame(step);
  };
  // Run BEFORE the observer's own callback in each frame: queued now, it is
  // ordered ahead of the observer's next re-queue.
  requestAnimationFrame(step);
  return true;
}
"""


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def run(label: str, explore: bool = False):
    port = free_port()
    print(f"[legend] dev server on :{port}", flush=True)
    proc = start_dev_server(port)
    base = f"http://127.0.0.1:{port}"
    fixture = BandFixture()
    out = {"label": label}
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context(viewport={"width": 1400, "height": 900})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            ctx.route("**/api/**", route_handler(fixture))
            page = ctx.new_page()
            errs, console_errs = [], []
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.on("console", lambda m: console_errs.append(m.text) if m.type == "error" else None)

            page.goto(f"{base}/scan-harness.html?blank=1", wait_until="domcontentloaded")
            page.evaluate(CLEAR_IDB)
            page.evaluate("() => { try { localStorage.setItem('uct.chartTiming','1') } catch {} }")
            for s in WARM:
                page.evaluate(SEED_JS, [s, TF, make_sym_bars(s, FAKE_NOW), CACHE_LOGIC_VERSION])

            url = f"{base}/scan-harness.html?tf={TF}&studies=1&syms={','.join(SYMS)}"
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_function("() => !!window.__scan", timeout=30000)
            page.wait_for_timeout(3000)
            page.evaluate(OBSERVER_JS)
            page.wait_for_timeout(300)

            if explore:
                page.screenshot(path=os.path.join(os.path.dirname(__file__), "legend_explore.png"))
                out["explore"] = page.evaluate("() => window.__lh.snap()")
                print(json.dumps(out["explore"], indent=1))
                b.close()
                return out

            def select(sym, kind, dwell):
                page.evaluate("([s,k]) => { window.__lh.mark(s,k); window.__scan.select(s) }", [sym, kind])
                page.wait_for_timeout(dwell)

            order = SYMS[:6]
            # Pass 1 — first visits: warm (IndexedDB) and cold (network).
            for s in order[1:]:
                select(s, "first", 900)
            # Pass 2 — hot (in-memory) revisits.
            for s in order[:-1][::-1]:
                select(s, "hot", 500)
            for s in order[1:]:
                select(s, "hot", 500)
            # Pass 3 — rapid bursts, faster than preparation can finish. The
            # second burst is all COLD symbols, so every earlier generation's
            # network response lands AFTER a later selection — the LATE case.
            for burst in (["MSFT", "NVDA", "GWH", "MVST", "AAPL"], ["AMD", "INTC", "ORCL", "TSLA"]):
                for s in burst:
                    page.evaluate("([s,k]) => { window.__lh.mark(s,k); window.__scan.select(s) }", [s, "burst"])
                    page.wait_for_timeout(18)
                page.wait_for_timeout(1500)

            # ── negative controls ──
            def bar_vals():
                return page.evaluate("() => window.__lh.snap().barVals")
            ncs = {}
            # NC1 blank: hide every legend surface for 4 frames at the switch.
            page.evaluate(NC_JS, ["blank", "MSFT", [], 4, 0])
            select("MSFT", "nc1", 1500)
            ncs["nc1"] = "MSFT"
            # NC2 mixed: at the switch to NVDA, print MSFT's Bar Info for 4 frames.
            msft_vals = bar_vals()
            page.evaluate(NC_JS, ["mixed", "NVDA", msft_vals, 4, 0])
            select("NVDA", "nc2", 1500)
            ncs["nc2"] = "NVDA"
            # NC3 late: go GWH, then MVST; once MVST is drawn, print GWH's values
            # (an older generation) for 4 frames.
            select("GWH", "nc3a", 1500)
            gwh_vals = bar_vals()
            # Wait 3 frames after MVST is drawn, so MVST's legend is already
            # authoritative when the older generation arrives.
            page.evaluate(NC_JS, ["late", "MVST", gwh_vals, 4, 3])
            select("MVST", "nc3", 1500)
            ncs["nc3"] = "MVST"
            # NC4 dead observer: stop sampling, switch, resume.
            page.evaluate("() => { window.__lh.dead = true }")
            select("PYPL", "nc4", 1500)
            page.evaluate("() => { window.__lh.dead = false }")
            ncs["nc4"] = "PYPL"
            page.wait_for_timeout(200)

            # ── calibration: each symbol's legend AT REST ──
            page.evaluate("() => { window.__lh.mark(null, 'calibration') }")
            sigs = {}
            for s in SYMS:
                page.evaluate("(s) => window.__scan.select(s)", s)
                page.wait_for_timeout(1100)
                a = page.evaluate("() => window.__lh.snap()")
                page.wait_for_timeout(250)
                b2 = page.evaluate("() => window.__lh.snap()")
                sigs[s] = {"a": a, "b": b2}

            frames = page.evaluate("() => window.__lh.frames")
            marks = page.evaluate("() => window.__lh.marks")
            timing = page.evaluate("() => window.__uctChartTiming.report()")
            blocked = page.evaluate("() => window.__scan.blocked()")
            page.evaluate("() => { window.__lh.running = false }")
            out.update({"frames": frames, "marks": marks, "sigs": sigs, "ncs": ncs,
                        "timing": timing, "blocked": blocked, "errors": errs,
                        "console_errors": console_errs, "requests": fixture.requests})
            b.close()
    finally:
        try:
            proc.terminate()
        except Exception:                          # noqa: BLE001
            pass
    return out


# ── classification ──────────────────────────────────────────────────────────
def signature(snap):
    """Every legend value, keyed by the surface/row that prints it."""
    sig = {}
    if snap.get("barVals"):
        for i, v in enumerate(snap["barVals"]):
            sig[f"bar:{i}"] = v
    if snap.get("barDate"):
        sig["bar:date"] = snap["barDate"]
    for r in snap.get("study") or []:
        sig[f"row:{r['id']}"] = r["text"]
    for i, v in enumerate(snap.get("vol") or []):
        sig[f"vol:{i}"] = v
    for i, v in enumerate(snap.get("panes") or []):
        sig[f"pane:{i}"] = v
    return sig


# Keys whose value does not identify a symbol (every symbol shares the date).
NON_IDENTIFYING = {"bar:date"}


def classify(out):
    sigs = {s: signature(v["a"]) for s, v in out["sigs"].items()}
    stable = {s: signature(v["a"]) == signature(v["b"]) for s, v in out["sigs"].items()}
    structure = None
    for s, sg in sigs.items():
        keys = set(sg)
        structure = keys if structure is None else structure & keys
    structure = structure or set()
    # Which keys identify a generation: values pairwise distinct across symbols.
    identifying = []
    for k in sorted(structure - NON_IDENTIFYING):
        vals = [sigs[s].get(k) for s in sigs]
        if len(set(vals)) == len(vals):
            identifying.append(k)
    lookup = {k: {sigs[s][k]: s for s in sigs} for k in identifying}

    frames, marks = out["frames"], out["marks"]
    cal_ts = next((m["ts"] for m in marks if m["kind"] == "calibration"), float("inf"))

    def legend_syms(f):
        sg = signature(f)
        got = {}
        for k in identifying:
            v = sg.get(k)
            got[k] = lookup[k].get(v, "?") if v else None
        return sg, got

    # latest selection index per symbol, per frame time
    sel = [m for m in marks if m["kind"] not in ("calibration",)]
    results = []
    max_shown = -1
    shown_gen = {}
    fi = 0
    per_frame = []
    for f in frames:
        if f["ts"] >= cal_ts:
            break
        # generation of each symbol = index of its latest selection at/before f
        while False:
            pass
        sg, got = legend_syms(f)
        missing = [k for k in structure if not sg.get(k)]
        vals = {v for v in got.values() if v}
        per_frame.append((f, sg, got, missing, vals))

    # Transition windows: [mark_i, mark_{i+1})
    windows = []
    for i, m in enumerate(sel):
        end = sel[i + 1]["ts"] if i + 1 < len(sel) else cal_ts
        windows.append((i, m, end))

    def gen_of(sym, ts):
        g = -1
        for i, m in enumerate(sel):
            if m["ts"] <= ts and m["target"] == sym:
                g = i
        return g

    totals = {"transitions": 0, "valid": 0, "passed": 0, "failed": 0, "invalid": 0,
              "blank_frames": 0, "mixed_frames": 0, "late_frames": 0}
    per_surface = {}
    shown_max_gen = -1
    for i, m, end in windows:
        fr = [x for x in per_frame if m["ts"] <= x[0]["ts"] < end]
        target = m["target"]
        is_burst_mid = (m["kind"] == "burst" and i + 1 < len(sel)
                        and sel[i + 1]["kind"] == "burst" and sel[i + 1]["ts"] - m["ts"] < 200)
        rec = {"i": i, "target": target, "kind": m["kind"], "frames": len(fr),
               "blank": 0, "mixed": 0, "late": 0, "verdict": None, "why": [],
               "sequence": []}
        chart_hit = any(x[0]["chartSym"] == target for x in fr)
        legend_hit = any(x[4] == {target} and not x[3] and x[0]["chartSym"] == target for x in fr)
        stimulus = any(x[0]["requested"] == target for x in fr) or (is_burst_mid and len(fr) > 0)
        for f, sg, got, missing, vals in fr:
            chart = f["chartSym"]
            lab = ",".join(sorted(v for v in vals)) or "EMPTY"
            if not rec["sequence"] or rec["sequence"][-1] != lab:
                rec["sequence"].append(lab)
            if chart is None:
                continue
            if missing:
                rec["blank"] += 1
                for k in missing:
                    per_surface.setdefault(k.split(":")[0], {"blank": 0, "mixed": 0, "late": 0})["blank"] += 1
            disagree = [k for k, v in got.items() if v and (v != chart or (f["domSym"] and v != f["domSym"]))]
            if disagree or len(vals) > 1:
                rec["mixed"] += 1
                for k in disagree:
                    per_surface.setdefault(k.split(":")[0], {"blank": 0, "mixed": 0, "late": 0})["mixed"] += 1
            gens = {v: gen_of(v, f["ts"]) for v in vals}
            if gens and min(gens.values()) < shown_max_gen:
                rec["late"] += 1
                for k, v in got.items():
                    if v and gens.get(v, 99999) < shown_max_gen:
                        per_surface.setdefault(k.split(":")[0], {"blank": 0, "mixed": 0, "late": 0})["late"] += 1
            if gens:
                shown_max_gen = max(shown_max_gen, max(gens.values()))
        if is_burst_mid:
            # Superseded inside a burst: the handoff may legitimately never draw
            # this generation. Its frames still count for BLANK/MIXED/LATE.
            rec["verdict"] = "SUPERSEDED"
        else:
            # ⛔ OBSERVATION MUST COVER THE TRANSITION: every frame painted from
            # the stimulus until the target legend is authoritative must have been
            # sampled (the independent beat counter proves none was skipped).
            # Frames that resume later prove nothing about the frames missed.
            beats = [m["beat"]] + [x[0]["beat"] for x in fr]
            first_ok = next((x[0]["ts"] for x in fr if x[4] == {target} and not x[3]
                             and x[0]["chartSym"] == target), None)
            horizon = first_ok if first_ok is not None else end
            ts_b = [m["ts"]] + [x[0]["ts"] for x in fr]
            missed = [b2 - a2 - 1 for a2, b2, t in zip(beats, beats[1:], ts_b) if t < horizon]
            # +1 tolerance on the very first step: the mark is stamped mid-task,
            # so the next frame's counter may already have advanced once.
            if missed:
                missed[0] = max(0, missed[0] - 1)
            if not fr or (missed and max(missed) > 0):
                rec["why"].append(f"observer missed {max(missed) if missed else 'all'} painted frame(s)")
            if not stimulus:
                rec["why"].append("no stimulus observed")
            if len(fr) < 3:
                rec["why"].append(f"only {len(fr)} frames observed")
            if not chart_hit:
                rec["why"].append("target chart never authoritative")
            if not legend_hit:
                rec["why"].append("target legend never authoritative")
            if rec["why"]:
                rec["verdict"] = "INVALID"
            elif rec["blank"] or rec["mixed"] or rec["late"]:
                rec["verdict"] = "FAIL"
            else:
                rec["verdict"] = "PASS"
        results.append(rec)

    for r in results:
        if r["kind"].startswith("nc"):
            continue
        totals["blank_frames"] += r["blank"]
        totals["mixed_frames"] += r["mixed"]
        totals["late_frames"] += r["late"]
        if r["verdict"] == "SUPERSEDED":
            continue
        totals["transitions"] += 1
        if r["verdict"] == "INVALID":
            totals["invalid"] += 1
        else:
            totals["valid"] += 1
            totals["passed" if r["verdict"] == "PASS" else "failed"] += 1

    nc = {r["kind"]: r for r in results if r["kind"].startswith("nc")}
    controls = {
        "NC1_blank_detected": bool(nc.get("nc1") and nc["nc1"]["blank"] > 0),
        "NC2_mixed_detected": bool(nc.get("nc2") and nc["nc2"]["mixed"] > 0),
        "NC3_late_detected": bool(nc.get("nc3") and nc["nc3"]["late"] > 0),
        "NC4_invalid": bool(nc.get("nc4") and nc["nc4"]["verdict"] == "INVALID"),
    }
    return {"totals": totals, "controls": controls, "per_surface": per_surface,
            "structure": sorted(structure), "identifying": identifying,
            "calibration_stable": stable, "results": results}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="run")
    ap.add_argument("--explore", action="store_true")
    ap.add_argument("--classify", help="re-classify a saved *_frames.json")
    a = ap.parse_args()
    here = os.path.dirname(os.path.abspath(__file__))
    if a.classify:
        with open(a.classify, encoding="utf-8") as f:
            out = json.load(f)
    else:
        out = run(a.label, a.explore)
        if not a.explore:
            with open(os.path.join(here, f"legend_handoff_{a.label}_frames.json"), "w", encoding="utf-8") as f:
                json.dump(out, f)
    if a.explore:
        return 0
    rep = classify(out)
    with open(os.path.join(here, f"legend_handoff_{a.label}.json"), "w", encoding="utf-8") as f:
        json.dump({"report": rep, "raw": {k: v for k, v in out.items() if k != "frames"},
                   "frame_count": len(out["frames"])}, f, indent=1)
    print(f"\n=== LEGEND HANDOFF [{a.label}] ===")
    print(f"structure keys: {len(rep['structure'])}  identifying: {len(rep['identifying'])}")
    print(f"  {rep['identifying']}")
    print(f"calibration stable: {all(rep['calibration_stable'].values())}")
    print(json.dumps(rep["totals"], indent=1))
    print(json.dumps(rep["controls"], indent=1))
    print("per surface:", json.dumps(rep["per_surface"]))
    for r in rep["results"]:
        print(f"  #{r['i']:>2} {r['kind']:<6} {str(r['target']):<5} {r['verdict']:<10} "
              f"frames={r['frames']:<3} B={r['blank']} M={r['mixed']} L={r['late']} "
              f"seq={' → '.join(r['sequence'][:8])} {'; '.join(r['why'])}")
    print(f"page errors: {out['errors'] or 'none'}")
    print(f"console errors: {len(out['console_errors'])}")
    print(f"refused persistence writes: {out['blocked']}")
    reqs = out["requests"]
    by = {}
    for r in reqs:
        key = f"{r['sym']}{'+since' if r['since'] else ''}"
        by[key] = by.get(key, 0) + 1
    print(f"bars requests: {len(reqs)}  {json.dumps(by, sort_keys=True)}")
    paints = [r.get("T0→paint") for r in out.get("timing") or [] if r.get("T0→paint") is not None]
    if paints:
        ps = sorted(paints)
        print(f"switch T0→paint ms: n={len(ps)} p50={ps[len(ps)//2]} p90={ps[int(len(ps)*0.9)]} max={ps[-1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

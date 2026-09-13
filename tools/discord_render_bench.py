"""Discord render bench — time every hop of the /chart and /flow internal paths,
without Discord, for a fixed symbol set. Phase 0.3 of docs/discord-render/.

Runs INSIDE the web pod (the renderer is on Railway's private network and the
bars store is web's volume). Discord is never called: `edit_fn` is a capture.

    # in the pod (see docs/discord-render/02-baseline.md for the exact upload + run recipe)
    LD_LIBRARY_PATH=... /opt/venv/bin/python /tmp/discord_render_bench.py --adopt-pod-env \
        --out /tmp/bench.jsonl --runs 2
    # locally, harness only (fake hops; proves the arithmetic and the determinism diff)
    python tools/discord_render_bench.py --dry --out bench_dry.jsonl

What it records, per case x run (one JSONL row each):
  chart: bars D (ms, n, last bar, serve layer) · page-bars warm (ms, n) · ext quote (ms) ·
         house render per renderer attempt (ms, HTTP status, X-Chart-Ready, X-Chart-Probe,
         bytes) · judge outcome · stand-in render (ms, bytes) · end-to-end via the REAL
         `run_chart_job` (time to first image, time to final image, outcome, png sha256)
  flow:  flow-worker GET (ms, status, bytes, ok, contracts) · card render (ms, bytes, sha)
  buzz:  board render (ms, bytes, sha)
Determinism: every case runs `--runs` times back to back with the PNG cache cleared;
the report compares sha256 and, when bytes differ, a pixel diff (changed-pixel % and
the bounding box of the change) so "different bytes" and "different picture" are
reported as different facts.

⛔ SAFETY: concurrency is 1 by construction (cases run serially). It writes nothing
to Discord. Bars fetch-on-miss writes the shared bars store exactly as a member's
request would. Self-heal is forced OFF in this process so no background thread can
make a real Discord call after a case finishes.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import os
import statistics
import sys
import time
from dataclasses import dataclass, field

LIQUID = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA"]
MID_FALLBACK = ["AMD", "DELL", "LITE", "MU", "HPE", "STX", "CRDO", "ANET", "SNDK", "PLTR"]
# Edge cases, each chosen for a named property. `why` travels into the report.
EDGE = [
    ("AEHL", "microcap / low float"),
    ("SPCX", "recent listing (first bar date recorded, not assumed)"),
    ("BRK.B", "dot class share (works per 2026-08-26)"),
    ("LEN.B", "dot class share (0 bars per 2026-08-26)"),
    ("SIVB", "delisted (serves frozen history)"),
    ("ZZZZQ", "invalid symbol"),
    ("SPX", "cash index (yfinance path)"),
    ("SMH", "ETF"),
    ("UCTA50", "UCT breadth pseudo-ticker"),
]
CHART_TFS_LIQUID = ["D", "W", "60", "30", "15", "5"]
CHART_TFS_MID = ["D", "15"]
FLOW_DAYS = ["1", "7", "30", "all"]
FLOW_SYMBOLS = ["SPY", "NVDA", "TSLA", "AAPL", "PLTR"]


# ── pure helpers (unit-tested) ──────────────────────────────────────────────

def pct(values, p: float):
    """Nearest-rank percentile; None for an empty list. p in [0, 100]."""
    xs = sorted(v for v in values if v is not None)
    if not xs:
        return None
    # rank = ceil(p/100 * n), clamped to [1, n]. ⛔ Not round(): Python rounds half to
    # even, so round(1.5) == 2 and the median of two samples silently became the max.
    import math
    rank = max(1, min(len(xs), math.ceil((p / 100.0) * len(xs))))
    return xs[rank - 1]


def sha(b: bytes | None) -> str | None:
    return hashlib.sha256(b).hexdigest()[:16] if b else None


def pixel_diff(a: bytes | None, b: bytes | None) -> dict:
    """{'same_bytes', 'same_size', 'changed_pct', 'bbox'} — bytes and pixels are
    different questions: a PNG encoder can differ in bytes on an identical picture,
    and an identical-looking picture can hide a moved clock stamp."""
    if not a or not b:
        return {"same_bytes": False, "comparable": False}
    if a == b:
        return {"same_bytes": True, "same_size": True, "changed_pct": 0.0, "bbox": None, "comparable": True}
    from PIL import Image, ImageChops
    ia = Image.open(io.BytesIO(a)).convert("RGB")
    ib = Image.open(io.BytesIO(b)).convert("RGB")
    if ia.size != ib.size:
        return {"same_bytes": False, "same_size": False, "size_a": ia.size, "size_b": ib.size, "comparable": True}
    diff = ImageChops.difference(ia, ib)
    bbox = diff.getbbox()
    gray = diff.convert("L")
    hist = gray.histogram()
    changed = sum(hist[1:])
    total = ia.size[0] * ia.size[1]
    return {"same_bytes": False, "same_size": True, "changed_pct": round(100.0 * changed / total, 4),
            "bbox": list(bbox) if bbox else None, "comparable": True}


def summarize(rows: list[dict]) -> dict:
    """p50/p95/p99 per (kind, group, hop), success rate, bytes, determinism."""
    out: dict = {"groups": {}, "determinism": {}}
    by = {}
    for r in rows:
        key = (r["kind"], r["group"])
        by.setdefault(key, []).append(r)
    for (kind, group), rs in sorted(by.items()):
        hops = {}
        for r in rs:
            for hop, ms in (r.get("hops_ms") or {}).items():
                # ⛔ A hop that did not happen is None (no image → no first-image time). It
                # is absent from that hop's sample, never a zero — and `max()` over a None
                # crashed the 2026-09-13 baseline's summary after all 170 rows had landed.
                if ms is not None:
                    hops.setdefault(hop, []).append(ms)
        ok = sum(1 for r in rs if r.get("delivered"))
        out["groups"][f"{kind}:{group}"] = {
            "cases": len(rs),
            "delivered": ok,
            "success_rate": round(ok / len(rs), 4) if rs else None,
            "outcomes": _count(r.get("outcome") for r in rs),
            "hops_ms": {h: {"n": len(v), "p50": pct(v, 50), "p95": pct(v, 95), "p99": pct(v, 99), "max": max(v)}
                        for h, v in sorted(hops.items())},
            "png_bytes": {"p50": pct([r.get("png_bytes") for r in rs], 50),
                          "max": max((r.get("png_bytes") or 0) for r in rs)},
        }
    runs = {}
    for r in rows:
        runs.setdefault(r["case_id"], []).append(r)
    for cid, rs in runs.items():
        if len(rs) < 2:
            continue
        base = rs[0]
        verdicts = [r.get("diff_vs_first") for r in rs[1:]]
        out["determinism"][cid] = {
            "runs": len(rs),
            "byte_identical": all(v and v.get("same_bytes") for v in verdicts),
            "max_changed_pct": max(((v or {}).get("changed_pct") or 0.0) for v in verdicts),
            "bboxes": [v.get("bbox") for v in verdicts if v and v.get("bbox")],
            "first_sha": base.get("png_sha"),
        }
    return out


def _count(items) -> dict:
    c: dict = {}
    for i in items:
        c[str(i)] = c.get(str(i), 0) + 1
    return c


# ── instrumentation ─────────────────────────────────────────────────────────

@dataclass
class Trace:
    t0: float = field(default_factory=time.perf_counter)
    hops: dict = field(default_factory=dict)
    notes: dict = field(default_factory=dict)
    edits: list = field(default_factory=list)

    def add(self, hop: str, ms: float) -> None:
        # a hop that runs twice (retry) accumulates, and the count is kept beside it
        self.hops[hop] = round(self.hops.get(hop, 0.0) + ms, 1)
        self.notes[hop + "_calls"] = self.notes.get(hop + "_calls", 0) + 1

    @contextlib.contextmanager
    def hop(self, name: str):
        s = time.perf_counter()
        try:
            yield
        finally:
            self.add(name, (time.perf_counter() - s) * 1000.0)

    def since_start_ms(self) -> float:
        return round((time.perf_counter() - self.t0) * 1000.0, 1)


def adopt_pod_env() -> int:
    """Copy the running app's environment (PID 1) into this process. `railway ssh`
    starts a shell OUTSIDE the app env, so without this the renderer URL, the
    render secret and every flag read as unset — and the bench would measure a
    configuration no member ever gets."""
    n = 0
    try:
        raw = open("/proc/1/environ", "rb").read().split(b"\0")
    except OSError:
        return 0
    for kv in raw:
        if b"=" not in kv:
            continue
        k, v = kv.split(b"=", 1)
        k, v = k.decode(errors="replace"), v.decode(errors="replace")
        if k not in os.environ:
            os.environ[k] = v
            n += 1
    return n


def _edge_groups(mid):
    cases = []
    for s in LIQUID:
        for tf in CHART_TFS_LIQUID:
            cases.append(("chart", "liquid", s, tf, ""))
    for s in mid:
        for tf in CHART_TFS_MID:
            cases.append(("chart", "mid", s, tf, ""))
    for s, why in EDGE:
        cases.append(("chart", "edge", s, "D", why))
    cases.append(("chart", "edge", "AEHL", "5", "microcap intraday"))
    cases.append(("chart_compare", "mode", "NVDA", "D", "compare SPY QQQ"))
    cases.append(("chart_multi", "mode", "NVDA+AMD+AVGO+TSLA", "D", "four symbols, one message"))
    cases.append(("chart_popup", "mode", "NVDA", "D", "flow popup: dark-pool overlay"))
    for s in FLOW_SYMBOLS:
        for d in FLOW_DAYS:
            cases.append(("flow", "flow", s, d, ""))
    cases.append(("flow", "flow_edge", "ZZZZQ", "1", "invalid symbol"))
    cases.append(("buzz", "buzz", "board", "open", ""))
    return cases


def _mid_symbols(n: int = 10) -> list[str]:
    try:
        from api.services import engine
        lead = engine.get_leadership() or []
        rows = lead.get("stocks") if isinstance(lead, dict) else lead
        syms = []
        for r in rows or []:
            s = (r.get("sym") or r.get("ticker") or r.get("symbol")) if isinstance(r, dict) else r
            if s and str(s).upper() not in LIQUID and str(s).upper() not in syms:
                syms.append(str(s).upper())
        if len(syms) >= 3:
            return syms[:n]
    except Exception as e:  # noqa: BLE001
        print(f"[bench] UCT20 unavailable ({e}); using the fallback mid set", file=sys.stderr)
    return MID_FALLBACK[:n]


# ── real runners (pod) ──────────────────────────────────────────────────────

def run_chart_case(kind, symbol, tf, run_idx) -> dict:
    from api.routers import discord_interactions as rt
    from api.services import discord_chart_cache as png_cache
    from api.services import discord_chart_house as house
    from api.services import discord_chart_context as chart_context
    from api.services import discord_interactions as di
    from api.services.discord_chart_render import render_chart_png
    import httpx

    png_cache.clear()
    tr = Trace()
    renderer_attempts = []

    def on_request(req):
        req.extensions["bench_t0"] = time.perf_counter()

    def on_response(resp):
        t0 = resp.request.extensions.get("bench_t0", time.perf_counter())
        renderer_attempts.append({
            "ms": round((time.perf_counter() - t0) * 1000.0, 1), "status": resp.status_code,
            "ready": resp.headers.get("X-Chart-Ready"), "probe": resp.headers.get("X-Chart-Probe"),
            "bytes": resp.headers.get("X-Render-Bytes")})

    client = httpx.Client(timeout=house.RENDER_TIMEOUT_S,
                          event_hooks={"request": [on_request], "response": [on_response]})

    def bars_fn(t, tfx, n):
        s = time.perf_counter()
        out = rt.fetch_bars(t, tfx, n)
        ms = (time.perf_counter() - s) * 1000.0
        hop = "bars_D" if (tfx == "D" and n <= 400) else ("bars_page_warm" if n >= 1000 else f"bars_{tfx}")
        tr.add(hop, ms)
        try:
            from api.services.bars_fetch import get_serve_layer
            tr.notes[hop + "_layer"] = get_serve_layer()
        except Exception:  # noqa: BLE001
            pass
        tr.notes[hop + "_n"] = len(out) if out else 0
        if out:
            tr.notes[hop + "_last_t"] = str(out[-1].get("t"))
            tr.notes[hop + "_first_t"] = str(out[0].get("t"))
        return out

    def quote_fn(t):
        with tr.hop("ext_quote"):
            return rt.fetch_ext_quote(t)

    def house_fn(t, tfx, stats, options=None):
        with tr.hop("house_render"):
            return house.render_house_chart(t, tfx, stats, options, client=client)

    def render_fn(*a, **kw):
        with tr.hop("standin_render"):
            return render_chart_png(*a, **kw)

    def context_fn(t):
        with tr.hop("context_line"):
            return chart_context.context_line(t)

    def edit_fn(app_id, token, **kw):
        png = kw.get("png")
        pngs = kw.get("pngs")
        tr.edits.append({"at_ms": tr.since_start_ms(), "content": str(kw.get("content"))[:160],
                         "has_png": bool(png or pngs), "png_bytes": len(png) if png else sum(len(p) for p, _ in (pngs or [])),
                         "png_sha": sha(png) if png else (sha(b"".join(p for p, _ in pngs)) if pngs else None),
                         "components_rows": len(kw.get("components") or [])})
        tr.notes.setdefault("_pngs", []).append(png or (b"".join(p for p, _ in pngs) if pngs else None))
        return {"id": "bench", "attachments": [{"id": "1"}] if (png or pngs) else []}

    prefs = dict(__import__("api.services.discord_chart_prefs", fromlist=["DEFAULTS"]).DEFAULTS)
    try:
        if kind == "chart_multi":
            items = [(di.ChartRequest(ticker=s, tf=tf), dict(prefs)) for s in symbol.split("+")]
            outcome = di.run_multi_chart_job("bench", "bench", items, bars_fn=bars_fn, render_fn=render_fn,
                                             edit_fn=edit_fn, house_fn=house_fn, quote_fn=quote_fn,
                                             components_fn=di.multi_components)
        else:
            req = di.ChartRequest(ticker=symbol, tf=tf,
                                  compare=("SPY", "QQQ") if kind == "chart_compare" else None,
                                  darkpool=(kind == "chart_popup"))
            req, prefs = rt.breadth_adjust(req, prefs)
            outcome = di.run_chart_job("bench", "bench", req, bars_fn=bars_fn, render_fn=render_fn, edit_fn=edit_fn,
                                       house_fn=house_fn if house.house_enabled() else None, prefs=prefs,
                                       quote_fn=quote_fn, components_fn=lambda r, p: di.chart_components(r, p),
                                       context_fn=context_fn if chart_context.enabled() else None)
    finally:
        client.close()
    images = [e for e in tr.edits if e["has_png"]]
    pngs = [p for p in tr.notes.pop("_pngs", []) if p]
    final_png = pngs[-1] if pngs else None
    return {"hops_ms": {**tr.hops, "e2e_first_image": images[0]["at_ms"] if images else None,
                        "e2e_final_image": images[-1]["at_ms"] if images else None,
                        "e2e_job": tr.since_start_ms()},
            "outcome": outcome, "delivered": bool(images), "edits": tr.edits,
            "renderer_attempts": renderer_attempts, "notes": tr.notes,
            "png_bytes": len(final_png) if final_png else None, "png_sha": sha(final_png), "_png": final_png}


def run_flow_case(symbol, days, run_idx) -> dict:
    import httpx
    from api.flow_ticker_card import render_ticker_flow_card
    tr = Trace()
    base = (os.environ.get("WORKER_INTERNAL_URL") or "").rstrip("/")
    data, status, nbytes = None, None, None
    with tr.hop("flow_fetch"):
        try:
            r = httpx.get(f"{base}/api/live/massive/ticker-flow",
                          params={"symbol": symbol, "days": days, "source": "stocks", "cid": f"bench-{symbol}-{days}-{run_idx}"},
                          timeout=30.0)
            status, nbytes = r.status_code, len(r.content)
            data = r.json() if r.is_success else None
        except Exception as e:  # noqa: BLE001
            status = f"exc:{type(e).__name__}"
    png = None
    outcome = "not_ok"
    if data and data.get("ok"):
        if not data.get("contracts"):
            outcome = "no_flow"
        else:
            with tr.hop("flow_card_render"):
                png = render_ticker_flow_card(data)
            outcome = "ok"
    return {"hops_ms": {**tr.hops, "e2e_job": tr.since_start_ms()}, "outcome": outcome,
            "delivered": outcome in ("ok", "no_flow"), "flow_status": status, "flow_bytes": nbytes,
            "contracts": len((data or {}).get("contracts") or []), "window": (data or {}).get("window"),
            "png_bytes": len(png) if png else None, "png_sha": sha(png), "_png": png}


def run_buzz_case(window, run_idx) -> dict:
    from api.services import buzz_image
    tr = Trace()
    with tr.hop("buzz_render"):
        png = buzz_image._render_uncached(window)
    return {"hops_ms": {**tr.hops, "e2e_job": tr.since_start_ms()}, "outcome": "ok" if png else "text_only",
            "delivered": True, "png_bytes": len(png) if png else None, "png_sha": sha(png), "_png": png}


# ── dry runners (local harness check) ───────────────────────────────────────

def _fake_png(seed: int, clock: bool) -> bytes:
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (320, 180), (25, 28, 23))
    d = ImageDraw.Draw(im)
    for i in range(40):
        y = 90 + int(40 * ((i * 7919 + seed) % 17 - 8) / 8)
        d.rectangle([i * 8, y, i * 8 + 5, y + 12], fill=(60, 184, 104))
    if clock:
        d.text((250, 160), time.strftime("%S"), fill=(200, 200, 200))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def run_dry_case(kind, symbol, tf, run_idx) -> dict:
    tr = Trace()
    with tr.hop("bars_D"):
        time.sleep(0.001)
    png = _fake_png(hash(symbol + tf) % 97, clock=(symbol == "SPY"))
    return {"hops_ms": {**tr.hops, "e2e_job": tr.since_start_ms()}, "outcome": "ok", "delivered": True,
            "png_bytes": len(png), "png_sha": sha(png), "_png": png}


# ── driver ──────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--dry", action="store_true", help="fake hops; harness check only")
    ap.add_argument("--adopt-pod-env", action="store_true")
    ap.add_argument("--only", default="", help="comma list of kinds: chart,flow,buzz")
    ap.add_argument("--limit", type=int, default=0, help="first N cases only (smoke)")
    ap.add_argument("--sleep-ms", type=int, default=250, help="pause between cases (renderer courtesy)")
    ap.add_argument("--resume", action="store_true", help="append to --out, skipping (case, run) rows already there")
    args = ap.parse_args(argv)

    if args.adopt_pod_env:
        print(f"[bench] adopted {adopt_pod_env()} env vars from PID 1", file=sys.stderr)
    os.environ["DISCORD_CHART_SELF_HEAL"] = "0"          # never a real Discord call from this process
    if not args.dry:
        sys.path.insert(0, os.environ.get("BENCH_APP_ROOT", "/app"))

    mid = MID_FALLBACK if args.dry else _mid_symbols()
    cases = _edge_groups(mid)
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    if only:
        cases = [c for c in cases if c[0].split("_")[0] in only]
    if args.limit:
        cases = cases[: args.limit]
    print(f"[bench] {len(cases)} cases x {args.runs} runs; mid set = {mid}", file=sys.stderr)

    rows = []
    done = set()
    if args.resume and os.path.exists(args.out):
        # ⭐ RESUMABLE BECAUSE THE POD IS SHORT-LIVED: web's median deployment served
        # 8.4 minutes over 2026-08-30..09-13 (1,077 deployments), so a bench longer
        # than that is usually killed by somebody's push. Completed (case, run) rows
        # are kept; the determinism diff for a resumed case compares against the
        # first run that is re-executed in THIS process, and says so.
        with open(args.out, encoding="utf-8") as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                rows.append(r)
                done.add((r["case_id"], r["run"]))
        print(f"[bench] resuming: {len(done)} (case, run) rows already recorded", file=sys.stderr)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    started = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    with open(args.out, "a" if args.resume else "w", encoding="utf-8") as fh:
        for kind, group, symbol, tf, why in cases:
            case_id = f"{kind}:{symbol}:{tf}"
            first_png = None
            for run_idx in range(args.runs):
                if (case_id, run_idx) in done:
                    continue
                t_wall = time.time()
                try:
                    if args.dry:
                        res = run_dry_case(kind, symbol, tf, run_idx)
                    elif kind.startswith("chart"):
                        res = run_chart_case(kind, symbol, tf, run_idx)
                    elif kind == "flow":
                        res = run_flow_case(symbol, tf, run_idx)
                    else:
                        res = run_buzz_case(tf, run_idx)
                except Exception as e:  # noqa: BLE001 — a crashed case is a RESULT, recorded as one
                    res = {"hops_ms": {}, "outcome": f"bench_exception:{type(e).__name__}:{str(e)[:160]}",
                           "delivered": False, "_png": None}
                png = res.pop("_png", None)
                if run_idx == 0:
                    first_png = png
                    diff = None
                else:
                    diff = pixel_diff(first_png, png)
                row = {"case_id": case_id, "kind": kind.split("_")[0] if kind.startswith("chart") else kind,
                       "mode": kind, "group": group, "symbol": symbol, "tf": tf, "why": why, "run": run_idx,
                       "wall_start": round(t_wall, 3), **res, "diff_vs_first": diff}
                rows.append(row)
                fh.write(json.dumps(row, default=str) + "\n")
                fh.flush()
                print(f"[bench] {case_id} run{run_idx} {row.get('outcome')} e2e={row['hops_ms'].get('e2e_job')}ms",
                      file=sys.stderr)
                time.sleep(args.sleep_ms / 1000.0)
    summary = summarize(rows)
    summary["started"] = started
    summary["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    summary["commit"] = (os.environ.get("RAILWAY_GIT_COMMIT_SHA") or "")[:12]
    with open(args.out + ".summary.json", "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=1, default=str)
    print(json.dumps({k: v for k, v in summary.items() if k != "determinism"}, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

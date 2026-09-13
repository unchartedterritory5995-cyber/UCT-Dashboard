"""Real-Chromium measurement of services/chart_renderer/app.py (step 2.3). Local Playwright.

  python renderer_pool_smoke.py <repo root> [renders per config, default 48]

1. C-13 against a REAL Playwright error (control: the raw message carries the token).
2. The same N renders of a hermetic data: page at concurrency 4 under five configs, so each
   effect is separate: legacy · pool without spare contexts · pool with spares (both recycle
   after 500) · pool recycling every 12 (the cost of a recycle) · legacy again (drift control).
3. Background cap under real concurrency (6 background + 6 member renders, 4 slots, 2 background).
Prints one JSON document.
"""
import asyncio
import importlib.util
import json
import os
import pathlib
import statistics
import sys
import time

ROOT = pathlib.Path(sys.argv[1]).resolve()
N = int(sys.argv[2]) if len(sys.argv) > 2 else 48
PAGE = ("data:text/html,<html><body style='margin:0;background:%23111'><div id='chart-export'>"
        "<canvas id='c' width='900' height='450'></canvas></div><script>"
        "const x=document.getElementById('c').getContext('2d');"
        "for(let i=0;i<200;i++){x.fillStyle=i%2?'%2326a69a':'%23ef5350';x.fillRect(i*4.5,200-Math.sin(i/9)*120,3,40+i%7*6)}"
        "</script></body></html>")
_KEYS = ("RENDER_POOL_ENABLED", "RENDER_RECYCLE_AFTER", "RENDER_MAX_CONCURRENT", "RENDER_BACKGROUND_SLOTS", "RENDER_POOL_KEYS")


def load(**env):
    for k in _KEYS:
        os.environ.pop(k, None)
    os.environ.update({k: str(v) for k, v in env.items()})
    os.environ["CHART_RENDERER_SECRET"] = "smoke"
    spec = importlib.util.spec_from_file_location(f"cr_smoke_{time.time_ns()}", ROOT / "services/chart_renderer/app.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def pct(xs, p):
    xs = sorted(xs)
    return round(xs[max(0, int(-(-p * len(xs) // 100)) - 1)])


async def batch(mod, n, conc, query="", prio="interactive"):
    sem = asyncio.Semaphore(conc)
    ms, ok = [], 0

    async def one(i):
        nonlocal ok
        async with sem:
            token = mod._priority.set(prio)
            t = time.perf_counter()
            try:
                png, meta = await mod.render_png(mod.RenderRequest(url=PAGE + f"<!--{query}{i}-->", width=960, height=500,
                                                                   scale=1.0, settle_ms=50, ready_timeout_ms=8000))
                ok += bool(png.startswith(b"\x89PNG") and meta["ready"])
            finally:
                mod._priority.reset(token)
            ms.append((time.perf_counter() - t) * 1000)
    await asyncio.gather(*(one(i) for i in range(n)))
    return ms, ok


async def leak_check(mod):
    browser = await mod._get_browser()
    ctx = await browser.new_context()
    page = await ctx.new_page()
    try:
        await page.goto("https://render-smoke.invalid/r/chart?sym=NVDA&token=SMOKETOKEN123", timeout=5000)
        raw = ""
    except Exception as e:  # noqa: BLE001
        raw = f"{type(e).__name__}: {e}"
    finally:
        await ctx.close()
    return {"raw_contains_token": "SMOKETOKEN123" in raw, "scrubbed_contains_token": "SMOKETOKEN123" in mod.scrub(raw)}


async def run_config(name, env, pooled):
    mod = load(**env)
    t = time.perf_counter()
    if pooled:
        await mod.warm()
    boot_ms = round((time.perf_counter() - t) * 1000)
    await batch(mod, 4, 4)                                             # first-render costs out of the sample
    before = (mod._stats.pool_hits, mod._stats.pool_misses, mod._stats.recycles)
    ms, ok = await batch(mod, N, 4)
    row = {"config": name, "renders": len(ms), "valid": ok, "p50_ms": pct(ms, 50), "p90_ms": pct(ms, 90),
           "max_ms": round(max(ms)), "boot_warm_ms": boot_ms if pooled else None,
           "pool_hits": mod._stats.pool_hits - before[0], "pool_misses": mod._stats.pool_misses - before[1],
           "recycles": mod._stats.recycles - before[2]}
    extra = None
    if name == "pool_spares":
        extra = await leak_check_pool_cap(mod)
    await mod._shutdown()
    return row, mod, extra


async def leak_check_pool_cap(pool):
    active = {"bg": 0, "max_bg": 0}
    real_drive = pool._drive

    async def counted(ctx, req, meta):
        bg = "bgcap" in req.url
        if bg:
            active["bg"] += 1
            active["max_bg"] = max(active["max_bg"], active["bg"])
        try:
            await asyncio.sleep(0.25)
            return await real_drive(ctx, req, meta)
        finally:
            if bg:
                active["bg"] -= 1
    pool._drive = counted
    (bms, bok), (ims, iok) = await asyncio.gather(batch(pool, 6, 6, "bgcap", "background"),
                                                 batch(pool, 6, 6, "member", "interactive"))
    pool._drive = real_drive
    return {"max_concurrent_background": active["max_bg"], "background_slots": 2,
            "member_p50_ms": pct(ims, 50), "background_p50_ms": pct(bms, 50), "all_valid": bok + iok == 12}


async def main():
    out = {"renders_per_config": N, "concurrency": 4}
    legacy = load(RENDER_MAX_CONCURRENT=4)
    out["leak"] = await leak_check(legacy)
    await legacy._shutdown()
    rows, cap = [], None
    for name, env, pooled in (
        ("legacy", {"RENDER_MAX_CONCURRENT": 4}, False),
        ("pool_no_spares", {"RENDER_POOL_ENABLED": 1, "RENDER_MAX_CONCURRENT": 4, "RENDER_BACKGROUND_SLOTS": 2,
                            "RENDER_RECYCLE_AFTER": 500, "RENDER_POOL_KEYS": 0}, True),
        ("pool_spares", {"RENDER_POOL_ENABLED": 1, "RENDER_MAX_CONCURRENT": 4, "RENDER_BACKGROUND_SLOTS": 2,
                         "RENDER_RECYCLE_AFTER": 500, "RENDER_POOL_KEYS": 4}, True),
        ("pool_recycle_every_12", {"RENDER_POOL_ENABLED": 1, "RENDER_MAX_CONCURRENT": 4, "RENDER_BACKGROUND_SLOTS": 2,
                                   "RENDER_RECYCLE_AFTER": 12, "RENDER_POOL_KEYS": 0}, True),
        ("legacy_again", {"RENDER_MAX_CONCURRENT": 4}, False),
    ):
        row, _, extra = await run_config(name, env, pooled)
        rows.append(row)
        cap = extra or cap
    out["configs"] = rows
    out["background_cap"] = cap
    print(json.dumps(out, indent=2))


asyncio.run(main())

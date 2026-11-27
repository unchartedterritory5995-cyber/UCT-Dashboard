"""e96 -- THE DOOR HEARTBEAT, IN A REAL BROWSER, ON THE BUILT BUNDLE (coordinator ruling 2026-11-23).

The member door's worker (`app/src/components/chart/builder/memberPane/memberDoorWorker.js`) posts a heartbeat as each
job starts and at least every 5 s of work after it, driven from the work's own counted steps (`engine/workPulse.js`);
the page treats a worker that owes an answer and has said nothing for 30 s as dead. The vitest rails prove the rules on
fake clocks; this rail proves the REAL worker chunk of a PRODUCTION build (`dist/assets/memberDoorWorker-*.js`) beats in
Playwright's own headless Chromium: constructed as the page constructs it (a module Worker), sent a job as the page
sends it, its messages timed on the page's clock.

    python tools/door_heartbeat_browser_rail.py --dist app/dist --env-file <prod_vite.env> [--out result.json]
    python tools/door_heartbeat_browser_rail.py --self-check        # proves the verdict can FAIL

⛔ THE BUILD MUST CARRY PRODUCTION'S VITE_* FLAGS. A flagless bundle answers every paste with "the member pane is off",
which reads as a broken product (it happened, 2026-11-22). So before anything runs, every `NAME=VALUE` of `--env-file`
(the VITE_* lines of production's web service; the file is never committed) must be baked into the build (`NAME:"VALUE"`
in a built chunk), and the worker's answer to a fast committed script must be a DRAWN pane: a worker built without the
member pane flag refuses it. Either missing is INCONCLUSIVE, never a pass.

What runs, each job on a FRESH worker (its bundle load included, as a member's first paste):
  1. FAST: a committed corpus script. The first word from the worker is the job's start beat
     (`{type: 'beat', id, ms: 0}`), then its answer: the door DREW it (the flags reached the worker).
  2. SLOW: a synthetic chain whose every line doubles the tree it reads (`doorDeadline.test.js::chain`, depth 17:
     ~19 s of door work on the dev PC). It must beat from its STEPS (a beat with `ms` >= 5,000, naming the job) before
     it answers. The largest silence between two words on the page's clock is measured and REPORTED (on a shared
     machine it is a time, not a verdict).

Exit: 0 PASS · 1 FAIL (named: no start beat, no step beat, a beat naming another job, no answer, the fast script not
drawn) · 2 INCONCLUSIVE (the flags are not in the build, the worker chunk is missing or did not load, the slow job
answered in under 5 s so no step beat was due).

Playwright's bundled Chromium only (`p.chromium.launch()`): never a branded Chrome, never a profile, never a sign-in.
One browser, one page; every worker terminated and the browser closed before exit. Nothing touches production.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ORIGIN = "http://door-heartbeat.invalid"
FAST_SCRIPT = REPO / "corpus" / "committed" / "rvol__05fcd9e160.pine"
HEARTBEAT_MS = 5000
SILENCE_MS = 30000
PASS, FAIL, INCONCLUSIVE = 0, 1, 2


def chain(depth: int) -> str:
    """`doorDeadline.test.js::chain`, the same text: `depth` lines, each doubling the tree the next one reads."""
    lines = ["//@version=5", 'indicator("door deadline rail")', "a0 = close"]
    lines += [f"a{i} = a{i - 1} + a{i - 1}[1]" for i in range(1, depth + 1)]
    lines.append(f"plot(a{depth})")
    return "\n".join(lines)


PAGE = """<!doctype html><meta charset="utf-8"><title>door heartbeat</title><script>
// One job on a FRESH worker: every word it sends, timed on this page's clock from the post, until its answer (or the
// limit); then the worker is terminated. A beat is kept whole; any other typed message by its type; the answer as the
// fields the verdict reads.
window.__job = (url, job, limitMs) => new Promise((resolve) => {
  const t0 = performance.now();
  const seen = [];
  let w;
  try { w = new Worker(url, {type: 'module'}); } catch (e) { resolve({why: 'construct', error: String(e && e.message || e), seen}); return; }
  let timer = null;
  const done = (why) => { if (timer !== null) clearTimeout(timer); timer = null; try { w.terminate(); } catch (e) {} resolve({why, seen, ms: performance.now() - t0}); };
  timer = setTimeout(() => done('limit'), limitMs);
  w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); seen.push({t: performance.now() - t0, error: String((e && e.message) || 'load failed')}); done('error'); };
  w.onmessageerror = () => { seen.push({t: performance.now() - t0, error: 'messageerror'}); done('messageerror'); };
  w.onmessage = (e) => {
    const d = e.data, t = performance.now() - t0;
    if (d && d.type === 'beat') { seen.push({t, beat: {id: d.id, ms: d.ms}}); return; }
    if (d && typeof d.type === 'string') { seen.push({t, type: d.type}); return; }
    const a = d && d.answer;
    seen.push({t, reply: {id: d && d.id, ok: d && d.ok, drawn: !!(a && a.ok === true), guard: (a && a.guard) || null,
      reason: a && a.reason ? String(a.reason).slice(0, 300) : null, error: (d && d.error) || null, workerMs: d && d.ms}});
    if (d && d.id === job.id) done('answered');
  };
  w.postMessage(job);
});
</script>"""


def worker_chunk(dist: Path) -> Path | None:
    found = sorted((dist / "assets").glob("memberDoorWorker-*.js"))
    return found[0] if len(found) == 1 else None


def read_env_file(path: Path) -> dict[str, str]:
    """`NAME=VALUE` lines (VITE_* only; anything else is refused, so no other variable is ever read through here)."""
    out: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        name, sep, value = line.partition("=")
        if not sep or not re.fullmatch(r"VITE_[A-Z0-9_]+", name):
            raise SystemExit(f"--env-file: not a VITE_* line: {name[:40]!r}")
        out[name] = value
    return out


def flags_in_build(dist: Path, wanted: dict[str, str]) -> dict[str, bool]:
    """Is each `NAME:"VALUE"` baked into a built chunk? (Vite writes the env object a module reads whole as that.)"""
    blobs = [p.read_text(encoding="utf-8", errors="replace") for p in (dist / "assets").glob("*.js")]
    return {name: any(f'{name}:"{value}"' in b or f'{name}:{json.dumps(value)}' in b for b in blobs) for name, value in wanted.items()}


def verdict(fast: dict, slow: dict) -> tuple[int, list[str], dict]:
    """The rail's verdict from the two jobs' timed messages (pure: `--self-check` feeds it made-up runs)."""
    lines: list[str] = []
    facts: dict = {}
    code = PASS

    def fail(msg: str) -> None:
        nonlocal code
        lines.append("FAIL " + msg)
        code = FAIL

    def inconclusive(msg: str) -> None:
        nonlocal code
        lines.append("INCONCLUSIVE " + msg)
        if code == PASS:
            code = INCONCLUSIVE

    for name, run, job_id in (("fast", fast, 1), ("slow", slow, 2)):
        seen = run.get("seen") or []
        if run.get("why") in ("construct", "error", "messageerror") and not any("beat" in s for s in seen):
            inconclusive(f"{name}: the worker did not load ({run.get('why')}: {run.get('error') or [s.get('error') for s in seen]})")
            continue
        beats = [s for s in seen if "beat" in s]
        reply = next((s["reply"] for s in seen if "reply" in s and s["reply"].get("id") == job_id), None)
        words = [s["t"] for s in seen]
        gaps = [b - a for a, b in zip([0.0] + words, words)]
        facts[name] = {"beats": len(beats), "firstWordMs": round(words[0]) if words else None,
                       "maxSilenceMs": round(max(gaps)) if gaps else None, "answeredMs": round(run.get("ms") or 0),
                       "workerMs": reply.get("workerMs") if reply else None, "drawn": reply.get("drawn") if reply else None}
        if not seen or "beat" not in seen[0] or seen[0]["beat"] != {"id": job_id, "ms": 0}:
            fail(f"{name}: the first word was not the job's start beat ({seen[0] if seen else 'nothing'})")
        if any(b["beat"]["id"] != job_id for b in beats):
            fail(f"{name}: a beat named another job ({[b['beat'] for b in beats if b['beat']['id'] != job_id][:3]})")
        if reply is None:
            fail(f"{name}: no answer ({run.get('why')})")
            continue
        if name == "fast" and not reply.get("drawn"):
            inconclusive(f"fast: the door did not draw a committed script ({reply.get('guard')}: {reply.get('reason')}); "
                         "a worker built without the member pane's flags refuses it")
        if name == "slow":
            step_beats = [b for b in beats if (b["beat"]["ms"] or 0) >= HEARTBEAT_MS]
            if (reply.get("workerMs") or 0) < HEARTBEAT_MS:
                inconclusive(f"slow: the job answered in {reply.get('workerMs')} ms of the worker's clock; no step beat was due")
            elif not step_beats:
                fail(f"slow: {reply.get('workerMs')} ms of work and no beat from its steps")
            facts[name]["stepBeats"] = len(step_beats)
    return code, lines, facts


def self_check() -> int:
    """⛔ The verdict can fail: made-up runs that must be FAIL / INCONCLUSIVE, and one that must PASS."""
    beat = lambda t, i, ms: {"t": t, "beat": {"id": i, "ms": ms}}  # noqa: E731
    reply = lambda t, i, wms, drawn=True: {"t": t, "reply": {"id": i, "ok": True, "drawn": drawn, "workerMs": wms}}  # noqa: E731
    good_fast = {"why": "answered", "ms": 900, "seen": [beat(400, 1, 0), reply(900, 1, 480)]}
    good_slow = {"why": "answered", "ms": 19000, "seen": [beat(400, 2, 0), beat(5500, 2, 5000), beat(10600, 2, 10100), reply(19000, 2, 18500)]}
    cases = {
        "pass": (good_fast, good_slow, PASS),
        "no step beat": (good_fast, {**good_slow, "seen": [beat(400, 2, 0), reply(19000, 2, 18500)]}, FAIL),
        "no start beat": ({**good_fast, "seen": [reply(900, 1, 480)]}, good_slow, FAIL),
        "beat names another job": (good_fast, {**good_slow, "seen": [beat(400, 2, 0), beat(5500, 7, 5000), reply(19000, 2, 18500)]}, FAIL),
        "no answer": (good_fast, {"why": "limit", "ms": 600000, "seen": [beat(400, 2, 0)]}, FAIL),
        "flagless worker": ({**good_fast, "seen": [beat(400, 1, 0), reply(900, 1, 480, drawn=False)]}, good_slow, INCONCLUSIVE),
        "too fast to beat": (good_fast, {**good_slow, "seen": [beat(400, 2, 0), reply(2000, 2, 1600)]}, INCONCLUSIVE),
        "did not load": ({"why": "error", "seen": [{"t": 50, "error": "load failed"}]}, good_slow, INCONCLUSIVE),
    }
    bad = []
    for name, (f, s, want) in cases.items():
        got, lines, _ = verdict(f, s)
        print(f"self-check {name:24} want {want} got {got} {lines[:1]}")
        if got != want:
            bad.append(name)
    print("SELF-CHECK " + ("PASS" if not bad else f"FAIL {bad}"))
    return PASS if not bad else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dist", help="a production build's output dir (holds assets/memberDoorWorker-*.js)")
    ap.add_argument("--env-file", help="the VITE_* NAME=VALUE lines the build was made with (production's)")
    ap.add_argument("--depth", type=int, default=17, help="the slow chain's depth (17: ~19 s of door work on the dev PC)")
    ap.add_argument("--limit-s", type=int, default=600, help="the longest one job may run before it counts as no answer")
    ap.add_argument("--out", help="write the timed messages and the verdict here (JSON)")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    if not args.dist or not args.env_file:
        ap.error("--dist and --env-file are required (or --self-check)")
    dist = Path(args.dist)
    wanted = read_env_file(Path(args.env_file))
    if not any(n.startswith("VITE_PINE_") for n in wanted):
        print("INCONCLUSIVE: the env file names no VITE_PINE_* flag; it is not production's")
        return INCONCLUSIVE
    baked = flags_in_build(dist, wanted)
    missing = sorted(n for n, ok in baked.items() if not ok)
    print(f"flags: {len(wanted) - len(missing)}/{len(wanted)} of the env file baked into the build")
    pine = sorted(n for n in wanted if n.startswith("VITE_PINE_"))
    print("  " + ", ".join(f"{n}={'baked' if baked[n] else 'MISSING'}" for n in pine))
    if missing:
        print(f"INCONCLUSIVE: built without production's flags: {missing}")
        return INCONCLUSIVE
    chunk = worker_chunk(dist)
    if chunk is None:
        print(f"INCONCLUSIVE: expected exactly one assets/memberDoorWorker-*.js under {dist}")
        return INCONCLUSIVE
    url = f"{ORIGIN}/{chunk.relative_to(dist).as_posix()}"
    fast_job = {"kind": "member-door", "id": 1, "key": "fast", "version": 1,
                "args": {"source": FAST_SCRIPT.read_text(encoding="utf-8"), "id": "u_heartbeat_fast"}, "image": {}}
    slow_job = {"kind": "member-door", "id": 2, "key": "slow", "version": 1,
                "args": {"source": chain(args.depth), "id": "u_heartbeat_slow"}, "image": {}}

    from playwright.sync_api import sync_playwright

    def serve(route):
        rel = route.request.url[len(ORIGIN) + 1:].split("?")[0]
        if rel == "":
            return route.fulfill(status=200, content_type="text/html", body=PAGE)
        f = (dist / rel).resolve()
        if dist.resolve() not in f.parents or not f.is_file():
            return route.fulfill(status=404, body="")
        ctype = "text/javascript" if f.suffix in (".js", ".mjs") else "application/octet-stream"
        return route.fulfill(status=200, content_type=ctype, body=f.read_bytes())

    t_all = time.time()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        version = browser.version
        try:
            page = browser.new_page()
            page.route(f"{ORIGIN}/**", serve)
            page.goto(f"{ORIGIN}/")
            fast = page.evaluate("([u, j, l]) => __job(u, j, l)", [url, fast_job, args.limit_s * 1000])
            print(f"fast ({FAST_SCRIPT.name}): {fast.get('why')} in {round(fast.get('ms') or 0)} ms, {len(fast.get('seen') or [])} words")
            slow = page.evaluate("([u, j, l]) => __job(u, j, l)", [url, slow_job, args.limit_s * 1000])
            print(f"slow (chain {args.depth}): {slow.get('why')} in {round(slow.get('ms') or 0)} ms, {len(slow.get('seen') or [])} words")
            page.close()
        finally:
            browser.close()
    code, lines, facts = verdict(fast, slow)
    for line in lines:
        print(line)
    print(json.dumps({"chromium": version, "worker": chunk.name, **facts}))
    if args.out:
        Path(args.out).write_text(json.dumps({"chromium": version, "worker": chunk.name, "flags": baked, "facts": facts,
                                              "lines": lines, "exit": code, "fast": fast, "slow": slow,
                                              "seconds": round(time.time() - t_all, 1)}, indent=1), encoding="utf-8")
    print({PASS: "DOOR HEARTBEAT BROWSER RAIL: PASS", FAIL: "DOOR HEARTBEAT BROWSER RAIL: FAIL",
           INCONCLUSIVE: "DOOR HEARTBEAT BROWSER RAIL: INCONCLUSIVE"}[code])
    return code


if __name__ == "__main__":
    sys.exit(main())

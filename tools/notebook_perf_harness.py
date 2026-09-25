"""Notebook editor budgets in a real browser: note-open p95 and typing cost per character.
Wave 7, lane I2. It runs LOCALLY ONLY and is never run in CI.

Playwright is a LOCAL install on this box. It is not in requirements.txt and is not in any
workflow. CI runs the search benchmark and the byte budget instead
(`.github/workflows/notebook-budgets.yml`); these two budgets are a local gate step.

Budgets: read from docs/notebook/perf-budgets.json, key "editor" (never retyped here):
  * note open p95 < 300 ms for notes up to 1,000 paragraphs
  * typing < 16 ms per character up to 2,000 paragraphs
    (G-035's 71 ms/char at the SIZE CAP stays as the owner ruled; the budget stops at 2,000)

What is measured, exactly:
  * NOTE OPEN: an IN-APP open, not a page load. The app is already booted on the Notebook.
    The note is opened the way a click does it: `history.pushState` to
    `/journal/notebook?note=<id>` plus a `popstate` event, so React Router routes it. The
    clock stops when the editor holds the note's LAST paragraph. A small note is opened in
    between, so each timed open is a real switch and never a re-render of the same note.
  * TYPING: main-thread cost per keystroke. A capture-phase `keydown` stamps t0. The editor's
    `input` event then posts a MessageChannel message, and its handler stamps t1. That
    handler runs after the current task and its microtasks: ProseMirror's transaction, the
    synchronous React commit, and every plugin's `view.update`. It does NOT wait for vsync,
    so a 60 Hz frame (16.7 ms) never inflates a sample. The caret sits at the END of the
    note, where a member appends.
    ⛔ A keystroke Playwright delivers but the editor never sees yields NO sample. The run
    compares the sample count with the characters sent and reports INCONCLUSIVE on a
    shortfall. It never reports a p95 over the keys that happened to land.

Sandbox (never C:\\data): `--boot` starts `scripts/hub_sandbox_boot.py --data-dir <dir>
--port <port>`. That launcher owns every env pin and the shared-root tripwire. Pass the
data dir from PowerShell or single-quoted: a Windows path through the Bash tool loses its
backslash and turns into a drive-relative directory (CLAUDE.md, 2026-09-12). The harness
refuses a data dir that resolves inside C:\\data or /data. It refuses a busy port too, and
never kills whatever holds it. `--base` measures an already-running sandbox instead.

Accounts: it signs up the sandbox admin (the launcher's ADMIN_EMAILS default,
hubtest@local.dev) and a perf account, comps the perf account through
POST /api/auth/admin/comp-access (the same door the wave-6 walk uses), then seeds its
notes through POST /api/j2/notes. Nothing is written except through the app's own doors.

    python tools/notebook_perf_harness.py --boot --data-dir 'C:\\data-w7perf' --port 8095 \\
        --json docs/notebook/perf-runs/editor-<sha>.json --md -
    python tools/notebook_perf_harness.py --dry-run            # no browser, no sandbox

Exit: 0 = within budget; 1 = a budget breached; 2 = INCONCLUSIVE (nothing trustworthy was
measured); 3 = refused (bad args, a data dir in the shared root, a busy port).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ADMIN_EMAIL, ADMIN_PW = "hubtest@local.dev", "LocalTest2026!"
PERF_EMAIL, PERF_PW = "w7perf@local.dev", "LocalTest2026!"
SHARED_ROOTS = ("c:\\data", "/data")
BUDGETS = REPO / "docs" / "notebook" / "perf-budgets.json"


def _editor_budget() -> dict:
    """The "editor" budget from the committed budget file -- the ONE place the numbers live."""
    spec = json.loads(BUDGETS.read_text(encoding="utf-8"))["editor"]
    return {"open_ms": float(spec["open_p95_ms_max"]), "open_up_to": int(spec["open_up_to_paragraphs"]),
            "typing_ms": float(spec["typing_p95_ms_per_char_max"]),
            "typing_up_to": int(spec["typing_up_to_paragraphs"])}


_B = _editor_budget()
OPEN_BUDGET_MS = _B["open_ms"]
OPEN_UP_TO = _B["open_up_to"]
TYPING_BUDGET_MS = _B["typing_ms"]
TYPING_UP_TO = _B["typing_up_to"]

# ── the page scripts (run inside the app's own page) ─────────────────────────────────────

OPEN_NOTE_JS = """
async ({ id, marker, timeoutMs }) => {
  const t0 = performance.now()
  history.pushState({}, '', '/journal/notebook?note=' + encodeURIComponent(id))
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
  return await new Promise((resolve) => {
    const tick = () => {
      const pm = document.querySelector('.ProseMirror')
      if (pm && pm.textContent.includes(marker)) return resolve({ ok: true, ms: performance.now() - t0 })
      if (performance.now() - t0 > timeoutMs) return resolve({ ok: false, ms: performance.now() - t0 })
      requestAnimationFrame(tick)
    }
    tick()
  })
}
"""

INSTALL_TYPING_PROBE_JS = """
() => {
  const pm = document.querySelector('.ProseMirror')
  if (!pm) return false
  window.__w7Typing = { samples: [], pending: null }
  const st = window.__w7Typing
  window.addEventListener('keydown', () => { st.pending = performance.now() }, true)
  pm.addEventListener('input', () => {
    const t0 = st.pending
    if (t0 == null) return
    st.pending = null
    const ch = new MessageChannel()
    ch.port1.onmessage = () => { st.samples.push(performance.now() - t0) }
    queueMicrotask(() => ch.port2.postMessage(0))
  })
  // caret at the very end of the document
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

READ_TYPING_JS = "() => (window.__w7Typing ? window.__w7Typing.samples.slice() : null)"


def percentile(samples: list[float], pct: float) -> float:
    if not samples:
        raise ValueError("no samples")
    s = sorted(samples)
    return s[max(1, math.ceil(pct / 100.0 * len(s))) - 1]


def paragraphs_doc(n: int, tag: str) -> tuple[dict, str]:
    """A TipTap doc of n paragraphs; the LAST one carries a unique marker the open waits for."""
    content = [{"type": "paragraph", "content": [{"type": "text", "text":
               f"{tag} paragraph {i}: price reclaimed the 20 EMA on rising volume, stop under the swing low."}]}
               for i in range(n - 1)]
    marker = f"{tag}-END-{n}"
    content.append({"type": "paragraph", "content": [{"type": "text", "text": marker}]})
    return {"type": "doc", "content": content}, marker


def refuse_shared_root(data_dir: str) -> str | None:
    """Why `data_dir` is refused, or None. Resolves it first: a relative or drive-relative
    spelling must not slip past a string compare."""
    if not data_dir:
        return "no --data-dir"
    resolved = os.path.normcase(os.path.abspath(data_dir))
    for root in SHARED_ROOTS:
        r = os.path.normcase(os.path.abspath(root))
        if resolved == r or resolved.startswith(r.rstrip("\\/") + os.sep):
            return f"{data_dir!r} resolves to {resolved!r}, inside the shared data root {root!r}"
    return None


def port_busy(port: int) -> bool:
    """connect() succeeding is proof somebody is there (bind() succeeding proves nothing on
    Windows -- CLAUDE.md). A timeout is treated as NOT busy only because the launcher then
    runs its own refusal on the same port."""
    s = socket.socket()
    s.settimeout(1.0)
    try:
        return s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()


def summarize(open_ms: dict[int, list[float]], typing_ms: dict[int, list[float]],
              typed_chars: dict[int, int]) -> dict:
    """Pure: raw samples -> the verdict rows. Kept separate so --dry-run can exercise it."""
    rows = []
    breaches, inconclusive = [], []
    for n, samples in sorted(open_ms.items()):
        if not samples:
            inconclusive.append(f"note open at {n:,} paragraphs: no successful open")
            continue
        p95 = percentile(samples, 95)
        rows.append({"measure": "note_open", "paragraphs": n, "samples": len(samples),
                     "p50_ms": round(percentile(samples, 50), 1), "p95_ms": round(p95, 1),
                     "budget_ms": OPEN_BUDGET_MS if n <= OPEN_UP_TO else None})
        if n <= OPEN_UP_TO and p95 >= OPEN_BUDGET_MS:
            breaches.append(f"note open p95 {p95:.1f} ms >= {OPEN_BUDGET_MS:.0f} ms at {n:,} paragraphs")
    for n, samples in sorted(typing_ms.items()):
        sent = typed_chars.get(n, 0)
        if len(samples) < sent:
            inconclusive.append(f"typing at {n:,} paragraphs: {len(samples)} samples for {sent} keys sent")
            continue
        p95 = percentile(samples, 95)
        rows.append({"measure": "typing_per_char", "paragraphs": n, "samples": len(samples),
                     "p50_ms": round(percentile(samples, 50), 2), "p95_ms": round(p95, 2),
                     "budget_ms": TYPING_BUDGET_MS if n <= TYPING_UP_TO else None})
        if n <= TYPING_UP_TO and p95 >= TYPING_BUDGET_MS:
            breaches.append(f"typing p95 {p95:.2f} ms/char >= {TYPING_BUDGET_MS:.0f} ms at {n:,} paragraphs")
    return {"rows": rows, "breaches": breaches, "inconclusive": inconclusive}


def markdown_rows(summary: dict, sha: str | None) -> str:
    lines = ["| measure | paragraphs | samples | p50 | p95 | budget | tree |", "|---|---:|---:|---:|---:|---:|---|"]
    for r in summary["rows"]:
        b = f"< {r['budget_ms']:g} ms" if r["budget_ms"] else "n/a"
        lines.append(f"| {r['measure']} | {r['paragraphs']:,} | {r['samples']} | {r['p50_ms']} ms | "
                     f"{r['p95_ms']} ms | {b} | `{(sha or '?')[:9]}` |")
    for i in summary["inconclusive"]:
        lines.append(f"| INCONCLUSIVE | | | | | | {i} |")
    return "\n".join(lines)


# ── the live run ──────────────────────────────────────────────────────────────────────────

def _boot(data_dir: str, port: int, log_path: Path) -> subprocess.Popen:
    cmd = [sys.executable, str(REPO / "scripts" / "hub_sandbox_boot.py"), "--data-dir", data_dir,
           "--port", str(port), "--host", "127.0.0.1"]
    fh = open(log_path, "w", encoding="utf-8")
    return subprocess.Popen(cmd, cwd=str(REPO), stdout=fh, stderr=subprocess.STDOUT)


def _wait_health(base: str, timeout_s: float) -> bool:
    import urllib.request
    end = time.time() + timeout_s
    while time.time() < end:
        try:
            with urllib.request.urlopen(base + "/api/health", timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:  # noqa: BLE001 -- not up yet
            pass
        time.sleep(2)
    return False


def _signup_or_login(req, base: str, email: str, pw: str, name: str) -> None:
    r = req.post(base + "/api/auth/signup", data={"email": email, "password": pw, "display_name": name})
    if r.status not in (200, 201):
        r = req.post(base + "/api/auth/login", data={"email": email, "password": pw})
    if r.status not in (200, 201):
        raise SystemExit(f"could not sign in {email}: HTTP {r.status}")


def _provision(admin_req, member_req, base: str) -> None:
    """The wave-6 walk's recipe (tools/notebook_wave6_walk.py): admin in its OWN context,
    the member comped AND email-verified (AuthGuard sends an unverified member to
    /verify-pending whatever the plan), then /api/auth/me must say paid-equivalent."""
    _signup_or_login(admin_req, base, ADMIN_EMAIL, ADMIN_PW, "hubtest")
    _signup_or_login(member_req, base, PERF_EMAIL, PERF_PW, "w7perf")
    c = admin_req.post(base + "/api/auth/admin/comp-access", data={"email": PERF_EMAIL, "action": "grant"})
    v = admin_req.post(base + "/api/auth/admin/verify-email", data={"email": PERF_EMAIL})
    me = member_req.get(base + "/api/auth/me").json()
    if not me.get("paid_equiv"):
        raise SystemExit(f"perf account is not paid-equivalent (comp HTTP {c.status}, verify HTTP {v.status}) "
                         "-- every notebook route would redirect and every number would be a redirect")


def _seed(req, base: str, sizes: list[int], run: str) -> dict[int, tuple[str, str]]:
    out = {}
    for n in sizes + [3]:
        doc, marker = paragraphs_doc(n, f"{run}-{n}")
        r = req.post(base + "/api/j2/notes", data={"title": f"perf {run} {n}", "bodyJson": doc})
        if r.status not in (200, 201):
            raise SystemExit(f"seeding a {n}-paragraph note failed: HTTP {r.status} {r.text()[:200]}")
        out[n] = (r.json()["note"]["id"], marker)
    return out


_INTRO_DIALOG_SEL = 'div[role="dialog"][aria-label="Welcome"]'


def _dismiss_intro(pg) -> None:
    """The Welcome intro (IntroAnimation.jsx) plays once per tab and sits over the page.
    Same recipe as tools/notebook_wave6_walk.py: wait for it, Escape, then wait until it
    has actually DETACHED (it renders null once finished) -- never a blind sleep."""
    dialog = pg.locator(_INTRO_DIALOG_SEL)
    try:
        dialog.first.wait_for(state="visible", timeout=4000)
    except Exception:  # noqa: BLE001 -- it did not play in this tab
        return
    pg.keyboard.press("Escape")
    try:
        dialog.first.wait_for(state="detached", timeout=8000)
    except Exception:  # noqa: BLE001
        pg.get_by_role("button", name="Skip intro", exact=True).click(timeout=2000)
        dialog.first.wait_for(state="detached", timeout=8000)


def run_live(base: str, sizes: list[int], opens: int, chars: int) -> tuple[dict, dict, dict, list[str]]:
    from playwright.sync_api import sync_playwright
    errors: list[str] = []
    run = time.strftime("r%H%M%S")
    open_ms: dict[int, list[float]] = {n: [] for n in sizes}
    typing_ms: dict[int, list[float]] = {}
    typed: dict[int, int] = {}
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
        _provision(admin_ctx.request, ctx.request, base)
        notes = _seed(ctx.request, base, sizes, run)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        small_id, small_marker = notes[3]
        pg.goto(f"{base}/journal/notebook?note={small_id}")
        _dismiss_intro(pg)
        pg.wait_for_selector(".ProseMirror", timeout=30000)
        for n in sizes:
            nid, marker = notes[n]
            for _ in range(opens + 1):  # the first open is a warm-up and is not counted
                pg.evaluate(OPEN_NOTE_JS, {"id": small_id, "marker": small_marker, "timeoutMs": 15000})
                got = pg.evaluate(OPEN_NOTE_JS, {"id": nid, "marker": marker, "timeoutMs": 15000})
                if got["ok"]:
                    open_ms[n].append(got["ms"])
            open_ms[n] = open_ms[n][1:]
            # typing, at the end of this note
            pg.evaluate(OPEN_NOTE_JS, {"id": nid, "marker": marker, "timeoutMs": 15000})
            if not pg.evaluate(INSTALL_TYPING_PROBE_JS):
                errors.append(f"typing probe could not find the editor at {n} paragraphs")
                continue
            pg.keyboard.type("x" * chars, delay=25)
            pg.wait_for_timeout(300)
            samples = pg.evaluate(READ_TYPING_JS) or []
            typing_ms[n] = samples
            typed[n] = chars
        br.close()
    return open_ms, typing_ms, typed, errors


def dry_run() -> int:
    """No browser, no sandbox: parse the page scripts, and run the pure halves against
    stub samples, including one that must breach and one that must be INCONCLUSIVE."""
    import re
    for name, js in (("OPEN_NOTE_JS", OPEN_NOTE_JS), ("INSTALL_TYPING_PROBE_JS", INSTALL_TYPING_PROBE_JS)):
        opens, closes = js.count("{"), js.count("}")
        assert opens == closes, f"{name}: unbalanced braces ({opens} vs {closes})"
        assert re.search(r"=>", js), f"{name}: not a function"
    doc, marker = paragraphs_doc(1000, "dry")
    assert len(doc["content"]) == 1000 and doc["content"][-1]["content"][0]["text"] == marker
    ok = summarize({1000: [100.0] * 20, 2000: [400.0] * 20}, {1000: [3.0] * 60, 2000: [9.0] * 60},
                   {1000: 60, 2000: 60})
    assert ok["breaches"] == [] and ok["inconclusive"] == [], ok
    bad = summarize({1000: [350.0] * 20}, {2000: [20.0] * 60}, {2000: 60})
    assert len(bad["breaches"]) == 2, bad
    short = summarize({1000: []}, {1000: [1.0] * 10}, {1000: 60})
    assert len(short["inconclusive"]) == 2 and not short["rows"], short
    assert refuse_shared_root(r"C:\data") and refuse_shared_root(r"C:\data\sub")
    assert refuse_shared_root(r"C:\data-w7perf") is None
    assert (OPEN_BUDGET_MS, OPEN_UP_TO, TYPING_BUDGET_MS, TYPING_UP_TO) == (300.0, 1000, 16.0, 2000), \
        "the editor budget in perf-budgets.json is not the brief's"
    print(markdown_rows(ok, "dryrun"))
    print("DRY RUN: page scripts parse, the verdict logic breaches and goes INCONCLUSIVE when it must")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--boot", action="store_true", help="start scripts/hub_sandbox_boot.py first")
    ap.add_argument("--base", default=None, help="an already-running sandbox, e.g. http://127.0.0.1:8095")
    ap.add_argument("--data-dir", default=None)
    ap.add_argument("--port", type=int, default=8095)
    ap.add_argument("--sizes", default="1000,2000")
    ap.add_argument("--opens", type=int, default=20)
    ap.add_argument("--chars", type=int, default=60)
    ap.add_argument("--json", dest="json_path", default=None)
    ap.add_argument("--md", default=None, help="write the markdown rows here ('-' = stdout)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    if args.dry_run:
        return dry_run()
    try:
        sizes = [int(x) for x in args.sizes.split(",") if x.strip()]
    except ValueError:
        print(f"bad --sizes {args.sizes!r}")
        return 3
    if bool(args.boot) == bool(args.base):
        print("pass exactly one of --boot (with --data-dir) or --base")
        return 3
    proc = None
    base = args.base
    if args.boot:
        why = refuse_shared_root(args.data_dir or "")
        if why:
            print(f"REFUSED: {why}")
            return 3
        if port_busy(args.port):
            print(f"REFUSED: port {args.port} already has a listener; find it with "
                  f"`Get-NetTCPConnection -LocalPort {args.port}` -- this harness never kills it")
            return 3
        log = Path(args.json_path or "perf").with_suffix(".sandbox.log")
        proc = _boot(args.data_dir, args.port, log)
        base = f"http://127.0.0.1:{args.port}"
        if not _wait_health(base, 240):
            proc.terminate()
            print(f"INCONCLUSIVE: the sandbox never answered /api/health (log: {log})")
            return 2
    sha = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True,
                         text=True).stdout.strip() or None
    try:
        open_ms, typing_ms, typed, errors = run_live(base, sizes, args.opens, args.chars)
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                proc.kill()
    summary = summarize(open_ms, typing_ms, typed)
    out = {"tool": "tools/notebook_perf_harness.py", "git_head": sha, "base": base,
           "sizes": sizes, "opens": args.opens, "chars": args.chars, "page_errors": errors,
           "raw": {"open_ms": open_ms, "typing_ms": typing_ms}, **summary}
    if args.json_path:
        Path(args.json_path).write_text(json.dumps(out, indent=1), encoding="utf-8")
    md = markdown_rows(summary, sha)
    if args.md == "-":
        print(md)
    elif args.md:
        Path(args.md).write_text(md + "\n", encoding="utf-8")
    if summary["inconclusive"] and not summary["rows"]:
        print("VERDICT: INCONCLUSIVE --", "; ".join(summary["inconclusive"]))
        return 2
    if summary["breaches"]:
        print("VERDICT: BUDGET BREACH --", "; ".join(summary["breaches"]))
        return 1
    if summary["inconclusive"]:
        print("VERDICT: INCONCLUSIVE (partial) --", "; ".join(summary["inconclusive"]))
        return 2
    print("VERDICT: PASS -- note open and typing within budget")
    return 0


if __name__ == "__main__":
    sys.exit(main())

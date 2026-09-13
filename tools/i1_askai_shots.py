"""GATE-I1 slice 2 — capture the owner's before/after pair of the Ask-AI tab.

Renders the REAL component (and a verbatim copy of its pre-fix self) against a
SEEDED payload in `app/tools/i1-shot/`, then photographs each one.

    python tools/i1_askai_shots.py

Writes `docs/plans/i1-askai-provenance/askai-sources-{before,after}.png`.

WHAT THIS DELIBERATELY DOES NOT DO
----------------------------------
* It never calls a model and never reaches `/api/research/explain` — the
  harness replaces `window.fetch` and REJECTS any request it did not seed, so
  a screenshot of a state the product cannot produce is not reachable from
  here.
* No BrowserStack, no device farm, no account, no production origin. This is a
  local render on the dev machine and is evidence of MARKUP, not of a device.

⛔ A PORT ASSIGNMENT IS NOT A SERVER IDENTITY (CLAUDE.md). The dev server is
started with `--strictPort` so a busy port fails loudly instead of silently
landing somewhere else, the incumbent is never killed, and the served HTML is
checked for this harness's own marker before anything is photographed.
"""

from __future__ import annotations

import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
OUT_DIR = ROOT / "docs" / "plans" / "i1-askai-provenance"
PORT = 5199
MARKER = "GATE-I1 slice 2 screenshot harness"
BASE = f"http://127.0.0.1:{PORT}/tools/i1-shot/index.html"


def port_is_free(port: int) -> bool:
    """Connect, never bind. A successful connect proves somebody is there; on
    this box an unbound loopback port TIMES OUT rather than refusing, so the
    timeout is treated as free only after it elapses.

    ⛔ BOTH FAMILIES. Vite's default host binds `[::1]` only, so an IPv4-only
    check called a busy port free, the bind then failed, and the failure looked
    like "the server never started" rather than "somebody is already there".
    That is the ambiguity CLAUDE.md's port rule is about, met head-on."""
    for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        with socket.socket(family, socket.SOCK_STREAM) as s:
            s.settimeout(1.0)
            try:
                s.connect((host, port))
            except (ConnectionRefusedError, socket.timeout, OSError):
                continue
            return False
    return True


def kill_tree(proc: subprocess.Popen) -> None:
    """`terminate()` on Windows kills the launcher, not the node process it
    spawned — the orphan then holds the port into the next run. Kill the tree."""
    if proc.poll() is not None:
        return
    subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def wait_for_marker(url: str, timeout_s: int = 90) -> None:
    deadline = time.time() + timeout_s
    last = ""
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                html = r.read().decode("utf-8", "replace")
            if MARKER in html:
                return
            last = f"served HTML has no harness marker (first 200 chars: {html[:200]!r})"
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last = f"{type(exc).__name__}: {exc}"
        time.sleep(1)
    raise SystemExit(f"i1_askai_shots: never saw this harness on {url} — {last}")


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright is not importable — `pip install playwright`", file=sys.stderr)
        return 2

    if not port_is_free(PORT):
        print(
            f"port {PORT} already has a listener. This script never kills another "
            f"process. Find the owner:  netstat -ano | findstr :{PORT}",
            file=sys.stderr,
        )
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        print("npx did not resolve — `shutil.which`, never shell=True", file=sys.stderr)
        return 2
    server = subprocess.Popen(
        [npx, "vite", "--host", "127.0.0.1", "--port", str(PORT), "--strictPort"],
        cwd=APP,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        wait_for_marker(BASE)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 900, "height": 1000},
                                    device_scale_factor=2)
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            for variant in ("before", "after"):
                page.goto(f"{BASE}?v={variant}", wait_until="networkidle")
                page.fill('[data-testid="ask-ai-input"]',
                          "What changed in analyst sentiment or ratings?")
                page.click('button:has-text("Ask")')
                page.wait_for_selector('[data-testid="ask-ai-answer"]', timeout=10_000)
                # The Sources block is the whole point — refuse to save a shot
                # that does not contain one.
                page.wait_for_selector("text=Sources", timeout=5_000)
                out = OUT_DIR / f"askai-sources-{variant}.png"
                page.locator(".shotFrame").screenshot(path=str(out))
                print(f"wrote {out.relative_to(ROOT)}")
            browser.close()
            if errors:
                print("page errors during capture:\n  " + "\n  ".join(errors),
                      file=sys.stderr)
                return 1
    finally:
        kill_tree(server)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Render the Data Charts V2 design mock (docs/breadth/mock/index.html) to PNGs.

The mock draws SYNTHETIC series only (this repository is public; breadth history is paid data —
docs/breadth/DECISIONS.md D-018), so its renders are safe to commit.

⛔ No local HTTP server and no port. Playwright answers every request to the fake origin
`https://mock.local/` from the repository's own files, so the page can load the app's real
`tokens.css`, the self-hosted Instrument Sans faces and the installed ECharts build without
binding anything (CLAUDE.md: a port assignment is not a server identity).

Usage:
    python docs/breadth/mock/render_mock.py
Exit 1 if the page logged a console error or threw, 0 otherwise.
"""
from __future__ import annotations

import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[3]
HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "renders"
ORIGIN = "https://mock.local"
BOARDS = ("board-desktop", "board-phone", "board-light", "board-sheets", "board-states")


def main() -> int:
    from playwright.sync_api import sync_playwright

    OUT.mkdir(exist_ok=True)
    errors: list[str] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1760, "height": 1200}, device_scale_factor=1)

        def serve(route):
            rel = route.request.url.split(ORIGIN, 1)[1].split("?", 1)[0].lstrip("/")
            path = (REPO / rel).resolve()
            if REPO not in path.parents or not path.is_file():
                return route.fulfill(status=404, body="not found: " + rel)
            return route.fulfill(path=str(path))

        ctx.route(ORIGIN + "/**", serve)
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(ORIGIN + "/docs/breadth/mock/index.html", wait_until="load")
        page.wait_for_function("window.__mockReady === true", timeout=30000)
        page.wait_for_timeout(600)
        for board in BOARDS:
            page.locator("#" + board).screenshot(path=str(OUT / f"{board}.png"))
            print("rendered", board)
        browser.close()
    if errors:
        print("console errors:")
        for e in errors:
            print("  ", e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

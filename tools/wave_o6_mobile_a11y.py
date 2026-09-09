"""Wave O6 §24 — the review-recall surface on a phone, and to assistive tech.

BOUNDED. O6 added exactly two things a member touches: a fourth section in
search results, and the landing mark on a review inside its history. This
measures those, and nothing Wave O already certifies.

⛔⛔ GEOMETRY ALONE IS INSUFFICIENT (the permanent Wave L doctrine). A control
can measure 44x44 and still be unreachable because something is painted over
it, and `getBoundingClientRect` cannot see that. Every control here is
hit-tested with `elementFromPoint` at its own centre and must return ITSELF.

⛔ A SEARCH RESULT IS A TAP TARGET, and this one is new. Wave N's audit found an
entire evidence flow shipped at 28-38px against the app's own 44px tier; a
result row added in a later wave gets the same measurement rather than the
benefit of the doubt.

⛔ AND THE MARK MUST BE MORE THAN A COLOUR. A member sent to one row among a
dozen dated rows that look alike needs to know which one — and a screen-reader
user needs it most, having just been moved without seeing the jump. The mark is
`aria-current`, and the landing is announced in the review panel's live region.

    python tools/local_backend_sandbox.py --port 8077
    python tools/wave_o6_mobile_a11y.py --base http://127.0.0.1:8077
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import uuid

OUT_DIR = pathlib.Path(__file__).parent / "wave_o6_mobile_out"
PHONE = {"width": 390, "height": 844}
TAP_MIN = 44

TOKEN = "zq" + uuid.uuid4().hex[:8]
MARK = f"basalt{TOKEN}"
REVIEW_NOTE = f"{MARK}: I changed my mind about the pricing power here."

# ⭐ Scroll and measure in ONE JS turn: `getBoundingClientRect` and
# `elementFromPoint` must agree about the viewport, and they stop agreeing if
# anything moves the page between them.
PROBE_JS = """
(el) => {
  el.scrollIntoView({block: 'center', inline: 'nearest'});
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  const reaches = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  const cs = getComputedStyle(el);
  return {
    w: Math.round(r.width), h: Math.round(r.height),
    reaches,
    hitTag: hit ? (hit.tagName + (hit.className ? '.' + String(hit.className).slice(0, 40) : '')) : null,
    display: cs.display, visibility: cs.visibility,
  };
}
"""

# The landing, as assistive tech would receive it.
ANCHOR_JS = """
() => {
  const row = document.querySelector('li[aria-current="true"]');
  const live = document.querySelector('[role=status][aria-label="Review status"]');
  const marked = document.querySelectorAll('li[aria-current="true"]');
  return {
    marked: marked.length,
    text: row ? (row.textContent || '').trim().slice(0, 160) : null,
    announced: live ? (live.textContent || '').trim() : null,
    // ⛔ NOT A COLOUR ALONE. A border is what survives forced-colors mode; a
    // background wash is the thing that silently disappears there.
    border: row ? getComputedStyle(row).borderLeftWidth : null,
  };
}
"""

# ⛔ THE PAGE MUST NOT SCROLL SIDEWAYS. A new section in a fixed-width sidebar
# is exactly where an over-long unbroken snippet escapes its container.
OVERFLOW_JS = """
() => ({
  docWidth: document.documentElement.scrollWidth,
  viewWidth: window.innerWidth,
})
"""


class Findings:
    def __init__(self) -> None:
        self.items: list[str] = []
        self.controls: dict[str, dict] = {}
        self.notes: dict[str, object] = {}

    def fail(self, section: str, msg: str) -> None:
        self.items.append(f"{section}: {msg}")

    def check(self, section: str, cond: bool, msg: str) -> bool:
        if not cond:
            self.fail(section, msg)
        return bool(cond)


def probe(F: Findings, locator, label: str, *, section: str = "44") -> dict | None:
    if locator.count() == 0:
        F.fail(section, f"{label}: not present at all")
        return None
    info = locator.first.evaluate(PROBE_JS)
    F.controls[label] = info
    if info["display"] == "none" or info["visibility"] == "hidden":
        F.fail(section, f"{label}: not visible")
        return info
    F.check(section, info["reaches"],
            f"{label}: the tap lands on {info['hitTag']} instead — occluded")
    F.check(section, info["h"] >= TAP_MIN,
            f"{label}: {info['w']}x{info['h']} — under the {TAP_MIN}px touch tier")
    return info


def _dismiss_intro(page) -> None:
    for _ in range(20):
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
        if page.locator('[class*="revealScene"]').count() == 0:
            break
    page.wait_for_timeout(400)


def _wait_for(fn, tries: int = 40, page=None) -> bool:
    for _ in range(tries):
        if fn():
            return True
        if page is not None:
            page.wait_for_timeout(500)
    return False


def main() -> int:  # noqa: C901
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8077")
    ap.add_argument("--email", default="mobtest@local.dev")
    ap.add_argument("--password", default="LocalTest2026!")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    OUT_DIR.mkdir(exist_ok=True)
    F = Findings()
    base = args.base

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        # ⛔ A REAL PHONE CONTEXT. `is_mobile` + `has_touch` change hit-testing
        # and the app's own coarse-pointer branches; a narrow desktop window
        # measures neither.
        ctx = browser.new_context(viewport=PHONE, is_mobile=True, has_touch=True)
        if not ctx.request.post(f"{base}/api/auth/login",
                                data={"email": args.email,
                                      "password": args.password}).ok:
            print("login failed — start the sandbox first", file=sys.stderr)
            return 2

        made = ctx.request.post(f"{base}/api/j2/notes", data={
            "title": f"NVDA thesis {TOKEN}", "ticker": "NVDA", "tags": ["thesis"],
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}}).json()
        note_id = (made.get("note") or made)["id"]
        cap = ctx.request.post(f"{base}/api/j2/capture", data={
            "tier": "passage", "url": f"https://www.reuters.com/{uuid.uuid4().hex[:8]}",
            "title": "Reuters: NVDA margins", "passage": f"Margins {TOKEN}.",
            "annotation": "my read", "noteId": note_id}).json()
        ctx.request.post(f"{base}/api/j2/notes/{note_id}/evidence", data={
            "targetType": "document_excerpt", "targetId": cap.get("excerptId"),
            "stance": "supports"})
        rid = ctx.request.post(f"{base}/api/j2/notes/{note_id}/reviews",
                               data={}).json()["review"]["id"]
        ctx.request.post(f"{base}/api/j2/reviews/{rid}/complete", data={
            "outcome": "revised", "memberNote": REVIEW_NOTE})

        page = ctx.new_page()

        # ── §24a · THE SEARCH RESULT, ON A PHONE ─────────────────────────────
        page.goto(f"{base}/journal/notebook", wait_until="networkidle")
        _dismiss_intro(page)
        search_btn = page.get_by_label("Search notes")
        if F.check("44", search_btn.count() > 0, "no search control on a phone"):
            probe(F, search_btn, "Search notes")
            search_btn.first.click()
        box = page.get_by_placeholder(re.compile("search notes", re.I))
        if not F.check("44", box.count() > 0, "the search field never appeared"):
            return _finish(F, browser, page)
        box.first.fill(MARK)
        page.wait_for_timeout(500)
        _wait_for(lambda: "Searching" not in page.locator("body").inner_text(),
                  page=page)

        row = page.locator("button", has_text=re.compile("Thesis review", re.I))
        if F.check("44", row.count() > 0,
                   "the review result did not render on a phone"):
            probe(F, row, "Thesis review result row")
        page.screenshot(path=str(OUT_DIR / "o6m_01_search.png"))

        ov = page.evaluate(OVERFLOW_JS)
        F.notes["overflow"] = ov
        F.check("24", ov["docWidth"] <= ov["viewWidth"] + 1,
                f"the page scrolls sideways at {PHONE['width']}px: {ov!r}")

        # ── §24b · THE LANDING, AND WHAT ASSISTIVE TECH IS TOLD ──────────────
        if row.count():
            row.first.click()
            consumed = _wait_for(lambda: "review=" not in page.url, page=page)
            F.notes["url"] = page.url
            F.check("45", consumed,
                    "the review anchor never reached the review panel on a phone")
            anchor = page.evaluate(ANCHOR_JS)
            F.notes["anchor"] = anchor
            F.check("45", anchor and anchor["marked"] == 1,
                    f"exactly one row must be marked as the landing: {anchor!r}")
            if anchor and anchor["text"]:
                F.check("45", MARK in anchor["text"],
                        f"the marked row is not the review that was tapped: "
                        f"{anchor['text']!r}")
            F.check("45", bool(anchor and anchor["announced"]
                               and "review" in anchor["announced"].lower()),
                    f"the landing was not announced: {anchor!r}")
            # ⛔ A BORDER, NOT ONLY A COLOUR — forced-colors mode drops washes.
            F.check("45", bool(anchor and anchor["border"]
                               and anchor["border"] != "0px"),
                    f"the mark is colour-only and will vanish in forced colors: "
                    f"{anchor!r}")
            page.screenshot(path=str(OUT_DIR / "o6m_02_landed.png"))

            ov2 = page.evaluate(OVERFLOW_JS)
            F.notes["overflow_after"] = ov2
            F.check("24", ov2["docWidth"] <= ov2["viewWidth"] + 1,
                    f"the thesis page scrolls sideways after landing: {ov2!r}")

        return _finish(F, browser, page)


def _finish(F: Findings, browser, page=None) -> int:
    if page is not None:
        try:
            page.screenshot(path=str(OUT_DIR / "o6m_99_final.png"))
        except Exception:  # noqa: BLE001
            pass
    browser.close()
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "report.json").write_text(
        json.dumps({"token": TOKEN, "findings": F.items,
                    "controls": F.controls, "notes": F.notes},
                   indent=2, ensure_ascii=False), encoding="utf-8")
    if F.items:
        print("FINDINGS:")
        for it in F.items:
            print(f"  [X] {it}")
        return 1
    print("Wave O6 phone + assistive-tech pass: every measurement green")
    return 0


if __name__ == "__main__":
    sys.exit(main())

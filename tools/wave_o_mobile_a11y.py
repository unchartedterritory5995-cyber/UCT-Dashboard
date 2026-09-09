"""Wave O §44/§45 — the REVIEW flow on a phone, and to assistive tech.

⛔⛔ GEOMETRY ALONE IS INSUFFICIENT (the permanent Wave L doctrine). A control
can measure 44x44 and still be unreachable because something is painted over it,
and `getBoundingClientRect` cannot see that. Every control here is hit-tested
with `elementFromPoint` at its own centre and must return ITSELF.

⛔ THE PANEL IS OPEN FOR EVERY MEASUREMENT. A review flow certified in its
collapsed state proves nothing about the controls a member has to hit — the
outcome buttons, the date field and Complete only exist once it is open.

⭐ THE TOUCH TIER WAS WRITTEN INTO THIS COMPONENT'S FIRST COMMIT rather than
retrofitted: Wave N's audit found the entire evidence flow at 28-38px against
the app's own 44px tier. This is the measurement that says whether writing it up
front actually worked.

⛔ AND THE HARNESS MUST REPORT ON RED. stdout is UTF-8 before anything can quote
a page — Wave N's equivalent crashed while printing its own findings.

    python tools/local_backend_sandbox.py --port 8077
    python tools/wave_o_mobile_a11y.py --base http://127.0.0.1:8077
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import uuid

OUT_DIR = pathlib.Path(__file__).parent / "wave_o_mobile_out"
PHONE = {"width": 390, "height": 844}
TAP_MIN = 44

TOKEN = "zq" + uuid.uuid4().hex[:8]
MINE = "I think management is too optimistic."
SOURCE_TITLE = "Reuters: NVDA margins"

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
    inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
    reaches,
    hitTag: hit ? (hit.tagName + (hit.className ? '.' + String(hit.className).slice(0, 40) : '')) : null,
    display: cs.display, visibility: cs.visibility,
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
  };
}
"""

A11Y_JS = """
() => {
  const panel = document.querySelector('[aria-label="Thesis review"]');
  if (!panel) return null;
  const radios = Array.from(panel.querySelectorAll('[role=radio]'));
  const group = panel.querySelector('[role=radiogroup]');
  const groupLabelId = group && group.getAttribute('aria-labelledby');
  const groupLabelEl = groupLabelId ? document.getElementById(groupLabelId) : null;
  const date = panel.querySelector('input[type=date]');
  const dateLabel = date && date.id
    ? document.querySelector('label[for="' + date.id + '"]') : null;
  const ta = panel.querySelector('textarea');
  const taLabel = ta && ta.id
    ? document.querySelector('label[for="' + ta.id + '"]') : null;
  return {
    panelName: panel.getAttribute('aria-label'),
    radioCount: radios.length,
    radioLabels: radios.map(r => (r.textContent || '').trim()),
    radiosExposeState: radios.every(r => r.getAttribute('aria-checked') !== null),
    groupLabel: groupLabelEl ? (groupLabelEl.textContent || '').trim() : null,
    dateLabelled: !!(dateLabel && dateLabel.textContent.trim()),
    noteLabelled: !!(taLabel && taLabel.textContent.trim()),
    keyboardReachable: radios.every(r => r.tabIndex >= 0 && !r.disabled),
  };
}
"""

AFTER_JS = """
() => {
  const live = document.querySelector('[role=status][aria-label="Review status"]');
  const act = document.activeElement;
  return {
    live: live ? live.textContent.trim() : null,
    focus: act ? act.tagName + ':' + (act.textContent || '').trim().slice(0, 24) : null,
  };
}
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
    if not info["disabled"]:
        F.check(section, info["h"] >= TAP_MIN,
                f"{label}: {info['w']}x{info['h']} — under the {TAP_MIN}px touch tier")
    return info


def _dismiss_intro(page) -> None:
    """The cinematic intro plays ~9.3s on every load and covers the app. A hit
    test run under it measures the intro, not the product."""
    for _ in range(20):
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
        if page.locator('[class*="revealScene"]').count() == 0:
            break
    page.wait_for_timeout(400)


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
        # A COARSE POINTER, not merely a narrow window.
        ctx = browser.new_context(viewport=PHONE, is_mobile=True,
                                  has_touch=True, device_scale_factor=2)
        if not ctx.request.post(f"{base}/api/auth/login",
                                data={"email": args.email,
                                      "password": args.password}).ok:
            print("login failed", file=sys.stderr)
            return 2

        made = ctx.request.post(f"{base}/api/j2/notes", data={
            "title": f"NVDA thesis {TOKEN}", "ticker": "NVDA", "tags": ["thesis"],
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}}).json()
        note_id = (made.get("note") or made)["id"]
        for stance, text in (("supports", f"Supporting {TOKEN}."),
                             ("opposes", f"Opposing {TOKEN}.")):
            cap = ctx.request.post(f"{base}/api/j2/capture", data={
                "tier": "passage",
                "url": f"https://www.reuters.com/{uuid.uuid4().hex[:8]}",
                "title": SOURCE_TITLE, "passage": text, "annotation": MINE,
                "noteId": note_id, "ticker": "NVDA"}).json()
            ctx.request.post(f"{base}/api/j2/notes/{note_id}/evidence", data={
                "targetType": "document_excerpt", "targetId": cap.get("excerptId"),
                "stance": stance})

        page = ctx.new_page()
        page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="networkidle")
        _dismiss_intro(page)

        trigger = page.get_by_role("button", name="Review thesis")
        if probe(F, trigger, "review trigger") is None:
            return _finish(F, browser, page)
        trigger.first.click()
        page.wait_for_timeout(700)

        probe(F, page.get_by_role("radio", name="No change"), "outcome: No change")
        probe(F, page.get_by_role("radio", name="Revised"), "outcome: Revised")
        probe(F, page.get_by_role("radio", name="Invalidated"), "outcome: Invalidated")
        probe(F, page.get_by_label("Your assessment"), "member note field")
        probe(F, page.locator('input[type="date"]').first, "next review date")
        probe(F, page.locator("button", has_text="Complete review").last,
              "complete (disabled)")
        page.screenshot(path=str(OUT_DIR / "r01_panel.png"), full_page=True)

        overflow = page.evaluate(
            "() => ({doc: document.documentElement.scrollWidth,"
            " win: window.innerWidth})")
        F.notes["overflow"] = overflow
        F.check("44", overflow["doc"] <= overflow["win"] + 1,
                f"the review panel makes the page scroll horizontally: {overflow}")

        a11y = page.evaluate(A11Y_JS)
        F.notes["a11y"] = a11y
        if F.check("45", a11y is not None, "the review panel is not addressable"):
            F.check("45", bool(a11y["panelName"]), "the review panel is unnamed")
            F.check("45", a11y["radioCount"] == 4,
                    f"expected 4 outcome controls, found {a11y['radioCount']}")
            # ⛔ NEVER COLOUR ALONE (§45): each outcome carries its own word and
            # exposes its state, rather than only being painted.
            F.check("45", all(x for x in a11y["radioLabels"]),
                    "an outcome control has no text — colour would be the only cue")
            F.check("45", a11y["radiosExposeState"],
                    "outcome selection is not exposed via aria-checked")
            F.check("45", bool(a11y["groupLabel"]),
                    "the outcome group has no accessible name")
            F.check("45", a11y["dateLabelled"],
                    "the next-review date input is unlabelled")
            F.check("45", a11y["noteLabelled"], "the member note field is unlabelled")
            F.check("45", a11y["keyboardReachable"],
                    "the outcome controls are not keyboard reachable")

        page.get_by_label("Your assessment").fill(f"Phone review {TOKEN}.")
        page.get_by_role("radio", name="No change").click()
        probe(F, page.locator("button", has_text="Complete review").last,
              "complete (enabled)")
        page.locator("button", has_text="Complete review").last.click()

        # ⛔ WAIT ON THE WRITE, never a stopwatch — Wave N's mobile harness
        # reported three defects at once by reading the page mid-write.
        landed = False
        for _ in range(40):
            r = ctx.request.get(f"{base}/api/j2/notes/{note_id}/reviews")
            try:
                if r.ok and any(x["status"] == "completed" for x in r.json()["reviews"]):
                    landed = True
                    break
            except Exception:  # noqa: BLE001
                pass
            page.wait_for_timeout(500)
        F.check("44", landed, "the review never completed on the phone")
        page.wait_for_timeout(700)

        after = page.evaluate(AFTER_JS)
        F.notes["after_complete"] = after
        F.check("45", bool(after["live"]),
                "completing a review is announced to nobody")
        F.check("45", (after["focus"] or "").upper().startswith("BUTTON"),
                f"focus was dropped after the review closed: {after['focus']!r}")
        page.screenshot(path=str(OUT_DIR / "r02_completed.png"), full_page=True)

        hist = page.get_by_text("Review history", exact=False)
        if F.check("44", hist.count() > 0, "no review history on the phone"):
            hist.first.click()
            page.wait_for_timeout(500)
            htext = page.locator("body").inner_text()
            F.check("44", f"Phone review {TOKEN}" in htext,
                    "the completed review is not readable in the phone history")
        page.screenshot(path=str(OUT_DIR / "r03_history.png"), full_page=True)

        return _finish(F, browser, page)


def _finish(F: Findings, browser, page=None) -> int:
    if page is not None:
        try:
            page.screenshot(path=str(OUT_DIR / "r99_final.png"), full_page=True)
        except Exception:  # noqa: BLE001
            pass
    browser.close()
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "report.json").write_text(json.dumps(
        {"findings": F.items, "controls": F.controls, "notes": F.notes},
        indent=2, ensure_ascii=False), encoding="utf-8")
    for label, info in F.controls.items():
        print(f"  {label:<26} {info['w']:>4}x{info['h']:<4} "
              f"reaches={info['reaches']} vp={info['inViewport']}")
    if F.items:
        print("FINDINGS:")
        for it in F.items:
            print(f"  [X] {it}")
        return 1
    print("Wave O mobile + accessibility: no findings")
    return 0


if __name__ == "__main__":
    sys.exit(main())

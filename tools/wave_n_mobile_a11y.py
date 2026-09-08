"""Wave N §13/§14 — the evidence flow on a phone, and to assistive tech.

⛔⛔ THE PERMANENT WAVE L DOCTRINE: GEOMETRY ALONE IS INSUFFICIENT. A control
can measure 44x44 and still be unreachable because something is painted on top
of it, and `getBoundingClientRect` cannot see that. Every control here is
hit-tested with `elementFromPoint` at its own centre and must return ITSELF (or
a descendant) — the same probe that caught the occluded control in Wave L.

⛔ AND §13 IS EXPLICIT: DO NOT CERTIFY A CLOSED PICKER. Everything below runs
with the picker OPEN, a real captured passage in it, on a 390x844 viewport.

    python tools/local_backend_sandbox.py --port 8077
    python tools/wave_n_mobile_a11y.py --base http://127.0.0.1:8077

Exits non-zero on any finding. Writes tools/wave_n_mobile_out/report.json plus
a screenshot per state.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import uuid

OUT_DIR = pathlib.Path(__file__).parent / "wave_n_mobile_out"
PHONE = {"width": 390, "height": 844}
TAP_MIN = 44

TOKEN = "zq" + uuid.uuid4().hex[:8]
SOURCE = f"Gross margin {TOKEN} normalizes toward the mid-70s next year."
MINE = "I think management is too optimistic."
SOURCE_TITLE = "Reuters: NVDA margins"

# ⭐ THE HIT TEST. Returns what the member's finger would ACTUALLY reach at the
# centre of this element, plus the box — so a finding can say "occluded by X"
# rather than "smaller than 44px", which are different defects with different
# fixes.
PROBE_JS = """
(el) => {
  // ⛔⛔ SCROLL AND MEASURE IN ONE JS TURN. `getBoundingClientRect` and
  // `elementFromPoint` must agree about the viewport, and they stop agreeing
  // if anything moves the page between them. This harness's first two runs
  // reported "occluded — the tap lands on DIV" for the caption field and the
  // attach button; `elementsFromPoint` at the same coordinates returned the
  // BUTTON ITSELF at the top of the stack. What differed was a full-page
  // screenshot taken earlier in the run, which resizes and scrolls the page
  // under mobile emulation. Doing the scroll here, immediately before the two
  // reads, removes every gap an outside step could sit in.
  el.scrollIntoView({block: 'center', inline: 'nearest'});
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  const reaches = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  const cs = getComputedStyle(el);
  return {
    w: Math.round(r.width), h: Math.round(r.height),
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
    reaches,
    hitTag: hit ? (hit.tagName + (hit.className ? '.' + String(hit.className).slice(0, 40) : '')) : null,
    display: cs.display, visibility: cs.visibility,
    name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 40),
    role: el.getAttribute('role') || el.tagName.toLowerCase(),
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
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


def probe(F: Findings, page, locator, label: str, *, tap: bool = True,
          section: str = "13") -> dict | None:
    if locator.count() == 0:
        F.fail(section, f"{label}: not present at all")
        return None
    # ⛔ The scroll happens INSIDE PROBE_JS, next to the two reads — see the
    # comment there. `elementFromPoint` answers about the VIEWPORT, so a
    # control below the fold returns null and reads as "occluded"; an
    # instrument that cannot tell "off-screen" from "covered" invents the more
    # alarming of the two.
    info = locator.first.evaluate(PROBE_JS)
    F.controls[label] = info
    if info["display"] == "none" or info["visibility"] == "hidden":
        F.fail(section, f"{label}: not visible")
        return info
    # ⛔ OCCLUSION FIRST. A 44px control under an overlay is not a tap target,
    # and only the hit test can tell you.
    F.check(section, info["reaches"],
            f"{label}: the tap lands on {info['hitTag']} instead — occluded")
    if tap and not info["disabled"]:
        F.check(section, info["h"] >= TAP_MIN,
                f"{label}: {info['w']}x{info['h']} — under the {TAP_MIN}px touch tier")
    return info


def _dismiss_intro(page) -> None:
    """⛔ THE CINEMATIC INTRO PLAYS ON EVERY PAGE LOAD (~9.3s) and covers the
    whole app while it does. The first runs of this harness probed 800ms after
    load and reported "the Add evidence trigger is occluded by
    DIV._revealScene_" — true, and about the intro, not about the picker.
    A hit test is only as honest as the state it runs in: a member does not
    tap during the intro either, and certifying the flow means certifying the
    screen they actually use. Escape is the intro's own documented skip.
    """
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    for _ in range(20):
        if page.locator('[class*="revealScene"], [class*="overlay"][role="dialog"]').count() == 0:
            break
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
    page.wait_for_timeout(500)


def main() -> int:  # noqa: C901
    # ⛔ THE REPORT MUST SURVIVE THE FAILURE PATH. A finding can quote page
    # text, and page text contains glyphs cp1252 cannot encode (a ⌘ in the
    # site search hint crashed this harness while PRINTING its own findings —
    # the diagnostic worked on every green run and died on the red one, which
    # is the only run that matters).
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
        # ⛔ A COARSE POINTER, not merely a small window. `pointer: fine` on a
        # 390px viewport is a desktop browser pretending, and the app branches
        # on `useIsTouch` in places (`lesson_pointer_fine_does_not_mean_desktop`).
        ctx = browser.new_context(viewport=PHONE, is_mobile=True,
                                  has_touch=True, device_scale_factor=2)
        r = ctx.request.post(f"{base}/api/auth/login",
                             data={"email": args.email, "password": args.password})
        if not r.ok:
            print(f"login failed ({r.status})", file=sys.stderr)
            return 2

        made = ctx.request.post(f"{base}/api/j2/notes", data={
            "title": f"NVDA thesis {TOKEN}", "ticker": "NVDA", "tags": ["thesis"],
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}}).json()
        note_id = (made.get("note") or made)["id"]
        ctx.request.post(f"{base}/api/j2/capture", data={
            "tier": "passage", "url": "https://www.reuters.com/markets/nvda",
            "title": SOURCE_TITLE, "passage": SOURCE, "annotation": MINE,
            "noteId": note_id, "ticker": "NVDA"})

        page = ctx.new_page()
        page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="networkidle")
        _dismiss_intro(page)

        # ── §13 · THE TRIGGER ────────────────────────────────────────────────
        trigger = page.get_by_role("button", name="Add evidence")
        info = probe(F, page, trigger, "add evidence trigger")
        if info is None:
            return _finish(F, browser, page)
        trigger.first.scroll_into_view_if_needed()
        page.wait_for_timeout(200)
        page.screenshot(path=str(OUT_DIR / "m01_trigger.png"))
        trigger.first.click()
        page.wait_for_timeout(400)

        # ── §13 · THE OPEN PICKER ────────────────────────────────────────────
        page.get_by_role("button", name="Document excerpt").first.scroll_into_view_if_needed()
        page.get_by_role("button", name="Document excerpt").first.click()
        page.wait_for_timeout(500)
        # ⛔ Screenshots AFTER the probes for this state: a full-page capture
        # moves the page under mobile emulation (see PROBE_JS).

        probe(F, page, page.get_by_role("button", name="Supports"), "stance: Supports")
        probe(F, page, page.get_by_role("button", name="Opposes"), "stance: Opposes")
        probe(F, page, page.get_by_role("button", name="Note", exact=True), "type: Note")
        probe(F, page, page.get_by_role("button", name="Document excerpt"),
              "type: Document excerpt")

        row = page.locator('li button:has-text("Your note:")')
        row_info = probe(F, page, row, "candidate row")
        if row_info:
            # ⛔ THE PREVIEW MUST BE READABLE, not clipped to a sliver. A row
            # whose passage is one line high on a phone is a list of titles.
            F.check("13", row_info["h"] >= 60,
                    f"candidate row is {row_info['h']}px — the passage preview "
                    "cannot be readable")

        caption = page.get_by_placeholder("Why this matters (optional)")
        probe(F, page, caption, "caption field")

        submit = page.locator("button", has_text="Add evidence").last
        sub_info = probe(F, page, submit, "attach button")
        page.screenshot(path=str(OUT_DIR / "m02_picker_open.png"), full_page=True)
        if sub_info:
            # §13: "visible primary action". Not merely present in the DOM.
            F.check("13", sub_info["inViewport"] or sub_info["top"] < PHONE["height"],
                    "the attach button is off-screen when the picker opens")

        # ⛔ NO HORIZONTAL OVERFLOW. The #1 objective mobile bug.
        overflow = page.evaluate(
            "() => ({doc: document.documentElement.scrollWidth,"
            " win: window.innerWidth})")
        F.notes["overflow"] = overflow
        F.check("13", overflow["doc"] <= overflow["win"] + 1,
                f"the page scrolls horizontally: {overflow}")

        # ── §14 · ACCESSIBILITY, ON THE OPEN PICKER ──────────────────────────
        groups = page.evaluate("""
        () => Array.from(document.querySelectorAll('[role=group]')).map(g => ({
          name: g.getAttribute('aria-label'),
          buttons: Array.from(g.querySelectorAll('button')).map(b => b.textContent.trim()),
        }))
        """)
        F.notes["groups"] = groups
        stance_group = [g for g in groups if (g["name"] or "").lower().find("stance") >= 0]
        F.check("14", bool(stance_group),
                "the stance selector has no accessible name")
        if stance_group:
            F.check("14", all(t for t in stance_group[0]["buttons"]),
                    "a stance option has no text — colour alone would be the only cue")

        # The candidate must be reachable by keyboard, and say what it is.
        kb = page.evaluate("""
        () => {
          const btns = Array.from(document.querySelectorAll('li button'));
          const cand = btns.find(b => /Your note:/.test(b.textContent));
          if (!cand) return null;
          return {
            tabbable: cand.tabIndex >= 0 && !cand.disabled,
            text: cand.textContent.trim().slice(0, 200),
            hasSeparateSpans: cand.querySelectorAll('span').length >= 2,
          };
        }
        """)
        F.notes["candidate_a11y"] = kb
        if F.check("14", kb is not None, "no candidate to check for keyboard reach"):
            F.check("14", kb["tabbable"], "the candidate is not keyboard reachable")
            # §14: source vs annotation understandable non-visually.
            F.check("14", "Your note:" in kb["text"],
                    "assistive tech cannot tell the member's note from the quote")

        # Attach, then check the already-attached state is conveyed in WORDS.
        row.first.click()
        page.wait_for_timeout(200)
        page.get_by_role("button", name="Opposes").first.click()
        # ⛔ RE-PROBE THE PRIMARY ACTION NOW THAT IT IS ENABLED. Measuring a
        # disabled button and calling the flow certified would skip the one
        # control the member has to hit to finish.
        probe(F, page, page.locator("button", has_text="Add evidence").last,
              "attach button (enabled)")
        page.screenshot(path=str(OUT_DIR / "m03_before_attach.png"), full_page=True)
        submit.click()
        # ⛔ WAIT FOR THE EDGE, NOT A STOPWATCH. A fixed 1.5s read the page
        # mid-write and reported three defects at once — no announcement, focus
        # on <body>, no attached row — all of which were the attach still being
        # in flight.
        for _ in range(40):
            r2 = ctx.request.get(f"{base}/api/j2/notes/{note_id}/thesis-summary")
            try:
                if r2.ok and (r2.json().get("evidence") or []):
                    break
            except Exception:  # noqa: BLE001
                pass
            page.wait_for_timeout(500)
        page.wait_for_timeout(700)
        # ⛔ §14 — WAS IT ANNOUNCED, AND WHERE DID FOCUS GO? On success the
        # picker unmounts and a row appears elsewhere on the page: a sighted
        # member sees it, and assistive tech is told nothing unless a live
        # region says so.
        after = page.evaluate("""
        () => {
          const live = document.querySelector('[role=status][aria-live]');
          const act = document.activeElement;
          return {live: live ? live.textContent.trim() : null,
                  focus: act ? (act.tagName + ':' + (act.textContent || '').trim().slice(0, 24)) : null};
        }
        """)
        F.notes["after_attach"] = after
        F.check("14", bool(after["live"]),
                "attaching evidence is announced to nobody")
        F.check("14", (after["focus"] or "").upper().startswith("BUTTON"),
                f"focus was dropped after the picker closed: {after['focus']!r}")
        page.screenshot(path=str(OUT_DIR / "m04_attached.png"), full_page=True)

        page.get_by_role("button", name="Add evidence").first.click()
        page.get_by_role("button", name="Document excerpt").first.click()
        page.wait_for_timeout(500)
        again = page.evaluate("""
        () => {
          const btns = Array.from(document.querySelectorAll('li button'));
          const cand = btns.find(b => /Your note:/.test(b.textContent));
          if (!cand) return null;
          return {text: cand.textContent, disabled: cand.disabled,
                  ariaDisabled: cand.getAttribute('aria-disabled')};
        }
        """)
        F.notes["already_attached"] = again
        if F.check("14", again is not None,
                   "the attached candidate is gone from the picker on mobile"):
            F.check("14", "already attached" in again["text"].lower(),
                    "the already-attached state is not conveyed in words")
            F.check("14", again["disabled"] or again["ariaDisabled"] == "true",
                    "the already-attached candidate is still actionable")
        page.screenshot(path=str(OUT_DIR / "m05_already_attached.png"), full_page=True)

        # ── §13 · THE REVISIT SHEET ON A PHONE ───────────────────────────────
        page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="networkidle")
        _dismiss_intro(page)
        link = page.locator("li button", has_text=SOURCE_TITLE)
        if F.check("13", link.count() > 0, "the attached evidence row is not on screen"):
            # ⛔ A CITATION THAT CITES NOTHING. `nowrap` + ellipsis is right on a
            # wide row; at 390px it cut "Captured passage · Reuters: NVDA
            # margins (reuters.com)" to "Captured passage · …". The row is
            # truthful and unreadable, which on the thesis surface is the same
            # failure as being wrong.
            shown = page.evaluate("""
            () => {
              const b = Array.from(document.querySelectorAll('li button'))
                .find(x => /Captured passage/.test(x.textContent));
              if (!b) return null;
              const r = b.getBoundingClientRect();
              return {text: b.textContent.trim(),
                      rendered: b.offsetWidth < b.scrollWidth ? 'clipped' : 'whole',
                      h: Math.round(r.height)};
            }
            """)
            F.notes["attached_row"] = shown
            if shown:
                F.check("13", shown["rendered"] == "whole",
                        f"the thesis row is clipped on a phone: {shown!r}")
                F.check("13", "reuters.com" in shown["text"],
                        "the phone thesis row does not name its source")
            link.first.scroll_into_view_if_needed()
            link.first.click()
            page.wait_for_timeout(900)
            page.screenshot(path=str(OUT_DIR / "m06_revisit_sheet.png"), full_page=True)
            sheet = page.get_by_role("dialog")
            if F.check("13", sheet.count() > 0, "the captured-source sheet did not open"):
                probe(F, page, sheet.get_by_role("button", name="Close captured source"),
                      "sheet close button")
                st = sheet.first.inner_text()
                F.check("13", TOKEN in st and MINE in st,
                        "the phone sheet lost the passage or the member's note")
                ov2 = page.evaluate(
                    "() => ({doc: document.documentElement.scrollWidth,"
                    " win: window.innerWidth})")
                F.check("13", ov2["doc"] <= ov2["win"] + 1,
                        f"the sheet makes the page scroll horizontally: {ov2}")
                # §14 — focus must go somewhere useful, and Escape must close.
                focused = page.evaluate(
                    "() => document.activeElement && document.activeElement.tagName")
                F.notes["focus_on_open"] = focused
                page.keyboard.press("Escape")
                page.wait_for_timeout(400)
                F.check("14", page.get_by_role("dialog").count() == 0,
                        "Escape does not close the captured-source sheet")

        return _finish(F, browser, page)


def _finish(F: Findings, browser, page=None) -> int:
    if page is not None:
        try:
            page.screenshot(path=str(OUT_DIR / "m99_final.png"), full_page=True)
        except Exception:  # noqa: BLE001
            pass
    browser.close()
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "report.json").write_text(json.dumps(
        {"findings": F.items, "controls": F.controls, "notes": F.notes},
        indent=2), encoding="utf-8")
    for label, info in F.controls.items():
        print(f"  {label:<28} {info['w']:>4}x{info['h']:<4} "
              f"reaches={info['reaches']} vp={info['inViewport']}")
    if F.items:
        print("FINDINGS:")
        for it in F.items:
            print(f"  [X] {it}")
        return 1
    print("Wave N mobile + accessibility: no findings")
    return 0


if __name__ == "__main__":
    sys.exit(main())

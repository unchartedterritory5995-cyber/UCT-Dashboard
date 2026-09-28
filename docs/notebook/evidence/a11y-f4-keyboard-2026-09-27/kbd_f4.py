"""F4 keyboard probe -- the checks lane 10E-2's walk does not make, for the F4 fixes.

    python kbd_f4.py <scratch-dir-of-the-sandbox> <out-dir>

Same method and same plumbing as keyboard_walk.py (lane 10E-2): the page is driven with
`page.keyboard` only, every step is written to the raw record as it happens (R-RAW), and the
C0 control (a button Tab cannot reach, a trap) must pass before the product is walked. It
reuses the walk account and its seeded library (keyboard_walk.seed), so it runs AFTER the walk.

Checks:
  F4-01  A2R-01  on five pages at 1280: the first Tab stop is "Skip to main content", it is on
                 screen with a visible ring when focused, Enter puts focus on <main>, and the
                 next Tab lands inside the page; on the Notebook the SECOND stop is its own
                 skip link.
  F4-02  A2R-01  the same pages at 390 / 820 / 1200: no page-level horizontal scroll, and the
                 unfocused skip link sits off-screen (it moves no layout).
  F4-03  A2R-08  verify only: the Templates, Import, Export and Writing help dialogs, opened by
                 keyboard, named by an aria-labelledby-aware reading (Playwright's own
                 accessibility snapshot, plus the labelledby text read directly).
  F4-04  G-160   the editor toolbar's ToolButtons by keyboard: Enter on "Insert link" asks
                 for the URL, Enter on "Attach a file" and on "Insert image" opens a file
                 chooser.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import e2_common as C  # noqa: E402
import kbd_lib as K  # noqa: E402
import keyboard_walk as W  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

PAGES = [
    ("notebook", "/journal/notebook?view=all"),
    ("dashboard", "/dashboard"),
    ("charts", "/charts"),
    ("screener", "/screener"),
    ("journal", "/journal"),
]

MAIN_JS = r"""() => { const a = document.activeElement; const m = document.getElementById('main-content');
  return {isMain: a === m, mainTag: m ? m.tagName : null, mainTabIndex: m ? m.tabIndex : null,
          insideMain: !!(m && a && m.contains(a) && a !== m)}; }"""
SKIP_RECT_JS = r"""() => { const a = Array.from(document.querySelectorAll('a')).find(x => x.textContent.trim() === 'Skip to main content');
  if (!a) return null; const r = a.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom}; }"""
LABELLEDBY_JS = r"""() => Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open]'))
  .filter(d => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
  .map(d => { const lb = d.getAttribute('aria-labelledby');
    const lbText = lb ? lb.split(/\s+/).map(id => (document.getElementById(id) || {}).textContent || '').join(' ').trim() : '';
    return {ariaLabel: d.getAttribute('aria-label') || '', labelledby: lb || '', labelledbyText: lbText.slice(0, 80),
            modal: d.getAttribute('aria-modal')}; })"""


def f4_skip_link(page, base, rec, shots):
    for name, path in PAGES:
        W.open_notebook(page, base, path, wait_ms=3500)
        W.focus_top(page)
        first = K.press(page, "Tab", 200)
        ok_first = (first.get("name") or "").strip() == "Skip to main content"
        second = K.press(page, "Tab", 200)
        # back to the skip link, then Enter
        W.focus_top(page)
        K.press(page, "Tab", 200)
        page.screenshot(path=str(shots / f"f4-01-skip-focused-{name}.png"))
        rec.rec["shots"].append(f"f4-01-skip-focused-{name}.png")
        K.press(page, "Enter", 400)
        m = page.evaluate(MAIN_JS)
        after = K.press(page, "Tab", 200)
        m2 = page.evaluate(MAIN_JS)
        verdict = ok_first and first.get("inViewport") and first.get("indicator") and m["isMain"] and m2["insideMain"]
        extra = ""
        if name == "notebook":
            ok2 = (second.get("name") or "").strip() in ("Skip to notes list", "Skip to note")
            verdict = verdict and ok2
            extra = f"; SECOND stop {K.short(second)} (Notebook's own skip link expected)"
        rec.step(f"F4-01-{name}", f"A2R-01 skip link: {path}", "focus top; Tab; Enter; Tab",
                 "first stop 'Skip to main content', on screen with a ring; Enter focuses <main>; next Tab lands inside <main>",
                 f"first {K.short(first)} inViewport={first.get('inViewport')} indicator={first.get('indicator')} "
                 f"outline={first.get('outline')!r} rect={first.get('rect')}; after Enter main focused={m['isMain']} "
                 f"(tabIndex {m['mainTabIndex']}); next Tab {K.short(after)} inside main={m2['insideMain']}{extra}",
                 "PASS" if verdict else "FAIL", sc="2.4.1", first=first)


def f4_layout(browser, base, rec, shots):
    for vw, vh, touch in ((390, 844, True), (820, 1180, True), (1200, 800, False)):
        ctx = browser.new_context(viewport={"width": vw, "height": vh}, has_touch=touch, is_mobile=touch and vw < 700)
        C.signup_or_login(ctx.request, base, W.WALK_EMAIL, C.PW, "kbd walker")
        pg = ctx.new_page()
        for name, path in PAGES:
            W.open_notebook(pg, base, path, wait_ms=3500)
            ov = K.overflow(pg)
            sk = pg.evaluate(SKIP_RECT_JS)
            fname = f"f4-02-{vw}-{name}.png"
            pg.screenshot(path=str(shots / fname))
            rec.rec["shots"].append(fname)
            horiz = ov["docScrollW"] > ov["docClientW"] + 1
            hidden = bool(sk) and sk["bottom"] <= 0
            rec.step(f"F4-02-{vw}-{name}", f"A2R-01 layout: {path} at {vw}", "load at this width, nothing focused",
                     "no page-level horizontal scroll; the unfocused skip link is off-screen (moves no layout)",
                     f"doc scrollW {ov['docScrollW']} vs clientW {ov['docClientW']}; skip link rect {sk}",
                     "PASS" if (not horiz and hidden) else "FAIL", sc="1.4.10/2.4.1")
        ctx.close()


def f4_dialog_names(page, base, rec):
    doors = [("Templates", "templates"), ("Import", "import"), ("Export (whole notebook)", "export")]
    for label, needle in doors:
        W.open_notebook(page, base)
        W.focus_top(page)
        found, n, trail, f = K.tab_until(page, lambda x, nd=needle: (x.get("name") or "").strip().lower() == nd, max_presses=140)
        if not found:
            rec.step(f"F4-03-{needle}", f"A2R-08 dialog name: {label}", "Tab", "reachable", f"not reached; tail {trail[-6:]}", "NOT RUN")
            continue
        K.press(page, "Enter", 1000)
        lb = page.evaluate(LABELLEDBY_JS)
        snap = ""
        try:
            snap = page.get_by_role("dialog").first.aria_snapshot()
        except Exception as e:  # noqa: BLE001
            snap = f"(aria snapshot failed: {type(e).__name__})"
        head = snap.splitlines()[0] if snap else ""
        named = bool(lb) and any(d["ariaLabel"] or d["labelledbyText"] for d in lb) and '"' in head
        rec.step(f"F4-03-{needle}", f"A2R-08 dialog name: {label}", f"Tab x{n}; Enter",
                 "the dialog has an accessible name (aria-labelledby read, not only aria-label)",
                 f"dialogs {lb}; accessibility snapshot head {head!r}",
                 "PASS" if named else "FAIL", sc="4.1.2")
        K.press(page, "Escape", 600)
    # Writing help, from a note
    ok, n, trail = W.open_note_by_keyboard(page, base, rec, "beta rates note")
    if ok:
        W.focus_top(page)
        found, n, trail, f = K.tab_until(page, lambda x: (x.get("name") or "").strip().lower() == "writing help", max_presses=170)
        if found:
            K.press(page, "Enter", 1200)
            lb = page.evaluate(LABELLEDBY_JS)
            try:
                snap = page.get_by_role("dialog").first.aria_snapshot()
            except Exception as e:  # noqa: BLE001
                snap = f"(aria snapshot failed: {type(e).__name__})"
            head = snap.splitlines()[0] if snap else ""
            named = bool(lb) and any(d["ariaLabel"] or d["labelledbyText"] for d in lb) and '"' in head
            rec.step("F4-03-writing-help", "A2R-08 dialog name: Writing help", f"Tab x{n}; Enter",
                     "the dialog has an accessible name (aria-labelledby read)",
                     f"dialogs {lb}; accessibility snapshot head {head!r}", "PASS" if named else "FAIL", sc="4.1.2")
            K.press(page, "Escape", 600)
            return
    rec.step("F4-03-writing-help", "A2R-08 dialog name: Writing help", "open a note; Tab", "reachable", "not reached", "NOT RUN")


def f4_toolbuttons(page, base, rec):
    ok, n, trail = W.open_note_by_keyboard(page, base, rec, "delta plain")
    if not ok:
        rec.step("F4-04", "G-160 ToolButton by keyboard", "open a note", "note opens", "did not open", "NOT RUN")
        return
    asked = []
    page.on("dialog", lambda d: (asked.append(d.message), d.dismiss()))
    W.focus_top(page)
    found, n, trail, f = K.tab_until(page, lambda x: (x.get("name") or "").strip() == "Insert link", max_presses=170)
    if found:
        K.press(page, "Enter", 800)
    rec.step("F4-04-link", "G-160: Enter on 'Insert link'", f"Tab x{n}; Enter",
             "a URL prompt opens (the action ran; before the fix Enter did nothing)",
             f"reached={found}; prompts seen {asked}", "PASS" if found and asked else "FAIL", sc="2.1.1")
    for sid, title in (("F4-04-attach", "Attach a file"), ("F4-04-image", "Insert image")):
        W.focus_top(page)
        found, n, trail, f = K.tab_until(page, lambda x, t=title: (x.get("name") or "").strip() == t, max_presses=170)
        chooser = None
        if found:
            try:
                with page.expect_file_chooser(timeout=4000) as fc:
                    page.keyboard.press("Enter")
                chooser = fc.value
            except Exception as e:  # noqa: BLE001
                chooser = None
                rec.rec["errors"].append({"section": sid, "error": f"{type(e).__name__}: {str(e)[:160]}"})
        rec.step(sid, f"G-160: Enter on '{title}'", f"Tab x{n}; Enter",
                 "a file chooser opens (the action ran)",
                 f"reached={found}; file chooser opened={chooser is not None}"
                 + (f" (multiple={chooser.is_multiple()})" if chooser else ""),
                 "PASS" if found and chooser is not None else "FAIL", sc="2.1.1")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("scratch")
    ap.add_argument("out_dir")
    a = ap.parse_args()
    out = Path(a.out_dir)
    shots = out / "shots"
    shots.mkdir(parents=True, exist_ok=True)
    ready = C.ready_record(Path(a.scratch))
    base = ready["base"]
    import os
    rec = K.Recorder(out / "walk-f4.json", {
        "tool": "kbd_f4", "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "base": base,
        "integrity_log": ready["integrity_log"], "browser": "chromium (playwright)",
        "viewport": "1280x800 unless a step says otherwise", "tip": os.environ.get("F4_TIP", "unknown")})
    rec.rec["meta"]["nonce"] = C.require_identity(base, ready["integrity_log"])
    with sync_playwright() as p:
        browser = p.chromium.launch()
        rec.rec["meta"]["browser_version"] = browser.version
        if not W.control(browser, rec):
            rec.rec["meta"]["verdict"] = "INSTRUMENT-FAILED"
            rec.flush()
            return 2
        adm = browser.new_context()
        C.signup_or_login(adm.request, base, C.ADMIN_EMAIL, C.PW, "hubtest")
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        me = C.provision(adm.request, ctx.request, base, W.WALK_EMAIL, "kbd walker")
        rec.rec["meta"]["account_paid"] = me.get("paid_equiv")
        W.seed(ctx.request, base, rec)
        page = ctx.new_page()
        for name, fn in (("skip", lambda: f4_skip_link(page, base, rec, shots)),
                         ("layout", lambda: f4_layout(browser, base, rec, shots)),
                         ("dialogs", lambda: f4_dialog_names(page, base, rec)),
                         ("toolbuttons", lambda: f4_toolbuttons(page, base, rec))):
            try:
                fn()
            except Exception as e:  # noqa: BLE001 -- a section that dies is recorded, never hidden
                import traceback
                rec.rec["errors"].append({"section": name, "error": f"{type(e).__name__}: {e}",
                                          "trace": traceback.format_exc()[-1500:]})
                rec.flush()
                print(f"SECTION {name} DIED: {type(e).__name__}: {e}", flush=True)
        browser.close()
    rec.rec["meta"]["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    rec.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

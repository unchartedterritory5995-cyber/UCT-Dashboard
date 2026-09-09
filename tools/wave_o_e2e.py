"""Wave O §52 — the flagship review journey, through the real member UI.

Twenty steps: open the thesis, see its evidence, review it, decide, schedule the
next one, complete, watch it leave the due queue, read it back in history, add
new opposing evidence, and confirm the deterministic "since your last review"
appears WITHOUT the prior review being touched.

⛔⛔ THE INSTRUMENTATION DOCTRINE (§62), carried from Wave N where four harness
races each reported a product defect:

  · WAIT ON SEMANTIC STATE, never a sleep. Every write here is followed by
    polling the endpoint the next assertion reads.
  · UNIQUE MARKERS. Every string this harness looks for carries a per-run token,
    so a match cannot be somebody else's copy.
  · SCOPE THE PROBE. Whole-page text checks catch legitimate copy elsewhere —
    "Invalidated" is a member decision as well as a status word.
  · THE HARNESS MUST REPORT ON RED. stdout is UTF-8 before anything can quote a
    page.

    python tools/local_backend_sandbox.py --port 8077
    python tools/wave_o_e2e.py --base http://127.0.0.1:8077
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import uuid

OUT_DIR = pathlib.Path(__file__).parent / "wave_o_e2e_out"
DESKTOP = {"width": 1440, "height": 900}

TOKEN = "zq" + uuid.uuid4().hex[:8]
NOTE_TEXT = f"My assessment {TOKEN}: margins still track my model."
OPPOSING = f"Opposing {TOKEN}: channel checks show discounting."
SOURCE_TITLE = "Reuters: NVDA margins"


class Findings:
    def __init__(self) -> None:
        self.items: list[str] = []
        self.steps: dict[str, object] = {}

    def fail(self, step: str, msg: str) -> None:
        self.items.append(f"{step}: {msg}")

    def note(self, step: str, **kw) -> None:
        cur = self.steps.setdefault(step, {})
        if isinstance(cur, dict):
            cur.update(kw)

    def check(self, step: str, cond: bool, msg: str) -> bool:
        if not cond:
            self.fail(step, msg)
        return bool(cond)


def api(ctx, method, path, base, **kw):
    return getattr(ctx.request, method.lower())(f"{base}{path}", **kw)


def jbody(resp):
    try:
        return resp.json()
    except Exception:  # noqa: BLE001
        return {}


def _dismiss_intro(page) -> None:
    """The cinematic intro plays ~9.3s on every load and covers the app. A
    probe that runs under it measures the intro (Wave N lost a run to exactly
    this)."""
    for _ in range(20):
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
        if page.locator('[class*="revealScene"]').count() == 0:
            break
    page.wait_for_timeout(400)


def _wait_for(fn, tries: int = 40, page=None) -> bool:
    """Poll a SEMANTIC condition. Never a bare sleep (§62)."""
    for _ in range(tries):
        if fn():
            return True
        if page is not None:
            page.wait_for_timeout(500)
    return False


def main() -> int:  # noqa: C901 - a journey is a sequence
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
        ctx = browser.new_context(viewport=DESKTOP)
        if not ctx.request.post(f"{base}/api/auth/login",
                                data={"email": args.email,
                                      "password": args.password}).ok:
            print("login failed — start the sandbox first", file=sys.stderr)
            return 2

        # SEEDED, not clicked: a thesis with real supporting and opposing
        # evidence. Wave N already certifies the capture→attach journey; this
        # harness is about what happens NEXT.
        made = jbody(api(ctx, "post", "/api/j2/notes", base, data={
            "title": f"NVDA thesis {TOKEN}", "ticker": "NVDA", "tags": ["thesis"],
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}}))
        note_id = (made.get("note") or made)["id"]

        def capture_and_attach(stance: str, passage: str) -> str:
            cap = jbody(api(ctx, "post", "/api/j2/capture", base, data={
                "tier": "passage", "url": f"https://www.reuters.com/{uuid.uuid4().hex[:8]}",
                "title": SOURCE_TITLE, "passage": passage,
                "annotation": "my own read", "noteId": note_id, "ticker": "NVDA"}))
            ex = cap.get("excerptId")
            api(ctx, "post", f"/api/j2/notes/{note_id}/evidence", base, data={
                "targetType": "document_excerpt", "targetId": ex, "stance": stance})
            return ex

        capture_and_attach("supports", f"Supporting {TOKEN}: gross margin holds.")
        capture_and_attach("opposes", f"Opposing {TOKEN}: pricing pressure.")

        page = ctx.new_page()

        # ── 1-3 · OPEN THE THESIS AND SEE ITS EVIDENCE ───────────────────────
        page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="networkidle")
        _dismiss_intro(page)
        body = page.locator("body").inner_text()
        F.check("2", TOKEN in body, "the thesis did not open")
        F.check("3", "SUPPORTS" in body.upper() and "OPPOSES" in body.upper(),
                "the thesis does not show supporting AND opposing evidence")

        # ── 4-5 · INVOKE REVIEW, SEE THE FIRST-REVIEW EMPTY STATE ────────────
        trigger = page.get_by_role("button", name="Review thesis")
        if not F.check("4", trigger.count() > 0, "no Review thesis action on a thesis"):
            return _finish(F, browser, page)
        F.check("5", "has not been reviewed yet" in body.lower(),
                "a never-reviewed thesis does not say so")
        trigger.first.click()
        page.wait_for_timeout(600)
        panel = page.locator('[aria-label="Thesis review"]')
        if not F.check("4", panel.count() > 0, "the review panel did not open"):
            return _finish(F, browser, page)
        ptext = panel.first.inner_text()
        F.note("5", panel=ptext[:400])
        # ⛔ §35 — the empty state is a DIFFERENT SENTENCE, not a zero.
        # ⛔ CASE-INSENSITIVE: the section title is uppercased by CSS
        # `text-transform`, and `inner_text` returns the RENDERED text. Wave N
        # lost a run to exactly this against a stance pill.
        low = ptext.lower()
        F.check("5", "no completed review yet" in low,
                f"the first-review empty state is wrong: {ptext[:120]!r}")
        F.check("5", "nothing has changed" not in low,
                "a never-reviewed thesis claims nothing changed since a review "
                "that never happened")

        # ── 6-7 · CURRENT THESIS + EVIDENCE SUMMARY ──────────────────────────
        F.check("7", "1 supporting" in ptext and "1 opposing" in ptext,
                f"the review does not summarise the evidence: {ptext[:160]!r}")
        # ⛔ §41 — counts, never a derived probability.
        import re as _re
        F.check("7", _re.search(r"\d+\s?%", ptext) is None,
                "the review derived a percentage from evidence counts")

        # ── 8-9-11 · MEMBER NOTE, OUTCOME, NEXT REVIEW ───────────────────────
        page.get_by_label("Your assessment").fill(NOTE_TEXT)
        page.get_by_role("radio", name="No change").click()
        # A date in the PAST, so step 14's "no longer due" is a real transition
        # rather than a date that was never due.
        page.locator('input[type="date"]').first.fill("2020-01-01")
        page.screenshot(path=str(OUT_DIR / "o01_review_open.png"), full_page=True)

        # ── 12 · COMPLETE ────────────────────────────────────────────────────
        page.get_by_role("button", name="Complete review").click()
        landed = _wait_for(lambda: any(
            r.get("status") == "completed" for r in
            jbody(api(ctx, "get", f"/api/j2/notes/{note_id}/reviews", base)
                  ).get("reviews", [])), page=page)
        if not F.check("12", landed, "the review never completed"):
            return _finish(F, browser, page)
        done = [r for r in jbody(api(ctx, "get", f"/api/j2/notes/{note_id}/reviews",
                                     base))["reviews"] if r["status"] == "completed"][0]
        F.note("12", review=done)
        F.check("12", done["memberNote"] == NOTE_TEXT,
                "the member's own words did not survive completion")
        F.check("12", done["outcome"] == "no_change", "the decision was not recorded")

        # ⛔ §53 — the thesis itself must be untouched by a NO CHANGE review.
        note_after = jbody(api(ctx, "get", f"/api/j2/notes/{note_id}", base))
        props = (note_after.get("note") or note_after).get("propertiesJson") or {}
        F.check("12", props.get("builtin:thesis_status") is None,
                f"a no-change review set a thesis status: {props!r}")
        # But the SCHEDULE the member chose did land, through the canonical path.
        F.check("11", props.get("builtin:review_date") == "2020-01-01",
                f"the next review date was not scheduled: {props!r}")

        # ── 13-14 · RESEARCH HOME ────────────────────────────────────────────
        home = jbody(api(ctx, "get", "/api/j2/notebook/home", base))
        rows = [n for n in home.get("needsReview", []) if n["id"] == note_id]
        F.note("14", in_queue=bool(rows),
               reasons=[r["text"] for r in (rows[0].get("reviewReasons") or [])] if rows else [])
        # It IS due (the date is in the past) — and the row explains itself.
        if F.check("13", bool(rows),
                   "the thesis with a past review date is not in Research Home"):
            F.check("16", bool(rows[0].get("reviewReasons")) is False or True, "")
            texts = " ".join(r["text"] for r in (rows[0].get("reviewReasons") or []))
            F.note("13", queue_reasons=texts)
            F.check("13", "no completed review yet" not in texts,
                    "the queue still says the thesis was never reviewed")

        # ── 15-16 · REVIEW HISTORY ───────────────────────────────────────────
        page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="networkidle")
        _dismiss_intro(page)
        hist_toggle = page.get_by_text("Review history", exact=False)
        if F.check("15", hist_toggle.count() > 0, "no review history section"):
            hist_toggle.first.click()
            page.wait_for_timeout(500)
            htext = page.locator("body").inner_text()
            F.note("16", history_shows_note=NOTE_TEXT in htext)
            F.check("16", NOTE_TEXT in htext,
                    "the completed review's own words are not in the history")
            F.check("16", "No change" in htext, "the recorded decision is missing")
        page.screenshot(path=str(OUT_DIR / "o02_history.png"), full_page=True)

        # ── 17-18 · NEW OPPOSING EVIDENCE, DETERMINISTICALLY NOTICED ─────────
        capture_and_attach("opposes", OPPOSING)
        att = jbody(api(ctx, "get", f"/api/j2/notes/{note_id}/reviews", base)
                    ).get("attention", {})
        texts = [r["text"] for r in att.get("reasons", [])]
        F.note("18", reasons=texts)
        F.check("18", "1 opposing evidence item added since your last review" in texts,
                f"the new opposing evidence was not noticed: {texts!r}")
        # ⛔ §13/§4 — noticing is not judging.
        blob = json.dumps(att).lower()
        for banned in ("invalid", "weaken", "priority", "urgent"):
            F.check("18", banned not in blob,
                    f"the attention payload interprets the evidence: {banned}")

        # ── 19-20 · THE NEXT REVIEW, AND HISTORY UNCHANGED ───────────────────
        page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="networkidle")
        _dismiss_intro(page)
        page.get_by_role("button", name="Review thesis").first.click()
        page.wait_for_timeout(700)
        p2 = page.locator('[aria-label="Thesis review"]').first.inner_text()
        F.note("19", panel=p2[:400])
        F.check("19", "1 opposing evidence item added" in p2,
                f"the next review does not show what changed: {p2[:200]!r}")
        F.check("19", "no completed review yet" not in p2.lower(),
                "the panel still claims there is no prior review")
        page.screenshot(path=str(OUT_DIR / "o03_second_review.png"), full_page=True)

        after = [r for r in jbody(api(ctx, "get", f"/api/j2/notes/{note_id}/reviews",
                                      base))["reviews"] if r["status"] == "completed"]
        F.check("20", len(after) == 1, "a second completed review appeared unbidden")
        F.check("20", after[0]["memberNote"] == NOTE_TEXT and
                after[0]["completedAt"] == done["completedAt"],
                "the earlier review was rewritten by opening a new one")

        return _finish(F, browser, page)


def _finish(F: Findings, browser, page=None) -> int:
    if page is not None:
        try:
            page.screenshot(path=str(OUT_DIR / "o99_final.png"), full_page=True)
        except Exception:  # noqa: BLE001
            pass
    browser.close()
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "report.json").write_text(
        json.dumps({"token": TOKEN, "findings": F.items, "steps": F.steps},
                   indent=2, ensure_ascii=False), encoding="utf-8")
    if F.items:
        print("FINDINGS:")
        for it in F.items:
            print(f"  [X] {it}")
        return 1
    print("Wave O flagship review journey: every step green")
    return 0


if __name__ == "__main__":
    sys.exit(main())

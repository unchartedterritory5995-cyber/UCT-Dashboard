"""Wave N §2 — the flagship journey, driven through the member-facing surface.

⛔ WHY THIS EXISTS. Wave N Step 1 made a captured passage an *attachable
candidate*, and the picker showing the row proves DISCOVERABILITY and nothing
else. §3 is explicit: a picker-only certification is not Evidence Completion.
The claim this harness has to earn is the whole chain —

    CAPTURE → CANDIDATE DISCOVERY → ATTACH → THESIS RENDER
            → RETRIEVAL → NAVIGATION → ASK / LINEAGE

— and it has to earn it by CLICKING, because every defect this wave has found
so far was invisible to a green unit test: the candidate list the member could
never see, the export that called a web capture "p.2", the thesis row that
called it "Document excerpt", the Ask label that called it "p.1", and the
revisit click that opened a PDF viewer over an identity string.

⛔ WHAT IS SEEDED RATHER THAN CLICKED, stated plainly rather than implied:
the member ACCOUNT and the destination NOTE are created over the API, and the
thesis "shape" comes from the note's own tags. Everything from the capture
dialog onward is real UI. The `/api/j2/*` reads this file makes AFTER a UI step
are ASSERTIONS about server truth, never substitutes for the step.

Run against the FAIL-CLOSED sandbox, never a live backend:

    python tools/local_backend_sandbox.py --port 8077
    python tools/wave_n_e2e.py --base http://localhost:8077

Exits non-zero on any finding. Writes tools/wave_n_e2e_out/report.json plus a
screenshot per step.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import uuid

OUT_DIR = pathlib.Path(__file__).parent / "wave_n_e2e_out"
DESKTOP = {"width": 1440, "height": 900}

# ⛔ THE ADVERSARIAL SEMANTIC FIXTURE (§7). The source claim and the member's
# reading of it point in OPPOSITE directions, so any surface that merges them
# produces a sentence that is not merely clumsy but false.
TOKEN = "zq" + uuid.uuid4().hex[:8]
SOURCE = f"Gross margin {TOKEN} normalizes toward the mid-70s next year."
MINE = "I think management is too optimistic."
SOURCE_URL = "https://www.reuters.com/markets/companies/nvda-margins"
SOURCE_TITLE = "Reuters: NVDA margins"


class Findings:
    def __init__(self) -> None:
        self.items: list[str] = []
        self.steps: dict[str, dict] = {}

    def fail(self, step: str, msg: str) -> None:
        self.items.append(f"{step}: {msg}")

    def note(self, step: str, **kw) -> None:
        self.steps.setdefault(step, {}).update(kw)

    def check(self, step: str, cond: bool, msg: str) -> bool:
        if not cond:
            self.fail(step, msg)
        return bool(cond)


def api(ctx, method: str, path: str, base: str, **kw):
    """One call through the browser context's cookie jar — exactly what the
    member's own browser would send. Used to ASSERT, never to perform a step."""
    return getattr(ctx.request, method.lower())(f"{base}{path}", **kw)


def _pdf_bytes(pages: list[str]) -> bytes:
    """A REAL pypdf-extractable PDF — the same builder Wave I's own suite uses,
    so §8's control is a genuine document and not a renamed text file."""
    import sys as _sys
    _sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
    from api.services.journal_two.pdf_fixtures import make_pdf
    return make_pdf(pages)


def jbody(resp):
    try:
        return resp.json()
    except Exception:  # noqa: BLE001
        return {}


def main() -> int:  # noqa: C901 - a journey is a sequence, not a graph
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8077")
    ap.add_argument("--email", default="mobtest@local.dev")
    ap.add_argument("--password", default="LocalTest2026!")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--skip-ask", action="store_true",
                    help="skip steps 13-14. They cost one real model call, and "
                         "skipping them leaves the journey CERTIFIED ONLY TO "
                         "STEP 12 — say so if you use this.")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    OUT_DIR.mkdir(exist_ok=True)
    F = Findings()
    base = args.base

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport=DESKTOP)
        r = ctx.request.post(f"{base}/api/auth/login",
                             data={"email": args.email, "password": args.password})
        if not r.ok:
            print(f"login failed ({r.status}) — start the sandbox first", file=sys.stderr)
            return 2

        # SEEDED, not clicked: the destination. `tags: ["thesis"]` is what
        # `isThesisShaped` reads, so the thesis section renders at all.
        made = jbody(api(ctx, "post", "/api/j2/notes", base, data={
            "title": f"NVDA thesis {TOKEN}", "ticker": "NVDA", "tags": ["thesis"],
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}}))
        note_id = (made.get("note") or made).get("id")
        if not note_id:
            print(f"could not create the thesis note: {made}", file=sys.stderr)
            return 2

        page = ctx.new_page()
        page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="networkidle")

        # ── 1-2 · CAPTURE AN EXTERNAL PASSAGE, WITH A DISTINCT MEMBER NOTE ───
        page.keyboard.press("Control+Shift+Y")
        try:
            page.wait_for_selector('[role="dialog"]', timeout=10000)
        except Exception as e:  # noqa: BLE001
            F.fail("1", f"the capture dialog never opened: {e}")
            return _finish(F, browser)

        # ⛔ Scoped by a hook only the CAPTURE dialog has. `[role="dialog"]`
        # alone also matches the Ask panel and any open sheet, and `.first` then
        # silently addresses whichever the DOM happens to put first.
        dialog = page.locator('[role="dialog"]:has([data-testid="capture-save"])').first
        # The dialog opens in "thought" mode; a source is an explicit choice.
        switch = dialog.get_by_role("button", name="Capture a source")
        if not F.check("1", switch.count() > 0,
                       "no way to say this is from the web"):
            return _finish(F, browser, page)
        switch.first.click()
        page.wait_for_timeout(200)
        try:
            dialog.get_by_label("Source link").fill(SOURCE_URL)
            dialog.get_by_label("Source title").fill(SOURCE_TITLE)
            dialog.get_by_label("Selected passage").fill(SOURCE)
            dialog.get_by_label("Your note").fill(MINE)
        except Exception as e:  # noqa: BLE001
            F.fail("1", f"the source fields are not reachable by their labels: {e}")
            return _finish(F, browser, page)
        page.screenshot(path=str(OUT_DIR / "01_capture_dialog.png"))
        dialog.locator('[data-testid="capture-save"]').click()
        try:
            page.wait_for_selector('[role="status"]', timeout=10000)
        except Exception:  # noqa: BLE001
            pass
        page.screenshot(path=str(OUT_DIR / "02_capture_saved.png"))

        # Server truth for 1-2: two fields in, two fields out.
        cands = jbody(api(ctx, "get",
                          f"/api/j2/notes/{note_id}/evidence-candidates", base))
        rows = cands.get("candidates", [])
        F.check("1", len(rows) == 1,
                f"the captured passage did not land as ONE candidate: {rows!r}")
        if not rows:
            return _finish(F, browser, page)
        cand = rows[0]
        excerpt_id = cand["id"]
        F.check("2", MINE == (cand.get("annotation") or ""),
                "the member's own note did not survive the capture")
        F.check("2", MINE not in (cand.get("text") or ""),
                "the member's reading was folded into the quoted source")
        F.note("1", candidate=cand)

        # ── 3-4 · OPEN THE THESIS CONTEXT AND INVOKE ADD EVIDENCE ────────────
        page.reload(wait_until="networkidle")
        add = page.get_by_role("button", name="Add evidence")
        if not F.check("3", add.count() > 0,
                       "no Add evidence affordance on a thesis-shaped note"):
            return _finish(F, browser, page)
        add.first.click()
        page.get_by_role("button", name="Document excerpt").first.click()
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT_DIR / "03_picker_open.png"))

        # ── 5-7 · FIND IT, AND READ WHAT IT SAYS ─────────────────────────────
        row = page.locator("li button", has_text=SOURCE_TITLE)
        if not F.check("5", row.count() > 0,
                       "the captured passage is not in the picker the member sees"):
            return _finish(F, browser, page)
        row_text = row.first.inner_text()
        F.note("5", picker_row=row_text)
        F.check("7", "Captured passage" in row_text,
                f"the picker does not say what this is: {row_text!r}")
        F.check("7", "p." not in row_text,
                f"the picker claims a page for a web capture: {row_text!r}")
        # §7 — the two strings must be in DIFFERENT elements, not one blob.
        quoted = row.first.locator("span", has_text=TOKEN)
        mine_el = row.first.locator("span", has_text="Your note:")
        F.check("6", quoted.count() > 0 and mine_el.count() > 0,
                "source and member note are not separately rendered in the picker")
        if quoted.count() and mine_el.count():
            F.check("6", MINE.split(".")[0] not in quoted.first.inner_text(),
                    "the member's opinion appears inside the quoted source")
            F.check("6", TOKEN not in mine_el.first.inner_text(),
                    "the source text appears inside the member's note")

        # ── 8-9 · OPPOSING, AND ATTACH ───────────────────────────────────────
        page.get_by_role("button", name="Opposes").first.click()
        row.first.click()
        page.get_by_placeholder("Why this matters (optional)").fill(
            "cuts against the long case")
        page.screenshot(path=str(OUT_DIR / "04_stance_chosen.png"))
        # The picker's own submit — the trigger link is gone while it is open.
        page.locator("button", has_text="Add evidence").last.click()
        page.wait_for_timeout(1200)
        page.screenshot(path=str(OUT_DIR / "05_attached.png"))
        # ⛔ THE PICKER'S OWN ERROR LINE, read rather than inferred. A failed
        # attach otherwise surfaces three steps later as "the thesis does not
        # show the stance", which sends the reader looking in the wrong place.
        err = page.locator("text=Could not add evidence")
        if err.count():
            F.fail("9", "the attach was refused in the UI: "
                        f"{page.locator('[class*=picker]').first.inner_text()[:200]!r}")

        # ── 10 · THE THESIS SHOWS THE RELATIONSHIP ───────────────────────────
        # ⛔ CASE-INSENSITIVE ON PURPOSE: the stance pill is uppercased by CSS,
        # and `inner_text` returns the RENDERED text. A case-sensitive probe
        # here reported "the thesis does not show the stance" against a screen
        # that was showing it — a broken instrument, not a defect.
        body = page.locator("body").inner_text()
        F.check("10", "opposes" in body.lower(),
                "the thesis does not show the stance it was given")
        F.check("10", SOURCE_TITLE in body or "cuts against the long case" in body,
                "the attached evidence does not identify itself in the thesis")
        F.check("10", "Document excerpt" not in body,
                "a captured web passage is labelled 'Document excerpt' in the thesis")
        attached_row = page.locator("li", has_text="Opposes").first
        F.note("10", thesis_row=attached_row.inner_text() if attached_row.count() else None)
        F.check("10", "p.1" not in (attached_row.inner_text() if attached_row.count() else ""),
                "the thesis row claims a page for a web capture")

        # Server truth for 10.
        ev_rows = jbody(api(ctx, "get", f"/api/j2/notes/{note_id}/thesis-summary", base))
        evidence = ev_rows.get("evidence", [])
        F.check("10", any(e.get("targetId") == excerpt_id and e.get("stance") == "opposes"
                          for e in evidence),
                f"the server does not hold the opposing edge: {evidence!r}")

        # ── 11-12 · REVISIT IT, AND LAND SOMEWHERE TRUTHFUL ──────────────────
        # ⛔ THE STEP THAT USED TO OPEN A FULLSCREEN PDF VIEWER over
        # `web:<sha256>`. §9: no fake viewer, no page anchor, no download.
        link = page.locator("li button", has_text=SOURCE_TITLE)
        if F.check("11", link.count() > 0, "the attached evidence is not clickable"):
            link.first.click()
            page.wait_for_timeout(900)
            page.screenshot(path=str(OUT_DIR / "06_revisit.png"))
            sheet = page.get_by_role("dialog")
            opened = sheet.count() > 0
            F.check("11", opened, "clicking the evidence opened nothing at all")
            if opened:
                st = sheet.first.inner_text()
                F.note("12", revisit_surface=st[:400])
                F.check("12", TOKEN in st,
                        "the revisit surface does not show the captured passage")
                F.check("12", MINE in st,
                        "the revisit surface drops the member's own note")
                F.check("12", "Download" not in st,
                        "a download is offered for something that is not a document")
                F.check("12", "reuters.com" in st,
                        "the revisit surface does not say where the passage came from")
                import re as _re
                F.check("12", _re.search(r"\bp\.\s?\d", st) is None,
                        f"the revisit surface claims a page: {st[:200]!r}")
                # Close it again so a later step is not typing into a modal.
                page.keyboard.press("Escape")
                page.wait_for_timeout(300)

        # ── §8 · THE DOCUMENT CONTROL ────────────────────────────────────────
        # ⛔ THE WHOLE POINT OF A CONTROL: prove the web-capture extension did
        # not FLATTEN the established Wave J path. A real PDF must still be
        # discoverable, still say p.47, still attach, and still open its page
        # in the viewer — while the capture beside it does none of those things.
        pdf_note = jbody(api(ctx, "post", "/api/j2/notes", base, data={
            "title": f"NVDA filing {TOKEN}", "ticker": "NVDA", "tags": ["thesis"],
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}}))
        pdf_note_id = (pdf_note.get("note") or pdf_note).get("id")
        pages = ["filler"] * 46 + [f"PDF47 {TOKEN} management expects margins to normalise"]
        up = api(ctx, "post", f"/api/j2/notes/{pdf_note_id}/attachments", base,
                 multipart={"file": {"name": "nvda-10q.pdf",
                                     "mimeType": "application/pdf",
                                     "buffer": _pdf_bytes(pages)}})
        F.note("8", upload_status=up.status)
        if F.check("8", up.ok, f"a real PDF upload failed (HTTP {up.status}): "
                               f"{up.text()[:200]}"):
            doc_id = None
            for _ in range(40):
                docs = jbody(api(ctx, "get", f"/api/j2/notes/{pdf_note_id}/documents", base))
                ready = [d for d in docs.get("documents", []) if d.get("status") == "ready"]
                if ready:
                    doc_id = ready[0]["id"]
                    break
                page.wait_for_timeout(500)
            if F.check("8", doc_id is not None,
                       "the uploaded PDF never finished extraction"):
                made_ex = jbody(api(ctx, "post", f"/api/j2/notes/{pdf_note_id}/excerpts",
                                    base, data={
                                        "documentId": doc_id, "pageNumber": 47,
                                        "capturedText": f"PDF47 {TOKEN} management "
                                                        "expects margins to normalise"}))
                pdf_ex = (made_ex.get("excerpt") or made_ex).get("id")
                pc = jbody(api(ctx, "get",
                               f"/api/j2/notes/{pdf_note_id}/evidence-candidates", base))
                prow = [c for c in pc.get("candidates", []) if c["id"] == pdf_ex]
                F.check("8", len(prow) == 1,
                        "a real document excerpt is not an evidence candidate")
                if prow:
                    F.note("8", candidate=prow[0])
                    F.check("8", prow[0]["pageNumber"] == 47,
                            f"the real page was lost: {prow[0]['pageNumber']!r}")
                    F.check("8", prow[0]["sourceKind"] == "attachment",
                            "a PDF is reported as a web capture")
                # It must ATTACH, and the thesis must show its real page.
                att = api(ctx, "post", f"/api/j2/notes/{pdf_note_id}/evidence", base,
                          data={"targetType": "document_excerpt", "targetId": pdf_ex,
                                "stance": "supports"})
                F.check("8", att.ok, f"a real document excerpt no longer attaches: {att.status}")
                page.goto(f"{base}/journal/notebook?note={pdf_note_id}",
                          wait_until="networkidle")
                page.wait_for_timeout(700)
                ptext = page.locator("body").inner_text()
                F.check("8", "p.47" in ptext,
                        "the thesis lost the real page number for a PDF excerpt")
                page.screenshot(path=str(OUT_DIR / "09_pdf_thesis.png"))
                # And REVISITING it must still open the viewer at that page —
                # the half of §8 that a label check cannot see.
                prow_btn = page.locator("li button", has_text="p.47")
                if F.check("8", prow_btn.count() > 0,
                           "the PDF evidence row is not clickable"):
                    prow_btn.first.click()
                    page.wait_for_timeout(1500)
                    page.screenshot(path=str(OUT_DIR / "10_pdf_viewer.png"))
                    viewer = page.locator('[role="dialog"]')
                    F.check("8", viewer.count() > 0,
                            "clicking a real document excerpt opened nothing")
                    if viewer.count():
                        vt = viewer.first.inner_text()
                        F.note("8", viewer_surface=vt[:300])
                        F.check("8", "Download" in vt,
                                "the real document viewer lost its document actions")
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(300)
                # Ask, over the DOCUMENT, must still cite a page.
                page.goto(f"{base}/journal/notebook?note={pdf_note_id}",
                          wait_until="networkidle")

        # ── §4 · THE DUPLICATE CASE, BOTH WAYS ───────────────────────────────
        # ⛔ The member must learn a passage is already attached BEFORE acting,
        # not by being refused afterwards — and the server must agree, because
        # a guard that lives only in a disabled button is not a guard.
        # ⛔ NAVIGATE EXPLICITLY, never `reload()`. §8 above leaves the browser
        # on the PDF note, and a reload then reopened THAT note's picker while
        # this block asserted about the capture — a probe pointed at the wrong
        # screen reports a defect that is not there.
        page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="networkidle")
        page.get_by_role("button", name="Add evidence").first.click()
        page.get_by_role("button", name="Document excerpt").first.click()
        page.wait_for_timeout(400)
        # ⛔ Scoped to a PICKER row, not "any li button naming the source" —
        # the attached evidence row names it too, and the loose locator matched
        # that instead and reported a defect against the wrong element.
        dup = page.locator('li button:has-text("Your note:")')
        page.screenshot(path=str(OUT_DIR / "08_duplicate_picker.png"))
        if F.check("4", dup.count() > 0,
                   "an attached candidate vanished from the picker — the member "
                   "cannot see what they already used"):
            dtext = dup.first.inner_text()
            F.note("4", picker_row=dtext, disabled=dup.first.is_disabled())
            F.check("4", "already attached" in dtext.lower(),
                    f"the picker does not say it is already attached: {dtext!r}")
            F.check("4", dup.first.is_disabled(),
                    "the already-attached candidate is still clickable")
        # The adversarial control: the same mutation, straight at the API.
        again = api(ctx, "post", f"/api/j2/notes/{note_id}/evidence", base, data={
            "targetType": "document_excerpt", "targetId": excerpt_id,
            "stance": "supports"})
        F.note("4", api_status=again.status, api_body=jbody(again))
        F.check("4", again.status >= 400,
                f"the API accepted a duplicate the UI forbids (HTTP {again.status})")
        after = jbody(api(ctx, "get", f"/api/j2/notes/{note_id}/evidence", base))
        live = [e for e in after.get("evidence", []) if e.get("targetId") == excerpt_id]
        F.check("4", len(live) == 1,
                f"one passage holds {len(live)} live edges on one thesis")
        page.keyboard.press("Escape")

        # ── 13-14 · ASK, AND COUNT THE SOURCE ONCE ──────────────────────────
        # ⛔ THE LOAD-BEARING ONE (§6). Once attached, the passage is reachable
        # BOTH as captured research and through the thesis edge. Those are not
        # two corroborating sources — curation cannot manufacture corroboration
        # — and the place that claim becomes visible to a member is the panel's
        # own Sources list. There is no retrieval-only endpoint, so this drives
        # the real Ask (a real model call) rather than asserting on a seam the
        # member never touches.
        if args.skip_ask:
            F.note("13", skipped="--skip-ask")
        else:
            page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="networkidle")
            askbtn = page.get_by_label("Ask a question about this note")
            if F.check("13", askbtn.count() > 0, "no Ask affordance on the note"):
                askbtn.first.click()
                page.wait_for_timeout(600)
                # The panel's own input, addressed by its label rather than by
                # "the last textarea on the page" — the editor is full of those.
                box = page.get_by_label("Your question about this note")
                if not F.check("13", box.count() > 0,
                               "the Ask panel opened without a question field"):
                    return _finish(F, browser, page)
                box.first.fill(f"What does my research say about {TOKEN} margins?")
                box.first.press("Enter")
                try:
                    page.wait_for_selector('[data-testid="ask-answer"]', timeout=90000)
                except Exception as e:  # noqa: BLE001
                    F.fail("13", f"Ask produced no answer: {e}")
                page.wait_for_timeout(2500)
                page.screenshot(path=str(OUT_DIR / "07_ask.png"), full_page=True)

                cov = page.locator('[data-testid="ask-coverage"]')
                F.note("13", coverage=cov.first.inner_text() if cov.count() else None)
                # ⛔ RECORDED, NOT ASSERTED. A model's prose is not a place to
                # put a pass/fail probe — an assertion on generated wording
                # would go red on a paraphrase and green on a lie. The
                # deterministic claims below are the rails; this is the
                # artefact a human reads to check §7 held in the answer itself.
                ans = page.locator('[data-testid="ask-answer"]')
                F.note("13", answer=ans.first.inner_text()[:900] if ans.count() else None)
                srcs = page.locator('[data-testid="ask-sources"] button')
                labels = [srcs.nth(i).inner_text() for i in range(srcs.count())]
                F.note("14", ask_sources=labels)
                F.check("13", srcs.count() > 0,
                        "Ask answered without citing the research it was given")
                # §14 — SEMANTIC SOURCE IDENTITY, not a result count. The same
                # underlying passage must appear as ONE source however many
                # pathways reach it.
                same = [l for l in labels if SOURCE_TITLE in l]
                F.check("14", len(same) <= 1,
                        f"the one captured passage is cited {len(same)} times as "
                        f"separate sources: {same!r}")
                F.check("14", not any("p.1" in l for l in labels),
                        f"Ask cites the capture as a page: {labels!r}")

        return _finish(F, browser, page)


def _finish(F: Findings, browser, page=None) -> int:
    if page is not None:
        try:
            page.screenshot(path=str(OUT_DIR / "99_final.png"))
        except Exception:  # noqa: BLE001
            pass
    browser.close()
    report = {"findings": F.items, "steps": F.steps, "token": TOKEN}
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    if F.items:
        print("FINDINGS:")
        for it in F.items:
            print(f"  [X] {it}")
        return 1
    print("Wave N flagship journey: every step green")
    return 0


if __name__ == "__main__":
    sys.exit(main())

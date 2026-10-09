"""Production check of the Notebook's AI doors, as the smoke account, on ONE note the run creates
and removes.

What it proves, on the LIVE site, in one run of a few minutes:
  * Research Home carries an Ask door for a member with notes (fin-walk 8.3; the quiet-home fix).
  * A whole-Notebook question is answered FROM A NOTE: the answer carries both numbers the note
    holds, cites the note, and the citation opens it (G-051 on production; K1's shape).
  * Inside that note, Ask about this note answers from it (G-050 on production).
  * Writing help on that note drafts a summary and Discard adds nothing to the note (G-165 on
    production; ruling D-H1, the draft lives in the panel until Accept) -- and the SAME for
    "Rewrite shorter", "Continue writing" and "Translate" (the default language): each drafts
    something that is not the placeholder, and each Discard leaves the note byte-identical on
    the server (`GET /api/j2/notes/{id}` before vs after).
  * Property autofill ("Suggest values", wave 10 G-165): the door beside "Add property" opens,
    Compass answers with suggestions or with the sentence that it found nothing, Close applies
    nothing, and the note is unchanged. An absent door is INCONCLUSIVE with its reason, never a
    failure (the door rides the writing-help gate and needs an empty member-set property; every
    note has the four built-in ones, so on production its absence means the gate).
  * G-166, Ask over an attached Word file: a tiny .docx built in a temp directory (python-docx if
    importable, else a minimal valid package written with `zipfile`) carrying one unique sentence
    is uploaded through the note's own attachment door (`POST /api/j2/notes/{id}/attachments`),
    becomes a document row (`GET /api/j2/notes/{id}/documents`), is polled to a settled
    extraction status (`ready` | `no_text` | `processing_failed`, the service's own names), and
    "What is the budget code?" asked INSIDE the note answers with the code and cites something.
    No document row on upload means the `NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED` gate is off:
    INCONCLUSIVE, not a failure.
  * A 390x852 touch context (device scale 3, `has_touch`, `is_mobile` -- the same context
    `tools/hub_nav_smoke.py --touch` builds): the Ask toggle on Research Home is at least 44x44,
    and after the whole-Notebook question every citation chip in the Ask panel (the Sources rows
    and the inline `Source N` buttons in the answer) is at least 44x44 and NO two chips' boxes
    overlap -- finding K7's adjacency case. Every chip's box is recorded in `result.json`.
  * The note the run created is removed again (the smoke-account rule: whatever a run creates,
    that run removes).

Preconditions, the same as `tools/hub_nav_smoke.py --auth`:
  * `SMOKE_EMAIL` / `SMOKE_PASSWORD` in the operator's environment (never in the repo, a log or a
    commit). The account is asserted SYNTHETIC from `/api/auth/me` -- its email must end in
    `@uctintelligence.internal` -- before anything is written or clicked. Any other account stops
    the run with exit 2 and writes nothing.
  * Playwright with Chromium installed (the repo's Python environment has it).
  * `NOTEBOOK_WRITING_HELP_ENABLED=1` on the service, or the writing-help leg reads as
    INCONCLUSIVE (the button is not rendered while the switch is off) and the run exits 2.

What it writes to production, and removes: ONE note, titled so a human reading the trash knows
what it was, with synthetic text (a made-up ticker `ZZZT`, two numbers, one rule, in TWO
paragraphs so an answer can cite the note twice), and ONE attachment on that note (a .docx of a
few hundred bytes with a made-up vendor sentence). Created through `POST /api/j2/notes`, removed
in a `finally` block through `DELETE /api/j2/notes/{id}` -- the product's own soft delete, so it
lands in the trash like any member deletion -- and checked gone (`GET` answers 404).

The document goes with the note, not on its own: there is NO member-facing DELETE for a note
document (`api/routers/journal_two.py` has only the list, page-text and search doors), so the
row and the file are removed the way the product removes them for every member -- the nightly
trash purge (`notes.purge_expired_deleted_notes`, 03:20 ET, after `TRASH_RETENTION_DAYS` = 30)
hard-deletes the note, which fires the `j2_notes_documents_ad` trigger (`db.py`) that deletes
the `j2_note_documents` row and, through `j2_note_documents_pages_ad`, its page text; the
attachment GC at 03:40 then drops the file. Until then the trashed note still owns it, and
`GET /api/j2/notes/{id}/documents` answers 404 for the trashed note.

Model calls per run (each costs money, so the budget is written down): FOUR Ask questions
(whole-Notebook, inside the note, the Word-file question inside the note, the whole-Notebook
question again in the touch context), FOUR writing-help drafts (Summarize, Rewrite shorter,
Continue writing, Translate -- all discarded) and ONE property-autofill call. Writing help counts
60 per member per ET day and autofill spends from the same counter, so a run costs 5 of the 60;
the smoke account is nobody's.

Exit codes, three facts (the same split as `hub_nav_smoke.py`; H15 never fires on a 2):
  0  PASS           every leg measured and healthy
  1  FAIL           a measured failure: no door, an error/limit message, an answer without the
                    numbers or without a citation, a citation that opened nothing, a note-scoped
                    answer without the stop, an empty draft, Discard or Suggest values changing the
                    note, the autofill door answering an error, a Word file whose extraction
                    failed or whose question is answered without the code or without a citation,
                    a touch toggle or chip under 44x44, two chips overlapping
  2  INCONCLUSIVE   not signed in, wrong account domain, the note could not be created, a page or
                    an answer never arrived, the intro animation still covering Research Home
                    after 15 s (Escape and Skip are sent first; a door counted through the
                    overlay is not a measurement), the writing-help or autofill door not rendered, the
                    docx gate off (no document row), extraction still pending at the deadline, or
                    fewer than two chips so adjacency was never exercised

Evidence: `--out <dir>` writes `result.json` + screenshots there; the default is a temp directory
printed at the end. The repo does not grow one directory per run.

Usage
-----
    python tools/notebook_prod_ask_check.py                 # production
    python tools/notebook_prod_ask_check.py --base http://127.0.0.1:8700
    python tools/notebook_prod_ask_check.py --out docs/notebook/evidence/prod-ask/2026-10-08
    python tools/notebook_prod_ask_check.py --self-check    # rule 14: the verdict can fail

Rule 14 (`--self-check`): the verdict is a pure function of what was measured, and the self-check
feeds it each failing shape and asserts each one is a 1 (or a 2 for the unmeasurable shapes), and
the healthy shape a 0. A probe whose verdict cannot go red is a probe that would report a dead
door as PASS. The overlap test has its own control: two boxes that touch at an edge are NOT an
overlap, two that share area are.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
import zipfile
from pathlib import Path

PROD = "https://uctintelligence.com"
SYNTHETIC_DOMAIN = "@uctintelligence.internal"
TITLE = "Smoke check: ZZZT plan (automated, removed by the run)"
# Two paragraphs on purpose: two citable blocks, so an answer can cite the note twice (K7's
# adjacency case needs at least two chips side by side).
TEXT_P1 = ("ZZZT plan. Planned entry 41.20 on a close above the 10-day high. Stop 39.80, under the "
           "last swing low.")
TEXT_P2 = "Rule for this trade: no adds until two closes above 43."
QUESTION = "What are my planned entry and my stop for ZZZT, and what is my rule for the trade?"
EXPECT = ("41.20", "39.80")
NOTE_QUESTION = "What is my stop for ZZZT?"
NOTE_EXPECT = "39.80"
DRAFT_PLACEHOLDERS = ("The draft appears here.", "Writing…")
# The three writing-help choices beyond Summarize that this check drives, by their button labels
# (`WRITING_HELP_CHOICES` in app/src/pages/journal-2-0/lib/writingHelpStream.js).
WRITING_HELP_EXTRA = ("Rewrite shorter", "Continue writing", "Translate")
# Property autofill (app/src/pages/journal-2-0/lib/propertyAutofill.js).
AUTOFILL_NOTHING_SENTENCE = "Compass found nothing in this note to fill in."
# G-166: the Word file and its one unique sentence.
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
DOCX_NAME = "smoke-check-vendor-memo.docx"
DOCX_SENTENCE = "The vendor meeting is on the third Tuesday and the budget code is QX-7731."
DOCX_QUESTION = "What is the budget code?"
DOCX_EXPECT = "QX-7731"
DOC_SETTLED = ("ready", "no_text", "processing_failed")   # document_extraction's own status names
DOC_FAILED = ("no_text", "processing_failed")
DOC_POLL_S = 120
# The touch context, the same numbers `tools/hub_nav_smoke.py --touch` uses (390 wide per the brief).
TOUCH_VIEWPORT = {"width": 390, "height": 852}
TOUCH_DPR = 3
TAP_MIN = 44
# The cinematic intro (app/src/components/intro/IntroAnimation.jsx) plays on EVERY page load for
# ~9.3 s as an opaque fixed overlay; its root is unmounted once it finishes. Escape, Enter, Space
# or the Skip button finish it. A door counted while it is up is a door the member cannot see,
# and a door counted as absent while it is up is the intro, not the product.
INTRO_SEL = "[role='dialog'][aria-label='Welcome']"
INTRO_SKIP_SEL = "button[aria-label='Skip intro']"
INTRO_BUDGET_MS = 15_000


def overlapping_pairs(boxes: list[dict]) -> list[list[int]]:
    """Index pairs of boxes that share AREA. Boxes that only touch at an edge or a corner are
    not overlapping -- adjacent chips are allowed to abut, not to sit on top of each other."""
    out = []
    for i in range(len(boxes)):
        a = boxes[i]
        for j in range(i + 1, len(boxes)):
            b = boxes[j]
            if (a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"]
                    and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]):
                out.append([i, j])
    return out


def _big_enough(box: dict | None) -> bool:
    return bool(box) and box["w"] + 0.5 >= TAP_MIN and box["h"] + 0.5 >= TAP_MIN


def verdict(*, doors: int, alert: str, answer: str, sources: int, cited_opened: bool | None,
            note_answer: str = NOTE_EXPECT, note_alert: str = "", draft: str = "x",
            help_alert: str = "", note_unchanged: bool = True,
            home_state: str = "full",
            drafts: dict | None = None, autofill: dict | None = None,
            docx: dict | None = None, touch: dict | None = None,
            intro_present: bool = False) -> tuple[int, str]:
    """The one place a measurement becomes a code. Pure, so `--self-check` can feed it.

    `drafts`, `autofill`, `docx` and `touch` are the new legs' measurements; `None` means the leg
    was never measured, which is a 2 -- reported only once every 1 has been ruled out, so a run
    that failed early still names the failure and not the legs it never reached.

    `intro_present` comes FIRST: while the intro overlay still covers Research Home nothing about
    the door count is a measurement of the product (the 23:12 CT post-deploy run read
    `ask_doors 0` through the compass animation and called it a FAIL)."""
    if intro_present:
        return 2, f"the intro animation still covered Research Home after {INTRO_BUDGET_MS // 1000} s; no door was measurable"
    if doors == 0:
        return 1, "no Ask door on Research Home for a member with notes"
    if alert:
        return 1, f"the panel showed: {alert}"
    if not answer.strip():
        return 1, "empty answer"
    if not all(x in answer for x in EXPECT):
        return 1, "the answer did not carry both numbers from the note"
    if sources == 0:
        return 1, "the answer cited nothing"
    if cited_opened is False:
        return 1, "the citation did not open the cited note"
    if note_alert:
        return 1, f"Ask inside the note showed: {note_alert}"
    if NOTE_EXPECT not in note_answer:
        return 1, "Ask inside the note did not carry the stop"
    if help_alert:
        return 1, f"writing help showed: {help_alert}"
    if not draft.strip() or draft.strip() in DRAFT_PLACEHOLDERS:
        return 1, "writing help produced no draft"
    if not note_unchanged:
        return 1, "Discard changed the note"
    inconclusive: list[str] = []

    # Leg C2: the other three writing-help choices.
    for label in WRITING_HELP_EXTRA:
        d = (drafts or {}).get(label)
        if d is None:
            inconclusive.append(f"'{label}' never measured")
            continue
        if d.get("alert"):
            return 1, f"writing help '{label}' showed: {d['alert']}"
        if not (d.get("draft") or "").strip() or d["draft"].strip() in DRAFT_PLACEHOLDERS:
            return 1, f"writing help '{label}' produced no draft"
        if not d.get("note_unchanged", False):
            return 1, f"Discard after '{label}' changed the note"

    # Leg D: property autofill.
    if autofill is None:
        inconclusive.append("Suggest values never measured")
    elif not autofill.get("door"):
        inconclusive.append(f"Suggest values door absent ({autofill.get('reason') or 'no reason recorded'})")
    else:
        if autofill.get("state") == "error":
            return 1, f"Suggest values answered an error: {autofill.get('alert') or ''}".rstrip(": ")
        if autofill.get("state") == "timeout":
            inconclusive.append("Suggest values never settled")
        elif autofill.get("state") not in ("suggestions", "nothing"):
            return 1, f"Suggest values ended in an unknown state: {autofill.get('state')!r}"
        if not autofill.get("note_unchanged", False):
            return 1, "Suggest values changed the note"

    # Leg E: G-166, Ask over the Word file.
    if docx is None:
        inconclusive.append("Word-file leg never measured")
    elif not docx.get("gate"):
        inconclusive.append("the upload made no document row (NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED off)")
    elif docx.get("timed_out"):
        inconclusive.append(f"the Word file's extraction was still '{docx.get('status')}' at the deadline")
    elif docx.get("status") in DOC_FAILED:
        return 1, f"the Word file's extraction ended '{docx.get('status')}'"
    elif docx.get("alert"):
        return 1, f"Ask over the Word file showed: {docx['alert']}"
    elif DOCX_EXPECT not in (docx.get("answer") or ""):
        return 1, "Ask over the Word file did not carry the budget code"
    elif not docx.get("sources"):
        return 1, "Ask over the Word file cited nothing"

    # Leg F: the touch context.
    if touch is None:
        inconclusive.append("touch pass never measured")
    else:
        if not touch.get("toggle"):
            return 1, "no Ask door on Research Home in the touch context"
        if not _big_enough(touch["toggle"]):
            t = touch["toggle"]
            return 1, f"the Ask toggle is {t['w']:.1f}x{t['h']:.1f} at 390 px, under {TAP_MIN}x{TAP_MIN}"
        if touch.get("alert"):
            return 1, f"the touch-context panel showed: {touch['alert']}"
        if not touch.get("arrived"):
            inconclusive.append("no whole-Notebook answer in the touch context")
        else:
            chips = touch.get("chips") or []
            if not chips:
                return 1, "the touch-context answer cited nothing"
            small = [c for c in chips if not _big_enough(c)]
            if small:
                c = small[0]
                return 1, (f"a citation chip is {c['w']:.1f}x{c['h']:.1f} at 390 px, under "
                           f"{TAP_MIN}x{TAP_MIN} ({c.get('label', '')})")
            pairs = overlapping_pairs(chips)
            if pairs:
                i, j = pairs[0]
                return 1, (f"two citation chips overlap at 390 px: "
                           f"{chips[i].get('label', '')} and {chips[j].get('label', '')}")
            if len(chips) < 2:
                inconclusive.append("only one chip in the touch context, so adjacency was not exercised")

    if inconclusive:
        return 2, "; ".join(inconclusive)
    n_chips = len((touch or {}).get("chips") or [])
    return 0, (f"door present ({home_state} home); whole-Notebook answer with both numbers, "
               f"{sources} source(s), citation opened the note; Ask inside the note carried the stop; "
               f"writing help drafted x{1 + len(WRITING_HELP_EXTRA)} and every Discard left the note "
               f"unchanged; Suggest values {autofill.get('state')} and applied nothing; the Word file "
               f"reached '{docx.get('status')}' and Ask carried the budget code with "
               f"{docx.get('sources')} source(s); touch toggle {touch['toggle']['w']:.0f}x"
               f"{touch['toggle']['h']:.0f}, {n_chips} chips all >= {TAP_MIN} with no overlap; "
               f"note removed")


def self_check() -> int:
    good_draft = {"draft": "A shorter version of the plan.", "alert": "", "note_unchanged": True}
    drafts = {label: dict(good_draft) for label in WRITING_HELP_EXTRA}
    autofill = {"door": True, "state": "suggestions", "count": 2, "alert": "", "note_unchanged": True}
    docx = {"gate": True, "status": "ready", "timed_out": False, "alert": "",
            "answer": f"The budget code is {DOCX_EXPECT}. [1]", "sources": 1}
    chips = [{"kind": "inline", "label": "Source 1", "x": 20, "y": 300, "w": 48, "h": 44},
             {"kind": "inline", "label": "Source 1", "x": 68, "y": 300, "w": 48, "h": 44},   # abuts
             {"kind": "source", "label": "Open source 1", "x": 16, "y": 420, "w": 358, "h": 52}]
    touch = {"toggle": {"w": 64, "h": 44}, "alert": "", "arrived": True, "chips": chips}
    healthy = dict(doors=1, alert="", answer=f"Entry {EXPECT[0]}, stop {EXPECT[1]}.", sources=1,
                   cited_opened=True, note_answer=f"Your stop is {NOTE_EXPECT}.", note_alert="",
                   draft="A short summary of the plan.", help_alert="", note_unchanged=True,
                   drafts=drafts, autofill=autofill, docx=docx, touch=touch)

    def with_draft(label, **kw):
        return {**healthy, "drafts": {**drafts, label: {**good_draft, **kw}}}

    def with_chip(idx, **kw):
        cs = [dict(c) for c in chips]
        cs[idx].update(kw)
        return {**healthy, "touch": {**touch, "chips": cs}}

    cases = [
        ("healthy", healthy, 0),
        ("intro still up: a 2, never a missing door", {**healthy, "doors": 0, "intro_present": True}, 2),
        ("no door", {**healthy, "doors": 0}, 1),
        ("alert shown", {**healthy, "alert": "Ask is unavailable right now."}, 1),
        ("empty answer", {**healthy, "answer": "   "}, 1),
        ("a number missing", {**healthy, "answer": f"Entry {EXPECT[0]} only."}, 1),
        ("no citation", {**healthy, "sources": 0}, 1),
        ("citation opened nothing", {**healthy, "cited_opened": False}, 1),
        ("note-scoped alert", {**healthy, "note_alert": "limit"}, 1),
        ("note-scoped answer without the stop", {**healthy, "note_answer": "I couldn't find that."}, 1),
        ("writing help alert", {**healthy, "help_alert": "You've used today's writing help"}, 1),
        ("empty draft", {**healthy, "draft": "The draft appears here."}, 1),
        ("Discard changed the note", {**healthy, "note_unchanged": False}, 1),
        # Leg C2
        ("Rewrite shorter: alert", with_draft("Rewrite shorter", alert="limit"), 1),
        ("Continue writing: placeholder draft", with_draft("Continue writing", draft="Writing…"), 1),
        ("Translate: empty draft", with_draft("Translate", draft="  "), 1),
        ("Translate: Discard changed the note", with_draft("Translate", note_unchanged=False), 1),
        ("Continue writing never measured", {**healthy, "drafts": {k: v for k, v in drafts.items() if k != "Continue writing"}}, 2),
        # Leg D
        ("autofill door absent", {**healthy, "autofill": {"door": False, "reason": "gate off"}}, 2),
        ("autofill error", {**healthy, "autofill": {**autofill, "state": "error", "alert": "Couldn't reach Compass."}}, 1),
        ("autofill unknown state", {**healthy, "autofill": {**autofill, "state": "weird"}}, 1),
        ("autofill never settled", {**healthy, "autofill": {**autofill, "state": "timeout"}}, 2),
        ("autofill changed the note", {**healthy, "autofill": {**autofill, "note_unchanged": False}}, 1),
        ("autofill found nothing (healthy)", {**healthy, "autofill": {**autofill, "state": "nothing", "count": 0}}, 0),
        ("autofill never measured", {**healthy, "autofill": None}, 2),
        # Leg E
        ("docx gate off", {**healthy, "docx": {**docx, "gate": False}}, 2),
        ("docx still pending", {**healthy, "docx": {**docx, "status": "pending", "timed_out": True}}, 2),
        ("docx extraction failed", {**healthy, "docx": {**docx, "status": "processing_failed"}}, 1),
        ("docx no text", {**healthy, "docx": {**docx, "status": "no_text"}}, 1),
        ("docx ask alert", {**healthy, "docx": {**docx, "alert": "limit"}}, 1),
        ("docx answer without the code", {**healthy, "docx": {**docx, "answer": "I couldn't find that in this note."}}, 1),
        ("docx answer cites nothing", {**healthy, "docx": {**docx, "sources": 0}}, 1),
        ("docx never measured", {**healthy, "docx": None}, 2),
        # Leg F
        ("touch: no toggle", {**healthy, "touch": {**touch, "toggle": None}}, 1),
        ("touch: toggle 40 high", {**healthy, "touch": {**touch, "toggle": {"w": 64, "h": 40}}}, 1),
        ("touch: toggle 43.6 wide is 44", {**healthy, "touch": {**touch, "toggle": {"w": 43.6, "h": 44}}}, 0),
        ("touch: alert", {**healthy, "touch": {**touch, "alert": "limit"}}, 1),
        ("touch: answer never arrived", {**healthy, "touch": {**touch, "arrived": False}}, 2),
        ("touch: no chips", {**healthy, "touch": {**touch, "chips": []}}, 1),
        ("touch: a chip 30 high", with_chip(0, h=30), 1),
        ("touch: a chip 20 wide", with_chip(1, w=20), 1),
        ("touch: two chips overlap", with_chip(1, x=60), 1),
        ("touch: one chip only", {**healthy, "touch": {**touch, "chips": chips[:1]}}, 2),
        ("touch never measured", {**healthy, "touch": None}, 2),
        # Precedence: a 1 anywhere beats a 2 anywhere.
        ("a 1 beats a 2", {**healthy, "autofill": None, "touch": {**touch, "chips": []}}, 1),
    ]
    bad = 0
    for name, kw, want in cases:
        code, why = verdict(**kw)
        ok = code == want
        bad += 0 if ok else 1
        print(f"  {'ok ' if ok else 'BAD'} {name}: {code} ({why[:110]})")
    # The overlap test's own control: abutting is not overlapping; sharing area is.
    abut = overlapping_pairs([{"x": 0, "y": 0, "w": 10, "h": 10}, {"x": 10, "y": 0, "w": 10, "h": 10}])
    share = overlapping_pairs([{"x": 0, "y": 0, "w": 10, "h": 10}, {"x": 9, "y": 9, "w": 10, "h": 10}])
    for name, got, want in (("overlap control: abutting boxes", abut, []),
                            ("overlap control: boxes sharing area", share, [[0, 1]])):
        ok = got == want
        bad += 0 if ok else 1
        print(f"  {'ok ' if ok else 'BAD'} {name}: {got}")
    print("SELF-CHECK " + ("PASS" if not bad else f"FAIL ({bad})"))
    return 0 if not bad else 1


# ── the Word file ────────────────────────────────────────────────────────────────────────────

def make_docx(path: Path, sentence: str) -> str:
    """Write a tiny .docx holding `sentence` as one paragraph. python-docx when importable, else a
    minimal valid package: [Content_Types].xml, _rels/.rels, word/document.xml -- the three parts
    `document_extraction.extract_docx_pages` needs (it reads `word/document.xml` and the `w:p` /
    `w:t` elements). Returns which writer was used."""
    try:
        import docx  # type: ignore  # noqa: PLC0415
        d = docx.Document()
        d.add_paragraph(sentence)
        d.save(str(path))
        return "python-docx"
    except ImportError:
        pass
    from xml.sax.saxutils import escape  # noqa: PLC0415
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '</Types>')
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="word/document.xml"/>'
        '</Relationships>')
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:body><w:p><w:r><w:t>{escape(sentence)}</w:t></w:r></w:p>'
        '<w:sectPr/></w:body></w:document>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", document)
    return "zipfile"


# ── browser helpers ──────────────────────────────────────────────────────────────────────────

ASK_SETTLED_JS = """(prev) => {
    const al = document.querySelector('[role="alert"]');
    if (al) return true;
    const a = document.querySelector('[data-testid="ask-answer"]');
    if (!a) return false;
    return a.getAttribute('aria-busy') === 'false' && (a.innerText || '').trim() !== prev;
}"""

DRAFT_SETTLED_JS = """() => {
    const r = document.querySelector("[role='region'][aria-label='Draft preview']");
    const a = document.querySelector("[role='alert']");
    if (a) return true;
    if (!r || r.getAttribute('aria-busy') === 'true') return false;
    const t = (r.innerText || '').trim();
    return t && t !== 'The draft appears here.' && t !== 'Writing…';
}"""

AUTOFILL_SETTLED_JS = """() => {
    const r = document.querySelector("[role='region'][aria-label='Suggested values']");
    if (!r) return false;
    if (r.querySelector('li[data-suggestion]')) return true;
    const s = r.querySelector("[role='status']");
    return Boolean(s && (s.innerText || '').trim());
}"""

CHIP_BOXES_JS = """() => {
    const out = [];
    const take = (sel, kind) => {
        document.querySelectorAll(sel).forEach((b) => {
            const r = b.getBoundingClientRect();
            out.push({kind, label: b.getAttribute('aria-label') || (b.innerText || '').trim(),
                      x: r.x, y: r.y, w: r.width, h: r.height});
        });
    };
    take('[data-testid="ask-sources"] button', 'source');
    take('[data-testid="ask-answer"] button', 'inline');
    return out;
}"""

GROUP_SEL = "[role='group'][aria-label='What should Compass do?']"


def _clear_intro(page, step, tag: str) -> bool:
    """After a page load: finish the cinematic intro and wait for Research Home's door to be
    VISIBLE with the intro's root gone. Returns True when the intro is gone (or never mounted
    within the budget while the door became visible), False when it still covers the page at
    the deadline -- the caller treats that as INCONCLUSIVE, never as a missing door.

    ⛔ Polled, because the intro mounts with the app root AFTER `domcontentloaded` and an Escape
    sent before it exists dismisses nothing. Each pass sends Escape (consumed by the intro's
    capture listener), clicks Skip when it is visible, and asks whether the root is detached."""
    deadline = time.time() + INTRO_BUDGET_MS / 1000
    seen = False
    skipped = False
    while time.time() < deadline:
        intro = page.locator(INTRO_SEL)
        if intro.count():
            seen = True
            page.keyboard.press("Escape")
            skip = page.locator(INTRO_SKIP_SEL)
            try:
                if skip.count() and skip.first.is_visible():
                    skip.first.click(timeout=2_000)
                    skipped = True
            except Exception:
                pass
        else:
            toggle = page.locator("[data-ask-toggle]")
            welcome = page.locator("h2:has-text('Welcome to your Notebook')")
            if (toggle.count() and toggle.first.is_visible()) or welcome.count():
                step(f"intro_{tag}", seen=seen, skipped=skipped, gone=True)
                return True
        page.wait_for_timeout(400)
    gone = page.locator(INTRO_SEL).count() == 0
    step(f"intro_{tag}", seen=seen, skipped=skipped, gone=gone, deadline=True)
    return gone


def _ask(page, scope: str, question: str, out: Path, tag: str, step, previous: str = "") -> tuple[str, str, int]:
    """Open the Ask door for `scope`, ask, wait. Returns (answer, alert, sources). `previous` is the
    answer already on screen in a panel that was used before, so a settled OLD answer cannot read
    as the new one."""
    page.locator(f"[data-ask-toggle][aria-label='Ask a question about {scope}']").first.click()
    input_id = "#ask-input-" + ("notebook" if scope == "my notebook" else "note")
    page.wait_for_selector(input_id, timeout=15_000)
    page.fill(input_id, question)
    page.get_by_role("button", name="Ask", exact=True).click()
    step(f"asked_{tag}")
    page.wait_for_function(ASK_SETTLED_JS, arg=previous.strip(), timeout=120_000)
    alert = page.locator('[role="alert"]')
    alert_text = alert.first.inner_text()[:300] if alert.count() else ""
    ans_loc = page.locator('[data-testid="ask-answer"]')
    answer = ans_loc.first.inner_text() if ans_loc.count() else ""
    sources = page.locator('[data-testid="ask-sources"] button').count()
    page.screenshot(path=str(out / f"{tag}.png"), full_page=True)
    return answer, alert_text, sources


def _writing_help(page, label: str, out: Path, tag: str, step) -> tuple[str, str]:
    """Open Writing help, pick `label`, Write it, wait for the draft (or a refusal), screenshot,
    Discard (or Cancel after a refusal), and wait for the sheet to close. Returns (draft, alert).
    Raises on a timeout -- the caller decides that is INCONCLUSIVE."""
    page.locator("button[aria-label='Writing help']").first.click()
    page.wait_for_selector(GROUP_SEL, timeout=15_000)
    page.locator(GROUP_SEL).get_by_role("button", name=label, exact=True).click()
    page.get_by_role("button", name="Write it", exact=True).click()
    step(f"writing_help_asked_{tag}", choice=label)
    page.wait_for_function(DRAFT_SETTLED_JS, timeout=120_000)
    alert_loc = page.locator("[role='alert']")
    alert = alert_loc.first.inner_text()[:300] if alert_loc.count() else ""
    draft = page.locator("[role='region'][aria-label='Draft preview']").first.inner_text()
    page.screenshot(path=str(out / f"writing-help-{tag}.png"), full_page=True)
    discard = page.get_by_role("button", name="Discard", exact=True)
    if discard.count():
        discard.first.click()
    else:
        page.get_by_role("button", name="Cancel", exact=True).first.click()
    page.locator(GROUP_SEL).wait_for(state="hidden", timeout=10_000)
    page.wait_for_timeout(1500)  # a settle for any autosave the panel might (must not) cause
    return draft, alert


def _login(api, base: str, email: str, pw: str) -> tuple[int, int, str]:
    r = api.post(f"{base}/api/auth/login", data=json.dumps({"email": email, "password": pw}),
                 headers={"Content-Type": "application/json"})
    if not r.ok:
        return r.status, 0, ""
    me = api.get(f"{base}/api/auth/me")
    try:
        body = me.json()
        who = (body.get("user") or {}).get("email") or body.get("email") or ""
    except Exception:
        who = ""
    return r.status, me.status, who


def _inventory(api, base: str) -> dict:
    """How many notes the account holds, active and in the trash, as the API reports them -- read
    before and after so the report can say nothing was left behind."""
    out = {}
    for key, q in (("active", ""), ("trash", "&deleted=true")):
        try:
            r = api.get(f"{base}/api/j2/notes?limit=1{q}")
            b = r.json()
            out[key] = b.get("total", len(b.get("notes") or []))
        except Exception:
            out[key] = None
    return out


def run(base: str, out: Path) -> int:
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    email = os.environ.get("SMOKE_EMAIL")
    pw = os.environ.get("SMOKE_PASSWORD")
    if not email or not pw:
        print("INCONCLUSIVE: SMOKE_EMAIL / SMOKE_PASSWORD not in the environment")
        return 2
    out.mkdir(parents=True, exist_ok=True)
    rec: dict = {"base": base, "steps": []}
    t0 = time.time()

    def step(name, **kw):
        kw["t"] = round(time.time() - t0, 1)
        rec["steps"].append({"name": name, **kw})
        print(f"  {name}: {json.dumps(kw)}")

    def save():
        (out / "result.json").write_text(json.dumps(rec, indent=1), encoding="utf-8")

    def finish(code: int, why: str) -> int:
        rec["verdict"] = {"code": code, "why": why}
        save()
        print(f"evidence: {out}")
        print(("PASS: " if code == 0 else "FAIL: " if code == 1 else "INCONCLUSIVE: ") + why)
        return code

    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)[:200]))
        api = page.request

        login_status, me_status, who = _login(api, base, email, pw)
        step("login", status=login_status)
        if not login_status or login_status >= 400:
            return finish(2, "sign-in refused")
        domain_ok = who.endswith(SYNTHETIC_DOMAIN)
        step("me", status=me_status, synthetic_domain=domain_ok)
        if not domain_ok:
            return finish(2, "not the synthetic smoke account; nothing written")
        rec["inventory_before"] = _inventory(api, base)
        step("inventory_before", **rec["inventory_before"])

        note_id = None
        touch_ctx = None
        try:
            doc = {"type": "doc", "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": TEXT_P1}]},
                {"type": "paragraph", "content": [{"type": "text", "text": TEXT_P2}]},
            ]}
            c = api.post(f"{base}/api/j2/notes", data=json.dumps({"title": TITLE, "bodyJson": doc}),
                         headers={"Content-Type": "application/json"})
            try:
                note_id = (c.json().get("note") or {}).get("id")
            except Exception:
                note_id = None
            step("note_created", status=c.status, id_present=bool(note_id))
            if not note_id:
                return finish(2, "the check note could not be created")

            # Leg A: the home's door and a whole-Notebook question.
            page.goto(f"{base}/journal/notebook", wait_until="domcontentloaded", timeout=60_000)
            try:
                page.wait_for_selector("[data-ask-toggle], h2:has-text('Welcome to your Notebook')", timeout=45_000)
            except Exception as e:
                page.screenshot(path=str(out / "home-timeout.png"), full_page=True)
                step("home", settled=False, error=str(e)[:160])
                return finish(2, "Research Home never settled")
            if not _clear_intro(page, step, "home"):
                page.screenshot(path=str(out / "home-intro.png"), full_page=True)
                return finish(*verdict(doors=0, alert="", answer="", sources=0, cited_opened=None,
                                       intro_present=True))
            quiet = page.get_by_text("Nothing needs your attention right now.").count() > 0
            full = page.get_by_text("Continue working").count() > 0
            doors = page.locator("[data-ask-toggle]").count()
            home_state = "quiet" if quiet else "full" if full else "other"
            rec["home_state"] = home_state
            step("home", state=home_state, ask_doors=doors)
            page.screenshot(path=str(out / "home.png"), full_page=True)
            if doors == 0:
                return finish(*verdict(doors=0, alert="", answer="", sources=0, cited_opened=None))
            try:
                answer, alert_text, sources = _ask(page, "my notebook", QUESTION, out, "answer", step)
            except Exception as e:
                page.screenshot(path=str(out / "ask-timeout.png"), full_page=True)
                step("answer", arrived=False, error=str(e)[:160])
                return finish(2, "no whole-Notebook answer within 120 s")
            step("answer", chars=len(answer), sources=sources, numbers=all(x in answer for x in EXPECT),
                 alert=alert_text, page_errors=len(errors))
            rec.update({"answer_excerpt": answer[:500], "sources": sources, "alert": alert_text})

            cited_opened: bool | None = None
            if sources:
                page.locator('[data-testid="ask-sources"] button').first.click()
                try:
                    page.wait_for_url(lambda u: note_id in u, timeout=15_000)
                    cited_opened = True
                except Exception:
                    cited_opened = note_id in page.url
                step("citation_opens_note", opened=cited_opened)
                page.screenshot(path=str(out / "cited-note.png"), full_page=True)
            rec["cited_opened"] = cited_opened
            base_kw = dict(doors=doors, alert=alert_text, answer=answer, sources=sources,
                           cited_opened=cited_opened, home_state=home_state)
            early = verdict(**base_kw)
            if early[0] == 1:
                return finish(*early)

            # Leg B: Ask inside the note (we are on it: the citation opened it).
            try:
                page.wait_for_selector("[data-ask-toggle][aria-label='Ask a question about this note']", timeout=30_000)
                note_answer, note_alert, _ = _ask(page, "this note", NOTE_QUESTION, out, "note-answer", step)
            except Exception as e:
                page.screenshot(path=str(out / "note-ask-timeout.png"), full_page=True)
                step("note_answer", arrived=False, error=str(e)[:160])
                return finish(2, "no note-scoped answer within 120 s")
            step("note_answer", chars=len(note_answer), has_stop=NOTE_EXPECT in note_answer, alert=note_alert)
            rec.update({"note_answer_excerpt": note_answer[:300], "note_alert": note_alert})
            page.get_by_role("button", name="Close Ask").first.click()
            base_kw.update(note_answer=note_answer, note_alert=note_alert)
            early = verdict(**base_kw)
            if early[0] == 1:
                return finish(*early)

            # Leg C: writing help, Summarize, then Discard. The note must not change.
            before = api.get(f"{base}/api/j2/notes/{note_id}").text()
            if page.locator("button[aria-label='Writing help']").count() == 0:
                step("writing_help", door=False)
                return finish(2, "the Writing help door is not rendered (switch off, or the note is locked)")
            try:
                draft, help_alert = _writing_help(page, "Summarize", out, "summarize", step)
            except Exception as e:
                page.screenshot(path=str(out / "writing-help-timeout.png"), full_page=True)
                step("writing_help", arrived=False, error=str(e)[:160])
                return finish(2, "no writing-help draft within 120 s")
            after = api.get(f"{base}/api/j2/notes/{note_id}").text()
            note_unchanged = before == after
            step("writing_help", choice="Summarize", draft_chars=len(draft.strip()), alert=help_alert,
                 note_unchanged=note_unchanged)
            rec.update({"draft_excerpt": draft[:300], "help_alert": help_alert, "note_unchanged": note_unchanged})
            base_kw.update(draft=draft, help_alert=help_alert, note_unchanged=note_unchanged)
            early = verdict(**base_kw)
            if early[0] == 1:
                return finish(*early)

            # Leg C2: the other three choices, each discarded, the note byte-identical after each.
            drafts: dict = {}
            rec["drafts"] = drafts
            for label in WRITING_HELP_EXTRA:
                tag = label.lower().replace(" ", "-")
                before = api.get(f"{base}/api/j2/notes/{note_id}").text()
                try:
                    d, a = _writing_help(page, label, out, tag, step)
                except Exception as e:
                    page.screenshot(path=str(out / f"writing-help-{tag}-timeout.png"), full_page=True)
                    step("writing_help", choice=label, arrived=False, error=str(e)[:160])
                    return finish(2, f"no writing-help draft for '{label}' within 120 s")
                after = api.get(f"{base}/api/j2/notes/{note_id}").text()
                drafts[label] = {"draft": d[:300], "alert": a, "note_unchanged": before == after,
                                 "draft_chars": len(d.strip())}
                step("writing_help", choice=label, draft_chars=len(d.strip()), alert=a,
                     note_unchanged=before == after)
                early = verdict(**base_kw, drafts=drafts)
                if early[0] == 1:
                    return finish(*early)

            # Leg D: property autofill -- Suggest values, then Close, nothing applied.
            autofill: dict = {"door": False, "reason": "", "state": None, "count": 0, "alert": "",
                              "note_unchanged": True}
            rec["autofill"] = autofill
            before = api.get(f"{base}/api/j2/notes/{note_id}").text()
            suggest = page.locator("button[aria-label='Suggest values with Compass']")
            if suggest.count() == 0:
                try:
                    props = api.get(f"{base}/api/j2/notes/{note_id}/properties").json().get("properties") or []
                    empties = [p for p in props if p.get("source") == "user_set" and p.get("value") is None]
                    autofill["reason"] = (f"not rendered; {len(empties)} empty member-set propert"
                                          f"{'y' if len(empties) == 1 else 'ies'} on the note, "
                                          f"{'so the gate or the lock is the cause' if empties else 'so there is nothing to fill'}")
                except Exception as e:
                    autofill["reason"] = f"not rendered; properties unreadable ({type(e).__name__})"
                step("autofill", door=False, reason=autofill["reason"])
                page.screenshot(path=str(out / "autofill-absent.png"), full_page=True)
            else:
                autofill["door"] = True
                suggest.first.click()
                step("autofill_asked")
                try:
                    page.wait_for_function(AUTOFILL_SETTLED_JS, timeout=120_000)
                    region = page.locator("[role='region'][aria-label='Suggested values']").first
                    n = region.locator("li[data-suggestion]").count()
                    status = region.locator("[role='status']")
                    status_text = status.first.inner_text().strip() if status.count() else ""
                    if n:
                        autofill["state"] = "suggestions"
                    elif status_text == AUTOFILL_NOTHING_SENTENCE:
                        autofill["state"] = "nothing"
                    else:
                        autofill["state"] = "error"
                        autofill["alert"] = status_text[:300]
                    autofill["count"] = n
                    autofill["suggestions"] = [
                        {"name": li.locator("span").nth(0).inner_text(), "value": li.locator("span").nth(1).inner_text()}
                        for li in region.locator("li[data-suggestion]").all()[:8]]
                    page.screenshot(path=str(out / "autofill.png"), full_page=True)
                    region.get_by_role("button", name="Close", exact=True).click()
                    page.locator("[role='region'][aria-label='Suggested values']").wait_for(state="hidden", timeout=10_000)
                except Exception as e:
                    autofill["state"] = "timeout"
                    autofill["alert"] = str(e)[:160]
                    page.screenshot(path=str(out / "autofill-timeout.png"), full_page=True)
                page.wait_for_timeout(1500)
                after = api.get(f"{base}/api/j2/notes/{note_id}").text()
                autofill["note_unchanged"] = before == after
                step("autofill", door=True, state=autofill["state"], count=autofill["count"],
                     alert=autofill["alert"], note_unchanged=autofill["note_unchanged"])
            early = verdict(**base_kw, drafts=drafts, autofill=autofill)
            if early[0] == 1:
                return finish(*early)

            # Leg E: G-166 -- a Word file through the note's attachment door, then Ask inside the note.
            docx_rec: dict = {"gate": False, "status": None, "timed_out": False, "alert": "", "answer": "",
                              "sources": 0, "writer": None}
            rec["docx"] = docx_rec
            with tempfile.TemporaryDirectory(prefix="prod-ask-docx-") as tmp:
                path = Path(tmp) / DOCX_NAME
                docx_rec["writer"] = make_docx(path, DOCX_SENTENCE)
                data = path.read_bytes()
            docx_rec["bytes"] = len(data)
            up = api.post(f"{base}/api/j2/notes/{note_id}/attachments",
                          multipart={"file": {"name": DOCX_NAME, "mimeType": DOCX_MIME, "buffer": data}})
            try:
                att = up.json()
            except Exception:
                att = {}
            docx_rec["upload_status"] = up.status
            docx_rec["attachment_url_suffix"] = (att.get("url") or "")[-12:]
            step("docx_uploaded", status=up.status, bytes=len(data), writer=docx_rec["writer"],
                 url_ends_docx=(att.get("url") or "").lower().endswith(".docx"))
            if not up.ok:
                return finish(2, f"the Word file upload answered {up.status}")
            started = time.time()
            deadline = started + DOC_POLL_S
            doc_row = None
            while True:
                try:
                    docs = api.get(f"{base}/api/j2/notes/{note_id}/documents").json().get("documents") or []
                except Exception:
                    docs = []
                doc_row = next((d for d in docs if d.get("attachmentUrl") == att.get("url")), None)
                if doc_row is None and docs:
                    doc_row = next((d for d in docs if d.get("name") == DOCX_NAME), None)
                if doc_row is not None:
                    docx_rec["gate"] = True
                    docx_rec["status"] = doc_row.get("status")
                    docx_rec["kind"] = doc_row.get("kind")
                    docx_rec["pages_with_text"] = doc_row.get("pagesWithText")
                    if doc_row.get("status") in DOC_SETTLED:
                        break
                elif time.time() - started > 20:
                    # 20 s with no row at all: the hand-off made none, which is the gate.
                    break
                if time.time() > deadline:
                    docx_rec["timed_out"] = True
                    break
                page.wait_for_timeout(2000)
            step("docx_document", gate=docx_rec["gate"], status=docx_rec["status"], kind=docx_rec.get("kind"),
                 pages_with_text=docx_rec.get("pages_with_text"), timed_out=docx_rec["timed_out"])
            if docx_rec["gate"] and docx_rec["status"] == "ready":
                try:
                    prev = page.locator('[data-testid="ask-answer"]')
                    prev_text = prev.first.inner_text() if prev.count() else ""
                    d_answer, d_alert, d_sources = _ask(page, "this note", DOCX_QUESTION, out, "docx-answer",
                                                        step, previous=prev_text)
                    docx_rec.update({"answer": d_answer[:500], "alert": d_alert, "sources": d_sources,
                                     "has_code": DOCX_EXPECT in d_answer})
                    labels = page.locator('[data-testid="ask-sources"] button').all()
                    docx_rec["source_labels"] = [b.get_attribute("aria-label") for b in labels][:8]
                    page.get_by_role("button", name="Close Ask").first.click()
                except Exception as e:
                    page.screenshot(path=str(out / "docx-ask-timeout.png"), full_page=True)
                    step("docx_answer", arrived=False, error=str(e)[:160])
                    return finish(2, "no answer to the Word-file question within 120 s")
                step("docx_answer", chars=len(docx_rec["answer"]), has_code=docx_rec.get("has_code"),
                     sources=docx_rec["sources"], alert=docx_rec["alert"])
            early = verdict(**base_kw, drafts=drafts, autofill=autofill, docx=docx_rec)
            if early[0] == 1:
                return finish(*early)

            # Leg F: the touch context -- a second browser context, the same account, Research Home.
            touch: dict = {"toggle": None, "alert": "", "arrived": False, "chips": [], "overlaps": []}
            rec["touch"] = touch
            touch_ctx = br.new_context(viewport=TOUCH_VIEWPORT, device_scale_factor=TOUCH_DPR,
                                       is_mobile=True, has_touch=True)
            tpage = touch_ctx.new_page()
            t_login, t_me, t_who = _login(tpage.request, base, email, pw)
            step("touch_login", status=t_login, synthetic_domain=t_who.endswith(SYNTHETIC_DOMAIN))
            if not t_who.endswith(SYNTHETIC_DOMAIN):
                return finish(2, "the touch context did not sign in as the smoke account")
            tpage.goto(f"{base}/journal/notebook", wait_until="domcontentloaded", timeout=60_000)
            try:
                tpage.wait_for_selector("[data-ask-toggle]", timeout=45_000)
            except Exception as e:
                tpage.screenshot(path=str(out / "touch-home-timeout.png"), full_page=True)
                step("touch_home", settled=False, error=str(e)[:160])
                return finish(2, "Research Home never showed an Ask door in the touch context")
            if not _clear_intro(tpage, step, "touch_home"):
                tpage.screenshot(path=str(out / "touch-home-intro.png"), full_page=True)
                return finish(2, f"the intro animation still covered Research Home in the touch context "
                                 f"after {INTRO_BUDGET_MS // 1000} s; no toggle was measurable")
            touch["viewport"] = tpage.evaluate("() => ({innerWidth, innerHeight, dpr: devicePixelRatio,"
                                               " coarse: matchMedia('(pointer: coarse)').matches})")
            tog = tpage.locator("[data-ask-toggle]").first
            bb = tog.bounding_box()
            touch["toggle"] = {"x": bb["x"], "y": bb["y"], "w": bb["width"], "h": bb["height"]} if bb else None
            step("touch_toggle", toggle=touch["toggle"], **touch["viewport"])
            tpage.screenshot(path=str(out / "touch-home.png"), full_page=True)
            if touch["toggle"] is None:
                return finish(*verdict(**base_kw, drafts=drafts, autofill=autofill, docx=docx_rec, touch=touch))
            try:
                t_answer, t_alert, t_sources = _ask(tpage, "my notebook", QUESTION, out, "touch-answer", step)
                touch["arrived"] = True
                touch["alert"] = t_alert
                touch["answer_excerpt"] = t_answer[:300]
                touch["sources"] = t_sources
            except Exception as e:
                tpage.screenshot(path=str(out / "touch-ask-timeout.png"), full_page=True)
                step("touch_answer", arrived=False, error=str(e)[:160])
            if touch["arrived"]:
                chips = tpage.evaluate(CHIP_BOXES_JS)
                touch["chips"] = chips
                touch["overlaps"] = overlapping_pairs(chips)
                touch["inline_chips"] = sum(1 for c in chips if c["kind"] == "inline")
                touch["source_chips"] = sum(1 for c in chips if c["kind"] == "source")
                touch["min_w"] = min((c["w"] for c in chips), default=None)
                touch["min_h"] = min((c["h"] for c in chips), default=None)
                step("touch_chips", n=len(chips), inline=touch["inline_chips"], source=touch["source_chips"],
                     min_w=touch["min_w"], min_h=touch["min_h"], overlaps=len(touch["overlaps"]),
                     alert=t_alert, sources=t_sources)
                tpage.screenshot(path=str(out / "touch-chips.png"), full_page=False)

            return finish(*verdict(**base_kw, drafts=drafts, autofill=autofill, docx=docx_rec, touch=touch))
        finally:
            if note_id:
                d = api.delete(f"{base}/api/j2/notes/{note_id}")
                g = api.get(f"{base}/api/j2/notes/{note_id}")
                gd = api.get(f"{base}/api/j2/notes/{note_id}/documents")
                step("note_removed", delete_status=d.status, get_after=g.status, documents_after=gd.status)
                rec["note_removed"] = {"delete": d.status, "get_after": g.status, "documents_after": gd.status}
                rec["inventory_after"] = _inventory(api, base)
                step("inventory_after", **rec["inventory_after"])
                save()
            if touch_ctx is not None:
                touch_ctx.close()
            ctx.close()
            br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=PROD)
    ap.add_argument("--out", default=None, help="evidence directory (default: a temp directory)")
    ap.add_argument("--self-check", action="store_true", help="rule 14: prove the verdict can fail")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    out = Path(args.out) if args.out else Path(tempfile.mkdtemp(prefix="prod-ask-"))
    return run(args.base, out)


if __name__ == "__main__":
    sys.exit(main())

"""The KEYED walk: the Notebook's AI features against real models, in a sandbox.

Called by tools/notebook_fin_walk.py (`--config keyed`), which owns the boot, the recorder and the
integrity checkpoints. The owner authorised two model keys for this. They reach the sandbox only
through the key helper that starts the walk; this file never reads, prints or stores a key.

    python <scratch>/fin/with_model_keys.py -- python tools/notebook_fin_walk.py --config keyed \
        --tip <sha> --data-root <dir> --port 8132 --out docs/notebook/evidence/fin-walk/keyed-<sha>

What is recorded: requests and responses to OUR server only (the vendor calls happen inside the
server process and are never seen here), the rendered result, console and page errors.

Only made-up notes and trades go to the vendors. One or two calls per feature.

This driver never imports api.*. Never run on import.
"""
from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import traceback
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
for _p in (REPO / "tools", REPO / "scripts"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import notebook_perf_harness as h  # noqa: E402

ORDER = ["ask_note", "ask_notebook", "writing", "docs", "actions", "autofill", "compass", "dictation",
         "voicenote", "meaning", "briefing", "phone"]

# ── the made-up corpus ─────────────────────────────────────────────────────────────────────
NOTE_A = ("CRWD breakout plan", "CRWD", [
    "The base has tightened for five weeks under the pivot.",
    "My entry is a buy stop at 312.40 once volume expands.",
    "The stop goes under the base low at 298.75, and the first target is 355.",
    "The catalyst is the Falcon Flex renewal cycle that management described last quarter.",
])
NOTE_B = ("CRWD after the report", "CRWD", [
    "CRWD held the 21 day line after the report.",
    "Net new ARR came in at 218 million, which was above my own estimate.",
    "I trimmed 50 shares at 341.10 and kept the rest with the stop raised to breakeven.",
])
MEANING_NOTES = [
    ("Bedtime rule", None, ["I trade worse after a short night. Lights out by ten keeps my morning decisions calm."]),
    ("Copper inventories", None, ["Warehouse stocks of copper in Shanghai fell for a sixth week."]),
    ("Position sizing table", None, ["One percent of the account per idea, two percent only on the best setups."]),
    ("Fed meeting recap", None, ["The committee held rates and the dot plot moved one cut into next year."]),
    ("Semis breadth", None, ["Fewer chip names are above their 50 day line than a month ago."]),
]
MEANING_QUERY = "rest and fatigue hurting judgement"     # shares no word with "Bedtime rule" or its body
WH_PARAS = [
    "Semiconductor leaders pulled back to their rising ten week lines on lighter volume this week.",
    "I want to see NVDA reclaim 131 on a strong close before adding, because the last two attempts failed "
    "within a day and each failure cost me a half percent of the account. Patience has paid better than "
    "anticipation in this group all year, so the plan is to wait for the close and buy the next morning.",
    "Breadth in the group is narrow, which argues for smaller size.",
]
AUTOFILL_NOTE = ("NVDA long thesis", "NVDA", [
    "This thesis is active and my conviction is high.",
    "The setup is a flat base breakout. Entry 131.20, stop 124.50, target 152.",
    "I am watching this for the next two weeks.",
])
SPEECH_DICTATION = "I bought one hundred shares of Nvidia above the pivot, and my stop is under yesterday's low."
SPEECH_VOICE_NOTE = ("Quick note on today. Nvidia held its ten week line and I added a small position. "
                     "Tesla failed at resistance, so I am staying out. Tomorrow I need to review my stops.")
DOCX_PARAS = ["Zebra Logistics quarterly memo.", "Fleet utilisation reached 87 percent in the quarter.",
              "The Tacoma depot opens on March 9."]
IMAGE_LINES = ["ACME FASTENERS", "INVOICE 4471", "TOTAL DUE 912 DOLLARS"]

COMMON = set("""the a an i it this that these those your my you we they he she there here based according however also
note notes notebook compass source sources no not nothing none unfortunately sorry in on at as for from with if is are
was were but and or so to of by what when where which while after before both each one two all any your yes per its
his her their our entry stop target catalyst net plan answer summary key action items tickers transcript""".split())


def doc_of(paras: list[str]) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": p}]} for p in paras]}


def unsupported(answer: str, corpus: str) -> dict:
    """Every number and proper noun in `answer` that is not in `corpus`. Citation handles are not
    numbers. A capitalised word that only opens a sentence is listed apart (it may be plain English)."""
    a = re.sub(r"\[\d+\]", " ", answer or "")
    low = corpus.lower()
    low_nocomma = low.replace(",", "")
    nums, nouns, openers = [], [], []
    for m in re.finditer(r"\d[\d,]*(?:\.\d+)?", a):
        t = m.group(0).replace(",", "").rstrip(".")
        if t and t not in low_nocomma and m.group(0) not in nums:
            nums.append(m.group(0))
    for m in re.finditer(r"\b[A-Z][A-Za-z0-9'&-]*\b", a):
        wd = m.group(0)
        if wd == "I" or wd.lower().rstrip("'s") in low or wd.lower() in low:
            continue
        if wd.isupper() and 2 <= len(wd) <= 5:      # an abbreviation of words that ARE there (CFO, ARR)
            initials = "".join(x[0] for x in re.findall(r"[a-z]+", low))
            if wd.lower() in initials:
                continue
        before = a[:m.start()].rstrip(" \t*_\"'(")
        opens = (not before) or before[-1] in ".!?:\n-•"
        if opens:
            if wd.lower() not in COMMON and wd not in openers:
                openers.append(wd)
        elif wd.lower() not in COMMON and wd not in nouns:
            nouns.append(wd)
    return {"numbers": nums, "proper_nouns": nouns, "sentence_openers_not_in_corpus": openers}


def synth_wav(text: str, dest: Path) -> str | None:
    """Offline speech (Windows System.Speech). Returns None on success, else the reason."""
    ps = ("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
          f"$s.Rate = 0; $s.SetOutputToWaveFile('{dest}'); $s.Speak('{text.replace(chr(39), chr(39) * 2)}'); $s.Dispose()")
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, text=True, timeout=120)
    except Exception as e:  # noqa: BLE001
        return f"{type(e).__name__}: {str(e)[:160]}"
    if r.returncode != 0 or not dest.is_file() or dest.stat().st_size < 20000:
        return f"speech synthesis rc {r.returncode}: {(r.stderr or '')[:200]}"
    return None


def make_docx(paras: list[str]) -> bytes:
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paras)
    ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/document.xml", f'<?xml version="1.0" encoding="UTF-8"?><w:document {ns}><w:body>{body}</w:body></w:document>')
    return buf.getvalue()


def make_png(lines: list[str]) -> bytes:
    from PIL import Image, ImageDraw, ImageFont
    im = Image.new("RGB", (1100, 420), "white")
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("arial.ttf", 64)
    except Exception:  # noqa: BLE001
        font = ImageFont.load_default()
    for i, ln in enumerate(lines):
        d.text((50, 40 + i * 110), ln, fill="black", font=font)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


SWEEP_CHILD = r'''
import json, sys, os
repo, data_dir, flags = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo); sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True, allow_model_keys=True)
for k in flags:
    os.environ[k] = "1"
from api.services.journal_two import note_semantic as ns
print("SWEEP " + json.dumps({"provider": ns.provider_mode(), "result": ns.run_sweep()}, default=str))
'''


def run(C, browser, admin, base, fs, data_dir, only) -> None:
    S = C.STATE
    cfg = "keyed"
    steps = [s for s in ORDER if (not only or s in only)]
    PW = "LocalTest2026!"
    if S.get("keyed_email"):
        ctx = C.new_ctx(browser, "1280")
        ctx.request.post(base + "/api/auth/login", data={"email": S["keyed_email"], "password": PW})
        me = ctx.request.get(base + "/api/auth/me").json()
        if not me.get("paid_equiv"):
            raise h.SetupFailed(f"could not re-enter {S['keyed_email']} as a paid member")
    else:
        ctx, email, me = C.member(browser, admin.request, base, "key", "1280")
        S["keyed_email"] = email
    inst = C.Inst(ctx, cfg, "1280")
    pg = ctx.new_page()
    M = ctx.request
    flags = {f: me.get(f.lower()) for f in fs["keyed"] if f in fs["gates"]}
    C.step(None, inst, "flags", "auth payload: every keyed switch reads ON", "PASS" if all(flags.values()) else "FAIL",
           email=S["keyed_email"], off=[k for k, v in flags.items() if not v], shot=False)
    # the boot's own lines about what is off and how the keys are treated (names only)
    try:
        boot = (C.OUT / "sandbox-keyed.log").read_text(encoding="utf-8", errors="replace")
        lines = [ln.strip()[:200] for ln in boot.splitlines() if re.search(r"Model keys|Scheduler|scheduler|Outbound|outbound|Discord|DATA_DIR|WORKER", ln)][:14]
        C.step(None, inst, "sandbox", "boot output: model keys opted in, schedulers and outbound channels off", "INFO", boot_lines=lines, shot=False)
    except Exception:  # noqa: BLE001
        pass

    def run_step(name, fn):
        if name not in steps:
            return
        try:
            fn()
        except h.SetupFailed:
            raise
        except Exception as e:  # noqa: BLE001 -- recorded; the walk goes on
            C.step(pg, inst, name, "driver exception (the step did not finish)", "FAIL",
                   error=f"{type(e).__name__}: {str(e)[:600]}", traceback=traceback.format_exc()[-1600:])

    def mk(title, ticker, paras, key):
        if S.get(key):
            return S[key]
        body = {"title": title, "bodyJson": doc_of(paras)}
        if ticker:
            body["ticker"] = ticker
        st, b = C.api(ctx, inst, "POST", base, "/api/j2/notes", body)
        S[key] = b["note"]["id"]
        return S[key]

    def note_json(nid, req=None):
        r = (req or M).get(f"{base}/api/j2/notes/{nid}")
        return (r.json().get("note") or {}) if r.status == 200 else {}

    def open_note(p_, nid):
        C.goto(p_, base, f"/journal/notebook?note={nid}", ".ProseMirror")
        p_.wait_for_timeout(1200)

    def sse(req, path, payload, timeout=240000):
        """One streamed answer from OUR server, read whole. Recorded with request and response."""
        r = req.post(base + path, data=payload, timeout=timeout)
        raw = r.text() or ""
        events = []
        for block in raw.split("\n\n"):
            for ln in block.split("\n"):
                if ln.startswith("data:"):
                    try:
                        events.append(json.loads(ln[5:]))
                    except Exception:  # noqa: BLE001
                        pass
        C.REC.setdefault("api_writes", []).append({"config": cfg, "method": "POST", "url": path, "status": r.status,
                                                    "request": json.dumps(payload)[:1500], "response": raw[:9000]})
        final = next((e for e in events if e.get("type") == "final"), {})
        srcs = next((e for e in events if e.get("type") == "sources"), {})
        err = next((e for e in events if e.get("type") == "error"), None)
        text = final.get("answer") or "".join(e.get("text", "") for e in events if e.get("type") == "delta")
        return {"status": r.status, "answer": text, "sources": srcs.get("sources") or [], "cited": final.get("cited"),
                "invalid": final.get("invalidCitations"), "error": err, "events": len(events),
                "body": raw[:300] if r.status != 200 else None, "coverage": srcs.get("coverageNotice"), "final": final}

    def ask_ui(p_, question, input_id, timeout=150000):
        box = p_.locator(f"#{input_id}")
        box.wait_for(state="visible", timeout=15000)
        box.fill(question)
        box.press("Enter")
        ans = p_.locator('[data-testid="ask-answer"][aria-busy="false"]')
        alert = p_.locator('[role="dialog"] [role="alert"]')
        t0 = time.time()
        while time.time() - t0 < timeout / 1000:
            if ans.count() and ans.first.is_visible():
                break
            if alert.count() and alert.first.is_visible():
                break
            p_.wait_for_timeout(500)
        p_.wait_for_timeout(800)
        out = {"answer": ans.first.inner_text() if ans.count() else "",
               "alert": alert.first.inner_text() if alert.count() and alert.first.is_visible() else None,
               "chips": p_.locator("[data-citation]").count(),
               "sources": [x.replace("\n", " ") for x in p_.locator('[data-testid="ask-sources"] button').all_inner_texts()],
               "scope": p_.locator('[data-testid="ask-scope"]').first.inner_text() if p_.locator('[data-testid="ask-scope"]').count() else None,
               "seconds": round(time.time() - t0, 1)}
        return out

    def open_ask(p_):
        t = p_.locator("[data-ask-toggle]").filter(visible=True)
        if not t.count():
            more = p_.get_by_role("button", name="More note actions").filter(visible=True)
            if more.count():
                more.first.click()
                p_.wait_for_timeout(400)
        t = p_.locator("[data-ask-toggle]").filter(visible=True)
        t.first.click(timeout=15000)

    # ── 1. Ask this note ────────────────────────────────────────────────────────────────
    def ask_note_on(p_, inst_, vp, do_absent=True):
        nid = mk(*NOTE_A[:2], NOTE_A[2], "note_a")
        corpus = NOTE_A[0] + " " + " ".join(NOTE_A[2])
        open_note(p_, nid)
        open_ask(p_)
        q = "Where is my stop and what is the first target?"
        a = ask_ui(p_, q, "ask-input-note")
        bad = unsupported(a["answer"], corpus + " " + q)
        ok = ("298.75" in a["answer"] and "355" in a["answer"] and a["chips"] > 0 and not a["alert"]
              and not bad["numbers"] and not bad["proper_nouns"])
        C.step(p_, inst_, "1 ask this note", "a question the note answers: the answer has the note's numbers and cites",
               "PASS" if ok else "FAIL", question=q, **a, not_in_note=bad)
        # click the citation: where does it land?
        landed = None
        try:
            p_.locator("[data-citation]").first.click(timeout=8000)
            p_.wait_for_timeout(1200)
            landed = p_.evaluate("""() => { const s = getSelection(); const n = s && s.anchorNode;
                const el = n ? (n.nodeType === 1 ? n : n.parentElement) : null; const para = el ? el.closest('p,li,h1,h2,h3,blockquote') : null;
                const pm = document.querySelector('.ProseMirror'); const r = para ? para.getBoundingClientRect() : null;
                return { selection: (s ? s.toString() : '').slice(0, 200), paragraph: para ? para.textContent.slice(0, 200) : null,
                         in_editor: !!(para && pm && pm.contains(para)), in_view: r ? (r.top >= 0 && r.bottom <= innerHeight) : null,
                         notice: (document.querySelector('[data-testid="ask-nav-notice"]') || {}).textContent || '' } }""")
        except Exception as e:  # noqa: BLE001
            landed = {"error": str(e)[:200]}
        right = bool(landed and landed.get("in_editor") and "298.75" in (landed.get("paragraph") or "") and not landed.get("notice"))
        C.step(p_, inst_, "1 ask this note", "clicking the citation lands on the passage that holds the stop",
               "PASS" if right else "FAIL", landed=landed)
        if not do_absent:
            return
        q2 = "What dividend yield did I write down, and who is the chief financial officer?"
        a2 = ask_ui(p_, q2, "ask-input-note")
        bad2 = unsupported(a2["answer"], corpus + " " + q2)
        says_no = bool(re.search(r"(could ?n[o']t|cannot|can't|did ?n[o']t|does ?n[o']t|do not|no (mention|information|record)|not (find|mention|contain|include|in (this|the|your) note))", a2["answer"], re.I))
        invented = bool(bad2["numbers"] or bad2["proper_nouns"])
        C.step(p_, inst_, "1 ask this note", "a question the note does NOT answer: says so, invents nothing",
               "PASS" if says_no and not invented and not a2["alert"] else "FAIL", question=q2, **a2,
               says_it_could_not_find_it=says_no, INVENTED=bad2 if invented else None, not_in_note=bad2)

    run_step("ask_note", lambda: ask_note_on(pg, inst, "1280"))

    # ── 2. Ask the whole Notebook, then insert ────────────────────────────────────────────
    def ask_notebook():
        a_id = mk(*NOTE_A[:2], NOTE_A[2], "note_a")
        b_id = mk(*NOTE_B[:2], NOTE_B[2], "note_b")
        pg.wait_for_timeout(1500)
        C.goto(pg, base, "/journal/notebook")
        pg.wait_for_timeout(1500)
        pg.locator('button[aria-label="Ask a question about my notebook"]').filter(visible=True).first.click(timeout=20000)
        q = "What have I written about CRWD: my planned entry, and what I did after the report?"
        a = ask_ui(pg, q, "ask-input-notebook")
        corpus = " ".join([NOTE_A[0], NOTE_B[0], q] + NOTE_A[2] + NOTE_B[2])
        bad = unsupported(a["answer"], corpus)
        both = any(NOTE_A[0] in s for s in a["sources"]) and any(NOTE_B[0] in s for s in a["sources"])
        C.step(pg, inst, "2 ask the notebook", "a ticker written in two notes: the answer cites both notes",
               "PASS" if both and a["chips"] >= 2 and not bad["numbers"] and not bad["proper_nouns"] else "FAIL",
               question=q, **a, cites_both_notes=both, not_in_notes=bad, INVENTED=bad if (bad["numbers"] or bad["proper_nouns"]) else None,
               literal_asterisks_shown="**" in a["answer"], says_the_note_cuts_off=bool(re.search(r"cuts? off", a["answer"])))
        # the insert door
        ins = pg.get_by_role("button", name=re.compile(r"^Insert into"))
        present = C.vis_loc(ins, 8000)
        made, label, chips_in_note, err, picker = None, None, None, None, None
        if present:
            try:
                ins.first.click()
                pg.wait_for_timeout(800)
                picker = [b_.strip()[:60] for b_ in pg.locator('[role="dialog"] button').all_inner_texts()][-8:]
                new = pg.locator('[role="dialog"] button').filter(has_text=re.compile(r"new note", re.I))
                new.first.click(timeout=8000)
                pg.wait_for_url(lambda u: "note=" in u, timeout=30000)
                made = pg.url.split("note=")[-1].split("&")[0]
                blk = pg.locator('[data-type="ask-insert"]')
                blk.first.wait_for(state="visible", timeout=30000)
                label = blk.first.get_attribute("aria-label")
                chips_in_note = blk.first.locator("[data-ask-citation], [data-citation], button, a").count()
                S["insert_note"] = made
            except Exception as e:  # noqa: BLE001
                err = str(e)[:300]
        text = pg.locator('[data-type="ask-insert"]').first.inner_text()[:4000] if made else None
        prov = bool(label and "Ask Notebook" in label and text and "From Ask Notebook" in text and NOTE_A[0] in text and NOTE_B[0] in text)
        S["raw_markdown_in_block"] = bool(text and "**" in text)
        C.step(pg, inst, "2 ask the notebook", "insert the answer into a note: the block says where it came from and keeps its sources",
               "PASS" if prov else "FAIL", insert_button=present, picker_buttons=picker, note=made, block_label=label,
               block_text=text, controls_in_block=chips_in_note, reach_error=err,
               literal_asterisks_shown=S.get("raw_markdown_in_block"),
               says_the_note_cuts_off=bool(text and re.search(r"cuts? off", text)))

    run_step("ask_notebook", ask_notebook)

    # ── 3. Writing help ─────────────────────────────────────────────────────────────────────
    SELECT_JS = """(i) => { const pm = document.querySelector('.ProseMirror'); pm.focus();
        const p = pm.querySelectorAll('p')[i]; const r = document.createRange(); r.selectNodeContents(p);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange'));
        return p.textContent.slice(0, 60) }"""

    def writing_on(p_, inst_, vp, plans):
        nid = mk(f"Semis pullback {vp}", None, WH_PARAS, f"wh_note2_{vp}")
        open_note(p_, nid)
        ed = p_.locator(".ProseMirror").first
        for label, decision in plans:
            before = ed.inner_text()
            before_blocks = p_.locator('[data-type="ask-insert"]').count()
            facts = {"choice": label, "decision": decision}
            try:
                facts["selected"] = p_.evaluate(SELECT_JS, 1)
                p_.wait_for_timeout(400)
                # by its own attribute: a note titled "Writing help ..." is a button of that name too
                btn = p_.locator('button[data-tour="writing-help"]').filter(visible=True)
                btn.first.click(timeout=10000)
                dlg = p_.get_by_role("dialog", name="Writing help")
                dlg.wait_for(state="visible", timeout=10000)
                facts["scope_line"] = dlg.locator("p").first.inner_text()[:120]
                dlg.get_by_role("button", name=label, exact=True).click()
                if label == "Translate":
                    sel = dlg.get_by_label("Language to translate into")
                    opts = sel.locator("option").all_inner_texts()
                    pick = next((o for o in opts if "Spanish" in o), opts[0])
                    sel.select_option(label=pick)
                    facts["language"] = pick
                dlg.get_by_role("button", name="Write it", exact=True).click()
                acc = dlg.get_by_role("button", name="Accept", exact=True)
                al = dlg.locator('[role="alert"]')
                t0 = time.time()
                while time.time() - t0 < 150:
                    if acc.count() and acc.first.is_visible():
                        break
                    if al.count() and al.first.is_visible():
                        break
                    p_.wait_for_timeout(500)
                facts["seconds"] = round(time.time() - t0, 1)
                facts["alert"] = al.first.inner_text()[:300] if al.count() and al.first.is_visible() else None
                facts["draft"] = dlg.get_by_role("region", name="Draft preview").inner_text()[:900]
                facts["fine_print"] = dlg.locator("p", has_text="Nothing is added to your note").first.inner_text()[:200]
                facts["labelled_ai_in_panel"] = "Written by" in facts["fine_print"]
                ready = acc.count() > 0 and acc.first.is_visible()
                if ready and decision == "accept":
                    acc.first.click()
                    dlg.wait_for(state="hidden", timeout=15000)
                    p_.wait_for_timeout(1200)
                    blk = p_.locator('[data-type="ask-insert"]')
                    facts["blocks_after"] = blk.count()
                    facts["block_label"] = blk.last.get_attribute("aria-label") if blk.count() else None
                    facts["block_header"] = blk.last.inner_text()[:160] if blk.count() else None
                    after = ed.inner_text()
                    facts["note_changed"] = after != before
                    facts["labelled_ai_in_note"] = bool(facts["block_label"] and "Compass" in facts["block_label"])
                    # undo
                    if inst_.touch and p_.get_by_role("button", name="Undo", exact=True).filter(visible=True).count():
                        p_.get_by_role("button", name="Undo", exact=True).filter(visible=True).first.click()
                        facts["undo_by"] = "the Undo button"
                    else:
                        p_.evaluate("document.querySelector('.ProseMirror').focus()")
                        p_.keyboard.press("Control+z")
                        facts["undo_by"] = "Ctrl+Z"
                    p_.wait_for_timeout(900)
                    undone = ed.inner_text()
                    if undone != before:      # one more press, in case the insert was two steps
                        p_.keyboard.press("Control+z")
                        p_.wait_for_timeout(900)
                        undone = ed.inner_text()
                        facts["undo_presses"] = 2
                    facts["undo_restores"] = undone == before
                    facts["blocks_after_undo"] = p_.locator('[data-type="ask-insert"]').count()
                    ok = (facts["blocks_after"] == before_blocks + 1 and facts["labelled_ai_in_note"] and facts["labelled_ai_in_panel"]
                          and facts["undo_restores"])
                elif ready:
                    dlg.get_by_role("button", name="Discard", exact=True).click()
                    dlg.wait_for(state="hidden", timeout=15000)
                    p_.wait_for_timeout(700)
                    facts["note_unchanged_after_discard"] = ed.inner_text() == before
                    facts["blocks_after"] = p_.locator('[data-type="ask-insert"]').count()
                    ok = facts["note_unchanged_after_discard"] and facts["blocks_after"] == before_blocks and facts["labelled_ai_in_panel"] and len(facts["draft"]) > 20
                else:
                    ok = False
                    try:
                        dlg.get_by_role("button", name=re.compile("Cancel|Discard")).first.click(timeout=3000)
                    except Exception:  # noqa: BLE001
                        p_.keyboard.press("Escape")
            except Exception as e:  # noqa: BLE001
                ok = False
                facts["reach_error"] = f"{type(e).__name__}: {str(e)[:300]}"
                try:
                    p_.keyboard.press("Escape")
                except Exception:  # noqa: BLE001
                    pass
            C.step(p_, inst_, "3 writing help", f"{label}: {decision}", "PASS" if ok else "FAIL", **facts)

    run_step("writing", lambda: writing_on(pg, inst, "1280", [("Summarize", "accept"), ("Rewrite shorter", "discard"),
                                                              ("Continue writing", "accept"), ("Translate", "discard")]))

    # ── 4. Ask over a Word file and an image ───────────────────────────────────────────────
    def docs():
        nid = mk("Attachments walk", None, ["Two files are attached to this note."], "doc_note2")
        ups = {}
        for name, mime, data in (("zebra-memo.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", make_docx(DOCX_PARAS)),
                                 ("acme-invoice.png", "image/png", make_png(IMAGE_LINES))):
            door = "images" if mime.startswith("image/") else "attachments"     # an image goes in by the editor's image door
            r = M.post(f"{base}/api/j2/notes/{nid}/{door}", multipart={"file": {"name": name, "mimeType": mime, "buffer": data}})
            ups[name] = {"status": r.status, "body": (r.text() or "")[:300]}
        rows = []
        t0 = time.time()
        while time.time() - t0 < 120:
            r = M.get(f"{base}/api/j2/notes/{nid}/documents")
            j = r.json() if r.status == 200 else {}
            rows = (j.get("documents") if isinstance(j, dict) else j) or []
            st = [str(d.get("status") or d.get("extractionStatus") or d.get("textStatus")) for d in rows]
            if len(rows) >= 2 and all(re.search(r"ready|done|complete|extracted|ok|failed|empty|no_text|ocr", s, re.I) for s in st) and time.time() - t0 > 8:
                break
            time.sleep(3)
        brief = [{k: d.get(k) for k in ("id", "name", "filename", "sourceKind", "status", "extractionStatus", "textStatus", "pageCount", "ocrStatus", "charCount") if k in d} for d in rows]
        C.step(None, inst, "4 ask over files", "a Word file and an image upload and become documents",
               "PASS" if len(rows) >= 2 and all(u["status"] == 200 for u in ups.values()) else "FAIL", uploads=ups, documents=brief, shot=False)
        for want, q, facts_ in (("docx", "When does the Tacoma depot open, and what was fleet utilisation?", ("March 9", "87")),
                                ("image", "What is the total due on the invoice, and what is the invoice number?", ("912", "4471"))):
            d = next((x for x in rows if want in str(x.get("sourceKind")).lower() or (want == "docx" and "docx" in str(x.get("name")).lower())), None)
            if d is None:
                C.step(None, inst, "4 ask over files", f"ask over the {want}", "FAIL", reason="the upload did not become a document row", shot=False)
                continue
            a = sse(M, "/api/j2/ask/stream", {"scope": "document", "target": d.get("id"), "query": q, "history": []})
            import shutil as _sh
            if want == "image" and str(d.get("status")) == "no_text" and not _sh.which("tesseract"):
                # The text of an image is read by a LOCAL engine (Tesseract), not by a model. This box
                # has none, so the document has no text. What CAN be checked: Ask invents nothing.
                bad0 = unsupported(a["answer"], q + " image")
                invented0 = any(f in a["answer"] for f in facts_) or bool(bad0["numbers"])
                C.step(None, inst, "4 ask over files", "ask over the image: the answer cites the file", "NOT_RUN",
                       reason="no OCR engine on this machine (Tesseract is not installed), so the image document reads `no_text`; "
                              "image text is not a model-key feature", document=d, shot=False)
                C.step(None, inst, "4 ask over files", "an image with no text read off it: Ask says so and invents nothing",
                       "PASS" if not invented0 and a["status"] == 200 else "FAIL", question=q, answer=a["answer"][:700], cited=a["cited"],
                       error=a["error"], coverage=a["coverage"], INVENTED=bad0 if invented0 else None, shot=False)
                continue
            fname = d.get("name") or ""
            cites_file = bool(a["cited"]) and any((fname and fname in json.dumps(s)) or str(d.get("id")) in json.dumps(s) for s in a["sources"])
            has = all(f in a["answer"] for f in facts_)
            corpus = " ".join(DOCX_PARAS + IMAGE_LINES) + " " + q + " " + fname
            bad = unsupported(a["answer"], corpus)
            C.step(None, inst, "4 ask over files", f"ask over the {want}: the answer has the file's facts and cites the file",
                   "PASS" if has and cites_file else "FAIL", question=q, document=d.get("name"), status=a["status"], answer=a["answer"][:900], cited=a["cited"],
                   source_labels=[s.get("label") for s in a["sources"]][:5], scanned=[s.get("scanned") or s.get("textSource") for s in a["sources"]][:5],
                   cites_the_file=cites_file, has_the_facts=has, error=a["error"], body=a["body"], coverage=a["coverage"],
                   not_in_file=bad, INVENTED=bad if (bad["numbers"] or bad["proper_nouns"]) and a["answer"] else None,
                   door="our server's ask door, as the member (not the preview sheet)", shot=False)

    run_step("docs", docs)

    # ── 5. AI actions ───────────────────────────────────────────────────────────────────────
    def tags_now(ids):
        return {i: {"tags": sorted(note_json(i).get("tags") or []), "folder": note_json(i).get("folderId")} for i in ids}

    def latest_set():
        r = M.get(base + "/api/j2/ai-actions")
        sets = (r.json().get("changeSets") or []) if r.status == 200 else []
        if not sets:
            return {}
        sid = sets[0].get("id")
        g = M.get(f"{base}/api/j2/ai-actions/{sid}")
        return g.json() if g.status == 200 else sets[0]

    def plan_ui(p_, request):
        C.goto(p_, base, "/journal/notebook")
        p_.wait_for_timeout(1500)
        panel = p_.locator('section[aria-label="Ask Notebook to do something"]').filter(visible=True).first
        tog = panel.get_by_role("button", name="Ask Notebook to do something", exact=True)
        tog.scroll_into_view_if_needed(timeout=15000)
        if tog.get_attribute("aria-expanded") != "true":
            tog.click()
        box = panel.get_by_role("textbox", name="What should Notebook do?")
        if not C.vis_loc(box, 5000):       # a finished set is showing: start again
            again = panel.get_by_role("button").filter(has_text=re.compile("another|new request|again|Discard plan", re.I))
            if again.count():
                again.first.click()
        box.wait_for(state="visible", timeout=10000)
        box.fill(request)
        panel.get_by_role("button", name="Plan changes").click()
        head = panel.get_by_role("heading", name=re.compile(r"Review \d+ proposed change"))
        al = panel.locator('[role="alert"]')
        t0 = time.time()
        while time.time() - t0 < 180:
            if head.count() and head.first.is_visible():
                break
            if al.count() and al.first.is_visible():
                break
            p_.wait_for_timeout(500)
        return panel, {"seconds": round(time.time() - t0, 1), "heading": head.first.inner_text() if head.count() else None,
                       "alert": al.first.inner_text()[:300] if al.count() and al.first.is_visible() else None,
                       "plan_text": panel.inner_text()[:1500]}

    def change_notes(cs):
        out = []
        for ch in (cs.get("changes") or []):
            out.append({"id": ch.get("id"), "kind": ch.get("kind") or ch.get("type"), "note": ch.get("noteId") or ch.get("note_id"),
                        "status": ch.get("status"), "summary": str(ch.get("summary") or ch.get("label") or ch.get("value") or ch.get("payload"))[:120]})
        return out

    def actions():
        a_id = mk(*NOTE_A[:2], NOTE_A[2], "note_a")
        b_id = mk(*NOTE_B[:2], NOTE_B[2], "note_b")
        ids = [a_id, b_id]
        base_state = tags_now(ids)
        req1 = 'Tag my two CRWD notes with "crowdstrike".'
        # (a) plan, then decline: nothing changes
        panel, p1 = plan_ui(pg, req1)
        cs1 = latest_set()
        shown = change_notes(cs1)
        boxes = panel.get_by_role("checkbox").count()
        C.step(pg, inst, "5 AI actions", "tag request: a plan is shown and every change has its own checkbox",
               "PASS" if p1["heading"] and boxes >= 1 and boxes == len([c for c in shown]) else "FAIL", request=req1, **p1, checkboxes=boxes, changes=shown,
               set_status=cs1.get("status"))
        still = tags_now(ids)
        C.step(None, inst, "5 AI actions", "before approval nothing is changed", "PASS" if still == base_state else "FAIL", before=base_state, now=still, shot=False)
        try:
            panel.get_by_role("button", name="Discard plan").click(timeout=8000)
            pg.wait_for_timeout(1200)
        except Exception as e:  # noqa: BLE001
            p1["discard_error"] = str(e)[:200]
        after_decline = tags_now(ids)
        C.step(pg, inst, "5 AI actions", "declining the plan changes nothing", "PASS" if after_decline == base_state else "FAIL",
               before=base_state, after=after_decline, set_after=latest_set().get("status"), discard_error=p1.get("discard_error"))
        # (b) plan again, approve all but the last, apply exactly that, undo
        panel, p2 = plan_ui(pg, req1)
        cs2 = latest_set()
        shown2 = change_notes(cs2)
        cbs = panel.get_by_role("checkbox")
        n = cbs.count()
        unchecked = None
        if n >= 2:
            cbs.nth(n - 1).uncheck()
            unchecked = shown2[n - 1] if len(shown2) == n else {"index": n - 1}
        apply_btn = panel.get_by_role("button", name=re.compile(r"^Apply \d+ change"))
        apply_label = apply_btn.first.inner_text() if apply_btn.count() else None
        applied_ok, apply_err = False, None
        try:
            apply_btn.first.click(timeout=8000)
            panel.get_by_role("heading", name="AI change set applied").wait_for(state="visible", timeout=60000)
            applied_ok = True
        except Exception as e:  # noqa: BLE001
            apply_err = str(e)[:200]
        pg.wait_for_timeout(800)
        after_apply = tags_now(ids)
        cs2b = latest_set()
        gained = sorted(i for i in ids if "crowdstrike" in after_apply[i]["tags"] and "crowdstrike" not in base_state[i]["tags"])
        expect = sorted({c["note"] for c in shown2[: n - 1]} if n >= 2 and len(shown2) == n else {c["note"] for c in shown2})
        exact = applied_ok and gained == [e for e in expect if e in ids] and (unchecked is None or unchecked.get("note") not in gained or
                                                                             unchecked.get("note") in {c["note"] for c in shown2[: n - 1]})
        C.step(pg, inst, "5 AI actions", "approving applies exactly the changes that were left ticked",
               "PASS" if exact else "FAIL", **p2, shown=shown2, left_unticked=unchecked, apply_button=apply_label, apply_error=apply_err,
               notes_that_gained_the_tag=gained, expected=expect, after=after_apply, set_after=change_notes(cs2b),
               status_text=[t[:160] for t in panel.get_by_role("status").all_inner_texts()][:3])
        undo_ok, undo_err = False, None
        try:
            panel.get_by_role("button", name=re.compile(r"^Undo")).first.click(timeout=8000)
            panel.get_by_role("heading", name="AI change set undone").wait_for(state="visible", timeout=60000)
            undo_ok = True
        except Exception as e:  # noqa: BLE001
            undo_err = str(e)[:200]
        pg.wait_for_timeout(800)
        after_undo = tags_now(ids)
        C.step(pg, inst, "5 AI actions", "undo reverses the applied changes", "PASS" if undo_ok and after_undo == base_state else "FAIL",
               after_undo=after_undo, before=base_state, undo_error=undo_err, panel_text=panel.inner_text()[:400])
        # (c) move
        st, fb = C.api(ctx, inst, "POST", base, "/api/j2/note-folders", {"name": "Cyber"})
        folder = (fb.get("folder") or fb).get("id") if isinstance(fb, dict) else None
        req2 = 'Move my two CRWD notes into the folder "Cyber".'
        panel, p3 = plan_ui(pg, req2)
        cs3 = latest_set()
        shown3 = change_notes(cs3)
        apply_btn = panel.get_by_role("button", name=re.compile(r"^Apply \d+ change"))
        ok3, err3 = False, None
        try:
            apply_btn.first.click(timeout=8000)
            panel.get_by_role("heading", name="AI change set applied").wait_for(state="visible", timeout=60000)
            ok3 = True
        except Exception as e:  # noqa: BLE001
            err3 = str(e)[:200]
        pg.wait_for_timeout(800)
        moved = tags_now(ids)
        moved_ok = ok3 and all(moved[i]["folder"] == folder for i in ids) and len(shown3) == 2
        C.step(pg, inst, "5 AI actions", "move request: the plan is shown, approving moves exactly those notes",
               "PASS" if moved_ok else "FAIL", request=req2, **p3, shown=shown3, folder=folder, folder_create_status=st, after=moved, apply_error=err3)
        try:
            panel.get_by_role("button", name=re.compile(r"^Undo")).first.click(timeout=8000)
            panel.get_by_role("heading", name="AI change set undone").wait_for(state="visible", timeout=60000)
        except Exception as e:  # noqa: BLE001
            err3 = str(e)[:200]
        pg.wait_for_timeout(800)
        back = tags_now(ids)
        C.step(pg, inst, "5 AI actions", "undo puts the moved notes back", "PASS" if back == base_state else "FAIL", after_undo=back, before=base_state, undo_error=err3)

    run_step("actions", actions)

    # ── 6. Property autofill ─────────────────────────────────────────────────────────────────
    def autofill_on(p_, inst_, vp):
        nid = mk(f"{AUTOFILL_NOTE[0]} {vp}", AUTOFILL_NOTE[1], AUTOFILL_NOTE[2], f"autofill_note3_{vp}")

        def props():
            r = p_.context.request.get(f"{base}/api/j2/notes/{nid}/properties")
            rows = (r.json().get("properties") or []) if r.status == 200 else []
            return {x.get("name"): x.get("value") for x in rows if x.get("source") != "financial_derived"}
        open_note(p_, nid)
        btn = p_.get_by_role("button", name="Suggest values with Compass").filter(visible=True)
        facts = {"button_present": btn.count() > 0}
        if not btn.count():
            # the properties may be folded away, or the note has none yet
            for nm in ("Properties", "Show properties"):
                tg = p_.get_by_role("button", name=re.compile(nm, re.I)).filter(visible=True)
                if tg.count():
                    tg.first.click()
                    p_.wait_for_timeout(600)
                    break
            btn = p_.get_by_role("button", name="Suggest values with Compass").filter(visible=True)
            facts["button_present_after_opening_properties"] = btn.count() > 0
        if not btn.count():
            try:
                p_.get_by_role("button", name="Add property").filter(visible=True).first.click(timeout=6000)
                p_.wait_for_timeout(500)
                opts = [o.strip() for o in p_.get_by_role("menuitem").all_inner_texts()] or [o.strip()[:40] for o in p_.locator('[role="menu"] button, [role="listbox"] [role="option"]').all_inner_texts()]
                facts["add_property_options"] = opts[:14]
                pick = p_.get_by_role("button", name=re.compile(r"Thesis Status|Conviction|Setup", re.I)).filter(visible=True)
                if pick.count():
                    pick.first.click()
                    p_.wait_for_timeout(900)
                else:
                    p_.keyboard.press("Escape")
            except Exception as e:  # noqa: BLE001
                facts["add_property_error"] = str(e)[:200]
            btn = p_.get_by_role("button", name="Suggest values with Compass").filter(visible=True)
            facts["button_present_after_adding_a_property"] = btn.count() > 0
        before = props()
        if not btn.count():
            C.step(p_, inst_, "6 property autofill", "Suggest values is offered on a note with empty properties", "FAIL", **facts, properties=before)
            return
        btn.first.click()
        region = p_.get_by_role("region", name="Suggested values")
        t0 = time.time()
        while time.time() - t0 < 120 and not (region.count() and region.first.is_visible() and "Suggesting" not in btn.first.inner_text()):
            p_.wait_for_timeout(500)
        p_.wait_for_timeout(600)
        facts["seconds"] = round(time.time() - t0, 1)
        facts["panel"] = region.first.inner_text()[:600] if region.count() else None
        acc = region.get_by_role("button", name=re.compile(r"^Accept "))
        facts["suggestions"] = [a.get_attribute("aria-label") for a in acc.all()][:8]
        facts["source_label_shown"] = "Suggested by Compass" in (facts["panel"] or "")
        still = props()
        facts["nothing_written_before_accept"] = still == before
        accepted = None
        if acc.count():
            accepted = acc.first.get_attribute("aria-label")
            acc.first.click()
            p_.wait_for_timeout(1800)
        after = props()
        facts["accepted"] = accepted
        facts["properties_before"], facts["properties_after"] = before, after
        # every suggested value must be supported by the note text
        text = (AUTOFILL_NOTE[0] + " " + " ".join(AUTOFILL_NOTE[2])).lower()
        ungrounded = []
        for s in facts["suggestions"]:
            val = (s or "").split(":", 1)[-1].strip().lower()
            if val and val not in text and not any(wd in text for wd in re.findall(r"[a-z]{4,}", val)) and not re.sub(r"[^0-9.]", "", val) in text:
                ungrounded.append(s)
        facts["suggestions_not_in_the_note"] = ungrounded
        want = (accepted or "").replace("Accept ", "").split(":", 1)
        facts["accepted_value_is_now_the_property"] = len(want) == 2 and str(after.get(want[0].strip())).lower() == want[1].strip().lower()
        facts["only_that_property_changed"] = sorted(k for k in after if after.get(k) != before.get(k)) == [want[0].strip()] if len(want) == 2 else False
        ok = (bool(facts["suggestions"]) and facts["nothing_written_before_accept"] and facts["accepted_value_is_now_the_property"]
              and facts["only_that_property_changed"] and facts["source_label_shown"] and not ungrounded)
        C.step(p_, inst_, "6 property autofill", "Suggest values reads the note, writes nothing until Accept, then fills the property",
               "PASS" if ok else "FAIL", **facts)

    run_step("autofill", lambda: autofill_on(pg, inst, "1280"))

    # ── 7. The Compass quote in a review draft ───────────────────────────────────────────────
    def compass():
        from zoneinfo import ZoneInfo
        acc = M.get(base + "/api/j2/accounts").json()
        lst = (acc.get("accounts") if isinstance(acc, dict) else acc) or []
        account_id = (lst[0] or {}).get("id") if lst else None
        today = datetime.now(ZoneInfo("America/New_York"))
        mon = today - timedelta(days=today.weekday())
        week_start = mon.strftime("%Y-%m-%d")
        elapsed = (today.date() - mon.date()).days
        made = []
        if not S.get("compass_trades"):
            for sym, e, st_, x_, off, hh in (("NVDA", 100, 99, 95, 0, ("10:00", "10:30")), ("NVDA", 95, 94, 93, 0, ("10:45", "11:15")),
                                             ("AAPL", 100, 99, 103, 1, ("10:00", "15:00")), ("TSLA", 100, 99, 102, 2, ("10:00", "15:00"))):
                day = (mon + timedelta(days=min(off, elapsed))).strftime("%Y-%m-%d")
                s_, b_ = C.api(ctx, inst, "POST", base, "/api/j2/trades", {"symbol": sym, "side": "Long", "shares": 100, "entryPrice": e, "entryDate": day,
                                                                          "exitPrice": x_, "exitDate": day, "originalStop": st_, "entryTimeEt": hh[0], "exitTimeEt": hh[1]})
                made.append(s_)
            S["compass_trades"] = made
        gen_status, gen_body = S.get("compass_generated"), ""
        if gen_status != 200:
            r = M.post(f"{base}/api/j2/accounts/{account_id}/coach/weekly-reviews/generate", data={"weekStart": week_start}, timeout=240000)
            gen_body, gen_status = (r.text() or ""), r.status
            S["compass_generated"] = gen_status
            C.REC.setdefault("api_writes", []).append({"config": cfg, "method": "POST", "url": f"/api/j2/accounts/{account_id}/coach/weekly-reviews/generate",
                                                        "status": r.status, "request": json.dumps({"weekStart": week_start}), "response": gen_body[:4000]})
        lr = M.get(f"{base}/api/j2/accounts/{account_id}/coach/weekly-reviews")
        reviews_raw = lr.text() or ""
        plain = M.get(f"{base}/api/j2/review-drafts/weekly", params={"weekStart": week_start})
        pj = plain.json() if plain.status == 200 else {}
        draft = M.get(f"{base}/api/j2/review-drafts/weekly", params={"weekStart": week_start, "accountId": account_id})
        dj = draft.json() if draft.status == 200 else {}
        ct = dj.get("compassText")
        quote = (ct.get("text") if isinstance(ct, dict) else ct) or ""
        core = quote.rstrip("…").rstrip()
        # the review text as stored: every string value in the list payload
        strings = []

        def walk(o):
            if isinstance(o, str):
                strings.append(o)
            elif isinstance(o, dict):
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        try:
            walk(lr.json())
            walk(json.loads(gen_body))
        except Exception:  # noqa: BLE001
            pass
        exact = bool(core) and any(core in s for s in strings)
        ws = lambda s: re.sub(r"\s+", " ", s).strip()  # noqa: E731
        loose = bool(core) and any(ws(core) in ws(s) for s in strings)
        C.step(None, inst, "7 review draft", "the Compass quote in the weekly draft is an exact substring of the Compass review",
               "PASS" if gen_status == 200 and exact else "FAIL", generate_status=gen_status, generate_body=gen_body[:300] if gen_status != 200 else None,
               asked_with="accountId=<the member's one account>",
               week_start=week_start, trades_seeded=S.get("compass_trades"), quote=quote, quote_ends_with_ellipsis=quote.endswith("…"),
               exact_substring=exact, substring_after_collapsing_whitespace=loose, compass_omitted=dj.get("compassOmitted"),
               compass_meta={k: v for k, v in ct.items() if k != "text"} if isinstance(ct, dict) else None,
               longest_review_string=max(strings, key=len)[:1500] if strings else None, draft_status=draft.status, shot=False)
        C.step(None, inst, "7 review draft", "the same draft asked WITHOUT an account id (all accounts) still carries the Compass quote",
               "PASS" if pj.get("compassText") else "FAIL", status=plain.status, compassText=pj.get("compassText"), compassOmitted=pj.get("compassOmitted"),
               with_account_id_has_quote=bool(ct), accounts=len(lst), trade_count_plain=pj.get("tradeCount"), trade_count_with_account=dj.get("tradeCount"),
               note="the member has ONE account and a Compass weekly review for this week", shot=False)
        # rendered: the weekly draft note shows the quote as a labelled block
        seen = []
        pg.on("request", lambda rq: seen.append(rq.url.split("/api/")[-1]) if "review-drafts/weekly" in rq.url else None)
        C.goto(pg, base, "/journal/notebook")
        made_note, text, label, err = None, None, None, None
        try:
            pg.locator('[data-tour="review-drafts-weekly"]').first.click(timeout=20000)
            pg.wait_for_url(lambda u: "note=" in u, timeout=60000)
            made_note = pg.url.split("note=")[-1].split("&")[0]
            pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            pg.wait_for_timeout(1500)
            blk = pg.locator('[data-type="ask-insert"]')
            label = blk.first.get_attribute("aria-label") if blk.count() else None
            text = blk.first.inner_text()[:700] if blk.count() else None
        except Exception as e:  # noqa: BLE001
            err = str(e)[:300]
        in_note = bool(text and core and ws(core[:120]) in ws(text))
        C.step(pg, inst, "7 review draft", "the drafted weekly note shows the quote in a labelled Compass block",
               "PASS" if in_note and label else "FAIL", note=made_note, block_label=label, block_text=text, reach_error=err,
               the_page_asked=seen[-3:], note_text_head=(pg.locator(".ProseMirror").first.inner_text()[:500] if made_note else None))

    run_step("compass", compass)

    # ── 8. Dictation (the server door; a headless browser has no microphone) ──────────────────
    tmp = Path(tempfile.mkdtemp(prefix="finwalk-keyed-"))
    wavs = {}

    def wav(name, text):
        if name not in wavs:
            dest = tmp / f"{name}.wav"
            why = synth_wav(text, dest)
            wavs[name] = (dest, why)
        return wavs[name]

    def dictation():
        dest, why = wav("dictation", SPEECH_DICTATION)
        if why:
            C.step(None, inst, "8 dictation", "the transcribe door with real speech", "NOT_RUN", reason=f"no speech audio could be made offline: {why}", shot=False)
            return
        data = dest.read_bytes()
        out = {}
        for cleanup in ("false", "true"):
            r = M.post(base + "/api/voice/transcribe", multipart={"audio": {"name": "dictation.wav", "mimeType": "audio/wav", "buffer": data}, "cleanup": cleanup}, timeout=180000)
            try:
                out[cleanup] = {"status": r.status, **(r.json() if r.status == 200 else {"body": (r.text() or "")[:300]})}
            except Exception:  # noqa: BLE001
                out[cleanup] = {"status": r.status, "body": (r.text() or "")[:300]}
            C.REC.setdefault("api_writes", []).append({"config": cfg, "method": "POST", "url": "/api/voice/transcribe", "status": r.status,
                                                        "request": f"multipart: audio=dictation.wav ({len(data)} bytes, synthesised speech), cleanup={cleanup}",
                                                        "response": json.dumps(out[cleanup])[:1500]})
        raw_t, clean_t = (out["false"].get("text") or ""), (out["true"].get("text") or "")
        words = lambda s: set(re.findall(r"[a-z']+", s.lower()))  # noqa: E731
        want = {"shares", "stop", "pivot", "bought"}
        heard = want <= words(raw_t)
        kept = len(want & words(clean_t)) >= 3
        C.step(None, inst, "8 dictation", "synthesised speech comes back as the sentence that was spoken", "PASS" if heard else "FAIL",
               spoken=SPEECH_DICTATION, transcript=raw_t, status=out["false"].get("status"), seconds_billed=out["false"].get("seconds_billed"),
               body=out["false"].get("body"), audio="offline Windows speech synthesis (System.Speech), 16-bit WAV", shot=False)
        C.step(None, inst, "8 dictation", "the cleanup pass keeps the meaning and tidies the text", "PASS" if kept and out["true"].get("status") == 200 else "FAIL",
               before_cleanup=raw_t, after_cleanup=clean_t, changed=raw_t != clean_t, mentions_NVDA="NVDA" in clean_t, status=out["true"].get("status"),
               body=out["true"].get("body"), shot=False)

    run_step("dictation", dictation)

    # ── 9. Voice notes ────────────────────────────────────────────────────────────────────────
    def voicenote_on(p_, inst_, vp):
        dest, why = wav("voicenote", SPEECH_VOICE_NOTE)
        if why:
            C.step(None, inst_, "9 voice notes", "upload a recording", "NOT_RUN", reason=f"no speech audio could be made offline: {why}", shot=False)
            return
        stt = p_.context.request.get(base + "/api/j2/voice-notes/status")
        C.goto(p_, base, "/journal/notebook?view=all")
        p_.wait_for_timeout(1500)
        facts = {"status_door": {"status": stt.status, "body": (stt.text() or "")[:300]}, "spoken": SPEECH_VOICE_NOTE}
        try:
            p_.get_by_role("button", name="Templates", exact=True).filter(visible=True).first.click(timeout=15000)
            sheet = p_.get_by_role("dialog", name="New note")
            sheet.wait_for(state="visible", timeout=10000)
            grp = sheet.get_by_role("group", name="Start from audio")
            facts["audio_doors"] = [b_.strip() for b_ in grp.get_by_role("button").all_inner_texts()]
            grp.get_by_role("button", name=re.compile("Upload recording")).click()
            dlg = p_.get_by_role("dialog", name="Voice note")
            dlg.wait_for(state="visible", timeout=10000)
            dlg.get_by_label("Choose an audio file").set_input_files(str(dest))
            dlg.get_by_role("button", name="Transcribe").click()
            prev = dlg.get_by_role("region", name="Voice note preview")
            t0 = time.time()
            while time.time() - t0 < 240:
                if prev.count() and prev.first.is_visible():
                    break
                al = dlg.get_by_role("alert")
                if al.count() and al.first.is_visible():
                    facts["alert"] = al.first.inner_text()[:300]
                    break
                p_.wait_for_timeout(700)
            facts["seconds"] = round(time.time() - t0, 1)
            facts["preview"] = prev.first.inner_text()[:1200] if prev.count() else None
            facts["chips"] = [c.inner_text() for c in prev.locator("li").all()][:12] if prev.count() else []
            C.snap(p_, f"keyed-{vp}-voice-note-preview")
            title = f"Keyed walk voice note {vp}"
            dlg.get_by_role("textbox", name="Title").fill(title)
            dlg.get_by_role("button", name="Save as a new note").click()
            p_.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            p_.get_by_text("Voice note summary").first.wait_for(timeout=20000)
            p_.wait_for_timeout(1000)
            facts["note_text"] = p_.locator(".ProseMirror").first.inner_text()[:1600]
            blk = p_.locator('[data-type="ask-insert"]')
            facts["summary_label"] = blk.first.get_attribute("aria-label") if blk.count() else None
            facts["note"] = p_.url.split("note=")[-1].split("&")[0] if "note=" in p_.url else None
        except Exception as e:  # noqa: BLE001
            facts["reach_error"] = f"{type(e).__name__}: {str(e)[:300]}"
        nt = (facts.get("note_text") or "").lower()
        # the transcript sits in a folded block, so it is read from the saved note itself
        saved = json.dumps(note_json(facts.get("note"), p_.context.request).get("bodyJson") or {}).lower() if facts.get("note") else ""
        has_transcript = "added a small position" in saved and "review my stops" in saved
        facts["transcript_in_saved_note"] = has_transcript
        facts["summary_names_companies_but_tickers_empty"] = bool("no tickers were mentioned" in nt and re.search(r"nvidia|tesla", nt))
        tick = [t for t in ("NVDA", "TSLA") if t in (facts.get("note_text") or "") or t in " ".join(facts.get("chips") or [])]
        bad = unsupported(re.sub(r"(?s)transcript.*", "", facts.get("note_text") or "", flags=re.I), SPEECH_VOICE_NOTE + " NVDA TSLA Nvidia Tesla voice note summary keyed walk recording uploaded " + (facts.get("note_text") or "")[-700:])
        ok = bool(facts.get("note_text")) and has_transcript and len(tick) == 2 and bool(facts.get("summary_label"))
        C.step(p_, inst_, "9 voice notes", "an uploaded recording becomes a note with transcript, AI-labelled summary and tickers",
               "PASS" if ok else "FAIL", **facts, has_transcript=has_transcript, tickers_found=tick, summary_words_not_in_speech=bad)

    run_step("voicenote", lambda: voicenote_on(pg, inst, "1280"))

    # ── 10. Meaning search ────────────────────────────────────────────────────────────────────
    def meaning_on(p_, inst_, vp, sweep=True):
        ids = [mk(t, tk, ps, f"meaning_{i}") for i, (t, tk, ps) in enumerate(MEANING_NOTES)]
        target_words = set(re.findall(r"[a-z]+", (MEANING_NOTES[0][0] + " " + " ".join(MEANING_NOTES[0][2])).lower()))
        shared = sorted(set(re.findall(r"[a-z]+", MEANING_QUERY.lower())) & target_words)
        if sweep:
            env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
            r = subprocess.run([sys.executable, "-c", SWEEP_CHILD, str(REPO), str(data_dir), json.dumps(["NOTEBOOK_SEMANTIC_SEARCH_ENABLED"])],
                               cwd=str(REPO), env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
            line = [ln for ln in (r.stdout or "").splitlines() if ln.startswith("SWEEP ")]
            (C.OUT / "sweep-child.log").write_text(newline=chr(10), data="\n".join(line) + "\n--- stderr tail ---\n" + (r.stderr or "")[-2500:], encoding="utf-8")
            S["sweep"] = json.loads(line[-1][6:]) if line else {"error": f"rc {r.returncode}", "stderr": (r.stderr or "")[-400:]}
            C.step(None, inst_, "10 meaning search", "the embedding sweep, run by hand (the sandbox has no scheduler)",
                   "PASS" if (S["sweep"].get("result") or {}).get("embedded", 0) >= 5 else "FAIL", sweep=S["sweep"], notes_seeded=len(ids), shot=False)
        req = p_.context.request
        lex = req.get(base + "/api/j2/notes", params={"q": MEANING_QUERY, "limit": "20"})
        mr = req.get(base + "/api/j2/notes", params={"q": MEANING_QUERY, "limit": "20", "meaning": "1"})
        rows = (mr.json().get("notes") or []) if mr.status == 200 else []
        lex_rows = (lex.json().get("notes") or []) if lex.status == 200 else []
        C.goto(p_, base, "/journal/notebook?view=all")
        box = p_.get_by_label("Search your notes").first
        ui_rows, labelled, err = [], False, None
        try:
            if not box.count() or not box.is_visible():
                p_.locator('[aria-label="Search notes"]').first.click(timeout=15000)
            box.wait_for(state="visible", timeout=20000)
            box.fill(MEANING_QUERY)
            p_.get_by_text("Bedtime rule").first.wait_for(state="visible", timeout=30000)
            p_.wait_for_timeout(1000)
            row = p_.locator("li, [role=option], [role=listitem], article, a, button").filter(has_text="Bedtime rule").filter(visible=True)
            ui_rows = [t.replace("\n", " | ")[:220] for t in row.all_inner_texts()[:4]]
            labelled = any("Related by meaning" in t for t in ui_rows) or p_.get_by_text("Related by meaning").filter(visible=True).count() > 0
        except Exception as e:  # noqa: BLE001
            err = str(e)[:300]
        api_hit = [{"title": n.get("title"), "matchKind": n.get("matchKind"), "reason": n.get("matchReason")} for n in rows][:6]
        target_api = next((n for n in rows if n.get("title") == "Bedtime rule"), None)
        ok = bool(target_api and target_api.get("matchKind") == "meaning") and labelled and not shared and not any(n.get("title") == "Bedtime rule" for n in lex_rows)
        C.step(p_, inst_, "10 meaning search", "a phrase that shares no word with the note finds it, and the row says it matched by meaning",
               "PASS" if ok else "FAIL", query=MEANING_QUERY, words_shared_with_the_note=shared, plain_search_rows=[n.get("title") for n in lex_rows],
               meaning_rows=api_hit, rows_on_screen=ui_rows, labelled_related_by_meaning=labelled, reach_error=err, meaning_status=mr.status)

    run_step("meaning", lambda: meaning_on(pg, inst, "1280"))

    # ── 11. The morning briefing through the voice tool door ───────────────────────────────────
    def briefing():
        r = M.post(base + "/api/voice/session_token", data={"context": "global"}, timeout=120000)
        try:
            j = r.json()
        except Exception:  # noqa: BLE001
            j = {}
        # ⛔ the mint answer holds a short-lived vendor secret: only its key names and non-secret
        # fields are kept, never the body
        safe = {"status": r.status, "keys": sorted(j.keys()) if isinstance(j, dict) else None,
                "session_id": j.get("session_id") if isinstance(j, dict) else None, "model": j.get("model") if isinstance(j, dict) else None,
                "voice": j.get("voice") if isinstance(j, dict) else None,
                "tools_offered": len(j.get("tools") or []) if isinstance(j, dict) else None,
                "briefing_tools_offered": sorted(t.get("name") for t in (j.get("tools") or []) if "briefing" in str(t.get("name")))
                if isinstance(j, dict) else None,
                "detail": str(j.get("detail"))[:300] if isinstance(j, dict) and r.status != 200 else None}
        C.REC.setdefault("api_writes", []).append({"config": cfg, "method": "POST", "url": "/api/voice/session_token", "status": r.status,
                                                    "request": json.dumps({"context": "global"}), "response": "(redacted: holds a short-lived vendor secret) " + json.dumps(safe)})
        sid = safe["session_id"]
        C.step(None, inst, "11 briefing", "the voice session door mints a session and offers the briefing tool",
               "PASS" if r.status == 200 and sid else "FAIL", **safe, shot=False)
        if not sid:
            return
        for tool in ("play_my_morning_briefing", "morning_briefing"):
            st, body = C.api(ctx, inst, "POST", base, "/api/voice/exec", {"session_id": sid, "tool": tool, "args": {}})
            txt = json.dumps(body, default=str)
            has_audio = bool(re.search(r"audio|mp3|wav|speech", txt, re.I))
            err = body.get("error") if isinstance(body, dict) else None
            inner = (body.get("result") if isinstance(body, dict) else None)
            inner_err = inner.get("error") if isinstance(inner, dict) else None
            C.step(None, inst, "11 briefing", f"POST /api/voice/exec `{tool}` answers with audio or the tool's result",
                   "PASS" if st == 200 and not err and not inner_err else "FAIL", status=st, result_keys=sorted(body.keys()) if isinstance(body, dict) else None,
                   inner_keys=sorted(inner.keys()) if isinstance(inner, dict) else None, mentions_audio=has_audio, error=err or inner_err,
                   result_head=txt[:900], shot=False)
        M.post(base + "/api/voice/session/end", data={"session_id": sid, "duration_seconds": 1})
        C.step(None, inst, "11 briefing", "a live realtime voice session (speech in, speech out)", "NOT_RUN",
               reason="a headless browser has no microphone or speaker; only the session mint and the tool door were exercised", shot=False)

    run_step("briefing", briefing)

    # ── the same doors on a phone (390) ───────────────────────────────────────────────────────
    def phone():
        ctx2 = C.new_ctx(browser, "390", storage=ctx.storage_state())
        inst2 = C.Inst(ctx2, cfg, "390")
        p2 = ctx2.new_page()

        def g(name, fn):
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                C.step(p2, inst2, name, "driver exception (the step did not finish)", "FAIL",
                       error=f"{type(e).__name__}: {str(e)[:600]}", traceback=traceback.format_exc()[-1400:])
        g("1 ask this note", lambda: ask_note_on(p2, inst2, "390", do_absent=True))
        g("3 writing help", lambda: writing_on(p2, inst2, "390", [("Summarize", "accept"), ("Rewrite shorter", "discard")]))
        g("6 property autofill", lambda: autofill_on(p2, inst2, "390"))
        g("9 voice notes", lambda: voicenote_on(p2, inst2, "390"))
        g("10 meaning search", lambda: meaning_on(p2, inst2, "390", sweep=False))

        def actions_phone():
            ids = [S.get("note_a"), S.get("note_b")]
            before = tags_now(ids)
            panel, p = plan_ui(p2, 'Tag my two CRWD notes with "security".')
            boxes = panel.get_by_role("checkbox").count()
            try:
                panel.get_by_role("button", name="Discard plan").click(timeout=8000)
            except Exception as e:  # noqa: BLE001
                p["discard_error"] = str(e)[:200]
            p2.wait_for_timeout(900)
            C.step(p2, inst2, "5 AI actions", "phone: a plan with a checkbox per change is shown; declining changes nothing",
                   "PASS" if p["heading"] and boxes >= 1 and tags_now(ids) == before else "FAIL", **p, checkboxes=boxes)
        g("5 AI actions", actions_phone)

        def notebook_phone():
            C.goto(p2, base, "/journal/notebook")
            p2.wait_for_timeout(1500)
            p2.locator('button[aria-label="Ask a question about my notebook"]').filter(visible=True).first.click(timeout=20000)
            q = "What stop did I plan for CRWD and what did I trim?"
            a = ask_ui(p2, q, "ask-input-notebook")
            corpus = " ".join([NOTE_A[0], NOTE_B[0], q] + NOTE_A[2] + NOTE_B[2])
            bad = unsupported(a["answer"], corpus)
            both = any(NOTE_A[0] in s for s in a["sources"]) and any(NOTE_B[0] in s for s in a["sources"])
            C.step(p2, inst2, "2 ask the notebook", "phone: the answer cites both notes and the insert door is offered",
                   "PASS" if both and not bad["numbers"] and not bad["proper_nouns"] and p2.get_by_role("button", name=re.compile(r"^Insert into")).count() else "FAIL",
                   question=q, **a, cites_both_notes=both, not_in_notes=bad, INVENTED=bad if (bad["numbers"] or bad["proper_nouns"]) else None)
        g("2 ask the notebook", notebook_phone)
        ctx2.close()

    run_step("phone", phone)
    try:
        for f_ in tmp.iterdir():
            f_.unlink()
        tmp.rmdir()
    except Exception:  # noqa: BLE001
        pass
    ctx.close()


if __name__ == "__main__":
    print("run this through tools/notebook_fin_walk.py --config keyed")
    sys.exit(2)

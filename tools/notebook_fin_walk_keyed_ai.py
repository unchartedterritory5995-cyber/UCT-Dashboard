"""The KEYED-AI re-walk: the fixes for K1-K7 of the keyed walk, against real models, in a sandbox.

Called by tools/notebook_fin_walk.py (`--config keyedai`), which owns the boot, the recorder and
the integrity checkpoints. Same key rules as tools/notebook_fin_walk_keyed.py: the keys reach the
sandbox only through the key helper; this file never reads, prints or stores one.

    python <scratch>/fin/with_model_keys.py -- python tools/notebook_fin_walk.py --config keyedai \
        --tip <sha> --data-root <dir> --port 8132 --out docs/notebook/evidence/fin-walk/keyed-ai-<sha>

Recorded: requests and responses to OUR server only, the rendered result, console and page errors.
This driver never imports api.*. Never run on import.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
for _p in (REPO / "tools", REPO / "scripts"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import notebook_perf_harness as h  # noqa: E402
import notebook_fin_walk_keyed as K  # noqa: E402  -- corpus, unsupported(), make_docx()

ORDER = ["k4", "k1", "k3", "k7", "k6", "k2", "k5", "ocr"]

LONG_TITLE, LONG_TICKER = "PLTR deep dive", "PLTR"
LONG_PARAS = [
    "PLTR is the name I keep coming back to in software, so this note collects everything in one place.",
    "The commercial segment grew 54 percent in the United States last quarter, and the customer count reached 593.",
    "Management raised full year revenue guidance to 2.75 billion and said the bootcamp motion shortens sales cycles to weeks.",
    "On the chart the stock built a nine week cup with a handle, and the handle low sits at 24.10.",
    "My planned entry is 26.35 through the handle high, with a stop at 24.85, which keeps the risk under six percent.",
    "I will size it at half of a normal position because the valuation leaves little room for a miss.",
    "The first target is 31, where the measured move from the cup completes, and I would trim a third there.",
    "The risk I worry about most is government budget timing, since the Army contract renewal slips into the next fiscal year.",
    "A second risk is stock based compensation, which still runs near 20 percent of revenue and dilutes holders every quarter.",
    "If the breakout fails back under 25.40 on volume I will exit the whole position the same day rather than wait for the stop.",
    "The lesson from the last attempt was that I bought the first pop and gave back the gain within three sessions.",
    "Earnings are five weeks out, so the breakout has room to work before the next report resets the story.",
    "Relative strength versus the software group made a new high this week while the group itself went sideways.",
    "I checked the weekly chart as well, and the nine week base sits on top of a prior base, which is the structure I trust most.",
    "Volume in the handle dried up to the lowest level of the whole base, which tells me sellers are finished for now.",
    "If the market itself rolls over I will skip the trade entirely, because breakouts fail in corrections no matter how clean the chart.",
    "The final rule for this trade: no adds until the stock closes above 28 for two days in a row.",
]
Q_CRWD = "What have I written about CRWD: my planned entry and catalyst, and what I did after the report?"
Q_LONG = "What have I written about PLTR: the entry, the stop, the risks, and my final rule for the trade?"
Q_LONG2 = "What is my planned entry and my stop for PLTR?"
Q_NOTE = "List my entry, my stop, my first target and my catalyst, with the source after each one."
Q_BOLD = "Summarise my CRWD plan in three short lines and put the key prices in bold."
DEFECT = re.compile(r"cuts? off|cut-off|truncat|incomplete|unfinished|ends abruptly|trails off|breaks off|mid-sentence", re.I)
PARTIAL_OK = re.compile(r"part of|excerpt|portion|section of|some of", re.I)
REQ_TAG = 'Tag my two CRWD notes with "security".'
REQ_IMPOSSIBLE = "Delete every note I wrote in 2019 and email them to my broker."
DOC_Q = "When does the Tacoma depot open, and what was fleet utilisation?"
OFF_TOPIC = re.compile(r"unrelated|off[- ]topic|not (related|about) (to )?(markets|trading)|research desk|ask me about markets|outside (my|the) scope", re.I)


def run(C, browser, admin, base, fs, data_dir, only) -> None:
    S = C.STATE
    cfg = "keyedai"
    steps = [s for s in ORDER if (not only or s in only)]
    PW = "LocalTest2026!"

    def enter(key, tag, vp="1280"):
        """A paid member, made once and re-entered on a later attach."""
        if S.get(key):
            ctx_ = C.new_ctx(browser, vp)
            ctx_.request.post(base + "/api/auth/login", data={"email": S[key], "password": PW})
            if not ctx_.request.get(base + "/api/auth/me").json().get("paid_equiv"):
                raise h.SetupFailed(f"could not re-enter {S[key]}")
            return ctx_
        ctx_, email, _me = C.member(browser, admin.request, base, tag, vp)
        S[key] = email
        return ctx_

    ctx = enter("ai_email", "kai")
    inst = C.Inst(ctx, cfg, "1280")
    pg = ctx.new_page()
    M = ctx.request
    me = M.get(base + "/api/auth/me").json()
    flags = {f: me.get(f.lower()) for f in fs["keyed"] if f in fs["gates"]}
    C.step(None, inst, "flags", "auth payload: every keyed switch reads ON", "PASS" if all(flags.values()) else "FAIL",
           email=S["ai_email"], off=[k for k, v in flags.items() if not v], shot=False)
    try:
        boot = (C.OUT / "sandbox-keyedai.log").read_text(encoding="utf-8", errors="replace")
        lines = [ln.strip()[:200] for ln in boot.splitlines() if re.search(r"Model keys|Kill-list|RESEND|ocr\b|OCR", ln)][:8]
        C.step(None, inst, "sandbox", "boot output: model keys opted in, kill-list applied", "INFO", boot_lines=lines, shot=False)
    except Exception:  # noqa: BLE001
        pass

    def run_step(name, fn):
        if name not in steps:
            return
        try:
            fn()
        except h.SetupFailed:
            raise
        except Exception as e:  # noqa: BLE001
            C.step(pg, inst, name, "driver exception (the step did not finish)", "FAIL",
                   error=f"{type(e).__name__}: {str(e)[:600]}", traceback=traceback.format_exc()[-1600:])

    def mk(req, inst_, title, ticker, paras, key):
        if S.get(key):
            return S[key]
        body = {"title": title, "bodyJson": K.doc_of(paras)}
        if ticker:
            body["ticker"] = ticker
        r = req.post(base + "/api/j2/notes", data=body)
        S[key] = r.json()["note"]["id"]
        return S[key]

    def note_json(req, nid):
        r = req.get(f"{base}/api/j2/notes/{nid}")
        return (r.json().get("note") or {}) if r.status == 200 else {}

    def home(p_):
        C.goto(p_, base, "/journal/notebook")
        C.settle_first_run(p_)
        p_.wait_for_timeout(1200)

    def seen_notes():
        """Research Home offers Ask only once something is in "continue working": open each note once."""
        for nid in (S["note_a"], S["note_b"], S["note_long"]):
            C.goto(pg, base, f"/journal/notebook?note={nid}", ".ProseMirror")
            pg.wait_for_timeout(1500)

    a_id = mk(M, inst, K.NOTE_A[0], K.NOTE_A[1], K.NOTE_A[2], "note_a")
    b_id = mk(M, inst, K.NOTE_B[0], K.NOTE_B[1], K.NOTE_B[2], "note_b")
    l_id = mk(M, inst, LONG_TITLE, LONG_TICKER, LONG_PARAS, "note_long")
    NOTES = {K.NOTE_A[0]: (a_id, K.NOTE_A[2]), K.NOTE_B[0]: (b_id, K.NOTE_B[2]), LONG_TITLE: (l_id, LONG_PARAS)}
    long_chars = sum(len(p) for p in LONG_PARAS)
    CORPUS = " ".join([K.NOTE_A[0], K.NOTE_B[0], LONG_TITLE] + K.NOTE_A[2] + K.NOTE_B[2] + LONG_PARAS)

    def ask_ui(p_, question, input_id, timeout=150):
        box = p_.locator(f"#{input_id}")
        box.wait_for(state="visible", timeout=15000)
        box.fill(question)
        box.press("Enter")
        ans = p_.locator('[data-testid="ask-answer"][aria-busy="false"]')
        alert = p_.locator('[role="dialog"] [role="alert"]')
        t0 = time.time()
        while time.time() - t0 < timeout:
            if (ans.count() and ans.first.is_visible()) or (alert.count() and alert.first.is_visible()):
                break
            p_.wait_for_timeout(500)
        p_.wait_for_timeout(900)
        a = p_.locator('[data-testid="ask-answer"]')
        return {"answer": a.first.inner_text() if a.count() else "",
                "alert": alert.first.inner_text() if alert.count() and alert.first.is_visible() else None,
                "chips": p_.locator('[data-testid="ask-answer"] [data-citation]').count(),
                "bold_elements": a.first.locator("strong").count() if a.count() else 0,
                "italic_elements": a.first.locator("em").count() if a.count() else 0,
                "sources": [x.replace("\n", " ") for x in p_.locator('[data-testid="ask-sources"] button').all_inner_texts()],
                "coverage": (p_.locator('[data-testid="ask-coverage"]').first.inner_text() if p_.locator('[data-testid="ask-coverage"]').count() else None),
                "seconds": round(time.time() - t0, 1)}

    def open_notebook_ask(p_):
        home(p_)
        p_.locator('button[aria-label="Ask a question about my notebook"]').filter(visible=True).first.click(timeout=20000)

    LAND_JS = """() => { const s = getSelection(); const n = s && s.anchorNode;
        const el = n ? (n.nodeType === 1 ? n : n.parentElement) : null; const para = el ? el.closest('p,li,h1,h2,h3,blockquote') : null;
        const pm = document.querySelector('.ProseMirror'); const r = para ? para.getBoundingClientRect() : null;
        return { selection: (s ? s.toString() : '').slice(0, 220), paragraph: para ? para.textContent.slice(0, 260) : null,
                 in_editor: !!(para && pm && pm.contains(para)), in_view: r ? (r.top >= 0 && r.bottom <= innerHeight) : null,
                 notice: (document.querySelector('[data-testid="ask-nav-notice"]') || {}).textContent || '', url: location.search } }"""

    def check(answer, corpus):
        """K.unsupported, with hyphenated words split and the model's own word for the search line allowed."""
        text = re.sub(r"\bI['\u2019](m|ve|d|ll)\b", "I", (answer or "").replace("-", " "))
        return K.unsupported(text, corpus + " searched")

    def click_chip(p_, chip, passage=False):
        """Click one citation and say where it landed: which note, which paragraph."""
        label = chip.get_attribute("aria-label") or ""
        title = next((t for t in NOTES if t in label), None)
        chip.click(timeout=8000)
        try:
            p_.wait_for_url(lambda u: "note=" in u, timeout=15000)
            p_.locator(".ProseMirror").first.wait_for(state="visible", timeout=20000)
        except Exception:  # noqa: BLE001
            pass
        p_.wait_for_timeout(1500)
        landed = p_.evaluate(LAND_JS)
        want_id, want_paras = NOTES.get(title, (None, []))
        landed.update({"chip": label[:90], "cited_note": title, "opened_the_cited_note": bool(want_id and want_id in (landed.get("url") or "")),
                       "paragraph_is_in_that_note": bool(landed.get("paragraph") and any(landed["paragraph"].strip() == p.strip() for p in want_paras))})
        # From the whole Notebook a citation opens the cited NOTE (lib/openCitation.js openOwningNote);
        # inside a note it lands on the passage. `passage` says which of the two is being judged.
        landed["ok"] = bool(landed["opened_the_cited_note"] and not landed.get("notice") and (landed["paragraph_is_in_that_note"] or not passage))
        return landed

    def sse(req, path, payload):
        r = req.post(base + path, data=payload, timeout=240000)
        raw = r.text() or ""
        ev = []
        for block in raw.split("\n\n"):
            for ln in block.split("\n"):
                if ln.startswith("data:"):
                    try:
                        ev.append(json.loads(ln[5:]))
                    except Exception:  # noqa: BLE001
                        pass
        C.REC.setdefault("api_writes", []).append({"config": cfg, "method": "POST", "url": path, "status": r.status,
                                                    "request": json.dumps(payload)[:1500], "response": raw[:9000]})
        final = next((e for e in ev if e.get("type") == "final"), {})
        srcs = next((e for e in ev if e.get("type") == "sources"), {})
        return {"status": r.status, "answer": final.get("answer") or "".join(e.get("text", "") for e in ev if e.get("type") == "delta"),
                "sources": srcs.get("sources") or [], "cited": final.get("cited"), "error": next((e for e in ev if e.get("type") == "error"), None)}

    # ── K4 first (before any other note mentions CRWD) ────────────────────────────────────────
    def plan_ui(p_, request):
        home(p_)
        panel = p_.locator('section[aria-label="Ask Notebook to do something"]').filter(visible=True).first
        tog = panel.get_by_role("button", name="Ask Notebook to do something", exact=True)
        tog.scroll_into_view_if_needed(timeout=15000)
        if tog.get_attribute("aria-expanded") != "true":
            tog.click()
        box = panel.get_by_role("textbox", name="What should Notebook do?")
        box.wait_for(state="visible", timeout=10000)
        box.fill(request)
        panel.get_by_role("button", name="Plan changes").click()
        head = panel.get_by_role("heading", name=re.compile(r"Review \d+ proposed change|Nothing to change"))
        al = panel.locator('[role="alert"]')
        t0 = time.time()
        while time.time() - t0 < 180:
            if (head.count() and head.first.is_visible()) or (al.count() and al.first.is_visible()):
                break
            p_.wait_for_timeout(500)
        p_.wait_for_timeout(500)
        r = p_.context.request.get(base + "/api/j2/ai-actions")
        sets = (r.json().get("changeSets") or []) if r.status == 200 else []
        cs = sets[0] if sets else {}
        if cs.get("id"):
            g = p_.context.request.get(f"{base}/api/j2/ai-actions/{cs['id']}")
            cs = g.json() if g.status == 200 else cs
        return panel, {"seconds": round(time.time() - t0, 1), "heading": head.first.inner_text() if head.count() else None,
                       "alert": al.first.inner_text()[:300] if al.count() and al.first.is_visible() else None,
                       "panel_text": panel.inner_text()[:1100], "checkboxes": panel.get_by_role("checkbox").count(),
                       "apply_buttons": panel.get_by_role("button", name=re.compile(r"^Apply")).count(),
                       "server_changes": [{"note": c.get("noteId"), "summary": str(c.get("summary"))[:80]} for c in (cs.get("changes") or [])],
                       "server_summary": str(cs.get("summary"))[:300], "request": request}

    def tags(req):
        return {i: sorted(note_json(req, i).get("tags") or []) for i in (a_id, b_id, l_id)}

    def k4_on(p_, inst_, vp, runs):
        before = tags(p_.context.request)
        for i in range(runs):
            panel, f = plan_ui(p_, REQ_TAG)
            two = (f["heading"] == "Review 2 proposed changes" and f["checkboxes"] == 2
                   and sorted(c["note"] for c in f["server_changes"]) == sorted([a_id, b_id]))
            C.step(p_, inst_, "K4 AI actions", f"a tag that does not exist yet: a plan with two changes (run {i + 1})",
                   "PASS" if two else "FAIL", **f)
            try:
                panel.get_by_role("button", name="Discard plan").click(timeout=6000)
            except Exception:  # noqa: BLE001
                pass
            p_.wait_for_timeout(600)
        panel, f = plan_ui(p_, REQ_IMPOSSIBLE)
        ok = f["heading"] == "Nothing to change" and f["apply_buttons"] == 0 and f["checkboxes"] == 0 and not f["server_changes"]
        C.step(p_, inst_, "K4 AI actions", "a request it cannot do: \"Nothing to change\", no Apply button", "PASS" if ok else "FAIL", **f,
               notes_unchanged=tags(p_.context.request) == before)

    def k4_both():
        home(pg)
        before_open = pg.locator('button[aria-label="Ask a question about my notebook"]').count()
        seen_notes()
        home(pg)
        after_open = pg.locator('button[aria-label="Ask a question about my notebook"]').count()
        C.step(pg, inst, "setup", "Research Home shows its Ask button once a note has been opened", "INFO", ask_buttons_before_any_note_was_opened=before_open,
               ask_buttons_after=after_open, note="three notes existed both times; made through the notes door, not yet opened")
        k4_on(pg, inst, "1280", 2)
        # the phone pass for K4 runs NOW, before K3's insert adds a third note that mentions CRWD
        cp = C.new_ctx(browser, "390", storage=ctx.storage_state())
        ip = C.Inst(cp, cfg, "390")
        try:
            k4_on(cp.new_page(), ip, "390", 1)
        finally:
            cp.close()

    run_step("k4", k4_both)

    # ── K1: the whole Notebook, short notes and one long note ─────────────────────────────────
    def k1_on(p_, inst_, vp):
        for i in (1, 2):
            open_notebook_ask(p_)
            a = ask_ui(p_, Q_CRWD, "ask-input-notebook")
            bad = check(a["answer"], CORPUS + " " + Q_CRWD)
            defect = DEFECT.findall(a["answer"])
            has_rest = bool(re.search(r"renewal", a["answer"], re.I)) and bool(re.search(r"break-?even", a["answer"], re.I))
            both = any(K.NOTE_A[0] in s for s in a["sources"]) and any(K.NOTE_B[0] in s for s in a["sources"])
            invented = bool(bad["numbers"] or bad["proper_nouns"])
            C.step(p_, inst_, "K1 ask the notebook", f"two short notes: no claim that a note is cut off, and the rest of each note is in the answer (run {i})",
                   "PASS" if not defect and has_rest and both and not invented and not a["alert"] else "FAIL", question=Q_CRWD, **a,
                   says_a_note_is_defective=defect, has_the_renewal_cycle_and_the_breakeven_stop=has_rest, cites_both_notes=both,
                   not_in_notes=bad, INVENTED=bad if invented else None)
            if i == 1:
                chips = p_.locator('[data-testid="ask-answer"] [data-citation]')
                landed = click_chip(p_, chips.first) if chips.count() else {"ok": False, "error": "no chip"}
                C.step(p_, inst_, "K1 ask the notebook", "a citation opens the cited note at a passage of that note", "PASS" if landed.get("ok") else "FAIL", landed=landed)
        for i in (1, 2):
            open_notebook_ask(p_)
            a = ask_ui(p_, Q_LONG2, "ask-input-notebook")
            bad = check(a["answer"], CORPUS + " " + Q_LONG2)
            defect = DEFECT.findall(a["answer"])
            invented = bool(bad["numbers"] or bad["proper_nouns"])
            has = "26.35" in a["answer"] and "24.85" in a["answer"]
            C.step(p_, inst_, "K1 ask the notebook", f"a long note ({long_chars} characters), a fact near its start: answered, and the note is not called defective (run {i})",
                   "PASS" if has and not defect and not invented and not a["alert"] else "FAIL", question=Q_LONG2, **a, says_a_note_is_defective=defect,
                   says_it_worked_from_part=PARTIAL_OK.findall(a["answer"]), not_in_notes=bad, INVENTED=bad if invented else None)
        for i in (1, 2):
            open_notebook_ask(p_)
            a = ask_ui(p_, Q_LONG, "ask-input-notebook")
            bad = check(a["answer"], CORPUS + " " + Q_LONG)
            defect = DEFECT.findall(a["answer"])
            invented = bool(bad["numbers"] or bad["proper_nouns"])
            got = {k_: bool(re.search(v, a["answer"])) for k_, v in (("entry 26.35", r"26\.35"), ("stop 24.85", r"24\.85"),
                                                                       ("final rule (above 28, two days)", r"\b28\b"), ("a risk", r"budget|compensation|Army"))}
            not_found = bool(re.search(r"could ?n[o\u2019']t find|did ?n[o\u2019']t find|no (mention|record)", a["answer"], re.I))
            C.step(p_, inst_, "K1 ask the notebook", f"a long note ({long_chars} characters), facts across the whole note incl. its last line: answered from the note, never called defective (run {i})",
                   "PASS" if not defect and not invented and not a["alert"] and any(LONG_TITLE in s for s in a["sources"]) and not not_found and got["entry 26.35"] else "FAIL",
                   says_it_could_not_find_it=not_found,
                   question=Q_LONG, **a, says_a_note_is_defective=defect, says_it_worked_from_part=PARTIAL_OK.findall(a["answer"] + " " + (a["coverage"] or "")),
                   facts_found=got, not_in_notes=bad, INVENTED=bad if invented else None)
            if i == 1:
                chips = p_.locator('[data-testid="ask-answer"] [data-citation]')
                landed = click_chip(p_, chips.first) if chips.count() else {"ok": False, "error": "no chip"}
                C.step(p_, inst_, "K1 ask the notebook", "long note: a citation opens the note at a passage of that note", "PASS" if landed.get("ok") else "FAIL", landed=landed)

    def note_scope(p_, inst_, vp, measure):
        C.goto(p_, base, f"/journal/notebook?note={a_id}", ".ProseMirror")
        p_.wait_for_timeout(1000)
        p_.locator("[data-ask-toggle]").filter(visible=True).first.click(timeout=15000)
        a = ask_ui(p_, Q_NOTE, "ask-input-note")
        bad = check(a["answer"], K.NOTE_A[0] + " " + " ".join(K.NOTE_A[2]) + " " + Q_NOTE)
        invented = bool(bad["numbers"] or bad["proper_nouns"])
        if measure:
            m = p_.evaluate(CHIPS_JS)
            ok = len(m["chips"]) >= 2 and m["under_44"] == 0 and not m["overlaps"]
            C.step(p_, inst_, "K7 chips on a phone", "every citation chip is at least 44 by 44 and no two overlap", "PASS" if ok else "FAIL",
                   question=Q_NOTE, answer=a["answer"][:600], **m, not_in_note=bad, INVENTED=bad if invented else None)
        chips = p_.locator('[data-testid="ask-answer"] [data-citation]')
        landed = {"ok": False, "error": "no chip"}
        if chips.count():
            # the first chip that comes after the stop in the answer: it must land on the paragraph that holds 298.75
            idx = p_.evaluate("""() => { const el = document.querySelector('[data-testid="ask-answer"]'); const chips = [...el.querySelectorAll('[data-citation]')];
                for (let i = 0; i < chips.length; i++) { const r = document.createRange(); r.setStart(el, 0); r.setEndBefore(chips[i]);
                  if (r.toString().includes('298.75')) return i } return 0 }""")
            chips.nth(idx).click(timeout=8000)
            p_.wait_for_timeout(1500)
            landed = p_.evaluate(LAND_JS)
            landed["chip_index"] = idx
            landed["holds_the_stop"] = "298.75" in (landed.get("paragraph") or "")
            landed["ok"] = bool(landed.get("in_editor") and landed.get("paragraph") in K.NOTE_A[2] and not landed.get("notice"))
        C.step(p_, inst_, "citations", "inside a note: the citation lands on a passage of the note, selected and in the editor", "PASS" if landed.get("ok") and not invented else "FAIL",
               question=Q_NOTE, answer=a["answer"][:500], chips=a["chips"], landed=landed, not_in_note=bad, INVENTED=bad if invented else None)

    def long_note_server():
        for q in (Q_LONG, "What is my final rule for the PLTR trade?"):
            a = sse(M, "/api/j2/ask/stream", {"scope": "notebook", "target": None, "query": q, "history": []})
            src = [{"label": s_.get("label"), "citation": s_.get("citation"), "snippet_chars": len(s_.get("snippet") or ""),
                    "snippet_end": (s_.get("snippet") or "")[-70:]} for s_ in a["sources"]]
            not_found = bool(re.search(r"could ?n[o\u2019']t find", a["answer"], re.I))
            C.step(None, inst, "K1 ask the notebook", f"long note, our server's answer and the sources it sent: {q[:44]}",
                   "FAIL" if not_found else "PASS", question=q, status=a["status"], answer=a["answer"][:700], sources_sent=src, cited=a["cited"],
                   says_it_could_not_find_it=not_found, note_chars=long_chars,
                   the_fact_is_in_the_note=LONG_PARAS[-1], shot=False)

    def k1_1280():
        k1_on(pg, inst, "1280")
        long_note_server()
        note_scope(pg, inst, "1280", measure=False)

    run_step("k1", k1_1280)

    # ── K3: emphasis renders, in the panel and in the inserted block ─────────────────────────
    STARS = re.compile(r"\*\*|(?<![\w*])\*[^\s*][^*\n]*\*(?![\w*])|__\w")

    def k3_on(p_, inst_, vp, insert):
        open_notebook_ask(p_)
        a = ask_ui(p_, Q_BOLD, "ask-input-notebook")
        raw = STARS.findall(a["answer"])
        emph = a["bold_elements"] + a["italic_elements"]
        C.step(p_, inst_, "K3 emphasis", "in the Ask panel: bold renders as bold, no raw asterisks", "PASS" if emph > 0 and not raw and not a["alert"] else "FAIL",
               question=Q_BOLD, **a, raw_marks=raw, bold_text=[t[:40] for t in p_.locator('[data-testid="ask-answer"] strong').all_inner_texts()][:8])
        if not insert:
            chips = p_.locator('[data-testid="ask-answer"] [data-citation]')
            landed = click_chip(p_, chips.first) if chips.count() else {"ok": False, "error": "no chip"}
            C.step(p_, inst_, "K3 emphasis", "a chip in the panel still opens the right source", "PASS" if landed.get("ok") else "FAIL", landed=landed)
            return
        f = {}
        try:
            p_.get_by_role("button", name=re.compile(r"^Insert into")).first.click(timeout=8000)
            p_.wait_for_timeout(800)
            p_.locator('[role="dialog"] button').filter(has_text=re.compile(r"new note", re.I)).first.click(timeout=8000)
            p_.wait_for_url(lambda u: "note=" in u, timeout=30000)
            blk = p_.locator('[data-type="ask-insert"]')
            blk.first.wait_for(state="visible", timeout=30000)
            p_.wait_for_timeout(800)
            f["note"] = p_.url.split("note=")[-1].split("&")[0]
            f["block_label"] = blk.first.get_attribute("aria-label")
            f["block_text"] = blk.first.inner_text()[:1500]
            f["bold_in_block"] = blk.first.locator("strong").count()
            f["italic_in_block"] = blk.first.locator("em").count()
            f["raw_marks_in_block"] = STARS.findall(f["block_text"])
            f["chips_in_block"] = blk.first.locator("[data-ask-citation]").count()
            saved = json.dumps(note_json(p_.context.request, f["note"]).get("bodyJson") or {})
            f["raw_marks_in_saved_note"] = "**" in saved
            f["bold_marks_in_saved_note"] = saved.count('"bold"')
        except Exception as e:  # noqa: BLE001
            f["reach_error"] = f"{type(e).__name__}: {str(e)[:300]}"
        ok = f.get("bold_in_block", 0) > 0 and not f.get("raw_marks_in_block") and not f.get("raw_marks_in_saved_note") and f.get("chips_in_block", 0) > 0
        C.step(p_, inst_, "K3 emphasis", "in the block inserted into a note: bold renders as bold, no raw asterisks", "PASS" if ok else "FAIL", **f)
        landed = {"ok": False}
        try:
            chip = p_.locator('[data-type="ask-insert"] [data-ask-citation] button, [data-type="ask-insert"] [data-ask-citation] [role=button], [data-type="ask-insert"] [data-ask-citation] a').first
            if not chip.count():
                chip = p_.locator('[data-type="ask-insert"] [data-ask-citation]').first
            landed = click_chip(p_, chip)
            if not landed.get("cited_note"):   # the chip's name may not carry the title: judge by where it went
                landed["opened_a_crwd_note"] = any(i_ in (landed.get("url") or "") for i_ in (a_id, b_id))
                landed["paragraph_is_in_a_crwd_note"] = bool(landed.get("paragraph") and any(landed["paragraph"].strip() == p.strip() for p in K.NOTE_A[2] + K.NOTE_B[2]))
                landed["ok"] = bool(landed["opened_a_crwd_note"] and landed["paragraph_is_in_a_crwd_note"])
        except Exception as e:  # noqa: BLE001
            landed["error"] = f"{type(e).__name__}: {str(e)[:300]}"
        C.step(p_, inst_, "K3 emphasis", "a chip inside the inserted block still opens the right source", "PASS" if landed.get("ok") else "FAIL", landed=landed)

    run_step("k3", lambda: k3_on(pg, inst, "1280", insert=True))

    # ── K7: the citation chips on a phone ───────────────────────────────────────────────────
    CHIPS_JS = """() => { const cs = [...document.querySelectorAll('[data-testid="ask-answer"] [data-citation]')].map(e => { const b = e.getBoundingClientRect();
          return { n: e.getAttribute('data-citation'), x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, r: b.right, b: b.bottom, l: b.left, t: b.top } })
        const overlaps = []
        for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) { const a = cs[i], c = cs[j]
          const ox = Math.min(a.r, c.r) - Math.max(a.l, c.l), oy = Math.min(a.b, c.b) - Math.max(a.t, c.t)
          if (ox > 0.5 && oy > 0.5) overlaps.push([i, j, Math.round(ox), Math.round(oy)]) }
        let adjacent = 0
        for (let i = 0; i + 1 < cs.length; i++) if (Math.abs(cs[i].t - cs[i + 1].t) < 4 && cs[i + 1].l - cs[i].r < 12) adjacent++
        return { chips: cs.map(c => ({ n: c.n, x: c.x, y: c.y, w: c.w, h: c.h })), overlaps, adjacent_pairs: adjacent,
                 under_44: cs.filter(c => c.w + 0.5 < 44 || c.h + 0.5 < 44).length } }"""

    def k7_on(p_, inst_):
        note_scope(p_, inst_, "390", measure=True)

    # ── K6: the member's own Word file, a subject that is not markets ─────────────────────────
    def k6():
        nid = mk(M, inst, "Attachments walk", None, ["One Word file and one image are attached to this note."], "doc_note")
        if not S.get("doc_uploaded"):
            up = M.post(f"{base}/api/j2/notes/{nid}/attachments", multipart={"file": {"name": "zebra-memo.docx",
                        "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "buffer": K.make_docx(K.DOCX_PARAS)}})
            im = M.post(f"{base}/api/j2/notes/{nid}/images", multipart={"file": {"name": "acme-invoice.png", "mimeType": "image/png", "buffer": K.make_png(K.IMAGE_LINES)}})
            S["doc_uploaded"] = [up.status, im.status]
        rows, t0 = [], time.time()
        while time.time() - t0 < 90:
            j = M.get(f"{base}/api/j2/notes/{nid}/documents").json()
            rows = (j.get("documents") if isinstance(j, dict) else j) or []
            if len(rows) >= 2 and all(str(d.get("status")) not in ("pending", "processing", "queued") for d in rows) and time.time() - t0 > 6:
                break
            time.sleep(3)
        S["doc_rows"] = [{k_: d.get(k_) for k_ in ("id", "name", "sourceKind", "status", "pageCount")} for d in rows]
        d = next((x for x in rows if "docx" in str(x.get("name")).lower()), None)
        for i in (1, 2):
            a = sse(M, "/api/j2/ask/stream", {"scope": "document", "target": d.get("id"), "query": DOC_Q, "history": []})
            off = OFF_TOPIC.findall(a["answer"])
            cites = bool(a["cited"]) and any("zebra-memo.docx" in json.dumps(s_) for s_ in a["sources"])
            has = "March 9" in a["answer"] and "87" in a["answer"]
            bad = K.unsupported(a["answer"], " ".join(K.DOCX_PARAS) + " " + DOC_Q + " zebra-memo.docx")
            invented = bool(bad["numbers"] or bad["proper_nouns"])
            C.step(None, inst, "K6 ask over a Word file", f"a subject that is not markets: a cited answer, no remark that it is off topic (run {i})",
                   "PASS" if has and cites and not off and not invented else "FAIL", question=DOC_Q, status=a["status"], answer=a["answer"][:900],
                   cited=a["cited"], source_labels=[s_.get("label") for s_ in a["sources"]][:4], off_topic_remark=off, not_in_file=bad,
                   INVENTED=bad if invented else None, door="our server's ask door, as the member", shot=False)
        # rendered: the same question from the document's own sheet, if the note offers it
        f = {}
        try:
            C.goto(pg, base, f"/journal/notebook?note={nid}", ".ProseMirror")
            pg.wait_for_timeout(1500)
            link = pg.get_by_text("zebra-memo.docx").filter(visible=True)
            f["file_shown_on_the_note"] = link.count()
            link.first.click(timeout=8000)
            pg.wait_for_timeout(1500)
            tog = pg.locator('button[aria-label="Ask a question about this document"]').filter(visible=True)
            f["document_ask_button"] = tog.count()
            if tog.count():
                tog.first.click()
            a = ask_ui(pg, DOC_Q, "ask-input-document")
            f.update(a)
            f["off_topic_remark"] = OFF_TOPIC.findall(a["answer"])
            ok = "March 9" in a["answer"] and a["chips"] > 0 and not f["off_topic_remark"]
            C.step(pg, inst, "K6 ask over a Word file", "rendered, from the document's own sheet: cited, no off-topic remark", "PASS" if ok else "FAIL", question=DOC_Q, **f)
        except Exception as e:  # noqa: BLE001
            C.step(pg, inst, "K6 ask over a Word file", "rendered, from the document's own sheet", "NOT_RUN",
                   reason=f"the walk could not reach the document's sheet from the note: {type(e).__name__}: {str(e)[:200]}", **f)

    # ── K2: the Compass quote in a one-click review draft ────────────────────────────────────
    def seed_trades(req):
        from zoneinfo import ZoneInfo
        today = datetime.now(ZoneInfo("America/New_York"))
        mon = today - timedelta(days=today.weekday())
        elapsed = (today.date() - mon.date()).days
        sts = []
        for sym, e, st_, x_, off, hh in (("NVDA", 100, 99, 95, 0, ("10:00", "10:30")), ("NVDA", 95, 94, 93, 0, ("10:45", "11:15")),
                                         ("AAPL", 100, 99, 103, 1, ("10:00", "15:00")), ("TSLA", 100, 99, 102, 2, ("10:00", "15:00"))):
            day = (mon + timedelta(days=min(off, elapsed))).strftime("%Y-%m-%d")
            r = req.post(base + "/api/j2/trades", data={"symbol": sym, "side": "Long", "shares": 100, "entryPrice": e, "entryDate": day,
                                                         "exitPrice": x_, "exitDate": day, "originalStop": st_, "entryTimeEt": hh[0], "exitTimeEt": hh[1]})
            sts.append(r.status)
        return mon.strftime("%Y-%m-%d"), sts

    def draft_click(p_, kind):
        seen = []
        p_.on("request", lambda rq: seen.append(rq.url.split("/api/")[-1]) if "review-drafts/" in rq.url else None)
        home(p_)
        out = {"kind": kind}
        try:
            p_.locator(f'[data-tour="review-drafts-{kind}"]').first.click(timeout=20000)
            p_.wait_for_url(lambda u: "note=" in u, timeout=60000)
            out["note"] = p_.url.split("note=")[-1].split("&")[0]
            p_.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            p_.wait_for_timeout(1500)
            ed = p_.locator(".ProseMirror").first
            out["headings"] = [t.strip() for t in ed.locator("h1,h2,h3").all_inner_texts()]
            blk = ed.locator('[data-type="ask-insert"]')
            out["compass_block_label"] = blk.first.get_attribute("aria-label") if blk.count() else None
            out["compass_block_text"] = blk.first.inner_text()[:900] if blk.count() else None
            txt = ed.inner_text()
            i = txt.find("What Compass said")
            out["after_the_heading"] = txt[i:i + 420] if i >= 0 else None
        except Exception as e:  # noqa: BLE001
            out["reach_error"] = f"{type(e).__name__}: {str(e)[:300]}"
        out["the_page_asked"] = seen[-2:]
        return out

    def strings_of(o, acc):
        if isinstance(o, str):
            acc.append(o)
        elif isinstance(o, dict):
            for v in o.values():
                strings_of(v, acc)
        elif isinstance(o, list):
            for v in o:
                strings_of(v, acc)
        return acc

    ws = lambda s: re.sub(r"\s+", " ", s or "").strip()  # noqa: E731

    def k2():
        # (a) one account, four trades, a Compass review
        c1 = enter("k2_review_email", "k2a")
        i1 = C.Inst(c1, cfg, "1280")
        p1 = c1.new_page()
        mk(c1.request, i1, "Week notes", None, ["A line so Research Home shows its boxes."], "k2a_note")
        acc = (c1.request.get(base + "/api/j2/accounts").json().get("accounts") or [])
        aid = acc[0]["id"]
        if not S.get("k2_review_week"):
            wk, sts = seed_trades(c1.request)
            g = c1.request.post(f"{base}/api/j2/accounts/{aid}/coach/weekly-reviews/generate", data={"weekStart": wk}, timeout=240000)
            S["k2_review_week"], S["k2_review_gen"] = wk, g.status
            C.REC.setdefault("api_writes", []).append({"config": cfg, "method": "POST", "url": "/api/j2/accounts/<id>/coach/weekly-reviews/generate",
                                                        "status": g.status, "request": json.dumps({"weekStart": wk}), "response": (g.text() or "")[:4000], "trades": sts})
        wk = S["k2_review_week"]
        stored = strings_of(c1.request.get(f"{base}/api/j2/accounts/{aid}/coach/weekly-reviews").json(), [])
        d = draft_click(p1, "weekly")
        api_plain = c1.request.get(f"{base}/api/j2/review-drafts/weekly", params={"weekStart": wk}).json()
        ct = api_plain.get("compassText") or {}
        quote = (ct.get("text") if isinstance(ct, dict) else ct) or ""
        core = quote.rstrip("…").rstrip()
        exact = bool(core) and any(core in s for s in stored)
        shown = ws(d.get("compass_block_text"))
        seg_in_block = [seg for seg in [ws(x) for x in re.split(r"\n+", core) if len(x.strip()) > 40][:3] if seg[:80] in shown]
        ok = S.get("k2_review_gen") == 200 and exact and bool(d.get("compass_block_label")) and bool(seg_in_block)
        C.step(p1, i1, "K2 review draft", "one account, a Compass weekly review: the one-click weekly draft shows the quote, and it is an exact substring of the review",
               "PASS" if ok else "FAIL", generate_status=S.get("k2_review_gen"), week_start=wk, **d, server_quote=quote[:500],
               server_omitted=api_plain.get("compassOmitted"), quote_is_exact_substring_of_stored_review=exact,
               quote_paragraphs_seen_in_the_note=len(seg_in_block), accounts=len(acc))
        S["k2_review_note"] = d.get("note")
        # the same note on a phone
        c1p = C.new_ctx(browser, "390", storage=c1.storage_state())
        i1p = C.Inst(c1p, cfg, "390")
        p1p = c1p.new_page()
        try:
            C.goto(p1p, base, f"/journal/notebook?note={d.get('note')}", ".ProseMirror")
            p1p.wait_for_timeout(1500)
            blk = p1p.locator('[data-type="ask-insert"]')
            lab = blk.first.get_attribute("aria-label") if blk.count() else None
            C.step(p1p, i1p, "K2 review draft", "the drafted weekly note on a phone shows the Compass quote block", "PASS" if lab else "FAIL",
                   block_label=lab, block_text=blk.first.inner_text()[:300] if blk.count() else None)
        except Exception as e:  # noqa: BLE001
            C.step(p1p, i1p, "K2 review draft", "the drafted weekly note on a phone", "FAIL", error=str(e)[:300])
        c1p.close()
        S["k2_review_account"] = aid

        # (b) no review: the plain sentence. (c) monthly: no heading at all
        c2 = enter("k2_none_email", "k2b")
        i2 = C.Inst(c2, cfg, "1280")
        p2 = c2.new_page()
        mk(c2.request, i2, "Week notes", None, ["A line so Research Home shows its boxes."], "k2b_note")
        if not S.get("k2_none_seeded"):
            S["k2_none_seeded"] = seed_trades(c2.request)[1]
        d2 = draft_click(p2, "weekly")
        want = "Compass has not written a review of this week, so none is quoted here."
        C.step(p2, i2, "K2 review draft", "no Compass review: the weekly draft says so in a plain sentence",
               "PASS" if want in (d2.get("after_the_heading") or "") and not d2.get("compass_block_label") else "FAIL", **d2, expected_sentence=want)
        d3 = draft_click(p2, "monthly")
        no_head = "What Compass said" not in (d3.get("headings") or []) and not d3.get("after_the_heading") and bool(d3.get("note"))
        C.step(p2, i2, "K2 review draft", "monthly draft: no \"What Compass said\" heading at all", "PASS" if no_head else "FAIL", **d3)
        c2.close()

        # (d) two accounts, none chosen
        c3 = enter("k2_two_email", "k2c")
        i3 = C.Inst(c3, cfg, "1280")
        p3 = c3.new_page()
        mk(c3.request, i3, "Week notes", None, ["A line so Research Home shows its boxes."], "k2c_note")
        if not S.get("k2_two_made"):
            # trades FIRST: a new member's "Default" account only becomes a stored account once it
            # is used, and an account made before that replaces it instead of joining it
            S["k2_two_trades"] = S.get("k2_two_trades") or seed_trades(c3.request)[1]
            made = []
            for nm, col in (("Second account", "teal"), ("Third account", "amber")):
                if len(c3.request.get(base + "/api/j2/accounts").json().get("accounts") or []) >= 2:
                    break
                mk_acc = c3.request.post(base + "/api/j2/accounts", data={"name": nm, "startingBalance": 50000, "color": col})
                made.append([nm, mk_acc.status])
            S["k2_two_made"] = True
            S["k2_two_seeded"] = made + S["k2_two_trades"]
        accs = (c3.request.get(base + "/api/j2/accounts").json().get("accounts") or [])
        p3.goto(base + "/journal/notebook", wait_until="domcontentloaded")
        p3.wait_for_timeout(2500)
        chosen = p3.evaluate("() => localStorage.getItem('uct.j2.selectedAccountId')")
        # "All accounts" is what the account picker stores as `_all_` (hooks/useJ2SelectedAccount.js);
        # with nothing stored the page picks the first account by itself. The walk stores the
        # picker's own value rather than driving the picker.
        p3.evaluate("() => localStorage.setItem('uct.j2.selectedAccountId', '_all_')")
        d4 = draft_click(p3, "weekly")
        want2 = "You have several accounts and none is chosen."
        C.step(p3, i3, "K2 review draft", "two accounts, none chosen: the draft says to choose an account",
               "PASS" if want2 in (d4.get("after_the_heading") or "") and len(accs) == 2 else "FAIL", **d4, accounts=len(accs),
               stored_choice_before=chosen, choice_for_this_step="_all_ (All accounts)", setup=S.get("k2_two_seeded"), expected_sentence_start=want2)
        c3.close()

        # K5 rides the member who has a Compass review (its weekly focus is what was cut mid-word)
        S["_k5_ctx"] = True
        k5(c1, i1)
        c1.close()

    # ── K5: the morning briefing script ──────────────────────────────────────────────────────
    END_OK = re.compile(r"[.!?…:)\"”’'\]]\s*$")

    def k5(c_, i_):
        r = c_.request.post(base + "/api/voice/session_token", data={"context": "global"}, timeout=120000)
        try:
            sid = r.json().get("session_id")
        except Exception:  # noqa: BLE001
            sid = None
        C.REC.setdefault("api_writes", []).append({"config": cfg, "method": "POST", "url": "/api/voice/session_token", "status": r.status,
                                                    "request": json.dumps({"context": "global"}),
                                                    "response": f"(redacted: holds a short-lived vendor secret) session_id={sid}"})
        if not sid:
            C.step(None, i_, "K5 briefing", "the voice session door", "FAIL", status=r.status, shot=False)
            return
        x = c_.request.post(base + "/api/voice/exec", data={"session_id": sid, "tool": "play_my_morning_briefing", "args": {}}, timeout=180000)
        body = x.json() if x.status == 200 else {}
        C.REC.setdefault("api_writes", []).append({"config": cfg, "method": "POST", "url": "/api/voice/exec", "status": x.status,
                                                    "request": json.dumps({"session_id": sid, "tool": "play_my_morning_briefing", "args": {}}),
                                                    "response": json.dumps(body)[:6000]})
        res = body.get("result") or {}
        script = res.get("script") or ""
        secs = res.get("sections") or {}
        bad_secs = {k_: v[-60:] for k_, v in secs.items() if isinstance(v, str) and v.strip() and k_ != "date" and not END_OK.search(v)}
        # the spoken script: every line and the piece before the sign-off must end on a whole sentence
        closing = "Tap me when you're ready to dig in."
        head = script[: script.rfind(closing)].rstrip() if closing in script else script
        pieces = [x_.strip() for x_ in re.split(r"\n+", head) if x_.strip()]
        cut = [p_[-50:] for p_ in pieces if not END_OK.search(p_)]
        focus = secs.get("weekly_focus") or ""
        focus_whole = True
        if focus:
            spoken = next((p_ for p_ in pieces if focus[:40] in p_), "")
            tail = spoken[spoken.find(focus[:40]):] if spoken else ""
            focus_whole = bool(tail) and END_OK.search(tail) is not None and (ws(tail) in ws(focus) or ws(focus) in ws(tail) or ws(focus).startswith(ws(tail)))
        last_word_whole = bool(re.search(r"[A-Za-z]{2,}[.!?…\"”’')]*\s*$", head))
        ok = x.status == 200 and script and not cut and not bad_secs and focus_whole and last_word_whole
        C.step(None, i_, "K5 briefing", "the spoken script ends on a whole sentence in every section, and the weekly focus is not cut mid-word",
               "PASS" if ok else "FAIL", status=x.status, script=script[:2500], pieces_not_ending_on_a_sentence=cut, sections_not_ending_on_a_sentence=bad_secs,
               weekly_focus=focus[:700], weekly_focus_spoken_whole_or_cut_at_a_sentence=focus_whole, section_names=sorted(secs.keys()), cached=res.get("cached"), shot=False)
        c_.request.post(base + "/api/voice/session/end", data={"session_id": sid, "duration_seconds": 1})

    # ── OCR: is the app's own engine here? ───────────────────────────────────────────────────
    def ocr():
        explicit = os.environ.get("TESSERACT_BINARY")
        found = shutil.which("tesseract")
        try:
            boot = (C.OUT / "sandbox-keyedai.log").read_text(encoding="utf-8", errors="replace")
            fp = [ln.strip()[:240].encode("ascii", "replace").decode() for ln in boot.splitlines() if re.search(r"j2-ocr|doc-ocr", ln)][:5]
        except Exception:  # noqa: BLE001
            fp = []
        active = any("active=True" in ln for ln in fp)
        C.step(None, inst, "OCR", "the app's own OCR engine in this sandbox", "INFO", TESSERACT_BINARY_set=bool(explicit), tesseract_on_PATH=found,
               boot_lines_about_ocr=fp, engine_active=active,
               how_the_app_finds_it="document_ocr_tesseract.binary_path: TESSERACT_BINARY, then PATH, then /usr/bin and /usr/local/bin", shot=False)
        if not active:
            C.step(None, inst, "OCR", "Ask over an image with text", "NOT_RUN",
                   reason="the boot reports no active OCR engine (see the INFO row); an image document stays `no_text`", shot=False)
            return
        nid = mk(M, inst, "Invoice photo", None, ["A photo of an invoice is attached."], "ocr_note")
        up = M.post(f"{base}/api/j2/notes/{nid}/images", multipart={"file": {"name": "acme-invoice.png", "mimeType": "image/png", "buffer": K.make_png(K.IMAGE_LINES)}})
        rows, t0 = [], time.time()
        while time.time() - t0 < 150:
            j_ = M.get(f"{base}/api/j2/notes/{nid}/documents").json()
            rows = (j_.get("documents") if isinstance(j_, dict) else j_) or []
            if rows and str(rows[0].get("status")) in ("ready", "failed", "ocr_failed") and time.time() - t0 > 5:
                break
            time.sleep(3)
        d = rows[0] if rows else {}
        text = None
        if d.get("id"):
            t = M.get(f"{base}/api/j2/notes/documents/{d['id']}/pages/1/text")
            text = (t.text() or "")[:500]
        C.step(None, inst, "OCR", "an image with text becomes a document whose text was read off the picture", "PASS" if str(d.get("status")) == "ready" else "FAIL",
               upload_status=up.status, document={k_: d.get(k_) for k_ in ("id", "name", "sourceKind", "status", "pageCount")},
               page_text_door=text, seconds=round(time.time() - t0, 1), words_on_the_image=K.IMAGE_LINES, shot=False)
        if str(d.get("status")) != "ready":
            return
        q = "What is the total due on the invoice, and what is the invoice number?"
        for i_ in (1, 2):
            a = sse(M, "/api/j2/ask/stream", {"scope": "document", "target": d["id"], "query": q, "history": []})
            bad = check(a["answer"], " ".join(K.IMAGE_LINES) + " " + q + " image invoice")
            invented = bool(bad["numbers"] or bad["proper_nouns"])
            cites = bool(a["cited"]) and bool(a["sources"])
            has = "912" in a["answer"] and "4471" in a["answer"]
            C.step(None, inst, "OCR", f"Ask over the image: the answer has the words on the picture and cites the file (run {i_})",
                   "PASS" if has and cites and not invented else "FAIL", question=q, status=a["status"], answer=a["answer"][:700], cited=a["cited"],
                   sources=[{k_: s_.get(k_) for k_ in ("label", "citation", "textSource", "scanned", "ocr")} for s_ in a["sources"]][:3],
                   off_topic_remark=OFF_TOPIC.findall(a["answer"]), not_on_the_image=bad, INVENTED=bad if invented else None,
                   door="our server's ask door, as the member", shot=False)
        # rendered: the note shows the picture; the document's text status, as the member sees it
        try:
            C.goto(pg, base, f"/journal/notebook?note={nid}", ".ProseMirror")
            pg.wait_for_timeout(2000)
            C.step(pg, inst, "OCR", "the note with the image, as rendered", "INFO", page_text=pg.locator("main").first.inner_text()[:600])
        except Exception as e:  # noqa: BLE001
            C.step(pg, inst, "OCR", "the note with the image, as rendered", "INFO", error=str(e)[:200])

    def phone():
        ctxp = C.new_ctx(browser, "390", storage=ctx.storage_state())
        instp = C.Inst(ctxp, cfg, "390")
        pp = ctxp.new_page()

        def g(name, fn):
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                C.step(pp, instp, name, "driver exception (the step did not finish)", "FAIL",
                       error=f"{type(e).__name__}: {str(e)[:600]}", traceback=traceback.format_exc()[-1400:])
        if "k1" in steps:
            g("K1 ask the notebook", lambda: k1_on(pp, instp, "390"))
        if "k3" in steps:
            g("K3 emphasis", lambda: k3_on(pp, instp, "390", insert=False))
        if "k7" in steps:
            g("K7 chips on a phone", lambda: k7_on(pp, instp))
        ctxp.close()

    # K4 on the phone must also run before the K3 insert adds a third note that mentions CRWD, so
    # the phone pass for K4 and K1 goes here, and K3's 1280 insert ran above only for 1280.
    run_step("k6", k6)
    run_step("k2", k2)
    run_step("ocr", ocr)
    phone()
    ctx.close()


if __name__ == "__main__":
    print("run this through tools/notebook_fin_walk.py --config keyedai")
    sys.exit(2)

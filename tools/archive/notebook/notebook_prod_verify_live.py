"""Production check of the two Notebook features armed on 2026-10-09 and of the long-note Ask fix,
as the smoke account, on notes the run creates and removes.

What it proves, on the LIVE site:
  * MEANING SEARCH (`NOTEBOOK_SEMANTIC_SEARCH_ENABLED`): three notes are created; the production
    embedding sweep (every 15 min, `api/main.py` id `notebook_semantic_sweep`) is waited for, never
    run by hand; then a phrase that shares NO word with the target note finds it through
    `GET /api/j2/notes?meaning=1` with `matchKind == "meaning"`, plain search does not, and in the
    browser the row is labelled "Related by meaning" at 1280 and at 390 (touch).
  * VOICE NOTES (`NOTEBOOK_VOICE_NOTES_ENABLED`): offline synthesised speech (Windows
    System.Speech) is uploaded through the member's own door (Templates, Start from audio, Upload
    recording), transcribed, summarised, and saved as a note holding the transcript, the labelled
    summary and the tickers NVDA and TSLA. At 390 the same doors open and are at least 44 px.
  * LONG-NOTE ASK (fin-walk 8.2, K1; fix in `ask_retrieval.whole_note_budget`): the 1,878-character
    "PLTR deep dive" note, Research Home Ask, the question that spans the whole note, at 1280 and
    390. The answer must carry 26.35, 24.85, both risks, the final rule (28), and a citation.
  * Cleanup: every note the run created is soft-deleted through `DELETE /api/j2/notes/{id}` (the
    product's own trash, like any member deletion; the nightly purge removes it after 30 days, and
    its embeddings and voice-note rows go with it) and checked gone (404).

Preconditions: `SMOKE_EMAIL` / `SMOKE_PASSWORD` in the environment, never printed. The account is
asserted SYNTHETIC (`@uctintelligence.internal`) before anything is written. Playwright Chromium.

Model calls on production: two Ask questions, one transcription of ~15 s of audio, one voice-note
summary, and query embeddings for the meaning searches. All on the smoke account.

Exit codes: 0 PASS, 1 a measured FAIL, 2 INCONCLUSIVE (not signed in, wrong account, a door not
reached, the sweep not seen within the wait).

Usage:  python tools/notebook_prod_verify_live.py --out docs/notebook/evidence/verify-1009/live
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import notebook_prod_ask_check as P  # noqa: E402  -- stdlib-only module: login, intro, Ask helpers

PROD = P.PROD
TAG = "Smoke verify 1009"
MEANING_NOTES = [
    ("Bedtime rule", "I trade worse after a short night. Lights out by ten keeps my morning decisions calm."),
    ("Copper inventories", "Warehouse stocks of copper in Shanghai fell for a sixth week."),
    ("Position sizing table", "One percent of the account per idea, two percent only on the best setups."),
]
MEANING_QUERY = "rest and fatigue hurting judgement"
SPEECH = ("Quick note on today. Nvidia held its ten week line and I added a small position. "
          "Tesla failed at resistance, so I am staying out. Tomorrow I need to review my stops.")
SWEEP_WAIT_S = 40 * 60
SWEEP_POLL_S = 60


def _long_note() -> tuple[list[str], str]:
    """LONG_PARAS and Q_LONG read from the keyed walk by AST, so the text is the walk's own and no
    module with side effects is imported."""
    tree = ast.parse((HERE / "notebook_fin_walk_keyed_ai.py").read_text(encoding="utf-8"))
    vals = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            if node.targets[0].id in ("LONG_PARAS", "Q_LONG"):
                vals[node.targets[0].id] = ast.literal_eval(node.value)
    return vals["LONG_PARAS"], vals["Q_LONG"]


LONG_PARAS, Q_LONG = _long_note()
LONG_EXPECT = {"entry": "26.35", "stop": "24.85", "risk_budget": "budget", "risk_sbc": "compensation", "rule": "28"}


def synth_wav(text: str, dest: Path) -> str | None:
    ps = ("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
          f"$s.Rate = 0; $s.SetOutputToWaveFile('{dest}'); $s.Speak('{text.replace(chr(39), chr(39) * 2)}'); $s.Dispose()")
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                       capture_output=True, text=True, timeout=120)
    if r.returncode != 0 or not dest.is_file() or dest.stat().st_size < 20000:
        return f"speech synthesis rc {r.returncode}: {(r.stderr or '')[:200]}"
    return None


def doc(paras: list[str]) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": t}]} for t in paras]}


def clear_intro(page, budget_s: float = 15) -> bool:
    end = time.time() + budget_s
    while time.time() < end:
        if page.locator(P.INTRO_SEL).count() == 0:
            page.wait_for_timeout(600)
            if page.locator(P.INTRO_SEL).count() == 0:
                return True
        page.keyboard.press("Escape")
        try:
            sk = page.locator(P.INTRO_SKIP_SEL)
            if sk.count() and sk.first.is_visible():
                sk.first.click(timeout=2000)
        except Exception:
            pass
        page.wait_for_timeout(400)
    return page.locator(P.INTRO_SEL).count() == 0


def run(base: str, out: Path) -> int:
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
    if not email or not pw:
        print("INCONCLUSIVE: SMOKE_EMAIL / SMOKE_PASSWORD not in the environment")
        return 2
    out.mkdir(parents=True, exist_ok=True)
    rec: dict = {"base": base, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "steps": [], "legs": {}}
    t0 = time.time()
    created: list[str] = []

    def step(name, **kw):
        kw["t"] = round(time.time() - t0, 1)
        rec["steps"].append({"name": name, **kw})
        print(f"  {name}: {json.dumps(kw)[:400]}", flush=True)
        save()

    def save():
        (out / "result.json").write_text(json.dumps(rec, indent=1), encoding="utf-8")

    def shot(page, name):
        try:
            page.screenshot(path=str(out / f"{name}.png"), full_page=True)
        except Exception:
            pass

    with sync_playwright() as p:
        br = p.chromium.launch()
        desk = br.new_context(viewport={"width": 1280, "height": 900})
        phone = br.new_context(viewport=P.TOUCH_VIEWPORT, device_scale_factor=P.TOUCH_DPR, has_touch=True, is_mobile=True)
        pages = {"1280": desk.new_page(), "390": phone.new_page()}
        errors: dict = {"1280": [], "390": []}
        for vp, pg in pages.items():
            pg.on("pageerror", lambda e, vp=vp: errors[vp].append(str(e)[:200]))
        api = pages["1280"].request

        for vp, pg in pages.items():
            ls, ms, who = P._login(pg.request, base, email, pw)
            step(f"login_{vp}", status=ls, me=ms, synthetic=who.endswith(P.SYNTHETIC_DOMAIN))
            if not ls or ls >= 400 or not who.endswith(P.SYNTHETIC_DOMAIN):
                rec["verdict"] = {"code": 2, "why": "not signed in as the synthetic smoke account; nothing written"}
                save()
                print("INCONCLUSIVE: " + rec["verdict"]["why"])
                return 2
        rec["inventory_before"] = P._inventory(api, base)
        step("inventory_before", **rec["inventory_before"])

        def retry(fn, what: str, budget_s: float = 360):
            """Other sessions deploy web often; a swap answers 502/503 for a minute or two. Retry a
            5xx (never a 4xx) with backoff, and record every retry."""
            end, wait = time.time() + budget_s, 5
            while True:
                r = fn()
                if r.status < 500 or time.time() > end:
                    return r
                step("retry_5xx", what=what, status=r.status)
                time.sleep(wait)
                wait = min(wait * 2, 40)

        def mk(title: str, paras: list[str]) -> str | None:
            r = retry(lambda: api.post(f"{base}/api/j2/notes", data=json.dumps({"title": title, "bodyJson": doc(paras)}),
                                       headers={"Content-Type": "application/json"}), "create note")
            nid = None
            try:
                nid = (r.json().get("note") or {}).get("id")
            except Exception:
                pass
            if nid:
                created.append(nid)
            step("note_created", title=title, status=r.status, id_present=bool(nid))
            return nid

        try:
            # ── create everything first, so the production sweep can index while the other legs run
            created_at = time.time()
            meaning_ids = [mk(f"{TAG}: {t}", [b]) for t, b in MEANING_NOTES]
            long_id = mk(f"{TAG}: PLTR deep dive", LONG_PARAS)
            if not all(meaning_ids) or not long_id:
                rec["verdict"] = {"code": 2, "why": "a check note could not be created"}
                return 2
            target_title = f"{TAG}: {MEANING_NOTES[0][0]}"
            target_words = set(re.findall(r"[a-z]+", (target_title + " " + MEANING_NOTES[0][1]).lower()))
            rec["legs"]["meaning_words_shared"] = sorted(set(re.findall(r"[a-z]+", MEANING_QUERY.lower())) & target_words)

            # ── leg: long-note Ask, both widths
            long_leg: dict = {}
            rec["legs"]["long_note_ask"] = long_leg
            prev = ""
            for vp, pg in pages.items():
                r: dict = {}
                long_leg[vp] = r
                try:
                    pg.goto(f"{base}/journal/notebook", wait_until="domcontentloaded", timeout=60_000)
                    pg.wait_for_selector("[data-ask-toggle], h2:has-text('Welcome to your Notebook')", timeout=45_000)
                    r["intro_gone"] = clear_intro(pg)
                    answer, alert, sources = P._ask(pg, "my notebook", Q_LONG, out, f"long-ask-{vp}", step, previous=prev)
                    r.update(answer=answer[:1500], alert=alert, sources=sources,
                             found={k: (v.lower() in answer.lower()) for k, v in LONG_EXPECT.items()},
                             refusal="couldn't find" in answer.lower() or "could not find" in answer.lower())
                    if sources:
                        pg.locator('[data-testid="ask-sources"] button').first.click()
                        try:
                            pg.wait_for_url(lambda u: long_id in u, timeout=15_000)
                        except Exception:
                            pass
                        r["citation_opened_note"] = long_id in pg.url
                        shot(pg, f"long-ask-cited-{vp}")
                except Exception as e:
                    r["error"] = f"{type(e).__name__}: {str(e)[:240]}"
                    shot(pg, f"long-ask-error-{vp}")
                r["pass"] = bool(r.get("found") and all(r["found"].values()) and r.get("sources") and r.get("citation_opened_note") and not r.get("alert"))
                step(f"long_note_ask_{vp}", **{k: v for k, v in r.items() if k != "answer"})

            # ── leg: voice note at 1280 (full flow), doors at 390
            vleg: dict = {}
            rec["legs"]["voice_note"] = vleg
            wav = out.parent / "_tmp_voicenote.wav"
            why = synth_wav(SPEECH, wav)
            st = api.get(f"{base}/api/j2/voice-notes/status")
            vleg["status_door"] = {"status": st.status, "body": (st.text() or "")[:300]}
            if why:
                vleg["error"] = why
            else:
                pg = pages["1280"]
                try:
                    pg.goto(f"{base}/journal/notebook?view=all", wait_until="domcontentloaded", timeout=60_000)
                    pg.wait_for_timeout(1500)
                    clear_intro(pg)
                    pg.get_by_role("button", name="Templates", exact=True).filter(visible=True).first.click(timeout=20000)
                    sheet = pg.get_by_role("dialog", name="New note")
                    sheet.wait_for(state="visible", timeout=10000)
                    grp = sheet.get_by_role("group", name="Start from audio")
                    vleg["audio_doors"] = [b.strip() for b in grp.get_by_role("button").all_inner_texts()]
                    grp.get_by_role("button", name=re.compile("Upload recording")).click()
                    dlg = pg.get_by_role("dialog", name="Voice note")
                    dlg.wait_for(state="visible", timeout=10000)
                    dlg.get_by_label("Choose an audio file").set_input_files(str(wav))
                    dlg.get_by_role("button", name="Transcribe").click()
                    prevr = dlg.get_by_role("region", name="Voice note preview")
                    ts = time.time()
                    while time.time() - ts < 240:
                        if prevr.count() and prevr.first.is_visible():
                            break
                        al = dlg.get_by_role("alert")
                        if al.count() and al.first.is_visible():
                            vleg["alert"] = al.first.inner_text()[:300]
                            break
                        pg.wait_for_timeout(700)
                    vleg["transcribe_s"] = round(time.time() - ts, 1)
                    vleg["preview"] = prevr.first.inner_text()[:1200] if prevr.count() else None
                    shot(pg, "voice-preview-1280")
                    if vleg["preview"]:
                        dlg.get_by_role("textbox", name="Title").fill(f"{TAG}: voice note")
                        dlg.get_by_role("button", name="Save as a new note").click()
                        pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
                        pg.get_by_text("Voice note summary").first.wait_for(timeout=30000)
                        pg.wait_for_timeout(1000)
                        vid = pg.url.split("note=")[-1].split("&")[0] if "note=" in pg.url else None
                        if vid:
                            created.append(vid)
                        vleg["note_id_present"] = bool(vid)
                        vleg["note_text"] = pg.locator(".ProseMirror").first.inner_text()[:1600]
                        saved = api.get(f"{base}/api/j2/notes/{vid}").text().lower() if vid else ""
                        vleg["transcript_in_saved_note"] = "added a small position" in saved and "review my stops" in saved
                        blk = pg.locator('[data-type="ask-insert"]')
                        vleg["summary_label"] = blk.first.get_attribute("aria-label") if blk.count() else None
                        vleg["tickers"] = [t for t in ("NVDA", "TSLA") if t in (vleg["note_text"] or "")]
                        shot(pg, "voice-note-saved-1280")
                except Exception as e:
                    vleg["error"] = f"{type(e).__name__}: {str(e)[:300]}"
                    shot(pg, "voice-error-1280")
                # 390: the same doors open, at least 44 px, then Cancel/Escape (nothing uploaded)
                ph = pages["390"]
                try:
                    ph.goto(f"{base}/journal/notebook?view=all", wait_until="domcontentloaded", timeout=60_000)
                    ph.wait_for_timeout(1500)
                    clear_intro(ph)
                    ph.get_by_role("button", name="Templates", exact=True).filter(visible=True).first.click(timeout=20000)
                    sheet = ph.get_by_role("dialog", name="New note")
                    sheet.wait_for(state="visible", timeout=10000)
                    up = sheet.get_by_role("group", name="Start from audio").get_by_role("button", name=re.compile("Upload recording"))
                    bb = up.bounding_box()
                    vleg["phone_upload_door_box"] = bb
                    up.click()
                    dlg = ph.get_by_role("dialog", name="Voice note")
                    dlg.wait_for(state="visible", timeout=10000)
                    # "Transcribe" renders only after a file is chosen (VoiceNoteDialog.jsx), so the
                    # sheet's own buttons are measured instead -- every one, by its rendered box.
                    # ⚰️ The 2026-10-09 run waited for Transcribe here and timed out: an instrument miss.
                    boxes = [{"label": (b.inner_text() or "").strip()[:30], **(b.bounding_box() or {})}
                             for b in dlg.get_by_role("button").all()]
                    vleg["phone_dialog_buttons"] = boxes
                    shot(ph, "voice-dialog-390")
                    vleg["phone_doors_44"] = bool(boxes) and all(
                        b and b.get("width", 0) >= 44 - 0.5 and b.get("height", 0) >= 44 - 0.5 for b in [bb, *boxes])
                    ph.keyboard.press("Escape")
                except Exception as e:
                    vleg["phone_error"] = f"{type(e).__name__}: {str(e)[:300]}"
                    shot(ph, "voice-error-390")
                try:
                    wav.unlink()
                except Exception:
                    pass
            vleg["pass"] = bool(vleg.get("transcript_in_saved_note") and vleg.get("summary_label")
                                and len(vleg.get("tickers") or []) == 2 and not vleg.get("alert") and vleg.get("phone_doors_44"))
            step("voice_note", **{k: v for k, v in vleg.items() if k not in ("note_text", "preview")})

            # ── leg: meaning search, waiting for the PRODUCTION sweep
            mleg: dict = {"query": MEANING_QUERY}
            rec["legs"]["meaning_search"] = mleg
            hit = None
            while time.time() - created_at < SWEEP_WAIT_S:
                mr = api.get(f"{base}/api/j2/notes", params={"q": MEANING_QUERY, "limit": "20", "meaning": "1"})
                rows = (mr.json().get("notes") or []) if mr.status == 200 else []
                hit = next((n for n in rows if n.get("title") == target_title and n.get("matchKind") == "meaning"), None)
                mleg["last_poll"] = {"status": mr.status, "rows": [{"title": n.get("title"), "matchKind": n.get("matchKind")} for n in rows][:6],
                                     "age_s": round(time.time() - created_at)}
                if hit:
                    break
                save()
                time.sleep(SWEEP_POLL_S)
            mleg["indexed_after_s"] = round(time.time() - created_at) if hit else None
            lex = api.get(f"{base}/api/j2/notes", params={"q": MEANING_QUERY, "limit": "20"})
            mleg["plain_search_titles"] = [n.get("title") for n in ((lex.json().get("notes") or []) if lex.status == 200 else [])]
            if not hit:
                step("meaning_search", indexed=False, **{k: v for k, v in mleg.items() if k != "query"})
                rec["verdict"] = {"code": 2, "why": f"the production sweep did not index the check notes within {SWEEP_WAIT_S // 60} min"}
            else:
                mleg["reason"] = hit.get("matchReason")
                for vp, pg in pages.items():
                    r: dict = {}
                    mleg[vp] = r
                    try:
                        pg.goto(f"{base}/journal/notebook?view=all", wait_until="domcontentloaded", timeout=60_000)
                        pg.wait_for_timeout(1500)
                        clear_intro(pg)
                        box = pg.get_by_label("Search your notes").first
                        if not box.count() or not box.is_visible():
                            pg.locator('[aria-label="Search notes"]').first.click(timeout=15000)
                        box.wait_for(state="visible", timeout=20000)
                        box.fill(MEANING_QUERY)
                        pg.get_by_text(target_title).first.wait_for(state="visible", timeout=30000)
                        pg.wait_for_timeout(1000)
                        r["labelled"] = pg.get_by_text("Related by meaning").filter(visible=True).count() > 0
                        shot(pg, f"meaning-{vp}")
                    except Exception as e:
                        r["error"] = f"{type(e).__name__}: {str(e)[:240]}"
                        shot(pg, f"meaning-error-{vp}")
                mleg["pass"] = bool(not rec["legs"]["meaning_words_shared"] and target_title not in mleg["plain_search_titles"]
                                    and all(mleg[v].get("labelled") for v in pages))
                step("meaning_search", indexed=True, **{k: v for k, v in mleg.items() if k != "query"})

            rec["page_errors"] = errors
        finally:
            gone = {}
            for nid in created:
                try:
                    d = retry(lambda: api.delete(f"{base}/api/j2/notes/{nid}"), "delete note", 600)
                    g = retry(lambda: api.get(f"{base}/api/j2/notes/{nid}"), "confirm gone", 300)
                    gone[nid[:8]] = {"delete": d.status, "get_after": g.status}
                except Exception as e:
                    gone[nid[:8]] = {"error": str(e)[:120]}
            rec["cleanup"] = gone
            rec["inventory_after"] = P._inventory(api, base)
            step("cleanup", removed=sum(1 for v in gone.values() if v.get("get_after") == 404), created=len(created),
                 inventory_after=rec["inventory_after"])
            save()
            br.close()

    legs = rec["legs"]
    if rec.get("verdict"):
        code, why = rec["verdict"]["code"], rec["verdict"]["why"]
    else:
        fails = [k for k in ("long_note_ask", "voice_note", "meaning_search")
                 if not (legs[k].get("pass") if k != "long_note_ask" else all(v.get("pass") for v in legs[k].values()))]
        code, why = (1, "FAILED: " + ", ".join(fails)) if fails else (0, "every leg passed")
    if any(errors.values()) and code == 0:
        code, why = 1, f"page errors: {errors}"
    if not all(v.get("get_after") == 404 for v in rec["cleanup"].values()):
        code, why = max(code, 1), why + "; CLEANUP INCOMPLETE"
    rec["verdict"] = {"code": code, "why": why}
    save()
    print(("PASS: " if code == 0 else "FAIL: " if code == 1 else "INCONCLUSIVE: ") + why)
    return code


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=PROD)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    return run(a.base.rstrip("/"), Path(a.out))


if __name__ == "__main__":
    sys.exit(main())

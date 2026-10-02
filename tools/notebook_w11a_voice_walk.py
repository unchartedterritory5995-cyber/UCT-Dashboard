"""Wave 11 lane 11A live walk -- voice and meeting notes in a real Chromium, against a
LOCAL sandbox. The evidence it writes: docs/notebook/evidence/w11a/walk-<sha>/walk.json
(+ the launcher's integrity log and screenshots). It is NOT a pytest rail.

⛔ THIS DRIVER NEVER IMPORTS `api.*`. It owns its sandbox through the perf harness's
`Sandbox` (scripts/hub_sandbox_boot.py, in its own process group, stopped gracefully so
the launcher writes its SHUTDOWN checkpoint), talks to it over HTTP, and prints the
launcher's snapshot verdict (`SANDBOX INTEGRITY: ...`) as its FIRST output line.

⛔ NO MODEL IS CALLED. The boot blanks every model key; the server's vendor seams answer
through `NOTEBOOK_VOICE_SANDBOX_STUB=1`, which the service honours ONLY off Railway and
only with both model keys blank (railed in tests/test_notebook_voice_notes.py). ffmpeg
and ffprobe run for real: the uploads are genuinely probed and cut into 5-minute parts.

Run it from POWERSHELL with the sandbox's environment in that same shell:

    $env:NOTEBOOK_VOICE_NOTES_ENABLED = '1'      # voice_notes.enabled / auth NOTEBOOK_FLAGS
    $env:NOTEBOOK_VOICE_SANDBOX_STUB = '1'       # voice_notes.sandbox_stub_active
    $env:ANTHROPIC_API_KEY = ''; $env:OPENAI_API_KEY = ''
    python tools/notebook_w11a_voice_walk.py --data-dir '<scratchpad>\\w11a-data' --port 8563 `
        --out docs/notebook/evidence/w11a/walk-<sha>/walk.json --tip <sha> `
        --artifacts docs/notebook/evidence/w11a/walk-<sha>

Preconditions: app/dist built from the tip; the port free (refused, never killed); the
data dir outside the shared root (refused); ffmpeg on PATH.

  V0  the server gate and the stub: the auth payload says ON; /status answers the cap
  V1  RECORD at 1280: New note -> Start from audio -> Voice note -> Start recording (a fake
      microphone) -> the timer runs -> Pause freezes it -> Resume -> Stop -> progress ->
      the preview (AI label, summary, $NVDA $AMD, never the invented $TSLA, action items,
      transcript) -> Save -> the note opens; its stored body holds every section
  V2  UPLOAD a 12-minute file: three parts transcribed in order (three requests), the
      month's minutes go up by the file's length, the note is saved
  V3  RETRY: part 2 fails once (sandbox-fail-once*); the sentence and Retry are shown;
      Retry continues WITHOUT a second upload; the recording is then discarded
  V4  THE CAP: a 55-minute file with fewer minutes left is refused up front, with both
      numbers, and nothing is transcribed
  V5  DESK: From a Desk session -> the seeded session -> preview -> Save
  V6  /voice in the editor, by KEYBOARD only: type /voice, Enter, Tab/Enter through the
      dialog, "Add to this note" -> the sections land in THIS note and are autosaved
  V7  a LOCKED note: /voice is refused with the standard locked sentence
  V8  390 px, touch: the sheet's audio buttons and the dialog fit the screen, every
      control is at least 44 px tall, no sideways scroll
  V9  the Desk player's "Save to Notebook" on a session with a transcript
  V10 no unforced page error across the walk
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))
from tools import notebook_perf_harness as H  # noqa: E402  (ONE sandbox + integrity reader)
import sandbox_identity  # noqa: E402

REQUIRED = [H.PRE_BOOT, H.POST_BOOT, H.PREWARM, H.SHUTDOWN]
EMAIL = "w11a@local.dev"
PUSH = "hub-sandbox-local-only-not-the-real-secret"   # scripts/hub_sandbox_boot.py's own value
LOCKED = "This note is locked — unlock it in the Notebook first"
DESK_TITLE = "W11A Live Trading — Oct 1, 2026"
DESK_TRANSCRIPT = ("[0:05] Good morning, NVDA is holding the gap.\n"
                   "[0:40] Watching AMD for a reclaim.\n"
                   "[1:20] Set alerts on both before lunch.")

res: dict = {"wave": 11, "lane": "11A", "checks": {}, "errors": [], "voice_requests": []}
LINES: list[str] = []


def record(key, verdict, **facts):
    res["checks"][key] = {"verdict": verdict, **facts}
    line = f"[{verdict}] {key}: " + json.dumps(facts, default=str, ensure_ascii=True)[:400]
    LINES.append(line)
    print(line, file=sys.stderr, flush=True)


def guarded(key):
    def wrap(fn):
        def inner(*a, **kw):
            try:
                fn(*a, **kw)
            except Exception as e:  # noqa: BLE001 -- one row never stops the rest
                record(key, "INCONCLUSIVE", reason=f"exception: {type(e).__name__}: {e}",
                       traceback=traceback.format_exc()[-1500:])
        return inner
    return wrap


def find_key(obj, key):
    """The first value under `key` anywhere in a JSON payload (the auth payload nests)."""
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            got = find_key(v, key)
            if got is not None:
                return got
    if isinstance(obj, list):
        for v in obj:
            got = find_key(v, key)
            if got is not None:
                return got
    return None


def make_audio(path: Path, seconds: int) -> Path:
    """A tone of `seconds` as a small mono mp3 (16 kbps), generated locally."""
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i",
                    f"sine=frequency=330:duration={seconds}", "-ac", "1", "-ar", "16000",
                    "-c:a", "libmp3lame", "-b:a", "16k", str(path)], check=True, timeout=300)
    return path


def run_walk(base: str, art: Path, audio_dir: Path) -> None:
    from playwright.sync_api import sync_playwright

    run = time.strftime("r%H%M%S")
    res["run"] = run
    pw = secrets.token_urlsafe(18)   # a TEST value for this run only; never written anywhere
    files = {
        "upload": make_audio(audio_dir / "morning-call.mp3", 720),
        "fail": make_audio(audio_dir / "sandbox-fail-once-call.mp3", 400),
        "long": make_audio(audio_dir / "long-review.mp3", 3300),
    }
    res["audio_files"] = {k: {"name": p.name, "bytes": p.stat().st_size} for k, p in files.items()}

    def shot(pg, name):
        p = art / f"{name}.jpg"
        try:
            pg.screenshot(path=str(p), type="jpeg", quality=55)
            return p.name
        except Exception as e:  # noqa: BLE001
            return f"screenshot failed: {e}"

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
        admin = browser.new_context()
        member = browser.new_context(viewport={"width": 1280, "height": 860}, permissions=["microphone"])
        email = EMAIL.replace("@", f"-{run}@")
        res["member"] = email
        H._provision(admin.request, member.request, base, member=(email, pw, "Walker Eleven A"))
        api = member.request
        me = api.get(base + "/api/auth/me").json()
        res["server_flags"] = {"notebook_voice_notes_enabled": find_key(me, "notebook_voice_notes_enabled"),
                               "paid_equiv": find_key(me, "paid_equiv")}

        def on_request(req):
            if "/api/j2/voice-notes/" in req.url:
                res["voice_requests"].append(f"{req.method} {req.url.split('/api/j2/voice-notes', 1)[1]}")
        member.on("request", on_request)

        def new_page(ctx=member):
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
            return pg

        def status():
            return api.get(base + "/api/j2/voice-notes/status").json()

        def get_note(nid):
            return api.get(base + f"/api/j2/notes/{nid}").json()["note"]

        def body_of(nid):
            return json.dumps(get_note(nid).get("bodyJson") or {})

        # ── the seeded Desk session (admin + the sandbox's own push secret) ──
        v = admin.request.post(base + "/api/education/videos",
                               data={"youtube_url": "w11aSESSION", "title": DESK_TITLE,
                                     "category": "Live Trading Sessions"})
        if not v.ok:
            raise RuntimeError(f"seeding the Desk video: HTTP {v.status} {v.text()[:200]}")
        vid = (v.json().get("video") or v.json()).get("id")
        s = admin.request.post(base + f"/api/education/videos/{vid}/insights-store",
                               data={"transcript": DESK_TRANSCRIPT, "headline": "NVDA holds the gap"},
                               headers={"Authorization": f"Bearer {PUSH}"})
        res["desk_video"] = {"id": vid, "insights_store": s.status}

        def open_sheet(pg, path="/journal/notebook?view=all"):
            pg.goto(base + path)
            H._dismiss_intro(pg)
            pg.get_by_role("button", name="Templates", exact=True).click()
            return pg.get_by_role("dialog", name="New note")

        def dialog(pg):
            return pg.get_by_role("dialog", name="Voice note")

        def watch_progress(pg, timeout=120):
            """Every progress sentence the dialog shows until the preview (or an alert)."""
            seen, end = [], time.time() + timeout
            dlg = dialog(pg)
            while time.time() < end:
                try:
                    if dlg.get_by_role("region", name="Voice note preview").is_visible():
                        return seen, "preview"
                    if dlg.get_by_role("alert").count() and dlg.get_by_role("alert").first.is_visible():
                        return seen, "alert"
                    st = dlg.get_by_role("status")
                    if st.count():
                        t = st.first.inner_text().strip()
                        if t and (not seen or seen[-1] != t):
                            seen.append(t)
                except Exception:  # noqa: BLE001 -- the node can be re-rendered under us
                    pass
                time.sleep(0.05)
            return seen, "timeout"

        def note_id_from(pg, timeout=20):
            """The open note's id, read from the PAGE. ⚰️ Run 1 polled `pg.url` inside a
            `time.sleep` loop: the sync API only learns of a pushState when it next talks
            to the browser, so the property never moved and every saved note read None."""
            end = time.time() + timeout
            while time.time() < end:
                nid = pg.evaluate("() => new URLSearchParams(location.search).get('note')")
                if nid:
                    return nid
                pg.wait_for_timeout(100)
            return None

        def first_text(doc):
            """The first non-empty text in a stored body (a body may open with an empty paragraph)."""
            for n in doc.get("content") or []:
                for c in n.get("content") or []:
                    if c.get("type") == "text" and c.get("text", "").strip():
                        return c["text"]
            return ""

        @guarded("V0_gate_and_stub")
        def v0():
            st = status()
            ok = res["server_flags"]["notebook_voice_notes_enabled"] is True and "cap" in st
            record("V0_gate_and_stub", "PASS" if ok else "FAIL", flags=res["server_flags"], status=st)

        @guarded("V1_record_at_1280")
        def v1():
            pg = new_page()
            before = status()["cap"]["usedSeconds"]
            sheet = open_sheet(pg)
            group = sheet.get_by_role("group", name="Start from audio")
            buttons = [b.inner_text().strip() for b in group.get_by_role("button").all()]
            group.get_by_role("button", name=re.compile("Voice note")).click()
            dlg = dialog(pg)
            dlg.wait_for(state="visible", timeout=15000)
            idle_timer = dlg.get_by_role("timer").inner_text()
            dlg.get_by_role("button", name="Start recording").click()
            dlg.get_by_text("Recording", exact=True).wait_for(timeout=10000)
            time.sleep(3.4)
            t_rec = dlg.get_by_role("timer").inner_text()
            shot(pg, "V1-recording")
            dlg.get_by_role("button", name="Pause").click()
            dlg.get_by_text("Paused", exact=True).wait_for(timeout=5000)
            t_p1 = dlg.get_by_role("timer").inner_text()
            time.sleep(2.2)
            t_p2 = dlg.get_by_role("timer").inner_text()
            dlg.get_by_role("button", name="Resume").click()
            time.sleep(2.2)
            t_res = dlg.get_by_role("timer").inner_text()
            dlg.get_by_role("button", name="Stop and transcribe").click()
            seen, how = watch_progress(pg)
            prev = dlg.get_by_role("region", name="Voice note preview")
            text = prev.inner_text() if how == "preview" else ""
            shot(pg, "V1-preview")
            chips = [c.inner_text() for c in prev.locator("li").all()] if how == "preview" else []
            dlg.get_by_role("textbox", name="Title").fill(f"W11A walk recording {run}")
            dlg.get_by_role("button", name="Save as a new note").click()
            nid = note_id_from(pg)
            pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            pg.get_by_text("Voice note summary").first.wait_for(timeout=15000)
            shot(pg, "V1-note")
            note = get_note(nid) if nid else {}
            body = json.dumps(note.get("bodyJson") or {})
            after = status()["cap"]["usedSeconds"]
            facts = {
                "start_from_audio_buttons": buttons, "idle_timer": idle_timer,
                "timer_recording": t_rec, "timer_paused": [t_p1, t_p2], "timer_resumed": t_res,
                "progress_seen": seen, "ended_on": how,
                "ai_label": "AI-written · Compass · Voice note summary" in text,
                "chips": chips, "tsla_shown": "$TSLA" in text, "stub_transcript_in_body": "Part 1." in body,
                "note_id": nid, "note_title": note.get("title"), "note_tags": note.get("tags"),
                "body_has": {k: (k in body) for k in ("voice_summary", "taskList", "toggle",
                                                     "/journal/notebook/research/NVDA", "Full transcript")},
                "used_seconds": [before, after],
            }
            ok = (buttons == ["Voice note", "Upload recording", "From a Desk session"]
                  and t_p1 == t_p2 and t_rec != "0:00 / 1:00:00" and how == "preview" and facts["ai_label"]
                  and "$NVDA" in chips and "$AMD" in chips and not facts["tsla_shown"]
                  and all(facts["body_has"].values()) and "voice-note" in (note.get("tags") or [])
                  and after > before)
            record("V1_record_at_1280", "PASS" if ok else "FAIL", **facts)
            pg.close()

        @guarded("V2_upload_three_parts")
        def v2():
            pg = new_page()
            before = status()["cap"]["usedSeconds"]
            n0 = len(res["voice_requests"])
            sheet = open_sheet(pg)
            sheet.get_by_role("group", name="Start from audio").get_by_role("button", name=re.compile("Upload recording")).click()
            dlg = dialog(pg)
            dlg.get_by_label("Choose an audio file").set_input_files(str(files["upload"]))
            dlg.get_by_role("button", name="Transcribe").click()
            seen, how = watch_progress(pg, timeout=240)
            shot(pg, "V2-preview")
            reqs = res["voice_requests"][n0:]
            dlg.get_by_role("button", name="Save as a new note").click()
            nid = note_id_from(pg)
            body = body_of(nid) if nid else ""
            after = status()["cap"]["usedSeconds"]
            transcribes = [r for r in reqs if r.endswith("/transcribe")]
            at = [body.find(f"Part {i}.") for i in (1, 2, 3)]
            in_order = all(a >= 0 for a in at) and at == sorted(at)
            ok = (how == "preview" and len(transcribes) == 3 and reqs.count("POST /jobs") == 1
                  and in_order and after - before >= 720 and bool(nid))
            record("V2_upload_three_parts", "PASS" if ok else "FAIL", progress_seen=seen, requests=reqs,
                   used_seconds=[before, after], note_id=nid, part_positions_in_body=at, parts_in_order=in_order)
            pg.close()

        @guarded("V3_retry_keeps_the_recording")
        def v3():
            pg = new_page()
            n0 = len(res["voice_requests"])
            sheet = open_sheet(pg)
            sheet.get_by_role("group", name="Start from audio").get_by_role("button", name=re.compile("Upload recording")).click()
            dlg = dialog(pg)
            dlg.get_by_label("Choose an audio file").set_input_files(str(files["fail"]))
            dlg.get_by_role("button", name="Transcribe").click()
            seen, how = watch_progress(pg)
            alert = dlg.get_by_role("alert").first.inner_text() if how == "alert" else ""
            kept = dlg.get_by_text("Your recording is kept. Retry continues from where it stopped.").is_visible()
            shot(pg, "V3-error")
            dlg.get_by_role("button", name="Retry").click()
            seen2, how2 = watch_progress(pg)
            reqs = res["voice_requests"][n0:]
            shot(pg, "V3-after-retry")
            # discard: nothing saved, the server job and audio deleted
            dlg.get_by_role("button", name="Discard").click()
            dlg.get_by_role("button", name="Discard").click()   # the confirm's own Discard
            dialog(pg).wait_for(state="detached", timeout=10000)
            ok = (how == "alert" and "Transcription failed for part 2 of 2" in alert and kept
                  and how2 == "preview" and reqs.count("POST /jobs") == 1
                  and any(r.startswith("DELETE /jobs/") for r in res["voice_requests"][n0:]))
            record("V3_retry_keeps_the_recording", "PASS" if ok else "FAIL", alert=alert, kept_line=kept,
                   progress_before=seen, progress_after_retry=seen2, requests=res["voice_requests"][n0:])
            pg.close()

        @guarded("V4_cap_refused_up_front")
        def v4():
            pg = new_page()
            st = status()["cap"]
            n0 = len(res["voice_requests"])
            sheet = open_sheet(pg)
            sheet.get_by_role("group", name="Start from audio").get_by_role("button", name=re.compile("Upload recording")).click()
            dlg = dialog(pg)
            dlg.get_by_label("Choose an audio file").set_input_files(str(files["long"]))
            dlg.get_by_role("button", name="Transcribe").click()
            seen, how = watch_progress(pg)
            alert = dlg.get_by_role("alert").first.inner_text() if how == "alert" else ""
            shot(pg, "V4-cap")
            reqs = res["voice_requests"][n0:]
            left_min = st["remainingSeconds"] // 60
            ok = (how == "alert" and alert.startswith("This recording is 55 minutes long, and you have")
                  and f"you have {left_min} minutes" in alert
                  and not any(r.endswith("/transcribe") for r in reqs) and status()["cap"]["usedSeconds"] == st["usedSeconds"])
            record("V4_cap_refused_up_front", "PASS" if ok else "FAIL", cap_before=st, alert=alert, requests=reqs)
            pg.close()

        @guarded("V5_desk_session")
        def v5():
            pg = new_page()
            n0 = len(res["voice_requests"])
            sheet = open_sheet(pg)
            sheet.get_by_role("group", name="Start from audio").get_by_role("button", name=re.compile("From a Desk session")).click()
            dlg = dialog(pg)
            dlg.get_by_role("button", name=re.compile(re.escape(DESK_TITLE))).click()
            seen, how = watch_progress(pg)
            prev_text = dlg.get_by_role("region", name="Voice note preview").inner_text() if how == "preview" else ""
            shot(pg, "V5-desk-preview")
            dlg.get_by_role("button", name="Save as a new note").click()
            nid = note_id_from(pg)
            body = body_of(nid) if nid else ""
            reqs = res["voice_requests"][n0:]
            ok = (how == "preview" and "Desk session" in prev_text and "NVDA is holding the gap" in prev_text
                  and not any(r.endswith("/transcribe") or r == "POST /jobs" for r in reqs)
                  and "Desk session: " in body and "voice_summary" in body)
            record("V5_desk_session", "PASS" if ok else "FAIL", requests=reqs, note_id=nid)
            pg.close()

        def tab_to(pg, pattern, limit=60):
            rx = re.compile(pattern)
            for _ in range(limit):
                pg.keyboard.press("Tab")
                name = pg.evaluate("() => { const a = document.activeElement; return a ? (a.getAttribute('aria-label') || a.innerText || a.value || '').trim() : '' }")
                if rx.search(name or ""):
                    return name
            raise RuntimeError(f"Tab never reached /{pattern}/")

        @guarded("V6_slash_voice_append_by_keyboard")
        def v6():
            r = api.post(base + "/api/j2/notes", data={"title": f"W11A plan {run}", "bodyJson": {
                "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "My plan for today."}]}]}})
            nid = r.json()["note"]["id"]
            pg = new_page()
            pg.goto(f"{base}/journal/notebook?note={nid}")
            H._dismiss_intro(pg)
            pm = pg.locator(".ProseMirror").first
            pm.wait_for(state="visible", timeout=30000)
            pm.click()
            pg.keyboard.press("Control+End")
            pg.keyboard.press("Enter")
            # "/voice note", not "/voice": Dictate's keywords hold "voice" and it is listed
            # first, so Enter on "/voice" would start dictation (the menu filters titles AND
            # keywords; allowSpaces keeps the query open across the space).
            pg.keyboard.type("/voice note", delay=40)
            item = pg.get_by_text("Voice note", exact=True).first
            item.wait_for(timeout=10000)
            shot(pg, "V6-slash")
            pg.keyboard.press("Enter")
            dlg = dialog(pg)
            dlg.wait_for(state="visible", timeout=15000)
            steps = [tab_to(pg, r"Desk session")]
            pg.keyboard.press("Enter")
            dlg.get_by_role("list", name="Desk sessions with a transcript").wait_for(timeout=15000)
            steps.append(tab_to(pg, re.escape(DESK_TITLE)))
            pg.keyboard.press("Enter")
            seen, how = watch_progress(pg)
            steps.append(tab_to(pg, r"^Add to this note$"))
            pg.keyboard.press("Enter")
            dialog(pg).wait_for(state="detached", timeout=10000)
            pg.get_by_text("Voice note summary").first.wait_for(timeout=10000)
            shot(pg, "V6-appended")
            # the note's own autosave carries it
            end, body = time.time() + 20, ""
            while time.time() < end:
                body = body_of(nid)
                if "voice_summary" in body:
                    break
                time.sleep(0.5)
            doc = get_note(nid)["bodyJson"]
            first = first_text(doc)
            ok = how == "preview" and "voice_summary" in body and first == "My plan for today." and "toggle" in body
            record("V6_slash_voice_append_by_keyboard", "PASS" if ok else "FAIL", keyboard_steps=steps,
                   member_words_first=first, autosaved="voice_summary" in body, note_id=nid)
            pg.close()

        @guarded("V7_locked_note_refuses")
        def v7():
            r = api.post(base + "/api/j2/notes", data={"title": f"W11A locked {run}", "bodyJson": {
                "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Locked words."}]}]}})
            nid = r.json()["note"]["id"]
            lk = api.patch(base + f"/api/j2/notes/{nid}/lock", data={"locked": True})
            pg = new_page()
            pg.goto(f"{base}/journal/notebook?note={nid}")
            H._dismiss_intro(pg)
            pm = pg.locator(".ProseMirror").first
            pm.wait_for(state="visible", timeout=30000)
            editable = pm.get_attribute("contenteditable")
            pg.evaluate("() => document.querySelector('.ProseMirror').dispatchEvent(new CustomEvent('uct:notebook-voice-note', { bubbles: true }))")
            toast = pg.get_by_text(LOCKED).first
            toast.wait_for(timeout=10000)
            shot(pg, "V7-locked")
            dialog_open = dialog(pg).count() > 0
            ok = lk.ok and editable == "false" and not dialog_open
            record("V7_locked_note_refuses", "PASS" if ok else "FAIL", lock_status=lk.status,
                   contenteditable=editable, sentence_shown=True, dialog_opened=dialog_open)
            pg.close()

        @guarded("V8_phone_390_touch")
        def v8():
            phone = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                                        device_scale_factor=2, permissions=["microphone"])
            # the same member, signed in again in the phone context
            phone.request.post(base + "/api/auth/login", data={"email": email, "password": pw})
            pg = new_page(phone)
            sheet = open_sheet(pg)
            group = sheet.get_by_role("group", name="Start from audio")
            sizes = [b.bounding_box() for b in group.get_by_role("button").all()]
            shot(pg, "V8-sheet-390")
            group.get_by_role("button", name=re.compile("From a Desk session")).tap()
            dlg = dialog(pg)
            dlg.get_by_role("button", name=re.compile(re.escape(DESK_TITLE))).tap()
            watch_progress(pg)
            measure = pg.evaluate("""() => {
              const d = document.querySelector('[role="dialog"][aria-label="Voice note"], [role="dialog"]');
              const vw = window.innerWidth;
              const ctrls = [...document.querySelectorAll('[role="dialog"] button, [role="dialog"] input, [role="dialog"] summary')]
                .filter((e) => e.offsetParent !== null)
                .map((e) => { const r = e.getBoundingClientRect(); return { name: (e.getAttribute('aria-label') || e.innerText || e.type || '').trim().slice(0, 40), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) } });
              return { vw, docScroll: document.documentElement.scrollWidth, ctrls };
            }""")
            shot(pg, "V8-preview-390")
            short = [c for c in measure["ctrls"] if c["h"] < 43.5]
            off = [c for c in measure["ctrls"] if c["left"] < 0 or c["right"] > measure["vw"] + 1]
            sheet_short = [b for b in sizes if b and b["height"] < 43.5]   # 43.99998 is 44 px
            ok = measure["docScroll"] <= measure["vw"] + 1 and not short and not off and not sheet_short and len(sizes) == 3
            record("V8_phone_390_touch", "PASS" if ok else "FAIL", doc_scroll=measure["docScroll"], vw=measure["vw"],
                   under_44=short, off_screen=off, sheet_buttons=sizes, controls=len(measure["ctrls"]))
            pg.close()
            phone.close()

        @guarded("V9_desk_player_save_to_notebook")
        def v9():
            pg = new_page()
            pg.goto(base + "/desk?section=videos")
            H._dismiss_intro(pg)
            card = pg.get_by_role("button", name=re.compile(re.escape(DESK_TITLE))).first
            try:
                card.wait_for(timeout=20000)
            except Exception:  # noqa: BLE001 -- the title may be plain text inside a card
                card = pg.get_by_text(DESK_TITLE).first
                card.wait_for(timeout=10000)
            shot(pg, "V9-desk")
            card.click()
            btn = pg.get_by_role("button", name="Save to Notebook")
            try:
                btn.wait_for(timeout=30000)
            except Exception:
                shot(pg, "V9-no-button")
                raise
            shot(pg, "V9-dock")
            btn.click()
            dlg = dialog(pg)
            seen, how = watch_progress(pg)
            dlg.get_by_role("button", name="Save as a new note").click()
            saved = pg.get_by_role("button", name=re.compile("Saved to Notebook — open it"))
            saved.wait_for(timeout=15000)
            shot(pg, "V9-saved")
            record("V9_desk_player_save_to_notebook", "PASS" if how == "preview" else "FAIL", ended_on=how)
            pg.close()

        for row in (v0, v1, v2, v3, v4, v5, v6, v7, v8, v9):
            row()
        errs = [e for e in res["errors"]]
        record("V10_no_page_errors", "PASS" if not errs else "FAIL", errors=errs[:10])
        browser.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Wave 11 lane 11A live walk (see the module header).")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8563)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tip", default=None)
    ap.add_argument("--artifacts", required=True)
    args = ap.parse_args(argv)
    base = f"http://127.0.0.1:{args.port}"
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    art = Path(args.artifacts)
    art.mkdir(parents=True, exist_ok=True)
    audio_dir = Path(args.data_dir).parent / (Path(args.data_dir).name + "-audio")
    audio_dir.mkdir(parents=True, exist_ok=True)
    res.update({"tip": args.tip, "base": base, "data_dir": args.data_dir,
                "instrument": os.path.relpath(__file__, REPO),
                "walk_process_env": {k: os.environ.get(k) for k in (
                    "NOTEBOOK_VOICE_NOTES_ENABLED", "NOTEBOOK_VOICE_SANDBOX_STUB")},
                "model_keys_set": {k: bool(os.environ.get(k)) for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY")},
                "ffmpeg": shutil.which("ffmpeg"), "ffprobe": shutil.which("ffprobe")})
    refused = H.refuse_shared_root(args.data_dir)
    if not refused and H.port_busy(args.port):
        refused = f"port {args.port} already has a listener (never killed)"
    if not refused and not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        refused = "ffmpeg/ffprobe are not on PATH"
    if refused:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: {refused})")
        return 3
    sb = H.Sandbox(args.data_dir, args.port, art / "launcher.log")
    not_run = None
    try:
        sb.start()
        if not sb.wait_healthy(base, 300):
            not_run = "the sandbox never answered /api/health"
        else:
            sb.wait_checkpoint(H.POST_BOOT, H.POST_BOOT_WAIT_S)
            v = sandbox_identity.verify(base, sb.integrity_path())
            res["sandbox_identity"] = {"ok": v.ok, "sentence": v.sentence}
            if not v.ok:
                not_run = v.sentence
            else:
                try:
                    run_walk(base, art, audio_dir)
                except Exception as e:  # noqa: BLE001 -- setup failed; the sandbox still owes its verdict
                    not_run = f"{type(e).__name__}: {e}"
                    res["traceback"] = traceback.format_exc()[-2000:]
                res["prewarm_checkpoint_reached"] = sb.wait_checkpoint(H.PREWARM, H.PREWARM_WAIT_S)
    finally:
        res["stop"] = sb.stop()
        ipath = sb.integrity_path()
        integ = H.read_integrity(ipath, REQUIRED)
        if ipath and Path(ipath).is_file():
            kept = out.with_suffix(".integrity.md")
            shutil.move(ipath, kept)
            integ["path"] = str(kept)
        first = H.integrity_line(integ, not_run=not_run)
        res.update({"first_line": first, "integrity": integ, "not_run": not_run})
        out.write_text(json.dumps(res, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
        print(first)
        for line in LINES:
            print(line)
        print(f"evidence: {out}")
    if not_run:
        return 3
    verdicts = {k: v["verdict"] for k, v in res["checks"].items()}
    if any(v == "FAIL" for v in verdicts.values()):
        return 1
    if not integ.get("clean") or any(v == "INCONCLUSIVE" for v in verdicts.values()):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
